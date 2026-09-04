import { sql } from 'drizzle-orm';
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
 */

export type TenantDb = Parameters<
  Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]
>[0];

export type WithTenantOptions = {
  /** `true` faz rollback ao final mesmo em caso de sucesso. Serve para teste. */
  readOnlyRollback?: boolean;
};

export async function withTenant<T>(
  tenantId: string,
  callback: (tx: TenantDb) => Promise<T>,
  options: WithTenantOptions = {},
): Promise<T> {
  // Barra antes de chegar no banco: string que não é uuid derruba o cast dentro da
  // policy e transforma "zero linhas" em erro 500 — pior de diagnosticar e pior de
  // explicar. Também fecha a porta para qualquer coisa vinda de header/query string.
  assertUuid(tenantId, 'tenantId');

  return unsafeDbWithoutTenant.transaction(async (tx) => {
    // Parametrizado. Nunca interpole o id na string do SQL.
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);

    const result = await callback(tx);

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
