/**
 * Config do drizzle-kit.
 *
 * NOTA (Rafa, S1): `drizzle-kit` NÃO está instalado neste repositório — só `drizzle-orm`.
 * Por isso este arquivo não importa `defineConfig` de 'drizzle-kit': o import quebraria
 * `npx tsc --noEmit`. O formato é o mesmo objeto que o `defineConfig` recebe, então na hora
 * em que a dependência entrar basta trocar o `export default` por `export default
 * defineConfig({...})` sem mexer no conteúdo. Pedido aberto em
 * `docs/handoffs/rafa-para-po.md`.
 *
 * Enquanto isso, as migrations são escritas à mão em `drizzle/*.sql` e aplicadas por
 * `src/db/migrate.ts`, que usa o migrator do próprio drizzle-orm (lê `drizzle/meta/_journal.json`).
 * Escrever o SQL à mão não é workaround aqui: as policies de RLS precisam nascer na mesma
 * migration da tabela, e o gerador não emite policy.
 */

type DrizzleKitConfig = {
  schema: string;
  out: string;
  dialect: 'postgresql';
  dbCredentials: { url: string };
  casing?: 'snake_case' | 'camelCase';
  strict?: boolean;
  verbose?: boolean;
};

const config: DrizzleKitConfig = {
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  casing: 'snake_case',
  strict: true,
  verbose: true,
};

export default config;
