import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from '../uuid';
import { tenants } from './tenants';

/**
 * Acervo reutilizável do construtor de proposta: um hotel, voo, passeio, seguro ou texto
 * que o agente salva uma vez e reaproveita em várias propostas — sem digitar de novo.
 *
 * `is_global = true` é o acervo da PLATAFORMA: modelos prontos, sem dono, visíveis para
 * todo tenant (ex.: um texto padrão de "política de cancelamento"). `tenant_id` é `NULL`
 * exatamente quando `is_global = true` — o CHECK abaixo (`library_items_global_tenant_check`,
 * na migration) torna as duas coisas inseparáveis: não existe item global com dono, nem
 * item de tenant sem dono.
 *
 * A migration (`drizzle/0003_construtor_de_proposta.sql`) tem QUATRO policies de tenant
 * (select / insert / update / delete, não uma `FOR ALL` só) mais uma quinta,
 * `library_items_platform_service`, que seria o único jeito de escrever um item global sem
 * rodar como superuser — hoje sem nenhum chamador (não existe tela de admin no v1). Ver o
 * comentário no topo da migration para o raciocínio completo, e
 * `src/lib/tenant/withPlatformContext.ts` para o helper.
 *
 * `content`/`details` desta tabela usa o MESMO formato de `proposal_blocks`: `images` é
 * array de URL, `details` é o campo específico do tipo (nº do voo, categoria do quarto).
 * `inserirItemDaBibliotecaComoBloco` (em `src/server/proposals.ts`) copia os dois 1:1 para
 * um bloco novo.
 */
export const libraryItems = pgTable(
  'library_items',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    /** `NULL` só quando `is_global = true`. Nunca escreva um sem checar o outro junto. */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    isGlobal: boolean('is_global').notNull().default(false),
    kind: text('kind', {
      enum: ['text', 'image', 'flight', 'hotel', 'transfer', 'tour', 'cruise', 'insurance'],
    }).notNull(),
    title: text('title').notNull(),
    body: text('body'),
    images: jsonb('images').notNull().default(sql`'[]'::jsonb`),
    details: jsonb('details').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('library_items_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('library_items_global_idx')
      .on(t.isGlobal, t.createdAt.desc())
      .where(sql`${t.isGlobal} = true`),
    check(
      'library_items_kind_check',
      sql`${t.kind} in ('text', 'image', 'flight', 'hotel', 'transfer', 'tour', 'cruise', 'insurance')`,
    ),
    check('library_items_images_is_array_check', sql`jsonb_typeof(${t.images}) = 'array'`),
    check(
      'library_items_global_tenant_check',
      sql`(${t.isGlobal} = true) = (${t.tenantId} is null)`,
    ),
  ],
);

export type LibraryItem = typeof libraryItems.$inferSelect;
export type NewLibraryItem = typeof libraryItems.$inferInsert;
