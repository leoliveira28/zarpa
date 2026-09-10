/**
 * 0021 — furo da nina: `obterHistoricoDoContato` (`src/server/contacts.ts`) cruzava só
 * `deals.contact_id`, então a viagem do CASAL não aparecia no histórico do 2º cliente —
 * ficha 360° incompleta para o secundário. O conserto: titular (`deals.contact_id`) OU
 * lista (`deal_contacts`) nas três queries (negócios, propostas, roteiros).
 *
 * Mesmo padrão de `tests/deals/clientes.test.ts`: função REAL contra o Postgres de teste,
 * só `requireAuthContext` mockado. Cobre o que a mudança promete e o que ela NÃO pode
 * fazer:
 *
 *  1. O secundário vê a viagem do casal — negócio, proposta, roteiro e os totais
 *     (comprado/comissão/viagens) incluem o negócio inteiro, SEM rateio (decisão
 *     documentada na própria função: a ficha responde "o que este cliente já fez com a
 *     agência").
 *  2. O titular continua vendo TUDO dele, inclusive os negócios em que é só titular.
 *  3. Quem não participa do negócio não vê nada — a lista não vira alargamento de escopo.
 *  4. Isolamento: contato de outro tenant = histórico vazio (a policy esconde; a função
 *     não confirma existência de recurso alheio).
 *
 * O RLS de `deal_contacts` e o vazamento nas páginas públicas estão em
 * `tests/security/deal-contacts-rls.test.ts` — aqui é a CAMADA DE SERVIÇO.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { contacts, dealContacts, deals, itineraries, proposals, tenants, user } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: 'qa-historico-user',
  email: 'qa-historico@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { obterHistoricoDoContato } = await import('@/server/contacts')

// ---------------------------------------------------------------------------
// Fixture — um tenant com o CASAL (deal ganho) e um terceiro de fora
// ---------------------------------------------------------------------------

/** `AAAA-MM-DD` relativo a hoje — o histórico classifica por data, então nada fixo. */
function diaRelativo(dias: number): string {
  return new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10)
}

type Fixture = {
  tenantId: string
  userId: string
  anaId: string
  carlosId: string
  beatrizId: string
  dealCasalId: string
  dealSoloId: string
  propostaCasalId: string
  propostaSoloId: string
}

async function seedCenario(): Promise<Fixture> {
  const tenantId = randomUUID()
  const userId = `qa-historico-${randomUUID()}`

  return withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: 'Agência QA Histórico',
      slug: `qa-historico-${tenantId.slice(0, 8)}`,
    })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Histórico Bot',
      email: `${userId}@exemplo-zarpa.com.br`,
    })

    // Sem e-mail de propósito: (tenant_id, lower(email)) é unique e nulos não disputam.
    const contatos = await tx
      .insert(contacts)
      .values([
        { tenantId, name: 'Ana do Casal QA' },
        { tenantId, name: 'Carlos do Casal QA' },
        { tenantId, name: 'Beatriz de Fora QA' },
      ])
      .returning({ id: contacts.id })
    const [anaId, carlosId, beatrizId] = contatos.map((c) => c.id)

    // A VIAGEM DO CASAL: ganho, com dinheiro e data futura — é ela que tem de aparecer
    // para os DOIS. `stage` basta: o trigger `deals_estagio_sync` semeia o funil e
    // resolve o `stage_id` (mesmo desenho de `tests/helpers/roteiro.ts`).
    const [dealCasal] = await tx
      .insert(deals)
      .values({
        tenantId,
        contactId: anaId!,
        title: 'Aniversário em Bariloche QA',
        stage: 'ganho',
        valueCents: 500_000,
        commissionCents: 100_000,
        departureOn: diaRelativo(10),
        returnOn: diaRelativo(20),
        closedAt: new Date(),
      })
      .returning({ id: deals.id })

    // Negócio SOLO da Ana — o titular continua vendo tudo dele.
    const [dealSolo] = await tx
      .insert(deals)
      .values({
        tenantId,
        contactId: anaId!,
        title: 'Escape de Lisboa QA',
        stage: 'ganho',
        valueCents: 200_000,
        commissionCents: 30_000,
        departureOn: diaRelativo(-30),
        returnOn: diaRelativo(-10),
        closedAt: new Date(),
      })
      .returning({ id: deals.id })

    // A composição: Ana titular, Carlos secundário — mesma ordem do `gerarRoteiro`
    // (created_at explícito para a ordem não depender do relógio).
    await tx.insert(dealContacts).values([
      { tenantId, dealId: dealCasal!.id, contactId: anaId!, principal: true, createdAt: new Date(Date.now() - 86_400_000) },
      { tenantId, dealId: dealCasal!.id, contactId: carlosId!, principal: false, createdAt: new Date() },
    ])

    const [propostaCasal] = await tx
      .insert(proposals)
      .values({
        tenantId,
        dealId: dealCasal!.id,
        publicToken: randomUUID(),
        title: 'Proposta de Bariloche QA',
        status: 'sent',
        sentAt: new Date(),
      })
      .returning({ id: proposals.id })

    const [propostaSolo] = await tx
      .insert(proposals)
      .values({
        tenantId,
        dealId: dealSolo!.id,
        publicToken: randomUUID(),
        title: 'Proposta de Lisboa QA',
        status: 'sent',
        sentAt: new Date(),
      })
      .returning({ id: proposals.id })

    // Roteiro da viagem do casal — com a lista congelada (0021).
    await tx.insert(itineraries).values({
      tenantId,
      dealId: dealCasal!.id,
      proposalId: propostaCasal!.id,
      publicToken: randomUUID(),
      title: 'Roteiro de Bariloche QA',
      clientName: 'Ana do Casal QA',
      clientes: ['Ana do Casal QA', 'Carlos do Casal QA'],
    })

    return {
      tenantId,
      userId,
      anaId: anaId!,
      carlosId: carlosId!,
      beatrizId: beatrizId!,
      dealCasalId: dealCasal!.id,
      dealSoloId: dealSolo!.id,
      propostaCasalId: propostaCasal!.id,
      propostaSoloId: propostaSolo!.id,
    }
  })
}

const criados: string[] = []
let fixture: Fixture | null = null

beforeAll(async () => {
  // O cenário inteiro nasce uma vez — os quatro testes leem o MESMO estado, cada um pela
  // lente de um contato (secundário, titular, de fora, de outro tenant).
  fixture = await seedCenario()
  criados.push(fixture.tenantId)
})

afterAll(async () => {
  // Limpeza: `itineraries`/`proposals` têm RESTRICT para deals — roteiros primeiro
  // (mesma ordem de `tests/helpers/roteiro.ts`); o CASCADE leva deal_contacts.
  if (fixture) {
    try {
      await withTenant(fixture.tenantId, async (tx) => {
        await tx.delete(itineraries).where(eq(itineraries.tenantId, fixture!.tenantId))
        await tx.delete(proposals).where(eq(proposals.tenantId, fixture!.tenantId))
        await tx.delete(deals).where(eq(deals.tenantId, fixture!.tenantId))
        await tx.delete(contacts).where(eq(contacts.tenantId, fixture!.tenantId))
        await tx.delete(user).where(eq(user.tenantId, fixture!.tenantId))
      })
    } catch {
      // best-effort
    }
  }
  for (const tenantId of criados) {
    try {
      await withTenant(tenantId, (tx) => tx.delete(tenants).where(eq(tenants.id, tenantId)))
    } catch {
      // best-effort
    }
  }
})

// ---------------------------------------------------------------------------
// 1) O secundário vê a viagem do casal — o furo que a nina apontou
// ---------------------------------------------------------------------------

describe('obterHistoricoDoContato — o 2º cliente do casal tem ficha 360° completa', () => {
  it('Carlos (secundário) vê o negócio, a proposta, o roteiro e os totais do casal', async () => {
    authCtx.tenantId = fixture!.tenantId

    const historico = await obterHistoricoDoContato(fixture!.carlosId)
    expect(historico.ok, !historico.ok ? historico.mensagem : '').toBe(true)
    if (!historico.ok) return

    // O negócio do casal é DELE também — mesmo sem ser o `deals.contact_id`.
    expect(historico.data.negocios.map((n) => n.id)).toEqual([fixture!.dealCasalId])

    // Totais SEM rateio: o valor inteiro do negócio entra na ficha de cada cliente.
    expect(historico.data.totalCompradoCents).toBe(500_000)
    expect(historico.data.comissaoGanhaCents).toBe(100_000)
    expect(historico.data.totalViagens).toBe(1)
    expect(historico.data.proximaViagem?.dealId).toBe(fixture!.dealCasalId)

    // A proposta e o roteiro da viagem do casal também são dele.
    expect(historico.data.propostas.map((p) => p.id)).toEqual([fixture!.propostaCasalId])
    expect(historico.data.propostaAberta?.id).toBe(fixture!.propostaCasalId)
    expect(historico.data.roteiros).toHaveLength(1)
  })

  it('a Ana (titular) continua vendo TUDO dela: o casal E o negócio solo', async () => {
    authCtx.tenantId = fixture!.tenantId

    const historico = await obterHistoricoDoContato(fixture!.anaId)
    expect(historico.ok).toBe(true)
    if (!historico.ok) return

    expect(historico.data.negocios).toHaveLength(2)
    expect(historico.data.negocios.map((n) => n.id).sort()).toEqual(
      [fixture!.dealCasalId, fixture!.dealSoloId].sort(),
    )
    // Sem duplicar: o casal entra UMA vez, não uma por caminho (titular + lista).
    expect(historico.data.totalCompradoCents).toBe(700_000)
    expect(historico.data.comissaoGanhaCents).toBe(130_000)
    expect(historico.data.propostas.map((p) => p.id).sort()).toEqual(
      [fixture!.propostaCasalId, fixture!.propostaSoloId].sort(),
    )
  })

  it('quem não participa do negócio não vê nada — a lista não alarga o escopo', async () => {
    authCtx.tenantId = fixture!.tenantId

    const historico = await obterHistoricoDoContato(fixture!.beatrizId)
    expect(historico.ok).toBe(true)
    if (!historico.ok) return

    expect(historico.data.negocios).toEqual([])
    expect(historico.data.propostas).toEqual([])
    expect(historico.data.roteiros).toEqual([])
    expect(historico.data.totalCompradoCents).toBe(0)
    expect(historico.data.proximaViagem).toBeNull()
    expect(historico.data.propostaAberta).toBeNull()
  })

  it('contato de outro tenant = histórico vazio (a policy esconde a linha inteira)', async () => {
    const outroTenant = randomUUID()
    criados.push(outroTenant)
    await withTenant(outroTenant, async (tx) => {
      await tx.insert(tenants).values({
        id: outroTenant,
        name: 'Agência QA Histórico B',
        slug: `qa-historico-b-${outroTenant.slice(0, 8)}`,
      })
      const [c] = await tx
        .insert(contacts)
        .values({ tenantId: outroTenant, name: 'Contato de B QA' })
        .returning({ id: contacts.id })

      authCtx.tenantId = fixture!.tenantId
      const historico = await obterHistoricoDoContato(c!.id)
      expect(historico.ok).toBe(true)
      if (historico.ok) {
        expect(historico.data.negocios).toEqual([])
        expect(historico.data.propostas).toEqual([])
        expect(historico.data.roteiros).toEqual([])
      }
    })
  })
})
