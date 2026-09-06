import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from '../uuid';
import { tenants } from './tenants';
import { user } from './auth';

/**
 * O recibo de cada importação de planilha.
 *
 * Existe por uma razão só: importação que perde linha em silêncio é pior que importação
 * que falha. Aqui fica gravado quantas linhas o arquivo tinha, quantas viraram contato,
 * quantas atualizaram alguém que já existia, quantas foram ignoradas — e o motivo de cada
 * uma, com o número da linha no arquivo original, para a agente conseguir abrir a planilha
 * e olhar.
 *
 * `report` é jsonb e NÃO recebe PII. Guarda `{ linha, situacao, motivo, nome }`; documento
 * que aparecer vai mascarado (`***8901`), pela mesma regra do `audit_log`.
 */
export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    format: text('format', { enum: ['csv', 'xlsx'] }).notNull(),
    /** O que a detecção concluiu — 'utf-8' ou 'latin1'. Guardado para diagnóstico. */
    encoding: text('encoding').notNull(),
    /** Delimitador detectado (CSV). NULL para XLSX. */
    delimiter: text('delimiter'),
    entity: text('entity', { enum: ['contacts', 'travelers'] })
      .notNull()
      .default('contacts'),
    /** De qual coluna do arquivo saiu cada campo nosso. É o que permite repetir a importação. */
    mapping: jsonb('mapping').notNull().default(sql`'{}'::jsonb`),

    totalRows: integer('total_rows').notNull().default(0),
    createdRows: integer('created_rows').notNull().default(0),
    updatedRows: integer('updated_rows').notNull().default(0),
    skippedRows: integer('skipped_rows').notNull().default(0),

    report: jsonb('report').notNull().default(sql`'[]'::jsonb`),

    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('import_batches_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('import_batches_created_by_idx').on(t.createdBy),
    check('import_batches_format_check', sql`${t.format} in ('csv', 'xlsx')`),
    check('import_batches_entity_check', sql`${t.entity} in ('contacts', 'travelers')`),
  ],
);

export type ImportBatch = typeof importBatches.$inferSelect;
export type NewImportBatch = typeof importBatches.$inferInsert;
