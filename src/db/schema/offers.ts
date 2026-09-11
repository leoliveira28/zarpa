import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from '../uuid';
import { tenants } from './tenants';
import { groups } from './groups';
import { contacts } from './people';
import { deals } from './pipeline';

/**
 * `offers` — a oferta da Vitrine (Fit 7, `docs/FIT7_VITRINE.md`,
 * `drizzle/0026_ofertas.sql`): o catálogo público do agente que não tem site.
 *
 * `blocks` é FOTOGRAFIA do documento inteiro (mesma forma de
 * `proposal_templates.blocks`: array de blocos kind/title/body/images/content —
 * os MESMOS blocos do construtor de proposta, renderizados pela
 * `PublicBlockSection`). A oferta é editada como um todo e gravada inteira —
 * não existe bloco solto com vida própria, então não há tabela filha.
 *
 * `public_token` é o endereço público (`/a/[slug]/o/[token]`), mesmo desenho de
 * `proposals.public_token`: opaco, global-unique. `published_at`/
 * `unpublished_at` são o interruptor (semântica no serviço). `group_id` SET
 * NULL: a oferta pode SER um grupo com lugares — o catálogo mostra "restam N"
 * pela ocupação do grupo. O DINHEIRO real continua em `sales`; `price_cents`
 * é o preço público, fotografia.
 */
export const offers = pgTable(
  'offers',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    type: text('type', {
      enum: ['pacote', 'voo', 'hospedagem', 'transfer', 'servico'],
    }).notNull(),
    priceCents: bigint('price_cents', { mode: 'number' }).notNull().default(0),
    summary: text('summary'),
    coverUrl: text('cover_url'),
    blocks: jsonb('blocks').notNull().default(sql`'[]'::jsonb`),
    publicToken: text('public_token').notNull(),
    position: integer('position').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    unpublishedAt: timestamp('unpublished_at', { withTimezone: true }),
    groupId: uuid('group_id').references(() => groups.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('offers_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    uniqueIndex('offers_public_token_key').on(t.publicToken),
    index('offers_tenant_published_idx')
      .on(t.tenantId, t.position)
      .where(sql`${t.publishedAt} is not null`),
    check('offers_title_check', sql`char_length(btrim(${t.title})) between 1 and 200`),
    check(
      'offers_type_check',
      sql`${t.type} in ('pacote', 'voo', 'hospedagem', 'transfer', 'servico')`,
    ),
    check('offers_price_check', sql`${t.priceCents} >= 0`),
    check('offers_blocks_is_array_check', sql`jsonb_typeof(${t.blocks}) = 'array'`),
  ],
);

export type Offer = typeof offers.$inferSelect;
export type NewOffer = typeof offers.$inferInsert;

/**
 * `offer_leads` — o interessado de uma oferta da Vitrine (Fit 7b,
 * `drizzle/0027_interesse_ofertas.sql`). Nome + WhatsApp capturados na página
 * pública: o contato é REUSADO quando o WhatsApp já é cliente da casa, e a
 * linha é idempotente por (oferta, contato) — duplo toque não duplica.
 * `ip_hash` alimenta o throttle da action. Escrita SEMPRE via `withTenant`
 * (a action descobre o tenant pela oferta publicada); isolamento padrão.
 */
export const offerLeads = pgTable(
  'offer_leads',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    whatsapp: text('whatsapp'),
    ipHash: text('ip_hash'),
    /**
     * O negócio criado a partir do interesse (Fit 7c, 0028) — `null` enquanto
     * o lead não foi trabalhado. SET NULL: apagar o negócio devolve o lead a
     * "não trabalhado". Unique parcial: um lead vira negócio UMA vez.
     */
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('offer_leads_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('offer_leads_offer_id_idx').on(t.offerId),
    index('offer_leads_deal_id_idx').on(t.dealId),
    uniqueIndex('offer_leads_deal_key').on(t.dealId).where(sql`${t.dealId} is not null`),
    uniqueIndex('offer_leads_offer_contact_key').on(t.offerId, t.contactId),
    check(
      'offer_leads_whatsapp_check',
      sql`${t.whatsapp} is null or char_length(${t.whatsapp}) between 8 and 20`,
    ),
  ],
);

export type OfferLead = typeof offerLeads.$inferSelect;
export type NewOfferLead = typeof offerLeads.$inferInsert;
