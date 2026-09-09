'use server';

import { and, eq, gte, lt } from 'drizzle-orm';
import { contacts, deals, pipelineStages, sales } from '@/db/schema';
import { withTenant, type TenantDb } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { comoResultado, type ServiceResult } from './errors';
import { resolverPeriodo, type Periodo, type PeriodoInput } from './periodo';

/**
 * §2 de `docs/PROPOSTAS_PRODUTO.md` — Resumo do período, a terceira tab do hub Dinheiro
 * (ao lado de Vendas e Financeiro), recortada pelo MESMO seletor de período do §1.
 *
 * "Quanto entrou, quanto vem, onde perdi" hoje vive espalhado entre o /hoje e o Dinheiro.
 * Esta action concentra: vendas fechadas, receita bruta, comissão recebida vs. prevista,
 * ticket médio, DE ONDE vieram (origem do contato) e ONDE se perderam (motivo de perda).
 *
 * Mesmas regras de `dashboard.ts`: `tenantId` vem de `requireAuthContext()`, toda query
 * dentro de `withTenant`, entrada validada em `./periodo.ts`, erro volta como
 * `ServiceResult`. LEITURA — NÃO passa pelo gate de assinatura (decisão de produto:
 * bloquear leitura é perder o cliente; ver `subscriptionGate.ts`).
 *
 * NENHUMA tabela nova, NENHUMA migration — tudo lido de `sales`, `deals` e `contacts`,
 * que já têm RLS desde as migrations de nascimento.
 */

// ---------------------------------------------------------------------------
// Formas de saída — contrato da tab "Resumo do período"
// ---------------------------------------------------------------------------

export type OrigemDeContato = {
  /**
   * `contacts.source` do contato do negócio: `whatsapp`, `instagram`, `indicacao`,
   * `site`, `evento`, `outro`. `null` = contato sem origem informada (o cadastro não
   * obriga) — a tela deve mostrar "sem origem", não inventar categoria.
   */
  origem: string | null;
  /** Vendas fechadas no período cujo contato veio dessa origem. */
  vendas: number;
  /** Soma de `sales.valorBrutoCents` dessas vendas. */
  receitaBrutaCents: number;
};

export type MotivoDePerda = {
  /**
   * `deals.lost_reason` — OBRIGATÓRIO na aplicação quando o negócio vai para `perdido`
   * (`moverEstagioDoNegocio`, `src/server/deals.ts`), mas o banco aceita `null`
   * (import/dado antigo). `null` = "sem motivo registrado".
   */
  motivo: string | null;
  /** Negócios `perdido` no período com esse motivo. */
  negocios: number;
  /** Soma de `deals.valueCents` — o tamanho do que se perdeu, não só a contagem. */
  valorCents: number;
};

export type ResumoDoPeriodo = {
  /** O período efetivamente consultado (pontas inclusivas, `AAAA-MM-DD`). */
  periodo: { de: string; ate: string; rotulo: string };
  vendas: {
    /** Linhas de `sales` criadas no período — ver a decisão 1 em `dashboard.ts`. */
    total: number;
    /** Soma de `sales.valorBrutoCents` — o que o cliente pagou. */
    receitaBrutaCents: number;
    /** Soma de `sales.taxaServicoCents` — honorário cobrado além do produto. */
    taxaServicoCents: number;
    /** `receitaBrutaCents / total`, `0` quando `total === 0` (nunca `NaN`). */
    ticketMedioCents: number;
  };
  comissao: {
    /** `comissaoStatus = 'prevista'` — esperada da operadora, ainda não caiu. */
    previstaCents: number;
    /** `comissaoStatus = 'recebida'` — conferida no extrato do fornecedor. */
    recebidaCents: number;
    /** `comissaoStatus = 'atrasada'` — passou da data combinada e não caiu. */
    atrasadaCents: number;
    /** Soma das três — comissão total das vendas do período. */
    totalCents: number;
  };
  /** Origem do contato das vendas do período, maior receita primeiro. */
  porOrigem: OrigemDeContato[];
  /** Motivos de perda dos negócios `perdido` do período, maior valor primeiro. */
  motivosDePerda: MotivoDePerda[];
};

// ---------------------------------------------------------------------------
// A action
// ---------------------------------------------------------------------------

/**
 * Recorte consciente, herdado do S10 e extendido ao período:
 *
 * - "Vendas do período" = linhas de `sales` por `createdAt` (proxy de "quando fechou";
 *   `sales` não tem coluna própria — ver decisão 1 em `dashboard.ts`).
 * - "Motivos de perda" = `deals.stage = 'perdido'` por `closedAt` — o carimbo que
 *   `moverEstagioDoNegocio` grava ao fechar como perdido. Não é `updatedAt` (qualquer
 *   edição reescreveria o recorte).
 * - Agregação em JAVASCRIPT, não `sum()`/`groupBy` no SQL, pelo MESMO motivo de
 *   `obterResumoDoPipeline` (`deals.ts`): `bigint` volta como string pelo driver em
 *   agregação (`numeric`), e somar em JS a partir de linhas já tipadas evita o cast
 *   silencioso de string. No volume esperado (MEI, 10–15 vendas/mês) é seguro; revisitar
 *   se um tenant crescer ordens de grandeza.
 */
async function calcularResumoDoPeriodo(tx: TenantDb, periodo: Periodo): Promise<ResumoDoPeriodo> {
  const janela = and(gte(sales.createdAt, periodo.inicio), lt(sales.createdAt, periodo.fimExclusivo));

  // --- 1) Vendas + comissão + origem do contato, numa query só (mesmas linhas) ---
  const linhasVendas = await tx
    .select({
      valorBrutoCents: sales.valorBrutoCents,
      taxaServicoCents: sales.taxaServicoCents,
      comissaoPrevistaCents: sales.comissaoPrevistaCents,
      comissaoStatus: sales.comissaoStatus,
      origem: contacts.source,
    })
    .from(sales)
    .innerJoin(deals, eq(deals.id, sales.dealId))
    .innerJoin(contacts, eq(contacts.id, deals.contactId))
    .where(janela);

  let receitaBrutaCents = 0;
  let taxaServicoCents = 0;
  let previstaCents = 0;
  let recebidaCents = 0;
  let atrasadaCents = 0;
  const porOrigemMap = new Map<string, { vendas: number; receitaBrutaCents: number }>();

  for (const linha of linhasVendas) {
    receitaBrutaCents += linha.valorBrutoCents;
    taxaServicoCents += linha.taxaServicoCents;
    if (linha.comissaoStatus === 'recebida') recebidaCents += linha.comissaoPrevistaCents;
    else if (linha.comissaoStatus === 'atrasada') atrasadaCents += linha.comissaoPrevistaCents;
    else previstaCents += linha.comissaoPrevistaCents;

    const chave = linha.origem ?? '';
    const atual = porOrigemMap.get(chave) ?? { vendas: 0, receitaBrutaCents: 0 };
    atual.vendas += 1;
    atual.receitaBrutaCents += linha.valorBrutoCents;
    porOrigemMap.set(chave, atual);
  }

  const porOrigem: OrigemDeContato[] = [...porOrigemMap.entries()]
    .map(([chave, valor]) => ({
      origem: chave === '' ? null : chave,
      vendas: valor.vendas,
      receitaBrutaCents: valor.receitaBrutaCents,
    }))
    // Maior receita primeiro — "de onde vieram" responde melhor ordenado por dinheiro.
    .sort((a, b) => b.receitaBrutaCents - a.receitaBrutaCents || b.vendas - a.vendas);

  // --- 2) Motivos de perda: negócios `perdido` fechados no período ---
  const linhasPerdidas = await tx
    .select({
      motivo: deals.lostReason,
      valueCents: deals.valueCents,
    })
    .from(deals)
    // S16: "perdido" é a COLUNA marcada `is_lost` do funil do tenant (0016), não o literal
    // — continua batendo com o enum, e continua batendo se a agente renomear a coluna.
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .where(
      and(
        eq(pipelineStages.isLost, true),
        gte(deals.closedAt, periodo.inicio),
        lt(deals.closedAt, periodo.fimExclusivo),
      ),
    );

  const motivosMap = new Map<string, { negocios: number; valorCents: number }>();
  for (const linha of linhasPerdidas) {
    const chave = linha.motivo ?? '';
    const atual = motivosMap.get(chave) ?? { negocios: 0, valorCents: 0 };
    atual.negocios += 1;
    atual.valorCents += linha.valueCents;
    motivosMap.set(chave, atual);
  }

  const motivosDePerda: MotivoDePerda[] = [...motivosMap.entries()]
    .map(([chave, valor]) => ({
      motivo: chave === '' ? null : chave,
      negocios: valor.negocios,
      valorCents: valor.valorCents,
    }))
    // Maior VALOR primeiro: um motivo que perdeu pouco mais vezes ainda é menor que um
    // que levou embora o pacote de grupo inteiro. Desempate por contagem.
    .sort((a, b) => b.valorCents - a.valorCents || b.negocios - a.negocios);

  const total = linhasVendas.length;

  return {
    periodo: { de: periodo.de, ate: periodo.ate, rotulo: periodo.rotulo },
    vendas: {
      total,
      receitaBrutaCents,
      taxaServicoCents,
      ticketMedioCents: total > 0 ? Math.round(receitaBrutaCents / total) : 0,
    },
    comissao: {
      previstaCents,
      recebidaCents,
      atrasadaCents,
      totalCents: previstaCents + recebidaCents + atrasadaCents,
    },
    porOrigem,
    motivosDePerda,
  };
}

/**
 * O resumo do período para a terceira tab do hub Dinheiro. Sem argumento = mês corrente
 * (mesma convenção de `obterResumoDoMes`). Sem gráfico, sem comparativo mensal — número
 * tabular é o registro silencioso do miolo (`docs/PROPOSTAS_PRODUTO.md` §2, "não fazer").
 */
export async function resumoDoPeriodo(
  periodoInput?: PeriodoInput,
): Promise<ServiceResult<ResumoDoPeriodo>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const periodo = resolverPeriodo(new Date(), periodoInput);
    return withTenant(tenantId, (tx) => calcularResumoDoPeriodo(tx, periodo));
  });
}
