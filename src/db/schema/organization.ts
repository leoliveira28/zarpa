import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { user } from './auth';

/**
 * Tabelas do plugin `organization` do Better Auth (Fase 3 — multiusuário).
 *
 * A identidade central da Fase 3 mora na FK da primeira tabela: **o id da organization
 * É o id de `tenants`**. Não existem dois conceitos de tenant — a organization do
 * Better Auth É o tenant, só o nome da tabela muda. Quem nasce junto é `criarTenant`
 * (`src/server/tenants.ts`), que grava as duas metades na mesma transação.
 *
 * Nomes/colunas espelham o schema do plugin v1.7.2 (`organization/schema.mjs`): ids
 * `text`, `createdAt` obrigatório, `metadata` como string JSON (o adapter serializa).
 * EXCEÇÃO de tipo: `organization.id` e os `organization_id` são `uuid` — o id da
 * organization É o uuid de `tenants`, e o Postgres não implementa FK `text`→`uuid`
 * (medido: "foreign key constraint cannot be implemented"). A identidade declarada na
 * FK manda mais que a convenção do plugin, e o adapter trata uuid como string do mesmo
 * jeito. Os ids que o PLUGIN gera (`member.id`, `invitation.id`, `user_id`,
 * `inviter_id`, `team_id`) continuam `text`. `invitation.team_id` existe porque o modo
 * `teams` escreve nela — o modo está DESLIGADO (§9 do doc: fora de propósito), a coluna
 * fica nula.
 *
 * Papéis: os NATIVOS do plugin (`owner`/`admin`/`member`), com CHECK no banco. "Agente"
 * é rótulo de interface — nunca valor gravado. `createAccessControl()` ficou fora de
 * propósito: três papéis chegam para 2–4 pessoas; customizar é complexidade de ERP.
 *
 * RLS (mesma migration, `drizzle/0019_multiusuario.sql`): ENABLE+FORCE com DUAS
 * policies por tabela, no padrão de `user`/`session` da 0000 —
 *
 *   - `*_auth_service`: o canal do plugin (`authDb`, `app.auth_context=on`), que
 *     precisa ver convite/membership antes de existir contexto de tenant;
 *   - `*_isolation`: o canal da aplicação. Como estas tabelas NÃO têm `tenant_id`, o
 *     isolamento passa pela junção com `organization` (`organization` compara o próprio
 *     `id`, que é o uuid do tenant). Duplicar `tenant_id` aqui criaria segunda fonte de
 *     verdade — não duplicar é a decisão, não uma omissão.
 */

export const organization = pgTable(
  'organization',
  {
    /** O id de `tenants` — a FK é a declaração da identidade. */
    id: uuid('id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    logo: text('logo'),
    metadata: text('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('organization_slug_key').on(t.slug)],
);

export const member = pgTable(
  'member',
  {
    id: text('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'member'] })
      .notNull()
      .default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('member_organization_id_idx').on(t.organizationId),
    index('member_user_id_idx').on(t.userId),
    uniqueIndex('member_org_user_key').on(t.organizationId, t.userId),
    check('member_role_check', sql`${t.role} in ('owner', 'admin', 'member')`),
  ],
);

export const invitation = pgTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role', { enum: ['owner', 'admin', 'member'] })
      .notNull()
      .default('member'),
    status: text('status', { enum: ['pending', 'accepted', 'rejected', 'canceled'] })
      .notNull()
      .default('pending'),
    /** Coluna do modo `teams` (desligado). O adapter a espera; fica nula. */
    teamId: text('team_id'),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('invitation_organization_id_idx').on(t.organizationId),
    index('invitation_email_idx').on(t.email),
    check(
      'invitation_status_check',
      sql`${t.status} in ('pending', 'accepted', 'rejected', 'canceled')`,
    ),
    check('invitation_role_check', sql`${t.role} in ('owner', 'admin', 'member')`),
  ],
);

export type Organization = typeof organization.$inferSelect;
export type NewOrganization = typeof organization.$inferInsert;
export type Member = typeof member.$inferSelect;
export type NewMember = typeof member.$inferInsert;
export type Invitation = typeof invitation.$inferSelect;
export type NewInvitation = typeof invitation.$inferInsert;
