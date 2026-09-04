/**
 * globalSetup do vitest: recria o schema do `zarpa_test` do zero a cada rodada
 * e aplica as migrations da Rafa (`drizzle/*.sql`).
 *
 * Por que arquivo `.sql` cru e não `drizzle-kit migrate`: `drizzle-kit` não está
 * instalado (ver docs/handoffs/teo-para-po.md) e as migrations do Drizzle são
 * SQL puro separado por `--> statement-breakpoint`. Aplicar direto elimina uma
 * dependência e mantém o CI honesto: se a migration não roda, a rodada é vermelha.
 *
 * Se ainda não existir migration, isto NÃO explode. O banco fica vazio e os
 * testes de contrato falham dizendo exatamente o que falta — que é a entrega
 * desta sprint, não um bloqueio.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postgres from 'postgres'
import { testDatabaseUrl } from './env.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..')
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'drizzle')

export type MigrationReport = {
  directory: string
  found: string[]
  applied: string[]
  failed: { file: string; error: string }[]
}

export function findMigrationFiles(dir = MIGRATIONS_DIR): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

function splitStatements(sql: string): string[] {
  return sql
    .split(/-->\s*statement-breakpoint/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export async function resetSchema(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`
    drop schema if exists public cascade;
    create schema public;
    grant all on schema public to current_user;
    grant all on schema public to public;
  `)
}

export async function applyMigrations(sql: postgres.Sql): Promise<MigrationReport> {
  const found = findMigrationFiles()
  const report: MigrationReport = {
    directory: MIGRATIONS_DIR,
    found,
    applied: [],
    failed: [],
  }

  for (const file of found) {
    const contents = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8')
    try {
      for (const statement of splitStatements(contents)) {
        await sql.unsafe(statement)
      }
      report.applied.push(file)
    } catch (error) {
      report.failed.push({
        file,
        error: error instanceof Error ? error.message : String(error),
      })
      // Migration quebrada invalida as seguintes; para aqui e deixa vermelho.
      break
    }
  }

  return report
}

export default async function globalSetup(): Promise<void> {
  const url = testDatabaseUrl()
  const sql = postgres(url, { max: 1, onnotice: () => {}, prepare: false })

  try {
    await resetSchema(sql)
    const report = await applyMigrations(sql)

    const target = url.replace(/:\/\/[^@]*@/, '://***@')
    if (report.found.length === 0) {
      console.warn(
        `\n[globalSetup] ${target}: schema recriado, 0 migrations em ${report.directory}.\n` +
          `[globalSetup] Os testes de contrato vão falhar apontando o que falta. Isso é esperado enquanto o schema não existe.\n`,
      )
    } else if (report.failed.length > 0) {
      const [first] = report.failed
      console.error(
        `\n[globalSetup] MIGRATION FALHOU: ${first.file}\n[globalSetup] ${first.error}\n`,
      )
    } else {
      console.log(
        `[globalSetup] ${target}: schema recriado, ${report.applied.length} migration(s) aplicada(s).`,
      )
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}
