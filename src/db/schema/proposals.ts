import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
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
import { deals } from './pipeline';

/**
 * O produto. "Link web é o produto" (decisão travada) — a proposta é uma página
 * pública lida sem login, e o PDF vem depois.
 *
 * Modelo: uma `proposal` tem N `proposal_options` (o cliente escolhe entre "econômico",
 * "conforto", "premium") e N `proposal_blocks` (voo, hotel, passeio, texto), cada bloco
 * podendo pertencer a uma opção específica ou à proposta inteira (option_id NULL).
 *
 * `proposal_views` é o "sabe quando o cliente abriu": uma linha por abertura.
 *
 * ATENÇÃO ao expor qualquer coisa daqui publicamente: `cost_cents` e `commission_cents`
 * de `proposal_options` NUNCA podem sair para o link público. A leitura pública (S7) é a
 * função `SECURITY DEFINER` `public.proposta_publica(slug)`, em
 * `drizzle/0004_proposta_publica.sql`, com sua PRÓPRIA lista de colunas — nunca essas
 * duas. As Server Actions do construtor (S5/S6, autenticadas) moram em
 * `src/server/proposals.ts` e DEVOLVEM `cost_cents`/`commission_cents` de propósito — quem
 * edita a proposta precisa ver a margem. A separação pública×privada é responsabilidade da
 * função de S7 (`src/server/publicProposals.ts` do lado da aplicação), não desta tabela.
 */

export const proposals = pgTable(
  'proposals',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),

    /**
     * A chave do link que vai pelo WhatsApp. Único GLOBAL, não por tenant: o token é o
     * segredo, e escopo por tenant não faria sentido numa URL sem login.
     */
    publicToken: text('public_token').notNull(),

    title: text('title').notNull(),
    summary: text('summary'),
    status: text('status', {
      enum: ['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired'],
    })
      .notNull()
      .default('draft'),
    currency: text('currency').notNull().default('BRL'),
    coverImageUrl: text('cover_image_url'),
    terms: text('terms'),

    /**
     * Marca congelada no momento do envio. Se o agente trocar de logo amanhã, a proposta
     * que o cliente recebeu ontem continua com a cara de ontem.
     */
    brandSnapshot: jsonb('brand_snapshot').notNull().default(sql`'{}'::jsonb`),

    validUntil: date('valid_until'),
    /** FK criada por ALTER na migration (dependência circular com proposal_options). */
    acceptedOptionId: uuid('accepted_option_id'),

    viewCount: integer('view_count').notNull().default(0),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    firstViewedAt: timestamp('first_viewed_at', { withTimezone: true }),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    declinedAt: timestamp('declined_at', { withTimezone: true }),
    /**
     * Arquivar oculta da lista sem mexer em `status` (que é o estágio comercial, não
     * "a agente ainda quer ver isso na lista"). Coluna nova, `0003_construtor_de_proposta`
     * — mesmo padrão de `contacts.archived_at`.
     */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('proposals_public_token_key').on(t.publicToken),
    index('proposals_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('proposals_tenant_status_idx').on(t.tenantId, t.status),
    index('proposals_deal_id_idx').on(t.dealId),
    index('proposals_accepted_option_id_idx').on(t.acceptedOptionId),
    // A lista do dia a dia filtra "não arquivada" quase sempre — índice parcial serve
    // exatamente essa consulta, igual ao `tasks_tenant_open_due_idx`.
    index('proposals_tenant_active_idx')
      .on(t.tenantId, t.createdAt.desc())
      .where(sql`${t.archivedAt} is null`),
    check(
      'proposals_status_check',
      sql`${t.status} in ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired')`,
    ),
  ],
);

export const proposalOptions = pgTable(
  'proposal_options',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    position: integer('position').notNull().default(0),

    /** Preço ao cliente. Público. */
    priceCents: bigint('price_cents', { mode: 'number' }).notNull().default(0),
    /** Custo do operador. NUNCA público. */
    costCents: bigint('cost_cents', { mode: 'number' }).notNull().default(0),
    /**
     * Comissão. NUNCA pública. Coluna própria em vez de `price - cost` gerado porque o
     * agente às vezes lança comissão de over ou incentivo que não sai dessa conta.
     */
    commissionCents: bigint('commission_cents', { mode: 'number' }).notNull().default(0),

    /** Parcelamento — no Brasil o "em quantas vezes" fecha ou perde a venda. */
    installments: integer('installments'),
    installmentCents: bigint('installment_cents', { mode: 'number' }),

    isRecommended: boolean('is_recommended').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('proposal_options_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('proposal_options_proposal_position_idx').on(t.proposalId, t.position),
    check(
      'proposal_options_price_check',
      sql`${t.priceCents} >= 0 and ${t.costCents} >= 0`,
    ),
  ],
);

export const proposalBlocks = pgTable(
  'proposal_blocks',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    /** NULL = bloco da proposta inteira; preenchido = bloco específico daquela opção. */
    optionId: uuid('option_id').references(() => proposalOptions.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: [
        'text',
        'image',
        'flight',
        'hotel',
        'transfer',
        'tour',
        'cruise',
        'insurance',
        'price_note',
      ],
    }).notNull(),
    position: integer('position').notNull().default(0),
    title: text('title'),
    body: text('body'),
    /**
     * Imagens do bloco. Array de URL (do Vercel Blob em produção, ou `data:` URL no
     * fallback de dev — ver `src/server/storage.ts`), nunca objeto solto: CHECK
     * `jsonb_typeof(images) = 'array'` na migration `0003_construtor_de_proposta`.
     */
    images: jsonb('images').notNull().default(sql`'[]'::jsonb`),
    /** Campos específicos do tipo (nº do voo, diárias, categoria do quarto). */
    content: jsonb('content').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('proposal_blocks_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('proposal_blocks_proposal_position_idx').on(t.proposalId, t.position),
    index('proposal_blocks_option_id_idx').on(t.optionId),
    check(
      'proposal_blocks_kind_check',
      sql`${t.kind} in ('text', 'image', 'flight', 'hotel', 'transfer', 'tour', 'cruise', 'insurance', 'price_note')`,
    ),
    check('proposal_blocks_images_is_array_check', sql`jsonb_typeof(${t.images}) = 'array'`),
  ],
);

/**
 * Uma linha por abertura do link público.
 *
 * `ip_hash` e não `ip`: o IP do cliente do agente é dado pessoal (LGPD) e não precisamos
 * dele em claro — só de saber se duas aberturas vieram do mesmo lugar. Use
 * `blindIndex(ip, 'proposal_view_ip')` de `src/lib/crypto`.
 *
 * `focusedOptionId` ("opção focada") nasce em `0004_proposta_publica`: qual opção o
 * cliente estava olhando quando a visita foi registrada (ex.: rolou até "Premium" e ficou
 * lá) — sinal de intenção de compra que `focused_option_id` guarda por visita, não só o
 * `accepted_option_id` final da proposta. `ON DELETE SET NULL`: apagar a opção não pode
 * apagar histórico de visita.
 */
export const proposalViews = pgTable(
  'proposal_views',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    sessionKey: text('session_key'),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    referrer: text('referrer'),
    country: text('country'),
    durationMs: integer('duration_ms'),
    focusedOptionId: uuid('focused_option_id').references(() => proposalOptions.id, {
      onDelete: 'set null',
    }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('proposal_views_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('proposal_views_proposal_viewed_idx').on(t.proposalId, t.viewedAt.desc()),
    index('proposal_views_focused_option_id_idx').on(t.focusedOptionId),
  ],
);

export type Proposal = typeof proposals.$inferSelect;
export type NewProposal = typeof proposals.$inferInsert;
export type ProposalOption = typeof proposalOptions.$inferSelect;
export type NewProposalOption = typeof proposalOptions.$inferInsert;
export type ProposalBlock = typeof proposalBlocks.$inferSelect;
export type NewProposalBlock = typeof proposalBlocks.$inferInsert;
export type ProposalView = typeof proposalViews.$inferSelect;
export type NewProposalView = typeof proposalViews.$inferInsert;
