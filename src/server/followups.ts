'use server';

import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, deals, proposals, tasks, tenants } from '@/db/schema';
import { withTenant, type TenantDb } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { authDb } from '@/lib/auth/db';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { exigirContaAtiva } from './subscriptionGate';
import { registrarAuditoria } from './audit';
import {
  gerarAlertasDeAniversario,
  gerarAlertasDePassaporte,
  type ResultadoAlertasTenant,
  type TarefaResumo,
} from './alerts';

/**
 * A régua de follow-up depois do envio da proposta — o motor de retenção do S8.
 *
 * **Idempotência é do banco, mesmo desenho de `alerts.ts`.** Cada uma das três tarefas
 * carrega um `dedupeKey` determinístico (`followup:proposta:<propostaId>:d2`, `:d5`,
 * `:d10`) e `tasks_tenant_dedupe_key` (índice único parcial em `(tenant_id,
 * dedupe_key)`, migration `0001`) garante que gerar duas vezes é no-op no banco — o
 * segundo `INSERT` vira `ON CONFLICT DO NOTHING` e não conta como criada.
 *
 * **Quando isto roda:**
 *   1. Dentro de `enviarProposta` (S8, chamada direta) — se quem chamar
 *      `enviarProposta` também quiser gerar a régua no ato, é `enviarProposta` que
 *      decide chamar `gerarFollowupsDaProposta`, não o contrário (este arquivo não
 *      importa `proposals.ts`, para não criar dependência circular entre os dois
 *      Server Actions). Ver `docs/handoffs/rafa-para-po.md` — decisão registrada lá
 *      porque `enviarProposta` está em `src/server/proposals.ts`, e mudar aquele
 *      arquivo nesta rodada não era necessário: o runner abaixo já cobre 100% do
 *      aceite sozinho.
 *   2. `rodarFilaDeFollowups()` — o runner diário do cron, que varre toda proposta
 *      enviada recentemente e materializa as três tarefas que ainda não existem. Cobre
 *      tanto "a proposta foi enviada e ninguém chamou o gerador na hora" quanto "o cron
 *      rodou duas vezes hoje" — os dois casos têm a mesma resposta: nenhuma duplicata.
 *
 * **Por que a janela de 15 dias na consulta de proposals** (`sentAt >= hoje - 15 dias`):
 * o marco mais distante da régua é D+10. Uma proposta enviada há mais de 15 dias já
 * teve as três tarefas geradas há muito (ou nunca vai gerar, se foi enviada antes desta
 * feature existir — não há retroatividade além dessa janela, decisão de produto: não
 * faz sentido mandar "faz 40 dias que te enviei a proposta" como se fosse D+10).
 * Manter a janela também evita que a consulta cresça sem limite conforme o tenant
 * acumula histórico de propostas — mesmo raciocínio de `MARCOS_PASSAPORTE` em
 * `alerts.ts`, só que em dias corridos desde o envio em vez de dias até o vencimento.
 */

const JANELA_DE_GERACAO_DIAS = 15;

/** Marco (dias após o envio) → sufixo da chave de dedupe. */
const MARCOS_FOLLOWUP = [
  { dias: 2, sufixo: 'd2' },
  { dias: 5, sufixo: 'd5' },
  { dias: 10, sufixo: 'd10' },
] as const;

function somarDias(base: Date, dias: number): Date {
  const resultado = new Date(base.getTime());
  resultado.setUTCDate(resultado.getUTCDate() + dias);
  return resultado;
}

/**
 * Tom de agente de viagem, cada marco com um objetivo diferente — não é a mesma
 * mensagem repetida três vezes. Pronta para colar no WhatsApp: sem placeholder cru,
 * sem "[nome do cliente]" caso o dado falte (usa "Oi!" genérico nesse caso).
 */
function mensagemSugerida(
  marco: (typeof MARCOS_FOLLOWUP)[number]['sufixo'],
  contactName: string | null,
  destination: string | null,
): string {
  const saudacao = contactName ? `Oi, ${contactName}!` : 'Oi!';
  const destinoTexto = destination ? ` para ${destination}` : '';

  switch (marco) {
    case 'd2':
      return `${saudacao} Passando para saber se você já deu uma olhadinha na proposta${destinoTexto} que te mandei. Ficou alguma dúvida? Posso ajustar alguma coisa.`;
    case 'd5':
      return `${saudacao} Tudo bem? A proposta${destinoTexto} continua disponível, mas os valores podem mudar a qualquer momento — se estiver dentro dos seus planos, vale a pena fecharmos logo. Quer que eu te ligue para fechar os detalhes?`;
    case 'd10':
      return `${saudacao} Faz um tempinho que te enviei a proposta${destinoTexto} e não tive retorno — ainda está nos seus planos? Se não for mais o momento, me avisa que ajusto por aqui sem problema.`;
  }
}

function tituloFollowup(
  marco: (typeof MARCOS_FOLLOWUP)[number]['sufixo'],
  destination: string | null,
): string {
  const dias = marco === 'd2' ? 2 : marco === 'd5' ? 5 : 10;
  return destination
    ? `Follow-up D+${dias} — proposta para ${destination}`
    : `Follow-up D+${dias} — proposta enviada`;
}

type PropostaParaRegua = {
  id: string;
  dealId: string;
  sentAt: Date;
  contactId: string | null;
  contactName: string | null;
  destination: string | null;
};

async function gerarFollowupsPendentes(tx: TenantDb, tenantId: string): Promise<number> {
  const limiteInferior = somarDias(new Date(), -JANELA_DE_GERACAO_DIAS);

  const propostas = await tx
    .select({
      id: proposals.id,
      dealId: proposals.dealId,
      sentAt: proposals.sentAt,
      contactId: deals.contactId,
      contactName: contacts.name,
      destination: deals.destination,
    })
    .from(proposals)
    .innerJoin(deals, eq(deals.id, proposals.dealId))
    .innerJoin(contacts, eq(contacts.id, deals.contactId))
    .where(
      and(
        sql`${proposals.sentAt} is not null`,
        gte(proposals.sentAt, limiteInferior),
        isNull(proposals.archivedAt),
      ),
    );

  let criadas = 0;

  for (const proposta of propostas as PropostaParaRegua[]) {
    if (!proposta.sentAt) continue; // defensivo — a query já filtra, o tipo não sabe

    for (const marco of MARCOS_FOLLOWUP) {
      const dedupeKey = `followup:proposta:${proposta.id}:${marco.sufixo}`;
      const inserida = await tx
        .insert(tasks)
        .values({
          tenantId,
          dealId: proposta.dealId,
          contactId: proposta.contactId,
          title: tituloFollowup(marco.sufixo, proposta.destination),
          suggestedMessage: mensagemSugerida(marco.sufixo, proposta.contactName, proposta.destination),
          kind: 'followup',
          source: 'followup_proposta',
          dedupeKey,
          dueAt: somarDias(proposta.sentAt, marco.dias),
        })
        .onConflictDoNothing({
          target: [tasks.tenantId, tasks.dedupeKey],
          where: sql`${tasks.dedupeKey} is not null`,
        })
        .returning({ id: tasks.id });

      if (inserida.length > 0) criadas += 1;
    }
  }

  return criadas;
}

/**
 * Gera a régua de follow-up para UMA proposta específica, já dentro da transação de
 * quem chamou (por exemplo, o próprio `enviarProposta`, se um dia decidir chamar isto
 * na hora do envio em vez de esperar o cron do dia seguinte). Mesma idempotência de
 * `gerarFollowupsPendentes`: chamar duas vezes para a mesma proposta não duplica.
 */
export async function gerarFollowupsDaProposta(
  tx: TenantDb,
  tenantId: string,
  propostaId: string,
): Promise<number> {
  const [proposta] = await tx
    .select({
      id: proposals.id,
      dealId: proposals.dealId,
      sentAt: proposals.sentAt,
      contactId: deals.contactId,
      contactName: contacts.name,
      destination: deals.destination,
    })
    .from(proposals)
    .innerJoin(deals, eq(deals.id, proposals.dealId))
    .innerJoin(contacts, eq(contacts.id, deals.contactId))
    .where(and(eq(proposals.id, propostaId), sql`${proposals.sentAt} is not null`))
    .limit(1);

  if (!proposta || !proposta.sentAt) return 0;

  let criadas = 0;
  for (const marco of MARCOS_FOLLOWUP) {
    const dedupeKey = `followup:proposta:${proposta.id}:${marco.sufixo}`;
    const inserida = await tx
      .insert(tasks)
      .values({
        tenantId,
        dealId: proposta.dealId,
        contactId: proposta.contactId,
        title: tituloFollowup(marco.sufixo, proposta.destination),
        suggestedMessage: mensagemSugerida(marco.sufixo, proposta.contactName, proposta.destination),
        kind: 'followup',
        source: 'followup_proposta',
        dedupeKey,
        dueAt: somarDias(proposta.sentAt, marco.dias),
      })
      .onConflictDoNothing({
        target: [tasks.tenantId, tasks.dedupeKey],
        where: sql`${tasks.dedupeKey} is not null`,
      })
      .returning({ id: tasks.id });

    if (inserida.length > 0) criadas += 1;
  }
  return criadas;
}

export type ResultadoFilaTenant = ResultadoAlertasTenant & {
  followupsCriados: number;
};

export type ResultadoFilaGeral = ResultadoFilaTenant & {
  tenantsProcessados: number;
};

/**
 * O runner diário do cron — mesmo padrão de `gerarAlertas()`: sem sessão de usuário,
 * `authDb` para listar todos os tenants (a MESMA policy de escape
 * `tenants_auth_service` que o login já usa, nenhuma superfície nova), um
 * `withTenant` por tenant para materializar:
 *   1. a régua de follow-up de proposta (`gerarFollowupsPendentes`);
 *   2. os alertas de passaporte/aniversário (`alerts.ts`) — **na mesma fila**, mesma
 *      chamada, mesmo runner: é isso que a tarefa pede ("fazer os alertas ... entrarem
 *      na MESMA fila"). `gerarAlertas()` (o de `alerts.ts`) continua existindo
 *      separado, para quem só quer os alertas sem a régua — mas o cron de produção
 *      chama SÓ este arquivo, não os dois.
 *
 * Idempotente sob execução repetida: cada peça (`gerarFollowupsPendentes`,
 * `gerarAlertasDePassaporte`, `gerarAlertasDeAniversario`) já é idempotente por conta
 * própria (dedupeKey + índice único), então rodar `rodarFilaDeFollowups()` duas vezes
 * seguidas não duplica nada — nem precisa de trava de "já rodei hoje" em lugar nenhum.
 *
 * A rota HTTP que chama isto (`/api/cron/...`) é do PO — ver
 * `docs/handoffs/rafa-para-po.md` para qual função chamar e com qual proteção.
 */
export async function rodarFilaDeFollowups(): Promise<ServiceResult<ResultadoFilaGeral>> {
  return comoResultado(async () => {
    const listaTenants = await authDb.select({ id: tenants.id }).from(tenants);

    let followupsCriados = 0;
    let passaporteCriadas = 0;
    let aniversarioCriadas = 0;

    for (const { id: tenantId } of listaTenants) {
      const resultado = await withTenant(tenantId, async (tx) => {
        const followups = await gerarFollowupsPendentes(tx, tenantId);
        const passaporte = await gerarAlertasDePassaporte(tx, tenantId);
        const aniversario = await gerarAlertasDeAniversario(tx, tenantId);

        if (followups > 0 || passaporte > 0 || aniversario > 0) {
          await registrarAuditoria(tx, {
            tenantId,
            actorUserId: null,
            action: 'followup_queue.generated',
            entity: 'task',
            metadata: { followups, passaporte, aniversario },
          });
        }

        return { followups, passaporte, aniversario };
      });

      followupsCriados += resultado.followups;
      passaporteCriadas += resultado.passaporte;
      aniversarioCriadas += resultado.aniversario;
    }

    return {
      tenantsProcessados: listaTenants.length,
      followupsCriados,
      passaporteCriadas,
      aniversarioCriadas,
    };
  });
}

// ---------------------------------------------------------------------------
// Leitura para a tela "Hoje"
// ---------------------------------------------------------------------------

export type TarefaDeHoje = {
  id: string;
  title: string;
  notes: string | null;
  suggestedMessage: string | null;
  kind: string;
  source: string;
  contactId: string | null;
  contactName: string | null;
  dealId: string | null;
  dealTitle: string | null;
  destination: string | null;
  dueAt: Date;
  vencida: boolean;
  doneAt: Date | null;
  createdAt: Date;
};

/**
 * O que a tela Hoje lê: tarefas em aberto que vencem hoje OU já venceram (vencida =
 * `dueAt` no passado). Fechada por padrão às concluídas — mesmo padrão de
 * `listarTarefas` (`alerts.ts`), só que com o JOIN de negócio/contato que a tela Hoje
 * precisa para mostrar destino e nome sem uma chamada extra, e com `suggestedMessage`
 * pronta para o botão "copiar mensagem".
 *
 * `dueAt` é comparado em UTC contra a meia-noite do dia seguinte ao de hoje — ou seja,
 * "hoje" inclui qualquer hora do dia corrente, não só o passado exato até agora.
 */
export async function listarTarefasDeHoje(opcoes?: {
  limite?: number;
}): Promise<ServiceResult<TarefaDeHoje[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const limite = Math.min(Math.max(opcoes?.limite ?? 100, 1), 300);

    const fimDeHoje = new Date();
    fimDeHoje.setUTCHours(23, 59, 59, 999);

    return withTenant(tenantId, async (tx) => {
      const linhas = await tx
        .select({
          id: tasks.id,
          title: tasks.title,
          notes: tasks.notes,
          suggestedMessage: tasks.suggestedMessage,
          kind: tasks.kind,
          source: tasks.source,
          contactId: tasks.contactId,
          contactName: contacts.name,
          dealId: tasks.dealId,
          dealTitle: deals.title,
          destination: deals.destination,
          dueAt: tasks.dueAt,
          doneAt: tasks.doneAt,
          createdAt: tasks.createdAt,
        })
        .from(tasks)
        .leftJoin(contacts, eq(contacts.id, tasks.contactId))
        .leftJoin(deals, eq(deals.id, tasks.dealId))
        .where(and(isNull(tasks.doneAt), lte(tasks.dueAt, fimDeHoje)))
        .orderBy(asc(tasks.dueAt))
        .limit(limite);

      const agora = new Date();
      return linhas.map((linha) => ({
        ...linha,
        vencida: linha.dueAt < agora,
      })) as TarefaDeHoje[];
    });
  });
}

// Concluir a tarefa (marcar `doneAt`) é `concluirTarefa`, de `alerts.ts` — não há
// necessidade de uma segunda action fazendo a mesma coisa. `listarTarefasDeHoje` só
// LÊ; quem termina a tarefa chama `concluirTarefa(tarefaId)`, já exportado no barril.
// Ver `docs/handoffs/rafa-para-nina.md`.

// ---------------------------------------------------------------------------
// Criação manual — o "Criar lembrete" da tela Hoje
// ---------------------------------------------------------------------------

/**
 * `dueAt` chega do cliente como `Date` ou string (o que um `<input type="datetime-local">`
 * ou `type="date"` mandar). Mesma régua de erro do resto do projeto: `ctx.addIssue` +
 * `z.NEVER` em vez de deixar `new Date('lixo')` virar `Invalid Date` silencioso que só
 * estoura na hora do INSERT com uma mensagem de Postgres que ninguém traduz para a tela.
 */
const dueAtInput = z
  .union([z.date(), z.string().trim().min(1, 'Escolha quando lembrar')])
  .transform((value, ctx) => {
    const data = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(data.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'Não entendi essa data de vencimento.' });
      return z.NEVER;
    }
    return data;
  });

const criarTarefaInput = z.object({
  title: z.string().trim().min(2, 'Dê um título ao lembrete').max(200),
  notes: z.string().trim().max(4000).optional().or(z.literal('')),
  /** Lembrete manual não tem "objetivo" definido de antemão — `outro` é o default certo;
   * quem preenche escolhe `ligar`/`whatsapp`/`email`/`followup` quando fizer sentido. */
  kind: z.enum(['followup', 'ligar', 'whatsapp', 'email', 'outro']).optional(),
  dueAt: dueAtInput,
  dealId: z.uuid('Negócio inválido').optional().or(z.literal('')),
  contactId: z.uuid('Contato inválido').optional().or(z.literal('')),
});

/** Contrato de `criarTarefa` — o shape que a tela Hoje deve montar antes de chamar a action. */
export type CriarTarefaInput = z.input<typeof criarTarefaInput>;

function vazioParaNulo(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

const COLUNAS_TAREFA_CRIADA = {
  id: tasks.id,
  title: tasks.title,
  notes: tasks.notes,
  kind: tasks.kind,
  source: tasks.source,
  contactId: tasks.contactId,
  dealId: tasks.dealId,
  dueAt: tasks.dueAt,
  doneAt: tasks.doneAt,
  createdAt: tasks.createdAt,
} as const;

/**
 * O botão "Criar lembrete" da tela Hoje, morto até aqui — sem `onClick` na interface e
 * sem função de servidor nenhuma (confirmado usando o produto: não existe em lugar
 * algum do repositório antes deste commit). `tasks` (schema) já suportava isto por
 * inteiro — `source: 'manual'` já era um valor do enum e `dedupeKey` já era opcional —
 * então não há migration nesta entrega, só a Server Action que faltava.
 *
 * Mesmas quatro regras de `contacts.ts`/`deals.ts`: `tenantId` e `userId` vêm da sessão
 * via `requireAuthContext()`, nunca do input; toda escrita dentro de `withTenant`; zod
 * valida antes de tocar no banco; `dealId`/`contactId`, quando vierem, são conferidos
 * dentro da MESMA transação — a policy de RLS faz uma referência de outro tenant virar
 * "não encontrado" (zero linhas), não um vazamento nem um erro 500 de FK.
 *
 * `dedupeKey` fica de fora de propósito: dedupe é para tarefa GERADA (régua de
 * follow-up, alerta de passaporte/aniversário) que pode ser recriada pelo cron. Lembrete
 * manual não tem chave determinística — a agente pode querer duas tarefas com o mesmo
 * título e a mesma data, e não é a esta função que cabe decidir que isso é duplicata.
 * `tasks_dedupe_key_check` no banco (migration `0001`) já EXIGE `dedupeKey is null`
 * quando `source = 'manual'`, então nem tentamos passar um.
 */
export async function criarTarefa(input: CriarTarefaInput): Promise<ServiceResult<TarefaResumo>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();

    const parsed = criarTarefaInput.safeParse(input);
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
        campo: primeiro?.path.join('.'),
        correcao: 'Corrigir e tentar de novo',
      });
    }
    const dados = parsed.data;
    const notes = vazioParaNulo(dados.notes);
    const dealId = vazioParaNulo(dados.dealId);
    const contactId = vazioParaNulo(dados.contactId);

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      if (dealId) {
        const [negocio] = await tx.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId)).limit(1);
        if (!negocio) {
          throw new ServiceError('NAO_ENCONTRADO', 'Esse negócio não existe mais.', {
            campo: 'dealId',
            correcao: 'Escolher outro negócio',
          });
        }
      }

      if (contactId) {
        const [contato] = await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(eq(contacts.id, contactId))
          .limit(1);
        if (!contato) {
          throw new ServiceError('NAO_ENCONTRADO', 'Esse contato não existe mais.', {
            campo: 'contactId',
            correcao: 'Escolher outro contato',
          });
        }
      }

      const [criada] = await tx
        .insert(tasks)
        .values({
          tenantId,
          dealId,
          contactId,
          title: dados.title,
          notes,
          kind: dados.kind ?? 'outro',
          source: 'manual',
          dueAt: dados.dueAt,
          createdBy: userId,
        })
        .returning(COLUNAS_TAREFA_CRIADA);

      const tarefa = criada!;

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'task.created',
        entity: 'task',
        entityId: tarefa.id,
        metadata: { kind: tarefa.kind, comNegocio: Boolean(dealId), comContato: Boolean(contactId) },
      });

      return tarefa as TarefaResumo;
    });
  });
}
