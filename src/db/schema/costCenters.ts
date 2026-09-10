import { sql } from 'drizzle-orm';
import {
  check,
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

/**
 * `cost_centers` — centros de custo do tenant (Fase 4a, `drizzle/0022_pj_e_centro_de_custo.sql`).
 *
 * A firma de 5–50 pessoas que o agente atende às vezes paga por SETOR (diretoria,
 * marketing). Centro de custo é a etiqueta dessa divisão: LISTA PLANA do tenant — não é
 * por empresa, não tem hierarquia, não tem rateio (§6 do plano da Fase 4). É atributo do
 * deal (`deals.cost_center_id`, nullable — viagem PF não tem centro de custo e nunca
 * terá) e FOTOGRAFADO na venda na conversão (`sales.cost_center_id`, mesma mecânica do
 * `agent_id` da Fase 3).
 *
 * Molde `pipeline_stages` (0015): tabela por tenant com `label`, `position` e
 * `archivedAt` — centro de custo com venda dentro nunca é apagado, só sai da lista.
 */

export const costCenters = pgTable(
  'cost_centers',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    position: integer('position').notNull().default(0),
    /** Soft: centro de custo com venda atribuída nunca é apagado, só sai da lista. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cost_centers_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('cost_centers_tenant_position_idx').on(t.tenantId, t.position),
    uniqueIndex('cost_centers_tenant_label_key')
      .on(t.tenantId, sql`lower(${t.label})`)
      .where(sql`${t.archivedAt} is null`),
    // 80, não 40: mesmo limite do estágio do funil — o zod das actions também usa 80.
    check('cost_centers_label_check', sql`char_length(btrim(${t.label})) between 1 and 80`),
    check('cost_centers_position_check', sql`${t.position} >= 0`),
  ],
);

export type CostCenter = typeof costCenters.$inferSelect;
export type NewCostCenter = typeof costCenters.$inferInsert;
