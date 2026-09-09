/**
 * `resultadoDaViagem` (fase 2 do roadmap) — o essencial: números certos com VENDA
 * lançada (fonte 1 da cascata) e recusa de negócio ABERTO com a correção.
 * Real contra o Postgres, sessão mockada (padrão de tests/money/resumo.test.ts).
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  contacts,
  deals,
  proposals,
  receivables,
  sales,
  tenants,
  user,
} from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: '',
  email: 'qa-resultado@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { resultadoDaViagem } = await import('@/server/resultado')

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

type Fixtures = { dealId: string; dealAbertoId: string }

/** Um negócio GANHO com venda lançada (R$ 5.000, custo 3.200, comissão 900) + parcelas
 *  (1 paga de R$ 2.000, 1 pendente de R$ 3.000), e um negócio aberto ao lado. */
async function seed(): Promise<Fixtures> {
  const tenantId = randomUUID()
  const tag = `qa-res-${tenantId.slice(0, 8)}`
  const userId = `qa-res-${randomUUID()}`

  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `Agência ${tag}`, slug: tag })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Resultado Bot',
      email: `${userId}@exemplo-zarpa.test`,
    })
    const [contato] = await tx
      .insert(contacts)
      .values({ tenantId, name: 'Cliente Resultado' })
      .returning({ id: contacts.id })

    const [ganho] = await tx
      .insert(deals)
      .values({
        tenantId,
        contactId: contato!.id,
        title: 'Portugal em maio',
        destination: 'Lisboa',
        currency: 'BRL',
        stage: 'ganho',
        valueCents: 1,
        closedAt: new Date(),
      })
      .returning({ id: deals.id })
    const [aberto] = await tx
      .insert(deals)
      .values({
        tenantId,
        contactId: contato!.id,
        title: 'Chile cotando',
        currency: 'BRL',
        stage: 'cotando',
        valueCents: 999_000,
      })
      .returning({ id: deals.id })
    const [proposta] = await tx
      .insert(proposals)
      .values({
        tenantId,
        dealId: ganho!.id,
        publicToken: randomUUID(),
        title: 'Proposta — Lisboa',
      })
      .returning({ id: proposals.id })
    const [venda] = await tx
      .insert(sales)
      .values({
        tenantId,
        dealId: ganho!.id,
        proposalId: proposta!.id,
        valorBrutoCents: 500_000,
        custoCents: 320_000,
        comissaoPrevistaCents: 90_000,
        comissaoStatus: 'prevista',
      })
      .returning({ id: sales.id })
    await tx.insert(receivables).values([
      {
        tenantId,
        saleId: venda!.id,
        venceEm: '2026-09-10',
        valorCents: 200_000,
        status: 'pago',
        pagoEm: new Date('2026-09-08T12:00:00Z'),
      },
      {
        tenantId,
        saleId: venda!.id,
        venceEm: '2026-10-10',
        valorCents: 300_000,
        status: 'pendente',
      },
    ])
  })

  tenantIds.push(tenantId)
  authCtx.tenantId = tenantId
  authCtx.userId = userId

  return withTenant(tenantId, async (tx) => {
    const ganhos = await tx
      .select({ id: deals.id, stage: deals.stage })
      .from(deals)
      .orderBy(deals.title)
    const ganho = ganhos.find((d) => d.stage === 'ganho')!
    const aberto = ganhos.find((d) => d.stage === 'cotando')!
    return { dealId: ganho.id, dealAbertoId: aberto.id }
  })
}

describe('resultadoDaViagem', () => {
  it('devolve previsto e realizado da venda — margem, recebido e a receber', async () => {
    const { dealId } = await seed()

    const resultado = await resultadoDaViagem(dealId)
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)
    if (!resultado.ok) return

    expect(resultado.data.valorVendaCents).toBe(500_000)
    expect(resultado.data.custoPrevistoCents).toBe(320_000)
    expect(resultado.data.comissaoPrevistaCents).toBe(90_000)
    // margemPrevista = valorVenda − custoPrevisto
    expect(resultado.data.margemPrevistaCents).toBe(180_000)
    expect(resultado.data.recebidoCents).toBe(200_000)
    expect(resultado.data.aReceberCents).toBe(300_000)
    expect(resultado.data.currency).toBe('BRL')
    expect(resultado.data.saleId).not.toBeNull()
    expect(resultado.data.comissaoStatus).toBe('prevista')
  })

  it('recusa negócio aberto com a correção — resultado de viagem não fechada é adivinhação', async () => {
    const { dealAbertoId } = await seed()

    const resultado = await resultadoDaViagem(dealAbertoId)
    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.code).toBe('CONFLITO')
    expect(resultado.correcao).toContain('Fechada')
  })
})
