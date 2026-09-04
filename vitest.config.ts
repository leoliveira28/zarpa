import { defineConfig } from 'vitest/config'

export default defineConfig({
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
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },

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
