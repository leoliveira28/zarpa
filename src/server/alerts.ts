'use server';

import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { contacts, tasks, tenants, travelers } from '@/db/schema';
import { withTenant, type TenantDb } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { authDb } from '@/lib/auth/db';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { registrarAuditoria } from './audit';

/**
 * Alertas de passaporte vencendo e aniversário, materializados como `tasks`.
 *
 * **Idempotência é do banco, não da aplicação.** Cada alerta carrega um `dedupeKey`
 * determinístico, e `tasks_tenant_dedupe_key` (índice único parcial em
 * `(tenant_id, dedupe_key)`) é quem garante que rodar `gerarAlertas()` duas vezes no
 * mesmo dia produz zero tarefa duplicada — o segundo `INSERT` faz `ON CONFLICT DO
 * NOTHING` e não conta como criada. A aplicação não guarda "já rodei hoje" em lugar
 * nenhum porque não precisa: a chave de dedupe já é a memória.
 *
 * Formato das chaves (por que cada uma tem a cara que tem):
 *
 *   `passaporte:<travelerId>:<passportExpiresOn>:<90|30|7>`
 *     A data de validade entra na chave. Se o passageiro RENOVAR o passaporte, a data
 *     muda, a chave muda, e os três alertas voltam a poder disparar para o passaporte
 *     novo — sem isso, o "90 dias" já consumido pelo passaporte antigo bloquearia o
 *     aviso do passaporte novo para sempre.
 *
 *   `aniversario:contato:<contactId>:<ano>` / `aniversario:viajante:<travelerId>:<ano>`
 *     O ano entra na chave de propósito oposto: aniversário É para repetir, uma vez por
 *     ano. Sem o ano, o alerta do aniversário passado impediria o deste ano.
 *
 * **Quem chama isto**: não é Server Action de botão — é para uma rota de cron (Vercel
 * Cron / similar) chamar `gerarAlertas()` sem sessão de usuário, uma vez por dia, para
 * TODOS os tenants. Contatos/passageiros não têm dono humano específico no momento em
 * que o cron roda, então a listagem de tenants usa `authDb`
 * (`src/lib/auth/db.ts`, `app.auth_context = 'on'`) — a MESMA policy de escape que já
 * existe para o login resolver o tenant antes de existir sessão. Não abre superfície
 * nova: `tenants_auth_service` já concede exatamente isto, e o teste de contrato do Téo
 * (`KNOWN_ESCAPE_HATCHES`) já cobre essa policy.
 *
 * `gerarAlertasDoTenantAtual()` é o irmão para um botão "gerar agora" na interface —
 * roda só o tenant da sessão, pelo caminho normal (`requireAuthContext` + `withTenant`).
 */

function hojeIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoMaisDias(dias: number): string {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function hojeMesEDia(): string {
  const agora = new Date();
  const mes = String(agora.getUTCMonth() + 1).padStart(2, '0');
  const dia = String(agora.getUTCDate()).padStart(2, '0');
  return `${mes}-${dia}`;
}

/**
 * Marcos de aviso, em dias antes do vencimento. `90` é o de planejamento (dá tempo de
 * renovar sem pressa), `30` é o de ação, `7` é o de urgência — muitos países recusam
 * embarque com menos de 6 meses de validade, então mesmo o marco de 90 dias já é tarde
 * para viagem internacional; o valor do alerta aqui é lembrar ANTES de a viagem ser
 * vendida com aquele passageiro.
 */
const MARCOS_PASSAPORTE = [90, 30, 7] as const;

async function gerarAlertasDePassaporte(tx: TenantDb, tenantId: string): Promise<number> {
  let criadas = 0;

  for (const dias of MARCOS_PASSAPORTE) {
    const limite = isoMaisDias(dias);
    const vencendo = await tx
      .select({
        id: travelers.id,
        contactId: travelers.contactId,
        fullName: travelers.fullName,
        passportExpiresOn: travelers.passportExpiresOn,
      })
      .from(travelers)
      .where(
        and(
          gte(travelers.passportExpiresOn, hojeIso()),
          lte(travelers.passportExpiresOn, limite),
        ),
      );

    for (const viajante of vencendo) {
      const dedupeKey = `passaporte:${viajante.id}:${viajante.passportExpiresOn}:${dias}`;
      const inserida = await tx
        .insert(tasks)
        .values({
          tenantId,
          contactId: viajante.contactId,
          title: `Passaporte de ${viajante.fullName} vence em ${dias} dias`,
          notes: `Validade: ${viajante.passportExpiresOn}. Gerado automaticamente pelo alerta de passaporte.`,
          kind: 'outro',
          source: 'alerta_passaporte',
          dedupeKey,
          dueAt: new Date(),
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

async function gerarAlertasDeAniversario(tx: TenantDb, tenantId: string): Promise<number> {
  const hoje = hojeMesEDia();
  const ano = new Date().getUTCFullYear();
  let criadas = 0;

  const contatosHoje = await tx
    .select({ id: contacts.id, name: contacts.name })
    .from(contacts)
    .where(and(eq(contacts.birthMonthDay, hoje), isNull(contacts.archivedAt)));

  for (const contato of contatosHoje) {
    const dedupeKey = `aniversario:contato:${contato.id}:${ano}`;
    const inserida = await tx
      .insert(tasks)
      .values({
        tenantId,
        contactId: contato.id,
        title: `Aniversário de ${contato.name} hoje`,
        kind: 'whatsapp',
        source: 'alerta_aniversario',
        dedupeKey,
        dueAt: new Date(),
      })
      .onConflictDoNothing({
        target: [tasks.tenantId, tasks.dedupeKey],
        where: sql`${tasks.dedupeKey} is not null`,
      })
      .returning({ id: tasks.id });

    if (inserida.length > 0) criadas += 1;
  }

  // Passageiro que não é o próprio contato (pais que compram para o casal, etc.) também
  // tem aniversário — e o dedupeKey separado ('viajante' vs 'contato') é de propósito:
  // quando o passageiro É o próprio contato, isto gera DUAS tarefas no mesmo dia. Aceito
  // conscientemente (ver docs/status/rafa.md): falso positivo duplicado é preferível a
  // tentar adivinhar "estas duas linhas são a mesma pessoa" por nome, o que erraria em
  // homônimos e teria falso negativo pior (esquecer um aniversário de verdade).
  const viajantesHoje = await tx
    .select({ id: travelers.id, contactId: travelers.contactId, fullName: travelers.fullName })
    .from(travelers)
    .where(eq(travelers.birthMonthDay, hoje));

  for (const viajante of viajantesHoje) {
    const dedupeKey = `aniversario:viajante:${viajante.id}:${ano}`;
    const inserida = await tx
      .insert(tasks)
      .values({
        tenantId,
        contactId: viajante.contactId,
        title: `Aniversário de ${viajante.fullName} hoje`,
        notes: 'Passageiro (não é o contato titular).',
        kind: 'whatsapp',
        source: 'alerta_aniversario',
        dedupeKey,
        dueAt: new Date(),
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

export type ResultadoAlertasTenant = {
  passaporteCriadas: number;
  aniversarioCriadas: number;
};

export type ResultadoAlertasGeral = ResultadoAlertasTenant & {
  tenantsProcessados: number;
};

/**
 * Roda para TODOS os tenants. Chamado pelo cron — sem sessão de usuário. Ver o
 * comentário do topo do arquivo sobre `authDb` e por que este é o único lugar de
 * `src/server` que o usa.
 */
export async function gerarAlertas(): Promise<ServiceResult<ResultadoAlertasGeral>> {
  return comoResultado(async () => {
    const listaTenants = await authDb.select({ id: tenants.id }).from(tenants);

    let passaporteCriadas = 0;
    let aniversarioCriadas = 0;

    for (const { id: tenantId } of listaTenants) {
      const resultado = await withTenant(tenantId, async (tx) => {
        const passaporte = await gerarAlertasDePassaporte(tx, tenantId);
        const aniversario = await gerarAlertasDeAniversario(tx, tenantId);

        if (passaporte > 0 || aniversario > 0) {
          await registrarAuditoria(tx, {
            tenantId,
            actorUserId: null,
            action: 'alerts.generated',
            entity: 'task',
            metadata: { passaporteCriadas: passaporte, aniversarioCriadas: aniversario },
          });
        }

        return { passaporte, aniversario };
      });

      passaporteCriadas += resultado.passaporte;
      aniversarioCriadas += resultado.aniversario;
    }

    return {
      tenantsProcessados: listaTenants.length,
      passaporteCriadas,
      aniversarioCriadas,
    };
  });
}

/** Mesma lógica, só para o tenant da sessão — para um botão "gerar alertas agora". */
export async function gerarAlertasDoTenantAtual(): Promise<ServiceResult<ResultadoAlertasTenant>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const passaporte = await gerarAlertasDePassaporte(tx, tenantId);
      const aniversario = await gerarAlertasDeAniversario(tx, tenantId);

      if (passaporte > 0 || aniversario > 0) {
        await registrarAuditoria(tx, {
          tenantId,
          actorUserId: userId,
          action: 'alerts.generated',
          entity: 'task',
          metadata: { passaporteCriadas: passaporte, aniversarioCriadas: aniversario },
        });
      }

      return { passaporteCriadas: passaporte, aniversarioCriadas: aniversario };
    });
  });
}

export type TarefaResumo = {
  id: string;
  title: string;
  notes: string | null;
  kind: string;
  source: string;
  contactId: string | null;
  dealId: string | null;
  dueAt: Date;
  doneAt: Date | null;
  createdAt: Date;
};

const COLUNAS_TAREFA = {
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

/** O que a tela "o que vence quando" lê. Fechada por padrão às concluídas. */
export async function listarTarefas(opcoes?: {
  incluirConcluidas?: boolean;
  contatoId?: string;
  limite?: number;
}): Promise<ServiceResult<TarefaResumo[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const limite = Math.min(Math.max(opcoes?.limite ?? 50, 1), 200);

    return withTenant(tenantId, async (tx) => {
      const condicoes = [];
      if (!opcoes?.incluirConcluidas) condicoes.push(isNull(tasks.doneAt));
      if (opcoes?.contatoId) condicoes.push(eq(tasks.contactId, opcoes.contatoId));

      const linhas = await tx
        .select(COLUNAS_TAREFA)
        .from(tasks)
        .where(condicoes.length > 0 ? and(...condicoes) : undefined)
        .orderBy(asc(tasks.dueAt))
        .limit(limite);

      return linhas as TarefaResumo[];
    });
  });
}

export async function concluirTarefa(tarefaId: string): Promise<ServiceResult<null>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const afetadas = await tx
        .update(tasks)
        .set({ doneAt: new Date(), updatedAt: new Date() })
        .where(and(eq(tasks.id, tarefaId), isNull(tasks.doneAt)))
        .returning({ id: tasks.id });

      if (afetadas.length === 0) {
        throw new ServiceError('NAO_ENCONTRADO', 'Essa tarefa não existe mais.', {
          correcao: 'Voltar para a lista',
        });
      }

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'task.done',
        entity: 'task',
        entityId: tarefaId,
      });

      return null;
    });
  });
}
