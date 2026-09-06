import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Sem isto, qualquer módulo de `src/server/**` que use o alias `@/*` (a maioria —
  // é o padrão do projeto, ver tsconfig.json `paths`) quebra a resolução assim que o
  // vitest tenta importá-lo, mesmo que o TESTE em si só use caminho relativo. Os testes
  // de segurança escapam disso hoje porque `src/lib/crypto` e `src/lib/tenant` (só o
  // que eles importam) só usam caminho relativo internamente — `src/server/imports.ts`
  // não tem essa sorte. Um alias só, espelhando o `tsconfig.json`, resolve para toda
  // a árvore de uma vez — não é gambiarra por arquivo.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    // Playwright tem harness próprio (`tests/a11y/*.spec.ts`).
    exclude: ['node_modules/**', 'tests/a11y/**', '.next/**'],

    // Carrega .env.local antes de qualquer import de teste.
    setupFiles: ['tests/setup/setup-file.ts'],

    // Recria o schema do zarpa_test e aplica as migrations a cada rodada.
    globalSetup: ['tests/setup/global-setup.ts'],

    // Um banco só, compartilhado: paralelismo por arquivo criaria corrida no
    // seed. O ganho de tempo não paga o teste intermitente.
    // (poolOptions saiu do InlineConfig no vitest 5 — fileParallelism basta.)
    fileParallelism: false,
    pool: 'forks',

    testTimeout: 30_000,
    hookTimeout: 60_000,

    reporters: ['verbose'],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/app/**/layout.tsx',
        'src/app/**/page.tsx',
        'src/**/*.stories.tsx',
      ],
      // Sem `thresholds` de propósito: número de cobertura em repositório que
      // ainda não tem `src/` vira teatro. Ver docs/status/teo.md.
    },
  },
})
