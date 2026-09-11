/**
 * Fit 7b — o interesse da Vitrine (`docs/FIT7_VITRINE.md`): nome + WhatsApp
 * capturados na página pública viram CLIENTE com tag `vitrine` + linha em
 * `offer_leads` (idempotente por oferta×contato). Funções REAIS contra o
 * Postgres de teste — a action NÃO tem sessão (é o visitante quem chama).
 *
 *  1. Caminho feliz: interesse numa oferta publicada → contato criado com a
 *     tag, lead na oferta, WhatsApp normalizado (só dígitos).
 *  2. Reuso: o MESMO WhatsApp não vira dois contatos — segundo interesse
 *     gruda no contato de antes (e o duplo toque não duplica o lead).
 *  3. Recusas honestas: oferta despublicada/inexistente recusa sem pista;
 *     WhatsApp inválido recusa com a correção.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { contacts, offerLeads, tenants, user } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: 'qa-lead-user',
  email: 'qa-lead@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { criarOferta, publicarOferta, registrarInteresseOferta, listarInteressadosDaOferta } =
  await import('@/server/offers')

type Fixture = { tenantId: string; userId: string; slug: string }

function entrarComo(fixture: Fixture): void {
  authCtx.tenantId = fixture.tenantId
  authCtx.userId = fixture.userId
}

async function seedTenant(prefix: string): Promise<Fixture> {
  const tenantId = randomUUID()
  const slug = `qa-lead-${prefix}-${tenantId.slice(0, 8)}`
  const userId = `qa-lead-${randomUUID()}`

  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `Agência QA Lead ${slug}`, slug })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Lead Bot',
      email: `${userId}@exemplo-zarpa.test`,
    })
  })

  return { tenantId, userId, slug }
}

afterAll(async () => {
  vi.restoreAllMocks()
})

describe('interesse da Vitrine (7b)', () => {
  it('caminho feliz: contato criado com tag vitrine, lead idempotente, WhatsApp normalizado', async () => {
    const fixture = await seedTenant('feliz')
    entrarComo(fixture)

    const oferta = await criarOferta({ title: 'Férias no Algarve', type: 'pacote', priceCents: 500_000 })
    expect(oferta.ok).toBe(true)
    if (!oferta.ok) return
    await publicarOferta({ id: oferta.data.id, publicada: true })

    const primeira = await registrarInteresseOferta({
      slug: fixture.slug,
      token: oferta.data.publicToken,
      name: 'Marina Teste',
      whatsapp: '(11) 98888-7777',
    })
    expect(primeira.ok).toBe(true)

    const contatos = await withTenant(fixture.tenantId, (tx) =>
      tx.select({ name: contacts.name, whatsapp: contacts.whatsapp, tags: contacts.tags }).from(contacts),
    )
    expect(contatos).toHaveLength(1)
    expect(contatos[0]?.name).toBe('Marina Teste')
    expect(contatos[0]?.whatsapp).toBe('(11) 98888-7777')
    expect(contatos[0]?.tags).toContain('vitrine')

    const leads = await withTenant(fixture.tenantId, (tx) =>
      tx.select({ id: offerLeads.id }).from(offerLeads),
    )
    expect(leads).toHaveLength(1)

    // Duplo toque: MESMO interesse (oferta + contato) — nada duplica.
    const repetido = await registrarInteresseOferta({
      slug: fixture.slug,
      token: oferta.data.publicToken,
      name: 'Marina Teste',
      whatsapp: '11988887777',
    })
    expect(repetido.ok).toBe(true)
    const leadsApos = await withTenant(fixture.tenantId, (tx) =>
      tx.select({ id: offerLeads.id }).from(offerLeads),
    )
    expect(leadsApos).toHaveLength(1)

    // A ficha da oferta lista o interessado (a agente vê e transforma em negócio).
    const lista = await listarInteressadosDaOferta(oferta.data.id)
    expect(lista.ok).toBe(true)
    if (!lista.ok) return
    expect(lista.data).toHaveLength(1)
    expect(lista.data[0]?.contactName).toBe('Marina Teste')
    expect(lista.data[0]?.whatsapp).toBe('11988887777')
  })

  it('WhatsApp já é cliente: REUSA o contato em vez de criar outro', async () => {
    const fixture = await seedTenant('reuso')
    entrarComo(fixture)

    // A cliente de antes, SEM a tag vitrine (veio por indicação, por exemplo).
    const [antiga] = await withTenant(fixture.tenantId, async (tx) => {
      const [c] = await tx
        .insert(contacts)
        .values({ tenantId: fixture.tenantId, name: 'Cliente Antiga', whatsapp: '11977776666' })
        .returning({ id: contacts.id })
      return [c]
    })

    const oferta = await criarOferta({ title: 'Pacote Lisboa', type: 'pacote', priceCents: 400_000 })
    expect(oferta.ok).toBe(true)
    if (!oferta.ok) return
    await publicarOferta({ id: oferta.data.id, publicada: true })

    const resultado = await registrarInteresseOferta({
      slug: fixture.slug,
      token: oferta.data.publicToken,
      name: 'Cliente Antiga',
      whatsapp: '+55 11 97777-6666',
    })
    expect(resultado.ok).toBe(true)

    const contatos = await withTenant(fixture.tenantId, (tx) =>
      tx.select({ id: contacts.id, name: contacts.name, tags: contacts.tags }).from(contacts),
    )
    // UM contato só — e ganhou a tag da vitrine.
    expect(contatos).toHaveLength(1)
    expect(contatos[0]?.id).toBe(antiga!.id)
    expect(contatos[0]?.tags).toContain('vitrine')

    const leads = await withTenant(fixture.tenantId, (tx) =>
      tx.select({ contactId: offerLeads.contactId }).from(offerLeads),
    )
    expect(leads).toHaveLength(1)
    expect(leads[0]?.contactId).toBe(antiga!.id)
  })

  it('REGRESSÃO do bug do PO: o mesmo número com e sem `+55` NÃO vira dois cadastros', async () => {
    const fixture = await seedTenant('regressao')
    entrarComo(fixture)

    const oferta = await criarOferta({ title: 'Pacote Dubái', type: 'pacote', priceCents: 700_000 })
    expect(oferta.ok).toBe(true)
    if (!oferta.ok) return
    await publicarOferta({ id: oferta.data.id, publicada: true })

    // Primeira captura com código do país; segunda sem — mesmo número.
    const primeira = await registrarInteresseOferta({
      slug: fixture.slug,
      token: oferta.data.publicToken,
      name: 'João Cruz',
      whatsapp: '+55 11 98888-7777',
    })
    expect(primeira.ok).toBe(true)
    const segunda = await registrarInteresseOferta({
      slug: fixture.slug,
      token: oferta.data.publicToken,
      name: 'João Cruz',
      whatsapp: '11 98888-7777',
    })
    expect(segunda.ok).toBe(true)

    const contatos = await withTenant(fixture.tenantId, (tx) =>
      tx.select({ id: contacts.id, name: contacts.name, whatsapp: contacts.whatsapp }).from(contacts),
    )
    expect(contatos).toHaveLength(1)
    const leads = await withTenant(fixture.tenantId, (tx) =>
      tx.select({ id: offerLeads.id }).from(offerLeads),
    )
    expect(leads).toHaveLength(1)
  })

  it('recusas: oferta despublicada, WhatsApp inválido — e o lead de outra agência não vaza', async () => {
    const fixture = await seedTenant('recusa')
    entrarComo(fixture)

    const oferta = await criarOferta({ title: 'Rascunho secreto', type: 'pacote', priceCents: 100_000 })
    expect(oferta.ok).toBe(true)
    if (!oferta.ok) return

    // Despublicada: recusa genérica, sem pista do motivo.
    const recusada = await registrarInteresseOferta({
      slug: fixture.slug,
      token: oferta.data.publicToken,
      name: 'Curioso',
      whatsapp: '11988887777',
    })
    expect(recusada.ok).toBe(false)
    if (!recusada.ok) {
      expect(recusada.mensagem).toContain('não está mais disponível')
    }

    // WhatsApp que não abre conversa: recusa com a correção.
    await publicarOferta({ id: oferta.data.id, publicada: true })
    const telefoneRuim = await registrarInteresseOferta({
      slug: fixture.slug,
      token: oferta.data.publicToken,
      name: 'Desatento',
      whatsapp: '123',
    })
    expect(telefoneRuim.ok).toBe(false)
    if (!telefoneRuim.ok) {
      expect(telefoneRuim.mensagem).toContain('confira o número')
    }

    // NADA foi gravado nas duas recusas.
    const contatos = await withTenant(fixture.tenantId, (tx) =>
      tx.select({ id: contacts.id }).from(contacts),
    )
    expect(contatos).toHaveLength(0)
    const leads = await withTenant(fixture.tenantId, (tx) =>
      tx.select({ id: offerLeads.id }).from(offerLeads),
    )
    expect(leads).toHaveLength(0)

    // O token da oferta da casa usado no slug de OUTRA agência: a função casa
    // os dois — não entrega e não grava.
    const alheia = await seedTenant('alheia')
    entrarComo(alheia)
    const ofertaAlheia = await criarOferta({ title: 'Da outra', type: 'voo', priceCents: 100_000 })
    expect(ofertaAlheia.ok).toBe(true)
    if (!ofertaAlheia.ok) return
    await publicarOferta({ id: ofertaAlheia.data.id, publicada: true })

    entrarComo(fixture)
    const cruzado = await registrarInteresseOferta({
      slug: fixture.slug,
      token: ofertaAlheia.data.publicToken,
      name: 'Teste Cruzado',
      whatsapp: '11988887777',
    })
    expect(cruzado.ok).toBe(false)
  })
})
