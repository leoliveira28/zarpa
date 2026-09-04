/**
 * Introspecção do catálogo do Postgres + fábrica genérica de linhas.
 *
 * Nada aqui tem lista de tabelas escrita à mão. Tabela nova com `tenant_id`
 * nasce coberta pelos testes de segurança no minuto em que a migration roda.
 */
import postgres from 'postgres'
import { testDatabaseUrl } from '../setup/env'

export type Sql = postgres.Sql<Record<string, never>>

export const TENANT_COLUMN = 'tenant_id'

/** Schemas que são nossos. `public` por padrão; extensões e catálogo ficam de fora. */
const APP_SCHEMAS = ['public']

export function connect(options: Partial<postgres.Options<{}>> = {}): Sql {
  return postgres(testDatabaseUrl(), {
    max: 4,
    onnotice: () => {},
    prepare: false,
    ...options,
  })
}

export type TenantTable = {
  schema: string
  name: string
  qualified: string
  /** `relrowsecurity` — a policy existe e está ligada. */
  rlsEnabled: boolean
  /** `relforcerowsecurity` — vale TAMBÉM para o dono da tabela. Ver docs/status/teo.md. */
  rlsForced: boolean
  isOwnedByCurrentUser: boolean
}

/**
 * Toda tabela base, em schema de aplicação, que tem uma coluna `tenant_id`.
 * É esta varredura que faz o teste de isolamento crescer sozinho.
 */
export async function discoverTenantTables(sql: Sql): Promise<TenantTable[]> {
  const rows = await sql<
    {
      schema: string
      name: string
      rls_enabled: boolean
      rls_forced: boolean
      owned_by_current_user: boolean
    }[]
  >`
    select
      n.nspname                                   as schema,
      c.relname                                   as name,
      c.relrowsecurity                            as rls_enabled,
      c.relforcerowsecurity                       as rls_forced,
      (pg_get_userbyid(c.relowner) = current_user) as owned_by_current_user
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r'
      and n.nspname = any(${APP_SCHEMAS})
      and exists (
        select 1
        from information_schema.columns col
        where col.table_schema = n.nspname
          and col.table_name = c.relname
          and col.column_name = ${TENANT_COLUMN}
      )
    order by n.nspname, c.relname
  `

  return rows.map((r) => ({
    schema: r.schema,
    name: r.name,
    qualified: `${r.schema}.${r.name}`,
    rlsEnabled: r.rls_enabled,
    rlsForced: r.rls_forced,
    isOwnedByCurrentUser: r.owned_by_current_user,
  }))
}

/** Toda tabela base em schema de aplicação, tenha `tenant_id` ou não. */
export async function discoverAllTables(
  sql: Sql,
): Promise<{ schema: string; name: string; qualified: string; hasTenantColumn: boolean }[]> {
  const rows = await sql<{ schema: string; name: string; has_tenant: boolean }[]>`
    select
      n.nspname as schema,
      c.relname as name,
      exists (
        select 1 from information_schema.columns col
        where col.table_schema = n.nspname
          and col.table_name = c.relname
          and col.column_name = ${TENANT_COLUMN}
      ) as has_tenant
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname = any(${APP_SCHEMAS})
    order by n.nspname, c.relname
  `
  return rows.map((r) => ({
    schema: r.schema,
    name: r.name,
    qualified: `${r.schema}.${r.name}`,
    hasTenantColumn: r.has_tenant,
  }))
}

export type PolicyRow = {
  table: string
  policy: string
  command: string
  using: string | null
  withCheck: string | null
  roles: string[]
}

export async function discoverPolicies(sql: Sql): Promise<PolicyRow[]> {
  const rows = await sql<
    {
      schemaname: string
      tablename: string
      policyname: string
      cmd: string
      qual: string | null
      with_check: string | null
      roles: string[]
    }[]
  >`
    select schemaname, tablename, policyname, cmd, qual, with_check, roles::text[] as roles
    from pg_policies
    where schemaname = any(${APP_SCHEMAS})
    order by schemaname, tablename, policyname
  `
  return rows.map((r) => ({
    table: `${r.schemaname}.${r.tablename}`,
    policy: r.policyname,
    command: r.cmd,
    using: r.qual,
    withCheck: r.with_check,
    roles: r.roles,
  }))
}

/**
 * Roda `fn` dentro de UMA transação com `app.tenant_id` setado local a ela.
 * É a reprodução literal da regra 2 do CLAUDE.md; propositalmente não importa
 * `src/lib/tenant` — o objeto sob teste aqui é a policy no banco, não o helper
 * da aplicação. Se o helper da Rafa tivesse um bug, ele mascararia a policy.
 */
export async function withTenant<T>(
  sql: Sql,
  tenantId: string,
  fn: (tx: Sql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true)`
    return fn(tx as unknown as Sql)
  }) as Promise<T>
}

/** Igual ao acima, mas sem setar tenant nenhum: prova que o padrão é fechado. */
export async function withoutTenant<T>(sql: Sql, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => fn(tx as unknown as Sql)) as Promise<T>
}

// ---------------------------------------------------------------------------
// Fábrica genérica de linhas
// ---------------------------------------------------------------------------

type ColumnMeta = {
  name: string
  dataType: string
  udtName: string
  isNullable: boolean
  hasDefault: boolean
  isIdentity: boolean
  isGenerated: boolean
  charMaxLength: number | null
}

type ForeignKey = { column: string; refTable: string; refColumn: string }

export type TableShape = {
  qualified: string
  schema: string
  name: string
  columns: ColumnMeta[]
  primaryKey: string[]
  foreignKeys: ForeignKey[]
}

export async function describeTable(sql: Sql, schema: string, name: string): Promise<TableShape> {
  const columns = await sql<
    {
      column_name: string
      data_type: string
      udt_name: string
      is_nullable: string
      column_default: string | null
      is_identity: string
      is_generated: string
      character_maximum_length: number | null
    }[]
  >`
    select column_name, data_type, udt_name, is_nullable, column_default,
           is_identity, is_generated, character_maximum_length
    from information_schema.columns
    where table_schema = ${schema} and table_name = ${name}
    order by ordinal_position
  `

  const pk = await sql<{ column_name: string }[]>`
    select a.attname as column_name
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = ${`${schema}.${name}`}::regclass and i.indisprimary
  `

  const fks = await sql<{ column: string; ref_table: string; ref_column: string }[]>`
    select
      kcu.column_name                                    as column,
      ccu.table_schema || '.' || ccu.table_name          as ref_table,
      ccu.column_name                                    as ref_column
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name
     and kcu.constraint_schema = tc.constraint_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name
     and ccu.constraint_schema = tc.constraint_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = ${schema}
      and tc.table_name = ${name}
  `

  return {
    qualified: `${schema}.${name}`,
    schema,
    name,
    columns: columns.map((c) => ({
      name: c.column_name,
      dataType: c.data_type,
      udtName: c.udt_name,
      isNullable: c.is_nullable === 'YES',
      hasDefault: c.column_default !== null,
      isIdentity: c.is_identity === 'YES',
      isGenerated: c.is_generated !== 'NEVER',
      charMaxLength: c.character_maximum_length,
    })),
    primaryKey: pk.map((r) => r.column_name),
    foreignKeys: fks.map((r) => ({
      column: r.column,
      refTable: r.ref_table,
      refColumn: r.ref_column,
    })),
  }
}

/**
 * Valores aceitos por CHECK do tipo `col = ANY (ARRAY['a'::text, 'b'::text])`.
 * Sem isto o seed inventa 'zarpa-qa-kind' e apanha do banco — e aí o teste de
 * isolamento falha por motivo errado, que é a pior forma de falhar.
 */
export async function discoverCheckAllowedValues(
  sql: Sql,
  schema: string,
  table: string,
): Promise<Map<string, string[]>> {
  const rows = await sql<{ def: string }[]>`
    select pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    where c.contype = 'c'
      and c.conrelid = ${`${schema}.${table}`}::regclass
  `
  const out = new Map<string, string[]>()
  for (const { def } of rows) {
    const m = /\(?\(?"?([a-z_][a-z0-9_]*)"?\s*=\s*ANY\s*\(\s*ARRAY\[(.+?)\]/is.exec(def)
    if (!m) continue
    const [, column, body] = m
    const values = Array.from(body.matchAll(/'((?:[^']|'')*)'/g)).map((x) =>
      x[1].replace(/''/g, "'"),
    )
    if (values.length > 0) out.set(column, values)
  }
  return out
}

/**
 * A tabela que o `tenant_id` referencia (normalmente `tenants`) não tem coluna
 * `tenant_id` — ela É o tenant. Descobrimos quem é pela FK, não pelo nome, e
 * criamos a linha raiz de cada tenant antes de qualquer outra coisa.
 */
export async function bootstrapTenantRoots(
  sql: Sql,
  shapes: TableShape[],
  tenantIds: string[],
): Promise<{ table: string | null; failures: { tenantId: string; error: string }[] }> {
  const rootFk = shapes
    .flatMap((s) => s.foreignKeys)
    .find((fk) => fk.column === TENANT_COLUMN)
  if (!rootFk) return { table: null, failures: [] }

  const [schema, name] = rootFk.refTable.split('.')
  const shape = await describeTable(sql, schema, name)
  const allowed = await discoverCheckAllowedValues(sql, schema, name)
  const failures: { tenantId: string; error: string }[] = []

  for (const tenantId of tenantIds) {
    const cols: string[] = [`"${rootFk.refColumn}"`]
    const exprs: string[] = ['$1']
    const params: unknown[] = [tenantId]

    for (const col of shape.columns) {
      if (col.name === rootFk.refColumn) continue
      if (col.isGenerated || col.isIdentity || col.hasDefault || col.isNullable) continue
      const choices = allowed.get(col.name)
      params.push(choices?.[0] ?? (await syntheticValue(sql, col, `zarpa-qa-${tenantId.slice(0, 8)}`)))
      cols.push(`"${col.name}"`)
      exprs.push(`$${params.length}`)
    }

    try {
      // A policy da `tenants` exige `id = app.tenant_id` no WITH CHECK: o
      // próprio nascimento do tenant já roda dentro do contexto dele.
      await withTenant(sql, tenantId, (tx) =>
        tx.unsafe(
          `insert into ${rootFk.refTable} (${cols.join(', ')}) values (${exprs.join(', ')})
           on conflict do nothing`,
          params as never[],
        ),
      )
    } catch (error) {
      failures.push({
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { table: rootFk.refTable, failures }
}

async function enumLabel(sql: Sql, udtName: string): Promise<string | null> {
  const rows = await sql<{ label: string }[]>`
    select e.enumlabel as label
    from pg_type t join pg_enum e on e.enumtypid = t.oid
    where t.typname = ${udtName}
    order by e.enumsortorder
    limit 1
  `
  return rows[0]?.label ?? null
}

/**
 * Valor sintético plausível para uma coluna, a partir do tipo declarado.
 * Marcador `seed` no texto para a linha ser óbvia em qualquer dump.
 */
async function syntheticValue(
  sql: Sql,
  col: ColumnMeta,
  seedTag: string,
): Promise<unknown | { raw: string }> {
  const t = col.udtName.toLowerCase()

  if (t === 'uuid') return { raw: 'gen_random_uuid()' }
  if (t === 'bool') return false
  if (['int2', 'int4', 'int8'].includes(t)) return 1
  if (['float4', 'float8', 'numeric'].includes(t)) return 0
  if (['timestamptz', 'timestamp', 'date'].includes(t)) return { raw: 'now()' }
  if (t === 'time' || t === 'timetz') return { raw: "'12:00:00'" }
  if (t === 'interval') return { raw: "'1 day'" }
  if (['json', 'jsonb'].includes(t)) return { raw: `'{}'::${t}` }
  if (t === 'bytea') return { raw: `'\\x00'::bytea` }
  if (t === 'inet' || t === 'cidr') return { raw: `'127.0.0.1'::${t}` }

  if (col.dataType === 'ARRAY') return { raw: `'{}'::${col.udtName}` }

  if (col.dataType === 'USER-DEFINED') {
    const label = await enumLabel(sql, col.udtName)
    if (label !== null) return { raw: `'${label.replace(/'/g, "''")}'::"${col.udtName}"` }
    return { raw: `'${seedTag}'::"${col.udtName}"` }
  }

  // texto e afins
  const max = col.charMaxLength
  const base = `${seedTag}-${col.name}`
  return max !== null && max < base.length ? base.slice(0, max) : base
}

export type SeedResult =
  | { ok: true; table: string; tenantId: string; pk: Record<string, unknown> }
  | { ok: false; table: string; tenantId: string; error: string }

/**
 * Ordena tabelas por dependência de FK (pai antes de filho).
 *
 * Só FK NOT NULL conta como dependência dura. FK anulável fica NULL no seed, e
 * ignorá-la é justamente o que quebra ciclo legítimo: `proposals.accepted_option_id`
 * (anulável) aponta para `proposal_options`, que aponta de volta para
 * `proposals.id` (NOT NULL). Tratar as duas como iguais colocaria
 * `proposal_options` antes de `proposals` e o insert morreria na FK.
 *
 * Ciclo entre duas FKs NOT NULL não trava: a tabela sai na ordem que der e o
 * erro de insert vira finding, com o nome da constraint.
 */
export function topoSortByForeignKeys(shapes: TableShape[]): TableShape[] {
  const byName = new Map(shapes.map((s) => [s.qualified, s]))
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const out: TableShape[] = []

  const visit = (shape: TableShape): void => {
    if (visited.has(shape.qualified) || visiting.has(shape.qualified)) return
    visiting.add(shape.qualified)
    for (const fk of shape.foreignKeys) {
      if (fk.refTable === shape.qualified) continue // auto-referência
      const col = shape.columns.find((c) => c.name === fk.column)
      if (col?.isNullable !== false) continue // anulável: não é dependência dura
      const parent = byName.get(fk.refTable)
      if (parent) visit(parent)
    }
    visiting.delete(shape.qualified)
    visited.add(shape.qualified)
    out.push(shape)
  }

  for (const s of shapes) visit(s)
  return out
}

/**
 * Insere UMA linha em `shape` para `tenantId`, dentro de uma transação já
 * posicionada no tenant (portanto o `WITH CHECK` da policy tem que aceitar).
 * `fkValues` traz as PKs já criadas para o MESMO tenant.
 */
export async function insertRow(
  tx: Sql,
  sql: Sql,
  shape: TableShape,
  tenantId: string,
  fkValues: Map<string, Record<string, unknown>>,
  seedTag: string,
  allowed?: Map<string, string[]>,
  opts: { returning?: boolean } = {},
): Promise<Record<string, unknown>> {
  const allowedValues = allowed ?? (await discoverCheckAllowedValues(sql, shape.schema, shape.name))
  const fkByColumn = new Map(shape.foreignKeys.map((fk) => [fk.column, fk]))
  const cols: string[] = []
  const exprs: string[] = []
  const params: unknown[] = []

  const push = (col: string, value: unknown | { raw: string }): void => {
    cols.push(`"${col}"`)
    if (typeof value === 'object' && value !== null && 'raw' in value) {
      exprs.push((value as { raw: string }).raw)
    } else {
      params.push(value)
      exprs.push(`$${params.length}`)
    }
  }

  for (const col of shape.columns) {
    if (col.isGenerated) continue

    if (col.name === TENANT_COLUMN) {
      push(col.name, tenantId)
      continue
    }

    const fk = fkByColumn.get(col.name)
    if (fk) {
      const parent = fkValues.get(`${fk.refTable}::${tenantId}`)
      const parentValue = parent?.[fk.refColumn]
      if (parentValue !== undefined) {
        push(col.name, parentValue)
        continue
      }
      // Sem pai disponível: se der, deixa nulo; senão o insert falha e vira finding.
      if (col.isNullable) continue
      if (col.hasDefault || col.isIdentity) continue
    }

    if (col.isIdentity || col.hasDefault) continue
    if (col.isNullable) continue

    const choices = allowedValues.get(col.name)
    if (choices !== undefined && choices.length > 0) {
      push(col.name, choices[0])
      continue
    }

    push(col.name, await syntheticValue(sql, col, `${seedTag}-${tenantId}`))
  }

  const returning =
    shape.primaryKey.length > 0
      ? shape.primaryKey.map((c) => `"${c}"`).join(', ')
      : shape.columns.map((c) => `"${c}"`).join(', ')

  const columnList = cols.length > 0 ? `(${cols.join(', ')})` : ''
  const valueList = exprs.length > 0 ? `values (${exprs.join(', ')})` : 'default values'

  // `returning` NÃO é detalhe cosmético: num INSERT com RETURNING o Postgres
  // ainda aplica a policy de SELECT à linha devolvida. Uma policy com
  // `WITH CHECK (true)` REJEITA o insert com RETURNING (42501) e ACEITA o mesmo
  // insert sem RETURNING. Medido — ver docs/status/teo.md. Por isso a sonda de
  // escrita cruzada roda sem RETURNING: senão o teste passa por acidente.
  const suffix = opts.returning === false ? '' : ` returning ${returning}`
  const query = `insert into ${shape.qualified} ${columnList} ${valueList}${suffix}`
  const rows = await tx.unsafe(query, params as never[])
  return (rows[0] ?? {}) as Record<string, unknown>
}

/**
 * Semeia uma linha por tabela por tenant. Cada tenant semeia dentro da PRÓPRIA
 * transação com o próprio `app.tenant_id`, ou seja: se a policy de INSERT
 * estiver errada, o seed já falha — e isso é informação, não acidente.
 */
export async function seedTenantRows(
  sql: Sql,
  shapes: TableShape[],
  tenantIds: string[],
  seedTag = 'zarpa-qa',
): Promise<{ pks: Map<string, Record<string, unknown>>; results: SeedResult[] }> {
  const ordered = topoSortByForeignKeys(shapes)
  const pks = new Map<string, Record<string, unknown>>()
  const results: SeedResult[] = []

  // A linha raiz do tenant (a `tenants`) precisa existir antes de qualquer FK.
  const root = await bootstrapTenantRoots(sql, shapes, tenantIds)
  for (const f of root.failures) {
    results.push({ ok: false, table: root.table ?? '<raiz do tenant>', tenantId: f.tenantId, error: f.error })
  }

  const allowedByTable = new Map<string, Map<string, string[]>>()
  for (const shape of ordered) {
    allowedByTable.set(shape.qualified, await discoverCheckAllowedValues(sql, shape.schema, shape.name))
  }

  for (const tenantId of tenantIds) {
    for (const shape of ordered) {
      try {
        const pk = await withTenant(sql, tenantId, (tx) =>
          insertRow(tx, sql, shape, tenantId, pks, seedTag, allowedByTable.get(shape.qualified)),
        )
        pks.set(`${shape.qualified}::${tenantId}`, pk)
        results.push({ ok: true, table: shape.qualified, tenantId, pk })
      } catch (error) {
        results.push({
          ok: false,
          table: shape.qualified,
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  return { pks, results }
}

/** Conta linhas contornando RLS via role — só existe para diagnóstico honesto. */
export async function countAllRowsAsOwner(sql: Sql, qualified: string): Promise<number> {
  const rows = await sql.unsafe<{ n: string }[]>(`select count(*)::text as n from ${qualified}`)
  return Number(rows[0]?.n ?? 0)
}
