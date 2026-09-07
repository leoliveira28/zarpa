import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from '../uuid';
import { tenants } from './tenants';

/**
 * S12 — Contas de fornecedor por tenant (Wooba + Infotravel), cotação só.
 *
 * Cada tenant traz a SUA conta de Wooba/Infotravel. As credenciais (API key,
 * agency id, o que o provider pedir) vivem encriptadas com AES-256-GCM — mesma
 * infra de PII de `src/lib/crypto/pii.ts`. A coluna `credentialsCiphertext`
 * carrega o envelope `zp1.<key_id>....` que `encryptPII` devolve; `keyId` é
 * redundante com o `key_id` embutido no envelope (está aqui para rotação).
 *
 * A camada de actions (`src/server/integrations.ts`) encripta com
 * `encryptPII(JSON.stringify(credentials))` na escrita e decripta com
 * `decryptPII` + `JSON.parse` na leitura, sempre dentro de `withTenant`.
 * O ciphertext nunca aparece em log, nunca volta para a interface —
 * `listarIntegracoes` devolve `IntegracaoResumo` sem a coluna.
 *
 * RLS nasce em `drizzle/0011_integracoes.sql` (mesma migration que cria a
 * tabela — regra 1 do CLAUDE.md). O Drizzle não modela policy: se a policy
 * faltar, o vazamento não aparece em nenhum type check, só no teste do Téo.
 *
 * `provider` é text com CHECK (não pgEnum): mesmo padrão de `plans.slug`
 * (`0009`) e `subscriptions.status` (`0000`). O enum vive no SQL e no zod
 * da camada de actions, não no gerador.
 */
export const integrations = pgTable(
  'integrations',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** 'wooba' | 'infotravel'. CHECK no banco; enum no zod das actions. */
    provider: text('provider').notNull(),
    /** Nome que o agente dá, ex. "Minha conta Wooba". 2–100 (barrado pelo zod). */
    label: text('label').notNull(),
    /** Envelope `zp1.<key_id>.<iv>.<tag>.<ct>` de `encryptPII`. Nunca em claro. */
    credentialsCiphertext: text('credentials_ciphertext').notNull(),
    /** Chave que cifrou esta linha — `activeKeyId()` no momento da escrita. */
    keyId: text('key_id').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('integrations_tenant_provider_idx').on(t.tenantId, t.provider),
    index('integrations_tenant_active_idx')
      .on(t.tenantId, t.isActive)
      .where(sql`${t.isActive} = true`),
    index('integrations_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    check('integrations_provider_check', sql`${t.provider} in ('wooba', 'infotravel')`),
  ],
);

export type Integration = typeof integrations.$inferSelect;
export type NewIntegration = typeof integrations.$inferInsert;
