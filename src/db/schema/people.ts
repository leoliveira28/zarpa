import { sql } from 'drizzle-orm';
import {
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
import { encryptedText } from '../../lib/crypto/encryptedColumn';

/**
 * `contacts` é o cliente da agência (quem negocia, quem paga).
 * `travelers` são os passageiros da viagem — nem sempre a mesma pessoa: quem compra a
 * lua de mel dos pais não viaja junto.
 *
 * CPF, passaporte e nascimento são `encryptedText`: no banco fica o envelope
 * `zp1.<key_id>....`, no TypeScript fica `string` em claro. Colunas com sufixo
 * `_encrypted` no SQL para que ninguém olhe o `\d contacts` e ache que é texto puro.
 */

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    whatsapp: text('whatsapp'),

    /** CPF do cliente. Cifrado. */
    document: encryptedText('document_encrypted'),
    /** Data de nascimento, cifrada — por isso `text` e não `date`. */
    birthDate: encryptedText('birth_date_encrypted'),

    source: text('source', {
      enum: ['whatsapp', 'instagram', 'indicacao', 'site', 'evento', 'outro'],
    }),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    notes: text('notes'),

    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('contacts_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('contacts_tenant_name_idx').on(t.tenantId, sql`lower(${t.name})`),
    index('contacts_tenant_phone_idx').on(t.tenantId, t.phone),
    uniqueIndex('contacts_tenant_email_key')
      .on(t.tenantId, sql`lower(${t.email})`)
      .where(sql`${t.email} is not null`),
    check(
      'contacts_source_check',
      sql`${t.source} is null or ${t.source} in ('whatsapp', 'instagram', 'indicacao', 'site', 'evento', 'outro')`,
    ),
  ],
);

export const travelers = pgTable(
  'travelers',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    kind: text('kind', { enum: ['adult', 'child', 'infant'] })
      .notNull()
      .default('adult'),

    cpf: encryptedText('cpf_encrypted'),
    passportNumber: encryptedText('passport_number_encrypted'),
    /** Validade do passaporte NÃO é sensível e é consultável — fica em claro, como `date`. */
    passportExpiresOn: date('passport_expires_on'),
    birthDate: encryptedText('birth_date_encrypted'),

    nationality: text('nationality').notNull().default('BR'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('travelers_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('travelers_contact_id_idx').on(t.contactId),
    check('travelers_kind_check', sql`${t.kind} in ('adult', 'child', 'infant')`),
  ],
);

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Traveler = typeof travelers.$inferSelect;
export type NewTraveler = typeof travelers.$inferInsert;
