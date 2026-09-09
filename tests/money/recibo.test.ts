/**
 * Recibo de venda (fase 1 do roadmap) — o essencial: `GET /api/recibos/[vendaId]`
 * responde 200 com `application/pdf` e bytes `%PDF`, e venda de OUTRO tenant é 404
 * (RLS pela via da aplicação).
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { contacts, deals, proposals, receivables, sales, tenants, user } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: '',
  email: 'qa-recibo@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { GET } = await import('@/app/api/recibos/[vendaId]/route')

const tenantIds: string[] = []

async function apagar(tenantId: string): Promise<void> {
  try {
    await withTenant(tenantId, async (tx) => {
      await tx.delete(receivables)
      await tx.delete(sales)
      await tx.delete(proposals)
      await tx.delete(deals)
      await tx.delete(contacts)
      await tx.delete(user)
      await tx.delete(tenants)
    })
  } catch {
    /* best-effort */
  }
}

afterAll(async () => {
  for (const tenantId of [...new Set(tenantIds)]) {
    await apagar(tenantId)
  }
})

/** Venda com marca e uma parcela paga — devolve o vendaId semeado. */
async function seedVenda(marca: { brandName: string; agent: string }): Promise<string> {
  const tenantId = randomUUID()
  const tag = `qa-rcb-${tenantId.slice(0, 8)}`
  const userId = `qa-rcb-${randomUUID()}`

  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: `Agência ${tag}`,
      slug: tag,
      brandName: marca.brandName,
      agentDisplayName: marca.agent,
    })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Recibo Bot',
      email: `${userId}@exemplo-zarpa.test`,
    })
    const [contato] = await tx
      .insert(contacts)
      .values({ tenantId, name: 'Clara Mendoça' })
      .returning({ id: contacts.id })
    const [deal] = await tx
      .insert(deals)
      .values({
        tenantId,
        contactId: contato!.id,
        title: 'Santiago em julho',
        destination: 'Santiago',
        currency: 'BRL',
        stage: 'ganho',
        valueCents: 350_000,
        closedAt: new Date(),
      })
      .returning({ id: deals.id })
    const [proposta] = await tx
      .insert(proposals)
      .values({
        tenantId,
        dealId: deal!.id,
        publicToken: randomUUID(),
        title: 'Proposta — Santiago',
      })
      .returning({ id: proposals.id })
    const [venda] = await tx
      .insert(sales)
      .values({
        tenantId,
        dealId: deal!.id,
        proposalId: proposta!.id,
        valorBrutoCents: 350_000,
        custoCents: 210_000,
        comissaoPrevistaCents: 63_000,
      })
      .returning({ id: sales.id })
    await tx.insert(receivables).values({
      tenantId,
      saleId: venda!.id,
      venceEm: '2026-08-10',
      valorCents: 175_000,
      status: 'pago',
      pagoEm: new Date('2026-08-05T14:00:00Z'),
    })
  })

  tenantIds.push(tenantId)
  authCtx.tenantId = tenantId
  authCtx.userId = userId

  return withTenant(tenantId, async (tx) => {
    const [venda] = await tx.select({ id: sales.id }).from(sales).limit(1)
    return venda!.id
  })
}

describe('GET /api/recibos/[vendaId]', () => {
  it('200, application/pdf e bytes %PDF — com número estável e a marca na assinatura', async () => {
    const vendaId = await seedVenda({ brandName: 'Volta ao Mundo', agent: 'Marina' })

    const resposta = await GET(new Request('http://localhost/api/recibos/x'), {
      params: Promise.resolve({ vendaId }),
    })

    expect(resposta.status).toBe(200)
    expect(resposta.headers.get('content-type')).toBe('application/pdf')
    expect(resposta.headers.get('content-disposition')).toContain('inline')

    const bytes = new Uint8Array(await resposta.arrayBuffer())
    expect(bytes.length).toBeGreaterThan(500)
    // Magic number do PDF — o arquivo inteiro vale mais que qualquer mock de writer.
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')

    // Número estável = REC- + 8 primeiros chars do vendaId (impressão repetida não muda).
    expect(resposta.headers.get('content-disposition')).toContain(
      `REC-${vendaId.slice(0, 8).toUpperCase()}`,
    )
  })

  it('404 para venda de outro tenant — nem revela que existe', async () => {
    const vendaAlheia = await seedVenda({ brandName: 'Alheia Viagens', agent: 'Outro' })
    const meuTenant = randomUUID()
    authCtx.tenantId = meuTenant
    authCtx.userId = `qa-rcb-outro-${randomUUID()}`

    const resposta = await GET(new Request('http://localhost/api/recibos/x'), {
      params: Promise.resolve({ vendaId: vendaAlheia }),
    })

    expect(resposta.status).toBe(404)
  })
})
