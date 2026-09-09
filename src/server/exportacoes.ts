import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, deals, receivables, sales, travelers } from '@/db/schema';
import { withTenant } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { resolverPeriodo, type PeriodoInput } from './periodo';
import { registrarAuditoria } from './audit';
import { slugificar } from './normalize';
import { BOM_UTF8, linhaCsv, centavosParaReaisCsv } from './csv';

/**
 * Exportações CSV — a ficha 360° e o hub Dinheiro deixando o dado SAIR do Zarpa
 * (fase 2 do roadmap). Este arquivo NÃO é `'use server'`: é helper de rota, como
 * `recibos.ts`. As rotas GET (`/api/export/passageiros/[dealId]`,
 * `/api/export/vendas`) são o produto — link que o navegador baixa, não payload de
 * Server Action. O CSV do resumo do mês (`dashboard.ts`) continua Server Action de
 * propósito; o padrão novo vale para exportação NOVA.
 *
 * Formato: o mesmo do CSV de sempre (helpers de `csv.ts`) — `;`, BOM UTF-8, `\r\n`,
 * escape RFC 4180, dinheiro em reais pt-BR. abre no Excel BR com duplo clique.
 *
 * PII: o CSV de passageiros traz CPF e passaporte DECIFRADOS — a via da casa
 * (`encryptedText` decifra na leitura da coluna; nada de chave em log, nada de
 * ciphertext na planilha, que teria ZERO valor para o fornecedor). Por decifrar
 * documento, este export é AUDITADO (`travelers.exported`): metadata com o FATO
 * (quantos viajantes, quantos com documento) — nunca o documento em si.
 * O CSV de vendas não tem documento — não audita (audit nas escritas e nos exports
 * COM documento, como manda o combinado).
 */

export type ArquivoCsv = {
  /** Nome com data, já pronto para `Content-Disposition: attachment`. */
  nomeArquivo: string;
  /** Texto completo do arquivo — BOM incluído, grave como veio. */
  conteudo: string;
};

function montarCsv(nomeArquivo: string, linhas: string[][]): ArquivoCsv {
  const corpo = linhas.map(linhaCsv).join('\r\n');
  return { nomeArquivo, conteudo: `${BOM_UTF8}${corpo}\r\n` };
}

// ---------------------------------------------------------------------------
// Passageiros do negócio — o CSV que vai para o fornecedor
// ---------------------------------------------------------------------------

const passageirosInput = z.object({ dealId: z.uuid('Negócio inválido.') });

const ROTULO_DO_TIPO: Record<'adult' | 'child' | 'infant', string> = {
  adult: 'Adulto',
  child: 'Criança',
  infant: 'Bebê',
};

export async function csvPassageirosDoNegocio(dealId: string): Promise<ServiceResult<ArquivoCsv>> {
  return comoResultado(async () => {
    const parsed = passageirosInput.safeParse({ dealId });
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
        correcao: 'Verificar o link e tentar de novo',
      });
    }

    const { tenantId, userId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
    const [negocio] = await tx
      .select({ id: deals.id, titulo: deals.title, destino: deals.destination, contactId: deals.contactId })
      .from(deals)
      .where(eq(deals.id, parsed.data.dealId))
      .limit(1);

    if (!negocio) {
      throw new ServiceError('NAO_ENCONTRADO', 'Esse negócio não existe mais.', {
        correcao: 'Voltar para o funil',
      });
    }

    const viajantes = await tx
      .select({
        fullName: travelers.fullName,
        kind: travelers.kind,
        // Decifram sozinhos na leitura (encryptedText) — a via da casa, sem tocar na chave.
        cpf: travelers.cpf,
        passportNumber: travelers.passportNumber,
      })
      .from(travelers)
      .where(eq(travelers.contactId, negocio.contactId))
      .orderBy(asc(travelers.createdAt));

    const hoje = new Date().toISOString().slice(0, 10);
    const baseNome = slugificar(negocio.destino ?? negocio.titulo) || 'viagem';
    const arquivo = montarCsv(
      `passageiros-${baseNome}-${hoje}.csv`,
      [
        ['Nome', 'Tipo', 'CPF', 'Passaporte'],
        ...viajantes.map((v) => [
          v.fullName,
          ROTULO_DO_TIPO[v.kind],
          v.cpf ?? '',
          v.passportNumber ?? '',
        ]),
      ],
    );

    await registrarAuditoria(tx, {
      tenantId,
      actorUserId: userId,
      action: 'travelers.exported',
      entity: 'deal',
      entityId: negocio.id,
      // O FATO do export, nunca o documento exportado.
      metadata: {
        dealId: negocio.id,
        total: viajantes.length,
        comDocumento: viajantes.filter((v) => v.cpf || v.passportNumber).length,
      },
    });

    return arquivo;
    });
  });
}

// ---------------------------------------------------------------------------
// Vendas do período — o CSV que vai para o contador
// ---------------------------------------------------------------------------

export async function csvVendasDoPeriodo(
  filtro?: PeriodoInput,
): Promise<ServiceResult<ArquivoCsv>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    // Uma ponta só do intervalo é erro do resolverPeriodo — mesma recusa das telas.
    const periodo = resolverPeriodo(new Date(), filtro ?? {});

    return withTenant(tenantId, async (tx) => {
    const linhas = await tx
      .select({
        vendaId: sales.id,
        criadaEm: sales.createdAt,
        valorBrutoCents: sales.valorBrutoCents,
        comissaoPrevistaCents: sales.comissaoPrevistaCents,
        comissaoStatus: sales.comissaoStatus,
        cliente: contacts.name,
        destino: deals.destination,
        titulo: deals.title,
      })
      .from(sales)
      .innerJoin(deals, eq(deals.id, sales.dealId))
      .innerJoin(contacts, eq(contacts.id, deals.contactId))
      .where(and(gte(sales.createdAt, periodo.inicio), lt(sales.createdAt, periodo.fimExclusivo)))
      .orderBy(asc(sales.createdAt));

    // Estado das parcelas por venda, agregado em JS — "2/3 pagas".
    const vendaIds = linhas.map((l) => l.vendaId);
    const parcelas =
      vendaIds.length > 0
        ? await tx
            .select({ saleId: receivables.saleId, status: receivables.status })
            .from(receivables)
            .where(inArray(receivables.saleId, vendaIds))
        : [];

    const resumoParcelas = new Map<string, { pagas: number; total: number }>();
    for (const p of parcelas) {
      if (p.status === 'cancelado') continue;
      const entrada = resumoParcelas.get(p.saleId) ?? { pagas: 0, total: 0 };
      entrada.total += 1;
      if (p.status === 'pago') entrada.pagas += 1;
      resumoParcelas.set(p.saleId, entrada);
    }

    const STATUS_ROTULO: Record<'prevista' | 'recebida' | 'atrasada', string> = {
      prevista: 'Prevista',
      recebida: 'Recebida',
      atrasada: 'Atrasada',
    };

    const diaIso = (d: Date) => d.toISOString().slice(0, 10);
    const diaBr = (iso: string) => {
      const [ano, mes, dia] = iso.split('-');
      return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
    };

    const arquivo = montarCsv(
      periodo.de === periodo.ate
        ? `vendas-${periodo.de}.csv`
        : `vendas-${periodo.de}_a_${periodo.ate}.csv`,
      [
        ['Data', 'Cliente', 'Viagem', 'Valor', 'Comissão', 'Status da comissão', 'Parcelas'],
        ...linhas.map((l) => {
          const parcela = resumoParcelas.get(l.vendaId);
          return [
            diaBr(diaIso(l.criadaEm)),
            l.cliente,
            l.destino ?? l.titulo,
            centavosParaReaisCsv(l.valorBrutoCents),
            centavosParaReaisCsv(l.comissaoPrevistaCents),
            STATUS_ROTULO[l.comissaoStatus],
            parcela ? `${parcela.pagas}/${parcela.total} pagas` : '—',
          ];
        }),
      ],
    );

    return arquivo;
    });
  });
}
