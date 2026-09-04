import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from '../uuid';
import { tenants } from './tenants';

/**
 * Cobrança da assinatura do SaaS (Asaas: Pix + cartão recorrente + boleto).
 *
 * NÃO é o dinheiro da viagem — o valor vendido ao passageiro mora em `deals` e
 * `proposal_options`. Aqui é só o R$ 49/99/199 que o agente paga para usar o produto.
 *
 * `provider` já existe como coluna porque trocar de gateway é caro se o schema assume um.
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
    plan: text('plan', { enum: ['solo', 'pro', 'studio'] }).notNull(),
    status: text('status', {
      enum: ['trialing', 'active', 'past_due', 'canceled', 'expired'],
    })
      .notNull()
      .default('trialing'),
    billingCycle: text('billing_cycle', { enum: ['monthly', 'yearly'] })
      .notNull()
      .default('monthly'),
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
    uniqueIndex('subscriptions_asaas_subscription_key')
      .on(t.asaasSubscriptionId)
      .where(sql`${t.asaasSubscriptionId} is not null`),
    // Um tenant tem no máximo UMA assinatura viva. Histórico de canceladas acumula.
    // O banco garante isso — não a aplicação, que esquece.
    uniqueIndex('subscriptions_one_live_per_tenant')
      .on(t.tenantId)
      .where(sql`${t.status} in ('trialing', 'active', 'past_due')`),
    check('subscriptions_plan_check', sql`${t.plan} in ('solo', 'pro', 'studio')`),
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
