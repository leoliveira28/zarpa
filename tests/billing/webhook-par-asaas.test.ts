/**
 * Fase 3 (§6) — idempotência do PAR de eventos do Asaas na troca de assentos.
 *
 * O Asaas não tem endpoint para mudar o valor de uma assinatura ativa, então
 * `alterarAssentos` (src/server/billing.ts) faz cancelar+recriar. O risco do par era
 * o webhook: o DELETE da assinatura antiga gera SUBSCRIPTION_CANCELED(old_id), e um
 * handler ingênuo trataria isso como PERDA DE CLIENTE — cancelaria a conta e dispararia
 * o gate de inadimplência no meio de uma operação que o próprio dono pediu.
 *
 * A defesa é ORDEM, não filtro de evento: POST da nova → swap local da MESMA linha
 * (mesmo id de PK, novo asaas_subscription_id) COMMITADO → só então DELETE da antiga.
 * Como o próprio request de DELETE é o que causa o webhook, o evento chega quando a
 * linha local JÁ aponta para a nova — a busca por `asaasSubscriptionId` não encontra o
 * id antigo e o evento é inerte POR CONSTRUÇÃO.
 *
 * Este arquivo prova a ordem de verdade, com o cliente Asaas mockado (não existe
 * credencial ainda) mas o BANCO e as actions REAIS:
 *  1. No instante em que o DELETE da antiga dispara, a linha local (lida por OUTRA
 *     conexão, a mesma visão do webhook) já aponta para a nova — swap commitado antes.
 *  2. SUBSCRIPTION_CANCELED(old_id) → `processado: false` ("assinatura não encontrada"),
 *     a assinatura continua `active` com o id novo, e `exigirContaAtiva` segue PASSANDO
 *     (o gate de dunning não disparou no meio do par).
 *  3. Replay do mesmo evento → mesmo resultado (idempotente, sem efeito acumulado).
 *  4. Churn REAL — SUBSCRIPTION_CANCELED do id ATUAL — cancela de verdade, e aí o gate
 *     passa a recusar escrita (comportamento de dunning intacto para o caso genuíno).
 *  5. O valor recriado é o da régua: base do plano + assentos extras × R$ 39,90, com o
 *     `nextDueDate` PRESERVADO (o que impede cobrança dupla no mesmo ciclo).
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { subscriptions, tenants, user } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'

// ---------------------------------------------------------------------------
// Gravador do cliente Asaas mockado — a parte EXTERNA do par. Tudo mais (banco,
// actions, webhook) é código real.
// ---------------------------------------------------------------------------

const NEXT_DUE_PRESERVADA = '2026-10-05'

const asaasState = vi.hoisted(() => ({
  tenantId: '',
  /** O id que o "Asaas" devolveu na última criação — único por criação, como no real
   * (o índice `subscriptions_asaas_subscription_key` é único GLOBAL: ids repetidos
   * colidem entre tenants de teste, o que no Asaas verdadeiro não acontece). */
  novaId: '',
  criadas: [] as { customerId: string; value: number; billingType: string; nextDueDate?: string }[],
  canceladas: [] as string[],
  /** O que a linha apontava numa OUTRA conexão no instante de cada DELETE. */
  apontamentoNoMomentoDoCancelamento: [] as (string | null)[],
}))

vi.mock('@/lib/asaas/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/asaas/client')>()
  return {
    ...actual,
    asaasConfigurado: () => true,
    obterAssinaturaAsaas: async (id: string) => ({
      id,
      value: 99,
      status: 'ACTIVE',
      nextDueDate: NEXT_DUE_PRESERVADA,
    }),
    criarAssinaturaAsaas: async (input: {
      customerId: string
      value: number
      billingType: string
      nextDueDate?: string
    }) => {
      asaasState.criadas.push(input)
      asaasState.novaId = `sub-qa-nova-${crypto.randomUUID()}`
      return { asaasSubscriptionId: asaasState.novaId }
    },
    cancelarAssinaturaAsaas: async (id: string) => {
      // A prova da ordem: no instante do DELETE, uma conexão EXTERNA (o mesmo ponto de
      // vista do webhook) lê a linha. Se o swap ainda não estivesse commitado, veria o
      // id antigo — e o webhook chegaria antes do commit (a corrida que o §6 proíbe).
      const { withTenant: ctx } = await import('@/lib/tenant/withTenant')
      const { subscriptions: subs } = await import('@/db/schema')
      const { eq: eqFn } = await import('drizzle-orm')
      const [linha] = await ctx(asaasState.tenantId, (tx) =>
        tx
          .select({ aponta: subs.asaasSubscriptionId })
          .from(subs)
          .where(eqFn(subs.tenantId, asaasState.tenantId))
          .limit(1),
      )
      asaasState.canceladas.push(id)
      asaasState.apontamentoNoMomentoDoCancelamento.push(linha?.aponta ?? null)
    },
  }
})

// Mock de sessão — mesmo padrão de tests/billing/cobranca.test.ts.
const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: 'qa-par-user',
  email: 'qa-par@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { alterarAssentos, processarWebhookAsaas } = await import('@/server/billing')
const { exigirContaAtiva } = await import('@/server/subscriptionGate')
const { unsafeDbWithoutTenant } = await import('@/db/client')
const { plans } = await import('@/db/schema')

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

async function planoIdPorSlug(slug: 'solo' | 'pro' | 'studio'): Promise<string> {
  const [plano] = await unsafeDbWithoutTenant
    .select({ id: plans.id })
    .from(plans)
    .where(eq(plans.slug, slug))
    .limit(1)
  if (!plano) throw new Error(`plano ${slug} não existe — a migration 0009 rodou?`)
  return plano.id
}

async function seedAssinaturaPro(): Promise<{ tenantId: string; subAntiga: string }> {
  const tenantId = randomUUID()
  const userId = `qa-par-${randomUUID()}`
  // Ids de assinatura únicos por fixture: o índice `subscriptions_asaas_subscription_key`
  // é único GLOBAL no banco (no Asaas real ids também são globalmente únicos).
  const subAntiga = `sub-qa-antiga-${randomUUID()}`
  asaasState.tenantId = tenantId
  authCtx.tenantId = tenantId
  authCtx.userId = userId

  const planId = await planoIdPorSlug('pro')
  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: `Agência QA Par ${tenantId.slice(0, 8)}`,
      slug: `qa-par-${tenantId.slice(0, 8)}`,
    })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Par Bot',
      email: `${userId}@exemplo-zarpa.com.br`,
    })
    await tx.insert(subscriptions).values({
      tenantId,
      planId,
      plan: 'pro',
      status: 'active',
      billingCycle: 'monthly',
      amountCents: 9900,
      seatsPaid: 1,
      asaasSubscriptionId: subAntiga,
      asaasCustomerId: 'cust-qa-par',
      currentPeriodStart: '2026-09-05',
      currentPeriodEnd: '2026-10-05',
    })
  })
  return { tenantId, subAntiga }
}

const criados: string[] = []

afterAll(async () => {
  for (const tenantId of criados) {
    try {
      await withTenant(tenantId, (tx) => tx.delete(tenants).where(eq(tenants.id, tenantId)))
    } catch {
      // best-effort
    }
  }
})

async function lerAssinatura(tenantId: string) {
  const [linha] = await withTenant(tenantId, (tx) =>
    tx
      .select({
        asaasSubscriptionId: subscriptions.asaasSubscriptionId,
        status: subscriptions.status,
        seatsPaid: subscriptions.seatsPaid,
        amountCents: subscriptions.amountCents,
      })
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId))
      .limit(1),
  )
  return linha!
}

// ---------------------------------------------------------------------------
// O par — ordem, evento inerte, replay e churn real
// ---------------------------------------------------------------------------

describe('par cancelar+recriar da troca de assentos — o webhook do id antigo é inerte', () => {
  it('swap commitado ANTES do DELETE; assinatura segue ativa no id novo; valor e ciclo certos', async () => {
    const { tenantId, subAntiga } = await seedAssinaturaPro()
    criados.push(tenantId)

    // Pro R$ 99,00 + (3 − 1) assentos × R$ 39,90 = R$ 178,80. A régua única (§2/§6).
    const VALOR_ESPERADO_CENTS = 9900 + 2 * 3990

    const r = await alterarAssentos({ assentos: 3 })
    expect(r.ok, !r.ok ? r.mensagem : '').toBe(true)

    // (1) A NOVA assinatura nasceu com o valor total e o CICLO PRESERVADO — o
    // nextDueDate veio da leitura no Asaas, não de hoje (cobrança dupla é o bug §6).
    expect(asaasState.criadas).toHaveLength(1)
    expect(asaasState.criadas[0]).toMatchObject({
      customerId: 'cust-qa-par',
      value: VALOR_ESPERADO_CENTS / 100,
      billingType: 'PIX',
      nextDueDate: NEXT_DUE_PRESERVADA,
    })

    // (2) A ordem é a tese: no instante do DELETE da antiga, outra conexão já vê a
    // linha apontando para a nova — swap commitado, webhook chega tarde demais.
    expect(asaasState.canceladas).toEqual([subAntiga])
    expect(asaasState.apontamentoNoMomentoDoCancelamento).toEqual([asaasState.novaId])

    // (3) O estado local é o desejado: MESMA linha (não segunda assinatura), id novo,
    // ativa, com assentos e valor gravados.
    const linha = await lerAssinatura(tenantId)
    expect(linha.asaasSubscriptionId).toBe(asaasState.novaId)
    expect(linha.status).toBe('active')
    expect(linha.seatsPaid).toBe(3)
    expect(linha.amountCents).toBe(VALOR_ESPERADO_CENTS)

    // E o r.devolveu para a tela reflete o mesmo.
    if (r.ok) {
      expect(r.data.asaasSubscriptionId).toBe(asaasState.novaId)
      expect(r.data.seatsPaid).toBe(3)
    }
  })

  it('SUBSCRIPTION_CANCELED do id ANTIGO é inerte — conta ativa e gate de dunning NÃO dispara', async () => {
    const { tenantId, subAntiga } = await seedAssinaturaPro()
    criados.push(tenantId)
    await alterarAssentos({ assentos: 2 })

    // O evento que o DELETE da antiga causa — chegando DEPOIS do swap (a ordem real).
    const r = await processarWebhookAsaas({
      event: 'SUBSCRIPTION_CANCELED',
      subscription: { id: subAntiga, status: 'CANCELED' },
    })
    expect(r.processado, `motivo devolvido: "${r.motivo}"`).toBe(false)
    expect(r.motivo).toMatch(/não encontrada/i)

    // NADA mudou: ativa, id novo, 2 assentos. Este é o "não perde o cliente no meio do par".
    const linha = await lerAssinatura(tenantId)
    expect(linha.status).toBe('active')
    expect(linha.asaasSubscriptionId).toBe(asaasState.novaId)
    expect(linha.seatsPaid).toBe(2)

    // O gate de dunning lê a MESMA assinatura — prova de que não virou past_due/canceled.
    await withTenant(tenantId, async (tx) => {
      await expect(exigirContaAtiva(tx, tenantId)).resolves.toBeUndefined()
    })
  })

  it('replay do mesmo evento do par: nada acumula, nada muda (idempotente)', async () => {
    const { tenantId, subAntiga } = await seedAssinaturaPro()
    criados.push(tenantId)
    await alterarAssentos({ assentos: 2 })

    const evento = () => ({
      event: 'SUBSCRIPTION_CANCELED' as const,
      subscription: { id: subAntiga, status: 'CANCELED' },
    })

    const primeira = await processarWebhookAsaas(evento())
    const segunda = await processarWebhookAsaas(evento())
    expect(primeira.processado).toBe(false)
    expect(segunda.processado).toBe(false)
    expect(segunda.motivo).toBe(primeira.motivo)

    const linha = await lerAssinatura(tenantId)
    expect(linha.status).toBe('active')
    expect(linha.asaasSubscriptionId).toBe(asaasState.novaId)
  })

  it('churn REAL — cancelamento do id ATUAL cancela de verdade e o gate recusa escrita', async () => {
    const { tenantId } = await seedAssinaturaPro()
    criados.push(tenantId)
    await alterarAssentos({ assentos: 2 })

    const r = await processarWebhookAsaas({
      event: 'SUBSCRIPTION_CANCELED',
      subscription: { id: asaasState.novaId, status: 'CANCELED' },
    })
    expect(r.processado, `motivo devolvido: "${r.motivo}"`).toBe(true)

    const linha = await lerAssinatura(tenantId)
    expect(linha.status).toBe('canceled')

    // O comportamento genuíno de dunning permanece: conta cancelada, escrita bloqueada.
    await withTenant(tenantId, async (tx) => {
      await expect(exigirContaAtiva(tx, tenantId)).rejects.toMatchObject({
        code: 'ASSINATURA_INATIVA',
      })
    })
  })
})
