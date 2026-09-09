'use server';

import { and, asc, count, eq, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { deals, pipelineStages } from '@/db/schema';
import { withTenant, type TenantDb } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { registrarAuditoria } from './audit';
import { exigirContaAtiva } from './subscriptionGate';
import { contarEstagios } from './pipelineStagesDefaults';

/**
 * Estágios do funil por tenant (`pipeline_stages`, `drizzle/0015_estagios_do_funil.sql`).
 *
 * ALICERCE, NÃO FEATURE. Nada aqui está ligado ao funil de verdade ainda: `/funil` e todo
 * `deals.ts`/`dashboard.ts`/`money.ts` continuam lendo o enum `deals.stage` e a lista fixa
 * `COLUNAS_DO_FUNIL` (`./dealStages.ts`). Estas actions existem para a UI da Nina ligar
 * numa próxima rodada, e para a migração de `deals.stage` para `stage_id` acontecer com o
 * alvo já pronto (o caminho está escrito no topo da 0015).
 *
 * Consequência prática de "ainda não ligado": um estágio NOVO (criado aqui) não pode
 * receber negócio nenhum hoje — não existe coluna em `deals` capaz de apontar para ele.
 * Por isso `arquivarEstagio` conta negócio por `legacy_stage`: é o único vínculo que
 * existe entre negócio e estágio nesta rodada.
 *
 * Padrão de sempre: `requireAuthContext()` → `withTenant` → zod antes do banco →
 * `ServiceResult`. Escrita passa por `exigirContaAtiva` (gate de dunning, S13a).
 */

/** Teto de colunas por tenant. Quadro de funil que não cabe na tela não é quadro. */
const MAX_ESTAGIOS = 12;

export type EstagioDoFunil = {
  id: string;
  /** Valor correspondente em `deals.stage`. Nulo = estágio criado pela agente. */
  legacyStage: string | null;
  label: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
  archivedAt: Date | null;
  /** Quantos negócios estão neste estágio HOJE (por `deals.stage`; 0 se `legacyStage` nulo). */
  totalNegocios: number;
};

const COLUNAS = {
  id: pipelineStages.id,
  legacyStage: pipelineStages.legacyStage,
  label: pipelineStages.label,
  position: pipelineStages.position,
  isWon: pipelineStages.isWon,
  isLost: pipelineStages.isLost,
  archivedAt: pipelineStages.archivedAt,
} as const;

const rotuloSchema = z
  .string()
  .trim()
  .min(1, 'Dê um nome à coluna')
  .max(40, 'No máximo 40 caracteres');

const criarInput = z.object({
  label: rotuloSchema,
  /** Onde entrar. Omitido: entra antes do primeiro fim de funil (ou no fim, se não houver). */
  position: z.number().int().min(0).max(100).optional(),
});
export type CriarEstagioInput = z.infer<typeof criarInput>;

const renomearInput = z.object({
  id: z.uuid('Coluna inválida'),
  label: rotuloSchema,
});
export type RenomearEstagioInput = z.infer<typeof renomearInput>;

const reordenarInput = z.object({
  /** TODOS os ids ativos, na ordem desejada. Lista incompleta é recusada. */
  ids: z.array(z.uuid('Coluna inválida')).min(1, 'Mande a ordem das colunas').max(MAX_ESTAGIOS),
});
export type ReordenarEstagiosInput = z.infer<typeof reordenarInput>;

const arquivarInput = z.object({ id: z.uuid('Coluna inválida') });
export type ArquivarEstagioInput = z.infer<typeof arquivarInput>;

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

/** Negócios que estão HOJE neste estágio (via o enum — ver comentário do topo). */
async function contarNegociosNoEstagio(
  tx: TenantDb,
  tenantId: string,
  legacyStage: string | null,
): Promise<number> {
  if (!legacyStage) return 0;
  const [linha] = await tx
    .select({ total: count() })
    .from(deals)
    .where(
      and(
        eq(deals.tenantId, tenantId),
        // `deals.stage` é enum de texto; o cast é explícito porque `legacyStage` chega do
        // banco como `string | null`, não como o union literal do Drizzle.
        sql`${deals.stage} = ${legacyStage}`,
      ),
    );
  return linha?.total ?? 0;
}

async function carregarEstagio(tx: TenantDb, id: string): Promise<EstagioDoFunilBase> {
  const [linha] = await tx.select(COLUNAS).from(pipelineStages).where(eq(pipelineStages.id, id));
  if (!linha) {
    throw new ServiceError('NAO_ENCONTRADO', 'Essa coluna não existe mais.', {
      correcao: 'Recarregar o funil',
    });
  }
  return linha;
}

type EstagioDoFunilBase = Omit<EstagioDoFunil, 'totalNegocios'>;

/**
 * Postgres 23505 = unique_violation, aqui sempre `pipeline_stages_tenant_label_key`.
 *
 * Percorre a cadeia de `cause`: o drizzle-orm (0.45.2) embrulha a falha do driver em
 * `DrizzleQueryError` e o `code` fica um nível abaixo — checar só o topo devolve `false`
 * SEMPRE e o conflito vira "erro não tratado" genérico. Mesmo helper de `tenants.ts`
 * (achado ao vivo lá no S13a, e de novo aqui: o teste descartável desta rodada pegou
 * `DADOS_INVALIDOS` onde eu esperava `CONFLITO`).
 */
function ehViolacaoDeUnicidade(erro: unknown): boolean {
  let atual: unknown = erro;
  for (let nivel = 0; nivel < 5; nivel += 1) {
    if (!(atual instanceof Error)) return false;
    if ((atual as { code?: unknown }).code === '23505') return true;
    atual = (atual as { cause?: unknown }).cause;
  }
  return false;
}

const conflitoDeNome = new ServiceError('CONFLITO', 'Já existe uma coluna com esse nome.', {
  campo: 'label',
  correcao: 'Escolher outro nome',
});

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/**
 * As colunas do funil deste tenant, na ordem do quadro. Arquivadas ficam de fora por
 * padrão (`incluirArquivadas` traz todas, para uma tela de histórico se um dia existir).
 *
 * `totalNegocios` vem junto porque é o número que decide se a coluna PODE ser arquivada —
 * a UI mostra "3 negócios aqui" antes de oferecer o botão, em vez de deixar a agente
 * descobrir a recusa depois do clique.
 */
export async function listarEstagios(filtro?: {
  incluirArquivadas?: boolean;
}): Promise<ServiceResult<EstagioDoFunil[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const incluirArquivadas = filtro?.incluirArquivadas === true;

    return withTenant(tenantId, async (tx) => {
      const linhas = await tx
        .select(COLUNAS)
        .from(pipelineStages)
        .where(
          incluirArquivadas
            ? eq(pipelineStages.tenantId, tenantId)
            : and(eq(pipelineStages.tenantId, tenantId), isNull(pipelineStages.archivedAt)),
        )
        .orderBy(asc(pipelineStages.position), asc(pipelineStages.createdAt));

      // Uma query só para a contagem, agrupada — não uma por coluna.
      const porEstagio = await tx
        .select({ stage: deals.stage, total: count() })
        .from(deals)
        .where(eq(deals.tenantId, tenantId))
        .groupBy(deals.stage);
      const contagem = new Map(porEstagio.map((l) => [l.stage as string, l.total]));

      return linhas.map((linha) => ({
        ...linha,
        totalNegocios: linha.legacyStage ? (contagem.get(linha.legacyStage) ?? 0) : 0,
      }));
    });
  });
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

/**
 * Cria uma coluna. Nasce SEMPRE como estágio comum: `is_won`/`is_lost` não são parâmetro.
 * Fim de funil é o par semeado no nascimento do tenant, e trocar qual coluna fecha como
 * ganho/perdido é decisão de produto que ainda não existe (relatórios dependem dela).
 *
 * Sem `position`, entra ANTES do primeiro fim de funil — "Fechada"/"Perdida" continuam
 * sendo as últimas do quadro, que é o que a agente espera.
 */
export async function criarEstagio(
  input: CriarEstagioInput,
): Promise<ServiceResult<EstagioDoFunil>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(criarInput, input);

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);

      if ((await contarEstagios(tx, tenantId)) >= MAX_ESTAGIOS) {
        throw new ServiceError(
          'CONFLITO',
          `O funil já tem ${MAX_ESTAGIOS} colunas — o máximo.`,
          { correcao: 'Arquivar uma coluna antes de criar outra' },
        );
      }

      const ativos = await tx
        .select({
          id: pipelineStages.id,
          position: pipelineStages.position,
          isWon: pipelineStages.isWon,
          isLost: pipelineStages.isLost,
        })
        .from(pipelineStages)
        .where(and(eq(pipelineStages.tenantId, tenantId), isNull(pipelineStages.archivedAt)))
        .orderBy(asc(pipelineStages.position), asc(pipelineStages.createdAt));

      const fimDeFunil = ativos.filter((e) => e.isWon || e.isLost);
      const posicao =
        dados.position ??
        (fimDeFunil.length > 0
          ? Math.min(...fimDeFunil.map((e) => e.position))
          : ativos.length);

      // Abre espaço: tudo daquela posição em diante desce um. Sem unicidade em
      // `position`, um empate temporário não quebra nada — a ordem de leitura desempata
      // por `created_at`.
      await tx
        .update(pipelineStages)
        .set({ position: sql`${pipelineStages.position} + 1`, updatedAt: new Date() })
        .where(
          and(
            eq(pipelineStages.tenantId, tenantId),
            isNull(pipelineStages.archivedAt),
            sql`${pipelineStages.position} >= ${posicao}`,
          ),
        );

      let criado: EstagioDoFunilBase;
      try {
        const [linha] = await tx
          .insert(pipelineStages)
          .values({ tenantId, label: dados.label, position: posicao })
          .returning(COLUNAS);
        criado = linha!;
      } catch (erro: unknown) {
        if (ehViolacaoDeUnicidade(erro)) throw conflitoDeNome;
        throw erro;
      }

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'pipeline_stage.created',
        entity: 'pipeline_stage',
        entityId: criado.id,
        metadata: { position: criado.position },
      });

      return { ...criado, totalNegocios: 0 };
    });
  });
}

/** Renomeia a coluna. Só o rótulo muda — `legacy_stage` e o fim de funil são intocáveis. */
export async function renomearEstagio(
  input: RenomearEstagioInput,
): Promise<ServiceResult<EstagioDoFunil>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(renomearInput, input);

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);
      const atual = await carregarEstagio(tx, dados.id);

      if (atual.archivedAt) {
        throw new ServiceError('CONFLITO', 'Essa coluna está arquivada.', {
          correcao: 'Reativar a coluna antes de renomear',
        });
      }

      let atualizado: EstagioDoFunilBase;
      try {
        const [linha] = await tx
          .update(pipelineStages)
          .set({ label: dados.label, updatedAt: new Date() })
          .where(eq(pipelineStages.id, dados.id))
          .returning(COLUNAS);
        atualizado = linha!;
      } catch (erro: unknown) {
        if (ehViolacaoDeUnicidade(erro)) throw conflitoDeNome;
        throw erro;
      }

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'pipeline_stage.renamed',
        entity: 'pipeline_stage',
        entityId: dados.id,
        // O rótulo é dado da agência, não PII de cliente — registrar o "de/para" é o que
        // torna a trilha útil quando alguém perguntar "quem mudou o nome da coluna".
        metadata: { de: atual.label, para: dados.label },
      });

      return {
        ...atualizado,
        totalNegocios: await contarNegociosNoEstagio(tx, tenantId, atualizado.legacyStage),
      };
    });
  });
}

/**
 * Reordena o quadro. Recebe TODOS os ids ativos na ordem desejada — lista parcial é
 * recusada de propósito: reordenação parcial é a receita para posição duplicada e para o
 * quadro "pular" na tela do lado de quem não mandou a lista inteira.
 */
export async function reordenarEstagios(
  input: ReordenarEstagiosInput,
): Promise<ServiceResult<EstagioDoFunil[]>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(reordenarInput, input);

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);

      const ativos = await tx
        .select({ id: pipelineStages.id })
        .from(pipelineStages)
        .where(and(eq(pipelineStages.tenantId, tenantId), isNull(pipelineStages.archivedAt)));

      const esperados = new Set(ativos.map((e) => e.id));
      const recebidos = new Set(dados.ids);
      const completa =
        recebidos.size === dados.ids.length &&
        recebidos.size === esperados.size &&
        dados.ids.every((id) => esperados.has(id));

      if (!completa) {
        throw new ServiceError(
          'DADOS_INVALIDOS',
          'A ordem enviada não bate com as colunas do funil.',
          { campo: 'ids', correcao: 'Recarregar o funil e arrastar de novo' },
        );
      }

      const agora = new Date();
      for (const [indice, id] of dados.ids.entries()) {
        await tx
          .update(pipelineStages)
          .set({ position: indice, updatedAt: agora })
          .where(eq(pipelineStages.id, id));
      }

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'pipeline_stage.reordered',
        entity: 'pipeline_stage',
        metadata: { total: dados.ids.length },
      });

      const linhas = await tx
        .select(COLUNAS)
        .from(pipelineStages)
        .where(and(eq(pipelineStages.tenantId, tenantId), isNull(pipelineStages.archivedAt)))
        .orderBy(asc(pipelineStages.position), asc(pipelineStages.createdAt));

      const porEstagio = await tx
        .select({ stage: deals.stage, total: count() })
        .from(deals)
        .where(eq(deals.tenantId, tenantId))
        .groupBy(deals.stage);
      const contagem = new Map(porEstagio.map((l) => [l.stage as string, l.total]));

      return linhas.map((linha) => ({
        ...linha,
        totalNegocios: linha.legacyStage ? (contagem.get(linha.legacyStage) ?? 0) : 0,
      }));
    });
  });
}

/**
 * Arquiva a coluna (soft — nunca DELETE). Recusa em dois casos, e os dois existem para que
 * negócio nenhum fique órfão:
 *
 *   1. **Fim de funil** (`is_won`/`is_lost`): relatório e dashboard precisam saber qual
 *      estágio fecha como ganho e qual como perdido. Arquivar o último deixaria o tenant
 *      sem fim de funil, e não existe outra guarda no banco para isso (ver "INVARIANTE"
 *      no topo da 0015).
 *   2. **Coluna com negócio dentro**: primeiro mover os negócios, depois arquivar.
 *
 * Idempotente: arquivar duas vezes devolve o estado atual sem reclamar.
 */
export async function arquivarEstagio(
  input: ArquivarEstagioInput,
): Promise<ServiceResult<EstagioDoFunil>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(arquivarInput, input);

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);
      const atual = await carregarEstagio(tx, dados.id);
      const totalNegocios = await contarNegociosNoEstagio(tx, tenantId, atual.legacyStage);

      if (atual.archivedAt) return { ...atual, totalNegocios };

      if (atual.isWon || atual.isLost) {
        throw new ServiceError(
          'CONFLITO',
          'Essa é a coluna de fim de funil — o funil precisa dela para fechar negócio.',
          { correcao: 'Renomear a coluna em vez de arquivar' },
        );
      }

      if (totalNegocios > 0) {
        throw new ServiceError(
          'CONFLITO',
          totalNegocios === 1
            ? 'Ainda tem 1 negócio nessa coluna.'
            : `Ainda tem ${totalNegocios} negócios nessa coluna.`,
          { correcao: 'Mover os negócios para outra coluna antes de arquivar' },
        );
      }

      const [linha] = await tx
        .update(pipelineStages)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(pipelineStages.id, dados.id), isNull(pipelineStages.archivedAt)))
        .returning(COLUNAS);

      // Fecha o buraco na ordem das que sobraram.
      await tx
        .update(pipelineStages)
        .set({ position: sql`${pipelineStages.position} - 1`, updatedAt: new Date() })
        .where(
          and(
            eq(pipelineStages.tenantId, tenantId),
            isNull(pipelineStages.archivedAt),
            ne(pipelineStages.id, dados.id),
            sql`${pipelineStages.position} > ${atual.position}`,
          ),
        );

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'pipeline_stage.archived',
        entity: 'pipeline_stage',
        entityId: dados.id,
        metadata: { label: atual.label },
      });

      return { ...(linha ?? atual), totalNegocios };
    });
  });
}
