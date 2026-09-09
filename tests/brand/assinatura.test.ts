/**
 * 0017 — a assinatura do agente ("Agência · por Agente" + "via {APP_NAME}").
 *
 * Três frentes, na ordem do pedido:
 *
 *  1. O HELPER (`src/lib/assinatura.ts`) — puro, as regras das linhas sem banco.
 *  2. A ASSINATURA NA PONTA — `enviarProposta` congela `agentDisplayName` no
 *     `brand_snapshot`; `proposta_publica` (0004) e `roteiro_publica` (0013, OR REPLACE
 *     na 0017) devolvem `brand.agentDisplayName`. O caso "COM assinatura" é fixado aqui
 *     com whitelist de chaves — o caso "SEM assinatura" continua fixado na whitelist de
 *     `tests/security/public-roteiro.test.ts` (a chave só existe quando há assinatura:
 *     emissão condicional, ver o cabeçalho da `drizzle/0017_assinatura_do_agente.sql`).
 *  3. `atualizarMarca` grava; e o sempre: cross-tenant cego.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  contacts,
  deals,
  itineraries,
  proposalOptions,
  proposals,
  tenants,
  user,
} from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'
import {
  APP_NAME,
  assinaturaDaMarca,
  linhaDeAssinatura,
  linhaViaApp,
  textoComAssinatura,
} from '@/lib/assinatura'
import { seedCenarioRoteiro, apagarCenarioRoteiro, type CenarioRoteiro } from '../helpers/roteiro'

// ---------------------------------------------------------------------------
// Sessão mockada — única coisa falsa; quem muda de tenant é `entrarComo`
// ---------------------------------------------------------------------------

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: '',
  email: 'qa-assinatura@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { atualizarMarca, obterTenantAtual } = await import('@/server/tenants')
const { enviarProposta } = await import('@/server/proposals')
const { gerarRoteiro } = await import('@/server/itineraries')
const { obterPropostaPublica } = await import('@/server/publicProposals')
const { obterRoteiroPublico } = await import('@/server/publicItineraries')

function entrarComo(cenario: { tenantId: string; userId: string }): void {
  authCtx.tenantId = cenario.tenantId
  authCtx.userId = cenario.userId
}

// ---------------------------------------------------------------------------
// Fixture — tenant + usuário + contato + negócio + proposta DRAFT com uma opção
// (o `enviarProposta` exige opção e é ele quem congela a marca — então o teste
// de ponta passa pelo caminho REAL, não por UPDATE de fixture)
// ---------------------------------------------------------------------------

const AGENTE_A = 'Helena Duarte'
const AGENTE_B = 'Rodrigo Bittencourt'
const AGENCIA = 'Agência Assinatura QA'

type CenarioAssinatura = {
  tenantId: string
  userId: string
  propostaId: string
  propostaToken: string
}

async function seedCenarioAssinatura(agentDisplayName: string | null): Promise<CenarioAssinatura> {
  const tenantId = randomUUID()
  const userId = `qa-assinatura-${randomUUID()}`
  const tag = `qa-assinatura-${tenantId.slice(0, 8)}`
  const propostaToken = `qa-${randomUUID()}`

  return withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: `Agência ${tag}`,
      slug: tag,
      brandName: AGENCIA,
      whatsapp: '11987654321',
      agentDisplayName,
    })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Assinatura',
      email: `${tag}@exemplo-zarpa.test`,
    })
    const [contact] = await tx
      .insert(contacts)
      .values({ tenantId, name: 'Cliente QA Assinatura' })
      .returning({ id: contacts.id })
    const [deal] = await tx
      .insert(deals)
      .values({
        tenantId,
        contactId: contact!.id,
        title: 'Viagem QA Assinatura',
        stage: 'cotando',
        valueCents: 100_000,
      })
      .returning({ id: deals.id })
    const [proposta] = await tx
      .insert(proposals)
      .values({
        tenantId,
        dealId: deal!.id,
        publicToken: propostaToken,
        title: 'Proposta QA Assinatura',
        status: 'draft',
      })
      .returning({ id: proposals.id })
    await tx.insert(proposalOptions).values({
      tenantId,
      proposalId: proposta!.id,
      name: 'Única',
      position: 1,
      priceCents: 100_000,
    })

    return { tenantId, userId, propostaId: proposta!.id, propostaToken }
  })
}

const cenarios: CenarioAssinatura[] = []
const roteiros: CenarioRoteiro[] = []

afterAll(async () => {
  for (const c of cenarios) {
    try {
      await withTenant(c.tenantId, async (tx) => {
        await tx.delete(proposalOptions)
        await tx.delete(proposals)
        await tx.delete(deals)
        await tx.delete(contacts)
        await tx.delete(user)
        await tx.delete(tenants)
      })
    } catch {
      /* best-effort — o globalSetup recria o schema a cada rodada */
    }
  }
  for (const c of [...new Set(roteiros.map((r) => r.tenantId))]) {
    await apagarCenarioRoteiro(c)
  }
})

/** Envia a proposta do cenário (sessão mockada no tenant dele) e devolve o payload público. */
async function enviarELerPublica(c: CenarioAssinatura) {
  entrarComo(c)
  const enviada = await enviarProposta(c.propostaId)
  expect(enviada.ok, !enviada.ok ? enviada.mensagem : '').toBe(true)

  const leitura = await obterPropostaPublica(c.propostaToken)
  expect(leitura.ok, !leitura.ok ? leitura.mensagem : '').toBe(true)
  if (!leitura.ok || !leitura.data) throw new Error('proposta pública não veio')
  return leitura.data
}

// ---------------------------------------------------------------------------
// 1. O helper — puro, sem banco
// ---------------------------------------------------------------------------

describe('helper da assinatura (src/lib/assinatura.ts)', () => {
  it('linha completa: "Agência · por Agente"', () => {
    expect(linhaDeAssinatura({ brandName: 'Volta ao Mundo', agentDisplayName: 'Carolina' })).toBe(
      'Volta ao Mundo · por Carolina',
    )
    // Aceita o nome do payload público também (`name`), para a página pública usar o
    // objeto que já tem na mão.
    expect(linhaDeAssinatura({ name: 'Volta ao Mundo', agentDisplayName: 'Carolina' })).toBe(
      'Volta ao Mundo · por Carolina',
    )
  })

  it('sem agente configurado (ausente, null ou "") assina só com a agência', () => {
    expect(linhaDeAssinatura({ brandName: 'Volta ao Mundo', agentDisplayName: null })).toBe(
      'Volta ao Mundo',
    )
    expect(linhaDeAssinatura({ brandName: 'Volta ao Mundo', agentDisplayName: '   ' })).toBe(
      'Volta ao Mundo',
    )
    expect(linhaDeAssinatura({ brandName: 'Volta ao Mundo' })).toBe('Volta ao Mundo')
  })

  it('sem agência assina com o agente; sem nenhum dos dois não há linha inventada', () => {
    expect(linhaDeAssinatura({ agentDisplayName: 'Carolina' })).toBe('Carolina')
    expect(linhaDeAssinatura({})).toBeNull()
    expect(linhaDeAssinatura({ brandName: '  ', agentDisplayName: null })).toBeNull()
  })

  it('a linha "via" sai do token APP_NAME, nunca de string solta', () => {
    expect(linhaViaApp()).toBe(`via ${APP_NAME}`)
    expect(assinaturaDaMarca({ brandName: 'Maré Alta', agentDisplayName: 'Rodrigo' })).toEqual([
      'Maré Alta · por Rodrigo',
      `via ${APP_NAME}`,
    ])
    // Sem marca nenhuma, resta a linha "via" — a assinatura nunca fica vazia.
    expect(assinaturaDaMarca({})).toEqual([`via ${APP_NAME}`])
  })

  it('textoComAssinatura: mensagem + linha em branco + assinatura; mensagem vazia não cria texto órfão', () => {
    const marca = { brandName: 'Maré Alta', agentDisplayName: 'Rodrigo' }
    expect(textoComAssinatura('Sua proposta está pronta!', marca)).toBe(
      `Sua proposta está pronta!\n\nMaré Alta · por Rodrigo\nvia ${APP_NAME}`,
    )
    expect(textoComAssinatura('', marca)).toBe(`Maré Alta · por Rodrigo\nvia ${APP_NAME}`)
    expect(textoComAssinatura('Já vai   ', marca)).toBe(
      `Já vai\n\nMaré Alta · por Rodrigo\nvia ${APP_NAME}`,
    )
  })
})

// ---------------------------------------------------------------------------
// 2. A assinatura na ponta — envio, proposta pública, roteiro público
// ---------------------------------------------------------------------------

describe('assinatura na leitura pública (0017)', () => {
  it('proposta enviada por tenant COM assinatura: congela no snapshot e sai no payload', async () => {
    const cenario = await seedCenarioAssinatura(AGENTE_A)
    cenarios.push(cenario)

    const payload = await enviarELerPublica(cenario)

    // A chave nova existe e é a assinatura do tenant CERTO.
    expect(payload.brand.agentDisplayName).toBe(AGENTE_A)
    // Whitelist do caso COM assinatura — o portão público não ganhou nada além disto.
    expect(Object.keys(payload.brand).sort()).toEqual([
      'agentDisplayName',
      'instagram',
      'logoUrl',
      'name',
      'primaryColor',
      'secondaryColor',
      'whatsappLink',
    ])
    // O resto da marca segue intacto (reshaped, whatsappLink não whatsapp).
    expect(payload.brand.name).toBe(AGENCIA)
    expect(payload.brand).not.toHaveProperty('whatsapp')
  })

  it('proposta por tenant SEM assinatura: a chave NEM EXISTE no payload (byte a byte como antes)', async () => {
    const cenario = await seedCenarioAssinatura(null)
    cenarios.push(cenario)

    const payload = await enviarELerPublica(cenario)

    expect(payload.brand).not.toHaveProperty('agentDisplayName')
    // …e a whitelist antiga continua valendo para este caso (a do public-roteiro.test.ts).
    expect(Object.keys(payload.brand).sort()).toEqual([
      'instagram',
      'logoUrl',
      'name',
      'primaryColor',
      'secondaryColor',
      'whatsappLink',
    ])
  })

  it('roteiro: gerarRoteiro cai para o cadastro do tenant quando a proposta aceita é anterior à assinatura', async () => {
    // Fixture do roteiro: brand_snapshot da proposta SEM assinatura (helper do Téo).
    const cenario = await seedCenarioRoteiro()
    roteiros.push(cenario)
    entrarComo(cenario)

    // A agente configura o nome DEPOIS do envio — é o `atualizarMarca` da tela "Sua marca".
    const gravado = await atualizarMarca({ agentDisplayName: AGENTE_A })
    expect(gravado.ok, !gravado.ok ? gravado.mensagem : '').toBe(true)

    const gerado = await gerarRoteiro(cenario.dealId)
    expect(gerado.ok, !gerado.ok ? gerado.mensagem : '').toBe(true)
    if (!gerado.ok) return

    const leitura = await obterRoteiroPublico(gerado.data.publicToken)
    expect(leitura.ok, !leitura.ok ? leitura.mensagem : '').toBe(true)
    if (!leitura.ok || !leitura.data) throw new Error('roteiro público não veio')

    expect(leitura.data.brand.agentDisplayName).toBe(AGENTE_A)
    // O roteiro é fotografia: o snapshot dele carrega a assinatura congelada na geração.
    const [linha] = await withTenant(cenario.tenantId, async (tx) =>
      tx
        .select({ brandSnapshot: itineraries.brandSnapshot })
        .from(itineraries)
        .where(eq(itineraries.dealId, cenario.dealId)),
    )
    expect(linha!.brandSnapshot).toMatchObject({ agentDisplayName: AGENTE_A })
  })
})

// ---------------------------------------------------------------------------
// 3. atualizarMarca grava a assinatura
// ---------------------------------------------------------------------------

describe('atualizarMarca — agentDisplayName', () => {
  it('grava e obterTenantAtual devolve (a tela lê daqui)', async () => {
    const cenario = await seedCenarioAssinatura(null)
    cenarios.push(cenario)
    entrarComo(cenario)

    const gravou = await atualizarMarca({ agentDisplayName: `  ${AGENTE_B}  ` })
    expect(gravou.ok, !gravou.ok ? gravou.mensagem : '').toBe(true)

    const lido = await obterTenantAtual()
    expect(lido.ok).toBe(true)
    if (!lido.ok) return
    expect(lido.data.agentDisplayName).toBe(AGENTE_B) // trim veio junto
  })

  it('"" LIMPA (vira NULL no banco); ausente NÃO TOCA na coluna', async () => {
    const cenario = await seedCenarioAssinatura(AGENTE_A)
    cenarios.push(cenario)
    entrarComo(cenario)

    await atualizarMarca({ brandName: AGENCIA }) // patch sem a coluna
    let [linha] = await withTenant(cenario.tenantId, async (tx) =>
      tx.select({ n: tenants.agentDisplayName }).from(tenants),
    )
    expect(linha!.n).toBe(AGENTE_A) // ausente = intocado

    await atualizarMarca({ agentDisplayName: '' })
    ;[linha] = await withTenant(cenario.tenantId, async (tx) =>
      tx.select({ n: tenants.agentDisplayName }).from(tenants),
    )
    expect(linha!.n).toBeNull() // limpo de verdade, não string em branco
  })

  it('mais de 80 caracteres → DADOS_INVALIDOS apontando o campo', async () => {
    const cenario = await seedCenarioAssinatura(null)
    cenarios.push(cenario)
    entrarComo(cenario)

    const recusa = await atualizarMarca({ agentDisplayName: 'a'.repeat(81) })
    expect(recusa.ok).toBe(false)
    if (recusa.ok) return
    expect(recusa.code).toBe('DADOS_INVALIDOS')
    expect(recusa.campo).toBe('agentDisplayName')
  })
})

// ---------------------------------------------------------------------------
// 4. Cross-tenant cego — como sempre
// ---------------------------------------------------------------------------

describe('cross-tenant', () => {
  it('B não lê a assinatura de A e o payload público de A nunca carrega a de B', async () => {
    const a = await seedCenarioAssinatura(AGENTE_A)
    const b = await seedCenarioAssinatura(AGENTE_B)
    cenarios.push(a, b)

    entrarComo(b)
    const lidoB = await obterTenantAtual()
    expect(lidoB.ok).toBe(true)
    if (!lidoB.ok) return
    // RLS: B vê a linha dele — a assinatura de A nem chega perto.
    expect(lidoB.data.agentDisplayName).toBe(AGENTE_B)
    expect(JSON.stringify(lidoB.data)).not.toContain(AGENTE_A)

    const payloadA = await enviarELerPublica(a)
    expect(payloadA.brand.agentDisplayName).toBe(AGENTE_A)
    expect(JSON.stringify(payloadA)).not.toContain(AGENTE_B)
  })
})
