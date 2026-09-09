import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from '../uuid';
import { tenants } from './tenants';
import { user } from './auth';

/**
 * Perfil comercial do agente (Fase 3, §5 de `docs/MULTIUSUARIO_AGENCIAS.md`).
 *
 * Guarda o que é do NEGÓCIO (papel comercial, comissão padrão), não do login — por isso
 * NÃO entra no schema do Better Auth e sim no domínio, com RLS por `tenant_id` como
 * qualquer tabela de produto. Um perfil por usuário: `user.tenant_id` é NOT NULL, então
 * não existe segundo vínculo a representar — `user_id` é PK.
 *
 * Opcional por desenho: ausência de perfil = comissão padrão 100 (o DEFAULT da coluna
 * e a regra do §5 — o agente fica com toda a comissão prevista; a "casa" já é remunerada
 * pela assinatura do Zarpa). Split diferente é decisão manual por venda
 * (`sales.commission_split_pct`), nunca régua automática aqui.
 */
export const agentProfiles = pgTable(
  'agent_profiles',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    defaultCommissionPct: integer('default_commission_pct').notNull().default(100),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agent_profiles_tenant_idx').on(t.tenantId),
    check(
      'agent_profiles_commission_check',
      sql`${t.defaultCommissionPct} between 0 and 100`,
    ),
  ],
);

export type AgentProfile = typeof agentProfiles.$inferSelect;
export type NewAgentProfile = typeof agentProfiles.$inferInsert;
