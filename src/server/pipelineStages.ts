'use server';

import { and, asc, count, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { deals, pipelineStages } from '@/db/schema';
import { withTenant, type TenantDb } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { registrarAuditoria } from './audit';
import { exigirContaAtiva } from './subscriptionGate';
import {
  contarEstagios,
  contarEstagiosAtivos,
  semearEstagiosPadrao,
} from './pipelineStagesDefaults';

/**
 * Estágios do funil por tenant (`pipeline_stages`, `drizzle/0015_estagios_do_funil.sql`).
 *
 * S16 — AGORA ESTÁ LIGADO. `deals.stage_id` é FK para esta tabela
 * (`drizzle/0016_negocio_aponta_para_estagio.sql`), então um estágio criado aqui pode, de
 * verdade, receber negócio: `criarNegocio({ ..., stageId })` e
 * `moverEstagioDoNegocio(id, { stageId })` aceitam o id. A contagem de negócios por coluna
 * passou a ser por `deals.stage_id` (era por `legacy_stage`, o único vínculo que existia
 * antes) — é o que faz `arquivarEstagio` proteger também as colunas que a agente criou.
 *
 * O que AINDA não mudou: `/funil` monta as colunas pela lista fixa `COLUNAS_DO_FUNIL`
 * (`./dealStages.ts`). Trocar por `listarEstagios()` é a rodada da UI (Nina) — o backend
 * já devolve `stageId`/`stageLabel`/`stagePosition` em `listarNegociosDoFunil`.
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
  /** Quantos negócios estão nesta coluna HOJE — por `deals.stage_id` (S16). */
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

const reabrirInput = z.object({ id: z.uuid('Coluna inválida') });
export type ReabrirEstagioInput = z.infer<typeof reabrirInput>;

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

/**
 * Negócios que estão HOJE nesta coluna. S16: conta por `deals.stage_id` — a FK de verdade
 * (0016) — e não mais por `legacy_stage`. É a diferença entre `arquivarEstagio` proteger
 * só as colunas de fábrica e proteger TAMBÉM as que a agente criou, que agora podem ter
 * negócio dentro.
 */
async function contarNegociosNoEstagio(
  tx: TenantDb,
  tenantId: string,
  stageId: string,
): Promise<number> {
  const [linha] = await tx
    .select({ total: count() })
    .from(deals)
    .where(and(eq(deals.tenantId, tenantId), eq(deals.stageId, stageId)));
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

/**
 * A posição "fim do aberto": onde uma coluna entra quando o quadro fala por si — o último
 * lugar entre as colunas de trabalho, ANTES do primeiro fim de funil ("Fechada"/"Perdida"
 * continuam sendo as últimas do quadro, que é o que a agente espera). Sem fim de funil
 * ativo, o fim do quadro. Usada por `criarEstagio` (coluna nova) e por `reabrirEstagio`
 * (coluna que volta) — as duas largadas têm que cair no mesmo lugar.
 */
function posicaoFimDoAberto(
  ativos: { position: number; isWon: boolean; isLost: boolean }[],
): number {
  const fimDeFunil = ativos.filter((e) => e.isWon || e.isLost);
  return fimDeFunil.length > 0 ? Math.min(...fimDeFunil.map((e) => e.position)) : ativos.length;
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
 *
 * NUNCA devolve lista vazia por falta de semente: tenant que nasceu fora de `criarTenant`
 * (seed, teste, importação futura) recebe o funil de fábrica aqui, na mesma transação, e
 * segue o baile. É a mesma cura idempotente do trigger `deals_estagio_sync` (0016), no
 * outro extremo — lá quando chega um negócio, aqui quando alguém abre a tela de
 * configuração. Um quadro vazio na tela da agente não seria "não configurado": seria um
 * funil sem colunas, que é um produto quebrado.
 */
export async function listarEstagios(filtro?: {
  incluirArquivadas?: boolean;
}): Promise<ServiceResult<EstagioDoFunil[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const incluirArquivadas = filtro?.incluirArquivadas === true;

    return withTenant(tenantId, async (tx) => {
      const buscar = async (): Promise<EstagioDoFunilBase[]> =>
        tx
          .select(COLUNAS)
          .from(pipelineStages)
          .where(
            incluirArquivadas
              ? eq(pipelineStages.tenantId, tenantId)
              : and(eq(pipelineStages.tenantId, tenantId), isNull(pipelineStages.archivedAt)),
          )
          .orderBy(asc(pipelineStages.position), asc(pipelineStages.createdAt));

      let linhas = await buscar();
      if (linhas.length === 0 && (await contarEstagios(tx, tenantId)) === 0) {
        await semearEstagiosPadrao(tx, tenantId);
        linhas = await buscar();
      }

      // Uma query só para a contagem, agrupada por `stage_id` (S16) — não uma por coluna.
      const porEstagio = await tx
        .select({ stageId: deals.stageId, total: count() })
        .from(deals)
        .where(eq(deals.tenantId, tenantId))
        .groupBy(deals.stageId);
      const contagem = new Map(porEstagio.map((l) => [l.stageId, l.total]));

      return linhas.map((linha) => ({
        ...linha,
        totalNegocios: contagem.get(linha.id) ?? 0,
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

      // Teto conta colunas ATIVAS (`contarEstagiosAtivos`), nunca o total de linhas —
      // senão a própria correção do erro vira mentira: "arquivar uma coluna antes de
      // criar outra" não abriria vaga nenhuma e o teto ficaria sem porta de saída.
      // `reabrirEstagio` usa a mesma régua (`ativos.length`).
      if ((await contarEstagiosAtivos(tx, tenantId)) >= MAX_ESTAGIOS) {
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

      const posicao = dados.position ?? posicaoFimDoAberto(ativos);

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
        totalNegocios: await contarNegociosNoEstagio(tx, tenantId, atualizado.id),
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
        .select({ stageId: deals.stageId, total: count() })
        .from(deals)
        .where(eq(deals.tenantId, tenantId))
        .groupBy(deals.stageId);
      const contagem = new Map(porEstagio.map((l) => [l.stageId, l.total]));

      return linhas.map((linha) => ({
        ...linha,
        totalNegocios: contagem.get(linha.id) ?? 0,
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
      const totalNegocios = await contarNegociosNoEstagio(tx, tenantId, dados.id);

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

/**
 * Reabre uma coluna arquivada — o par do `arquivarEstagio`. Arquivamento é soft
 * (nunca DELETE) justamente para a volta ser possível: a linha inteira (rótulo, posição
 * relativa, linhagem) continua no banco, e nada aponta para ela enquanto
 * `archived_at` não volta a `null`.
 *
 * Onde ela volta: NO FIM DO ABERTO (`posicaoFimDoAberto`) — o mesmo lugar onde uma
 * coluna nova entra. Reabrir não tenta adivinhar a posição de meses atrás (o quadro
 * mudou; restaurar posição antiga é enfilar a coluna no meio de configuração que já
 * não existe mais) e não empurra o fim de funil do fim do quadro.
 *
 * As DUAS regras de conflito são as mesmas da semente de fábrica
 * (`public.semear_estagios_padrao`, 0016), pelo mesmo motivo de sempre — a volta não
 * pode derrubar o quadro nem mentir sobre o que ela é:
 *
 *   1. **RÓTULO já usado por coluna ATIVA** (o índice único
 *      `(tenant_id, lower(label))` WHERE `archived_at is null`): a coluna volta com
 *      sufixo — `"Orçamento (arquivada)"`, `"(arquivada 2)"`… Determinístico e feio de
 *      propósito: é sinal de estado estranho, não deve parecer normal, e não pode
 *      derrubar a reativação (esgotados os 9 sufixos, aí sim recusa com correção).
 *   2. **FIM DE FUNIL já ocupado por outra coluna ativa**: a linha volta SEM a marca.
 *      Pelas actions de hoje isso é inalcançável (`arquivarEstagio` recusa arquivar fim
 *      de funil, logo nada arquivado o tem) — a guarda custa duas linhas e deixa esta
 *      action segura para QUALQUER linha arquivada que um dia exista por outro caminho.
 *
 * Idempotente: reabrir o que já está no quadro devolve o estado atual sem reclamar.
 * Teto de 12 colunas ativas vale aqui também — reabrir é ganhar uma coluna de volta.
 */
export async function reabrirEstagio(
  input: ReabrirEstagioInput,
): Promise<ServiceResult<EstagioDoFunil>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(reabrirInput, input);

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);
      const atual = await carregarEstagio(tx, dados.id);

      if (!atual.archivedAt) {
        return {
          ...atual,
          totalNegocios: await contarNegociosNoEstagio(tx, tenantId, atual.id),
        };
      }

      const ativos = await tx
        .select({
          id: pipelineStages.id,
          label: pipelineStages.label,
          position: pipelineStages.position,
          isWon: pipelineStages.isWon,
          isLost: pipelineStages.isLost,
        })
        .from(pipelineStages)
        .where(and(eq(pipelineStages.tenantId, tenantId), isNull(pipelineStages.archivedAt)))
        .orderBy(asc(pipelineStages.position), asc(pipelineStages.createdAt));

      if (ativos.length >= MAX_ESTAGIOS) {
        throw new ServiceError(
          'CONFLITO',
          `O funil já tem ${MAX_ESTAGIOS} colunas — o máximo.`,
          { correcao: 'Arquivar uma coluna ativa antes de reabrir outra' },
        );
      }

      // Regra 1 — rótulo. Sufixo determinístico, com o CHECK de 80 caracteres do banco
      // como teto (o corpo encolhe para caber, o sufixo é sagrado: é ele que distingue).
      const ocupado = (candidato: string): boolean =>
        ativos.some((e) => e.label.toLowerCase() === candidato.toLowerCase());
      let rotuloFinal = atual.label;
      if (ocupado(rotuloFinal)) {
        const comSufixo = (n: number): string => {
          const sufixo = n === 1 ? ' (arquivada)' : ` (arquivada ${n})`;
          return `${atual.label.slice(0, Math.max(1, 80 - sufixo.length))}${sufixo}`;
        };
        let livre = false;
        for (let n = 1; n <= 9 && !livre; n += 1) {
          if (!ocupado(comSufixo(n))) {
            rotuloFinal = comSufixo(n);
            livre = true;
          }
        }
        if (!livre) {
          throw new ServiceError(
            'CONFLITO',
            `Já existe uma coluna ativa com o nome "${atual.label}".`,
            { campo: 'label', correcao: 'Renomear a coluna ativa antes de reabrir esta' },
          );
        }
      }

      // Regra 2 — fim de funil ocupado volta sem a marca (ver docblock).
      let isWon = atual.isWon;
      let isLost = atual.isLost;
      if (isWon && ativos.some((e) => e.isWon)) isWon = false;
      if (isLost && ativos.some((e) => e.isLost)) isLost = false;

      // Entra no fim do aberto: abre espaço como o `criarEstagio` faz — tudo daquela
      // posição em diante desce um. A própria linha não desce: está arquivada, fora do
      // `isNull(archivedAt)` do WHERE de propósito.
      const posicao = posicaoFimDoAberto(ativos);
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

      const [linha] = await tx
        .update(pipelineStages)
        .set({
          archivedAt: null,
          position: posicao,
          label: rotuloFinal,
          isWon,
          isLost,
          updatedAt: new Date(),
        })
        .where(and(eq(pipelineStages.id, dados.id), isNotNull(pipelineStages.archivedAt)))
        .returning(COLUNAS);

      const final = linha ?? (await carregarEstagio(tx, dados.id));

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'pipeline_stage.reopened',
        entity: 'pipeline_stage',
        entityId: dados.id,
        // De/para sempre: iguais quando o rótulo não conflitou — é o que conta a
        // história completa quando alguém perguntar por que a coluna voltou com outro nome.
        metadata: { de: atual.label, para: rotuloFinal, position: posicao },
      });

      return { ...final, totalNegocios: await contarNegociosNoEstagio(tx, tenantId, final.id) };
    });
  });
}
