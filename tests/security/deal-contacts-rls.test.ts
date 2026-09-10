/**
 * 0020 — RLS de `deal_contacts` (a N:N "um negócio, vários clientes") e o vazamento da
 * lista de clientes na proposta pública.
 *
 * Escrito pela Rafa nesta rodada (o coordenador atribuiu os testes desta feature a ela;
 * `tests/**` continua sendo fronteira do Téo — registrado em docs/status/rafa.md).
 * Dois grupos:
 *
 *  1. O RLS da tabela, no mesmo rigor de `auth-org-rls.test.ts`:
 *     catálogo (ENABLE+FORCE), a policy `deal_contacts_isolation` ÚNICA com USING e
 *     WITH CHECK contra `app.tenant_id`, SELECT cruzado zero linhas, INSERT cruzado
 *     42501 (o role `zarpa` do teste é NOBYPASSRLS — nada de superuser emprestado),
 *     fechado por padrão sem contexto, e as invariantes de BANCO da composição
 *     (PK composta recusa duplicado; partial unique recusa segundo principal).
 *
 *  2. O vazamento na pública (`public.proposta_publica`, emendada na 0020): fixture de
 *     CASAL com canários de telefone/e-mail plantados nos DOIS contatos, e a resposta
 *     varrida inteira — a chave nova `clientes` só pode carregar NOMES, principal
 *     primeiro. Prova também que o `set_config('app.tenant_id', ..., true)` que a função
 *     faz por dentro NÃO vaza para a sessão do chamador (local à transação de um único
 *     statement): depois de chamar a função, a sessão ainda vê ZERO linhas de
 *     `deal_contacts`.
 *
 * O que NÃO está aqui: o caminho das actions (`tests/deals/clientes.test.ts`) e a
 * varredura genérica de rotinas públicas (`public-proposal.test.ts` do Téo, que continua
 * valendo — a função emendada continua SECURITY DEFINER com search_path fixo e o payload
 * dela passa pelo mesmo scanner).
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { connect, discoverPolicies, withTenant, withoutTenant, type Sql } from '../helpers/db'
import { CANARIES, formatLeaks, scanPayload } from './leak-scanner'

const sql = connect()

// ---------------------------------------------------------------------------
// 1) Catálogo — a tabela nasce com RLS ENABLE+FORCE e UMA policy, na mesma migration
// ---------------------------------------------------------------------------

describe('catálogo — deal_contacts nasce com RLS ENABLE+FORCE e policy de isolation', () => {
  it('relrowsecurity e relforcerowsecurity são true', async () => {
    const rows = await sql<{ relname: string; rls: boolean; forced: boolean }[]>`
      select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname = 'public'
        and c.relname = 'deal_contacts'
    `
    expect(rows).toHaveLength(1)
    expect(rows[0]!.rls, 'deal_contacts sem RLS habilitado').toBe(true)
    expect(rows[0]!.forced, 'deal_contacts sem RLS forçado (dono da tabela burlaria)').toBe(true)
  })

  it('exatamente a policy deal_contacts_isolation, com USING e WITH CHECK contra app.tenant_id', async () => {
    const policies = await discoverPolicies(sql)
    const daTabela = policies.filter((p) => p.table === 'public.deal_contacts')
    expect(
      daTabela.map((p) => p.policy),
      'deal_contacts devia ter EXATAMENTE a policy de isolation — policy nova aqui é porta nova',
    ).toEqual(['deal_contacts_isolation'])

    for (const p of daTabela) {
      expect(p.using, `${p.policy} sem USING`).toBeTruthy()
      expect(p.withCheck, `${p.policy} sem WITH CHECK — INSERT cruzado passaria`).toBeTruthy()
      expect(p.using).toMatch(/app\.tenant_id/)
      expect(p.withCheck).toMatch(/app\.tenant_id/)
    }
  })

  it('as invariantes de banco existem: PK composta (deal_id, contact_id) e partial unique do principal', async () => {
    const constraints = await sql<{ contype: string; conname: string; condef: string | null }[]>`
      select c.contype::text as contype, c.conname,
             case when c.contype = 'x' then pg_get_indexdef(c.conindid) else null end as condef
      from pg_constraint c
      where c.conrelid = 'public.deal_contacts'::regclass
    `
    const pk = constraints.find((c) => c.contype === 'p')
    expect(pk, 'deal_contacts sem PK composta').toBeDefined()
    const pkCols = await sql<{ column_name: string }[]>`
      select a.attname as column_name
      from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = 'public.deal_contacts'::regclass and i.indisprimary
      order by a.attnum
    `
    expect(pkCols.map((r) => r.column_name)).toEqual(['deal_id', 'contact_id'])

    // O partial unique que garante NO MÁXIMO um principal por negócio.
    const unicos = await sql<{ indexdef: string }[]>`
      select indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'deal_contacts' and indexname = 'deal_contacts_deal_principal_key'
    `
    expect(unicos).toHaveLength(1)
    expect(unicos[0]!.indexdef).toMatch(/UNIQUE/)
    expect(unicos[0]!.indexdef).toMatch(/WHERE/i)
    expect(unicos[0]!.indexdef).toMatch(/principal/)
  })
})

// ---------------------------------------------------------------------------
// Fixture — dois tenants com contato + negócio + a linha principal em deal_contacts
// ---------------------------------------------------------------------------

type Fixture = {
  tenantId: string
  contatoId: string
  dealId: string
}

async function seedTenantComNegocio(prefixo: string): Promise<Fixture> {
  const tenantId = randomUUID()

  await withTenant(sql, tenantId, async (tx) => {
    await tx.unsafe(`insert into tenants (id, name, slug) values ($1, $2, $3)`, [
      tenantId,
      `Agência QA Casal ${prefixo}`,
      `qa-casal-${prefixo}-${tenantId.slice(0, 8)}`,
    ])
    await tx.unsafe(
      `insert into "user" (id, tenant_id, name, email, role) values ($1, $2, $3, $4, 'owner')`,
      [`qa-casal-${prefixo}-${randomUUID()}`, tenantId, `Dono ${prefixo}`, `dono-${tenantId}@exemplo-zarpa.com.br`],
    )
    const contato = await tx.unsafe<{ id: string }[]>(
      `insert into contacts (tenant_id, name) values ($1, $2) returning id`,
      [tenantId, `Titular ${prefixo}`],
    )
    // `stage` basta: o trigger `deals_estagio_sync` resolve o `stage_id` no funil semeado.
    const deal = await tx.unsafe<{ id: string }[]>(
      `insert into deals (tenant_id, contact_id, title, stage) values ($1, $2, $3, 'novo') returning id`,
      [tenantId, contato[0]!.id, `Negócio QA ${prefixo}`],
    )
    await tx.unsafe(
      `insert into deal_contacts (tenant_id, deal_id, contact_id, principal) values ($1, $2, $3, true)`,
      [tenantId, deal[0]!.id, contato[0]!.id],
    )
  })

  const [f] = await withTenant(sql, tenantId, async (tx) => {
    const contato = await tx.unsafe<{ id: string }[]>(`select id from contacts limit 1`)
    const deal = await tx.unsafe<{ id: string }[]>(`select id from deals limit 1`)
    return [{ tenantId, contatoId: contato[0]!.id, dealId: deal[0]!.id }]
  })
  return f!
}

const fixtures: Fixture[] = []

afterAll(async () => {
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
// 2) Isolamento de verdade — SELECT cruzado, INSERT cruzado, fechado por padrão
// ---------------------------------------------------------------------------

describe('isolamento — a lista de clientes de A não existe para B', () => {
  it('contexto de A vê só as linhas de A; as de B são zero', async () => {
    const A = await seedTenantComNegocio('iso-a')
    const B = await seedTenantComNegocio('iso-b')
    fixtures.push(A, B)

    await withTenant(sql, A.tenantId, async (tx) => {
      const linhas = await tx.unsafe<{ deal_id: string; contact_id: string }[]>(
        `select deal_id, contact_id from deal_contacts`,
      )
      expect(linhas).toHaveLength(1)
      expect(linhas[0]!.deal_id).toBe(A.dealId)
      expect(linhas.some((l) => l.deal_id === B.dealId)).toBe(false)
    })
  })

  it('SEM contexto nenhum: zero linhas — o padrão é fechado', async () => {
    await withoutTenant(sql, async (tx) => {
      const rows = await tx.unsafe(`select * from deal_contacts`)
      expect(rows, 'deal_contacts vazou sem contexto').toHaveLength(0)
    })
  })

  it('INSERT cruzado (linha de B tentada sob contexto de A) recusa com 42501', async () => {
    const A = await seedTenantComNegocio('wk-a')
    const B = await seedTenantComNegocio('wk-b')
    fixtures.push(A, B)

    // deal e contact de A (que A enxerga), mas tenant_id de B — o WITH CHECK recusa.
    const tentativa = withTenant(sql, A.tenantId, (tx) =>
      tx.unsafe(
        `insert into deal_contacts (tenant_id, deal_id, contact_id, principal) values ($1, $2, $3, false)`,
        [B.tenantId, A.dealId, A.contatoId],
      ),
    )
    await expect(tentativa).rejects.toThrow(/row-level security|42501/i)
  })
})

// ---------------------------------------------------------------------------
// 3) As invariantes da composição, garantidas NO BANCO
// ---------------------------------------------------------------------------

describe('invariantes no banco — duplicado e segundo principal recusados pelo índice', () => {
  it('PK composta recusa o mesmo cliente duas vezes no mesmo negócio (23505)', async () => {
    const A = await seedTenantComNegocio('pk')
    fixtures.push(A)

    const duplicado = withTenant(sql, A.tenantId, (tx) =>
      tx.unsafe(
        `insert into deal_contacts (tenant_id, deal_id, contact_id, principal) values ($1, $2, $3, false)`,
        [A.tenantId, A.dealId, A.contatoId],
      ),
    )
    // A linha principal já existe para (deal, contato): viola a PK, não o RLS.
    await expect(duplicado).rejects.toThrow(/deal_contacts_deal_contact_pk|duplicate key/i)
  })

  it('partial unique recusa um SEGUNDO principal no mesmo negócio (23505)', async () => {
    const A = await seedTenantComNegocio('segundo-principal')
    fixtures.push(A)

    const outro = await withTenant(sql, A.tenantId, async (tx) => {
      const c = await tx.unsafe<{ id: string }[]>(
        `insert into contacts (tenant_id, name) values ($1, 'Segundo principal QA') returning id`,
        [A.tenantId],
      )
      return c[0]!.id
    })

    const segundo = withTenant(sql, A.tenantId, (tx) =>
      tx.unsafe(
        `insert into deal_contacts (tenant_id, deal_id, contact_id, principal) values ($1, $2, $3, true)`,
        [A.tenantId, A.dealId, outro],
      ),
    )
    await expect(segundo).rejects.toThrow(/deal_contacts_deal_principal_key|duplicate key/i)
  })
})

// ---------------------------------------------------------------------------
// 4) A pública — a lista de clientes é SÓ nome, e o contexto de tenant morre no statement
// ---------------------------------------------------------------------------

/** Token conhecido da proposta-casal fixture deste arquivo (mesma razão do token fixo
 * de `public-proposal.test.ts`: a sonda precisa exercitar UMA linha de verdade). */
const FIXTURE_CASAL_TOKEN = 'rafa-fixture-casal-002000000000000000000'

let casalPronto = false

/**
 * Proposta ENVIADA de um casal, com canários de telefone/e-mail plantados nos DOIS
 * contatos (principal e secundário). Se a função emendada começar a devolver qualquer
 * coluna além de `contacts.name`, o scanner pega — não um assert campo a campo que só
 * acha o que eu já imaginei.
 */
async function seedCasalComProposta(): Promise<void> {
  if (casalPronto) return

  const tenantId = randomUUID()
  await withTenant(sql, tenantId, async (tx) => {
    await tx.unsafe(
      `insert into tenants (id, name, slug) values ($1, $2, $3) on conflict do nothing`,
      [tenantId, 'Agência QA Casal Público', `qa-casal-publico-${tenantId.slice(0, 8)}`],
    )
    await tx.unsafe(
      `insert into "user" (id, tenant_id, name, email, role) values ($1, $2, $3, $4, 'owner')`,
      [`qa-casal-pub-${randomUUID()}`, tenantId, 'Dono Casal Público', `dono-${tenantId}@exemplo-zarpa.com.br`],
    )

    // Canários nos DOIS clientes: o principal e o secundário. Telefone e e-mail de
    // nenhum dos dois podem sair no payload público. E-mails DISTINTOS de propósito:
    // `contacts_tenant_email_key` é unique em (tenant_id, lower(email)) — o canário do
    // Carlos é derivado, e o scanner o pega pelo PADRÃO de e-mail, não só pelo valor.
    const ana = await tx.unsafe<{ id: string }[]>(
      `insert into contacts (tenant_id, name, email, phone, whatsapp)
       values ($1, 'Ana Fixture do Casal', $2, $3, $3) returning id`,
      [tenantId, CANARIES.email, CANARIES.telefone],
    )
    const carlos = await tx.unsafe<{ id: string }[]>(
      `insert into contacts (tenant_id, name, email, phone, whatsapp)
       values ($1, 'Carlos Fixture do Casal', $2, $3, $3) returning id`,
      [tenantId, `carlos.${CANARIES.email}`, CANARIES.telefone],
    )
    const deal = await tx.unsafe<{ id: string }[]>(
      `insert into deals (tenant_id, contact_id, title, stage) values ($1, $2, 'Lua de mel fixture', 'novo') returning id`,
      [tenantId, ana[0]!.id],
    )
    // Principal primeiro; o secundário entra DEPOIS (created_at explícito para a ordem
    // da lista não depender do relógio).
    await tx.unsafe(
      `insert into deal_contacts (tenant_id, deal_id, contact_id, principal, created_at)
       values ($1, $2, $3, true, now() - interval '2 days')`,
      [tenantId, deal[0]!.id, ana[0]!.id],
    )
    await tx.unsafe(
      `insert into deal_contacts (tenant_id, deal_id, contact_id, principal, created_at)
       values ($1, $2, $3, false, now() - interval '1 day')`,
      [tenantId, deal[0]!.id, carlos[0]!.id],
    )
    await tx.unsafe(
      `insert into proposals (tenant_id, deal_id, public_token, title, status, sent_at, brand_snapshot)
       values ($1, $2, $3, 'Proposta do casal fixture', 'sent', now(), '{}'::jsonb)`,
      [tenantId, deal[0]!.id, FIXTURE_CASAL_TOKEN],
    )
  })

  casalPronto = true
}

type PayloadComClientes = { payload: { clientes?: unknown } }

describe('proposta pública — a lista de clientes carrega NOMES e nada mais', () => {
  it('payload.clientes = [principal, secundário] na ordem, sem telefone/e-mail/canário em lugar nenhum', async () => {
    await seedCasalComProposta()

    // Sem contexto nenhum: é o chamador anônimo real.
    const rows = await sql<PayloadComClientes[]>`
      select payload from public.proposta_publica(${FIXTURE_CASAL_TOKEN})
    `
    const payload = rows[0]?.payload
    expect(payload, 'a fixture da pública não resolveu — o teste ficou vago').toBeDefined()

    // Nomes, principal primeiro, na ordem de entrada do secundário.
    expect(payload!.clientes).toEqual(['Ana Fixture do Casal', 'Carlos Fixture do Casal'])

    // Varredura inteira do payload — nome de campo proibido, padrão no valor e canário.
    const leaks = scanPayload(payload, CANARIES)
    expect(leaks, `vazou:\n${formatLeaks(leaks)}`).toEqual([])

    // E a prova BRUTA: nenhum valor canário plantado nos contatos aparece no JSON,
    // nem dentro de string aninhada.
    const texto = JSON.stringify(rows)
    expect(texto).not.toContain(CANARIES.telefone)
    expect(texto).not.toContain(CANARIES.email)
  })

  it('o contexto de tenant que a função usa por dentro morre com o statement', async () => {
    await seedCasalComProposta()

    // MESMA conexão física, statements em AUTOCOMMIT (nada de `sql.begin`: uma transação
    // explícita faria o GUC `is_local` sobreviver a statements seguintes e mudaria a
    // semântica que estou provando). O pool podia me dar conexões diferentes para as
    // duas queries — `reserve()` segura UMA. É a pós-condição do chamador anônimo real:
    // se o app.tenant_id que a função seta por dentro vazasse para a sessão, o SELECT
    // seguinte veria linha em vez de zero.
    const sessao = await sql.reserve()
    try {
      await sessao`select payload from public.proposta_publica(${FIXTURE_CASAL_TOKEN})`
      const depois = await sessao<{ n: number }[]>`select count(*)::int as n from deal_contacts`
      expect(depois[0]!.n, 'o app.tenant_id da função vazou para a sessão do chamador').toBe(0)
    } finally {
      sessao.release()
    }
  })
})
