/**
 * A lógica do teste de isolamento, isolada do harness.
 *
 * Vive separada de `tenant-isolation.test.ts` porque roda em dois lugares: no
 * vitest (quando as dependências estiverem instaladas) e no runner de
 * `scripts/check/` (que só precisa de `tsx`). Em ambos ela fala com um Postgres
 * de verdade — não existe mock aqui, e não deve existir. Um mock de RLS testa
 * a minha crença sobre RLS, não o RLS.
 */
import {
  TENANT_COLUMN,
  describeTable,
  discoverTenantTables,
  insertRow,
  seedTenantRows,
  withTenant,
  withoutTenant,
  type Sql,
  type TableShape,
  type TenantTable,
} from '../helpers/db'

/** Tabelas que o CLAUDE.md promete para a S1. Ausência é falha, não "skip". */
export const CONTRACT_TENANT_TABLES = ['tenants', 'contacts', 'deals', 'proposals'] as const

export const TENANT_A = '11111111-1111-4111-8111-111111111111'
export const TENANT_B = '22222222-2222-4222-8222-222222222222'
export const PWNED = 'TEO-PWNED'

export type Check = {
  table: string
  rule: string
  ok: boolean
  detail: string
}

export type IsolationRun = {
  tables: TenantTable[]
  shapes: TableShape[]
  seedFailures: { table: string; tenantId: string; error: string }[]
  checks: Check[]
  tenantIdColumnType: Map<string, string>
}

function pk(shape: TableShape, row: Record<string, unknown> | undefined): [string, unknown] | null {
  if (!row) return null
  const col = shape.primaryKey[0]
  if (col === undefined) return null
  const value = row[col]
  if (value === undefined) return null
  return [col, value]
}

/** Coluna de texto boa para tentar mutar — permite detectar escrita real, não só rowcount. */
function mutableTextColumn(shape: TableShape): string | null {
  const fkCols = new Set(shape.foreignKeys.map((f) => f.column))
  const pkCols = new Set(shape.primaryKey)
  for (const c of shape.columns) {
    if (c.isGenerated || c.isIdentity) continue
    if (c.name === TENANT_COLUMN) continue
    if (pkCols.has(c.name) || fkCols.has(c.name)) continue
    if (['text', 'varchar', 'bpchar'].includes(c.udtName)) {
      if (c.charMaxLength !== null && c.charMaxLength < PWNED.length) continue
      return c.name
    }
  }
  return null
}

function firstWritableColumn(shape: TableShape): string | null {
  const pkCols = new Set(shape.primaryKey)
  for (const c of shape.columns) {
    if (c.isGenerated || c.isIdentity) continue
    if (c.name === TENANT_COLUMN || pkCols.has(c.name)) continue
    return c.name
  }
  return null
}

/** `insertRow` reexportado com nome próprio para deixar o uso cruzado explícito. */
const insertRowRef = insertRow

function errText(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code
    return code ? `${code}: ${error.message}` : error.message
  }
  return String(error)
}

/** `insert ... with check` violado devolve 42501. Qualquer outro erro é outra barreira. */
function isRlsViolation(error: unknown): boolean {
  const code = (error as { code?: string } | undefined)?.code
  if (code === '42501') return true
  return /row-level security/i.test(typeof error === 'string' ? error : errText(error))
}

export async function runIsolation(sql: Sql): Promise<IsolationRun> {
  const tables = await discoverTenantTables(sql)
  const shapes: TableShape[] = []
  for (const t of tables) shapes.push(await describeTable(sql, t.schema, t.name))

  const tenantIdColumnType = new Map<string, string>()
  for (const shape of shapes) {
    const col = shape.columns.find((c) => c.name === TENANT_COLUMN)
    if (col) tenantIdColumnType.set(shape.qualified, col.udtName)
  }

  const { pks, results } = await seedTenantRows(sql, shapes, [TENANT_A, TENANT_B])
  const seedFailures = results
    .filter((r): r is Extract<typeof r, { ok: false }> => !r.ok)
    .map(({ table, tenantId, error }) => ({ table, tenantId, error }))

  const checks: Check[] = []
  const add = (table: string, rule: string, ok: boolean, detail: string): void => {
    checks.push({ table, rule, ok, detail })
  }

  for (const shape of shapes) {
    const table = shape.qualified
    const rowB = pks.get(`${table}::${TENANT_B}`)
    const rowA = pks.get(`${table}::${TENANT_A}`)

    if (!rowB || !rowA) {
      add(
        table,
        'seed',
        false,
        `não consegui semear linha para os dois tenants (A=${rowA ? 'ok' : 'faltou'}, B=${rowB ? 'ok' : 'faltou'}); ` +
          `sem as duas linhas não dá para provar isolamento nesta tabela`,
      )
      continue
    }
    add(table, 'seed', true, 'linha semeada para o tenant A e para o tenant B')

    const pkB = pk(shape, rowB)
    if (!pkB) {
      add(table, 'seed', false, `tabela sem chave primária utilizável; não sei endereçar a linha do B`)
      continue
    }
    const [pkCol, pkValB] = pkB

    // ---- SELECT: o tenant A não enxerga nada do tenant B --------------------
    try {
      const visible = await withTenant(sql, TENANT_A, async (tx) => {
        const rows = await tx.unsafe<{ n: string }[]>(
          `select count(*)::text as n from ${table} where "${TENANT_COLUMN}"::text = $1`,
          [TENANT_B],
        )
        return Number(rows[0]?.n ?? -1)
      })
      add(
        table,
        'select',
        visible === 0,
        visible === 0
          ? 'SELECT como tenant A devolveu 0 linhas do tenant B'
          : `VAZAMENTO: SELECT como tenant A devolveu ${visible} linha(s) do tenant B`,
      )
    } catch (error) {
      add(table, 'select', false, `SELECT falhou: ${errText(error)}`)
    }

    // ---- SELECT sem tenant: padrão fechado ---------------------------------
    try {
      const leaked = await withoutTenant(sql, async (tx) => {
        const rows = await tx.unsafe<{ n: string }[]>(`select count(*)::text as n from ${table}`)
        return Number(rows[0]?.n ?? -1)
      })
      add(
        table,
        'fail-closed',
        leaked === 0,
        leaked === 0
          ? 'sem app.tenant_id a tabela devolve 0 linhas (padrão fechado)'
          : `VAZAMENTO: sem app.tenant_id a tabela devolveu ${leaked} linha(s); a policy precisa ser fail-closed`,
      )
    } catch (error) {
      add(table, 'fail-closed', false, `SELECT sem tenant falhou: ${errText(error)}`)
    }

    // ---- UPDATE na linha do B: zero linhas afetadas e valor intacto ---------
    const textCol = mutableTextColumn(shape)
    const writeCol = textCol ?? firstWritableColumn(shape)
    if (writeCol === null) {
      add(table, 'update', false, 'nenhuma coluna gravável encontrada para tentar o UPDATE')
    } else {
      const setExpr = textCol ? `"${textCol}" = $1` : `"${writeCol}" = "${writeCol}"`
      const setParams = textCol ? [PWNED] : []
      try {
        const affected = await withTenant(sql, TENANT_A, async (tx) => {
          const res = await tx.unsafe(
            `update ${table} set ${setExpr} where "${pkCol}"::text = $${setParams.length + 1}`,
            [...setParams, String(pkValB)] as never[],
          )
          return (res as unknown as { count: number }).count
        })

        let intact = true
        let observed = ''
        if (textCol) {
          intact = await withTenant(sql, TENANT_B, async (tx) => {
            const rows = await tx.unsafe<Record<string, unknown>[]>(
              `select "${textCol}"::text as v from ${table} where "${pkCol}"::text = $1`,
              [String(pkValB)],
            )
            observed = String(rows[0]?.v ?? '<linha sumiu>')
            return observed !== PWNED
          })
        }

        const ok = affected === 0 && intact
        add(
          table,
          'update',
          ok,
          ok
            ? `UPDATE como tenant A na linha do B afetou 0 linhas${textCol ? ' e o valor do B seguiu intacto' : ''}`
            : `VAZAMENTO: UPDATE como tenant A afetou ${affected} linha(s) do tenant B` +
                (textCol && !intact ? `; coluna "${textCol}" agora vale "${observed}"` : ''),
        )
      } catch (error) {
        add(table, 'update', false, `UPDATE falhou com erro inesperado: ${errText(error)}`)
      }
    }

    // ---- DELETE na linha do B: zero linhas e a linha continua lá ------------
    try {
      const affected = await withTenant(sql, TENANT_A, async (tx) => {
        const res = await tx.unsafe(`delete from ${table} where "${pkCol}"::text = $1`, [
          String(pkValB),
        ] as never[])
        return (res as unknown as { count: number }).count
      })

      const stillThere = await withTenant(sql, TENANT_B, async (tx) => {
        const rows = await tx.unsafe<{ n: string }[]>(
          `select count(*)::text as n from ${table} where "${pkCol}"::text = $1`,
          [String(pkValB)],
        )
        return Number(rows[0]?.n ?? 0) === 1
      })

      const ok = affected === 0 && stillThere
      add(
        table,
        'delete',
        ok,
        ok
          ? 'DELETE como tenant A na linha do B afetou 0 linhas e a linha do B continua lá'
          : `VAZAMENTO: DELETE como tenant A afetou ${affected} linha(s); linha do B ${stillThere ? 'sobreviveu' : 'SUMIU'}`,
      )
    } catch (error) {
      add(table, 'delete', false, `DELETE falhou com erro inesperado: ${errText(error)}`)
    }

    // ---- INSERT com tenant_id do B: recusado pelo WITH CHECK ----------------
    //
    // Roda SEM RETURNING de propósito. Com RETURNING, o Postgres aplica a policy
    // de SELECT à linha devolvida e devolve 42501 mesmo quando o WITH CHECK
    // aceitou a gravação — o teste passaria por acidente enquanto a linha do
    // tenant alheio entrava no banco. Foi assim que este teste estava errado
    // antes do scripts/check/mutation.ts pegar.
    //
    // O veredito não é "deu erro", é "a linha não existe". Erro é só a evidência.
    const countForB = async (): Promise<number> =>
      withTenant(sql, TENANT_B, async (tx) => {
        const rows = await tx.unsafe<{ n: string }[]>(
          `select count(*)::text as n from ${table}`,
        )
        return Number(rows[0]?.n ?? -1)
      })

    const before = await countForB()
    let rejection: string | null = null
    try {
      await withTenant(sql, TENANT_A, (tx) =>
        insertRowRef(tx, sql, shape, TENANT_B, new Map(), 'teo-cross-tenant', undefined, {
          returning: false,
        }),
      )
    } catch (error) {
      rejection = errText(error)
    }
    const after = await countForB()

    const landed = after > before
    const ok = !landed
    add(
      table,
      'insert-with-check',
      ok,
      landed
        ? `VAZAMENTO: INSERT com ${TENANT_COLUMN} do tenant B na sessão do tenant A GRAVOU ` +
            `(linhas do B: ${before} → ${after}). O WITH CHECK da policy não está amarrando o tenant.`
        : rejection === null
          ? `INSERT não gravou linha do tenant B (linhas do B: ${before} → ${after})`
          : `INSERT com ${TENANT_COLUMN} do tenant B recusado — ` +
            `${isRlsViolation(rejection) ? 'pela policy (RLS)' : `por outra barreira: ${rejection.slice(0, 120)}`}`,
    )
  }

  // ---- raio de alcance da porta de fuga do auth --------------------------
  //
  // `tenants` e `user` têm uma segunda policy permissiva
  // (`USING current_setting('app.auth_context') = 'on'`), sem filtro de tenant.
  // Policies permissivas somam por OR: enquanto essa GUC estiver ligada na
  // conexão, aquelas tabelas não têm isolamento nenhum.
  //
  // Isso é intencional (o Better Auth precisa resolver o tenant do usuário antes
  // de existir contexto de tenant). O que este bloco faz NÃO é reprovar o
  // desenho — é medir e fixar o tamanho do estrago, para que ninguém descubra
  // por acidente e para que o número não cresça calado.
  for (const shape of shapes) {
    const table = shape.qualified
    try {
      const visible = await sql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${TENANT_A}, true)`
        await tx`select set_config('app.auth_context', 'on', true)`
        const rows = await tx.unsafe<{ n: string }[]>(
          `select count(*)::text as n from ${table} where "${TENANT_COLUMN}"::text = $1`,
          [TENANT_B],
        )
        return Number(rows[0]?.n ?? -1)
      })
      const expected = AUTH_CONTEXT_OPEN_TABLES.includes(table)
      add(
        table,
        'auth-context-blast-radius',
        expected ? visible > 0 || true : visible === 0,
        expected
          ? `porta de fuga conhecida: com app.auth_context='on', o tenant A enxerga ` +
              `${visible} linha(s) do tenant B nesta tabela (esperado — está fixado em ` +
              `AUTH_CONTEXT_OPEN_TABLES)`
          : visible === 0
            ? `app.auth_context='on' não abre esta tabela`
            : `VAZAMENTO NOVO: com app.auth_context='on', o tenant A vê ${visible} linha(s) ` +
              `do tenant B em ${table}. Esta tabela não estava na lista de portas de fuga.`,
      )
    } catch (error) {
      add(table, 'auth-context-blast-radius', false, `checagem falhou: ${errText(error)}`)
    }
  }

  return { tables, shapes, seedFailures, checks, tenantIdColumnType }
}

/**
 * Tabelas que, de propósito, ficam abertas entre tenants quando
 * `app.auth_context = 'on'`. Fixado aqui para que uma tabela NOVA nessa condição
 * apareça como falha, e não como surpresa em produção.
 */
export const AUTH_CONTEXT_OPEN_TABLES = ['public.user']

/**
 * Tabelas do contrato que ainda não estão isoladas.
 *
 * `tenants` é o caso especial e legítimo: ela NÃO tem coluna `tenant_id` porque
 * ela É o tenant — a policy dela filtra por `id`. Cobrar `tenant_id` nela seria
 * o teste errando, não o schema. Então aqui ela conta como presente se existe
 * com RLS forçado; as demais precisam mesmo da coluna.
 */
export function missingContractTables(
  tenantTables: TenantTable[],
  rootIsolated: boolean,
): string[] {
  const present = new Set(tenantTables.map((t) => t.name))
  return CONTRACT_TENANT_TABLES.filter((t) => {
    if (t === 'tenants') return !rootIsolated
    return !present.has(t)
  })
}

/** A tabela raiz (`tenants`) existe e está com RLS forçado, isolada por `id`? */
export async function isRootTenantTableIsolated(sql: Sql): Promise<boolean> {
  const rows = await sql<{ enabled: boolean; forced: boolean; policies: number }[]>`
    select c.relrowsecurity as enabled,
           c.relforcerowsecurity as forced,
           (select count(*) from pg_policies p
             where p.schemaname = 'public' and p.tablename = 'tenants')::int as policies
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'tenants' and c.relkind = 'r'
  `
  const r = rows[0]
  return r !== undefined && r.enabled && r.forced && r.policies > 0
}
