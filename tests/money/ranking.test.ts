/**
 * `rankingDeClientes` (fase 2 do roadmap) — o essencial: SOMA por cliente e ORDEM
 * (total desc), sobre vendas de negócio ganho no período, SEM vazamento do vizinho.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { contacts, deals, proposals, sales, tenants, user } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: '',
  email: 'qa-ranking@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { rankingDeClientes } = await import('@/server/ranking')

const tenantIds: string[] = []

async function apagar(tenantId: string): Promise<void> {
  try {
    await withTenant(tenantId, async (tx) => {
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

/** Semeia no tenant `qtd[cliente]` vendas do mês corrente (ganho). */
async function seedTenant(compras: Record<string, number[]>): Promise<string> {
  const tenantId = randomUUID()
  const tag = `qa-rank-${tenantId.slice(0, 8)}`
  const userId = `qa-rank-${randomUUID()}`

  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `Agência ${tag}`, slug: tag })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Ranking Bot',
      email: `${userId}@exemplo-zarpa.test`,
    })

    for (const [cliente, valores] of Object.entries(compras)) {
      const [contato] = await tx
        .insert(contacts)
        .values({ tenantId, name: cliente })
        .returning({ id: contacts.id })
      for (const valor of valores) {
        const [deal] = await tx
          .insert(deals)
          .values({
            tenantId,
            contactId: contato!.id,
            title: `Viagem de ${cliente} — ${valor}`,
            currency: 'BRL',
            stage: 'ganho',
            valueCents: valor,
            closedAt: new Date(),
          })
          .returning({ id: deals.id })
        const [proposta] = await tx
          .insert(proposals)
          .values({
            tenantId,
            dealId: deal!.id,
            publicToken: randomUUID(),
            title: `Proposta de ${cliente}`,
          })
          .returning({ id: proposals.id })
        await tx.insert(sales).values({
          tenantId,
          dealId: deal!.id,
          proposalId: proposta!.id,
          valorBrutoCents: valor,
          comissaoPrevistaCents: 0,
        })
      }
    }
  })

  tenantIds.push(tenantId)
  return tenantId
}

describe('rankingDeClientes', () => {
  it('ordena por total comprado, conta viagens distintas e não vê o vizinho', async () => {
    const tenantA = await seedTenant({ 'Ana': [600_000, 400_000], 'Bruno': [900_000] })
    const tenantB = await seedTenant({ 'Vizinho Rico': [9_999_000] })
    authCtx.tenantId = tenantA
    authCtx.userId = `qa-rank-${randomUUID()}`

    const resultado = await rankingDeClientes()
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)
    if (!resultado.ok) return

    // Ana soma as DUAS viagens; Bruno tem uma maior, mas total menor. O vizinho
    // comprou mais que todos — e NEM APARECE (RLS).
    expect(resultado.data).toHaveLength(2)
    expect(resultado.data[0]).toMatchObject({ nome: 'Ana', totalCompradoCents: 1_000_000, viagens: 2 })
    expect(resultado.data[1]).toMatchObject({ nome: 'Bruno', totalCompradoCents: 900_000, viagens: 1 })
    expect(resultado.data.map((l) => l.nome)).not.toContain('Vizinho Rico')
    void tenantB
  })
})
