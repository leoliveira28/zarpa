'use server';

import { and, asc, count, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { costCenters, deals, sales } from '@/db/schema';
import { withTenant, type TenantDb } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { registrarAuditoria } from './audit';
import { exigirContaAtiva } from './subscriptionGate';

/**
 * Centros de custo do tenant (`cost_centers`, `drizzle/0022_pj_e_centro_de_custo.sql`).
 *
 * Fase 4a — a firma que o agente atende às vezes paga por SETOR (diretoria, marketing).
 * Centro de custo é a etiqueta dessa divisão: LISTA PLANA do tenant. Não é por empresa,
 * não tem hierarquia, não tem rateio (§6 do plano da Fase 4: fora de escopo de propósito).
 *
 * Molde `pipelineStages.ts`, à risca: `requireAuthContext()` → `withTenant` → zod antes
 * do banco → `ServiceResult`; escrita passa por `exigirContaAtiva` (gate de dunning);
 * linha com uso nunca é apagada, só arquivada (`archived_at`) — o DELETE nem existe
 * aqui, e a FK RESTRICT em `deals`/`sales` é a rede por baixo.
 */

/** Teto de centros por tenant. Lista de seleção que não cabe em tela não é lista. */
const MAX_CENTROS = 30;

export type CentroDeCusto = {
  id: string;
  label: string;
  position: number;
  archivedAt: Date | null;
  /** Quantos negócios usam este centro HOJE (`deals.cost_center_id`) — o que `arquivarCentroDeCusto` anuncia. */
  totalNegocios: number;
};

const COLUNAS = {
  id: costCenters.id,
  label: costCenters.label,
  position: costCenters.position,
  archivedAt: costCenters.archivedAt,
} as const;

const rotuloSchema = z
  .string()
  .trim()
  .min(1, 'Dê um nome ao centro de custo')
  .max(80, 'No máximo 80 caracteres');

const criarInput = z.object({
  label: rotuloSchema,
  /** Onde entrar. Omitido: no fim da lista. */
  position: z.number().int().min(0).max(1000).optional(),
});
export type CriarCentroDeCustoInput = z.infer<typeof criarInput>;

const renomearInput = z.object({
  id: z.uuid('Centro de custo inválido'),
  label: rotuloSchema,
});
export type RenomearCentroDeCustoInput = z.infer<typeof renomearInput>;

const arquivarInput = z.object({ id: z.uuid('Centro de custo inválido') });
export type ArquivarCentroDeCustoInput = z.infer<typeof arquivarInput>;

const reabrirInput = z.object({ id: z.uuid('Centro de custo inválido') });
export type ReabrirCentroDeCustoInput = z.infer<typeof reabrirInput>;

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

/** Negócios que usam este centro HOJE. Vendas herdadas contam pelo deal — não se somam duas vezes. */
async function contarNegociosNoCentro(
  tx: TenantDb,
  tenantId: string,
  centroId: string,
): Promise<number> {
  const [linha] = await tx
    .select({ total: count() })
    .from(deals)
    .where(and(eq(deals.tenantId, tenantId), eq(deals.costCenterId, centroId)));
  return linha?.total ?? 0;
}

/** A lista do tenant. Ativos em ordem de posição, depois arquivados — o seletor lê a primeira metade. */
export async function listarCentrosDeCusto(
  filtro?: { incluirArquivados?: boolean },
): Promise<ServiceResult<CentroDeCusto[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const condicoes = filtro?.incluirArquivados ? [] : [isNull(costCenters.archivedAt)];

      const linhas = await tx
        .select(COLUNAS)
        .from(costCenters)
        .where(condicoes.length > 0 ? and(...condicoes) : undefined)
        .orderBy(asc(costCenters.position), asc(costCenters.createdAt))
        .limit(MAX_CENTROS + 50);

      const comUso = await Promise.all(
        linhas.map(async (linha) => ({
          ...linha,
          totalNegocios: await contarNegociosNoCentro(tx, tenantId, linha.id),
        })),
      );
      return comUso as CentroDeCusto[];
    });
  });
}

export async function criarCentroDeCusto(
  input: CriarCentroDeCustoInput,
): Promise<ServiceResult<CentroDeCusto>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(criarInput, input);

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);

      const [total] = await tx
        .select({ total: count() })
        .from(costCenters)
        .where(and(eq(costCenters.tenantId, tenantId), isNull(costCenters.archivedAt)));
      if ((total?.total ?? 0) >= MAX_CENTROS) {
        throw new ServiceError('CONFLITO', `Você já tem ${MAX_CENTROS} centros de custo ativos.`, {
          correcao: 'Arquivar um que não usa antes de criar outro',
        });
      }

      const position =
        dados.position ??
        // Fim da lista: depois do último ativo. `max + 1`, nunca `count` — arquivar não
        // recua a posição e a ordem de quem já usa não tremula.
        (((await tx
          .select({ max: sql<number | null>`max(${costCenters.position})` })
          .from(costCenters)
          .where(and(eq(costCenters.tenantId, tenantId), isNull(costCenters.archivedAt))))
          [0]?.max ?? -1) + 1);

      // O índice único parcial (tenant, lower(label)) WHERE archived_at is null garante
      // isso no banco; a checagem existe para dar mensagem decente em vez de 23505.
      const existente = await tx
        .select({ id: costCenters.id })
        .from(costCenters)
        .where(
          and(
            eq(costCenters.tenantId, tenantId),
            isNull(costCenters.archivedAt),
            sql`lower(${costCenters.label}) = lower(${dados.label})`,
          ),
        )
        .limit(1);
      if (existente.length > 0) {
        throw new ServiceError('CONFLITO', 'Você já tem um centro de custo com esse nome.', {
          campo: 'label',
          correcao: 'Escolher outro nome',
        });
      }

      const [criado] = await tx
        .insert(costCenters)
        .values({ tenantId, label: dados.label, position })
        .returning(COLUNAS);

      const centro = criado!;

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'cost_center.created',
        entity: 'cost_center',
        entityId: centro.id,
        metadata: { label: centro.label },
      });

      return { ...centro, totalNegocios: 0 } as CentroDeCusto;
    });
  });
}

export async function renomearCentroDeCusto(
  input: RenomearCentroDeCustoInput,
): Promise<ServiceResult<CentroDeCusto>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(renomearInput, input);

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);

      const existente = await tx
        .select({ id: costCenters.id })
        .from(costCenters)
        .where(
          and(
            eq(costCenters.tenantId, tenantId),
            isNull(costCenters.archivedAt),
            sql`lower(${costCenters.label}) = lower(${dados.label})`,
            sql`${costCenters.id} <> ${dados.id}`,
          ),
        )
        .limit(1);
      if (existente.length > 0) {
        throw new ServiceError('CONFLITO', 'Você já tem um centro de custo com esse nome.', {
          campo: 'label',
          correcao: 'Escolher outro nome',
        });
      }

      const [linha] = await tx
        .update(costCenters)
        .set({ label: dados.label, updatedAt: new Date() })
        .where(and(eq(costCenters.id, dados.id), eq(costCenters.tenantId, tenantId)))
        .returning(COLUNAS);
      if (!linha) throw new ServiceError('NAO_ENCONTRADO', 'Centro de custo não encontrado.');

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'cost_center.renamed',
        entity: 'cost_center',
        entityId: dados.id,
      });

      return {
        ...linha,
        totalNegocios: await contarNegociosNoCentro(tx, tenantId, linha.id),
      } as CentroDeCusto;
    });
  });
}

export async function arquivarCentroDeCusto(
  input: ArquivarCentroDeCustoInput,
): Promise<ServiceResult<CentroDeCusto>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(arquivarInput, input);

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);

      const [linha] = await tx
        .update(costCenters)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(costCenters.id, dados.id),
            eq(costCenters.tenantId, tenantId),
            isNull(costCenters.archivedAt),
          ),
        )
        .returning(COLUNAS);
      if (!linha) throw new ServiceError('NAO_ENCONTRADO', 'Centro de custo não encontrado.');

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'cost_center.archived',
        entity: 'cost_center',
        entityId: dados.id,
      });

      return {
        ...linha,
        totalNegocios: await contarNegociosNoCentro(tx, tenantId, linha.id),
      } as CentroDeCusto;
    });
  });
}

export async function reabrirCentroDeCusto(
  input: ReabrirCentroDeCustoInput,
): Promise<ServiceResult<CentroDeCusto>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(reabrirInput, input);

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);

      // Reabrir pode colidir com um rótulo ativo de mesmo nome — o índice único parcial
      // recusa, então a checagem dá a mensagem da casa em vez do 23505.
      const [linha] = await tx
        .select(COLUNAS)
        .from(costCenters)
        .where(
          and(
            eq(costCenters.id, dados.id),
            eq(costCenters.tenantId, tenantId),
            isNotNull(costCenters.archivedAt),
          ),
        )
        .limit(1);
      if (!linha) throw new ServiceError('NAO_ENCONTRADO', 'Centro de custo não encontrado.');

      const existente = await tx
        .select({ id: costCenters.id })
        .from(costCenters)
        .where(
          and(
            eq(costCenters.tenantId, tenantId),
            isNull(costCenters.archivedAt),
            sql`lower(${costCenters.label}) = lower(${linha.label})`,
          ),
        )
        .limit(1);
      if (existente.length > 0) {
        throw new ServiceError('CONFLITO', 'Já existe um centro de custo ativo com esse nome.', {
          campo: 'label',
          correcao: 'Renomear um dos dois antes de reabrir',
        });
      }

      const [reaberto] = await tx
        .update(costCenters)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(eq(costCenters.id, dados.id))
        .returning(COLUNAS);

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'cost_center.reopened',
        entity: 'cost_center',
        entityId: dados.id,
      });

      return {
        ...reaberto!,
        totalNegocios: await contarNegociosNoCentro(tx, tenantId, reaberto!.id),
      } as CentroDeCusto;
    });
  });
}

/** Exporta também a checagem de venda para o CSV/relatório — só leitura. */
export async function centroDeCustoTemVendas(
  centroId: string,
): Promise<ServiceResult<boolean>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    return withTenant(tenantId, async (tx) => {
      const [linha] = await tx
        .select({ total: count() })
        .from(sales)
        .where(and(eq(sales.tenantId, tenantId), eq(sales.costCenterId, centroId)))
        .limit(1);
      return (linha?.total ?? 0) > 0;
    });
  });
}
