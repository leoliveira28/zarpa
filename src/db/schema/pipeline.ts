import { sql } from 'drizzle-orm';
import {
  bigint,
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
import { contacts } from './people';
import { user } from './auth';
import { proposals } from './proposals';

/**
 * O funil: `deals` (oportunidades), `tasks` (o follow-up que o agente esquece e perde a
 * venda) e `activities` (a linha do tempo).
 *
 * Dinheiro é sempre `bigint` em centavos. Nunca float, nunca `numeric` sem escala definida.
 * `bigint` e não `integer` porque `integer` estoura em R$ 21.474.836,47 — pacote de grupo
 * chega lá.
 */

export const deals = pgTable(
  'deals',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** RESTRICT e não CASCADE: apagar contato não pode sumir com histórico de venda. */
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    destination: text('destination'),
    stage: text('stage', {
      enum: ['novo', 'cotando', 'proposta_enviada', 'negociando', 'ganho', 'perdido'],
    })
      .notNull()
      .default('novo'),
    currency: text('currency').notNull().default('BRL'),

    valueCents: bigint('value_cents', { mode: 'number' }).notNull().default(0),
    costCents: bigint('cost_cents', { mode: 'number' }).notNull().default(0),
    commissionCents: bigint('commission_cents', { mode: 'number' }).notNull().default(0),

    paxAdults: integer('pax_adults').notNull().default(1),
    paxChildren: integer('pax_children').notNull().default(0),

    departureOn: date('departure_on'),
    returnOn: date('return_on'),
    expectedCloseOn: date('expected_close_on'),

    lostReason: text('lost_reason'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('deals_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('deals_tenant_stage_idx').on(t.tenantId, t.stage),
    index('deals_contact_id_idx').on(t.contactId),
    check(
      'deals_stage_check',
      sql`${t.stage} in ('novo', 'cotando', 'proposta_enviada', 'negociando', 'ganho', 'perdido')`,
    ),
    check(
      'deals_dates_check',
      sql`${t.returnOn} is null or ${t.departureOn} is null or ${t.returnOn} >= ${t.departureOn}`,
    ),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    notes: text('notes'),
    /**
     * Texto pronto para colar no WhatsApp — só preenchido em tarefa gerada (régua de
     * follow-up da proposta, S8). `null` em tarefa manual: a agente escreve a própria
     * mensagem, ninguém sugere nada que ela não pediu.
     */
    suggestedMessage: text('suggested_message'),
    kind: text('kind', { enum: ['followup', 'ligar', 'whatsapp', 'email', 'outro'] })
      .notNull()
      .default('followup'),
    /**
     * Quem criou: 'manual' (a agente), ou o alerta/régua que gerou a tarefa. Junto de
     * `dedupeKey` é o que faz o cron ser idempotente — ver a migration 0001.
     * `followup_proposta` (S8): as três tarefas D+2/D+5/D+10 depois do envio.
     */
    source: text('source', {
      enum: [
        'manual',
        'alerta_passaporte',
        'alerta_aniversario',
        'importacao',
        'followup_proposta',
      ],
    })
      .notNull()
      .default('manual'),
    /**
     * Chave determinística da tarefa gerada (ex.: `passaporte:<travelerId>:90`, ou
     * `followup:proposta:<propostaId>:d2`). NULL para tarefa manual. Índice único parcial
     * em (tenant_id, dedupe_key): rodar o cron duas vezes é no-op no BANCO, não por sorte
     * da aplicação.
     */
    dedupeKey: text('dedupe_key'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    doneAt: timestamp('done_at', { withTimezone: true }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tasks_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    // A tela que importa é "o que está aberto e vence quando" — índice parcial serve
    // exatamente essa consulta e não paga por tarefa concluída.
    index('tasks_tenant_open_due_idx')
      .on(t.tenantId, t.dueAt)
      .where(sql`${t.doneAt} is null`),
    index('tasks_deal_id_idx').on(t.dealId),
    index('tasks_contact_id_idx').on(t.contactId),
    index('tasks_created_by_idx').on(t.createdBy),
    uniqueIndex('tasks_tenant_dedupe_key')
      .on(t.tenantId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
    check(
      'tasks_kind_check',
      sql`${t.kind} in ('followup', 'ligar', 'whatsapp', 'email', 'outro')`,
    ),
    check(
      'tasks_source_check',
      sql`${t.source} in ('manual', 'alerta_passaporte', 'alerta_aniversario', 'importacao', 'followup_proposta')`,
    ),
    check('tasks_dedupe_key_check', sql`(${t.source} = 'manual') = (${t.dedupeKey} is null)`),
  ],
);

/**
 * Linha do tempo visível para o agente. NÃO é o `audit_log`: `activities` é produto
 * (o agente lê), `audit_log` é segurança (o agente não edita). Misturar os dois vira
 * um log que ninguém confia e uma timeline que ninguém lê.
 */
export const activities = pgTable(
  'activities',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
    proposalId: uuid('proposal_id').references(() => proposals.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    type: text('type', {
      enum: [
        'note',
        'stage_changed',
        'proposal_sent',
        'proposal_viewed',
        'proposal_accepted',
        'task_done',
        'message',
        'contact_created',
      ],
    }).notNull(),
    body: text('body'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('activities_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('activities_tenant_deal_occurred_idx').on(t.tenantId, t.dealId, t.occurredAt.desc()),
    index('activities_contact_id_idx').on(t.contactId),
    index('activities_proposal_id_idx').on(t.proposalId),
    index('activities_actor_user_id_idx').on(t.actorUserId),
    check(
      'activities_type_check',
      sql`${t.type} in ('note', 'stage_changed', 'proposal_sent', 'proposal_viewed', 'proposal_accepted', 'task_done', 'message', 'contact_created')`,
    ),
  ],
);

export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
