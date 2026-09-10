/**
 * Fit 7 Vitrine, rodada 7a (`docs/FIT7_VITRINE.md`, 0026) — a oferta do catálogo
 * público: CRUD com blocos (fotografia do documento), publicar/despublicar,
 * isolamento por tenant, e as funções públicas SECURITY DEFINER (`vitrine_publica`,
 * `oferta_publica`) devolvendo EXATAMENTE o que a página pode ler — e nada de
 * rascunho, nada do vizinho.
 *
 * Mesmo padrão das rodadas anteriores: funções REAIS contra o Postgres de teste,
 * só `requireAuthContext` mockado.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { contacts, deals, groupMembers, groups, tenants, user } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'
import { unsafeSqlWithoutTenant } from '@/db/client'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: 'qa-vitrine-user',
  email: 'qa-vitrine@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { criarOferta, obterOferta, atualizarOferta, publicarOferta } =
  await import('@/server/offers')
const { obterVitrinePublica, obterOfertaPublica } = await import('@/server/offers')

type Fixture = { tenantId: string; userId: string; slug: string }

function entrarComo(fixture: Fixture): void {
  authCtx.tenantId = fixture.tenantId
  authCtx.userId = fixture.userId
}

async function seedTenant(prefix: string): Promise<Fixture> {
  const tenantId = randomUUID()
  const slug = `qa-vitrine-${prefix}-${tenantId.slice(0, 8)}`
  const userId = `qa-vitrine-${randomUUID()}`

  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `Agência QA Vitrine ${slug}`, slug })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Vitrine Bot',
      email: `${userId}@exemplo-zarpa.test`,
    })
  })

  return { tenantId, userId, slug }
}

afterAll(async () => {
  vi.restoreAllMocks()
})

describe('ofertas da Vitrine (7a)', () => {
  it('cria com blocos (fotografia), grava de novo inteiro, e o token público nasce', async () => {
    const fixture = await seedTenant('cria')
    entrarComo(fixture)

    const blocos: Array<{
      kind: 'text' | 'flight' | 'price_note'
      title: string | null
      body: string | null
      images: string[]
      content: Record<string, unknown>
    }> = [
      { kind: 'text', title: 'Sobre a viagem', body: 'Sete noites no Algarve.', images: [], content: {} },
      { kind: 'flight', title: 'Voo direto', body: null, images: [], content: { airline: 'TAP', from: 'GRU' } },
    ]
    const criada = await criarOferta({
      title: 'Férias em Portugal — 7 noites',
      type: 'pacote',
      priceCents: 550_000,
      summary: 'Voo + hospedagem + transfer',
      blocks: blocos,
    })
    expect(criada.ok).toBe(true)
    if (!criada.ok) return
    expect(criada.data.publicToken).toBeTruthy()
    expect(criada.data.publicada).toBe(false)

    // Grava o documento inteiro (autosave idempotente).
    const atualizada = await atualizarOferta({ id: criada.data.id, blocks: [...blocos, { kind: 'price_note', title: null, body: 'Preço por pessoa', images: [], content: {} }] })
    expect(atualizada.ok).toBe(true)

    const lida = await obterOferta(criada.data.id)
    expect(lida.ok).toBe(true)
    if (!lida.ok) return
    expect(lida.data.blocks).toHaveLength(3)
    expect(lida.data.blocks[1]?.content).toMatchObject({ airline: 'TAP' })
  })

  it('publicar/despublicar: o interruptor muda a leitura pública na hora', async () => {
    const fixture = await seedTenant('publica')
    entrarComo(fixture)

    const criada = await criarOferta({ title: 'Noronha direto', type: 'pacote', priceCents: 900_000 })
    expect(criada.ok).toBe(true)
    if (!criada.ok) return

    // Rascunho: nem catálogo nem oferta pública.
    const catalogoAntes = await obterVitrinePublica(fixture.slug)
    expect(catalogoAntes.ok).toBe(true)
    if (!catalogoAntes.ok) return
    expect(catalogoAntes.data?.ofertas ?? []).toHaveLength(0)

    const publica = await publicarOferta({ id: criada.data.id, publicada: true })
    expect(publica.ok).toBe(true)
    if (!publica.ok) return

    const catalogo = await obterVitrinePublica(fixture.slug)
    expect(catalogo.ok).toBe(true)
    if (!catalogo.ok) return
    expect(catalogo.data?.agencia?.nome).toContain('Vitrine')
    expect(catalogo.data?.ofertas).toHaveLength(1)
    expect(catalogo.data?.ofertas[0]?.priceCents).toBe(900_000)

    const detalhe = await obterOfertaPublica(fixture.slug, criada.data.publicToken)
    expect(detalhe.ok).toBe(true)
    if (!detalhe.ok) return
    expect(detalhe.data?.oferta?.title).toBe('Noronha direto')
    // A agência no payload da oferta NUNCA carrega PII — só nome/logo/instagram/whatsapp.
    expect(Object.keys(detalhe.data?.agencia ?? {}).sort()).toEqual([
      'agentName', 'instagram', 'logo', 'nome', 'whatsapp',
    ])

    // Despublicar: o link divulgado deixa de entregar a oferta.
    await publicarOferta({ id: criada.data.id, publicada: false })
    const aposDespublicar = await obterOfertaPublica(fixture.slug, criada.data.publicToken)
    expect(aposDespublicar.ok).toBe(true)
    if (!aposDespublicar.ok) return
    expect(aposDespublicar.data?.oferta).toBeNull()
  })

  it('oferta pode SER um grupo: lugares restantes vêm da ocupação (0025)', async () => {
    const fixture = await seedTenant('grupo')
    entrarComo(fixture)

    const ids = await withTenant(fixture.tenantId, async (tx) => {
      const [grupo] = await tx
        .insert(groups)
        .values({ tenantId: fixture.tenantId, title: 'Fátima 2027', totalSeats: 10, pricePerSeatCents: 550_000 })
        .returning({ id: groups.id })
      const [contato] = await tx
        .insert(contacts)
        .values({ tenantId: fixture.tenantId, name: 'Ana' })
        .returning({ id: contacts.id })
      const [deal] = await tx
        .insert(deals)
        .values({ tenantId: fixture.tenantId, contactId: contato!.id, title: 'Reserva da Ana' })
        .returning({ id: deals.id })
      return { grupoId: grupo!.id, contatoId: contato!.id, dealId: deal!.id }
    })

    // Ocupação direta (2 lugares) para provar a conta da função pública.
    await withTenant(fixture.tenantId, async (tx) => {
      await tx.insert(groupMembers).values({
        tenantId: fixture.tenantId,
        groupId: ids.grupoId,
        contactId: ids.contatoId,
        dealId: ids.dealId,
        seats: 2,
      })
    })

    const criada = await criarOferta({ title: 'Fátima 2027', type: 'pacote', priceCents: 550_000, groupId: ids.grupoId })
    expect(criada.ok).toBe(true)
    if (!criada.ok) return
    await publicarOferta({ id: criada.data.id, publicada: true })

    const catalogo = await obterVitrinePublica(fixture.slug)
    expect(catalogo.ok).toBe(true)
    if (!catalogo.ok) return
    const oferta = catalogo.data?.ofertas[0]
    expect(oferta?.temLugares).toBe(true)
    expect(oferta?.lugaresRestantes).toBe(8)
  })

  it('isolamento: a vitrine de um slug só mostra as ofertas dele; token de outro tenant é invisível', async () => {
    const alheia = await seedTenant('alheia')
    const dona = await seedTenant('dona')

    entrarComo(alheia)
    const ofertaAlheia = await criarOferta({ title: 'Da outra agência', type: 'servico', priceCents: 100_000 })
    expect(ofertaAlheia.ok).toBe(true)
    if (!ofertaAlheia.ok) return
    await publicarOferta({ id: ofertaAlheia.data.id, publicada: true })

    entrarComo(dona)
    const ofertaDona = await criarOferta({ title: 'Da agência dona', type: 'voo', priceCents: 200_000 })
    expect(ofertaDona.ok).toBe(true)
    if (!ofertaDona.ok) return
    await publicarOferta({ id: ofertaDona.data.id, publicada: true })

    const catalogoDona = await obterVitrinePublica(dona.slug)
    expect(catalogoDona.ok).toBe(true)
    if (!catalogoDona.ok) return
    expect(catalogoDona.data?.ofertas.map((o) => o.title)).toEqual(['Da agência dona'])

    // O token da alheia no slug da dona: a função casa slug+token — não entrega.
    const vazada = await obterOfertaPublica(dona.slug, ofertaAlheia.data.publicToken)
    expect(vazada.ok).toBe(true)
    if (!vazada.ok) return
    expect(vazada.data?.oferta).toBeNull()

    // Direto no banco, sem GUC nenhum: a oferta publicada EXISTE, mas a varredura
    // crua vê ZERO linhas — a única porta é a função DEFINER com contexto (mesma
    // disciplina de /p/ e /r/; NOBYPASSRLS não ajuda quem não tem o GUC).
    const cruzado = await unsafeSqlWithoutTenant`
      select count(*)::int as total from offers
      where public_token = ${ofertaAlheia.data.publicToken}
        and published_at is not null
    `
    expect(cruzado[0]?.total).toBe(0)
  })
})
