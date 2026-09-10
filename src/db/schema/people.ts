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
    /**
     * Pessoa física (cliente de sempre) ou jurídica — a EMPRESA que paga (Fase 4a,
     * `drizzle/0022_pj_e_centro_de_custo.sql`). A empresa é UM contato: `name` guarda a
     * razão social e `document` o CNPJ (mesma coluna cifrada, mesmo índice cego — 14
     * dígitos deduplicam pela mesma máquina). Os FUNCIONÁRIOS que viajam continuam
     * sendo `travelers` do contato-empresa, e uma viagem da empresa é um deal cujo
     * titular é ela. PJ não é auth: a organization é a agência, nunca o cliente.
     */
    personType: text('person_type', { enum: ['fisica', 'juridica'] })
      .notNull()
      .default('fisica'),
    email: text('email'),
    phone: text('phone'),
    whatsapp: text('whatsapp'),

    /** CPF do cliente. Cifrado. */
    document: encryptedText('document_encrypted'),
    /** Data de nascimento, cifrada — por isso `text` e não `date`. */
    birthDate: encryptedText('birth_date_encrypted'),

    /**
     * Índice cego do CPF: HMAC determinístico com chave derivada por tenant. É o que
     * permite `WHERE document_hash = ?` num campo cifrado com IV aleatório. Escrito
     * SEMPRE junto de `document` — há CHECK no banco garantindo isso. Ver
     * `src/lib/crypto/blindIndex.ts` para a implicação de segurança.
     */
    documentHash: text('document_hash'),
    /** Qual chave gerou o hash acima. Sem isto, rotação de chave cega a busca. */
    documentHashKeyId: text('document_hash_key_id'),
    /** `MM-DD` em claro, para o alerta de aniversário. O ANO fica só em `birthDate`. */
    birthMonthDay: text('birth_month_day'),

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
    index('contacts_tenant_person_type_idx').on(t.tenantId, t.personType),
    uniqueIndex('contacts_tenant_email_key')
      .on(t.tenantId, sql`lower(${t.email})`)
      .where(sql`${t.email} is not null`),
    uniqueIndex('contacts_tenant_document_hash_key')
      .on(t.tenantId, t.documentHash)
      .where(sql`${t.documentHash} is not null`),
    index('contacts_tenant_birthday_idx')
      .on(t.tenantId, t.birthMonthDay)
      .where(sql`${t.birthMonthDay} is not null`),
    check(
      'contacts_source_check',
      sql`${t.source} is null or ${t.source} in ('whatsapp', 'instagram', 'indicacao', 'site', 'evento', 'outro')`,
    ),
    check(
      'contacts_person_type_check',
      sql`${t.personType} in ('fisica', 'juridica')`,
    ),
    check(
      'contacts_birth_month_day_check',
      sql`${t.birthMonthDay} is null or ${t.birthMonthDay} ~ '^[0-1][0-9]-[0-3][0-9]$'`,
    ),
    check(
      'contacts_document_hash_check',
      sql`(${t.document} is null) = (${t.documentHash} is null) and (${t.documentHash} is null) = (${t.documentHashKeyId} is null)`,
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

    /** Índice cego do CPF do passageiro. Mesmas regras de `contacts.documentHash`. */
    cpfHash: text('cpf_hash'),
    cpfHashKeyId: text('cpf_hash_key_id'),
    /** `MM-DD` em claro, para o alerta de aniversário. */
    birthMonthDay: text('birth_month_day'),

    nationality: text('nationality').notNull().default('BR'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('travelers_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('travelers_contact_id_idx').on(t.contactId),
    uniqueIndex('travelers_tenant_cpf_hash_key')
      .on(t.tenantId, t.cpfHash)
      .where(sql`${t.cpfHash} is not null`),
    index('travelers_tenant_passport_expires_idx')
      .on(t.tenantId, t.passportExpiresOn)
      .where(sql`${t.passportExpiresOn} is not null`),
    index('travelers_tenant_birthday_idx')
      .on(t.tenantId, t.birthMonthDay)
      .where(sql`${t.birthMonthDay} is not null`),
    check('travelers_kind_check', sql`${t.kind} in ('adult', 'child', 'infant')`),
    check(
      'travelers_birth_month_day_check',
      sql`${t.birthMonthDay} is null or ${t.birthMonthDay} ~ '^[0-1][0-9]-[0-3][0-9]$'`,
    ),
    check(
      'travelers_cpf_hash_check',
      sql`(${t.cpf} is null) = (${t.cpfHash} is null) and (${t.cpfHash} is null) = (${t.cpfHashKeyId} is null)`,
    ),
  ],
);

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type Traveler = typeof travelers.$inferSelect;
export type NewTraveler = typeof travelers.$inferInsert;
