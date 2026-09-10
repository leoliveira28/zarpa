/**
 * Fase 5a — excursão/grupo leve (`docs/FASE5_EXCURSAO.md`): os três gaps do plano
 * em um fluxo só, funções REAIS contra o Postgres de teste (mesmo padrão de
 * `tests/money/resultado.test.ts`):
 *
 *  1. PASSAGEIROS DO GRUPO — `listarViajantesDoNegocio` traz os viajantes do titular
 *     E dos secundários (0020), titular primeiro (política da 0021). A lista presa
 *     ao titular sumia metade da excursão.
 *  2. ETIQUETA DE COMPRADOR — `criarParcela`/`atualizarParcela` aceitam `contactId`
 *     validado contra `deal_contacts`: comprador de fora recusa; `null` limpa.
 *  3. RESULTADO DA SAÍDA — `resultadoDaViagem` quebra pago/a pagar POR COMPRADOR
 *     quando há parcelas etiquetadas; sem etiqueta nenhuma vem vazia (a seção nem
 *     nasce na tela).
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { contacts, dealContacts, deals, proposals, sales, tenants, user } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: 'qa-excursao-user',
  email: 'qa-excursao@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { listarViajantesDoNegocio } = await import('@/server/travelers')
const { criarParcela, atualizarParcela, marcarParcelaPaga } = await import('@/server/sales')
const { resultadoDaViagem } = await import('@/server/resultado')

// ---------------------------------------------------------------------------
// Fixture — a peregrinação: negócio ganho, Maria titular + José secundário
// (deal_contacts como a 0020 planta), 3 viajantes (2 de Maria, 1 de José),
// venda de R$ 12.000 com 2 parcelas lançadas pelas actions.
// ---------------------------------------------------------------------------

type Fixture = {
  tenantId: string
  userId: string
  dealId: string
  vendaId: string
  mariaId: string
  joseId: string
}

function entrarComo(fixture: Fixture): void {
  authCtx.tenantId = fixture.tenantId
  authCtx.userId = fixture.userId
}

async function seedExcursao(prefix: string): Promise<Fixture> {
  const tenantId = randomUUID()
  const tag = `qa-exc-${prefix}-${tenantId.slice(0, 8)}`
  const userId = `qa-exc-${randomUUID()}`

  return withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `Agência QA Excursão ${tag}`, slug: tag })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Excursão Bot',
      email: `${userId}@exemplo-zarpa.test`,
    })

    const [maria] = await tx
      .insert(contacts)
      .values({ tenantId, name: 'Maria Pires' })
      .returning({ id: contacts.id })
    const [jose] = await tx
      .insert(contacts)
      .values({ tenantId, name: 'José Pires' })
      .returning({ id: contacts.id })

    const [deal] = await tx
      .insert(deals)
      .values({
        tenantId,
        contactId: maria!.id,
        title: 'Peregrinação 2027',
        destination: 'Fátima',
        stage: 'ganho',
        closedAt: new Date(),
        valueCents: 1_200_000,
      })
      .returning({ id: deals.id })

    // Espelho do principal (invariante da 0020) + o secundário do grupo.
    await tx.insert(dealContacts).values([
      { tenantId, dealId: deal!.id, contactId: maria!.id, principal: true },
      { tenantId, dealId: deal!.id, contactId: jose!.id, principal: false },
    ])

    const [proposta] = await tx
      .insert(proposals)
      .values({
        tenantId,
        dealId: deal!.id,
        publicToken: randomUUID(),
        title: 'Proposta — Peregrinação',
      })
      .returning({ id: proposals.id })
    const [venda] = await tx
      .insert(sales)
      .values({
        tenantId,
        dealId: deal!.id,
        proposalId: proposta!.id,
        valorBrutoCents: 1_200_000,
      })
      .returning({ id: sales.id })

    return { tenantId, userId, dealId: deal!.id, vendaId: venda!.id, mariaId: maria!.id, joseId: jose!.id }
  })
}

afterAll(async () => {
  vi.restoreAllMocks()
})

describe('excursão/grupo leve (Fase 5a)', () => {
  it('passageiros do grupo: titular e secundários, titular primeiro', async () => {
    const fixture = await seedExcursao('passageiros')
    entrarComo(fixture)

    // Maria tem 2 viajantes (a mais antiga primeiro); José 1 — fixture direta,
    // o mesmo INSERT que o sheet de viajante faz.
    const { travelers } = await import('@/db/schema')
    const ids = await withTenant(fixture.tenantId, async (tx) => {
      const criados = await tx
        .insert(travelers)
        .values([
          { tenantId: fixture.tenantId, contactId: fixture.mariaId, fullName: 'Maria Pires' },
          { tenantId: fixture.tenantId, contactId: fixture.mariaId, fullName: 'Téo Pires', kind: 'child' as const },
          { tenantId: fixture.tenantId, contactId: fixture.joseId, fullName: 'José Pires' },
        ])
        .returning({ id: travelers.id })
      return criados
    })
    expect(ids).toHaveLength(3)

    const resultado = await listarViajantesDoNegocio(fixture.dealId)
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return

    // Ordem: titular (Maria) primeiro com seus 2, depois José.
    expect(resultado.data.map((v) => v.fullName)).toEqual(['Maria Pires', 'Téo Pires', 'José Pires'])
    expect(resultado.data[0]?.isTitular).toBe(true)
    expect(resultado.data[2]?.comprador).toBe('José Pires')
    expect(resultado.data[2]?.isTitular).toBe(false)
  })

  it('etiqueta de comprador: válida grava, estranho recusa, null limpa', async () => {
    const fixture = await seedExcursao('etiqueta')
    entrarComo(fixture)

    // Etiquetada no nascimento.
    const parcelaMaria = await criarParcela(fixture.vendaId, {
      venceEm: '2027-01-10',
      valorCents: 600_000,
      contactId: fixture.mariaId,
    })
    expect(parcelaMaria.ok).toBe(true)
    if (!parcelaMaria.ok) return
    expect(parcelaMaria.data.contactId).toBe(fixture.mariaId)

    // Comprador de FORA do negócio recusa com a correção.
    const [estranho] = await withTenant(fixture.tenantId, (tx) =>
      tx.insert(contacts).values({ tenantId: fixture.tenantId, name: 'Estranho' }).returning({ id: contacts.id }),
    )
    const estranha = await criarParcela(fixture.vendaId, {
      venceEm: '2027-02-10',
      valorCents: 600_000,
      contactId: estranho!.id,
    })
    expect(estranha.ok).toBe(false)
    if (!estranha.ok) {
      expect(estranha.mensagem).toContain('não é cliente deste negócio')
    }

    // Atualizar limpa (`null`) e grava de novo.
    const limpa = await atualizarParcela(parcelaMaria.data.id, { contactId: null })
    expect(limpa.ok).toBe(true)
    if (!limpa.ok) return
    expect(limpa.data.contactId).toBeNull()
    const regravada = await atualizarParcela(parcelaMaria.data.id, { contactId: fixture.mariaId })
    expect(regravada.ok).toBe(true)
    if (!regravada.ok) return
    expect(regravada.data.contactId).toBe(fixture.mariaId)
  })

  it('resultado da saída: quebra por comprador — e vazia sem etiqueta', async () => {
    const fixture = await seedExcursao('resultado')
    entrarComo(fixture)

    const parcelaMaria = await criarParcela(fixture.vendaId, {
      venceEm: '2027-01-10',
      valorCents: 600_000,
      contactId: fixture.mariaId,
    })
    expect(parcelaMaria.ok).toBe(true)
    if (!parcelaMaria.ok) return
    const parcelaJose = await criarParcela(fixture.vendaId, {
      venceEm: '2027-02-10',
      valorCents: 600_000,
      contactId: fixture.joseId,
    })
    expect(parcelaJose.ok).toBe(true)
    if (!parcelaJose.ok) return
    // Maria pagou; José não.
    const paga = await marcarParcelaPaga(parcelaMaria.data.id)
    expect(paga.ok).toBe(true)

    const resultado = await resultadoDaViagem(fixture.dealId)
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(resultado.data.porComprador).toHaveLength(2)
    // Maior pendência primeiro: José (a pagar) vem antes de Maria (quite).
    const jose = resultado.data.porComprador.find((l) => l.contactId === fixture.joseId)
    const maria = resultado.data.porComprador.find((l) => l.contactId === fixture.mariaId)
    expect(maria?.pagoCents).toBe(600_000)
    expect(maria?.aPagarCents).toBe(0)
    expect(jose?.pagoCents).toBe(0)
    expect(jose?.aPagarCents).toBe(600_000)
    expect(resultado.data.recebidoCents).toBe(600_000)

    // Sem etiqueta nenhuma: a quebra some (a seção nem nasce na tela).
    await atualizarParcela(parcelaMaria.data.id, { contactId: null })
    await atualizarParcela(parcelaJose.data.id, { contactId: null })
    const semEtiqueta = await resultadoDaViagem(fixture.dealId)
    expect(semEtiqueta.ok).toBe(true)
    if (!semEtiqueta.ok) return
    expect(semEtiqueta.data.porComprador).toEqual([])
    // O agregado continua fechando — a etiqueta é só a quebra.
    expect(semEtiqueta.data.recebidoCents).toBe(600_000)
  })
})
