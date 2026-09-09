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
import { plans } from './plans';

/**
 * Cobrança da assinatura do SaaS (Asaas: Pix + cartão recorrente + boleto).
 *
 * NÃO é o dinheiro da viagem — o valor vendido ao passageiro mora em `deals` e
 * `proposal_options`. Aqui é só o R$ 49/99/199 que o agente paga para usar o produto.
 *
 * `provider` já existe como coluna porque trocar de gateway é caro se o schema assume um.
 *
 * S11: `subscriptions` ganha `planId` FK -> `plans` (catálogo em `./plans.ts`). O `plan`
 * enum text preexistente permanece como fallback. `payments` é a tabela que o contrato
 * S11 chama de `invoices` — mesma semântica, já com RLS e idempotência em `asaas_payment_id`.
 * A camada de actions (`src/server/billing.ts`) expõe `listarFaturas()` lendo de `payments`.
 */

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('asaas'),
    asaasCustomerId: text('asaas_customer_id'),
    asaasSubscriptionId: text('asaas_subscription_id'),
    /**
     * Plano da assinatura (enum text, preexistente desde `0000_fundacao`). Mantido
     * como fallback — a camada de actions prefere `planId` (FK -> `plans`) quando
     * presente e cai para `plan` se `planId` for nulo. `plan` nunca fica dessincronizado
     * de `planId` em novas escritas: `trocarPlano` seta os dois juntos.
     */
    plan: text('plan', { enum: ['solo', 'pro', 'studio'] }).notNull(),
    /**
     * FK -> `plans`. Nullable: rows pré-0009 não têm o vínculo. S11 passa a setar
     * este campo em toda troca/cancelamento. `ON DELETE SET NULL`: apagar um plano
     * do catálogo não pode sumir com a assinatura do agente.
     */
    planId: uuid('plan_id').references(() => plans.id, { onDelete: 'set null' }),
    status: text('status', {
      enum: ['trialing', 'active', 'past_due', 'canceled', 'expired'],
    })
      .notNull()
      .default('trialing'),
    billingCycle: text('billing_cycle', { enum: ['monthly', 'yearly'] })
      .notNull()
      .default('monthly'),
    /**
     * Assentos PAGOS do tenant (Fase 3, `drizzle/0019_multiusuario.sql`). Nunca zero —
     * o owner ocupa o assento de origem: 1 em Solo/Pro, 3 no Studio (inclusos no
     * R$ 199). Alimenta o `membershipLimit` dinâmico do plugin `organization` (o
     * convite N+1 é recusado pela própria lib quando o assento não foi pago — o gate
     * de billing de graça) e o recálculo de valor no cancelar+recriar do Asaas
     * (`alterarAssentos`, `src/server/billing.ts`).
     */
    seatsPaid: integer('seats_paid').notNull().default(1),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currentPeriodStart: date('current_period_start'),
    currentPeriodEnd: date('current_period_end'),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('subscriptions_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('subscriptions_plan_id_idx').on(t.planId),
    uniqueIndex('subscriptions_asaas_subscription_key')
      .on(t.asaasSubscriptionId)
      .where(sql`${t.asaasSubscriptionId} is not null`),
    // Um tenant tem no máximo UMA assinatura viva. Histórico de canceladas acumula.
    // O banco garante isso — não a aplicação, que esquece.
    uniqueIndex('subscriptions_one_live_per_tenant')
      .on(t.tenantId)
      .where(sql`${t.status} in ('trialing', 'active', 'past_due')`),
    check('subscriptions_plan_check', sql`${t.plan} in ('solo', 'pro', 'studio')`),
    check('subscriptions_seats_check', sql`${t.seatsPaid} >= 1`),
    check(
      'subscriptions_status_check',
      sql`${t.status} in ('trialing', 'active', 'past_due', 'canceled', 'expired')`,
    ),
    check('subscriptions_cycle_check', sql`${t.billingCycle} in ('monthly', 'yearly')`),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    provider: text('provider').notNull().default('asaas'),
    asaasPaymentId: text('asaas_payment_id'),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    status: text('status', {
      enum: ['pending', 'confirmed', 'received', 'overdue', 'refunded', 'canceled'],
    })
      .notNull()
      .default('pending'),
    method: text('method', { enum: ['pix', 'credit_card', 'boleto'] }),
    dueOn: date('due_on'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    invoiceUrl: text('invoice_url'),
    receiptUrl: text('receipt_url'),
    pixPayload: text('pix_payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('payments_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('payments_subscription_id_idx').on(t.subscriptionId),
    // Chave de idempotência do webhook do Asaas: o mesmo evento chega duas vezes.
    uniqueIndex('payments_asaas_payment_key')
      .on(t.asaasPaymentId)
      .where(sql`${t.asaasPaymentId} is not null`),
    check(
      'payments_status_check',
      sql`${t.status} in ('pending', 'confirmed', 'received', 'overdue', 'refunded', 'canceled')`,
    ),
    check(
      'payments_method_check',
      sql`${t.method} is null or ${t.method} in ('pix', 'credit_card', 'boleto')`,
    ),
  ],
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
