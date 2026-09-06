'use server';

import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, deals, proposals, proposalViews } from '@/db/schema';
import { withTenant, type TenantDb } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { comoResultado, type ServiceResult } from './errors';

/**
 * Aberturas recentes de propostas públicas — sinal de compra.
 *
 * Quando o cliente abre o link público de uma proposta, a aplicação registra em
 * `proposal_views`. Esta ação lista as PRIMEIRAS aberturas (quando o cliente abriu
 * pela primeira vez), agrupadas por proposta, com dados do contato e proposta,
 * sem expor custo/comissão.
 *
 * Mesma gramática de outras actions: `requireAuthContext()` resolve o tenant,
 * toda query dentro de `withTenant`, entrada validada com zod.
 */

export type AberturaProposta = {
  proposalId: string;
  contactName: string;
  proposalTitle: string;
  destination: string | null;
  /** Contagem TOTAL de aberturas desta proposta. */
  openCount: number;
  /** Quando foi aberta pela PRIMEIRA vez. */
  firstViewedAt: Date;
};

const FiltroAberturas = z.object({
  /** Limitar ao último N dias (padrão: 7). */
  diasAtras: z.number().int().min(1).max(90).default(7),
  /** Máximo de propostas (agrupadas por abertura única) a retornar (padrão: 20). */
  limite: z.number().int().min(1).max(100).default(20),
});

export type FiltroAberturas = z.infer<typeof FiltroAberturas>;

/**
 * Lista as propostas ABERTAS MAIS RECENTEMENTE (pela primeira abertura de cada proposta).
 *
 * Retorna uma proposta por PRIMEIRA abertura (agrupadas), não todas as visualizações —
 * para não explodir de dados quando alguém abre 10x o mesmo link. Se o cliente abriu
 * no dia 1, 2 e 3, aparece UMA linha com a data da primeira (day 1) e contagem total
 * de 3 aberturas.
 *
 * Ordena por `first_viewed_at DESC` — primeiras aberturas mais recentes.
 */
export async function listarAberturasRecentes(
  filtro?: FiltroAberturas,
): Promise<ServiceResult<AberturaProposta[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const parsed = FiltroAberturas.safeParse(filtro ?? {});
    if (!parsed.success) {
      const erro = parsed.error.issues[0];
      throw new Error(erro?.message ?? 'Filtro inválido');
    }
    const dados = parsed.data;

    return withTenant(tenantId, async (tx) => {
      return obterAberturas(tx, tenantId, dados.diasAtras, dados.limite);
    });
  });
}

async function obterAberturas(
  tx: TenantDb,
  tenantId: string,
  diasAtras: number,
  limite: number,
): Promise<AberturaProposta[]> {
  const dataLimite = new Date();
  dataLimite.setDate(dataLimite.getDate() - diasAtras);

  // Query que lista propostas com primeira abertura recente, agrupadas.
  // Usa SQL direto porque o Drizzle não type-checks GROUP BY facilmente.
  // O tenant_id já está set via set_config dentro de withTenant, mas fazemos
  // a filtragem explícita de qualquer forma (camada extra de defesa).
  const linhas = await tx.execute<{
    proposal_id: string;
    contact_name: string;
    proposal_title: string;
    destination: string | null;
    open_count: number;
    first_viewed_at: Date;
  }>(sql`
    select
      p.id as proposal_id,
      c.name as contact_name,
      p.title as proposal_title,
      d.destination,
      count(pv.id)::int as open_count,
      p.first_viewed_at
    from proposals p
    inner join deals d on d.id = p.deal_id
    inner join contacts c on c.id = d.contact_id
    left join proposal_views pv on pv.proposal_id = p.id
    where
      p.tenant_id = ${tenantId}
      and p.first_viewed_at is not null
      and p.first_viewed_at >= ${dataLimite}
    group by p.id, d.id, c.id
    order by p.first_viewed_at desc
    limit ${limite}
  `);

  return linhas.map((linha) => ({
    proposalId: linha.proposal_id,
    contactName: linha.contact_name,
    proposalTitle: linha.proposal_title,
    destination: linha.destination,
    openCount: linha.open_count,
    firstViewedAt: linha.first_viewed_at,
  }));
}
