/**
 * Leitura de variáveis de ambiente do lado do banco.
 *
 * Fica em `src/db/` (área da Rafa) de propósito: `src/lib/config.ts` é território
 * compartilhado e este arquivo lê segredo. Nada aqui pode ser importado por Client Component.
 */

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Variável de ambiente ${name} não definida. ` +
        `Em script de linha de comando use: node --env-file=.env.local <script>`,
    );
  }
  return value;
}

/**
 * URL do banco. `TEST_DATABASE_URL` ganha quando `NODE_ENV=test` ou `USE_TEST_DATABASE=1`,
 * para que um teste jamais escreva no banco de desenvolvimento por descuido.
 */
export function databaseUrl(): string {
  const useTest = process.env.NODE_ENV === 'test' || process.env.USE_TEST_DATABASE === '1';
  if (useTest) {
    const testUrl = process.env.TEST_DATABASE_URL;
    if (testUrl && testUrl.trim() !== '') return testUrl;
  }
  return requiredEnv('DATABASE_URL');
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}
