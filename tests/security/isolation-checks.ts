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
  seedTenantRows,
  withTenant,
  withoutTenant,
  type Sql,
  type TableShape,
  type TenantTable,
} from '../helpers/db.ts'

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

function errText(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code
    return code ? `${code}: ${error.message}` : error.message
  }
  return String(error)
}

/** `insert ... with check` violado devolve 42501. Qualquer outro erro é outro problema. */
function isRlsViolation(error: unknown): boolean {
  const code = (error as { code?: string } | undefined)?.code
  if (code === '42501') return true
  return /row-level security/i.test(errText(error))
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
    try {
      await withTenant(sql, TENANT_A, (tx) =>
        // Semeia como se fosse do B, mas na sessão do A.
        seedOneAs(tx, sql, shape, TENANT_B),
      )
      add(
        table,
        'insert-with-check',
        false,
        `VAZAMENTO: INSERT com ${TENANT_COLUMN} do tenant B foi ACEITO na sessão do tenant A; ` +
          `falta WITH CHECK na policy`,
      )
    } catch (error) {
      const ok = isRlsViolation(error)
      add(
        table,
        'insert-with-check',
        ok,
        ok
          ? `INSERT com ${TENANT_COLUMN} do tenant B recusado pelo WITH CHECK`
          : `INSERT recusado, mas por outro motivo (não foi RLS): ${errText(error)}`,
      )
    }
  }

  return { tables, shapes, seedFailures, checks, tenantIdColumnType }
}

/** Insere uma linha carimbando `tenant_id` alheio; usado só na checagem de WITH CHECK. */
async function seedOneAs(
  tx: Sql,
  sql: Sql,
  shape: TableShape,
  tenantId: string,
): Promise<Record<string, unknown>> {
  const { insertRow } = await import('../helpers/db.ts')
  return insertRow(tx, sql, shape, tenantId, new Map(), 'teo-cross-tenant')
}

/** Tabelas do contrato que ainda não existem com `tenant_id`. */
export function missingContractTables(tables: TenantTable[]): string[] {
  const present = new Set(tables.map((t) => t.name))
  return CONTRACT_TENANT_TABLES.filter((t) => !present.has(t))
}
