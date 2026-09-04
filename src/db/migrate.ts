/**
 * Aplica as migrations de `drizzle/`.
 *
 *     node --env-file=.env.local src/db/migrate.ts
 *
 * Usa o migrator do próprio `drizzle-orm` (não precisa de `drizzle-kit`): ele lê
 * `drizzle/meta/_journal.json`, aplica os `.sql` que ainda não rodaram e registra o que
 * aplicou em `drizzle.__drizzle_migrations`. Rodar duas vezes é no-op.
 *
 * Ao acrescentar uma migration: crie `drizzle/000N_<nome>.sql` e a entrada correspondente
 * no journal (`idx` sequencial, `tag` igual ao nome do arquivo sem extensão). Os comandos
 * são separados por `--> statement-breakpoint`.
 */

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { unsafeDbWithoutTenant, unsafeSqlWithoutTenant } from './client';

async function main(): Promise<void> {
  const target = process.env.NODE_ENV === 'test' || process.env.USE_TEST_DATABASE === '1'
    ? 'TEST_DATABASE_URL'
    : 'DATABASE_URL';
  console.log(`[migrate] aplicando migrations em ${target}`);

  await migrate(unsafeDbWithoutTenant, { migrationsFolder: './drizzle' });

  const [{ count }] = (await unsafeSqlWithoutTenant`
    select count(*)::int as count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  `) as unknown as [{ count: number }];

  const semRls = (await unsafeSqlWithoutTenant`
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and (not c.relrowsecurity or not c.relforcerowsecurity)
    order by c.relname
  `) as unknown as { relname: string }[];

  console.log(`[migrate] ok — ${count} tabelas em public`);

  if (semRls.length > 0) {
    // Não é aviso: é falha. Tabela sem RLS FORCE é tabela que vaza entre tenants.
    console.error(
      `[migrate] FALHA: tabela sem RLS habilitado E forçado: ${semRls
        .map((r) => r.relname)
        .join(', ')}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log('[migrate] todas as tabelas com RLS habilitado e forçado');
}

main()
  .catch((error: unknown) => {
    console.error('[migrate] erro:', error);
    process.exitCode = 1;
  })
  .finally(() => unsafeSqlWithoutTenant.end());
