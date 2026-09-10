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
  primaryKey,
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
import { costCenters } from './costCenters';

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
    /**
     * Quem vende (Fase 3, `drizzle/0019_multiusuario.sql`). Nullable: estado legítimo
     * em dado antigo/importado. Default de NEGÓCIO é "quem criou" — preenchido pela
     * camada de serviço (`criarNegocio`), não pelo banco. Reatribuir é ação de dono.
     * Visibilidade `own` vs. `tenant` é REGRA DE PRODUTO, fora do RLS por decisão do
     * §4 do doc — o filtro mora nas queries, nunca em policy.
     */
    agentId: text('agent_id').references(() => user.id, { onDelete: 'restrict' }),
    /**
     * Centro de custo (Fase 4a, `drizzle/0022_pj_e_centro_de_custo.sql`) — atributo do
     * deal, nullable: viagem PF não tem centro de custo e nunca terá. É FOTOGRAFADO na
     * venda na conversão (`sales.cost_center_id`), mesma mecânica do `agent_id` acima.
     */
    costCenterId: uuid('cost_center_id').references(() => costCenters.id, {
      onDelete: 'restrict',
    }),
    title: text('title').notNull(),
    destination: text('destination'),
    stage: text('stage', {
      enum: ['novo', 'cotando', 'proposta_enviada', 'negociando', 'ganho', 'perdido'],
    })
      .notNull()
      .default('novo'),
    /**
     * A coluna do funil onde o negócio está (`drizzle/0016_negocio_aponta_para_estagio.sql`).
     *
     * `NOT NULL` no banco, mas OPCIONAL no insert — e o `.default(sql`null`)` abaixo existe
     * só para dizer isso ao TypeScript. Quem preenche não é a aplicação e não é um DEFAULT
     * de coluna (não daria: o valor depende do tenant): é o trigger `deals_estagio_sync`,
     * que resolve `stage_id` a partir de `stage` quando o insert não traz o id. Sem esse
     * `.default`, o `$inferInsert` do Drizzle passaria a EXIGIR `stageId` em todo
     * `insert(deals)` do repositório — inclusive nos testes e no seed, que gravam só o enum
     * e que não são meus para editar.
     *
     * `stage` (o enum) é a PROJEÇÃO desta coluna, mantida pelo mesmo trigger. Ver o
     * cabeçalho da 0016 para o contrato completo dos dois sentidos.
     */
    stageId: uuid('stage_id')
      .notNull()
      .references(() => pipelineStages.id)
      .default(sql`null`),
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
    index('deals_stage_id_idx').on(t.stageId),
    index('deals_tenant_stage_id_idx').on(t.tenantId, t.stageId),
    index('deals_contact_id_idx').on(t.contactId),
    // FK (RESTRICT varre por aqui) e a listagem por vendedor (quebra do §7, escopo own).
    index('deals_agent_id_idx').on(t.agentId),
    index('deals_tenant_agent_idx').on(t.tenantId, t.agentId),
    // FK (RESTRICT) e o relatório "Centros de custo" (Fase 4a).
    index('deals_cost_center_id_idx').on(t.costCenterId),
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

/**
 * `deal_contacts` — os clientes DO negócio (0020, `drizzle/0020_negocio_varios_clientes.sql`).
 *
 * Casal, família, amigos: a viagem tem dois CPFs na cabine e um orçamento só. A fonte de
 * verdade da composição é esta N:N; `deals.contact_id` segue sendo o cliente PRINCIPAL
 * (imutável nesta rodada — relatórios e ranking leem por ele) e a linha `principal = true`
 * desta tabela é o ESPELHO dele: `criarNegocio` planta, o backfill da 0020 plantou o
 * histórico, e o partial unique `deal_contacts_deal_principal_key` garante no BANCO que
 * existe no máximo uma por negócio.
 *
 * PK composta `(deal_id, contact_id)`: a chave real da relação É o par — o índice único
 * que recusa duplicado é a própria PK, e o lado quente ("clientes deste negócio") varre
 * por ela. Sem coluna `id`: nenhum consumidor. Detalhes no comentário de topo da 0020.
 */
export const dealContacts = pgTable(
  'deal_contacts',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    /** RESTRICT: apagar contato não pode sumir com a composição de um negócio vendido. */
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'restrict' }),
    principal: boolean('principal').notNull().default(false),
    /** Ordem de entrada: é como a ficha e a proposta ordenam os secundários. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.dealId, t.contactId] }),
    index('deal_contacts_contact_id_idx').on(t.contactId),
    uniqueIndex('deal_contacts_deal_principal_key')
      .on(t.dealId)
      .where(sql`${t.principal}`),
  ],
);

/**
 * `pipeline_stages` — as colunas do funil, POR TENANT (S15, `drizzle/0015_estagios_do_funil.sql`).
 *
 * Hoje `deals.stage` é enum de texto com CHECK, e `COLUNAS_DO_FUNIL`
 * (`src/server/dealStages.ts`) é lista fixa no servidor: nenhum dos dois é por tenant. Esta
 * tabela é o ALICERCE para o agente renomear/reordenar/criar coluna. **Ela ainda não está
 * ligada a `deals`**: `deals.stage` continua sendo o enum, e `stage_id` (a FK) é migração de
 * outra rodada — ver o topo da 0015 para o caminho documentado.
 *
 * `legacy_stage` é a ponte: guarda o valor do enum (`'novo'`, `'ganho'`…) na linha semeada
 * correspondente. É por ele que a migração futura vai preencher `deals.stage_id` sem
 * adivinhação, e é por ele que `arquivarEstagio` sabe contar negócios de hoje. Estágio
 * criado pelo agente nasce com `legacy_stage` nulo — não existe enum para ele.
 *
 * Invariantes que o BANCO garante: um único estágio ativo `is_won` e um único `is_lost` por
 * tenant (índices únicos parciais), nunca os dois na mesma linha, rótulo não vazio e único
 * entre os ativos. A garantia de que SEMPRE EXISTE um de cada é da camada de serviço:
 * `arquivarEstagio` recusa arquivar fim de funil e nenhuma action apaga linha (só arquiva).
 */
export const pipelineStages = pgTable(
  'pipeline_stages',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Valor correspondente em `deals.stage` — nulo quando o estágio é do agente. */
    legacyStage: text('legacy_stage', {
      enum: ['novo', 'cotando', 'proposta_enviada', 'negociando', 'ganho', 'perdido'],
    }),
    label: text('label').notNull(),
    position: integer('position').notNull().default(0),
    isWon: boolean('is_won').notNull().default(false),
    isLost: boolean('is_lost').notNull().default(false),
    /** Soft: estágio com negócio dentro nunca é apagado, só sai do quadro. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('pipeline_stages_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('pipeline_stages_tenant_position_idx').on(t.tenantId, t.position),
    uniqueIndex('pipeline_stages_tenant_legacy_key')
      .on(t.tenantId, t.legacyStage)
      .where(sql`${t.legacyStage} is not null`),
    uniqueIndex('pipeline_stages_tenant_label_key')
      .on(t.tenantId, sql`lower(${t.label})`)
      .where(sql`${t.archivedAt} is null`),
    uniqueIndex('pipeline_stages_tenant_won_key')
      .on(t.tenantId)
      .where(sql`${t.isWon} and ${t.archivedAt} is null`),
    uniqueIndex('pipeline_stages_tenant_lost_key')
      .on(t.tenantId)
      .where(sql`${t.isLost} and ${t.archivedAt} is null`),
    // 80, não 40: o limite de 40 que a agente vê é do zod nas actions. Ver a 0015.
    check('pipeline_stages_label_check', sql`char_length(btrim(${t.label})) between 1 and 80`),
    check('pipeline_stages_position_check', sql`${t.position} >= 0`),
    check('pipeline_stages_outcome_check', sql`not (${t.isWon} and ${t.isLost})`),
  ],
);

export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type DealContact = typeof dealContacts.$inferSelect;
export type NewDealContact = typeof dealContacts.$inferInsert;
export type PipelineStage = typeof pipelineStages.$inferSelect;
export type NewPipelineStage = typeof pipelineStages.$inferInsert;
