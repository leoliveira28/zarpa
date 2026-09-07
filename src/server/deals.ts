'use server';

import { and, desc, eq, ne, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { activities, contacts, deals, type Deal } from '@/db/schema';
import { withTenant, type TenantDb } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { registrarAuditoria } from './audit';
import { parseDataFlexivel } from './normalize';

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
 *    negócio fica. Mapeamento (ver `COLUNAS_DO_FUNIL` abaixo, fonte única para não a UI e o
 *    servidor divergirem de novo):
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
 * TERCEIRA DECISÃO, menor mas vale registrar: somas (`obterResumoDoPipeline`,
 * `listarNegociosParados`) são feitas em JAVASCRIPT depois de buscar as linhas, não com
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

/**
 * Fonte única do rótulo e da ordem das colunas do quadro. A Nina pode importar isto direto
 * em vez de manter uma segunda lista (`STAGES` em `src/lib/ui/sample-data.ts`) que um dia
 * fica desalinhada com o enum do banco — foi exatamente essa divergência (5 colunas de
 * exemplo vs. 6 valores de `deals.stage`) que motivou este comentário existir.
 */
export const COLUNAS_DO_FUNIL: { estagio: EstagioDeFunil; label: string }[] = [
  { estagio: 'novo', label: 'Novo contato' },
  { estagio: 'cotando', label: 'Montando' },
  { estagio: 'proposta_enviada', label: 'Enviada' },
  { estagio: 'negociando', label: 'Negociando' },
  { estagio: 'ganho', label: 'Fechada' },
];

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
 * Subquery correlacionada de "última atividade do negócio" — usada tanto em
 * `listarNegociosDoFunil` quanto em `listarNegociosParados`.
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

function inicioDoMesUTC(agora: Date): Date {
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
}

function inicioDoProximoMesUTC(agora: Date): Date {
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + 1, 1));
}

// ---------------------------------------------------------------------------
// 1) Board do funil
// ---------------------------------------------------------------------------

export type NegocioDoFunil = {
  id: string;
  title: string;
  destination: string | null;
  valueCents: number;
  stage: EstagioDeFunil;
  contactId: string;
  contactName: string;
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
 */
export async function listarNegociosDoFunil(): Promise<ServiceResult<NegocioDoFunil[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const linhas = await tx
        .select({
          id: deals.id,
          title: deals.title,
          destination: deals.destination,
          valueCents: deals.valueCents,
          stage: deals.stage,
          departureOn: deals.departureOn,
          updatedAt: deals.updatedAt,
          contactId: deals.contactId,
          contactName: contacts.name,
          ultimaAtividadeEm: ultimaAtividadeSql(),
        })
        .from(deals)
        .innerJoin(contacts, eq(contacts.id, deals.contactId))
        .where(ne(deals.stage, 'perdido'))
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
        contactId: linha.contactId,
        contactName: linha.contactName,
        departureOn: linha.departureOn,
        diasParado: diasDesde(
          maisRecente(linha.updatedAt, paraDataOuNula(linha.ultimaAtividadeEm)),
          agora,
        ),
      }));
    });
  });
}

// ---------------------------------------------------------------------------
// 2) Mover de estágio — o que o arrasto do kanban chama
// ---------------------------------------------------------------------------

const estagioInput = z.enum(ESTAGIOS);

export type NegocioMovido = {
  id: string;
  stage: DealStage;
  lostReason: string | null;
  closedAt: Date | null;
  updatedAt: Date;
};

async function buscarNegocioMovido(tx: TenantDb, dealId: string): Promise<NegocioMovido> {
  const [linha] = await tx
    .select({
      id: deals.id,
      stage: deals.stage,
      lostReason: deals.lostReason,
      closedAt: deals.closedAt,
      updatedAt: deals.updatedAt,
    })
    .from(deals)
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
 */
export async function moverEstagioDoNegocio(
  dealId: string,
  novoEstagio: DealStage,
  motivoPerda?: string,
): Promise<ServiceResult<NegocioMovido>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();

    const estagioParsed = estagioInput.safeParse(novoEstagio);
    if (!estagioParsed.success) {
      throw new ServiceError('DADOS_INVALIDOS', 'Esse estágio não existe.', {
        campo: 'novoEstagio',
        correcao: 'Escolher um estágio válido',
      });
    }
    const estagio = estagioParsed.data;

    const motivo = motivoPerda?.trim() ?? '';
    if (estagio === 'perdido' && motivo.length < 3) {
      throw new ServiceError(
        'DADOS_INVALIDOS',
        'Diga por que essa venda foi perdida antes de arquivar.',
        { campo: 'motivoPerda', correcao: 'Escrever o motivo da perda' },
      );
    }

    return withTenant(tenantId, async (tx) => {
      const [atual] = await tx
        .select({ id: deals.id, stage: deals.stage })
        .from(deals)
        .where(eq(deals.id, dealId))
        .limit(1);

      if (!atual) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse negócio não existe mais.', {
          correcao: 'Voltar para o funil',
        });
      }

      if (atual.stage === estagio) {
        return buscarNegocioMovido(tx, dealId);
      }

      const agora = new Date();
      const valores: Record<string, unknown> = {
        stage: estagio,
        updatedAt: agora,
        closedAt: estagio === 'ganho' || estagio === 'perdido' ? agora : null,
        lostReason: estagio === 'perdido' ? motivo : null,
      };

      const linhas = await tx
        .update(deals)
        .set(valores)
        .where(and(eq(deals.id, dealId), ne(deals.stage, estagio)))
        .returning({ id: deals.id });

      if (linhas.length > 0) {
        await tx.insert(activities).values({
          tenantId,
          dealId,
          actorUserId: userId,
          type: 'stage_changed',
          body:
            estagio === 'perdido'
              ? `Marcado como perdido: ${motivo}`
              : `Movido de ${atual.stage} para ${estagio}.`,
          metadata: {
            de: atual.stage,
            para: estagio,
            ...(estagio === 'perdido' ? { motivoPerda: motivo } : {}),
          },
          occurredAt: agora,
        });

        await registrarAuditoria(tx, {
          tenantId,
          actorUserId: userId,
          action: 'deal.stage_changed',
          entity: 'deal',
          entityId: dealId,
          metadata: { de: atual.stage, para: estagio },
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
});

export type CriarNegocioInput = z.infer<typeof criarNegocioInput>;

/** Criação básica: nasce sempre `stage: 'novo'` (default do schema), moeda BRL se omitida. */
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

      const [criado] = await tx
        .insert(deals)
        .values({
          tenantId,
          contactId: contato.id,
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

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'deal.created',
        entity: 'deal',
        entityId: negocio.id,
        metadata: { contactId: contato.id },
      });

      return {
        id: negocio.id,
        title: negocio.title,
        destination: negocio.destination,
        valueCents: negocio.valueCents,
        // Acabou de nascer com o default do schema ('novo') — nunca 'perdido' aqui.
        stage: negocio.stage as EstagioDeFunil,
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
  stage: DealStage;
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
  createdAt: Date;
  updatedAt: Date;
  /** Mais recente primeiro. */
  activities: AtividadeDoNegocio[];
};

export async function obterNegocio(dealId: string): Promise<ServiceResult<NegocioDetalhe>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const [negocio] = await tx
        .select({
          id: deals.id,
          title: deals.title,
          destination: deals.destination,
          stage: deals.stage,
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
          createdAt: deals.createdAt,
          updatedAt: deals.updatedAt,
        })
        .from(deals)
        .innerJoin(contacts, eq(contacts.id, deals.contactId))
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
    });
  });
}

// ---------------------------------------------------------------------------
// 5) Parados há mais de 7 dias — seção "Paradas" do Hoje
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
        .where(notInArray(deals.stage, ['ganho', 'perdido']));

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
  /** Soma de `valueCents` dos negócios `ganho` cujo `closedAt` cai no mês corrente (UTC). */
  fechadoNoMesCents: number;
};

/** Ver a decisão de recorte documentada no comentário de topo do arquivo. */
export async function obterResumoDoPipeline(): Promise<ServiceResult<ResumoDoPipeline>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const agora = new Date();
    const inicioMes = inicioDoMesUTC(agora);
    const inicioProximoMes = inicioDoProximoMesUTC(agora);

    return withTenant(tenantId, async (tx) => {
      const abertos = await tx
        .select({ valueCents: deals.valueCents })
        .from(deals)
        .where(notInArray(deals.stage, ['ganho', 'perdido']));

      const fechados = await tx
        .select({ valueCents: deals.valueCents, closedAt: deals.closedAt })
        .from(deals)
        .where(eq(deals.stage, 'ganho'));

      const pipelineAbertoCents = abertos.reduce((soma, item) => soma + item.valueCents, 0);
      const fechadoNoMesCents = fechados
        .filter(
          (item) =>
            item.closedAt !== null &&
            item.closedAt >= inicioMes &&
            item.closedAt < inicioProximoMes,
        )
        .reduce((soma, item) => soma + item.valueCents, 0);

      return { pipelineAbertoCents, fechadoNoMesCents };
    });
  });
}
