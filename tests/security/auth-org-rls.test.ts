/**
 * Fase 3 — RLS das tabelas do plugin `organization` do Better Auth (a pergunta 1 da
 * rodada: "as tabelas do plugin passam pela migration e nascem com RLS ENABLE+FORCE?").
 *
 * As tabelas `organization`/`member`/`invitation` NÃO têm `tenant_id` — o vínculo com o
 * tenant é `organization_id` (e em `organization` é o próprio `id`, que É o id de
 * `tenants`). O isolamento delas, portanto, não é coberto pela varredura de catálogo de
 * `tenant-isolation.test.ts` (que só acha tabela com coluna `tenant_id`) — é EXATAMENTE
 * por isso que este arquivo existe: o mesmo rigor, para o shape novo.
 *
 * O que está travado aqui (mesma migration `0019_multiusuario.sql` que cria as tabelas):
 *  1. Catálogo: RLS habilitado E forçado nas três — igual ao padrão de `user`/`session`.
 *  2. Policies: DUAS por tabela (`*_isolation` pelo canal da aplicação via `app.tenant_id`,
 *     `*_auth_service` pelo canal do plugin via `app.auth_context`), cada uma com USING
 *     E WITH CHECK — policy só de USING deixa o INSERT cross-tenant passar.
 *  3. Isolamento de verdade: contexto do tenant A lê as três tabelas e vê ZERO linha de B.
 *  4. WITH CHECK recusa: INSERT cruzado (linhas de B tentadas sob contexto de A) falha
 *     com 42501 — o `zarpa` do teste é NOBYPASSRLS, não há superuser emprestado.
 *  5. Fechado por padrão: SEM contexto nenhum, zero linhas nas três.
 *  6. O canal do plugin: com `app.auth_context=on` o Better Auth vê o que precisa
 *     (convite/membership antes de existir contexto de tenant) — o GUC é a porta, não
 *     buraco: sem ele, nada.
 *  7. `session.active_organization_id` existe — sem a coluna o adapter do plugin recusa
 *     o UPDATE da sessão.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { connect, discoverPolicies, withTenant, withoutTenant, type Sql } from '../helpers/db'

const sql = connect()

// ---------------------------------------------------------------------------
// Helpers de contexto — as DUAS portas que as policies reconhecem
// ---------------------------------------------------------------------------

/** O canal do plugin: `authDb` roda com este GUC ligado (`src/lib/auth/db.ts`). */
async function withAuthContext<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.auth_context', 'on', true)`
    return fn(tx as unknown as Sql)
  }) as Promise<T>
}

/** Achata a cadeia de erros do driver/drizzle até o texto da constraint do Postgres. */
function textoCompletoDoErro(erro: unknown): string {
  const partes: string[] = []
  let atual: unknown = erro
  let voltas = 0
  while (atual && voltas < 5) {
    if (atual instanceof Error) {
      partes.push(atual.message)
      atual = (atual as Error & { cause?: unknown }).cause
    } else {
      partes.push(String(atual))
      atual = undefined
    }
    voltas++
  }
  return partes.join(' | ')
}

// ---------------------------------------------------------------------------
// Fixture — dois tenants completos: tenants + user + organization + member + invitation
// ---------------------------------------------------------------------------

type Fixture = {
  tenantId: string
  userId: string
  memberId: string
  invitationId: string
}

async function seedTenant(prefixo: string): Promise<Fixture> {
  const tenantId = randomUUID()
  const userId = `qa-org-${prefixo}-${randomUUID()}`
  const memberId = `mem_${userId}`
  const invitationId = `inv_${prefixo}_${randomUUID()}`

  // Tudo pelo canal da aplicação (app.tenant_id): o seed JÁ exercita o WITH CHECK
  // positivo de cada policy de isolation — se a policy estiver errada, o seed falha.
  await withTenant(sql, tenantId, async (tx) => {
    await tx.unsafe(
      `insert into tenants (id, name, slug) values ($1, $2, $3)`,
      [tenantId, `Agência QA Org ${prefixo}`, `qa-org-${prefixo}-${tenantId.slice(0, 8)}`],
    )
    await tx.unsafe(
      `insert into "user" (id, tenant_id, name, email, role) values ($1, $2, $3, $4, 'owner')`,
      [userId, tenantId, `Dono ${prefixo}`, `${userId}@exemplo-zarpa.com.br`],
    )
    // O gêmeo: id da organization É o id do tenant (a identidade declarada na FK).
    await tx.unsafe(
      `insert into organization (id, name, slug) values ($1, $2, $3)`,
      [tenantId, `Agência QA Org ${prefixo}`, `qa-org-${prefixo}-${tenantId.slice(0, 8)}`],
    )
    await tx.unsafe(
      `insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'owner')`,
      [memberId, tenantId, userId],
    )
    await tx.unsafe(
      `insert into invitation (id, organization_id, email, role, status, inviter_id, expires_at)
       values ($1, $2, $3, 'member', 'pending', $4, now() + interval '14 days')`,
      [invitationId, tenantId, `convidado-${prefixo}@exemplo-zarpa.com.br`, userId],
    )
  })

  return { tenantId, userId, memberId, invitationId }
}

const fixtures: Fixture[] = []

afterAll(async () => {
  // Apagar o tenant derruba organization/member/invitation por CASCADE — e a checagem
  // de integridade referencial do Postgres não passa por RLS (documentado no PG).
  for (const f of fixtures) {
    try {
      await withTenant(sql, f.tenantId, (tx) =>
        tx.unsafe(`delete from tenants where id = $1`, [f.tenantId]),
      )
    } catch {
      // best-effort
    }
  }
  await sql.end({ timeout: 5 })
})

// ---------------------------------------------------------------------------
// 1 + 2. Catálogo: RLS ENABLE+FORCE e as duas policies, com USING e WITH CHECK
// ---------------------------------------------------------------------------

describe('catálogo — organization/member/invitation nascem com RLS ENABLE+FORCE', () => {
  const TABELAS = ['organization', 'member', 'invitation'] as const

  it('relrowsecurity e relforcerowsecurity são true nas três', async () => {
    const rows = await sql<{ relname: string; rls: boolean; forced: boolean }[]>`
      select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname = 'public'
        and c.relname = any(${[...TABELAS]})
    `
    expect(rows).toHaveLength(3)
    for (const t of TABELAS) {
      const linha = rows.find((r) => r.relname === t)
      expect(linha, `tabela ${t} não existe`).toBeDefined()
      expect(linha!.rls, `${t} sem RLS habilitado`).toBe(true)
      expect(linha!.forced, `${t} sem RLS forçado (dono da tabela burlaria)`).toBe(true)
    }
  })

  it('duas policies por tabela (isolation + auth_service), todas com USING e WITH CHECK', async () => {
    const policies = await discoverPolicies(sql)
    for (const t of TABELAS) {
      const daTabela = policies.filter((p) => p.table === `public.${t}`)
      const nomes = daTabela.map((p) => p.policy).sort()
      expect(nomes, `${t} devia ter exatamente as duas policies`).toEqual([
        `${t}_auth_service`,
        `${t}_isolation`,
      ])
      for (const p of daTabela) {
        expect(p.using, `${p.policy} sem USING`).toBeTruthy()
        expect(p.withCheck, `${p.policy} sem WITH CHECK — INSERT cruzado passaria`).toBeTruthy()
      }
      // A policy de isolation fala de tenant (direto ou via organization); a de auth
      // service, do GUC — nenhuma delas é `true` solto.
      const isolation = daTabela.find((p) => p.policy === `${t}_isolation`)!
      expect(isolation.using).toMatch(/app\.tenant_id/)
      const authService = daTabela.find((p) => p.policy === `${t}_auth_service`)!
      expect(authService.using).toMatch(/app\.auth_context/)
    }
  })

  it('session.active_organization_id existe (o adapter do plugin grava nela)', async () => {
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name = 'session'
        and column_name = 'active_organization_id'
    `
    expect(rows[0]!.n).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 3 + 5. Isolamento: contexto do tenant A não vê NADA de B; sem contexto, não vê nada
// ---------------------------------------------------------------------------

describe('isolamento — A não vê linha de B nas três tabelas', () => {
  it('com app.tenant_id de A: member/invitation/organization de B não aparecem (zero linhas cruzadas)', async () => {
    const A = await seedTenant('iso-a')
    const B = await seedTenant('iso-b')
    fixtures.push(A, B)

    await withTenant(sql, A.tenantId, async (tx) => {
      const orgs = await tx.unsafe<{ id: string }[]>(`select id from organization`)
      expect(orgs.map((r) => r.id)).toEqual([A.tenantId])
      expect(orgs.some((r) => r.id === B.tenantId)).toBe(false)

      const membros = await tx.unsafe<{ id: string }[]>(`select id from member`)
      expect(membros.map((r) => r.id)).toEqual([A.memberId])
      expect(membros.some((r) => r.id === B.memberId)).toBe(false)

      const convites = await tx.unsafe<{ id: string }[]>(`select id from invitation`)
      expect(convites.map((r) => r.id)).toEqual([A.invitationId])
      expect(convites.some((r) => r.id === B.invitationId)).toBe(false)
    })
  })

  it('SEM contexto nenhum: zero linhas nas três — o padrão é fechado', async () => {
    await withoutTenant(sql, async (tx) => {
      for (const tabela of ['organization', 'member', 'invitation']) {
        const rows = await tx.unsafe(`select * from ${tabela}`)
        expect(rows, `${tabela} vazou sem contexto`).toHaveLength(0)
      }
    })
  })
})

// ---------------------------------------------------------------------------
// 4. WITH CHECK recusa escrita cruzada — a metade que policy-só-de-USING deixa passar
// ---------------------------------------------------------------------------

describe('WITH CHECK — INSERT cruzado é recusado com 42501', () => {
  it('organization de B tentada sob contexto de A: recusa', async () => {
    const A = await seedTenant('wk-a')
    const B = await seedTenant('wk-b')
    fixtures.push(A, B)

    const tentativa = withTenant(sql, A.tenantId, (tx) =>
      tx.unsafe(
        `insert into organization (id, name, slug) values ($1, 'Invasão', 'invasao-qa')`,
        [B.tenantId],
      ),
    )
    await expect(tentativa).rejects.toThrow(/row-level security|42501/i)
  })

  it('member e invitation apontando para a organization de B, sob contexto de A: recusa', async () => {
    const A = await seedTenant('wk-c')
    const B = await seedTenant('wk-d')
    fixtures.push(A, B)

    // member: precisa de um user real para a FK passar — o de A, que A enxerga. O que
    // torna a tentativa CRUZADA é o organization_id de B, não o user.
    const memberCruzado = withTenant(sql, A.tenantId, (tx) =>
      tx.unsafe(
        `insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'member')`,
        [`mem_inv_${randomUUID()}`, B.tenantId, A.userId],
      ),
    )
    await expect(memberCruzado).rejects.toThrow(/row-level security|42501/i)

    const conviteCruzado = withTenant(sql, A.tenantId, (tx) =>
      tx.unsafe(
        `insert into invitation (id, organization_id, email, role, status, inviter_id, expires_at)
         values ($1, $2, 'x@exemplo-zarpa.com.br', 'member', 'pending', $3, now() + interval '7 days')`,
        [`inv_inv_${randomUUID()}`, B.tenantId, A.userId],
      ),
    )
    await expect(conviteCruzado).rejects.toThrow()

    // A mensagem do Postgres para RLS é estável — mas garantimos que NÃO é violação de
    // FK (o motivo importa: o teste falharia "verde" se a recusa fosse por outro motivo).
    try {
      await withTenant(sql, A.tenantId, (tx) =>
        tx.unsafe(
          `insert into member (id, organization_id, user_id, role) values ($1, $2, $3, 'member')`,
          [`mem_inv2_${randomUUID()}`, B.tenantId, A.userId],
        ),
      )
      throw new Error('deveria ter recusado o insert cruzado em member')
    } catch (erro) {
      const texto = textoCompletoDoErro(erro)
      expect(texto).toMatch(/row-level security/i)
      expect(texto).not.toMatch(/foreign key/i)
    }
  })
})

// ---------------------------------------------------------------------------
// 6. O canal do plugin: app.auth_context=on enxerga — e é a ÚNICA outra porta
// ---------------------------------------------------------------------------

describe('canal auth_service — o GUC do plugin é porta, não buraco', () => {
  it('com app.auth_context=on o plugin vê member/invitation de todos os tenants (sem tenant_id setado)', async () => {
    const A = await seedTenant('ch-a')
    const B = await seedTenant('ch-b')
    fixtures.push(A, B)

    await withAuthContext(async (tx) => {
      const membros = await tx.unsafe<{ id: string }[]>(`select id from member`)
      const ids = membros.map((r) => r.id)
      expect(ids).toContain(A.memberId)
      expect(ids).toContain(B.memberId)

      const convites = await tx.unsafe<{ id: string }[]>(`select id from invitation`)
      expect(convites.map((r) => r.id)).toContain(A.invitationId)
      expect(convites.map((r) => r.id)).toContain(B.invitationId)
    })

    // E o GUC é LOCAL à transação: fora dela, fechado de novo.
    await withoutTenant(sql, async (tx) => {
      const rows = await tx.unsafe(`select * from member`)
      expect(rows).toHaveLength(0)
    })
  })
})
