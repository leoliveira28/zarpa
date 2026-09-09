import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { unsafeDbWithoutTenant, type schema } from '../../db/client';
import { assertUuid } from '../../db/uuid';

/**
 * `withTenant` — o único caminho por onde query de tenant deve passar.
 *
 * Abre uma transação, executa `set_config('app.tenant_id', $1, true)` dentro dela e
 * chama o callback com a conexão já em contexto.
 *
 * O terceiro argumento `true` de `set_config` é o ponto inteiro desta função: significa
 * "local à transação". Quando a transação termina — commit ou rollback — o GUC volta
 * sozinho. Sem isso, a conexão voltaria ao pool ainda apontando para o tenant anterior e
 * a próxima requisição herdaria o contexto de outra pessoa. É exatamente o bug que essa
 * arquitetura existe para não ter.
 *
 * Consequência que vale entender: `set_config(..., true)` fora de uma transação é
 * silenciosamente inútil (o "escopo local" acaba no fim do comando). Por isso a
 * transação não é opcional aqui, nem quando a operação é um único SELECT.
 *
 *     const lista = await withTenant(tenantId, (tx) =>
 *       tx.select().from(contacts).orderBy(desc(contacts.createdAt)).limit(50)
 *     );
 *
 * Não guarde o `tx` fora do callback e não faça `await` de coisa não-banco lá dentro
 * (fetch, envio de e-mail): a transação fica aberta segurando conexão do pool.
 *
 * ---------------------------------------------------------------------------
 * Escopo de visibilidade (Fase 3, §4 de `docs/MULTIUSUARIO_AGENCIAS.md`)
 * ---------------------------------------------------------------------------
 * RLS responde UMA pergunta: este dado pertence a este tenant? "Este agente pode ver o
 * negócio do colega do MESMO tenant?" é regra de produto — e por decisão deliberada do
 * doc NÃO virou policy (duplicaria toda policy existente para responder uma pergunta em
 * que não há adversário: o dono da agência tem direito de ver o que os agentes fazem).
 *
 * O escopo é um PARÂMETRO, e o filtro mora na QUERY:
 *
 *     const lista = await withTenant(tenantId, (tx, escopo) =>
 *       tx.select().from(deals).where(and(
 *         eq(pipelineStages.isLost, false),
 *         filtroDeEscopoProprio(escopo, deals.agentId),   // undefined p/ tenant inteiro
 *       ))
 *     , { scope: { kind: 'own', userId } });
 *
 * Regras da casa:
 *   - quem decide o escopo é o SERVICE layer (mesma disciplina do `ServiceResult`) —
 *     nunca o componente de tela, nunca o repositório;
 *   - `{ kind: 'own' }` sem `userId` é BUG de quem chama: esta função recusa na hora,
 *     em vez de silenciosamente devolver o tenant inteiro;
 *   - o escopo NUNCA vai para GUC nem para policy — é filtrá-lo no SELECT ou não
 *     filtrar; colocar no banco seria recriar RLS pela janela.
 */

/** Visibilidade DENTRO do tenant: tudo (dono/admin) ou só o próprio (agente). */
export type TenantScope = { kind: 'tenant' } | { kind: 'own'; userId: string };

export type TenantDb = Parameters<
  Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]
>[0];

export type WithTenantOptions = {
  /** `true` faz rollback ao final mesmo em caso de sucesso. Serve para teste. */
  readOnlyRollback?: boolean;
  /**
   * Visibilidade dentro do tenant (ver o comentário de topo). Ausente = tenant inteiro.
   * O escopo resolvido chega ao callback como segundo argumento — quem escreve a query
   * não deve re-derivar escopo de jeito nenhum, só consumir o que veio.
   */
  scope?: TenantScope;
};

/** Escopo padrão, quando quem chama não passou nada: o tenant inteiro. */
const ESCOPO_DO_TENANT: TenantScope = { kind: 'tenant' };

export async function withTenant<T>(
  tenantId: string,
  callback: (tx: TenantDb, escopo: TenantScope) => Promise<T>,
  options: WithTenantOptions = {},
): Promise<T> {
  // Barra antes de chegar no banco: string que não é uuid derruba o cast dentro da
  // policy e transforma "zero linhas" em erro 500 — pior de diagnosticar e pior de
  // explicar. Também fecha a porta para qualquer coisa vinda de header/query string.
  assertUuid(tenantId, 'tenantId');

  const escopo = options.scope ?? ESCOPO_DO_TENANT;
  if (escopo.kind === 'own') {
    // Um userId ausente/inválido num escopo `own` tem que ESTOURAR aqui — devolver o
    // tenant inteiro por causa de um parâmetro esquecido é exatamente o vazamento que
    // este parâmetro existe para não ter.
    assertUuid(escopo.userId, 'scope.userId');
  }

  return unsafeDbWithoutTenant.transaction(async (tx) => {
    // Parametrizado. Nunca interpole o id na string do SQL.
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);

    const result = await callback(tx, escopo);

    if (options.readOnlyRollback) {
      throw new RollbackSignal(result);
    }
    return result;
  }).catch((error: unknown) => {
    if (error instanceof RollbackSignal) return error.value as T;
    throw error;
  });
}

class RollbackSignal extends Error {
  // Campo declarado no corpo, não como parameter property: a sintaxe
  // `constructor(readonly value)` não é apagável e o Node não roda TypeScript com ela.
  value: unknown;

  constructor(value: unknown) {
    super('rollback solicitado por withTenant({ readOnlyRollback: true })');
    this.name = 'RollbackSignal';
    this.value = value;
  }
}

/**
 * O filtro do escopo `own`, pronto para o `.where()` — `undefined` quando o escopo é do
 * tenant inteiro (o `and(...)` do Drizzle ignora `undefined`, então o chamador espalha
 * sem `if`).
 *
 *     .where(and(eq(pipelineStages.isLost, false), filtroDeEscopoProprio(escopo, deals.agentId)))
 *
 * Passar a coluna POR PARÂMETRO é o que impede a função de virar mágica: quem escreve a
 * query escolhe qual coluna separa "meu trabalho" do "trabalho do time" — hoje é sempre
 * `deals.agent_id`/`sales.agent_id`, mas a escolha é visível no diff, não enterrada.
 */
export function filtroDeEscopoProprio(
  escopo: TenantScope,
  coluna: SQLWrapper,
): SQL | undefined {
  if (escopo.kind !== 'own') return undefined;
  return sql`${coluna} = ${escopo.userId}`;
}

/**
 * Confere, de dentro da transação, qual tenant está ativo. Útil em asserção de teste e
 * em log de diagnóstico. Devolve `null` quando não há contexto — que é o estado em que
 * toda tabela de tenant devolve zero linhas.
 */
export async function currentTenantId(tx: TenantDb): Promise<string | null> {
  const rows = await tx.execute<{ tenant_id: string | null }>(
    sql`select nullif(current_setting('app.tenant_id', true), '') as tenant_id`,
  );
  const first = rows[0] as { tenant_id: string | null } | undefined;
  return first?.tenant_id ?? null;
}

export { unsafeDbWithoutTenant } from '../../db/client';
