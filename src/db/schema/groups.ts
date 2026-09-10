import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from '../uuid';
import { tenants } from './tenants';
import { contacts } from './people';
import { deals } from './pipeline';

/**
 * `groups` + `group_members` — o pacote com lugares (meta Grupos,
 * `docs/GRUPOS_META.md`, `drizzle/0025_grupos.sql`).
 *
 * O grupo é o PRODUTO que a agente monta antes de vender: "Fátima 2027, 10
 * lugares, voo + hospedagem + transfer". Os quatro números da venda existem em
 * ESCALA DE LUGAR e são FOTOGRAFIA (`*_per_seat_cents` como a agente digitou —
 * juros de cartão e renegociação de fornecedor não reescrevem o fechado, mesma
 * doutrina de `sales`). A ocupação é a N:N com contato (+ negócio opcional),
 * PK composta — um contato é membro uma vez, mudou a quantidade atualiza a
 * linha. O DINHEIRO continua morando em `sales`: grupo é lente, não segunda
 * contabilidade.
 */

export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    destination: text('destination'),
    departureOn: date('departure_on'),
    returnOn: date('return_on'),
    totalSeats: integer('total_seats').notNull(),
    /** O que se vende por lugar. */
    pricePerSeatCents: bigint('price_per_seat_cents', { mode: 'number' }).notNull().default(0),
    /** Voo + hospedagem + transfer — como a agente digitou (fotografia). */
    costPerSeatCents: bigint('cost_per_seat_cents', { mode: 'number' }).notNull().default(0),
    commissionPerSeatCents: bigint('commission_per_seat_cents', { mode: 'number' })
      .notNull()
      .default(0),
    serviceFeePerSeatCents: bigint('service_fee_per_seat_cents', { mode: 'number' })
      .notNull()
      .default(0),
    status: text('status', { enum: ['montando', 'vendendo', 'encerrado'] })
      .notNull()
      .default('montando'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('groups_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    check('groups_title_check', sql`char_length(btrim(${t.title})) between 1 and 200`),
    check('groups_total_seats_check', sql`${t.totalSeats} between 1 and 500`),
    check(
      'groups_valores_check',
      sql`${t.pricePerSeatCents} >= 0 and ${t.costPerSeatCents} >= 0 and ${t.commissionPerSeatCents} >= 0 and ${t.serviceFeePerSeatCents} >= 0`,
    ),
    check(
      'groups_status_check',
      sql`${t.status} in ('montando', 'vendendo', 'encerrado')`,
    ),
    check(
      'groups_datas_check',
      sql`${t.returnOn} is null or ${t.departureOn} is null or ${t.returnOn} >= ${t.departureOn}`,
    ),
  ],
);

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** RESTRICT: apagar o contato não pode sumir com a ocupação do grupo. */
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'restrict' }),
    /** O negócio é opcional (reserva antes de negociação) e SET NULL. */
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
    /** A família do Sr. Antônio ocupa 3 como um bloco. */
    seats: integer('seats').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.contactId] }),
    index('group_members_contact_id_idx').on(t.contactId),
    index('group_members_deal_id_idx').on(t.dealId),
    check('group_members_seats_check', sql`${t.seats} between 1 and 50`),
  ],
);

export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type GroupMember = typeof groupMembers.$inferSelect;
export type NewGroupMember = typeof groupMembers.$inferInsert;
