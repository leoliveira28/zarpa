/**
 * Teste do teste.
 *
 * Um teste de segurança verde só vale se ele souber ficar vermelho. Este script
 * sabota a policy de propósito, roda a MESMA lógica de `tests/security/*` e
 * exige que ela acuse. Se uma sabotagem passar despercebida, o problema é o
 * teste, e o script falha.
 *
 * É o que impede a suíte de virar enfeite de CI depois de um refactor.
 *
 *   npx tsx scripts/check/mutation.ts
 */
import { connect, type Sql } from '../../tests/helpers/db'
import globalSetup from '../../tests/setup/global-setup'
import { runIsolation } from '../../tests/security/isolation-checks'
import { runRlsAudit } from '../../tests/security/rls-checks'

const RESET = '\x1b[0m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'

type Scenario = {
  name: string
  /** O que quebramos no banco. */
  sabotage: string
  /** Como a suíte tem que reagir. Recebe o resultado das duas varreduras. */
  mustCatch: (r: {
    isolation: Awaited<ReturnType<typeof runIsolation>>
    rls: Awaited<ReturnType<typeof runRlsAudit>>
  }) => { caught: boolean; evidence: string }
}

const SCENARIOS: Scenario[] = [
  {
    name: 'RLS habilitado mas NÃO forçado (o dono da tabela fura a policy)',
    sabotage: 'alter table public.contacts no force row level security',
    mustCatch: ({ isolation, rls }) => {
      const force = rls.findings.find((f) => f.table === 'public.contacts' && f.rule === 'force')
      const leak = isolation.checks.filter(
        (c) => c.table === 'public.contacts' && !c.ok && ['select', 'update', 'delete'].includes(c.rule),
      )
      return {
        caught: force?.ok === false && leak.length > 0,
        evidence:
          `auditoria FORCE: ${force?.ok === false ? 'acusou' : 'NÃO acusou'}; ` +
          `isolamento: ${leak.length} regra(s) vermelha(s) [${leak.map((l) => l.rule).join(', ') || 'nenhuma'}]`,
      }
    },
  },
  {
    name: 'RLS desligado por completo',
    sabotage: 'alter table public.travelers disable row level security',
    mustCatch: ({ isolation, rls }) => {
      const enable = rls.findings.find((f) => f.table === 'public.travelers' && f.rule === 'enable')
      const leak = isolation.checks.filter((c) => c.table === 'public.travelers' && !c.ok)
      return {
        caught: enable?.ok === false && leak.length > 0,
        evidence:
          `auditoria ENABLE: ${enable?.ok === false ? 'acusou' : 'NÃO acusou'}; ` +
          `isolamento: ${leak.length} regra(s) vermelha(s)`,
      }
    },
  },
  {
    // Cuidado: `FOR ALL` só com USING NÃO é buraco — o Postgres reaproveita o
    // USING como WITH CHECK (medido). O buraco de verdade é um WITH CHECK
    // permissivo convivendo com um USING correto: lê certo, grava errado.
    name: 'WITH CHECK permissivo (lê certo, mas grava linha com tenant alheio)',
    sabotage: `
      drop policy if exists "tasks_isolation" on public.tasks;
      create policy "tasks_isolation" on public.tasks
        using ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
        with check (true);
    `,
    mustCatch: ({ isolation, rls }) => {
      const wc = rls.findings.find(
        (f) => f.table === 'public.tasks' && f.rule === 'policy-with-check',
      )
      const ins = isolation.checks.find(
        (c) => c.table === 'public.tasks' && c.rule === 'insert-with-check',
      )
      return {
        // O INSERT cruzado é quem prova o buraco de verdade; a auditoria estática
        // não tem como saber que `true` é permissivo demais sem interpretar SQL.
        caught: ins?.ok === false,
        evidence:
          `INSERT cruzado: ${ins?.ok === false ? 'acusou' : 'NÃO acusou'}; ` +
          `auditoria WITH CHECK: ${wc?.ok === false ? 'acusou' : 'passou (esperado: só o runtime pega)'}`,
      }
    },
  },
  {
    name: 'policy aberta (USING true) — vaza tudo para todo mundo',
    sabotage: `
      drop policy if exists "deals_isolation" on public.deals;
      create policy "deals_isolation" on public.deals using (true) with check (true);
    `,
    mustCatch: ({ isolation, rls }) => {
      const using = rls.findings.find((f) => f.table === 'public.deals' && f.rule === 'policy-using')
      const sel = isolation.checks.find((c) => c.table === 'public.deals' && c.rule === 'select')
      const closed = isolation.checks.find(
        (c) => c.table === 'public.deals' && c.rule === 'fail-closed',
      )
      return {
        caught: using?.ok === false && (sel?.ok === false || closed?.ok === false),
        evidence:
          `auditoria USING: ${using?.ok === false ? 'acusou' : 'NÃO acusou'}; ` +
          `SELECT cruzado: ${sel?.ok === false ? 'acusou' : 'NÃO acusou'}; ` +
          `fail-closed: ${closed?.ok === false ? 'acusou' : 'NÃO acusou'}`,
      }
    },
  },
  {
    name: 'porta de fuga NOVA (policy permissiva que ignora tenant_id)',
    sabotage: `
      create policy "qa_backdoor" on public.contacts
        using (current_setting('app.suporte', true) = 'on')
        with check (current_setting('app.suporte', true) = 'on');
    `,
    mustCatch: ({ rls }) => {
      const hatch = rls.findings.find(
        (f) => f.table === 'public.contacts' && f.rule === 'policy-escape-hatch',
      )
      return {
        caught: hatch?.ok === false,
        evidence: `auditoria de porta de fuga: ${hatch?.ok === false ? 'acusou' : 'NÃO acusou'}`,
      }
    },
  },
  {
    name: 'coluna tenant_id nova sem policy nenhuma (tabela criada fora do padrão)',
    sabotage: `
      create table public.qa_tabela_esquecida (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references public.tenants(id) on delete cascade,
        nome text not null
      );
    `,
    mustCatch: ({ isolation, rls }) => {
      const enable = rls.findings.find(
        (f) => f.table === 'public.qa_tabela_esquecida' && f.rule === 'enable',
      )
      const scanned = isolation.tables.some((t) => t.name === 'qa_tabela_esquecida')
      return {
        caught: enable?.ok === false && scanned,
        evidence:
          `a varredura enxergou a tabela nova: ${scanned ? 'sim' : 'NÃO'}; ` +
          `auditoria ENABLE: ${enable?.ok === false ? 'acusou' : 'NÃO acusou'}`,
      }
    },
  },
]

async function applySabotage(sql: Sql, statements: string): Promise<void> {
  for (const s of statements.split(';')) {
    const stmt = s.trim()
    if (stmt.length > 0) await sql.unsafe(stmt)
  }
}

async function main(): Promise<void> {
  console.log(`\n${BOLD}Mutação: a suíte de segurança sabe ficar vermelha?${RESET}`)
  console.log(
    `${DIM}Cada cenário quebra a policy de propósito e exige que os testes acusem.${RESET}\n`,
  )

  let missed = 0

  for (const scenario of SCENARIOS) {
    // Schema limpo a cada cenário: sabotagem não contamina a seguinte.
    await globalSetup()
    const sql = connect()
    try {
      await applySabotage(sql, scenario.sabotage)
      const isolation = await runIsolation(sql)
      const rls = await runRlsAudit(sql)
      const { caught, evidence } = scenario.mustCatch({ isolation, rls })

      if (caught) {
        console.log(`  ${GREEN}PEGOU${RESET}  ${scenario.name}`)
        console.log(`         ${DIM}${evidence}${RESET}`)
      } else {
        missed++
        console.log(`  ${RED}PASSOU BATIDO${RESET}  ${scenario.name}`)
        console.log(`         ${RED}${evidence}${RESET}`)
        console.log(
          `         ${RED}a suíte ficou verde com a policy quebrada — o teste é que está errado${RESET}`,
        )
      }
    } finally {
      await sql.end({ timeout: 5 })
    }
  }

  // Deixa o banco no estado bom, senão a próxima rodada herda sabotagem.
  await globalSetup()

  console.log('')
  if (missed === 0) {
    console.log(
      `  ${GREEN}${BOLD}${SCENARIOS.length}/${SCENARIOS.length} sabotagens detectadas.${RESET} ` +
        `${DIM}A suíte não é enfeite.${RESET}\n`,
    )
  } else {
    console.log(`  ${RED}${BOLD}${missed} sabotagem(ns) passaram batido.${RESET}\n`)
  }
  process.exit(missed === 0 ? 0 : 1)
}

main().catch((error: unknown) => {
  console.error(`${RED}mutação não conseguiu rodar${RESET}`)
  console.error(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error))
  process.exit(2)
})
