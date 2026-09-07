import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from '../uuid';

/**
 * S11 — Catálogo de planos do SaaS (Solo R$ 49 / Pro R$ 99 / Studio R$ 199).
 *
 * Tabela GLOBAL (sem `tenant_id`): é catálogo, como `user`/`session` do Better Auth.
 * A migration `0009_planos_e_assinatura.sql` faz o seed dos 3 planos e deixa
 * `ON CONFLICT (slug) DO NOTHING` para ser re-entrante.
 *
 * RLS: `ENABLE` + `FORCE` + policy `plans_read USING (true)` — leitura liberada a
 * qualquer conexão (preço de plano é dado público). Sem `WITH CHECK`: escrita
 * negada sob RLS para o role da aplicação (NOBYPASSRLS). O seed roda na migration
 * como superuser, que bypassa RLS mesmo com FORCE.
 *
 * `subscriptions` (em `./money.ts`) ganha `planId` FK -> `plans`. O `plan` enum
 * text preexistente em `subscriptions` permanece como fallback — a camada de
 * actions prefere `planId` quando presente.
 */

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    /** 'solo' | 'pro' | 'studio'. Unique. */
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** Preço mensal em centavos. Solo 4900, Pro 9900, Studio 19900. */
    priceCents: bigint('price_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('BRL'),
    description: text('description'),
    /** Array de strings com features do plano (ex.: "10 vendas/mês", "Propostas ilimitadas"). */
    features: jsonb('features').$type<string[]>(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('plans_slug_key').on(t.slug),
    index('plans_active_idx').on(t.isActive).where(sql`${t.isActive} = true`),
    check('plans_slug_check', sql`${t.slug} in ('solo', 'pro', 'studio')`),
    check('plans_currency_check', sql`${t.currency} in ('BRL')`),
    check('plans_price_check', sql`${t.priceCents} >= 0`),
  ],
);

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
