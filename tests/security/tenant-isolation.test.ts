/**
 * O teste que define a S1.
 *
 * Conectado como o role `zarpa` (NOSUPERUSER / NOBYPASSRLS), posicionado no
 * tenant A, para CADA tabela que tem `tenant_id`:
 *
 *   - SELECT não devolve nenhuma linha do tenant B
 *   - SELECT sem `app.tenant_id` não devolve nada (padrão fechado)
 *   - UPDATE em linha do B afeta zero linhas e não altera o valor do B
 *   - DELETE em linha do B afeta zero linhas e a linha do B continua lá
 *   - INSERT com `tenant_id` do B é recusado pelo WITH CHECK
 *
 * A lista de tabelas vem do catálogo do Postgres, não daqui. Tabela nova com
 * `tenant_id` entra na varredura sozinha — ninguém precisa lembrar de nada.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { connect } from '../helpers/db.ts'
import {
  CONTRACT_TENANT_TABLES,
  TENANT_A,
  TENANT_B,
  missingContractTables,
  runIsolation,
} from './isolation-checks.ts'

const sql = connect()
const run = await runIsolation(sql)

afterAll(async () => {
  await sql.end({ timeout: 5 })
})

describe('contrato do schema multi-tenant', () => {
  it('existe pelo menos uma tabela com tenant_id', () => {
    // Sem esta trava, um banco vazio faria a varredura passar com zero testes.
    // Suíte verde varrendo nada é pior do que suíte vermelha.
    expect(
      run.tables.length,
      'nenhuma tabela com coluna tenant_id encontrada no schema public. ' +
        'Rode as migrations (drizzle/) antes — ou elas ainda não existem.',
    ).toBeGreaterThan(0)
  })

  it(`as tabelas do CLAUDE.md existem com tenant_id: ${CONTRACT_TENANT_TABLES.join(', ')}`, () => {
    const missing = missingContractTables(run.tables)
    expect(
      missing,
      `faltando (ou sem coluna tenant_id): ${missing.join(', ')}. ` +
        `Presentes: ${run.tables.map((t) => t.name).join(', ') || '<nenhuma>'}`,
    ).toEqual([])
  })

  it('o seed conseguiu criar uma linha por tabela para os dois tenants', () => {
    const detail = run.seedFailures
      .map((f) => `  ${f.table} (tenant ${f.tenantId.slice(0, 8)}): ${f.error}`)
      .join('\n')
    expect(run.seedFailures, `seed falhou:\n${detail}`).toEqual([])
  })

  it('a conexão de teste NÃO tem privilégio para furar RLS', async () => {
    const [row] = await sql<{ is_super: boolean; bypass: boolean; who: string }[]>`
      select current_user as who,
             coalesce((select rolsuper from pg_roles where rolname = current_user), false) as is_super,
             coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) as bypass
    `
    expect(row.is_super, `${row.who} é SUPERUSER — o teste inteiro fica sem valor`).toBe(false)
    expect(row.bypass, `${row.who} tem BYPASSRLS — o teste inteiro fica sem valor`).toBe(false)
  })
})

// Uma suíte por tabela descoberta, um `it` por regra. Assim a saída diz
// exatamente qual tabela e qual verbo vazou, sem ninguém ler stack trace.
describe.each(run.tables.map((t) => t.qualified))('isolamento: %s', (qualified) => {
  const checks = run.checks.filter((c) => c.table === qualified)

  it(`tenant A não LÊ linha do tenant B`, () => {
    const c = checks.find((x) => x.rule === 'select')
    expect(c?.ok, c?.detail ?? 'checagem não executou (ver falha de seed acima)').toBe(true)
  })

  it(`sem app.tenant_id não vem nada (fail-closed)`, () => {
    const c = checks.find((x) => x.rule === 'fail-closed')
    expect(c?.ok, c?.detail ?? 'checagem não executou (ver falha de seed acima)').toBe(true)
  })

  it(`UPDATE do tenant A em linha do B afeta zero linhas`, () => {
    const c = checks.find((x) => x.rule === 'update')
    expect(c?.ok, c?.detail ?? 'checagem não executou (ver falha de seed acima)').toBe(true)
  })

  it(`DELETE do tenant A em linha do B afeta zero linhas`, () => {
    const c = checks.find((x) => x.rule === 'delete')
    expect(c?.ok, c?.detail ?? 'checagem não executou (ver falha de seed acima)').toBe(true)
  })

  it(`INSERT com tenant_id do B é recusado pelo WITH CHECK`, () => {
    const c = checks.find((x) => x.rule === 'insert-with-check')
    expect(c?.ok, c?.detail ?? 'checagem não executou (ver falha de seed acima)').toBe(true)
  })
})

describe('helper withTenant da aplicação (src/lib/tenant)', () => {
  it('exporta withTenant e ele isola de verdade', async () => {
    let mod: Record<string, unknown>
    try {
      mod = (await import('../../src/lib/tenant/index.ts')) as Record<string, unknown>
    } catch {
      throw new Error(
        'src/lib/tenant não exporta um módulo importável ainda. ' +
          'O contrato do CLAUDE.md pede um helper withTenant que abra transação e ' +
          "faça set_config('app.tenant_id', $1, true). Dono: Rafa.",
      )
    }

    expect(typeof mod.withTenant, 'src/lib/tenant não exporta withTenant').toBe('function')

    // Passa pelo helper de verdade: se ele esquecer o set_config, ou usar
    // `false` no terceiro argumento (vazando tenant para a conexão inteira),
    // a leitura cruzada aparece aqui.
    const withTenantApp = mod.withTenant as <T>(
      tenantId: string,
      fn: (tx: unknown) => Promise<T>,
    ) => Promise<T>

    const table = run.tables[0]?.qualified
    if (table === undefined) return

    const seen = await withTenantApp(TENANT_A, async (tx) => {
      const client = tx as { unsafe: (q: string, p: unknown[]) => Promise<{ n: string }[]> }
      const rows = await client.unsafe(
        `select count(*)::text as n from ${table} where tenant_id::text = $1`,
        [TENANT_B],
      )
      return Number(rows[0]?.n ?? -1)
    })

    expect(seen, `withTenant deixou o tenant A ver ${seen} linha(s) do tenant B em ${table}`).toBe(0)
  })
})
