'use server';

import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { activities, contacts, deals, member, pipelineStages, user, type Deal } from '@/db/schema';
import {
  filtroDeEscopoProprio,
  withTenant,
  type TenantDb,
} from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { exigirContaAtiva } from './subscriptionGate';
import { registrarAuditoria } from './audit';
import { parseDataFlexivel } from './normalize';
import { resolverPeriodo, type PeriodoInput } from './periodo';
import { escopoDaSessao } from './escopo';
import { semearEstagiosPadrao } from './pipelineStagesDefaults';

/**
 * O funil — o serviço que faltava atrás de `FunnelScreen.tsx` e do topo de `TodayScreen.tsx`
 * (S4). Mesmas quatro regras de `contacts.ts`/`proposals.ts`: `tenantId` vem da sessão, toda
 * query dentro de `withTenant`, `tenant_id` nunca vem do corpo da requisição, entrada
 * validada com zod antes de tocar no banco.
 *
 * DUAS DECISÕES QUE PRECISAM ESTAR ESCRITAS EM ALGUM LUGAR, e este é o lugar — o contrato
 * completo (com exemplos) está em `docs/handoffs/rafa-para-nina.md`:
 *
 * 1. VOCABULÁRIO DE ESTÁGIO, 6 no banco → 5 no quadro. `deals.stage` tem seis valores
 *    (`novo, cotando, proposta_enviada, negociando, ganho, perdido`); o quadro tem cinco
 *    colunas porque `perdido` NÃO é coluna — é uma saída do funil, não um lugar onde o
 *    negócio fica. Mapeamento (ver `COLUNAS_DO_FUNIL` em `./dealStages`, fonte única para
 *    não a UI e o servidor divergirem de novo):
 *
 *      novo             → "Novo contato"
 *      cotando          → "Montando"
 *      proposta_enviada → "Enviada"
 *      negociando       → "Negociando"
 *      ganho            → "Fechada"
 *      perdido          → (sem coluna — sai da lista de `listarNegociosDoFunil`)
 *
 * 2. "OS DOIS NÚMEROS DO TOPO" do Hoje (`obterResumoDoPipeline`). Recorte que eu escolhi:
 *    "em negociação" é a soma de `valueCents` de todo negócio que não é `ganho` nem
 *    `perdido` (dito de outro jeito: dinheiro que ainda pode virar venda, sem recorte de tempo —
 *    um negócio parado há 60 dias ainda é dinheiro em aberto). "Fechado no mês" é a soma de
 *    `valueCents` dos negócios `ganho` cujo `closed_at` cai no mês corrente (UTC,
 *    [1º dia 00:00, 1º dia do mês seguinte 00:00) ). `closed_at` — não `updated_at` — é o
 *    carimbo de quando o negócio fechou: `moverEstagioDoNegocio` grava nele sempre que o
 *    novo estágio é `ganho`/`perdido`, e o seed (`src/db/seed.ts`) já segue essa convenção.
 *    Negócio que nasceu `ganho` sem nunca passar por `moverEstagioDoNegocio` (import futuro,
 *    por exemplo) não teria `closed_at` e ficaria de fora do "fechado no mês" — aceito
 *    conscientemente: o caminho normal (arrastar/mover no funil) sempre passa por
 *    `moverEstagioDoNegocio`, então sempre grava `closed_at`.
 *
 * TERCEIRA DECISÃO, menor mas vale registrar: somas (`obterResumoDoPipeline`)
 * são feitas em JAVASCRIPT depois de buscar as linhas, não com
 * `sum()` no SQL. Motivo: `value_cents` é `bigint`, e `sum(bigint)` volta `numeric` do
 * Postgres — um tipo que o driver (`postgres.js`) devolve como STRING para não perder
 * precisão, e essa conversão de string→number NÃO é a mesma que o Drizzle aplica à coluna
 * `bigint` com `mode: 'number'` (essa é por-coluna, não por resultado de agregação). Somar em
 * JS a partir de linhas já tipadas evita esse cast manual e o risco de silenciosamente somar
 * strings ("12" + "34" = "1234"). No volume esperado (10–15 vendas/mês por tenant) isto é
 * seguro e mais simples do que fazer `sum(...)::text` e fazer o parse na mão; revisitar se um
 * tenant crescer ao ponto de "todos os negócios abertos" deixar de caber numa query.
 */

// ---------------------------------------------------------------------------
// Estágio: tipos e o mapeamento 6↔5 documentado acima
// ---------------------------------------------------------------------------

export type DealStage = Deal['stage'];

/** Estágio que aparece no quadro — todo `DealStage` exceto `perdido`. */
export type EstagioDeFunil = Exclude<DealStage, 'perdido'>;

const ESTAGIOS = [
  'novo',
  'cotando',
  'proposta_enviada',
  'negociando',
  'ganho',
  'perdido',
] as const;

// `COLUNAS_DO_FUNIL` mora em `./dealStages` — este arquivo é `'use server'` e só
// pode exportar função assíncrona; uma constante aqui quebra o build do Next.

// ---------------------------------------------------------------------------
// S16: a coluna do funil como FK (`deals.stage_id` → `pipeline_stages`)
// ---------------------------------------------------------------------------
//
// A partir da 0016 o negócio aponta para uma LINHA de `pipeline_stages` — inclusive para
// uma coluna que a agente criou, que não tem equivalente no enum. `deals.stage` continua
// existindo como PROJEÇÃO da FK, mantida pelo trigger `deals_estagio_sync` no banco: quem
// grava id ganha o enum derivado, quem grava enum ganha o id resolvido. O contrato inteiro
// está no cabeçalho de `drizzle/0016_negocio_aponta_para_estagio.sql`.
//
// O QUE ISSO SIGNIFICA PARA QUEM LÊ ESTE ARQUIVO: `is_won`/`is_lost` de `pipeline_stages`
// são a fonte de verdade de "fechou como ganho/perdido". As queries daqui passaram a
// filtrar por eles (join), não mais por `stage in ('ganho','perdido')` — e as comparações
// literais que sobraram em outros arquivos continuam certas porque o trigger DERIVA o enum
// desses dois booleanos, nunca o contrário.

/** Para onde mover/criar: o enum de sempre, ou a coluna do funil pelo id. */
export type DestinoDeEstagio = DealStage | { stageId: string };

type EstagioAlvo = {
  id: string;
  label: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
  /** O valor de `deals.stage` que este estágio produz — o mesmo espelho do trigger. */
  stage: DealStage;
};

const estagioAlvoColunas = {
  id: pipelineStages.id,
  legacyStage: pipelineStages.legacyStage,
  label: pipelineStages.label,
  position: pipelineStages.position,
  isWon: pipelineStages.isWon,
  isLost: pipelineStages.isLost,
  archivedAt: pipelineStages.archivedAt,
} as const;

type LinhaDeEstagio = {
  id: string;
  legacyStage: DealStage | null;
  label: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
  archivedAt?: Date | null;
};

/**
 * O espelho enum↔estágio, do lado da aplicação. Tem que ser BIT A BIT o mesmo `CASE` do
 * trigger `deals_sincronizar_estagio` (0016) — se um dia divergirem, o valor que vale é o
 * do banco (ele roda por último, no BEFORE), e a diferença apareceria como "o retorno da
 * action não bate com o que ficou gravado".
 */
function espelhoDoEnum(estagio: LinhaDeEstagio): DealStage {
  if (estagio.legacyStage) return estagio.legacyStage;
  if (estagio.isWon) return 'ganho';
  if (estagio.isLost) return 'perdido';
  return 'negociando';
}

function comoAlvo(estagio: LinhaDeEstagio): EstagioAlvo {
  return {
    id: estagio.id,
    label: estagio.label,
    position: estagio.position,
    isWon: estagio.isWon,
    isLost: estagio.isLost,
    stage: espelhoDoEnum(estagio),
  };
}

/**
 * Resolve o destino (enum antigo OU `stageId`) na linha de `pipeline_stages` do tenant.
 *
 * Pelo ENUM: procura o estágio com aquele `legacy_stage`. Se o tenant ainda não tem funil
 * (nasceu fora de `criarTenant` — seed, teste), semeia o de fábrica e procura de novo; é o
 * mesmo comportamento do trigger, feito aqui para poder devolver o rótulo junto.
 *
 * Pelo ID: exige que a coluna exista NESTE tenant (a policy de `pipeline_stages` já faz o
 * id de outro tenant sumir) e que não esteja arquivada — coluna arquivada saiu do quadro,
 * mandar negócio para lá é criar um negócio invisível.
 */
async function resolverEstagio(
  tx: TenantDb,
  tenantId: string,
  destino: DestinoDeEstagio,
): Promise<EstagioAlvo> {
  if (typeof destino === 'string') {
    const parsed = z.enum(ESTAGIOS).safeParse(destino);
    if (!parsed.success) {
      throw new ServiceError('DADOS_INVALIDOS', 'Esse estágio não existe.', {
        campo: 'novoEstagio',
        correcao: 'Escolher um estágio válido',
      });
    }

    const buscar = async (): Promise<LinhaDeEstagio | undefined> => {
      const [linha] = await tx
        .select(estagioAlvoColunas)
        .from(pipelineStages)
        .where(
          and(
            eq(pipelineStages.tenantId, tenantId),
            eq(pipelineStages.legacyStage, parsed.data),
          ),
        )
        .limit(1);
      return linha;
    };

    let linha = await buscar();
    if (!linha) {
      await semearEstagiosPadrao(tx, tenantId);
      linha = await buscar();
    }
    if (!linha) {
      throw new ServiceError('NAO_ENCONTRADO', 'Essa coluna não existe mais.', {
        correcao: 'Recarregar o funil',
      });
    }
    return comoAlvo(linha);
  }

  const stageId = z.uuid().safeParse(destino?.stageId);
  if (!stageId.success) {
    throw new ServiceError('DADOS_INVALIDOS', 'Essa coluna não existe.', {
      campo: 'stageId',
      correcao: 'Escolher uma coluna do funil',
    });
  }

  const [linha] = await tx
    .select(estagioAlvoColunas)
    .from(pipelineStages)
    .where(and(eq(pipelineStages.tenantId, tenantId), eq(pipelineStages.id, stageId.data)))
    .limit(1);

  if (!linha) {
    throw new ServiceError('NAO_ENCONTRADO', 'Essa coluna não existe mais.', {
      campo: 'stageId',
      correcao: 'Recarregar o funil',
    });
  }
  if (linha.archivedAt) {
    throw new ServiceError('CONFLITO', 'Essa coluna está arquivada.', {
      campo: 'stageId',
      correcao: 'Escolher uma coluna ativa do funil',
    });
  }
  return comoAlvo(linha);
}

// ---------------------------------------------------------------------------
// Helpers de data — nada de PII aqui, só aritmética de `Date`.
// ---------------------------------------------------------------------------

function maisRecente(a: Date, b: Date | null): Date {
  if (!b) return a;
  return b.getTime() > a.getTime() ? b : a;
}

/** Dias corridos desde `data`. Nunca negativo (relógio adiantado no cliente não gera "-1 dia"). */
function diasDesde(data: Date, agora: number): number {
  return Math.max(0, Math.floor((agora - data.getTime()) / 86_400_000));
}

/**
 * `sql<Date>()` livre (não ligado a uma coluna do schema) NÃO passa pelo mapeamento
 * `mapFromDriverValue` que o Drizzle aplica a colunas de verdade — comprovado testando
 * contra o Postgres de teste antes de fechar este arquivo (não só `tsc --noEmit`): o valor
 * chega na aplicação como a representação textual crua do driver
 * (`"2026-09-06 01:03:21.925+00"`), nunca como instância de `Date`, mesmo com `::timestamptz`
 * no SQL. Toda leitura de `ultimaAtividadeSql()` (abaixo) passa por aqui antes de qualquer
 * comparação de data — sem isto, `maisRecente()` compararia `Date` com `string` e o "dias
 * parado" de todo negócio com atividade ficaria simplesmente errado, calado, sem lançar erro.
 */
function paraDataOuNula(valor: string | null): Date | null {
  if (valor === null) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

/**
 * Subquery correlacionada de "última atividade do negócio" — usada em
 * `listarNegociosDoFunil`.
 *
 * ATENÇÃO PARA QUEM FOR COPIAR ESTE PADRÃO: os nomes de coluna aqui são LITERAIS
 * (`deals.id`, `activities.deal_id`), não `${deals.id}`/`${activities.dealId}` do Drizzle.
 * Isso é DE PROPÓSITO, não descuido — comprovado contra o Postgres de teste: quando um
 * `sql<>` é usado como VALOR de `.select({...})` (em vez de dentro de `.where()`/`.having()`
 * da própria query), o Drizzle renderiza `${coluna}` SEM qualificar a tabela (`"id"`, não
 * `"deals"."id"`). Dentro desta subquery correlacionada isso é catastrófico: como
 * `activities` também tem uma coluna `id`, `${activities.dealId} = ${deals.id}` vira
 * `"deal_id" = "id"` — e dentro do escopo da subquery (`from activities`), `"id"` desambigua
 * para `activities.id`, não para o `deals.id` de fora. A condição deixa de ser uma
 * correlação com o negócio e passa a comparar `activities.deal_id = activities.id`, o que é
 * (quase) sempre falso — a função voltaria sempre `null`, silenciosamente.
 *
 * MESMO BUG JÁ EXISTIA em produção: `obterContato` (`src/server/contacts.ts`,
 * `totalViajantes`/`totalNegocios`) usa exatamente esse padrão com `${travelers.contactId} =
 * ${contacts.id}` e, pela mesma razão, sempre soma zero. Corrigido junto (ver
 * `docs/status/rafa.md`) — mas fica documentado aqui, no ponto onde o próximo dev vai copiar
 * o padrão de subquery, para o erro não nascer pela terceira vez.
 *
 * Funciona apenas porque `deals`/`activities` nunca são referenciadas com alias nestas duas
 * queries (`.from(deals)`, sem `.as(...)`) — se um dia isso mudar, esta string literal
 * precisa mudar junto.
 */
function ultimaAtividadeSql() {
  return sql<string | null>`(select max(a.occurred_at) from activities a where a.deal_id = deals.id)`;
}

// ---------------------------------------------------------------------------
// 1) Board do funil
// ---------------------------------------------------------------------------

export type NegocioDoFunil = {
  id: string;
  title: string;
  destination: string | null;
  valueCents: number;
  /**
   * O enum de sempre — projeção de `stageId`, mantida pelo banco. Continua aqui porque
   * `/funil` ainda monta as colunas por `COLUNAS_DO_FUNIL`. Negócio numa coluna criada
   * pela agente sai como `negociando` (ver a 0016): use `stageId` para posicionar o card.
   */
  stage: EstagioDeFunil;
  /** A coluna de verdade (`pipeline_stages.id`) — é por aqui que o quadro configurável monta. */
  stageId: string;
  stageLabel: string;
  stagePosition: number;
  contactId: string;
  contactName: string;
  /**
   * Quem vende (Fase 3, §8): o monograma do card e o alternador "Meus / Time" leem
   * daqui. `null` em negócio sem vendedor definido (dado antigo/importado).
   */
  agentId: string | null;
  agentName: string | null;
  /** `AAAA-MM-DD`, ou `null` quando a data da viagem ainda não foi decidida. */
  departureOn: string | null;
  /** Dias desde a última movimentação: o maior entre `deals.updatedAt` e a `activity` mais recente do negócio. */
  diasParado: number;
};

/**
 * Board pronto: todo negócio do tenant que não é `perdido` (perdido não tem coluna — ver
 * o comentário de topo do arquivo), com o contato já resolvido e os dias parados já
 * calculados. Limite de 500 é rede de segurança, não paginação de produto — no volume
 * esperado (MEI, 10-15 vendas/mês) um tenant não chega perto disso tão cedo; se chegar,
 * quem cresceu para além desta função é sinal de que o funil precisa de paginação/arquivo,
 * não de um limite maior aqui.
 *
 * Fase 3 (§4): o ESCOPO vem da sessão — dono vê o tenant inteiro, agente vê só o próprio
 * trabalho (alternador "Meus / Time" da tela). O filtro é de PRODUTO, fora do RLS: para
 * o `kind: 'own'` é este WHERE que separa, e quem decide é `escopoDaSessao` aqui no
 * service layer.
 */
export async function listarNegociosDoFunil(): Promise<ServiceResult<NegocioDoFunil[]>> {
  return comoResultado(async () => {
    const ctx = await requireAuthContext();
    const escopo = escopoDaSessao(ctx);

    return withTenant(
      ctx.tenantId,
      async (tx) => {
        const linhas = await tx
          .select({
            id: deals.id,
            title: deals.title,
            destination: deals.destination,
            valueCents: deals.valueCents,
            stage: deals.stage,
            stageId: pipelineStages.id,
            stageLabel: pipelineStages.label,
            stagePosition: pipelineStages.position,
            departureOn: deals.departureOn,
            updatedAt: deals.updatedAt,
            contactId: deals.contactId,
            contactName: contacts.name,
            agentId: deals.agentId,
            agentName: user.name,
            ultimaAtividadeEm: ultimaAtividadeSql(),
          })
          .from(deals)
          .innerJoin(contacts, eq(contacts.id, deals.contactId))
          .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
          // LEFT: negócio sem vendedor definido (dado antigo) continua no quadro.
          .leftJoin(user, eq(user.id, deals.agentId))
          // "Perdido" saiu do quadro pela SEMÂNTICA, não pelo literal: quem manda é
          // `is_lost` da coluna do funil (0016). Mesmo resultado de antes para o funil de
          // fábrica, e correto também para um funil renomeado pela agente. O segundo
          // termo é o escopo do papel: `undefined` para dono (tenant inteiro), o filtro
          // por `agent_id` para agente.
          .where(and(eq(pipelineStages.isLost, false), filtroDeEscopoProprio(escopo, deals.agentId)))
          .orderBy(desc(deals.createdAt))
          .limit(500);

        const agora = Date.now();
        return linhas.map((linha) => ({
          id: linha.id,
          title: linha.title,
          destination: linha.destination,
          valueCents: linha.valueCents,
          // Seguro: a query já excluiu 'perdido' no WHERE — o cast só remove esse único
          // valor do tipo, não muda o dado.
          stage: linha.stage as EstagioDeFunil,
          stageId: linha.stageId,
          stageLabel: linha.stageLabel,
          stagePosition: linha.stagePosition,
          contactId: linha.contactId,
          contactName: linha.contactName,
          agentId: linha.agentId,
          agentName: linha.agentName,
          departureOn: linha.departureOn,
          diasParado: diasDesde(
            maisRecente(linha.updatedAt, paraDataOuNula(linha.ultimaAtividadeEm)),
            agora,
          ),
        }));
      },
      { scope: escopo },
    );
  });
}

// ---------------------------------------------------------------------------
// 2) Mover de estágio — o que o arrasto do kanban chama
// ---------------------------------------------------------------------------

export type NegocioMovido = {
  id: string;
  stage: DealStage;
  /** A coluna do funil onde o negócio ficou — `pipeline_stages.id`. */
  stageId: string;
  stageLabel: string;
  /** Fechou como ganho / como perdido, direto de `pipeline_stages`. */
  isWon: boolean;
  isLost: boolean;
  lostReason: string | null;
  closedAt: Date | null;
  updatedAt: Date;
};

async function buscarNegocioMovido(tx: TenantDb, dealId: string): Promise<NegocioMovido> {
  const [linha] = await tx
    .select({
      id: deals.id,
      stage: deals.stage,
      stageId: pipelineStages.id,
      stageLabel: pipelineStages.label,
      isWon: pipelineStages.isWon,
      isLost: pipelineStages.isLost,
      lostReason: deals.lostReason,
      closedAt: deals.closedAt,
      updatedAt: deals.updatedAt,
    })
    .from(deals)
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .where(eq(deals.id, dealId))
    .limit(1);
  // Não deveria faltar: quem chama já confirmou a existência da linha antes disto.
  return linha!;
}

/**
 * Move o negócio de estágio. `motivoPerda` é OBRIGATÓRIO quando `novoEstagio === 'perdido'`
 * (decisão travada do roteiro — "motivo de perda obrigatório"); erro amigável se faltar.
 *
 * Sem máquina de estados: não valida se a transição "faz sentido" (voltar de `negociando`
 * para `cotando`, pular direto de `novo` para `ganho`) — o funil de vendas de verdade pula
 * e volta de estágio o tempo todo, e travar isso é o tipo de regra que a agente vai preferir
 * quebrar arrastando o card de qualquer jeito. Mesma filosofia de
 * `atualizarStatusComissao` em `sales.ts`.
 *
 * **Idempotente/seguro sob clique duplo.** Dois caminhos garantem isso:
 *   1. Se o negócio JÁ está no estágio pedido no momento do SELECT, a função não grava
 *      nada e devolve o estado atual — o caminho feliz sequencial.
 *   2. Sob concorrência de verdade (duas chamadas quase simultâneas movendo para o MESMO
 *      estágio), o `UPDATE ... WHERE stage <> novoEstagio` da segunda chamada reavalia a
 *      condição contra a linha já commitada pela primeira, encontra `stage = novoEstagio`
 *      e afeta zero linhas — sem gravar uma segunda `activity`, sem erro. Mesma doutrina de
 *      `converterPropostaEmVenda`/`gerarParcelasDaVenda` em `sales.ts`: o banco garante,
 *      não a sorte de a interface nunca disparar duas vezes.
 *
 * `closedAt`: gravado com `now()` sempre que o novo estágio é `ganho` ou `perdido`, e
 * limpo (`null`) ao sair de um desses dois de volta para um estágio aberto — reabrir um
 * negócio fechado não pode deixar `closed_at` de uma venda que "fechou" no mês passado
 * mentindo para `obterResumoDoPipeline`. `lostReason` segue a mesma regra: só existe
 * enquanto o negócio está `perdido`.
 *
 * **S16 — aceita os DOIS destinos, e nada quebrou.** `novoEstagio` continua aceitando o
 * enum (`'ganho'`, `'perdido'`…) exatamente como antes, e passa a aceitar também
 * `{ stageId }` — a coluna do funil pelo id, inclusive uma criada pela agente. Escolhi a
 * união no MESMO parâmetro em vez de uma action nova (`moverNegocioParaColuna`) porque as
 * duas fariam a mesma coisa e a duplicata é onde uma regra (motivo de perda, `closedAt`,
 * idempotência) acaba implementada de dois jeitos meio diferentes. Toda chamada existente
 * compila e se comporta igual.
 *
 * "É perda?" deixou de ser `estagio === 'perdido'` e passou a ser `alvo.isLost` — a
 * propriedade da COLUNA. É isso que faz o motivo de perda continuar obrigatório mesmo se a
 * agente renomear "Perdida" para "Não rolou".
 */
export async function moverEstagioDoNegocio(
  dealId: string,
  novoEstagio: DestinoDeEstagio,
  motivoPerda?: string,
): Promise<ServiceResult<NegocioMovido>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const motivo = motivoPerda?.trim() ?? '';

    const exigirMotivo = (): void => {
      if (motivo.length < 3) {
        throw new ServiceError(
          'DADOS_INVALIDOS',
          'Diga por que essa venda foi perdida antes de arquivar.',
          { campo: 'motivoPerda', correcao: 'Escrever o motivo da perda' },
        );
      }
    };

    // Destino pelo enum: valida ANTES de abrir transação, como sempre fez — assim uma
    // chamada mal formada não custa conexão nem passa pelo gate de dunning (a ordem dos
    // erros que a tela já conhece não muda). Pelo `stageId` não dá: só o banco sabe se
    // aquela coluna é a de perda deste tenant.
    if (typeof novoEstagio === 'string') {
      if (!z.enum(ESTAGIOS).safeParse(novoEstagio).success) {
        throw new ServiceError('DADOS_INVALIDOS', 'Esse estágio não existe.', {
          campo: 'novoEstagio',
          correcao: 'Escolher um estágio válido',
        });
      }
      if (novoEstagio === 'perdido') exigirMotivo();
    }

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);

      const alvo = await resolverEstagio(tx, tenantId, novoEstagio);
      if (alvo.isLost) exigirMotivo();

      const [atual] = await tx
        .select({ id: deals.id, stage: deals.stage, stageId: deals.stageId })
        .from(deals)
        .where(eq(deals.id, dealId))
        .limit(1);

      if (!atual) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse negócio não existe mais.', {
          correcao: 'Voltar para o funil',
        });
      }

      if (atual.stageId === alvo.id) {
        return buscarNegocioMovido(tx, dealId);
      }

      const agora = new Date();
      const fechou = alvo.isWon || alvo.isLost;
      const valores: Record<string, unknown> = {
        // Os dois de propósito: o trigger derivaria `stage` sozinho, mas gravar o valor
        // que a aplicação calculou deixa a divergência (se um dia houver) aparecer no
        // `returning`, em vez de ficar escondida.
        stageId: alvo.id,
        stage: alvo.stage,
        updatedAt: agora,
        closedAt: fechou ? agora : null,
        lostReason: alvo.isLost ? motivo : null,
      };

      const linhas = await tx
        .update(deals)
        .set(valores)
        // A guarda de concorrência agora é por `stage_id` (a coluna de verdade): duas
        // chamadas simultâneas para a MESMA coluna e a segunda afeta zero linhas.
        .where(and(eq(deals.id, dealId), ne(deals.stageId, alvo.id)))
        .returning({ id: deals.id });

      if (linhas.length > 0) {
        await tx.insert(activities).values({
          tenantId,
          dealId,
          actorUserId: userId,
          type: 'stage_changed',
          // `body`/`metadata.de`/`metadata.para` seguem em valor de ENUM, de propósito:
          // `NegocioScreen.tsx` reconstrói a frase da timeline a partir dessa metadata
          // (`STAGE_LABEL[de]`) e monta a versão otimista no mesmo formato. Mudar para
          // rótulo aqui quebraria a linha do tempo da tela sem avisar. Os ids vão junto,
          // como campo NOVO, para a Nina poder passar a usar rótulo quando quiser.
          body: alvo.isLost
            ? `Marcado como perdido: ${motivo}`
            : `Movido de ${atual.stage} para ${alvo.stage}.`,
          metadata: {
            de: atual.stage,
            para: alvo.stage,
            deStageId: atual.stageId,
            paraStageId: alvo.id,
            paraLabel: alvo.label,
            ...(alvo.isLost ? { motivoPerda: motivo } : {}),
          },
          occurredAt: agora,
        });

        await registrarAuditoria(tx, {
          tenantId,
          actorUserId: userId,
          action: 'deal.stage_changed',
          entity: 'deal',
          entityId: dealId,
          metadata: {
            de: atual.stage,
            para: alvo.stage,
            deStageId: atual.stageId,
            paraStageId: alvo.id,
          },
        });
      }

      return buscarNegocioMovido(tx, dealId);
    });
  });
}

// ---------------------------------------------------------------------------
// 3) Criar negócio a partir de um contato
// ---------------------------------------------------------------------------

/** `AAAA-MM-DD`/`DD/MM/AAAA` opcional. String vazia e `undefined` viram `undefined` (sem data). */
const dataOpcionalInput = z
  .string()
  .trim()
  .max(20)
  .optional()
  .or(z.literal(''))
  .transform((value, ctx) => {
    if (!value) return undefined;
    const iso = parseDataFlexivel(value);
    if (!iso) {
      ctx.addIssue({ code: 'custom', message: 'Data inválida' });
      return z.NEVER;
    }
    return iso;
  });

const criarNegocioInput = z.object({
  contactId: z.uuid('Escolha um contato'),
  title: z.string().trim().min(2, 'Dê um título ao negócio').max(200),
  destination: z.string().trim().max(200).optional().or(z.literal('')),
  currency: z.string().trim().length(3, 'Use o código de 3 letras (BRL, USD...)').optional(),
  valueCents: z.number().int().min(0).optional(),
  paxAdults: z.number().int().min(1).max(50).optional(),
  paxChildren: z.number().int().min(0).max(50).optional(),
  departureOn: dataOpcionalInput,
  returnOn: dataOpcionalInput,
  expectedCloseOn: dataOpcionalInput,
  /**
   * S16 — em qual coluna do funil o negócio nasce (`pipeline_stages.id`). OMITIDO =
   * "Novo contato" (o `legacyStage: 'novo'`), que é o comportamento de sempre.
   */
  stageId: z.uuid('Escolha uma coluna do funil').optional(),
});

export type CriarNegocioInput = z.infer<typeof criarNegocioInput>;

/**
 * Criação básica: sem `stageId`, nasce na coluna `novo` ("Novo contato") e moeda BRL se
 * omitida. Com `stageId`, nasce na coluna escolhida — desde que ela esteja ATIVA e não
 * seja fim de funil: negócio não nasce ganho nem perdido (ganho exige a venda que ainda
 * não existe; perdido exige motivo de perda, que `criarNegocio` não pede). Quem quiser um
 * negócio já fechado cria e move, passando por `moverEstagioDoNegocio`, que é onde as
 * regras de fechamento moram.
 */
export async function criarNegocio(
  input: CriarNegocioInput,
): Promise<ServiceResult<NegocioDoFunil>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const parsed = criarNegocioInput.safeParse(input);
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
        campo: primeiro?.path.join('.'),
        correcao: 'Corrigir e tentar de novo',
      });
    }
    const dados = parsed.data;

    if (dados.departureOn && dados.returnOn && dados.returnOn < dados.departureOn) {
      throw new ServiceError('DADOS_INVALIDOS', 'A volta não pode ser antes da ida.', {
        campo: 'returnOn',
        correcao: 'Corrigir as datas',
      });
    }

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const [contato] = await tx
        .select({ id: contacts.id, name: contacts.name })
        .from(contacts)
        .where(eq(contacts.id, dados.contactId))
        .limit(1);

      if (!contato) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse contato não existe mais.', {
          campo: 'contactId',
          correcao: 'Escolher outro contato',
        });
      }

      const alvo = await resolverEstagio(
        tx,
        tenantId,
        dados.stageId ? { stageId: dados.stageId } : 'novo',
      );

      if (alvo.isWon || alvo.isLost) {
        throw new ServiceError('CONFLITO', 'Um negócio não nasce fechado.', {
          campo: 'stageId',
          correcao: 'Criar numa coluna aberta e mover depois',
        });
      }

      const [criado] = await tx
        .insert(deals)
        .values({
          tenantId,
          stageId: alvo.id,
          stage: alvo.stage,
          contactId: contato.id,
          // Fase 3 (§5): o default é QUEM CRIOU. Reatribuir é outra ação — dono via
          // `atualizarNegocio` —, nunca este INSERT adivinhando.
          agentId: userId,
          title: dados.title,
          destination: dados.destination?.trim() || null,
          currency: dados.currency?.toUpperCase() ?? 'BRL',
          valueCents: dados.valueCents ?? 0,
          paxAdults: dados.paxAdults ?? 1,
          paxChildren: dados.paxChildren ?? 0,
          departureOn: dados.departureOn ?? null,
          returnOn: dados.returnOn ?? null,
          expectedCloseOn: dados.expectedCloseOn ?? null,
        })
        .returning({
          id: deals.id,
          title: deals.title,
          destination: deals.destination,
          valueCents: deals.valueCents,
          stage: deals.stage,
          departureOn: deals.departureOn,
          contactId: deals.contactId,
        });

      const negocio = criado!;

      // Nome do criador para o board (o board mostra quem carrega o negócio).
      const [criador] = await tx
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'deal.created',
        entity: 'deal',
        entityId: negocio.id,
        metadata: { contactId: contato.id, stageId: alvo.id },
      });

      return {
        id: negocio.id,
        title: negocio.title,
        destination: negocio.destination,
        valueCents: negocio.valueCents,
        // Fase 3 (§5): nasce com o criador — devolvido igual ao board lista.
        agentId: userId,
        agentName: criador?.name ?? null,
        // Seguro: `alvo` já foi recusado se fosse fim de funil — nunca 'perdido' aqui.
        stage: negocio.stage as EstagioDeFunil,
        stageId: alvo.id,
        stageLabel: alvo.label,
        stagePosition: alvo.position,
        contactId: negocio.contactId,
        contactName: contato.name,
        departureOn: negocio.departureOn,
        diasParado: 0,
      };
    });
  });
}

// ---------------------------------------------------------------------------
// 4) Detalhe do negócio + timeline (`activities`) — para a futura tela de detalhe
// ---------------------------------------------------------------------------

export type AtividadeDoNegocio = {
  id: string;
  /** Ver o enum de `activities.type` em `src/db/schema/pipeline.ts`. */
  type: string;
  body: string | null;
  metadata: Record<string, unknown>;
  actorUserId: string | null;
  occurredAt: Date;
};

export type NegocioDetalhe = {
  id: string;
  title: string;
  destination: string | null;
  /** Projeção do estágio (ver `NegocioDoFunil.stage`). A coluna de verdade é `stageId`. */
  stage: DealStage;
  stageId: string;
  stageLabel: string;
  isWon: boolean;
  isLost: boolean;
  currency: string;
  valueCents: number;
  costCents: number;
  commissionCents: number;
  paxAdults: number;
  paxChildren: number;
  departureOn: string | null;
  returnOn: string | null;
  expectedCloseOn: string | null;
  lostReason: string | null;
  closedAt: Date | null;
  contactId: string;
  contactName: string;
  /**
   * Fase 3 (§5) — de quem é o negócio, MESMO shape do quadro (`NegocioDoFunil`).
   * `null`/`null` = sem vendedor (dado antigo) — é o valor que o select de
   * reatribuição mostra como estado ATUAL, inclusive em negócio PERDIDO, que o quadro
   * não devolve (`isLost` fica fora da listagem).
   */
  agentId: string | null;
  agentName: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Mais recente primeiro. */
  activities: AtividadeDoNegocio[];
};

/**
 * Helper interno: busca o `NegocioDetalhe` completo (negócio + timeline) dentro
 * de uma transação já aberta. Compartilhado entre `obterNegocio` (leitura) e
 * `atualizarNegocio` (escrita que devolve o estado reconciliado).
 */
async function buscarNegocioDetalhe(tx: TenantDb, dealId: string): Promise<NegocioDetalhe> {
  const [negocio] = await tx
    .select({
      id: deals.id,
      title: deals.title,
      destination: deals.destination,
      stage: deals.stage,
      stageId: pipelineStages.id,
      stageLabel: pipelineStages.label,
      isWon: pipelineStages.isWon,
      isLost: pipelineStages.isLost,
      currency: deals.currency,
      valueCents: deals.valueCents,
      costCents: deals.costCents,
      commissionCents: deals.commissionCents,
      paxAdults: deals.paxAdults,
      paxChildren: deals.paxChildren,
      departureOn: deals.departureOn,
      returnOn: deals.returnOn,
      expectedCloseOn: deals.expectedCloseOn,
      lostReason: deals.lostReason,
      closedAt: deals.closedAt,
      contactId: deals.contactId,
      contactName: contacts.name,
      // Fase 3 (§5): o MESMO LEFT JOIN do quadro — a ficha sabe de quem é o negócio
      // sem segunda leitura, e o retorno do `atualizarNegocio` (que passa por aqui)
      // reconcilia o select de vendedor na hora, com o valor recém-gravado.
      agentId: deals.agentId,
      agentName: user.name,
      createdAt: deals.createdAt,
      updatedAt: deals.updatedAt,
    })
    .from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId))
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .leftJoin(user, eq(user.id, deals.agentId))
    .where(eq(deals.id, dealId))
    .limit(1);

  if (!negocio) {
    throw new ServiceError('NAO_ENCONTRADO', 'Esse negócio não existe mais.', {
      correcao: 'Voltar para o funil',
    });
  }

  const linhasAtividade = await tx
    .select({
      id: activities.id,
      type: activities.type,
      body: activities.body,
      metadata: activities.metadata,
      actorUserId: activities.actorUserId,
      occurredAt: activities.occurredAt,
    })
    .from(activities)
    .where(eq(activities.dealId, dealId))
    .orderBy(desc(activities.occurredAt));

  return {
    ...negocio,
    // `metadata` é `jsonb` sem `$type<>()` no schema (infere `unknown`) — o cast aqui
    // documenta o contrato de saída, não esconde um `any`.
    activities: linhasAtividade as AtividadeDoNegocio[],
  };
}

export async function obterNegocio(dealId: string): Promise<ServiceResult<NegocioDetalhe>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    return withTenant(tenantId, async (tx) => buscarNegocioDetalhe(tx, dealId));
  });
}

// ---------------------------------------------------------------------------
// 4b) Atualizar negócio — autosave campo a campo na ficha
// ---------------------------------------------------------------------------

/**
 * Patch de edição: tudo opcional, um campo por vez (a tela salva no blur, não
 * há botão Salvar grande). Datas aceitam string vazia = limpar (vira `null` no
 * banco); `undefined` = campo não veio no patch, não mexe.
 *
 * Não reusa `dataOpcionalInput` (que transforma `''` em `undefined`): aqui
 * preciso distinguir "não veio" de "veio vazio", porque `''` significa "limpar
 * a data" e `undefined` significa "não toque nesta coluna".
 */
const atualizarNegocioInput = z.object({
  title: z.string().trim().min(2, 'Dê um título ao negócio').max(200).optional(),
  destination: z.string().trim().max(200).optional().or(z.literal('')),
  paxAdults: z.number().int().min(1).max(50).optional(),
  paxChildren: z.number().int().min(0).max(50).optional(),
  valueCents: z.number().int().min(0).optional(),
  departureOn: z.string().trim().max(20).optional().or(z.literal('')),
  returnOn: z.string().trim().max(20).optional().or(z.literal('')),
  expectedCloseOn: z.string().trim().max(20).optional().or(z.literal('')),
  /**
   * Fase 3 (§5) — reatribuição: para quem é o negócio. SOMENTE o dono manda (a guarda
   * está dentro de `atualizarNegocio`); `null` limpa a atribuição. O convidado é
   * validado contra o `member` do tenant — não existe reatribuir para estranho.
   */
  agentId: z.uuid('Agente inválido.').nullable().optional(),
});

export type NegocioPatch = z.infer<typeof atualizarNegocioInput>;

/**
 * Atualiza campos do negócio — destino, pax, datas, valor. Devolve o
 * `NegocioDetalhe` completo reconciliado (mesmo shape de `obterNegocio`) pra
 * a ficha atualizar local sem reconsultar.
 *
 * Validação de datas: se o patch toca `departureOn` ou `returnOn`, confere
 * `returnOn >= departureOn` contra o valor que vai ficar no banco (o novo
 * se veio no patch, o existente caso contrário) — mesma regra do
 * `check('deals_dates_check')` no schema e de `criarNegocio`.
 */
export async function atualizarNegocio(
  dealId: string,
  patch: NegocioPatch,
): Promise<ServiceResult<NegocioDetalhe>> {
  return comoResultado(async () => {
    const { tenantId, userId, role: ctxRole } = await requireAuthContext();
    const parsed = atualizarNegocioInput.safeParse(patch);
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
        campo: primeiro?.path.join('.'),
        correcao: 'Corrigir e tentar de novo',
      });
    }
    const dados = parsed.data;

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const [atual] = await tx
        .select({
          id: deals.id,
          departureOn: deals.departureOn,
          returnOn: deals.returnOn,
        })
        .from(deals)
        .where(eq(deals.id, dealId))
        .limit(1);

      if (!atual) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse negócio não existe mais.', {
          correcao: 'Voltar para o funil',
        });
      }

      const valores: Record<string, unknown> = { updatedAt: new Date() };
      const mudou: string[] = [];

      if (dados.title !== undefined) {
        valores.title = dados.title;
        mudou.push('title');
      }
      if (dados.destination !== undefined) {
        valores.destination = dados.destination.trim() || null;
        mudou.push('destination');
      }
      if (dados.paxAdults !== undefined) {
        valores.paxAdults = dados.paxAdults;
        mudou.push('paxAdults');
      }
      if (dados.paxChildren !== undefined) {
        valores.paxChildren = dados.paxChildren;
        mudou.push('paxChildren');
      }
      if (dados.valueCents !== undefined) {
        valores.valueCents = dados.valueCents;
        mudou.push('valueCents');
      }
      if (dados.departureOn !== undefined) {
        const iso = dados.departureOn ? parseDataFlexivel(dados.departureOn) : null;
        if (dados.departureOn && !iso) {
          throw new ServiceError('DADOS_INVALIDOS', 'Data de ida inválida.', {
            campo: 'departureOn',
            correcao: 'Usar o formato DD/MM/AAAA',
          });
        }
        valores.departureOn = iso;
        mudou.push('departureOn');
      }
      if (dados.returnOn !== undefined) {
        const iso = dados.returnOn ? parseDataFlexivel(dados.returnOn) : null;
        if (dados.returnOn && !iso) {
          throw new ServiceError('DADOS_INVALIDOS', 'Data de volta inválida.', {
            campo: 'returnOn',
            correcao: 'Usar o formato DD/MM/AAAA',
          });
        }
        valores.returnOn = iso;
        mudou.push('returnOn');
      }
      if (dados.expectedCloseOn !== undefined) {
        const iso = dados.expectedCloseOn ? parseDataFlexivel(dados.expectedCloseOn) : null;
        if (dados.expectedCloseOn && !iso) {
          throw new ServiceError('DADOS_INVALIDOS', 'Data de fechamento prevista inválida.', {
            campo: 'expectedCloseOn',
            correcao: 'Usar o formato DD/MM/AAAA',
          });
        }
        valores.expectedCloseOn = iso;
        mudou.push('expectedCloseOn');
      }
      if (dados.agentId !== undefined) {
        // Fase 3 (§5): reatribuir é decisão de DONO — agente não passa negócio para
        // colega por conta própria.
        if (ctxRole !== 'owner') {
          throw new ServiceError('DADOS_INVALIDOS', 'Só o dono da conta reatribui negócios.', {
            campo: 'agentId',
            correcao: 'Pedir ao dono da conta',
          });
        }
        if (dados.agentId !== null) {
          // O alvo precisa ser pessoa do TIME (member do tenant). O `user` de outro
          // tenant nem apareceria aqui — a policy `user_isolation` devolve zero linhas.
          const [alvo] = await tx
            .select({ id: user.id })
            .from(user)
            .innerJoin(member, eq(member.userId, user.id))
            .where(and(eq(user.id, dados.agentId), eq(member.organizationId, tenantId)))
            .limit(1);
          if (!alvo) {
            throw new ServiceError('DADOS_INVALIDOS', 'Essa pessoa não faz parte da sua equipe.', {
              campo: 'agentId',
              correcao: 'Escolher um membro da equipe',
            });
          }
        }
        valores.agentId = dados.agentId;
        mudou.push('agentId');
      }

      if (mudou.length === 0) {
        throw new ServiceError('DADOS_INVALIDOS', 'Nada para salvar.', { correcao: 'Fechar' });
      }

      // Consistência de datas: `returnOn >= departureOn`. Se o patch só toca
      // um dos dois, confere contra o valor que já está no banco.
      const novaIda =
        valores.departureOn !== undefined ? (valores.departureOn as string | null) : atual.departureOn;
      const novaVolta =
        valores.returnOn !== undefined ? (valores.returnOn as string | null) : atual.returnOn;
      if (novaIda && novaVolta && novaVolta < novaIda) {
        throw new ServiceError('DADOS_INVALIDOS', 'A volta não pode ser antes da ida.', {
          campo: 'returnOn',
          correcao: 'Corrigir as datas',
        });
      }

      await tx.update(deals).set(valores).where(eq(deals.id, dealId));

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'deal.updated',
        entity: 'deal',
        entityId: dealId,
        // Só os NOMES dos campos alterados. Nunca os valores.
        metadata: { campos: mudou },
      });

      return buscarNegocioDetalhe(tx, dealId);
    });
  });
}

// ---------------------------------------------------------------------------
// 5) Parados há mais de 7 dias — seção "Paradas" do Hoje (negócios)
// ---------------------------------------------------------------------------

const DIAS_PARADO_LIMITE = 7;

export type NegocioParado = {
  id: string;
  title: string;
  destination: string | null;
  valueCents: number;
  contactId: string;
  contactName: string;
  diasParado: number;
};

export type ResumoDeParados = {
  itens: NegocioParado[];
  totalCents: number;
};

/**
 * Negócios abertos (não `ganho`, não `perdido`) sem movimentação há mais de
 * {@link DIAS_PARADO_LIMITE} dias — "movimentação" com a mesma definição de
 * `listarNegociosDoFunil`: o mais recente entre `updatedAt` e a última `activity`.
 * Ordenado do mais parado para o menos parado (é o que precisa de atenção primeiro).
 *
 * Sem consumidor de UI hoje (a seção "Paradas" do /hoje passou a usar as
 * propostas paradas do S10, `obterResumoDoMes`), mas a action permanece — é
 * testada (`tests/deals/funil.test.ts`) e pode voltar a ser consumida.
 */
export async function listarNegociosParados(): Promise<ServiceResult<ResumoDeParados>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const linhas = await tx
        .select({
          id: deals.id,
          title: deals.title,
          destination: deals.destination,
          valueCents: deals.valueCents,
          contactId: deals.contactId,
          contactName: contacts.name,
          updatedAt: deals.updatedAt,
          ultimaAtividadeEm: ultimaAtividadeSql(),
        })
        .from(deals)
        .innerJoin(contacts, eq(contacts.id, deals.contactId))
        .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
        // "Aberto" = coluna que não fecha nem como ganho nem como perdido (0016).
        .where(and(eq(pipelineStages.isWon, false), eq(pipelineStages.isLost, false)));

      const agora = Date.now();
      const itens = linhas
        .map((linha) => ({
          id: linha.id,
          title: linha.title,
          destination: linha.destination,
          valueCents: linha.valueCents,
          contactId: linha.contactId,
          contactName: linha.contactName,
          diasParado: diasDesde(
            maisRecente(linha.updatedAt, paraDataOuNula(linha.ultimaAtividadeEm)),
            agora,
          ),
        }))
        .filter((item) => item.diasParado > DIAS_PARADO_LIMITE)
        .sort((a, b) => b.diasParado - a.diasParado);

      const totalCents = itens.reduce((soma, item) => soma + item.valueCents, 0);

      return { itens, totalCents };
    });
  });
}

// ---------------------------------------------------------------------------
// 6) Os dois números do topo do Hoje
// ---------------------------------------------------------------------------

export type ResumoDoPipeline = {
  /** Soma de `valueCents` de todo negócio que não é `ganho` nem `perdido`. Sem recorte de tempo. */
  pipelineAbertoCents: number;
  /**
   * Soma de `valueCents` dos negócios `ganho` cujo `closedAt` cai no período consultado
   * (mês corrente por padrão, UTC). O nome mantém o sufixo "Mes" por compatibilidade com
   * a tela que já consome — quando um período (`{ mes }` ou `{ de, ate }`) é passado, o
   * recorte é o PERÍODO, não o mês.
   */
  fechadoNoMesCents: number;
};

/**
 * Ver a decisão de recorte documentada no comentário de topo do arquivo. Aceita o mesmo
 * período opcional do §1 (`./periodo.ts`) que o restante das telas de leitura; ausente =
 * mês corrente, comportamento preservado. `pipelineAbertoCents` continua sem recorte de
 * tempo de propósito: dinheiro em aberto não pertence a um mês.
 */
export async function obterResumoDoPipeline(
  periodoInput?: PeriodoInput,
): Promise<ServiceResult<ResumoDoPipeline>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const agora = new Date();
    const periodo = resolverPeriodo(agora, periodoInput);

    return withTenant(tenantId, async (tx) => {
      const abertos = await tx
        .select({ valueCents: deals.valueCents })
        .from(deals)
        .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
        .where(and(eq(pipelineStages.isWon, false), eq(pipelineStages.isLost, false)));

      const fechados = await tx
        .select({ valueCents: deals.valueCents, closedAt: deals.closedAt })
        .from(deals)
        .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
        .where(eq(pipelineStages.isWon, true));

      const pipelineAbertoCents = abertos.reduce((soma, item) => soma + item.valueCents, 0);
      const fechadoNoMesCents = fechados
        .filter(
          (item) =>
            item.closedAt !== null &&
            item.closedAt >= periodo.inicio &&
            item.closedAt < periodo.fimExclusivo,
        )
        .reduce((soma, item) => soma + item.valueCents, 0);

      return { pipelineAbertoCents, fechadoNoMesCents };
    });
  });
}
