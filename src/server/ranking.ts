'use server';

import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, deals, pipelineStages, sales } from '@/db/schema';
import { withTenant } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { resolverPeriodo, type Periodo } from './periodo';

/**
 * Ranking de clientes — "quem mais comprou comigo" (fase 2 do roadmap, tela Relatórios).
 *
 * Vendas de negócios GANHOS no período (mesma gramática de período das outras telas de
 * leitura: `{ mes }`, `{ de, ate }` ou nada = mês corrente UTC). A janela é
 * `sales.created_at` — o momento em que a venda foi lançada, que é o que o resto do
 * financeiro já usa; relatório que usa um relógio diferente do financeiro gera duas
 * verdades.
 *
 * Dinheiro somado em JAVASCRIPT (`bigint mode: 'number'`): `sum()` em SQL voltaria
 * string pelo driver — mesmo cuidado de `resultado.ts`.
 *
 * Leitura: sem gate de dunning, como toda leitura da casa.
 */

export type LinhaDoRanking = {
  contatoId: string;
  nome: string;
  totalCompradoCents: number;
  /** Viagens distintas compradas no período (uma viagem = um negócio — e não uma parcela). */
  viagens: number;
};

const LIMITE_PADRAO = 10;
const LIMITE_MAXIMO = 50;

const rankingInput = z.object({
  /** Período — mesmo vocabulário de `resolverPeriodo`; ausente = mês corrente. */
  mes: z.string().trim().optional(),
  de: z.string().trim().optional(),
  ate: z.string().trim().optional(),
  limite: z
    .number('O limite tem que ser um número.')
    .int('O limite tem que ser um número inteiro.')
    .min(1, 'O limite mínimo é 1.')
    .max(LIMITE_MAXIMO, `O limite máximo é ${LIMITE_MAXIMO}.`)
    .optional(),
});

export async function rankingDeClientes(
  filtro?: z.infer<typeof rankingInput>,
): Promise<ServiceResult<LinhaDoRanking[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    const parsed = rankingInput.safeParse(filtro ?? {});
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
        campo: primeiro?.path.join('.'),
        correcao: 'Corrigir o filtro e tentar de novo',
      });
    }

    // Uma ponta só do intervalo é erro do `resolverPeriodo` — não inventamos mês para ela.
    const periodo: Periodo = resolverPeriodo(new Date(), {
      mes: parsed.data.mes as string | undefined,
      de: parsed.data.de,
      ate: parsed.data.ate,
    });

    const limite = parsed.data.limite ?? LIMITE_PADRAO;

    return withTenant(tenantId, async (tx) => {
      const linhas = await tx
        .select({
          contatoId: contacts.id,
          nome: contacts.name,
          dealId: sales.dealId,
          valorBrutoCents: sales.valorBrutoCents,
        })
        .from(sales)
        .innerJoin(deals, eq(deals.id, sales.dealId))
        .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
        .innerJoin(contacts, eq(contacts.id, deals.contactId))
        .where(
          and(
            gte(sales.createdAt, periodo.inicio),
            lt(sales.createdAt, periodo.fimExclusivo),
            eq(pipelineStages.isWon, true),
          ),
        )
        .orderBy(desc(sales.createdAt));

      // Agrega em memória: por contato, total e nº de viagens DISTINTAS.
      const porContato = new Map<string, { nome: string; total: number; viagens: Set<string> }>();
      for (const linha of linhas) {
        let entrada = porContato.get(linha.contatoId);
        if (!entrada) {
          entrada = { nome: linha.nome, total: 0, viagens: new Set<string>() };
          porContato.set(linha.contatoId, entrada);
        }
        entrada.total += linha.valorBrutoCents;
        entrada.viagens.add(linha.dealId);
      }

      return [...porContato.entries()]
        .map(([contatoId, entrada]) => ({
          contatoId,
          nome: entrada.nome,
          totalCompradoCents: entrada.total,
          viagens: entrada.viagens.size,
        }))
        // Total primeiro; empate = quem comprou mais viagens; empate de novo = ordem
        // alfabética, para o ranking não tremular entre renders.
        .sort(
          (a, b) =>
            b.totalCompradoCents - a.totalCompradoCents ||
            b.viagens - a.viagens ||
            a.nome.localeCompare(b.nome, 'pt-BR'),
        )
        .slice(0, limite);
    });
  });
}
