import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, deals, receivables, sales, tenants } from '@/db/schema';
import { withTenant } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { registrarAuditoria } from './audit';
import { assinaturaDaMarca } from '@/lib/assinatura';

/**
 * Dados do recibo de venda — o lado LEITOR da rota `GET /api/recibos/[vendaId]`
 * (fase 1 do roadmap). Este arquivo NÃO é `'use server'` de propósito: não é Server
 * Action, é helper de rota. Uma Server Action devolve dado para o cliente React; um
 * recibo é um ARQUIVO PDF que o navegador baixa — rota GET com os headers certos,
 * linkável e guardável, que é o que "manda pro contador" exige.
 *
 * A rota em si mora em `src/app/api/recibos/[vendaId]/route.ts` — que é fronteira
 * histórica do PO, mas entrou nesta rodada por atribuição do coordenador (o recibo é
 * produto: PDF com a marca do agente). O combinado está em `docs/handoffs/rafa-para-po.md`.
 *
 * Regras da casa preservadas: tenant da SESSÃO (nunca de parâmetro), leitura dentro de
 * `withTenant` (RLS resolve o escopo), gate de dunning NÃO se aplica (leitura), auditoria
 * registra o FATO da emissão — nunca o valor nem dado de cliente (metadata sem PII).
 *
 * NÚMERO DO RECIBO: derivado do id da venda (`REC-` + 8 primeiros caracteres em
 * maiúsculas). Estável de propósito: reimprimir o recibo da mesma venda TEM que sair o
 * mesmo número — recibo com número que muda a cada impressão não serve como comprovante.
 * Não é sequencial de propósito também: numerar sequencialmente exigiria contador
 * compartilhado por tenant e viraria concorrência; o identificador da venda já é único.
 */

export type ParcelaPagaDoRecibo = {
  /** Sequência entre as parcelas pagas, a partir de 1 — ordem de pagamento. */
  numero: number;
  valorCents: number;
  /** `AAAA-MM-DD` do pagamento, ou `null` se a parcela foi marcada paga sem data. */
  pagoEm: string | null;
};

export type DadosDoRecibo = {
  /** `REC-XXXXXXXX` — estável por venda (ver comentário do topo). */
  numero: string;
  /** Momento da CONSULTA (o "emitido em" impresso); reimprimir atualiza a data, não o número. */
  emitidoEm: Date;
  clienteNome: string;
  /** Destino do negócio, ou o título dele quando não há destino. */
  descricao: string;
  currency: string;
  valorTotalCents: number;
  parcelasPagas: ParcelaPagaDoRecibo[];
  /** Linhas da assinatura da marca (`assinaturaDaMarca`) — o recibo assina como a proposta. */
  assinatura: string[];
};

const reciboInput = z.object({ vendaId: z.uuid('Venda inválida.') });

export async function dadosDoRecibo(vendaId: string): Promise<ServiceResult<DadosDoRecibo>> {
  return comoResultado(async () => {
    const parsed = reciboInput.safeParse({ vendaId });
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
        correcao: 'Verificar o link e tentar de novo',
      });
    }

    const { tenantId, userId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
    // A venda e o negócio dela numa linha só — com RLS, venda de outro tenant não
    // aparece aqui e vira o mesmo 404 de "não existe".
    const [linha] = await tx
      .select({
        vendaId: sales.id,
        valorBrutoCents: sales.valorBrutoCents,
        dealId: deals.id,
        titulo: deals.title,
        destino: deals.destination,
        currency: deals.currency,
        clienteNome: contacts.name,
        brandName: tenants.brandName,
        agentDisplayName: tenants.agentDisplayName,
      })
      .from(sales)
      .innerJoin(deals, eq(deals.id, sales.dealId))
      .innerJoin(contacts, eq(contacts.id, deals.contactId))
      .innerJoin(tenants, eq(tenants.id, sales.tenantId))
      .where(eq(sales.id, parsed.data.vendaId))
      .limit(1);

    if (!linha) {
      throw new ServiceError('NAO_ENCONTRADO', 'Essa venda não existe mais.', {
        correcao: 'Voltar para a lista de vendas',
      });
    }

    // Só as parcelas PAGAS entram no recibo — é um comprovante do que já entrou, não
    // um extrato do que falta. Ordem por data de pagamento (e vencimento como desempate),
    // que é a ordem em que o dinheiro chegou.
    const pagas = await tx
      .select({
        valorCents: receivables.valorCents,
        pagoEm: receivables.pagoEm,
        venceEm: receivables.venceEm,
      })
      .from(receivables)
      .where(and(eq(receivables.saleId, linha.vendaId), eq(receivables.status, 'pago')))
      .orderBy(asc(receivables.pagoEm), asc(receivables.venceEm));

    const parcelasPagas: ParcelaPagaDoRecibo[] = pagas.map((p, indice) => ({
      numero: indice + 1,
      valorCents: p.valorCents,
      // `pago_em` é timestamptz; o recibo só quer o dia.
      pagoEm: p.pagoEm ? p.pagoEm.toISOString().slice(0, 10) : null,
    }));

    await registrarAuditoria(tx, {
      tenantId,
      actorUserId: userId,
      action: 'sale.receipt_issued',
      entity: 'sale',
      entityId: linha.vendaId,
      metadata: { dealId: linha.dealId, totalParcelasPagas: parcelasPagas.length },
    });

    return {
      numero: `REC-${linha.vendaId.slice(0, 8).toUpperCase()}`,
      emitidoEm: new Date(),
      clienteNome: linha.clienteNome,
      descricao: linha.destino ?? linha.titulo,
      currency: linha.currency,
      valorTotalCents: linha.valorBrutoCents,
      parcelasPagas,
      assinatura: assinaturaDaMarca({
        brandName: linha.brandName,
        agentDisplayName: linha.agentDisplayName,
      }),
    } satisfies DadosDoRecibo;
    });
  });
}
