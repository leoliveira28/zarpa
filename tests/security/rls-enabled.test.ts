/**
 * Anti-regressão silenciosa.
 *
 * Varre `pg_class` e falha se QUALQUER tabela com coluna `tenant_id` estiver
 * sem RLS. Não existe lista de exceção aqui de propósito: no dia em que alguém
 * precisar de uma, que a discussão aconteça no PR, não num array escondido.
 *
 * Vai além do pedido original (`relrowsecurity`) e também cobra
 * `relforcerowsecurity`. Motivo, medido neste ambiente: o role `zarpa` é DONO
 * do banco `zarpa_test`, e o dono da tabela ignora a policy mesmo sendo
 * NOBYPASSRLS. Com ENABLE e sem FORCE, `select` do tenant A devolve as linhas
 * do tenant B. Verificar só `relrowsecurity` seria cobertura falsa.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { connect } from '../helpers/db'
import { runRlsAudit } from './rls-checks'

const sql = connect()
const audit = await runRlsAudit(sql)

afterAll(async () => {
  await sql.end({ timeout: 5 })
})

const fmt = (rule: string): string =>
  audit.findings
    .filter((f) => f.rule === rule && !f.ok)
    .map((f) => `  - ${f.table}: ${f.detail}`)
    .join('\n')

describe('RLS habilitado em toda tabela com tenant_id', () => {
  it('o schema tem tabelas para auditar', () => {
    expect(
      audit.tenantTables.length,
      'nenhuma tabela com tenant_id no schema public — nada foi auditado. ' +
        'Uma auditoria que não olha nada não pode passar.',
    ).toBeGreaterThan(0)
  })

  it('toda tabela com tenant_id tem ENABLE ROW LEVEL SECURITY', () => {
    const bad = audit.findings.filter((f) => f.rule === 'enable' && !f.ok)
    expect(bad.map((f) => f.table), `\n${fmt('enable')}\n`).toEqual([])
  })

  it('toda tabela com tenant_id tem FORCE ROW LEVEL SECURITY', () => {
    const bad = audit.findings.filter((f) => f.rule === 'force' && !f.ok)
    expect(
      bad.map((f) => f.table),
      `\nRLS habilitado mas NÃO forçado. O dono da tabela ignora a policy — e a ` +
        `aplicação conecta como o dono. Reprodução em docs/handoffs/teo-para-rafa.md.\n${fmt('force')}\n`,
    ).toEqual([])
  })

  it('toda tabela com RLS tem pelo menos uma policy', () => {
    const bad = audit.findings.filter((f) => f.rule === 'policy-exists' && !f.ok)
    expect(bad.map((f) => f.table), `\n${fmt('policy-exists')}\n`).toEqual([])
  })

  it('a policy de leitura filtra por tenant_id (USING)', () => {
    const bad = audit.findings.filter((f) => f.rule === 'policy-using' && !f.ok)
    expect(bad.map((f) => f.table), `\n${fmt('policy-using')}\n`).toEqual([])
  })

  it('a policy de escrita tem WITH CHECK por tenant_id', () => {
    const bad = audit.findings.filter((f) => f.rule === 'policy-with-check' && !f.ok)
    expect(bad.map((f) => f.table), `\n${fmt('policy-with-check')}\n`).toEqual([])
  })
})

  it('nenhuma policy permissiva nova ignora o tenant', () => {
    const bad = audit.findings.filter((f) => f.rule === 'policy-escape-hatch' && !f.ok)
    expect(
      bad.map((f) => f.table),
      `\nPolicies permissivas somam por OR. Uma policy que não fala de tenant anula o ` +
        `isolamento da tabela enquanto a condição dela valer.\n${fmt('policy-escape-hatch')}\n`,
    ).toEqual([])
  })
})

describe('tabelas sem tenant_id (relatório, não veredito)', () => {
  it('lista o que ficou fora da varredura, para ninguém achar que está coberto', () => {
    // Não falha: nem toda tabela é multi-tenant (better_auth, migrations...).
    // Mas fica registrado na saída — cobertura invisível é cobertura falsa.
    if (audit.tablesWithoutTenantColumn.length > 0) {
      console.log(
        `[rls] fora da varredura por não terem tenant_id:\n` +
          audit.tablesWithoutTenantColumn.map((t) => `  - ${t}`).join('\n') +
          `\n[rls] se alguma dessas guarda dado de cliente, ela está sem isolamento.`,
      )
    }
    expect(true).toBe(true)
  })
})
