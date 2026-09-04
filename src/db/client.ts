import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { databaseUrl } from './env';

/**
 * Cliente Postgres da aplicação.
 *
 * LEIA ANTES DE IMPORTAR ISTO: em 99% dos casos você quer `withTenant` de
 * `src/lib/tenant/withTenant.ts`, não este arquivo. Este módulo exporta o cliente CRU,
 * sem contexto de tenant. Com as policies em FORCE, uma query aqui contra tabela de
 * tenant devolve **zero linhas** — não erro, zero linhas. Silencioso. É por isso que o
 * nome é feio.
 */

declare global {
  // eslint-disable-next-line no-var
  var __zarpaSql: ReturnType<typeof postgres> | undefined;
}

function createClient(): ReturnType<typeof postgres> {
  return postgres(databaseUrl(), {
    // Serverless: pool pequeno por instância. O pooler do Neon multiplexa por cima.
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    prepare: false, // obrigatório atrás de pooler em modo transaction
    // `bigint` volta como string por padrão no driver; as colunas de dinheiro estão
    // declaradas com mode 'number' no schema e o Drizzle faz a conversão.
    onnotice: () => {},
  });
}

// Em dev o HMR do Next recria módulos a cada salvamento. Sem este cache, cada
// recompilação abre um pool novo e o Postgres acaba recusando conexão.
const sqlClient = globalThis.__zarpaSql ?? createClient();
if (process.env.NODE_ENV !== 'production') globalThis.__zarpaSql = sqlClient;

/**
 * Cliente sem contexto de tenant. O nome é longo e desagradável de propósito: se ele
 * aparece num diff, o revisor tem que perguntar "por quê?".
 *
 * Casos legítimos:
 *   - migrations e seed;
 *   - webhook do Asaas, que chega sem sessão e precisa achar o tenant pelo
 *     `asaas_customer_id` (e por isso a busca tem que ser por índice único, nunca por
 *     varredura) — resolver o tenant e IMEDIATAMENTE entrar em `withTenant`;
 *   - job de manutenção que roda por tenant, em laço, abrindo contexto a cada volta.
 *
 * Caso ilegítimo, e o mais comum: "a query não retornava nada, aí troquei por este".
 * Se a query não retorna nada dentro de `withTenant`, ou a policy está errada ou o
 * `tenant_id` está errado. Trocar o cliente esconde o bug, não conserta.
 */
export const unsafeDbWithoutTenant: PostgresJsDatabase<typeof schema> = drizzle(sqlClient, {
  schema,
  casing: 'snake_case',
});

/** Driver cru, para DDL e para o migrator. Mesmo aviso do acima, elevado ao quadrado. */
export const unsafeSqlWithoutTenant = sqlClient;

export type Database = PostgresJsDatabase<typeof schema>;
export { schema };
