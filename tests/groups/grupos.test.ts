/**
 * Meta Grupos, rodada 6a (`docs/GRUPOS_META.md`, 0025) — o pacote com lugares:
 * criar com os quatro números por lugar, ocupar com clientes (+ negócio
 * opcional), ocupação que o SERVIDOR conta, e as duas recusas que protegem a
 * verdade: lugares além do total e reduzir o total abaixo da ocupação.
 *
 * Mesmo padrão das rodadas anteriores: funções REAIS contra o Postgres de
 * teste, só `requireAuthContext` mockado.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { contacts, deals, proposals, sales, tenants, user } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: 'qa-grupos-user',
  email: 'qa-grupos@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const {
  criarGrupo,
  listarGrupos,
  obterGrupo,
  atualizarGrupo,
  adicionarMembroAoGrupo,
  removerMembroDoGrupo,
  grupoDoNegocio,
  parcelasDoGrupo,
  resumoDosGrupos,
  criarNegocioParaMembro,
} = await import('@/server/groups')

type Fixture = { tenantId: string; userId: string }

function entrarComo(fixture: Fixture): void {
  authCtx.tenantId = fixture.tenantId
  authCtx.userId = fixture.userId
}

async function seedTenant(prefix: string): Promise<Fixture> {
  const tenantId = randomUUID()
  const tag = `qa-grupos-${prefix}-${tenantId.slice(0, 8)}`
  const userId = `qa-grupos-${randomUUID()}`

  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `Agência QA Grupos ${tag}`, slug: tag })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Grupos Bot',
      email: `${userId}@exemplo-zarpa.test`,
    })
  })

  return { tenantId, userId }
}

afterAll(async () => {
  vi.restoreAllMocks()
})

describe('grupos (rodada 6a)', () => {
  it('cria o pacote com os quatro números por lugar; a margem é conta do servidor', async () => {
    const tenant = await seedTenant('cria')
    entrarComo(tenant)

    const criado = await criarGrupo({
      title: 'Fátima 2027',
      destination: 'Portugal',
      totalSeats: 10,
      pricePerSeatCents: 550_000,
      costPerSeatCents: 400_000,
      commissionPerSeatCents: 30_000,
      serviceFeePerSeatCents: 20_000,
    })
    expect(criado.ok).toBe(true)
    if (!criado.ok) return
    // 5.500 − 4.000 − 300 − 200 = 1.000 por lugar.
    expect(criado.data.margemPorLugarCents).toBe(100_000)
    expect(criado.data.lugaresOcupados).toBe(0)
    expect(criado.data.status).toBe('montando')
  })

  it('ocupação: cliente ocupa lugares, excesso recusa, membro repetido recusa, liberar devolve', async () => {
    const tenant = await seedTenant('ocupa')
    entrarComo(tenant)

    const grupo = await criarGrupo({ title: 'Peregrinação', totalSeats: 3, pricePerSeatCents: 500_000 })
    expect(grupo.ok).toBe(true)
    if (!grupo.ok) return

    const ids = await withTenant(tenant.tenantId, async (tx) => {
      const [a] = await tx.insert(contacts).values({ tenantId: tenant.tenantId, name: 'Ana' }).returning({ id: contacts.id })
      const [b] = await tx.insert(contacts).values({ tenantId: tenant.tenantId, name: 'Bruno' }).returning({ id: contacts.id })
      return { a: a!.id, b: b!.id }
    })

    // Ana ocupa 2 lugares (a família dela como um bloco).
    const ana = await adicionarMembroAoGrupo({ groupId: grupo.data.id, contactId: ids.a, seats: 2 })
    expect(ana.ok).toBe(true)
    if (!ana.ok) return
    expect(ana.data.lugaresOcupados).toBe(2)

    // Bruno quer 2 — só resta 1: recusa diz quantos restam.
    const excesso = await adicionarMembroAoGrupo({ groupId: grupo.data.id, contactId: ids.b, seats: 2 })
    expect(excesso.ok).toBe(false)
    if (!excesso.ok) {
      expect(excesso.mensagem).toContain('restam 1')
    }

    // Bruno com 1 passa; Ana de novo (membro repetido) recusa.
    const bruno = await adicionarMembroAoGrupo({ groupId: grupo.data.id, contactId: ids.b, seats: 1 })
    expect(bruno.ok).toBe(true)
    if (!bruno.ok) return
    const repetida = await adicionarMembroAoGrupo({ groupId: grupo.data.id, contactId: ids.a, seats: 1 })
    expect(repetida.ok).toBe(false)

    // Liberar Bruno devolve o lugar.
    const liberado = await removerMembroDoGrupo({ groupId: grupo.data.id, contactId: ids.b })
    expect(liberado.ok).toBe(true)
    if (!liberado.ok) return
    expect(liberado.data.lugaresOcupados).toBe(2)
  })

  it('reduzir o total abaixo da ocupação recusa; encerrar bloqueia nova ocupação', async () => {
    const tenant = await seedTenant('limites')
    entrarComo(tenant)

    const grupo = await criarGrupo({ title: 'Noronha', totalSeats: 2 })
    expect(grupo.ok).toBe(true)
    if (!grupo.ok) return

    const [contato] = await withTenant(tenant.tenantId, async (tx) => {
      const [c] = await tx.insert(contacts).values({ tenantId: tenant.tenantId, name: 'Cró' }).returning({ id: contacts.id })
      return [c]
    })

    const membro = await adicionarMembroAoGrupo({ groupId: grupo.data.id, contactId: contato!.id, seats: 2 })
    expect(membro.ok).toBe(true)
    if (!membro.ok) return

    const reduzir = await atualizarGrupo({ id: grupo.data.id, totalSeats: 1 })
    expect(reduzir.ok).toBe(false)
    if (!reduzir.ok) {
      expect(reduzir.mensagem).toContain('2 lugar(es) ocupado(s)')
    }

    const encerrar = await atualizarGrupo({ id: grupo.data.id, status: 'encerrado' })
    expect(encerrar.ok).toBe(true)
    if (!encerrar.ok) return

    const [outro] = await withTenant(tenant.tenantId, async (tx) => {
      const [o] = await tx.insert(contacts).values({ tenantId: tenant.tenantId, name: 'Depois' }).returning({ id: contacts.id })
      return [o]
    })
    const depois = await adicionarMembroAoGrupo({ groupId: grupo.data.id, contactId: outro!.id, seats: 1 })
    // Ocupado 2/2 — recusa por falta de lugar (a mesma cerca protege o encerrado).
    expect(depois.ok).toBe(false)
  })

  it('membro com negócio vinculado: o deal aparece na ficha; deal apagado não some com a ocupação', async () => {
    const tenant = await seedTenant('deal')
    entrarComo(tenant)

    const grupo = await criarGrupo({ title: 'Serra da Capivara', totalSeats: 5 })
    expect(grupo.ok).toBe(true)
    if (!grupo.ok) return

    const { contatoId, dealId } = await withTenant(tenant.tenantId, async (tx) => {
      const [c] = await tx.insert(contacts).values({ tenantId: tenant.tenantId, name: 'Duda' }).returning({ id: contacts.id })
      const [d] = await tx
        .insert(deals)
        .values({ tenantId: tenant.tenantId, contactId: c!.id, title: "Serra da Capivara — Duda" })
        .returning({ id: deals.id })
      return { contatoId: c!.id, dealId: d!.id }
    })

    const ocupou = await adicionarMembroAoGrupo({ groupId: grupo.data.id, contactId: contatoId, dealId, seats: 1 })
    expect(ocupou.ok).toBe(true)
    if (!ocupou.ok) return
    expect(ocupou.data.members[0]?.dealTitle).toBe('Serra da Capivara — Duda')

    // O negócio vai embora (SET NULL): a ocupação fica, o link some.
    await withTenant(tenant.tenantId, async (tx) => {
      await tx.delete(deals).where(eq(deals.id, dealId))
    })
    const depois = await obterGrupo(grupo.data.id)
    expect(depois.ok).toBe(true)
    if (!depois.ok) return
    expect(depois.data.lugaresOcupados).toBe(1)
    expect(depois.data.members[0]?.dealId).toBeNull()
  })

  it('6c: membro sem negócio vira NEGÓCIO pela ficha do grupo — e o grupo aparece no funil', async () => {
    const tenant = await seedTenant('converte')
    entrarComo(tenant)

    const grupo = await criarGrupo({ title: 'Serra do Cipó', totalSeats: 6 })
    expect(grupo.ok).toBe(true)
    if (!grupo.ok) return

    const contatoId = await withTenant(tenant.tenantId, async (tx) => {
      const [c] = await tx.insert(contacts).values({ tenantId: tenant.tenantId, name: 'Sofia' }).returning({ id: contacts.id })
      return c!.id
    })
    await adicionarMembroAoGrupo({ groupId: grupo.data.id, contactId: contatoId, seats: 1 })

    // Antes: o negócio de Sofia não tem grupo (não existe negócio).
    const antes = await grupoDoNegocio('00000000-0000-0000-0000-000000000000')
    expect(antes.ok).toBe(true)

    const criado = await criarNegocioParaMembro({ groupId: grupo.data.id, contactId: contatoId })
    expect(criado.ok).toBe(true)
    if (!criado.ok) return
    expect(criado.data.jaExistia).toBe(false)

    // O negócio nasce com o TÍTULO do grupo e o chip aponta para ele.
    const { obterNegocio } = await import('@/server/deals')
    const detalhe = await obterNegocio(criado.data.dealId)
    expect(detalhe.ok).toBe(true)
    if (!detalhe.ok) return
    expect(detalhe.data.title).toBe('Serra do Cipó')
    expect(detalhe.data.contactName).toBe('Sofia')

    const chip = await grupoDoNegocio(criado.data.dealId)
    expect(chip.ok).toBe(true)
    if (!chip.ok) return
    expect(chip.data?.id).toBe(grupo.data.id)
    expect(chip.data?.title).toBe('Serra do Cipó')

    // Toque duplo: devolve o MESMO negócio, nada duplica.
    const repetido = await criarNegocioParaMembro({ groupId: grupo.data.id, contactId: contatoId })
    expect(repetido.ok).toBe(true)
    if (!repetido.ok) return
    expect(repetido.data.jaExistia).toBe(true)
    expect(repetido.data.dealId).toBe(criado.data.dealId)
  })

  it('isolamento: grupo de outro tenant não abre', async () => {
    const alheio = await seedTenant('alheio')
    const dono = await seedTenant('dono')

    entrarComo(alheio)
    const grupoAlheio = await criarGrupo({ title: 'Da outra agência', totalSeats: 10 })
    expect(grupoAlheio.ok).toBe(true)
    if (!grupoAlheio.ok) return

    entrarComo(dono)
    const lista = await listarGrupos()
    expect(lista.ok).toBe(true)
    if (!lista.ok) return
    expect(lista.data.find((g) => g.id === grupoAlheio.data.id)).toBeUndefined()

    const detalhe = await obterGrupo(grupoAlheio.data.id)
    expect(detalhe.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Rodada 6b — a lente sobre o dinheiro: chip do negócio, parcelas da reserva,
// resumo de todos os grupos.
// ---------------------------------------------------------------------------

describe('grupos — rodada 6b (lente sobre o dinheiro)', () => {
  it('chip: grupoDoNegocio devolve o grupo e os lugares; negócio fora de grupo é null', async () => {
    const tenant = await seedTenant('chip')
    entrarComo(tenant)

    const grupo = await criarGrupo({ title: 'Chapada', totalSeats: 8 })
    expect(grupo.ok).toBe(true)
    if (!grupo.ok) return

    const ids = await withTenant(tenant.tenantId, async (tx) => {
      const [c] = await tx.insert(contacts).values({ tenantId: tenant.tenantId, name: 'Rui' }).returning({ id: contacts.id })
      const [d] = await tx
        .insert(deals)
        .values({ tenantId: tenant.tenantId, contactId: c!.id, title: 'Serra — Rui' })
        .returning({ id: deals.id })
      return { contatoId: c!.id, dealId: d!.id }
    })

    await adicionarMembroAoGrupo({ groupId: grupo.data.id, contactId: ids.contatoId, dealId: ids.dealId, seats: 3 })

    const chip = await grupoDoNegocio(ids.dealId)
    expect(chip.ok).toBe(true)
    if (!chip.ok) return
    expect(chip.data?.title).toBe('Chapada')
    expect(chip.data?.seats).toBe(3)

    // Negócio de fora: null — a viagem de sempre não ganha chip.
    const [fora] = await withTenant(tenant.tenantId, async (tx) => {
      const [c] = await tx.insert(contacts).values({ tenantId: tenant.tenantId, name: 'Fora' }).returning({ id: contacts.id })
      const [d] = await tx
        .insert(deals)
        .values({ tenantId: tenant.tenantId, contactId: c!.id, title: 'Viagem solta' })
        .returning({ id: deals.id })
      return [d]
    })
    const semGrupo = await grupoDoNegocio(fora!.id)
    expect(semGrupo.ok).toBe(true)
    if (!semGrupo.ok) return
    expect(semGrupo.data).toBeNull()
  })

  it('parcelas da reserva: lê as vendas/parcelas dos negócios membros — e o grupo não grava dinheiro', async () => {
    const tenant = await seedTenant('parcelas')
    entrarComo(tenant)

    const grupo = await criarGrupo({ title: 'Lençóis', totalSeats: 6, pricePerSeatCents: 800_000 })
    expect(grupo.ok).toBe(true)
    if (!grupo.ok) return

    const ids = await withTenant(tenant.tenantId, async (tx) => {
      const [c] = await tx.insert(contacts).values({ tenantId: tenant.tenantId, name: 'Lena' }).returning({ id: contacts.id })
      const [d] = await tx
        .insert(deals)
        .values({ tenantId: tenant.tenantId, contactId: c!.id, title: 'Lençóis — Lena', stage: 'ganho' })
        .returning({ id: deals.id })
      const [p] = await tx
        .insert(proposals)
        .values({ tenantId: tenant.tenantId, dealId: d!.id, publicToken: randomUUID(), title: "Proposta Lena" })
        .returning({ id: proposals.id })
      const [v] = await tx
        .insert(sales)
        .values({ tenantId: tenant.tenantId, dealId: d!.id, proposalId: p!.id, valorBrutoCents: 800_000 })
        .returning({ id: sales.id })
      return { contatoId: c!.id, dealId: d!.id, vendaId: v!.id }
    })

    await adicionarMembroAoGrupo({ groupId: grupo.data.id, contactId: ids.contatoId, dealId: ids.dealId, seats: 2 })

    // Sem parcelas geradas: o compromisso é o valor bruto inteiro em "a pagar".
    const antes = await parcelasDoGrupo(grupo.data.id)
    expect(antes.ok).toBe(true)
    if (!antes.ok) return
    expect(antes.data.members).toHaveLength(1)
    expect(antes.data.members[0]?.totalCents).toBe(800_000)
    expect(antes.data.members[0]?.aPagarCents).toBe(800_000)
    expect(antes.data.members[0]?.pagoCents).toBe(0)

    // Meia paga — a lente acompanha o cronograma da venda (com juros editáveis da 5a).
    const { receivables } = await import('@/db/schema')
    await withTenant(tenant.tenantId, async (tx) => {
      await tx.insert(receivables).values([
        { tenantId: tenant.tenantId, saleId: ids.vendaId, venceEm: '2027-01-10', valorCents: 400_000, status: 'pago', pagoEm: new Date() },
        { tenantId: tenant.tenantId, saleId: ids.vendaId, venceEm: '2027-02-10', valorCents: 450_000, status: 'pendente' },
      ])
    })

    const depois = await parcelasDoGrupo(grupo.data.id)
    expect(depois.ok).toBe(true)
    if (!depois.ok) return
    expect(depois.data.members[0]?.pagoCents).toBe(400_000)
    expect(depois.data.members[0]?.aPagarCents).toBe(450_000)
    expect(depois.data.members[0]?.parcelas).toBe(2)
  })

  it('resumo dos grupos: lugares, prevista × realizada e margem por lugar', async () => {
    const tenant = await seedTenant('resumo')
    entrarComo(tenant)

    const grupo = await criarGrupo({
      title: 'Jericoacoara',
      totalSeats: 12,
      pricePerSeatCents: 600_000,
      costPerSeatCents: 400_000,
      commissionPerSeatCents: 25_000,
      serviceFeePerSeatCents: 25_000,
    })
    expect(grupo.ok).toBe(true)
    if (!grupo.ok) return

    const ids = await withTenant(tenant.tenantId, async (tx) => {
      const [c] = await tx.insert(contacts).values({ tenantId: tenant.tenantId, name: 'Nara' }).returning({ id: contacts.id })
      const [d] = await tx
        .insert(deals)
        .values({ tenantId: tenant.tenantId, contactId: c!.id, title: 'Jerí — Nara', stage: 'ganho' })
        .returning({ id: deals.id })
      const [p] = await tx
        .insert(proposals)
        .values({ tenantId: tenant.tenantId, dealId: d!.id, publicToken: randomUUID(), title: "Proposta Nara" })
        .returning({ id: proposals.id })
      const [v] = await tx
        .insert(sales)
        .values({ tenantId: tenant.tenantId, dealId: d!.id, proposalId: p!.id, valorBrutoCents: 600_000 })
        .returning({ id: sales.id })
      return { contatoId: c!.id, dealId: d!.id, vendaId: v!.id }
    })

    await adicionarMembroAoGrupo({ groupId: grupo.data.id, contactId: ids.contatoId, dealId: ids.dealId, seats: 2 })
    const { receivables } = await import('@/db/schema')
    await withTenant(tenant.tenantId, async (tx) => {
      await tx.insert(receivables).values({
        tenantId: tenant.tenantId,
        saleId: ids.vendaId,
        venceEm: '2027-03-10',
        valorCents: 300_000,
        status: 'pago',
        pagoEm: new Date(),
      })
    })

    const resumo = await resumoDosGrupos()
    expect(resumo.ok).toBe(true)
    if (!resumo.ok) return
    const linha = resumo.data.find((g) => g.id === grupo.data.id)
    expect(linha).toBeDefined()
    expect(linha?.lugaresOcupados).toBe(2)
    expect(linha?.totalSeats).toBe(12)
    // Margem por lugar: 600 − 400 − 250 − 250 = 150.000 (R$ 1.500).
    expect(linha?.margemPorLugarCents).toBe(150_000)
    expect(linha?.receitaPrevistaCents).toBe(600_000)
    expect(linha?.receitaRealizadaCents).toBe(300_000)
    expect(linha?.totalMembros).toBe(1)
  })
})
