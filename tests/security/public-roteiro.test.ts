/**
 * A leitura pública do ROTEIRO (`public.roteiro_publica`, S14 §4) sob a MESMA disciplina
 * da proposta pública (`public-proposal.test.ts`): plantar canário, chamar o caminho
 * público de verdade, varrer a resposta INTEIRA.
 *
 * O roteiro é lido sem login pelo token — e o que sai por esse portão é só o SNAPSHOT:
 * título, nome do cliente, datas, blocos e marca. NUNCA custo, comissão, preço, documento
 * de passageiro, e-mail/telefone do cliente (§4 da spec, regra 4 do CLAUDE.md). Aqui a
 * prova é tripla, nessa ordem:
 *
 *   1. FORMA — o payload válido tem EXATAMENTE as chaves esperadas, em profundidade
 *      (whitelist recursiva, não "não vi nada estranho").
 *   2. VARREDURA — `scanPayload` com os canários do `leak-scanner`, plantados onde
 *      vazariam se a função um dia começasse a fazer JOIN (e-mail/telefone do cliente
 *      em `contacts`) ou se o snapshot um dia carregasse margem (`cost_cents`/
 *      `commission_cents` da opção aceita, plantados como números).
 *   3. PORTÃO — token errado devolve 0 linhas (não erro); o token da PROPOSTA não abre
 *      o roteiro nem vice-versa.
 *
 * E o isolamento A/B da tabela `itineraries` em SQL direto (o objeto sob teste aqui é a
 * POLICY, não o helper — as sondas usam o `withTenant` cru de `helpers/db`, que é uma
 * reprodução literal da regra 2 do CLAUDE.md; a fixture usa o helper da aplicação como
 * qualquer requisição usaria).
 *
 * NÃO há teste de "registrar visita" no roteiro de propósito — o §4 não pediu rastreio
 * de abertura (ver docs/handoffs/rafa-para-teo.md, §S14.4 item 8). Se um dia existir,
 * este arquivo precisa ganhar o mesmo sweep que `proposal_views` tem.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { RoteiroPublico } from '@/server/publicItineraries'
import { connect, withTenant, withoutTenant } from '../helpers/db'
import { CANARIES, formatLeaks, scanPayload } from './leak-scanner'
import {
  BRAND_SNAPSHOT_FIXTURE,
  PARTIDA_FIXTURE,
  VOLTA_FIXTURE,
  apagarCenarioRoteiro,
  seedCenarioRoteiro,
} from '../helpers/roteiro'

// A geração do roteiro passa pela action real (`gerarRoteiro`), que precisa de sessão —
// única coisa mockada, igual a `tests/sales/vendas.test.ts`. Tudo o que este arquivo
// verifica depois (função SECURITY DEFINER, SQL direto, leitura pública) roda SEM mock.
const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: '',
  email: 'qa-roteiro-publico@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { gerarRoteiro } = await import('@/server/itineraries')
const { obterRoteiroPublico } = await import('@/server/publicItineraries')
// Type-only: apagado na compilação, não toca no módulo 'use server' em runtime.
type PayloadPublico = RoteiroPublico

const sql = connect()

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
// Fixture — cenário A (com canários do cliente plantados) e cenário B (isolamento)
// ---------------------------------------------------------------------------

const cenarioA = await seedCenarioRoteiro({
  contato: { email: CANARIES.email, whatsapp: CANARIES.telefone },
})
authCtx.tenantId = cenarioA.tenantId
authCtx.userId = cenarioA.userId

const geradoA = await gerarRoteiro(cenarioA.dealId)
if (!geradoA.ok) {
  throw new Error(`fixture do roteiro público falhou: ${geradoA.mensagem}`)
}
const TOKEN_A = geradoA.data.publicToken

const cenarioB = await seedCenarioRoteiro()

afterAll(async () => {
  await apagarCenarioRoteiro(cenarioA.tenantId)
  await apagarCenarioRoteiro(cenarioB.tenantId)
  await sql.end({ timeout: 5 })
})

async function payloadPublico(): Promise<PayloadPublico> {
  const resultado = await obterRoteiroPublico(TOKEN_A)
  expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)
  if (!resultado.ok || !resultado.data) throw new Error('o token da fixture não renderizou o roteiro')
  return resultado.data
}

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

describe('contrato do roteiro público', () => {
  it('existe a função SECURITY DEFINER roteiro_publica, com search_path fixo', async () => {
    const [fn] = await sql<{ securityDefiner: boolean; config: string[] | null }[]>`
      select p.prosecdef as "securityDefiner", p.proconfig as config
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'roteiro_publica'
    `
    expect(
      fn,
      'roteiro_publica não existe no schema public — a leitura sem login não tem caminho. Regra 4 do CLAUDE.md. Dono: Rafa.',
    ).toBeDefined()
    expect(fn!.securityDefiner, 'roteiro_publica precisa ser SECURITY DEFINER').toBe(true)
    expect(
      (fn!.config ?? []).some((c) => c.startsWith('search_path=')),
      'SECURITY DEFINER sem search_path fixo é escalada de privilégio clássica',
    ).toBe(true)
  })

  it('token válido devolve EXATAMENTE título/cliente/datas/blocos/marca — nada além disso', async () => {
    const payload = await payloadPublico()

    // Whitelist de chaves em profundidade — não "não vi nada estranho".
    expect(Object.keys(payload).sort()).toEqual(['blocks', 'brand', 'roteiro'])
    expect(Object.keys(payload.roteiro).sort()).toEqual(
      ['clientName', 'createdAt', 'currency', 'departureOn', 'returnOn', 'title'],
    )
    expect(Object.keys(payload.brand).sort()).toEqual(
      ['instagram', 'logoUrl', 'name', 'primaryColor', 'secondaryColor', 'whatsappLink'],
    )
    expect(payload.blocks.length).toBeGreaterThan(0)
    for (const bloco of payload.blocks) {
      expect(Object.keys(bloco).sort()).toEqual(
        ['body', 'content', 'images', 'kind', 'position', 'title'],
      )
    }

    // Valores — a fotografia do fechado.
    expect(payload.roteiro.title).toBe(cenarioA.propostaTitle)
    expect(payload.roteiro.clientName).toBe(cenarioA.contactName)
    expect(payload.roteiro.currency).toBe('BRL')
    expect(payload.roteiro.departureOn).toBe(PARTIDA_FIXTURE)
    expect(payload.roteiro.returnOn).toBe(VOLTA_FIXTURE)
    expect(typeof payload.roteiro.createdAt).toBe('string')

    expect(payload.brand.name).toBe(BRAND_SNAPSHOT_FIXTURE.name)
    // A marca sai RESHAPED: `whatsapp` vira `whatsappLink` — a chave crua não existe.
    expect(payload.brand.whatsappLink).toBe(`https://wa.me/${BRAND_SNAPSHOT_FIXTURE.whatsapp}`)
    expect(payload.brand).not.toHaveProperty('whatsapp')

    // Blocos: compartilhados + da opção aceita, na ordem; o da opção econômica fora.
    expect(payload.blocks.map((b) => b.position)).toEqual([1, 2, 3])
    expect(payload.blocks.map((b) => b.title)).toEqual([
      'Voo de ida',
      'Hotel do conforto',
      'Boas-vindas',
    ])
  })

  it('varredura: nenhum canário, campo proibido ou padrão sensível em profundidade alguma', async () => {
    const payload = await payloadPublico()

    const leaks = scanPayload(payload, CANARIES)
    expect(leaks, `vazamento no payload do roteiro:\n${formatLeaks(leaks)}`).toEqual([])

    // Tripwire direto nos centavos da opção aceita: nem como chave (varrido acima),
    // nem como número solto. A busca é no ESQUELETO do JSON (strings substituídas por
    // aspas vazias): um número em JSON nunca vive dentro de aspas, e assim a busca não
    // sofre colisão com dígitos de string — o WhatsApp comercial da fixture
    // (`11987654321`) CONTÉM "98765", e um timestamp pode conter qualquer sequência
    // curta. Se `cost_cents`/`commission_cents` um dia vazarem, vazam como número.
    const cru = JSON.stringify(payload)
    const esqueleto = cru.replace(/"(?:[^"\\]|\\.)*"/g, '""')
    expect(esqueleto).not.toContain('320000')
    expect(esqueleto).not.toContain('98765')

    // PII do cliente plantada no `contacts` do MESMO tenant: se a função um dia
    // começar a fazer JOIN, estes dois aparecem aqui primeiro. Esta busca é no JSON
    // INTEIRO, strings incluídas — e-mail/telefone vazam como texto.
    expect(cru).not.toContain(CANARIES.email)
    expect(cru).not.toContain(CANARIES.telefone)
  })

  it('token inválido → 0 linhas (não erro), na action E na função', async () => {
    const inexistente = 'token-que-nunca-existiu-xyz'

    const action = await obterRoteiroPublico(inexistente)
    expect(action.ok).toBe(true)
    if (!action.ok) return
    expect(action.data).toBeNull()

    const linhas = await sql.unsafe(`select * from public.roteiro_publica($1)`, [inexistente] as never[])
    expect(linhas).toHaveLength(0)
  })

  it('o portão de um não abre o outro: o token da PROPOSTA não devolve roteiro', async () => {
    const linhas = await sql.unsafe(`select * from public.roteiro_publica($1)`, [
      cenarioA.propostaToken,
    ] as never[])
    expect(linhas).toHaveLength(0)

    const action = await obterRoteiroPublico(cenarioA.propostaToken)
    expect(action.ok).toBe(true)
    if (!action.ok) return
    expect(action.data).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Falha fechado e o raio da porta de fuga
// ---------------------------------------------------------------------------

describe('falha fechado e porta de fuga do roteiro', () => {
  it('sem contexto nenhum, a tabela falha fechado mesmo para o token correto', async () => {
    const visiveis = await withoutTenant(sql, (tx) =>
      tx.unsafe<{ n: string }[]>(
        `select count(*)::text as n from itineraries where public_token = $1`,
        [TOKEN_A] as never[],
      ),
    )
    expect(Number(visiveis[0]?.n ?? -1)).toBe(0)
  })

  it('porta de fuga conhecida: app.roteiro_public_context abre a leitura SEM tenant (raio FIXADO)', async () => {
    // Mesma doutrina do AUTH_CONTEXT_OPEN_TABLES (isolation-checks.ts): isto NÃO reprova
    // o desenho — mede e fixa o raio do escape hatch. A policy `itineraries_public_read`
    // abre SELECT para qualquer conexão que ligue o GUC, sem filtro de tenant, porque a
    // função é anônima e o token é o portão. Se um dia a policy mudar (para mais ou para
    // menos), este teste força a mudança a passar por aqui — não acontece calada. A
    // ressalva de sempre: GUC é forjável por SQL arbitrário; quem executa SQL arbitrário
    // já forja `app.tenant_id`.
    const visiveis = await sql.begin(async (tx) => {
      await tx`select set_config('app.roteiro_public_context', 'on', true)`
      const rows = await tx.unsafe<{ n: string }[]>(
        `select count(*)::text as n from itineraries where public_token = $1`,
        [TOKEN_A] as never[],
      )
      return Number(rows[0]?.n ?? -1)
    })
    expect(visiveis).toBe(1)
  })

  it('o GUC de proposta NÃO abre o roteiro (cada escape hatch tem o próprio alcance)', async () => {
    const visiveis = await sql.begin(async (tx) => {
      await tx`select set_config('app.proposal_public_context', 'on', true)`
      const rows = await tx.unsafe<{ n: string }[]>(
        `select count(*)::text as n from itineraries where public_token = $1`,
        [TOKEN_A] as never[],
      )
      return Number(rows[0]?.n ?? -1)
    })
    expect(visiveis).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Isolamento A/B na tabela itineraries — SQL direto, a policy é o objeto sob teste
// ---------------------------------------------------------------------------

describe('isolamento A/B na tabela itineraries', () => {
  it('tenant B não LÊ o roteiro do tenant A', async () => {
    const visiveis = await withTenant(sql, cenarioB.tenantId, (tx) =>
      tx.unsafe<{ id: string }[]>(`select id from itineraries where public_token = $1`, [
        TOKEN_A,
      ] as never[]),
    )
    expect(visiveis).toHaveLength(0)
  })

  it('tenant B não ALTERA nem APAGA o roteiro do tenant A — e a linha continua intacta', async () => {
    const afetados = await withTenant(sql, cenarioB.tenantId, async (tx) => {
      const upd = await tx.unsafe(`update itineraries set title = 'TEO-PWNED' where public_token = $1`, [
        TOKEN_A,
      ] as never[])
      const del = await tx.unsafe(`delete from itineraries where public_token = $1`, [TOKEN_A] as never[])
      return [(upd as unknown as { count: number }).count, (del as unknown as { count: number }).count]
    })

    expect(afetados[0]).toBe(0)
    expect(afetados[1]).toBe(0)

    // A prova de que não foi mera coincidência de SQL: a leitura pública segue
    // devolvendo o roteiro original, intocado.
    const payload = await payloadPublico()
    expect(payload.roteiro.title).toBe(cenarioA.propostaTitle)
  })

  it('INSERT na sessão do A com tenant_id do B não grava linha nenhuma no B', async () => {
    const contar = (): Promise<number> =>
      withTenant(sql, cenarioB.tenantId, async (tx) => {
        const rows = await tx.unsafe<{ n: string }[]>(`select count(*)::text as n from itineraries`)
        return Number(rows[0]?.n ?? -1)
      })

    const antes = await contar()
    let rejeicao: string | null = null
    try {
      // Roda SEM RETURNING de propósito (mesma disciplina de isolation-checks.ts):
      // com RETURNING, o Postgres aplica a policy de SELECT à linha devolvida e o
      // erro apareceria mesmo com o WITH CHECK tendo aceitado.
      //
      // As FKs apontam para deal/proposta DO PRÓPRIO B de propósito — a ÚNICA barreira
      // sob teste aqui é o WITH CHECK da policy, nunca uma FK. Com FORCE RLS, a
      // verificação de FK contra linha de outro tenant também pode recusar antes
      // (o lookup de RI respeita RLS) — as duas recusas vêm da mesma cerca de tenant,
      // e o veredito é a linha não nascer, não o código do erro.
      await withTenant(sql, cenarioA.tenantId, (tx) =>
        tx.unsafe(
          `insert into itineraries (tenant_id, deal_id, proposal_id, public_token, title, client_name)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            cenarioB.tenantId,
            cenarioB.dealId,
            cenarioB.propostaId,
            `teo-wc-${randomUUID()}`,
            'Roteiro invasor',
            'Invasor',
          ] as never[],
        ),
      )
    } catch (erro) {
      rejeicao = textoCompletoDoErro(erro)
    }

    const depois = await contar()
    expect(depois, `INSERT cruzado gravou linha! ${rejeicao ?? 'sem erro'}`).toBe(antes)
    if (rejeicao !== null) {
      expect(rejeicao).toMatch(/row-level security|foreign key|violates/i)
    }
  })

  it('o GUC morre com a transação: depois do COMMIT, a porta de fuga não sobra aberta', async () => {
    // `roteiro_publica` liga o GUC com set_config(..., true) — LOCAL à transação. Se um
    // dia alguém trocar o `true` por `false` (sessão inteira), o próximo request que
    // cair na MESMA conexão do pool herdaria o contexto público. Conexão RESERVADA de
    // propósito: sem reserve(), o pool poderia entregar outra conexão para a segunda
    // leitura e o teste passaria vago — aqui a MESMA conexão física vê as duas fases.
    //
    // Detalhe do driver (postgres.js 3.4.9): o cliente reservado NÃO tem `.begin()` —
    // begin/commit vão como SQL cru, o que é fiel o suficiente: é transação de verdade.
    // (Os tipos prometem `begin` em ReservedSql e o runtime não tem — tipo do driver
    // mente, fora da minha fronteira consertar.)
    const cliente = await sql.reserve()
    try {
      await cliente.unsafe(`begin`)
      try {
        await cliente.unsafe(`select set_config('app.roteiro_public_context', 'on', true)`)
        const dentro = await cliente.unsafe<{ n: string }[]>(
          `select count(*)::text as n from itineraries where public_token = $1`,
          [TOKEN_A] as never[],
        )
        expect(Number(dentro[0]?.n ?? -1)).toBe(1)
      } finally {
        // Commit mesmo se o expect acima falhar — não deixar a conexão em
        // "idle in transaction" para os testes seguintes.
        await cliente.unsafe(`commit`)
      }

      const fora = await cliente.unsafe<{ n: string }[]>(
        `select count(*)::text as n from itineraries where public_token = $1`,
        [TOKEN_A] as never[],
      )
      expect(
        Number(fora[0]?.n ?? -1),
        'o contexto público sobreviveu ao COMMIT — o set_config da função não é local à transação',
      ).toBe(0)
    } finally {
      cliente.release()
    }
  })
})
