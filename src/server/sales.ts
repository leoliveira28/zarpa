'use server';

import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { deals, proposalOptions, proposals, receivables, sales } from '@/db/schema';
import { withTenant } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { exigirContaAtiva } from './subscriptionGate';
import { registrarAuditoria } from './audit';
import { parseDataFlexivel } from './normalize';
import { resolverPeriodo, type PeriodoInput } from './periodo';

/**
 * S9 — o dinheiro que já fechou: converter proposta aceita em venda, editar
 * custo/comissão/taxa de serviço, parcelar o cliente e conferir a comissão da operadora.
 *
 * Mesmas quatro regras de `contacts.ts`/`proposals.ts`: `tenantId` vem da sessão, toda
 * query dentro de `withTenant`, `tenant_id` nunca vem do corpo da requisição, entrada
 * validada com zod antes de tocar no banco.
 *
 * `custoCents`/`comissaoPrevistaCents`/`taxaServicoCents` são tão sensíveis quanto
 * `proposal_options.cost_cents`/`commission_cents`: margem do agente. Todo tipo exportado
 * daqui é autenticado — não existe (e não deve existir) leitura pública de `sales` nem
 * `receivables`.
 */

// ---------------------------------------------------------------------------
// Colunas explícitas — nunca `select()` sem lista.
// ---------------------------------------------------------------------------

const COLUNAS_VENDA = {
  id: sales.id,
  dealId: sales.dealId,
  proposalId: sales.proposalId,
  proposalOptionId: sales.proposalOptionId,
  fornecedor: sales.fornecedor,
  valorBrutoCents: sales.valorBrutoCents,
  custoCents: sales.custoCents,
  comissaoPrevistaCents: sales.comissaoPrevistaCents,
  taxaServicoCents: sales.taxaServicoCents,
  comissaoStatus: sales.comissaoStatus,
  createdAt: sales.createdAt,
  updatedAt: sales.updatedAt,
} as const;

const COLUNAS_PARCELA = {
  id: receivables.id,
  saleId: receivables.saleId,
  venceEm: receivables.venceEm,
  valorCents: receivables.valorCents,
  status: receivables.status,
  pagoEm: receivables.pagoEm,
  createdAt: receivables.createdAt,
  updatedAt: receivables.updatedAt,
} as const;

export type ComissaoStatus = 'prevista' | 'recebida' | 'atrasada';
export type ParcelaStatus = 'pendente' | 'pago' | 'atrasado' | 'cancelado';

export type VendaResumo = {
  id: string;
  dealId: string;
  proposalId: string;
  proposalOptionId: string | null;
  fornecedor: string | null;
  valorBrutoCents: number;
  custoCents: number;
  comissaoPrevistaCents: number;
  taxaServicoCents: number;
  comissaoStatus: ComissaoStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type ParcelaResumo = {
  id: string;
  saleId: string;
  /** `AAAA-MM-DD`. */
  venceEm: string;
  valorCents: number;
  status: ParcelaStatus;
  pagoEm: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FiltroVendas = {
  comissaoStatus?: ComissaoStatus;
  /**
   * §1 (`docs/PROPOSTAS_PRODUTO.md`): recorte opcional por `{ mes: 'AAAA-MM' }` ou
   * `{ de, ate }` sobre `sales.createdAt` (o "quando fechou" da venda — ver a decisão 1
   * em `dashboard.ts`). AUSENTE = sem filtro de data, comportamento atual preservado.
   * Validação/zod em `./periodo.ts`; período inválido volta como `DADOS_INVALIDOS`.
   */
  periodo?: PeriodoInput;
  limite?: number;
};

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function isoDeUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** `2026-01-31` + 1 mês → `2026-02-28` (Date normaliza o "dia 31 de fevereiro" sozinho). */
function somarMeses(iso: string, meses: number): string {
  const [ano, mes, dia] = iso.split('-').map(Number) as [number, number, number];
  return isoDeUTC(new Date(Date.UTC(ano, mes - 1 + meses, dia)));
}

const dataInput = z
  .string()
  .trim()
  .min(1, 'Informe a data')
  .transform((value, ctx) => {
    const iso = parseDataFlexivel(value);
    if (!iso) {
      ctx.addIssue({ code: 'custom', message: 'Data inválida' });
      return z.NEVER;
    }
    return iso;
  });

/** Busca a venda garantindo que pertence ao tenant atual (RLS já garante isso — a
 * checagem aqui só transforma "zero linhas" em mensagem certa para a interface). */
async function exigirVenda(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  vendaId: string,
): Promise<{ id: string }> {
  const [venda] = await tx
    .select({ id: sales.id })
    .from(sales)
    .where(eq(sales.id, vendaId))
    .limit(1);

  if (!venda) {
    throw new ServiceError('NAO_ENCONTRADO', 'Essa venda não existe mais.', {
      correcao: 'Voltar para a lista',
    });
  }
  return venda;
}

// ---------------------------------------------------------------------------
// Conversão de proposta aceita em venda
// ---------------------------------------------------------------------------

const converterInput = z.object({
  fornecedor: z.string().trim().max(160).optional().or(z.literal('')),
  taxaServicoCents: z.number().int().min(0).optional(),
});

export type ConverterPropostaInput = z.infer<typeof converterInput>;

/**
 * Converte uma proposta ACEITA (`proposals.status = 'accepted'`, `accepted_option_id`
 * preenchido — ver `aceitarOpcaoPublica`/`public.aceitar_opcao_proposta`) numa venda,
 * fotografando preço/custo/comissão da opção aceita.
 *
 * **Idempotente de propósito**: se a proposta já virou venda (o agente clicou duas vezes,
 * ou o botão renderizou antes do primeiro clique confirmar), devolve a venda já existente
 * em vez de erro de conflito — o índice único `sales_proposal_id_key`
 * (`0007_vendas_e_recebiveis.sql`) garante que nunca existem duas.
 */
export async function converterPropostaEmVenda(
  propostaId: string,
  input: ConverterPropostaInput = {},
): Promise<ServiceResult<VendaResumo>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const parsed = converterInput.safeParse(input);
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
        campo: primeiro?.path.join('.'),
        correcao: 'Corrigir e tentar de novo',
      });
    }
    const dados = parsed.data;

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const [existente] = await tx
        .select(COLUNAS_VENDA)
        .from(sales)
        .where(eq(sales.proposalId, propostaId))
        .limit(1);

      if (existente) {
        return existente as VendaResumo;
      }

      const [proposta] = await tx
        .select({
          id: proposals.id,
          dealId: proposals.dealId,
          status: proposals.status,
          acceptedOptionId: proposals.acceptedOptionId,
          // Fase 3 (§5): a atribuição É do deal — a venda herda na conversão.
          dealAgentId: deals.agentId,
          // Fase 4a: o centro de custo TAMBÉM é do deal — fotografia na conversão,
          // mesma mecânica do vendedor acima.
          dealCostCenterId: deals.costCenterId,
        })
        .from(proposals)
        .innerJoin(deals, eq(deals.id, proposals.dealId))
        .where(eq(proposals.id, propostaId))
        .limit(1);

      if (!proposta) {
        throw new ServiceError('NAO_ENCONTRADO', 'Essa proposta não existe mais.', {
          correcao: 'Voltar para a lista',
        });
      }

      if (proposta.status !== 'accepted' || !proposta.acceptedOptionId) {
        throw new ServiceError(
          'CONFLITO',
          'Essa proposta ainda não foi aceita pelo cliente.',
          { correcao: 'Aguardar o aceite antes de gerar a venda' },
        );
      }

      const [opcao] = await tx
        .select({
          id: proposalOptions.id,
          priceCents: proposalOptions.priceCents,
          costCents: proposalOptions.costCents,
          commissionCents: proposalOptions.commissionCents,
        })
        .from(proposalOptions)
        .where(
          and(
            eq(proposalOptions.id, proposta.acceptedOptionId),
            eq(proposalOptions.proposalId, propostaId),
          ),
        )
        .limit(1);

      if (!opcao) {
        throw new ServiceError(
          'CONFLITO',
          'A opção aceita não existe mais nesta proposta.',
          { correcao: 'Revisar a proposta antes de gerar a venda' },
        );
      }

      const [criada] = await tx
        .insert(sales)
        .values({
          tenantId,
          dealId: proposta.dealId,
          proposalId: propostaId,
          proposalOptionId: opcao.id,
          fornecedor: dados.fornecedor?.trim() || null,
          agentId: proposta.dealAgentId,
          costCenterId: proposta.dealCostCenterId,
          valorBrutoCents: opcao.priceCents,
          custoCents: opcao.costCents,
          comissaoPrevistaCents: opcao.commissionCents,
          taxaServicoCents: dados.taxaServicoCents ?? 0,
          comissaoStatus: 'prevista',
        })
        .returning(COLUNAS_VENDA);

      const venda = criada!;

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'sale.created',
        entity: 'sale',
        entityId: venda.id,
        metadata: { proposalId: propostaId, dealId: proposta.dealId },
      });

      return venda as VendaResumo;
    });
  });
}

// ---------------------------------------------------------------------------
// CRUD de venda
// ---------------------------------------------------------------------------

export async function listarVendas(filtro: FiltroVendas = {}): Promise<ServiceResult<VendaResumo[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const limite = Math.min(Math.max(filtro.limite ?? 50, 1), 200);

    return withTenant(tenantId, async (tx) => {
      const condicoes = filtro.comissaoStatus
        ? [eq(sales.comissaoStatus, filtro.comissaoStatus)]
        : [];

      if (filtro.periodo !== undefined) {
        const periodo = resolverPeriodo(new Date(), filtro.periodo);
        const janela = and(gte(sales.createdAt, periodo.inicio), lt(sales.createdAt, periodo.fimExclusivo));
        if (janela) condicoes.push(janela);
      }

      const linhas = await tx
        .select(COLUNAS_VENDA)
        .from(sales)
        .where(condicoes.length ? and(...condicoes) : undefined)
        .orderBy(desc(sales.createdAt))
        .limit(limite);

      return linhas as VendaResumo[];
    });
  });
}

export async function obterVenda(vendaId: string): Promise<ServiceResult<VendaResumo>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const [venda] = await tx.select(COLUNAS_VENDA).from(sales).where(eq(sales.id, vendaId)).limit(1);

      if (!venda) {
        throw new ServiceError('NAO_ENCONTRADO', 'Essa venda não existe mais.', {
          correcao: 'Voltar para a lista',
        });
      }
      return venda as VendaResumo;
    });
  });
}

const vendaPatchInput = z.object({
  fornecedor: z.string().trim().max(160).optional().or(z.literal('')),
  valorBrutoCents: z.number().int().min(0).optional(),
  custoCents: z.number().int().min(0).optional(),
  comissaoPrevistaCents: z.number().int().min(0).optional(),
  taxaServicoCents: z.number().int().min(0).optional(),
});

export type VendaPatch = z.infer<typeof vendaPatchInput>;

/** Autosave: só o que veio no patch muda (mesmo padrão de `atualizarProposta`). */
export async function atualizarVenda(
  vendaId: string,
  patch: VendaPatch,
): Promise<ServiceResult<VendaResumo>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const parsed = vendaPatchInput.safeParse(patch);
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
        campo: primeiro?.path.join('.'),
        correcao: 'Corrigir e salvar de novo',
      });
    }
    const dados = parsed.data;

    const valores: Record<string, unknown> = { updatedAt: new Date() };
    let mudou = 0;

    if (dados.fornecedor !== undefined) {
      valores.fornecedor = dados.fornecedor.trim() || null;
      mudou++;
    }
    if (dados.valorBrutoCents !== undefined) {
      valores.valorBrutoCents = dados.valorBrutoCents;
      mudou++;
    }
    if (dados.custoCents !== undefined) {
      valores.custoCents = dados.custoCents;
      mudou++;
    }
    if (dados.comissaoPrevistaCents !== undefined) {
      valores.comissaoPrevistaCents = dados.comissaoPrevistaCents;
      mudou++;
    }
    if (dados.taxaServicoCents !== undefined) {
      valores.taxaServicoCents = dados.taxaServicoCents;
      mudou++;
    }

    if (mudou === 0) {
      throw new ServiceError('DADOS_INVALIDOS', 'Nada para salvar.', { correcao: 'Fechar' });
    }

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const linhas = await tx
        .update(sales)
        .set(valores)
        .where(eq(sales.id, vendaId))
        .returning(COLUNAS_VENDA);

      if (linhas.length === 0) {
        throw new ServiceError('NAO_ENCONTRADO', 'Essa venda não existe mais.', {
          correcao: 'Voltar para a lista',
        });
      }
      return linhas[0]! as VendaResumo;
    });
  });
}

const comissaoStatusInput = z.enum(['prevista', 'recebida', 'atrasada']);

/**
 * Conferência da comissão da operadora. Deliberadamente NÃO é uma máquina de estado
 * estrita (não bloqueia `recebida` → `prevista`): é conferência manual feita por uma
 * pessoa lendo extrato do fornecedor, e correção de um clique errado precisa ser possível
 * sem reabrir a venda inteira.
 */
export async function atualizarStatusComissao(
  vendaId: string,
  status: ComissaoStatus,
): Promise<ServiceResult<VendaResumo>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const parsed = comissaoStatusInput.safeParse(status);
    if (!parsed.success) {
      throw new ServiceError('DADOS_INVALIDOS', 'Status de comissão inválido.', {
        campo: 'comissaoStatus',
        correcao: 'Escolher prevista, recebida ou atrasada',
      });
    }

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const linhas = await tx
        .update(sales)
        .set({ comissaoStatus: parsed.data, updatedAt: new Date() })
        .where(eq(sales.id, vendaId))
        .returning(COLUNAS_VENDA);

      if (linhas.length === 0) {
        throw new ServiceError('NAO_ENCONTRADO', 'Essa venda não existe mais.', {
          correcao: 'Voltar para a lista',
        });
      }

      const venda = linhas[0]!;

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'sale.commission_status_changed',
        entity: 'sale',
        entityId: venda.id,
        metadata: { comissaoStatus: parsed.data },
      });

      return venda as VendaResumo;
    });
  });
}

/**
 * Apaga a venda. Recusa se houver parcela já marcada `pago` — apagar histórico de
 * pagamento é o tipo de coisa que uma fintech não deixa acontecer com um clique.
 */
export async function excluirVenda(vendaId: string): Promise<ServiceResult<null>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      await exigirVenda(tx, vendaId);

      const [comParcelaPaga] = await tx
        .select({ id: receivables.id })
        .from(receivables)
        .where(and(eq(receivables.saleId, vendaId), eq(receivables.status, 'pago')))
        .limit(1);

      if (comParcelaPaga) {
        throw new ServiceError(
          'CONFLITO',
          'Essa venda tem parcela já paga — não dá para excluir o histórico.',
          { correcao: 'Cancelar as parcelas em aberto em vez de excluir a venda' },
        );
      }

      await tx.delete(sales).where(eq(sales.id, vendaId));
      return null;
    });
  });
}

// ---------------------------------------------------------------------------
// Parcelas do cliente (receivables)
// ---------------------------------------------------------------------------

const parcelaInput = z.object({
  venceEm: dataInput,
  valorCents: z.number().int().min(0),
});

export type ParcelaInput = z.infer<typeof parcelaInput>;

export async function listarParcelas(vendaId: string): Promise<ServiceResult<ParcelaResumo[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      await exigirVenda(tx, vendaId);

      const linhas = await tx
        .select(COLUNAS_PARCELA)
        .from(receivables)
        .where(eq(receivables.saleId, vendaId))
        .orderBy(receivables.venceEm);

      return linhas as ParcelaResumo[];
    });
  });
}

export async function criarParcela(
  vendaId: string,
  input: ParcelaInput,
): Promise<ServiceResult<ParcelaResumo>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const parsed = parcelaInput.safeParse(input);
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
        campo: primeiro?.path.join('.'),
        correcao: 'Corrigir e tentar de novo',
      });
    }
    const dados = parsed.data;

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      await exigirVenda(tx, vendaId);

      const [criada] = await tx
        .insert(receivables)
        .values({
          tenantId,
          saleId: vendaId,
          venceEm: dados.venceEm,
          valorCents: dados.valorCents,
          status: 'pendente',
        })
        .returning(COLUNAS_PARCELA);

      return criada! as ParcelaResumo;
    });
  });
}

const gerarParcelasInput = z.object({
  quantidade: z.number().int().min(1).max(24),
  primeiraVencimento: dataInput,
});

export type GerarParcelasInput = z.infer<typeof gerarParcelasInput>;

/**
 * Divide `valor_bruto_cents` da venda em N parcelas mensais iguais, a última absorvendo o
 * resto da divisão em centavos (nunca perde nem sobra 1 centavo — dinheiro não arredonda
 * para o nada). Conveniência para o caso comum; `criarParcela` continua disponível para
 * parcelamento manual/desigual (entrada maior, por exemplo).
 *
 * **Idempotente sob concorrência**: `vence_em` de cada parcela é função determinística de
 * (venda, quantidade, primeiraVencimento) — duas chamadas simultâneas com o mesmo insumo
 * (duplo clique no botão) geram exatamente as mesmas datas. A checagem de "já existe
 * parcela" acima é só a mensagem amigável para o caso sequencial; quem garante a
 * concorrência de verdade é o índice único `receivables_sale_id_vence_em_key`
 * (`0008_receivables_dedupe.sql`) — o INSERT usa `ON CONFLICT DO NOTHING` e a resposta
 * sempre reflete o estado JÁ PERSISTIDO no banco (reselect), nunca o que esta chamada
 * pontual conseguiu inserir. Mesma doutrina de `sales_proposal_id_key` em
 * `converterPropostaEmVenda`: o banco garante, não a sorte de nunca rodar duas vezes.
 */
export async function gerarParcelasDaVenda(
  vendaId: string,
  input: GerarParcelasInput,
): Promise<ServiceResult<ParcelaResumo[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const parsed = gerarParcelasInput.safeParse(input);
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
        campo: primeiro?.path.join('.'),
        correcao: 'Corrigir e tentar de novo',
      });
    }
    const dados = parsed.data;

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const [venda] = await tx
        .select({ id: sales.id, valorBrutoCents: sales.valorBrutoCents })
        .from(sales)
        .where(eq(sales.id, vendaId))
        .limit(1);

      if (!venda) {
        throw new ServiceError('NAO_ENCONTRADO', 'Essa venda não existe mais.', {
          correcao: 'Voltar para a lista',
        });
      }

      const [{ existentes }] = await tx
        .select({ existentes: sql<number>`count(*)::int` })
        .from(receivables)
        .where(eq(receivables.saleId, vendaId));

      if (existentes > 0) {
        throw new ServiceError(
          'CONFLITO',
          'Essa venda já tem parcelas geradas.',
          { correcao: 'Editar ou excluir as parcelas existentes' },
        );
      }

      const base = Math.floor(venda.valorBrutoCents / dados.quantidade);
      const resto = venda.valorBrutoCents - base * dados.quantidade;

      const novasLinhas = Array.from({ length: dados.quantidade }, (_, i) => ({
        tenantId,
        saleId: vendaId,
        venceEm: somarMeses(dados.primeiraVencimento, i),
        valorCents: i === dados.quantidade - 1 ? base + resto : base,
        status: 'pendente' as const,
      }));

      // `onConflictDoNothing` contra `receivables_sale_id_vence_em_key`: se uma chamada
      // concorrente já inseriu (mesmo tenant, mesma venda, mesma data), esta simplesmente
      // não duplica — sem lançar erro, sem "vencer a corrida" às custas da outra.
      await tx
        .insert(receivables)
        .values(novasLinhas)
        .onConflictDoNothing({
          target: [receivables.saleId, receivables.venceEm],
        });

      // A resposta é sempre o estado JÁ PERSISTIDO da venda, não "o que esta chamada
      // conseguiu inserir" — é isso que torna a função idempotente de verdade sob
      // concorrência: as duas chamadas simultâneas devolvem o MESMO conjunto de parcelas.
      const persistidas = await tx
        .select(COLUNAS_PARCELA)
        .from(receivables)
        .where(eq(receivables.saleId, vendaId))
        .orderBy(receivables.venceEm);

      return persistidas as ParcelaResumo[];
    });
  });
}

const parcelaPatchInput = z.object({
  venceEm: dataInput.optional(),
  valorCents: z.number().int().min(0).optional(),
  status: z.enum(['pendente', 'pago', 'atrasado', 'cancelado']).optional(),
});

export type ParcelaPatch = z.infer<typeof parcelaPatchInput>;

/**
 * Autosave da parcela. Trocar `status` para `pago` sem passar `pagoEm` marca agora —
 * trocar para qualquer outro status limpa `pagoEm` sozinho (o CHECK
 * `receivables_pago_em_check` da migration exige isso; fazer aqui evita round-trip de
 * erro até a interface).
 */
export async function atualizarParcela(
  parcelaId: string,
  patch: ParcelaPatch,
): Promise<ServiceResult<ParcelaResumo>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const parsed = parcelaPatchInput.safeParse(patch);
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
        campo: primeiro?.path.join('.'),
        correcao: 'Corrigir e salvar de novo',
      });
    }
    const dados = parsed.data;

    const valores: Record<string, unknown> = { updatedAt: new Date() };
    let mudou = 0;

    if (dados.venceEm !== undefined) {
      valores.venceEm = dados.venceEm;
      mudou++;
    }
    if (dados.valorCents !== undefined) {
      valores.valorCents = dados.valorCents;
      mudou++;
    }
    if (dados.status !== undefined) {
      valores.status = dados.status;
      valores.pagoEm = dados.status === 'pago' ? new Date() : null;
      mudou++;
    }

    if (mudou === 0) {
      throw new ServiceError('DADOS_INVALIDOS', 'Nada para salvar.', { correcao: 'Fechar' });
    }

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const linhas = await tx
        .update(receivables)
        .set(valores)
        .where(eq(receivables.id, parcelaId))
        .returning(COLUNAS_PARCELA);

      if (linhas.length === 0) {
        throw new ServiceError('NAO_ENCONTRADO', 'Essa parcela não existe mais.', {
          correcao: 'Recarregar a venda',
        });
      }
      return linhas[0]! as ParcelaResumo;
    });
  });
}

/** Atalho de `atualizarParcela` para o caso mais comum: marcar como paga hoje. */
export async function marcarParcelaPaga(parcelaId: string): Promise<ServiceResult<ParcelaResumo>> {
  return atualizarParcela(parcelaId, { status: 'pago' });
}

export async function excluirParcela(parcelaId: string): Promise<ServiceResult<null>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const afetadas = await tx
        .delete(receivables)
        .where(eq(receivables.id, parcelaId))
        .returning({ id: receivables.id });

      if (afetadas.length === 0) {
        throw new ServiceError('NAO_ENCONTRADO', 'Essa parcela não existe mais.', {
          correcao: 'Recarregar a venda',
        });
      }
      return null;
    });
  });
}
