import { sql } from 'drizzle-orm';
import {
  bigint,
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
import { contacts } from './people';
import { receivables } from './sales';
import { user } from './auth';

/**
 * `invoices` — a fatura consolidada do contato-empresa (Fase 4b,
 * `drizzle/0023_faturamento_consolidado.sql`).
 *
 * A empresa não quer dez recibos: quer UMA fatura no fim do mês. A fatura consolida as
 * `receivables` de um período (vínculo `receivables.invoice_id`) — e as PARCELAS
 * mantêm os vencimentos delas: a fatura é o documento de cobrança, não a substituição
 * do cronograma. `valor_cents` é a soma gravada no momento da consolidação (fotografia,
 * não re-soma viva).
 *
 * Cobrança: `emitirBoletoDaFatura` cria a cobrança avulsa no Asaas (BOLETO) e grava
 * `asaas_payment_id` + `boleto_url`. O webhook (PAYMENT_RECEIVED/CONFIRMED da cobrança
 * avulsa) dá a baixa: status → 'paga' e as parcelas consolidadas → 'pago' — idempotente
 * pelo uniqueIndex global em `asaas_payment_id` (o Asaas reenvia em retry).
 */

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** RESTRICT: apagar o contato não pode sumir com a fatura emitida. */
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'restrict' }),
    periodoDe: date('periodo_de').notNull(),
    periodoAte: date('periodo_ate').notNull(),
    valorCents: bigint('valor_cents', { mode: 'number' }).notNull().default(0),
    status: text('status', { enum: ['aberta', 'paga', 'cancelada'] })
      .notNull()
      .default('aberta'),
    /** Cobrança avulsa no Asaas. NULL enquanto o boleto não foi emitido. */
    asaasPaymentId: text('asaas_payment_id'),
    /** Link do boleto (`bankSlipUrl`) — o que vai para a agente mandar pro cliente. */
    boletoUrl: text('boleto_url'),
    pagoEm: timestamp('pago_em', { withTimezone: true }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('invoices_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('invoices_contact_id_idx').on(t.contactId),
    // Idempotência do webhook: id Asaas é global, e o reenvio reencontra a MESMA fatura.
    uniqueIndex('invoices_asaas_payment_id_key')
      .on(t.asaasPaymentId)
      .where(sql`${t.asaasPaymentId} is not null`),
    // Uma fatura ABERTA por contato/mês — consolidar o mesmo período duas vezes é
    // erro de clique; fatura paga não bloqueia consolidar o período de novo (parcelas
    // novas do mesmo mês).
    uniqueIndex('invoices_tenant_contact_periodo_key')
      .on(t.contactId, t.periodoDe)
      .where(sql`${t.status} = 'aberta'`),
    check('invoices_status_check', sql`${t.status} in ('aberta', 'paga', 'cancelada')`),
    check('invoices_periodo_check', sql`${t.periodoAte} >= ${t.periodoDe}`),
    check('invoices_valor_check', sql`${t.valorCents} >= 0`),
    check('invoices_pago_em_check', sql`(${t.status} = 'paga') = (${t.pagoEm} is not null)`),
  ],
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
