/**
 * A proposta pública é lida sem login. Regra 4 do CLAUDE.md: ela devolve
 * proposta / opções / blocos / marca, e NUNCA custo, comissão ou documento de
 * passageiro.
 *
 * Estratégia: plantar canários no banco (CPF válido, passaporte, e-mail,
 * telefone, custo, comissão), chamar a função `SECURITY DEFINER`, e varrer a
 * resposta INTEIRA — nome de campo, valor, e JSON embutido em string. Conferir
 * campo a campo só acha o que eu já imaginei; a varredura acha o campo que a
 * Rafa adicionar semana que vem.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { connect, discoverTenantTables, withTenant, type Sql } from '../helpers/db'
import { TENANT_A } from './isolation-checks'
import { CANARIES, formatLeaks, scanPayload } from './leak-scanner'

const sql = connect()

type Routine = { schema: string; name: string; args: string; securityDefiner: boolean }

async function findPublicProposalRoutines(client: Sql): Promise<Routine[]> {
  return client<Routine[]>`
    select n.nspname                              as schema,
           p.proname                              as name,
           pg_get_function_arguments(p.oid)       as args,
           p.prosecdef                            as "securityDefiner"
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname ~* 'propos' or p.proname ~* 'public')
    order by p.proname
  `
}

/**
 * Token conhecido da proposta fixture deste arquivo. Fixo (não gerado) para o teste
 * não depender de ordem de execução nem de outro arquivo semear `proposals` antes —
 * ver docs/handoffs/rafa-para-teo.md, S7, item 2. `tenant-isolation.test.ts` reutiliza
 * o mesmo TENANT_A depois e semeia SUAS PRÓPRIAS linhas por cima (insert, nunca
 * upsert) — não conflita com esta fixture.
 */
const FIXTURE_PUBLIC_TOKEN = 'teo-fixture-proposta-publica-0000000000000000'

/**
 * Semeia UMA proposta em status publicável (`sent`), com uma opção que tem
 * `cost_cents`/`commission_cents` preenchidos — sem isso a asserção de "não vaza"
 * passaria trivialmente por não ter o que vazar. `brand_snapshot.whatsapp` também é
 * preenchido de propósito: é o que exercita o caminho de `brand.whatsappLink` que o
 * Rafa pediu para o `leak-scanner.ts` não confundir com telefone de cliente vazando
 * (ver allowlist em `leak-scanner.ts`).
 */
async function seedPublicProposalFixture(client: Sql): Promise<void> {
  await withTenant(client, TENANT_A, async (tx) => {
    await tx`insert into tenants (id, name, slug)
      values (${TENANT_A}, 'Agência fixture Téo', 'teo-fixture-publica')
      on conflict do nothing`

    const [contact] = await tx<{ id: string }[]>`insert into contacts (tenant_id, name)
      values (${TENANT_A}, 'Cliente fixture Téo') returning id`

    const [deal] = await tx<{ id: string }[]>`insert into deals (tenant_id, contact_id, title)
      values (${TENANT_A}, ${contact.id}, 'Viagem fixture Téo') returning id`

    const brandSnapshot = JSON.stringify({
      name: 'Agência fixture Téo',
      whatsapp: '11987654321',
      instagram: '@agenciafixture',
    })

    const [proposal] = await tx<{ id: string }[]>`insert into proposals
      (tenant_id, deal_id, public_token, title, status, sent_at, brand_snapshot)
      values (
        ${TENANT_A}, ${deal.id}, ${FIXTURE_PUBLIC_TOKEN}, 'Proposta fixture Téo',
        'sent', now(), ${brandSnapshot}::jsonb
      ) returning id`

    await tx`insert into proposal_options
      (tenant_id, proposal_id, name, price_cents, cost_cents, commission_cents)
      values (${TENANT_A}, ${proposal.id}, 'Pacote único', 899000, 320000, 987650)`
  })
}

await seedPublicProposalFixture(sql)

const routines = await findPublicProposalRoutines(sql)
const definers = routines.filter((r) => r.securityDefiner)
const tenantTables = await discoverTenantTables(sql)

afterAll(async () => {
  await sql.end({ timeout: 5 })
})

describe('o varredor de vazamento funciona (senão o resto é cobertura falsa)', () => {
  it('acha campo proibido, padrão no valor e canário num payload sabidamente ruim', () => {
    const bad = {
      proposal: { title: 'Lisboa' },
      options: [{ price: 5000, cost: 3200, commission_pct: 12 }],
      traveler: {
        name: 'Maria',
        cpf: CANARIES.cpf,
        contact: `manda pra ${CANARIES.email}`,
        meta: JSON.stringify({ passport: CANARIES.passaporte }),
      },
    }
    const leaks = scanPayload(bad, CANARIES)
    const kinds = new Set(leaks.map((l) => l.kind))
    const what = new Set(leaks.map((l) => l.what))

    expect(kinds.has('nome-de-campo'), 'não pegou nome de campo proibido').toBe(true)
    expect(kinds.has('padrao-no-valor'), 'não pegou padrão no valor').toBe(true)
    expect(kinds.has('canario'), 'não pegou canário').toBe(true)
    expect(what.has('custo'), 'não pegou o campo cost').toBe(true)
    expect(what.has('comissão / margem'), 'não pegou commission_pct').toBe(true)
    // passaporte escondido dentro de string JSON
    expect(
      leaks.some((l) => l.path.includes('(json)') || l.what === 'passaporte'),
      'não abriu o JSON embutido na string',
    ).toBe(true)
  })

  it('não acusa vazamento num payload limpo', () => {
    const clean = {
      proposal: { id: 'p1', title: 'Lisboa em maio', currency: 'BRL' },
      options: [{ label: 'Aéreo + hotel', price: 8990.0 }],
      blocks: [{ kind: 'text', body: 'Voo direto, 7 noites no centro.' }],
      brand: { name: 'Agência da Ana', accent: '#12557F' },
    }
    const leaks = scanPayload(clean, CANARIES)
    expect(leaks, `falso positivo:\n${formatLeaks(leaks)}`).toEqual([])
  })
})

describe('contrato da proposta pública', () => {
  it('existe uma função SECURITY DEFINER para a proposta pública', () => {
    expect(
      definers.length,
      `nenhuma função SECURITY DEFINER de proposta pública encontrada no schema public. ` +
        `Rotinas com nome parecido: ${
          routines.map((r) => `${r.name}(${r.args})${r.securityDefiner ? '' : ' [SEM security definer]'}`).join(', ') ||
          '<nenhuma>'
        }. ` +
        `Regra 4 do CLAUDE.md. Dono: Rafa.`,
    ).toBeGreaterThan(0)
  })

  it('a função SECURITY DEFINER tem search_path fixo', async () => {
    // SECURITY DEFINER sem search_path fixo é escalada de privilégio clássica:
    // quem controla o search_path da sessão decide qual `proposals` a função lê.
    for (const r of definers) {
      const [row] = await sql<{ config: string[] | null }[]>`
        select p.proconfig as config
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = ${r.schema} and p.proname = ${r.name}
        limit 1
      `
      const hasSearchPath = (row?.config ?? []).some((c) => c.startsWith('search_path='))
      expect(
        hasSearchPath,
        `${r.schema}.${r.name} é SECURITY DEFINER sem "SET search_path". ` +
          `Adicione: ALTER FUNCTION ${r.schema}.${r.name} SET search_path = public, pg_temp;`,
      ).toBe(true)
    }
    expect(definers.length).toBeGreaterThan(0)
  })
})

describe('resposta da proposta pública não carrega dado sensível', () => {
  it('nenhum canário, campo proibido ou padrão sensível sai na resposta', async () => {
    if (definers.length === 0) {
      throw new Error(
        'sem função SECURITY DEFINER não dá para exercer a resposta pública. ' +
          'Este teste fica vermelho até a função existir — de propósito.',
      )
    }

    const proposals = tenantTables.find((t) => t.name === 'proposals')
    if (!proposals) {
      throw new Error('tabela `proposals` não existe ainda; não há proposta para publicar.')
    }

    // Planta canário em toda coluna de texto cujo nome cheire a dado sensível.
    const planted = await plantCanaries(sql)

    const results: { routine: string; leaks: ReturnType<typeof scanPayload> }[] = []
    for (const r of definers) {
      const payload = await callRoutine(sql, r, planted.token)
      if (payload === null) continue
      results.push({ routine: `${r.schema}.${r.name}`, leaks: scanPayload(payload, CANARIES) })
    }

    const withLeaks = results.filter((r) => r.leaks.length > 0)
    expect(
      withLeaks.map((r) => r.routine),
      withLeaks.map((r) => `\n${r.routine}:\n${formatLeaks(r.leaks)}`).join(''),
    ).toEqual([])

    expect(
      results.length,
      'nenhuma função SECURITY DEFINER pôde ser chamada — a varredura não exerceu nada, ' +
        'então não pode ser considerada verde',
    ).toBeGreaterThan(0)
  })
})

/** Grava canários em colunas sensíveis e devolve o token público da proposta. */
async function plantCanaries(client: Sql): Promise<{ token: string | null }> {
  const sensitive = await client<{ table_name: string; column_name: string }[]>`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and data_type in ('text', 'character varying')
      and (
        column_name ~* '(cpf|passport|passaporte|email|phone|telefone|celular|documento|birth|nascimento)'
      )
  `

  for (const col of sensitive) {
    const value = /cpf/i.test(col.column_name)
      ? CANARIES.cpf
      : /passport|passaporte/i.test(col.column_name)
        ? CANARIES.passaporte
        : /email/i.test(col.column_name)
          ? CANARIES.email
          : /phone|telefone|celular/i.test(col.column_name)
            ? CANARIES.telefone
            : CANARIES.cpf
    try {
      await withTenant(client, TENANT_A, (tx) =>
        tx.unsafe(`update public."${col.table_name}" set "${col.column_name}" = $1`, [
          value,
        ] as never[]),
      )
    } catch {
      /* coluna pode ser gerada/criptografada; não é motivo para derrubar o teste */
    }
  }

  const tokenCol = await client<{ table_name: string; column_name: string }[]>`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'proposals'
      and column_name ~* '(token|slug|public_id|share|hash)'
    limit 1
  `
  const tc = tokenCol[0]
  if (!tc) return { token: null }

  // Preferir o token da fixture DESTE arquivo em vez de um `limit 1` sem ordem.
  // Motivo: na suíte completa, `tenant-isolation.test.ts` semeia uma linha
  // sintética em `proposals` (e em toda tabela de tenant), e qual token a sonda
  // genérica pega é acaso de layout físico. Com o token sintético, a varredura
  // exercita a linha sintética — `proposta_publica` devolve zero linhas (ela
  // exige status publicável) e o sweep da proposta fica vago por acaso, não por
  // garantia. Fixando o token da fixture, o sweep exercita SEMPRE a proposta
  // `sent` de verdade que este arquivo semeou. O fallback genérico continua,
  // para o teste não ficar cego se o schema mudar de forma. O payload público
  // do ROTEIRO (que também casa no varredor de rotinas) tem arquivo próprio:
  // tests/security/public-roteiro.test.ts.
  const fixada = await withTenant(client, TENANT_A, (tx) =>
    tx.unsafe<{ v: string }[]>(
      `select "${tc.column_name}"::text as v from public.proposals where "${tc.column_name}"::text = $1`,
      [FIXTURE_PUBLIC_TOKEN] as never[],
    ),
  )
  if (fixada[0]?.v) return { token: fixada[0].v }

  const rows = await withTenant(client, TENANT_A, (tx) =>
    tx.unsafe<{ v: string }[]>(
      `select "${tc.column_name}"::text as v from public.proposals limit 1`,
      [],
    ),
  )
  return { token: rows[0]?.v ?? null }
}

async function callRoutine(client: Sql, r: Routine, token: string | null): Promise<unknown> {
  const argCount = r.args.trim() === '' ? 0 : r.args.split(',').length
  try {
    if (argCount === 0) {
      const rows = await client.unsafe(`select * from ${r.schema}."${r.name}"()`)
      return rows
    }
    if (token === null) return null
    const rows = await client.unsafe(`select * from ${r.schema}."${r.name}"($1)`, [
      token,
    ] as never[])
    return rows
  } catch {
    return null
  }
}
