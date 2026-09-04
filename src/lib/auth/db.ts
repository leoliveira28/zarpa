import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';
import { databaseUrl } from '@/db/env';

/**
 * Conexão exclusiva do serviço de autenticação.
 *
 * O problema que ela resolve: autenticar acontece ANTES de existir tenant. No login por
 * e-mail ainda não se sabe de quem é a conta, então não há `app.tenant_id` para setar — e
 * com RLS em FORCE, sem contexto o banco devolve zero linhas e ninguém entra.
 *
 * A saída NÃO é afrouxar as policies de tenant (a policy `X_isolation` de `user` continua
 * exigindo match exato). A saída é uma segunda policy, `X_auth_service`, que só concede
 * quando `app.auth_context = 'on'` — e esse GUC é ligado aqui, no pacote de startup da
 * conexão, e em nenhum outro lugar do código. Consequência prática:
 *
 *   - Este cliente enxerga `user`, `session`, `account`, `verification` e `tenants` sem
 *     contexto de tenant. É o preço de ter login.
 *   - O cliente normal da aplicação (`unsafeDbWithoutTenant`) NÃO enxerga nada disso:
 *     `app.auth_context` está sempre indefinido lá. Uma consulta distraída em `account`
 *     pelo caminho comum devolve zero linhas em vez de hash de senha de todo mundo.
 *   - Nenhuma tabela de negócio (contacts, deals, proposals, ...) tem policy
 *     `auth_service`. Este cliente não lê dado de cliente de ninguém.
 *
 * Isolar num arquivo próprio é intencional: um `grep auth_context` mostra a superfície
 * inteira em duas linhas.
 */

declare global {
  // eslint-disable-next-line no-var
  var __zarpaAuthSql: ReturnType<typeof postgres> | undefined;
}

function createAuthClient(): ReturnType<typeof postgres> {
  return postgres(databaseUrl(), {
    max: Number(process.env.AUTH_POOL_MAX ?? 4),
    idle_timeout: 20,
    prepare: false,
    // Ligado no startup da conexão, não por query: não há janela em que uma consulta
    // deste pool rode sem o contexto, nem como esquecer de setar.
    connection: { options: '-c app.auth_context=on' },
    onnotice: () => {},
  });
}

const authSqlClient = globalThis.__zarpaAuthSql ?? createAuthClient();
if (process.env.NODE_ENV !== 'production') globalThis.__zarpaAuthSql = authSqlClient;

export const authDb: PostgresJsDatabase<typeof schema> = drizzle(authSqlClient, {
  schema,
  casing: 'snake_case',
});

export const authSql = authSqlClient;
