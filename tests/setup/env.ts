/**
 * Carrega `.env.local` sem depender de `dotenv` (que não está instalado).
 * Node 22 tem `process.loadEnvFile`; o fallback cobre Node mais antigo e CI.
 *
 * Não sobrescreve variável já presente no ambiente — no CI o workflow define
 * TEST_DATABASE_URL direto e ele deve vencer sobre qualquer arquivo local.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..')

function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

let loaded = false

export function loadEnv(): void {
  if (loaded) return
  loaded = true

  for (const file of ['.env.local', '.env']) {
    const path = resolve(REPO_ROOT, file)
    if (!existsSync(path)) continue
    const parsed = parseEnvFile(readFileSync(path, 'utf8'))
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) process.env[key] = value
    }
  }
}

/** Lê uma variável obrigatória e explode com mensagem acionável, não com `undefined`. */
export function requireEnv(name: string): string {
  loadEnv()
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(
      `[env] ${name} não está definida. Defina em .env.local (local) ou no workflow (CI).`,
    )
  }
  return value
}

/**
 * URL do banco de TESTE. Nunca cai para DATABASE_URL: o globalSetup dá DROP
 * SCHEMA nesse banco, e apontar isso para o banco de desenvolvimento por
 * engano apaga o trabalho da Rafa e da Nina.
 */
export function testDatabaseUrl(): string {
  const url = requireEnv('TEST_DATABASE_URL')
  if (!/_test(\?|$)/.test(url)) {
    throw new Error(
      `[env] TEST_DATABASE_URL aponta para "${url}", que não termina em "_test". ` +
        `Este processo recria o schema do banco inteiro; recuso rodar fora de um banco *_test.`,
    )
  }
  return url
}

loadEnv()
