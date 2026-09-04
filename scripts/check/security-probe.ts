/**
 * Runner autônomo dos testes de segurança.
 *
 * Roda EXATAMENTE a mesma lógica de `tests/security/*.test.ts` (importa os
 * mesmos módulos — não é uma segunda implementação), mas só precisa de `tsx` e
 * do driver `postgres`. Existe porque `vitest` ainda não está instalado neste
 * ambiente e eu não vou entregar teste de segurança que ninguém consegue rodar.
 *
 * Quando o vitest entrar, este script continua útil: é o caminho mais curto
 * entre "mexi na policy" e "vi o resultado".
 *
 *   npx tsx scripts/check/security-probe.ts
 *
 * Sai com código 1 se qualquer checagem falhar.
 */
import { connect } from '../../tests/helpers/db'
import globalSetup from '../../tests/setup/global-setup'
import { findMigrationFiles } from '../../tests/setup/global-setup'
import {
  CONTRACT_TENANT_TABLES,
  TENANT_A,
  TENANT_B,
  isRootTenantTableIsolated,
  missingContractTables,
  runIsolation,
} from '../../tests/security/isolation-checks'
import { runRlsAudit } from '../../tests/security/rls-checks'
import { loadCrypto, runCryptoChecks, type CryptoModule } from '../../tests/crypto/pii-checks'

const RESET = '\x1b[0m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'

let failures = 0

function head(title: string): void {
  console.log(`\n${BOLD}── ${title} ${'─'.repeat(Math.max(0, 62 - title.length))}${RESET}`)
}

function line(ok: boolean, label: string, detail?: string): void {
  if (!ok) failures++
  const mark = ok ? `${GREEN}PASSA${RESET}` : `${RED}FALHA${RESET}`
  console.log(`  ${mark}  ${label}`)
  if (detail && !ok) console.log(`         ${DIM}${detail}${RESET}`)
}

function note(text: string): void {
  console.log(`  ${YELLOW}nota${RESET}   ${text}`)
}

async function main(): Promise<void> {
  head('preparação do banco de teste')
  const migrations = findMigrationFiles()
  await globalSetup()
  line(
    migrations.length > 0,
    `migrations encontradas em drizzle/ (${migrations.length})`,
    'nenhuma migration existe ainda — o schema fica vazio e tudo abaixo falha apontando o que falta',
  )

  const sql = connect()

  try {
    const [role] = await sql<{ who: string; is_super: boolean; bypass: boolean }[]>`
      select current_user as who,
             coalesce((select rolsuper from pg_roles where rolname = current_user), false) as is_super,
             coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) as bypass
    `
    head('a conexão de teste é honesta')
    line(!role.is_super, `${role.who} não é SUPERUSER`)
    line(!role.bypass, `${role.who} não tem BYPASSRLS`)

    // ---- auditoria de RLS -------------------------------------------------
    head('RLS em toda tabela com tenant_id (pg_class)')
    const audit = await runRlsAudit(sql)
    line(
      audit.tenantTables.length > 0,
      `tabelas com tenant_id encontradas: ${audit.tenantTables.length}`,
      'a varredura não olhou nada; auditoria vazia não pode ser considerada verde',
    )
    for (const f of audit.findings) {
      line(f.ok, `${f.table} · ${f.rule}`, f.detail)
    }
    if (audit.tablesWithoutTenantColumn.length > 0) {
      note(
        `fora da varredura (sem tenant_id): ${audit.tablesWithoutTenantColumn.join(', ')}`,
      )
    }

    // ---- isolamento -------------------------------------------------------
    head('isolamento entre tenants (SELECT / UPDATE / DELETE / INSERT)')
    const run = await runIsolation(sql)
    line(
      run.tables.length > 0,
      `tabelas varridas: ${run.tables.map((t) => t.name).join(', ') || '<nenhuma>'}`,
      'nenhuma tabela com tenant_id — não há isolamento a provar',
    )

    const rootIsolated = await isRootTenantTableIsolated(sql)
    line(
      rootIsolated,
      'tenants (a raiz) existe com RLS forçado e policy própria',
      'tenants não tem tenant_id — ela É o tenant. Precisa de policy por `id`.',
    )
    const missing = missingContractTables(run.tables, rootIsolated)
    line(
      missing.length === 0,
      `tabelas do contrato presentes (${CONTRACT_TENANT_TABLES.join(', ')})`,
      `faltando: ${missing.join(', ')}`,
    )

    for (const f of run.seedFailures) {
      line(false, `${f.table} · seed (tenant ${f.tenantId.slice(0, 8)})`, f.error)
    }

    for (const c of run.checks) {
      line(c.ok, `${c.table} · ${c.rule}`, c.detail)
    }
  } finally {
    await sql.end({ timeout: 5 })
  }

  // ---- helper withTenant da aplicação -------------------------------------
  head('helper withTenant (src/lib/tenant)')
  try {
    process.env.USE_TEST_DATABASE = '1'
    const tenant = (await import('../../src/lib/tenant/index')) as Record<string, unknown>
    const drizzle = (await import('drizzle-orm')) as unknown as { sql: { raw: (q: string) => unknown } }
    type Tx = { execute: <R>(q: unknown) => Promise<R[]> }
    const withTenantApp = tenant.withTenant as <T>(id: string, cb: (tx: Tx) => Promise<T>) => Promise<T>
    const currentTenantId = tenant.currentTenantId as (tx: Tx) => Promise<string | null>

    line(typeof withTenantApp === 'function', 'exporta withTenant')
    line(typeof currentTenantId === 'function', 'exporta currentTenantId')

    const inside = await withTenantApp(TENANT_A, (tx) => currentTenantId(tx))
    line(inside === TENANT_A, 'põe app.tenant_id dentro do callback', `veio "${inside}"`)

    const next = await withTenantApp(TENANT_B, (tx) => currentTenantId(tx))
    line(next === TENANT_B, 'não vaza o tenant da chamada anterior', `veio "${next}"`)

    const seen = await withTenantApp(TENANT_A, async (tx) => {
      const rows = await tx.execute<{ n: string }>(
        drizzle.sql.raw(`select count(*)::text as n from public.contacts where tenant_id::text = '${TENANT_B}'`),
      )
      return Number((rows[0] as { n?: string } | undefined)?.n ?? -1)
    })
    line(seen === 0, 'leitura cruzada pelo caminho oficial devolve 0', `devolveu ${seen}`)

    const unsafeDb = tenant.unsafeDbWithoutTenant as { execute: <R>(q: unknown) => Promise<R[]> } | undefined
    if (unsafeDb) {
      const rows = await unsafeDb.execute<{ n: string }>(
        drizzle.sql.raw('select count(*)::text as n from public.contacts'),
      )
      const n = Number((rows[0] as { n?: string } | undefined)?.n ?? -1)
      line(n === 0, 'cliente sem contexto de tenant devolve 0 linhas (fail-closed)', `devolveu ${n}`)
    }
  } catch (error) {
    line(false, 'src/lib/tenant utilizável', error instanceof Error ? error.message : String(error))
  }

  // ---- cifra de PII (não depende de banco) --------------------------------
  head('cifra de PII (AES-256-GCM)')
  const crypto = await loadCrypto()
  if ('error' in crypto) {
    line(false, 'módulo src/lib/crypto disponível', crypto.error.replace(/\n/g, ' '))
  } else {
    line(true, `módulo carregado (${(crypto as CryptoModule).source})`)
    for (const c of runCryptoChecks(crypto as CryptoModule)) {
      line(c.ok, `cifra · ${c.rule}`, c.detail)
    }
  }

  head('resultado')
  if (failures === 0) {
    console.log(`  ${GREEN}${BOLD}Isolamento provado. Nenhuma checagem falhou.${RESET}\n`)
  } else {
    console.log(
      `  ${RED}${BOLD}${failures} checagem(ns) falharam.${RESET}\n` +
        `  ${DIM}Vermelho aqui com o schema ainda inexistente é o esperado nesta sprint.${RESET}\n`,
    )
  }
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error: unknown) => {
  console.error(`\n${RED}${BOLD}o probe não conseguiu rodar${RESET}`)
  console.error(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error))
  process.exit(2)
})
