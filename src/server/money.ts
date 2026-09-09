'use server';

import { and, eq, gte, lt } from 'drizzle-orm';
import { contacts, deals, member, pipelineStages, sales, tenants, user } from '@/db/schema';
import {
  filtroDeEscopoProprio,
  withTenant,
  type TenantDb,
  type TenantScope,
} from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { comoResultado, type ServiceResult } from './errors';
import { resolverPeriodo, type Periodo, type PeriodoInput } from './periodo';
import { escopoDaSessao } from './escopo';

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

/**
 * A quebra por vendedor da tab Resumo (Fase 3, §7 do doc). Aparece SOMENTE para
 * Studio com mais de um membro — decisão do PO (2026-09-09): é a feature exclusiva que
 * fecha o cruzamento de preço da §2. A FLAG diz à tela POR QUÊ ela não veio, para a
 * interface esconder com uma frase honesta em vez de adivinhar.
 */
export type QuebraPorVendedor =
  | {
      disponivel: true;
      /** Vendas do período agrupadas por `agent_id`, maior receita primeiro. */
      linhas: {
        /** `deals.agent_id`/`sales.agent_id`. `null` = venda sem vendedor (dado antigo). */
        agentId: string | null;
        /** Nome para o monograma/rótulo. `null` quando `agentId` é nulo. */
        nome: string | null;
        vendas: number;
        receitaBrutaCents: number;
      }[];
    }
  | { disponivel: false; motivo: 'plano' | 'membro_unico' };

export type ResumoDoPeriodo = {
  /** O período efetivamente consultado (pontas inclusivas, `AAAA-MM-DD`). */
  periodo: { de: string; ate: string; rotulo: string };
  /**
   * O ESCOPO que produziu estes números (Fase 3, §4): 'tenant' = a agência inteira
   * (dono), 'own' = só o próprio trabalho (agente, e TODO membro de Pro). A tela mostra
   * o rótulo — número sem dizer de quem é, em time, é número que briga.
   */
  escopo: 'tenant' | 'own';
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
  /** A quebra por vendedor — Studio com 2+ membros; em todo o resto, `disponivel: false`. */
  porVendedor: QuebraPorVendedor;
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
async function calcularResumoDoPeriodo(
  tx: TenantDb,
  periodo: Periodo,
  escopo: TenantScope,
): Promise<ResumoDoPeriodo> {
  const janela = and(
    gte(sales.createdAt, periodo.inicio),
    lt(sales.createdAt, periodo.fimExclusivo),
    // Fase 3 (§4): escopo `own` enxerga só o próprio trabalho — o recorte é o MESMO
    // para todos os números da tab (vendas, comissão, origem). `undefined` para o dono.
    filtroDeEscopoProprio(escopo, sales.agentId),
  );

  // --- 1) Vendas + comissão + origem do contato, numa query só (mesmas linhas) ---
  const linhasVendas = await tx
    .select({
      valorBrutoCents: sales.valorBrutoCents,
      taxaServicoCents: sales.taxaServicoCents,
      comissaoPrevistaCents: sales.comissaoPrevistaCents,
      comissaoStatus: sales.comissaoStatus,
      origem: contacts.source,
      // Fase 3 (§7): a quebra por vendedor soma por aqui.
      agentId: sales.agentId,
      agentName: user.name,
    })
    .from(sales)
    .innerJoin(deals, eq(deals.id, sales.dealId))
    .innerJoin(contacts, eq(contacts.id, deals.contactId))
    // LEFT: venda herdada de deal sem vendedor (dado antigo) continua no resumo.
    .leftJoin(user, eq(user.id, sales.agentId))
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

  // --- 3) A quebra por vendedor (Fase 3, §7): EXCLUSIVA do Studio (decisão do PO de
  // 2026-09-09, §2 do doc) e só com 2+ membros — "ranking de vendedores" com um
  // vendedor é ruído. Os números da quebra seguem o ESCOPO: dono de Studio vê o time
  // inteiro; membro de Studio vê a própria linha. Em Pro a flag volta 'plano' — o que
  // o membro de Pro já vê (escopo own) é exatamente o próprio resultado, sem quebra.
  const [tenant] = await tx
    .select({ plan: tenants.plan })
    .from(tenants)
    .limit(1);
  const plano = tenant?.plan ?? 'solo';

  let porVendedor: QuebraPorVendedor;
  if (plano !== 'studio') {
    porVendedor = { disponivel: false, motivo: 'plano' };
  } else {
    const membros = await tx.select({ id: member.id }).from(member);
    if (membros.length <= 1) {
      porVendedor = { disponivel: false, motivo: 'membro_unico' };
    } else {
      const porAgente = new Map<string | null, { nome: string | null; vendas: number; receitaBrutaCents: number }>();
      for (const linha of linhasVendas) {
        const atual = porAgente.get(linha.agentId) ?? {
          nome: linha.agentName,
          vendas: 0,
          receitaBrutaCents: 0,
        };
        atual.vendas += 1;
        atual.receitaBrutaCents += linha.valorBrutoCents;
        porAgente.set(linha.agentId, atual);
      }
      porVendedor = {
        disponivel: true,
        linhas: [...porAgente.entries()]
          .map(([agentId, valor]) => ({
            agentId,
            nome: valor.nome,
            vendas: valor.vendas,
            receitaBrutaCents: valor.receitaBrutaCents,
          }))
          // Maior receita primeiro, como em `porOrigem` — é a ordem em que a
          // tabela numérica responde "quem carrega o time".
          .sort((a, b) => b.receitaBrutaCents - a.receitaBrutaCents || b.vendas - a.vendas),
      };
    }
  }

  return {
    periodo: { de: periodo.de, ate: periodo.ate, rotulo: periodo.rotulo },
    escopo: escopo.kind === 'own' ? 'own' : 'tenant',
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
    porVendedor,
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
    const ctx = await requireAuthContext();
    const periodo = resolverPeriodo(new Date(), periodoInput);
    // Fase 3 (§4): escopo decidido AQUI, no service layer — dono vê o tenant, membro
    // vê o próprio resultado (e em Pro isso é o produto inteiro da tab).
    const escopo = escopoDaSessao(ctx);
    return withTenant(
      ctx.tenantId,
      (tx) => calcularResumoDoPeriodo(tx, periodo, escopo),
      { scope: escopo },
    );
  });
}
