import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * Tabelas do Better Auth, no mesmo Postgres do resto (decisão travada no CLAUDE.md).
 *
 * Nomes no singular porque é o default da lib — mapear nome de tabela é fonte de bug
 * a troco de estética. Ids são `text`: é o que o Better Auth gera, e brigar com isso
 * custa mais do que aceitar.
 *
 * RLS: `user` tem `tenant_id`, então tem policy de isolamento por tenant. `session`,
 * `account` e `verification` não têm `tenant_id`, mas guardam credencial (hash de senha,
 * token de sessão, token de magic link) e por isso também nascem com RLS — com uma única
 * policy, `app.auth_context = 'on'`, que só o cliente de `src/lib/auth/db.ts` liga.
 * Efeito: uma conexão de tenant comum não lê hash de senha de ninguém, nem do próprio dono.
 */

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    /** Um usuário pertence a exatamente um tenant. Multiusuário real ficou fora do v1. */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    role: text('role', { enum: ['owner', 'agent'] })
      .notNull()
      .default('owner'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_email_key').on(t.email),
    index('user_tenant_id_idx').on(t.tenantId),
    check('user_role_check', sql`${t.role} in ('owner', 'agent')`),
  ],
);

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('session_token_key').on(t.token), index('session_user_id_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    /** Hash da senha (scrypt, feito pelo Better Auth). Nunca sai desta tabela. */
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('account_user_id_idx').on(t.userId),
    uniqueIndex('account_provider_account_key').on(t.providerId, t.accountId),
  ],
);

/** Tokens de magic link e de verificação de e-mail. Curta duração, alto valor. */
export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Session = typeof session.$inferSelect;
export type Account = typeof account.$inferSelect;
export type Verification = typeof verification.$inferSelect;
