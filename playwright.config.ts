import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'
import { loadEnv } from './tests/setup/env'

loadEnv()

/**
 * O Chromium já está no disco. NÃO rodar `playwright install` — ele baixa de
 * novo e o CI/sandbox pode nem ter rede para isso.
 */
const CHROMIUM_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
].filter((p): p is string => typeof p === 'string' && p.length > 0)

const executablePath = CHROMIUM_CANDIDATES.find((p) => existsSync(p))

const PORT = Number(process.env.PORT ?? 3000)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './tests/a11y',
  testMatch: '**/*.spec.ts',

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },

  // S2 pede os componentes verificados nos DOIS temas e com reduced-motion.
  projects: [
    {
      name: 'chromium-light',
      use: { ...devices['Desktop Chrome'], colorScheme: 'light' },
    },
    {
      name: 'chromium-dark',
      use: { ...devices['Desktop Chrome'], colorScheme: 'dark' },
    },
    {
      name: 'chromium-reduced-motion',
      use: {
        ...devices['Desktop Chrome'],
        colorScheme: 'light',
        reducedMotion: 'reduce',
      },
    },
  ],

  webServer: {
    // No CI o build já rodou; `start` serve o bundle de produção, que é o que
    // o usuário recebe. Local usa `dev` para não precisar buildar a cada vez.
    command: process.env.CI ? 'npm run start' : 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
