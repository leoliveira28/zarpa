/**
 * Auditoria de RLS pelo catálogo. Sem lista escrita à mão.
 *
 * Este é o teste que impede regressão silenciosa: tabela nova sem RLS não passa
 * despercebida, porque a varredura é do `pg_class`, não de um array que alguém
 * precisa lembrar de atualizar.
 */
import { discoverAllTables, discoverPolicies, type Sql } from '../helpers/db.ts'

export type RlsFinding = {
  table: string
  rule: 'enable' | 'force' | 'policy-exists' | 'policy-using' | 'policy-with-check' | 'tenant-column'
  ok: boolean
  detail: string
}

export type RlsAudit = {
  findings: RlsFinding[]
  tenantTables: string[]
  tablesWithoutTenantColumn: string[]
  currentUserOwnsTables: boolean
}

export async function runRlsAudit(sql: Sql): Promise<RlsAudit> {
  const all = await discoverAllTables(sql)
  const policies = await discoverPolicies(sql)

  const meta = await sql<
    { schema: string; name: string; enabled: boolean; forced: boolean; owner: string }[]
  >`
    select n.nspname as schema, c.relname as name,
           c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
           pg_get_userbyid(c.relowner) as owner
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname = 'public'
  `
  const metaByName = new Map(meta.map((m) => [`${m.schema}.${m.name}`, m]))

  const [{ who }] = await sql<{ who: string }[]>`select current_user as who`

  const findings: RlsFinding[] = []
  const tenantTables: string[] = []
  const tablesWithoutTenantColumn: string[] = []
  let currentUserOwnsTables = false

  for (const t of all) {
    if (!t.hasTenantColumn) {
      tablesWithoutTenantColumn.push(t.qualified)
      continue
    }
    tenantTables.push(t.qualified)

    const m = metaByName.get(t.qualified)
    const owned = m?.owner === who
    if (owned) currentUserOwnsTables = true

    findings.push({
      table: t.qualified,
      rule: 'enable',
      ok: m?.enabled === true,
      detail:
        m?.enabled === true
          ? 'relrowsecurity = true'
          : `tem coluna tenant_id e está SEM ROW LEVEL SECURITY. ` +
            `Falta: ALTER TABLE ${t.qualified} ENABLE ROW LEVEL SECURITY;`,
    })

    // O pulo do gato: o DONO da tabela ignora a policy mesmo sendo NOBYPASSRLS.
    // Como o role `zarpa` é dono do banco (e portanto das tabelas criadas pelas
    // migrations), ENABLE sozinho não protege nada em produção.
    findings.push({
      table: t.qualified,
      rule: 'force',
      ok: m?.forced === true,
      detail:
        m?.forced === true
          ? 'relforcerowsecurity = true'
          : `RLS não está FORÇADO. O dono da tabela (${m?.owner ?? '?'}) ignora a policy, ` +
            `e a aplicação conecta como ${who}${owned ? ' — que é o dono' : ''}. ` +
            `Falta: ALTER TABLE ${t.qualified} FORCE ROW LEVEL SECURITY;`,
    })

    const own = policies.filter((p) => p.table === t.qualified)
    findings.push({
      table: t.qualified,
      rule: 'policy-exists',
      ok: own.length > 0,
      detail:
        own.length > 0
          ? `${own.length} policy(ies): ${own.map((p) => `${p.policy}[${p.command}]`).join(', ')}`
          : 'RLS sem nenhuma policy: a tabela fica inacessível (nega tudo) em vez de isolada',
    })

    if (own.length > 0) {
      const readable = own.filter((p) => p.command === 'ALL' || p.command === 'SELECT')
      findings.push({
        table: t.qualified,
        rule: 'policy-using',
        ok: readable.some((p) => p.using !== null && p.using.includes('tenant_id')),
        detail: readable.some((p) => p.using !== null && p.using.includes('tenant_id'))
          ? 'policy de leitura filtra por tenant_id no USING'
          : `nenhuma policy de leitura tem USING referenciando tenant_id. USING atual: ` +
            `${readable.map((p) => p.using ?? 'null').join(' | ') || '<nenhuma>'}`,
      })

      const writable = own.filter((p) => ['ALL', 'INSERT', 'UPDATE'].includes(p.command))
      findings.push({
        table: t.qualified,
        rule: 'policy-with-check',
        ok: writable.some((p) => p.withCheck !== null && p.withCheck.includes('tenant_id')),
        detail: writable.some((p) => p.withCheck !== null && p.withCheck.includes('tenant_id'))
          ? 'policy de escrita tem WITH CHECK por tenant_id'
          : `nenhuma policy de escrita tem WITH CHECK por tenant_id — dá para gravar linha ` +
            `carimbada com tenant alheio. WITH CHECK atual: ` +
            `${writable.map((p) => p.withCheck ?? 'null').join(' | ') || '<nenhuma>'}`,
      })
    }
  }

  return { findings, tenantTables, tablesWithoutTenantColumn, currentUserOwnsTables }
}
