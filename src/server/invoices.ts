'use server';

import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, deals, invoices, receivables, sales } from '@/db/schema';
import { withTenant } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { registrarAuditoria } from './audit';
import { exigirContaAtiva } from './subscriptionGate';
import { criarCobrancaAsaas, criarClienteAsaas } from '@/lib/asaas/client';
import { apenasDigitos } from './normalize';

/**
 * Faturamento consolidado (Fase 4b, `drizzle/0023_faturamento_consolidado.sql`).
 *
 * A empresa não quer dez recibos: quer UMA fatura no fim do mês. O fluxo do §7 do
 * plano fecha aqui:
 *
 *   `criarFatura`          → consolida as parcelas PENDENTES do período da empresa
 *                            (vínculo `receivables.invoice_id`; a parcela mantém o
 *                            vencimento dela — a fatura é o documento, não o cronograma)
 *   `emitirBoletoDaFatura` → cobrança avulsa no Asaas (BOLETO) para o customer real do
 *                            contato — documento decifrado com auditoria, customer
 *                            criado UMA vez e cacheado em `contacts.asaas_customer_id`
 *   webhook                → PAYMENT_RECEIVED/CONFIRMED da cobrança avulsa dá a baixa
 *                            automática (`processarWebhookAsaas`, em `billing.ts`)
 *
 * Padrão de sempre: `requireAuthContext()` → `withTenant` → zod antes do banco →
 * `ServiceResult`. Escrita passa por `exigirContaAtiva` (gate de dunning — é escrita
 * na agência, não leitura).
 */

export type FaturaDoCliente = {
  id: string;
  contactId: string;
  contactName: string;
  /** `AAAA-MM-DD`. */
  periodoDe: string;
  periodoAte: string;
  valorCents: number;
  status: 'aberta' | 'paga' | 'cancelada';
  /** Boleta emitida? (`asaas_payment_id` preenchido.) */
  boletoEmitido: boolean;
  boletoUrl: string | null;
  pagoEm: Date | null;
  /** Quantas parcelas a fatura consolidou. */
  totalParcelas: number;
  createdAt: Date;
};

export type DetalheDaFaturaDoCliente = FaturaDoCliente & {
  parcelas: Array<{
    id: string;
    venceEm: string;
    valorCents: number;
    status: 'pendente' | 'pago' | 'atrasado' | 'cancelado';
    /** Viagem de origem da parcela — a ficha da fatura diz de onde veio cada linha. */
    dealTitle: string | null;
  }>;
};

const criarInput = z.object({
  contactId: z.uuid('Escolha a empresa'),
  /** Período de vencimento das parcelas consolidadas (`AAAA-MM-DD`). */
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD'),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD'),
});
export type CriarFaturaInput = z.infer<typeof criarInput>;

const boletoInput = z.object({
  faturaId: z.uuid('Fatura inválida'),
  /** Vencimento do boleto. Omitido: 7 dias a partir de hoje. */
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type EmitirBoletoInput = z.infer<typeof boletoInput>;

function validar<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const primeiro = parsed.error.issues[0];
    throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
      campo: primeiro?.path.join('.'),
      correcao: 'Corrigir e tentar de novo',
    });
  }
  return parsed.data;
}

/** Colunas de leitura da fatura (o join com o nome da empresa é constante em toda tela). */
const COLUNAS_FATURA = {
  id: invoices.id,
  contactId: invoices.contactId,
  contactName: contacts.name,
  periodoDe: invoices.periodoDe,
  periodoAte: invoices.periodoAte,
  valorCents: invoices.valorCents,
  status: invoices.status,
  boletoEmitido: sql<boolean>`${invoices.asaasPaymentId} is not null`,
  boletoUrl: invoices.boletoUrl,
  pagoEm: invoices.pagoEm,
  createdAt: invoices.createdAt,
} as const;

/**
 * Consolida o período da empresa: procura parcelas PENDENTES (por vencimento, de
 * negócios cujo TITULAR é o contato — mesma gramática do ranking), cria a fatura com
 * a soma e marca as parcelas com `invoice_id`. Parcela já faturada ou paga NUNCA entra
 * — consolidar duas vezes é no-op pelo `invoice_id is null`.
 */
export async function criarFatura(
  input: CriarFaturaInput,
): Promise<ServiceResult<FaturaDoCliente>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(criarInput, input);
    if (dados.ate < dados.de) {
      throw new ServiceError('DADOS_INVALIDOS', 'O fim do período é antes do começo.', {
        campo: 'ate',
        correcao: 'Corrigir o período',
      });
    }

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);

      const [empresa] = await tx
        .select({ id: contacts.id, name: contacts.name })
        .from(contacts)
        .where(eq(contacts.id, dados.contactId))
        .limit(1);
      if (!empresa) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse contato não existe mais.', {
          correcao: 'Voltar para a lista',
        });
      }

      // Uma fatura ABERTA por contato/período-de — o uniqueIndex parcial do banco
      // garante; a checagem dá a mensagem da casa em vez do 23505.
      const [aberta] = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.tenantId, tenantId),
            eq(invoices.contactId, dados.contactId),
            eq(invoices.status, 'aberta'),
            eq(invoices.periodoDe, dados.de),
          ),
        )
        .limit(1);
      if (aberta) {
        throw new ServiceError(
          'CONFLITO',
          'Já existe uma fatura aberta para esta empresa neste período.',
          { correcao: 'Emitir o boleto dela ou cancelar antes de consolidar de novo' },
        );
      }

      // As parcelas do período — pendentes, sem fatura, da empresa em questão
      // (negócios cujo TITULAR é o contato — mesma gramática do ranking).
      const parcelas = await tx
        .select({
          id: receivables.id,
          valorCents: receivables.valorCents,
        })
        .from(receivables)
        .innerJoin(sales, eq(sales.id, receivables.saleId))
        .innerJoin(deals, eq(deals.id, sales.dealId))
        .where(
          and(
            eq(receivables.tenantId, tenantId),
            eq(receivables.status, 'pendente'),
            isNull(receivables.invoiceId),
            gte(receivables.venceEm, dados.de),
            lte(receivables.venceEm, dados.ate),
            eq(deals.contactId, dados.contactId),
          ),
        )
        .orderBy(asc(receivables.venceEm));

      if (parcelas.length === 0) {
        throw new ServiceError(
          'DADOS_INVALIDOS',
          'Não há parcelas pendentes desta empresa neste período.',
          {
            correcao: 'Conferir o período (as parcelas são escolhidas pelo VENCIMENTO)',
          },
        );
      }

      const soma = parcelas.reduce((total, p) => total + p.valorCents, 0);

      const [fatura] = await tx
        .insert(invoices)
        .values({
          tenantId,
          contactId: dados.contactId,
          periodoDe: dados.de,
          periodoAte: dados.ate,
          valorCents: soma,
          createdBy: userId,
        })
        .returning();

      // O vínculo é a verdade da consolidação — a soma da fatura e o conjunto de
      // parcelas não podem se desencontrar (mesma transação).
      await tx
        .update(receivables)
        .set({ invoiceId: fatura!.id, updatedAt: new Date() })
        .where(
          sql`${receivables.id} in (${sql.join(
            parcelas.map((p) => sql`${p.id}::uuid`),
            sql`, `,
          )})`,
        );

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'invoice.created',
        entity: 'invoice',
        entityId: fatura!.id,
        metadata: { contactId: dados.contactId, parcelas: parcelas.length, valorCents: soma },
      });

      return {
        id: fatura!.id,
        contactId: fatura!.contactId,
        contactName: empresa.name,
        periodoDe: fatura!.periodoDe,
        periodoAte: fatura!.periodoAte,
        valorCents: fatura!.valorCents,
        status: fatura!.status,
        boletoEmitido: false,
        boletoUrl: null,
        pagoEm: null,
        totalParcelas: parcelas.length,
        createdAt: fatura!.createdAt,
      } as FaturaDoCliente;
    });
  });
}

/** As faturas do tenant — mais recente primeiro, filtráveis por empresa. */
export async function listarFaturasDoCliente(
  filtro?: { contactId?: string },
): Promise<ServiceResult<FaturaDoCliente[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const condicoes = [eq(invoices.tenantId, tenantId)];
      if (filtro?.contactId) condicoes.push(eq(invoices.contactId, filtro.contactId));

      const linhas = await tx
        .select(COLUNAS_FATURA)
        .from(invoices)
        .innerJoin(contacts, eq(contacts.id, invoices.contactId))
        .where(and(...condicoes))
        .orderBy(desc(invoices.createdAt))
        .limit(100);

      return Promise.all(
        linhas.map(async (linha) => ({
          ...linha,
          totalParcelas: await contarParcelas(tx, tenantId, linha.id),
        })),
      ) as Promise<FaturaDoCliente[]>;
    });
  });
}

export async function obterFatura(faturaId: string): Promise<ServiceResult<DetalheDaFaturaDoCliente>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const [fatura] = await tx
        .select(COLUNAS_FATURA)
        .from(invoices)
        .innerJoin(contacts, eq(contacts.id, invoices.contactId))
        .where(and(eq(invoices.id, faturaId), eq(invoices.tenantId, tenantId)))
        .limit(1);
      if (!fatura) {
        throw new ServiceError('NAO_ENCONTRADO', 'Fatura não encontrada.');
      }

      const parcelas = await tx
        .select({
          id: receivables.id,
          venceEm: receivables.venceEm,
          valorCents: receivables.valorCents,
          status: receivables.status,
          dealTitle: deals.title,
        })
        .from(receivables)
        .innerJoin(sales, eq(sales.id, receivables.saleId))
        .innerJoin(deals, eq(deals.id, sales.dealId))
        .where(eq(receivables.invoiceId, faturaId))
        .orderBy(asc(receivables.venceEm));

      return {
        ...fatura,
        totalParcelas: parcelas.length,
        parcelas: parcelas.map((p) => ({
          id: p.id,
          venceEm: p.venceEm,
          valorCents: p.valorCents,
          status: p.status,
          dealTitle: p.dealTitle,
        })),
      } as DetalheDaFaturaDoCliente;
    });
  });
}

/**
 * Emite o boleto da fatura aberta: customer real do contato (documento decifrado COM
 * auditoria — a mesma leitura sensível de `obterDocumentoDoContato`), cobrança avulsa
 * BOLETO no Asaas, e o vínculo (`asaas_payment_id`) gravado — que é o que o webhook
 * usa para a baixa automática. Idempotente: fatura com boleto já emitido devolve o
 * estado atual, não emite de novo.
 */
export async function emitirBoletoDaFatura(
  input: EmitirBoletoInput,
): Promise<ServiceResult<FaturaDoCliente>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(boletoInput, input);

    const vencimento =
      dados.vencimento ??
      // Sem data: daqui a 7 dias. Determinístico a partir da data UTC (mesma convenção
      // de `viagens.ts`/`dashboard.ts`).
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);

      const [fatura] = await tx
        .select(COLUNAS_FATURA)
        .from(invoices)
        .innerJoin(contacts, eq(contacts.id, invoices.contactId))
        .where(and(eq(invoices.id, dados.faturaId), eq(invoices.tenantId, tenantId)))
        .limit(1);
      if (!fatura) throw new ServiceError('NAO_ENCONTRADO', 'Fatura não encontrada.');
      if (fatura.status !== 'aberta') {
        throw new ServiceError('CONFLITO', `Esta fatura já está ${fatura.status}.`, {
          correcao: 'Nada a emitir',
        });
      }

      // Boleta já emitida: devolve o estado, não emite de novo (o reenvio do clique
      // duplo não pode gerar duas cobranças no Asaas).
      if (fatura.boletoEmitido) {
        return { ...fatura, totalParcelas: await contarParcelas(tx, tenantId, fatura.id) } as FaturaDoCliente;
      }

      const [contato] = await tx
        .select({
          name: contacts.name,
          email: contacts.email,
          document: contacts.document,
          asaasCustomerId: contacts.asaasCustomerId,
        })
        .from(contacts)
        .where(eq(contacts.id, fatura.contactId))
        .limit(1);
      if (!contato) throw new ServiceError('NAO_ENCONTRADO', 'Esse contato não existe mais.');

      // O e-mail é obrigatório no Asaas — sem ele a recusa é aqui, com o conserto.
      if (!contato.email) {
        throw new ServiceError(
          'DADOS_INVALIDOS',
          'A empresa precisa de um e-mail cadastrado para receber o boleto.',
          { campo: 'email', correcao: 'Cadastrar o e-mail na ficha do contato' },
        );
      }
      if (!contato.document) {
        throw new ServiceError(
          'DADOS_INVALIDOS',
          'A empresa precisa de um CNPJ cadastrado para emitir o boleto.',
          { campo: 'document', correcao: 'Cadastrar o CNPJ na ficha do contato' },
        );
      }

      // Decifra o documento COM auditoria — leitura sensível com rastro (mesma action
      // que a ficha grava; o banco de auditoria não distingue tela de emissão).
      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'contact.document_viewed',
        entity: 'contact',
        entityId: fatura.contactId,
      });
      const cpfCnpj = apenasDigitos(contato.document);
      if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
        throw new ServiceError(
          'DADOS_INVALIDOS',
          'O documento cadastrado não é um CPF nem um CNPJ válido.',
          { campo: 'document', correcao: 'Conferir o documento na ficha do contato' },
        );
      }

      // Customer do Asaas: cria UMA vez, cacheia no contato.
      let customerId = contato.asaasCustomerId;
      if (!customerId) {
        const cliente = await criarClienteAsaas({
          name: contato.name,
          email: contato.email,
          cpfCnpj,
        });
        customerId = cliente.asaasCustomerId;
        await tx
          .update(contacts)
          .set({ asaasCustomerId: customerId, updatedAt: new Date() })
          .where(eq(contacts.id, fatura.contactId));
      }

      const cobranca = await criarCobrancaAsaas({
        customerId,
        billingType: 'BOLETO',
        value: fatura.valorCents / 100,
        dueDate: vencimento,
        description: `Fatura ${fatura.periodoDe.slice(0, 7)} — ${contato.name}`,
      });

      const [emitida] = await tx
        .update(invoices)
        .set({ asaasPaymentId: cobranca.asaasPaymentId, boletoUrl: cobranca.boletoUrl, updatedAt: new Date() })
        .where(eq(invoices.id, fatura.id))
        .returning();

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'invoice.boleto_issued',
        entity: 'invoice',
        entityId: fatura.id,
        metadata: { asaasPaymentId: cobranca.asaasPaymentId },
      });

      return {
        ...emitida!,
        contactName: contato.name,
        boletoEmitido: true,
        totalParcelas: await contarParcelas(tx, tenantId, fatura.id),
      } as FaturaDoCliente;
    });
  });
}

/** Contagem de parcelas consolidadas — o card da ficha anuncia "3 viagens nesta fatura". */
async function contarParcelas(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  faturaId: string,
): Promise<number> {
  const [linha] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(receivables)
    .where(and(eq(receivables.tenantId, tenantId), eq(receivables.invoiceId, faturaId)));
  return linha?.total ?? 0;
}
