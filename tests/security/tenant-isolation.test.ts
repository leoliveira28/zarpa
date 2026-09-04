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
import { connect } from '../helpers/db'
import {
  AUTH_CONTEXT_OPEN_TABLES,
  CONTRACT_TENANT_TABLES,
  TENANT_A,
  TENANT_B,
  isRootTenantTableIsolated,
  missingContractTables,
  runIsolation,
} from './isolation-checks'

const sql = connect()
const run = await runIsolation(sql)
const rootIsolated = await isRootTenantTableIsolated(sql)

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
    const missing = missingContractTables(run.tables, rootIsolated)
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

  it(`INSERT com tenant_id do B não grava linha do tenant B`, () => {
    const c = checks.find((x) => x.rule === 'insert-with-check')
    expect(c?.ok, c?.detail ?? 'checagem não executou (ver falha de seed acima)').toBe(true)
  })

  it(`app.auth_context='on' não abre esta tabela entre tenants`, () => {
    const c = checks.find((x) => x.rule === 'auth-context-blast-radius')
    expect(c?.ok, c?.detail ?? 'checagem não executou').toBe(true)
  })
})

describe('porta de fuga do serviço de auth', () => {
  it('só as tabelas fixadas ficam abertas com app.auth_context ligado', () => {
    // `tenants` e `user` têm policy permissiva sem filtro de tenant, para o
    // Better Auth resolver o usuário antes de existir contexto. Policies
    // permissivas somam por OR: enquanto a GUC estiver ligada, aquelas tabelas
    // não têm isolamento. É decisão de desenho, não bug — mas fica FIXADA aqui
    // para que uma terceira tabela nessa condição apareça como falha.
    const leaking = run.checks
      .filter((c) => c.rule === 'auth-context-blast-radius' && c.detail.includes('VAZAMENTO NOVO'))
      .map((c) => c.table)
    expect(
      leaking,
      `tabela(s) fora da lista fixada abriram com app.auth_context='on'. ` +
        `Lista atual: ${AUTH_CONTEXT_OPEN_TABLES.join(', ')}. ` +
        `Se for intencional, acrescente na constante e explique no PR.`,
    ).toEqual([])
  })
})

describe('helper withTenant da aplicação (src/lib/tenant)', () => {
  // Aqui o objeto sob teste é o HELPER, não a policy. Vale a pena separado:
  // a policy pode estar perfeita e o helper vazar contexto entre requisições —
  // é o bug clássico de `set_config(..., false)` numa conexão de pool.
  it('existe, roda em transação e isola de verdade', async () => {
    let mod: Record<string, unknown>
    let raw: (q: string) => unknown
    try {
      mod = (await import('../../src/lib/tenant/index')) as Record<string, unknown>
      const drizzle = (await import('drizzle-orm')) as unknown as {
        sql: { raw: (q: string) => unknown }
      }
      raw = (q: string) => drizzle.sql.raw(q)
    } catch (e) {
      throw new Error(
        'não consegui importar src/lib/tenant: ' +
          `${e instanceof Error ? e.message : String(e)}. ` +
          "Contrato: withTenant(tenantId, cb) abrindo transação com set_config('app.tenant_id', $1, true). Dono: Rafa.",
      )
    }

    expect(typeof mod.withTenant, 'src/lib/tenant não exporta withTenant').toBe('function')
    expect(typeof mod.currentTenantId, 'src/lib/tenant não exporta currentTenantId').toBe('function')

    type Tx = { execute: <R>(q: unknown) => Promise<R[]> }
    const withTenantApp = mod.withTenant as <T>(
      tenantId: string,
      cb: (tx: Tx) => Promise<T>,
    ) => Promise<T>
    const currentTenantId = mod.currentTenantId as (tx: Tx) => Promise<string | null>

    // 1. o helper realmente põe o tenant no contexto
    const inside = await withTenantApp(TENANT_A, (tx) => currentTenantId(tx))
    expect(inside, 'withTenant não deixou app.tenant_id setado dentro do callback').toBe(TENANT_A)

    // 2. o contexto NÃO sobrevive à transação — senão a próxima requisição que
    //    pegar essa conexão do pool herda o tenant da anterior
    const after = await withTenantApp(TENANT_B, (tx) => currentTenantId(tx))
    expect(after, 'withTenant vazou o tenant da chamada anterior').toBe(TENANT_B)

    // 3. leitura cruzada pelo caminho oficial
    const table = run.tables[0]?.qualified
    if (table === undefined) return
    const seen = await withTenantApp(TENANT_A, async (tx) => {
      // TENANT_B é constante do próprio teste, não entrada externa.
      const rows = await tx.execute<{ n: string }>(
        raw(`select count(*)::text as n from ${table} where tenant_id::text = '${TENANT_B}'`),
      )
      const first = rows[0] as { n?: string } | undefined
      return Number(first?.n ?? -1)
    })
    expect(seen, `withTenant deixou o tenant A ver ${seen} linha(s) do tenant B em ${table}`).toBe(0)
  })
})
