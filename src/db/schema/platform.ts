import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from '../uuid';
import { tenants } from './tenants';
import { user } from './auth';

/**
 * Trilha de auditoria. Append-only **por policy de RLS**, não por convenção:
 * a migration cria policy de SELECT e de INSERT e NÃO cria de UPDATE/DELETE. Sem policy
 * permissiva o comando é negado — inclusive para o dono da tabela, porque o RLS está em
 * FORCE. Log que dá para editar não é log.
 *
 * `metadata` não recebe PII. Se precisar registrar "mudou o CPF", registre que mudou,
 * não o valor. Use `maskDocument` de `src/lib/crypto` se algum identificador tiver
 * mesmo que aparecer.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    /** Ex.: 'contact.created', 'proposal.sent', 'traveler.document_viewed'. */
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    ipHash: text('ip_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('audit_log_tenant_entity_idx').on(t.tenantId, t.entity, t.entityId),
    index('audit_log_actor_user_id_idx').on(t.actorUserId),
  ],
);

export type AuditEntry = typeof auditLog.$inferSelect;
export type NewAuditEntry = typeof auditLog.$inferInsert;
