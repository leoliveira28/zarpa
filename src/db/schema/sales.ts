import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from '../uuid';
import { tenants } from './tenants';
import { deals } from './pipeline';
import { user } from './auth';
import { proposals, proposalOptions } from './proposals';

/**
 * S9 — o dinheiro que já fechou: `sales` (a venda que nasce de uma proposta ACEITA) e
 * `receivables` (as parcelas do CLIENTE, com vencimento — não confundir com `payments`,
 * que é a cobrança da ASSINATURA do próprio agente, em `money.ts`).
 *
 * `sales` nasce de `proposals.status = 'accepted'` — ver `converterPropostaEmVenda` em
 * `src/server/sales.ts`. `valor_bruto_cents`/`custo_cents`/`comissao_prevista_cents` são
 * uma FOTOGRAFIA da opção aceita no momento da conversão, não um espelho ao vivo de
 * `proposal_options`: o agente pode renegociar custo/comissão com o fornecedor DEPOIS da
 * venda fechada (over, incentivo, ajuste de operadora) sem que isso reescreva a proposta
 * já aceita pelo cliente.
 *
 * `custo_cents`/`comissao_prevista_cents`/`taxa_servico_cents` são tão sensíveis quanto
 * `proposal_options.cost_cents`/`commission_cents` (ver `proposals.ts`): margem do
 * agente, nunca público. Não existe (e não deve existir) rota pública para `sales`.
 */

export const sales = pgTable(
  'sales',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** RESTRICT: apagar o negócio não pode sumir com o histórico financeiro da venda. */
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'restrict' }),
    /**
     * Quem vendeu — HERDADO do deal na conversão (Fase 3, `drizzle/0019_multiusuario.sql`).
     * Nullable como `deals.agent_id` (dado antigo/importado); a atribuição é fotografada
     * na conversão e o relatório por vendedor soma por aqui.
     */
    agentId: text('agent_id').references(() => user.id, { onDelete: 'restrict' }),
    /** RESTRICT pelo mesmo motivo — a venda é o registro contábil, sobrevive à proposta. */
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'restrict' }),
    /**
     * Qual opção virou venda — só linhagem/auditoria. `SET NULL`: apagar a opção (o
     * construtor permite excluir opção de proposta já enviada) não pode apagar a venda
     * nem os valores já fotografados em `valor_bruto_cents` etc.
     */
    proposalOptionId: uuid('proposal_option_id').references(() => proposalOptions.id, {
      onDelete: 'set null',
    }),
    /** Operadora/fornecedor que emitiu o produto (CVC, Decolar, cia aérea direta...). */
    fornecedor: text('fornecedor'),
    /** Preço cobrado do cliente. Fotografia de `proposal_options.price_cents`. */
    valorBrutoCents: bigint('valor_bruto_cents', { mode: 'number' }).notNull().default(0),
    /** Custo do fornecedor. NUNCA público — edita depois da venda fechada (renegociação). */
    custoCents: bigint('custo_cents', { mode: 'number' }).notNull().default(0),
    /** Comissão esperada da operadora. NUNCA pública. */
    comissaoPrevistaCents: bigint('comissao_prevista_cents', { mode: 'number' })
      .notNull()
      .default(0),
    /** Taxa de serviço cobrada do cliente, além do preço do produto (honorário do agente). */
    taxaServicoCents: bigint('taxa_servico_cents', { mode: 'number' }).notNull().default(0),
    /**
     * Fatia da comissão que fica com o agente (Fase 3, §5). Padrão 100 — o agente fica
     * com toda a comissão prevista; a "casa" já é remunerada pela assinatura do Zarpa.
     * Split diferente é decisão MANUAL do dono por venda: não existe régua automática.
     */
    commissionSplitPct: integer('commission_split_pct').notNull().default(100),
    /**
     * Conferência da comissão prometida pela operadora: nasce `prevista`, e o agente
     * confirma manualmente quando o extrato do fornecedor cai (`recebida`) ou marca
     * `atrasada` quando passou da data combinada e não caiu.
     */
    comissaoStatus: text('comissao_status', {
      enum: ['prevista', 'recebida', 'atrasada'],
    })
      .notNull()
      .default('prevista'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sales_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('sales_deal_id_idx').on(t.dealId),
    index('sales_proposal_option_id_idx').on(t.proposalOptionId),
    // FK (RESTRICT) e a quebra por vendedor do Resumo do período.
    index('sales_agent_id_idx').on(t.agentId),
    index('sales_tenant_agent_idx').on(t.tenantId, t.agentId),
    // Uma proposta aceita vira NO MÁXIMO uma venda — o banco garante idempotência da
    // conversão, não a sorte de `converterPropostaEmVenda` nunca ser chamada duas vezes.
    uniqueIndex('sales_proposal_id_key').on(t.proposalId),
    index('sales_tenant_comissao_status_idx').on(t.tenantId, t.comissaoStatus),
    check(
      'sales_comissao_status_check',
      sql`${t.comissaoStatus} in ('prevista', 'recebida', 'atrasada')`,
    ),
    check(
      'sales_valores_check',
      sql`${t.valorBrutoCents} >= 0 and ${t.custoCents} >= 0 and ${t.comissaoPrevistaCents} >= 0 and ${t.taxaServicoCents} >= 0`,
    ),
    check('sales_commission_split_check', sql`${t.commissionSplitPct} between 0 and 100`),
  ],
);

/**
 * Uma parcela do CLIENTE (não confundir com a fatura da assinatura em `payments`).
 * `vence_em` é `date` (dia do vencimento, sem hora — parcelamento de viagem não tem fuso),
 * igual a `deals.departure_on`/`return_on`.
 */
export const receivables = pgTable(
  'receivables',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** CASCADE: a parcela é filha da venda, não sobrevive sozinha à venda excluída. */
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    venceEm: date('vence_em').notNull(),
    valorCents: bigint('valor_cents', { mode: 'number' }).notNull(),
    status: text('status', {
      enum: ['pendente', 'pago', 'atrasado', 'cancelado'],
    })
      .notNull()
      .default('pendente'),
    pagoEm: timestamp('pago_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('receivables_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('receivables_sale_id_idx').on(t.saleId),
    // A tela que importa é "o que está em aberto e vence quando" — mesmo desenho de
    // `tasks_tenant_open_due_idx`: índice parcial que não paga por parcela já paga/cancelada.
    index('receivables_tenant_open_due_idx')
      .on(t.tenantId, t.venceEm)
      .where(sql`${t.status} = 'pendente'`),
    // `gerarParcelasDaVenda` (src/server/sales.ts) calcula `vence_em` deterministicamente
    // a partir de (venda, quantidade, primeiraVencimento) — duas chamadas concorrentes
    // com o mesmo insumo produzem exatamente as mesmas datas. Este índice único é quem
    // garante a idempotência sob concorrência (mesma doutrina de `sales_proposal_id_key`
    // em `0007_vendas_e_recebiveis.sql`): a 2ª geração colide no banco em vez de duplicar
    // parcela. `criarParcela` (parcelamento manual) respeita o mesmo limite — duas
    // parcelas manuais no mesmo dia para a mesma venda precisam ser somadas em uma linha,
    // não duas.
    uniqueIndex('receivables_sale_id_vence_em_key').on(t.saleId, t.venceEm),
    check(
      'receivables_status_check',
      sql`${t.status} in ('pendente', 'pago', 'atrasado', 'cancelado')`,
    ),
    check('receivables_valor_check', sql`${t.valorCents} >= 0`),
    // Parcela paga tem data de pagamento; parcela não paga não tem. As duas coisas são a
    // MESMA informação vista de dois lados — o CHECK impede que se desencontrem (mesmo
    // padrão de `tasks_dedupe_key_check`).
    check(
      'receivables_pago_em_check',
      sql`(${t.status} = 'pago') = (${t.pagoEm} is not null)`,
    ),
  ],
);

export type Sale = typeof sales.$inferSelect;
export type NewSale = typeof sales.$inferInsert;
export type Receivable = typeof receivables.$inferSelect;
export type NewReceivable = typeof receivables.$inferInsert;
