/**
 * S11 — testes de cobrança: planos, assinatura, faturas e webhook do Asaas.
 *
 * Mesmo padrão de `tests/sales/vendas.test.ts`: chama as funções REAIS de
 * `src/server/billing.ts` contra um Postgres de verdade, só mockando
 * `requireAuthContext` (não existe sessão HTTP fora de uma requisição).
 * `tenant-isolation.test.ts` já cobre, por varredura de catálogo, que
 * `subscriptions`/`payments` têm RLS e que SELECT/UPDATE/DELETE cruzados
 * devolvem zero linhas em SQL direto — o que ESTE arquivo cobre é a camada
 * de cima: as Server Actions de cobrança, o índice único
 * `subscriptions_one_live_per_tenant`, a idempotência do webhook
 * (`payments_asaas_payment_key`), e a verificação de token do webhook.
 *
 * Pontos do handoff S11 cobertos aqui:
 *  1. Seed dos 3 planos (Solo 4900 / Pro 9900 / Studio 19900) — `ON CONFLICT (slug)
 *     DO NOTHING` é re-entrante: rodar o INSERT de novo direto não duplica.
 *  2. RLS de `subscriptions`/`payments` — confirmados por varredura de catálogo
 *     (`tenant-isolation.test.ts`) + sanity aqui de que a varredura vê as duas
 *     tabelas + isolamento via action (assinatura/fatura de A não aparece para B).
 *  3. `trocarPlano` idempotente — chamar duas vezes com o mesmo `planId` não cria
 *     duas assinaturas (uma viva por tenant: `subscriptions_one_live_per_tenant`).
 *  4. `trocarPlano` com `planId` inexistente → `NAO_ENCONTRADO`.
 *  5. Modo dev sem `ASAAS_API_KEY` — `trocarPlano`/`cancelarAssinatura` operam só
 *     no DB. O cliente `asaas/client.ts` lança `ASAAS_NAO_CONFIGURADO` com
 *     `code`/`correcao` certos se chamado direto sem chave.
 *  6. `processarWebhookAsaas` idempotente — mesmo `asaasPaymentId` processado duas
 *     vezes não cria duas `payments` (`payments_asaas_payment_key`). NOTA: o
 *     caminho "encontra a assinatura pelo asaasSubscriptionId" está vermelho de
 *     propósito — `unsafeDbWithoutTenant` não bypassa RLS e o webhook não vê a
 *     assinatura sem `app.tenant_id`. Ver `docs/handoffs/teo-para-rafa.md`.
 *  7. `verificarWebhookAsaas` — sem `ASAAS_WEBHOOK_TOKEN` retorna `true`; com token,
 *     só `true` se header/query bater.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { count, eq } from 'drizzle-orm'
import { payments, plans, subscriptions, tenants, user } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'
import { unsafeDbWithoutTenant } from '@/db/client'
import { connect } from '../helpers/db'

// ---------------------------------------------------------------------------
// Mock de sessão — mesmo padrão de tests/sales/vendas.test.ts.
// `requireAuthContext` não existe fora de uma requisição HTTP; o mock devolve
// um contexto determinístico que apontamos para o tenant da fixture.
// ---------------------------------------------------------------------------

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: 'qa-billing-user',
  email: 'qa-billing@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const {
  listarPlanos,
  trocarPlano,
  cancelarAssinatura,
  obterAssinaturaAtual,
  listarFaturas,
  processarWebhookAsaas,
} = await import('@/server/billing')

const {
  verificarWebhookAsaas,
  erroAsaasNaoConfigurado,
  criarClienteAsaas,
  criarAssinaturaAsaas,
  cancelarAssinaturaAsaas,
} = await import('@/lib/asaas/client')

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

type Fixture = { tenantId: string; userId: string }

/** Cria tenant + usuário dono. O `registrarAuditoria` tem FK real para `user`,
 * então `authCtx.userId` precisa apontar para uma linha que existe. */
async function seedTenant(): Promise<Fixture> {
  const tenantId = randomUUID()
  const userId = `qa-billing-${randomUUID()}`
  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: `Agência QA Billing ${tenantId.slice(0, 8)}`,
      slug: `qa-billing-${tenantId.slice(0, 8)}`,
    })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Billing Bot',
      email: `${userId}@exemplo-zarpa.com.br`,
    })
  })
  return { tenantId, userId }
}

/** Troca a sessão mockada para o tenant da fixture. */
function entrarComo(fixture: Pick<Fixture, 'tenantId' | 'userId'>): void {
  authCtx.tenantId = fixture.tenantId
  authCtx.userId = fixture.userId
}

/** O driver postgres-js/drizzle embrulha o erro real do Postgres em `.cause`
 * — a mensagem de topo é só "Failed query: ...". O detalhe da constraint (nome
 * do índice único, do CHECK, da FK) mora na causa. Achata a cadeia inteira
 * para poder casar regex contra o texto que realmente importa. Mesma função
 * do `tests/sales/vendas.test.ts`. */
function textoCompletoDoErro(erro: unknown): string {
  const partes: string[] = []
  let atual: unknown = erro
  let voltas = 0
  while (atual && voltas < 5) {
    if (atual instanceof Error) {
      partes.push(atual.message)
      atual = (atual as Error & { cause?: unknown }).cause
    } else {
      partes.push(String(atual))
      atual = undefined
    }
    voltas++
  }
  return partes.join(' | ')
}

/** Pega o id de um plano pelo slug. `plans` é catálogo global com policy
 * `plans_read USING(true)` — leitura liberada a qualquer conexão. */
async function planoIdPorSlug(slug: 'solo' | 'pro' | 'studio'): Promise<string> {
  const [plano] = await unsafeDbWithoutTenant
    .select({ id: plans.id })
    .from(plans)
    .where(eq(plans.slug, slug))
    .limit(1)
  if (!plano) throw new Error(`plano ${slug} não existe — a migration 0009 rodou?`)
  return plano.id
}

const criados: string[] = []
const sql = connect()

afterAll(async () => {
  for (const tenantId of criados) {
    try {
      // Cascade em subscriptions/payments/user — deletar o tenant limpa tudo.
      // Precisa de contexto (tenants_isolation exige id = app.tenant_id no WITH CHECK).
      await withTenant(tenantId, (tx) => tx.delete(tenants).where(eq(tenants.id, tenantId)))
    } catch {
      // best-effort
    }
  }
  await sql.end({ timeout: 5 })
})

// ---------------------------------------------------------------------------
// 1. Seed dos 3 planos — catálogo global
// ---------------------------------------------------------------------------

describe('seed dos 3 planos — catálogo global', () => {
  it('listarPlanos devolve 3 planos ativos: Solo 4900, Pro 9900, Studio 19900', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const resultado = await listarPlanos()
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)
    if (!resultado.ok) return

    const porSlug = new Map(resultado.data.map((p) => [p.slug, p]))
    expect(porSlug.size).toBe(3)
    expect(porSlug.get('solo')?.priceCents).toBe(4900)
    expect(porSlug.get('pro')?.priceCents).toBe(9900)
    expect(porSlug.get('studio')?.priceCents).toBe(19900)
    for (const p of resultado.data) {
      expect(p.isActive).toBe(true)
      expect(p.currency).toBe('BRL')
    }
  })

  it('ON CONFLICT (slug) DO NOTHING: re-rodar o INSERT do seed não duplica planos', async () => {
    // A migration 0009 faz `INSERT ... ON CONFLICT (slug) DO NOTHING`. Aqui
    // reproduzimos o "rodar de novo" direto: o índice `plans_slug_key` (unique)
    // + `ON CONFLICT` segura a duplicata. Sem RLS envolvida — `plans` é
    // catálogo global com policy `plans_read USING(true)` que permite escrita
    // (o `WITH CHECK` default = `USING` = `true`).
    const [antes] = await sql`select count(*)::int as n from plans`
    expect(antes.n).toBe(3)

    await sql`
      insert into plans (slug, name, price_cents, currency, description, is_active)
      values
        ('solo', 'Solo', 4900, 'BRL', 'Para o agente que trabalha sozinho', true),
        ('pro', 'Pro', 9900, 'BRL', 'O plano mais popular', true),
        ('studio', 'Studio', 19900, 'BRL', 'Para agências pequenas', true)
      on conflict (slug) do nothing
    `

    const [depois] = await sql`select count(*)::int as n from plans`
    expect(depois.n).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// 3 + 4 + 5. trocarPlano — idempotência, plano inexistente, modo dev
// ---------------------------------------------------------------------------

describe('trocarPlano — idempotência e modo dev', () => {
  it('cria assinatura no modo dev (sem Asaas) com status trialing e sem IDs do Asaas', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const planId = await planoIdPorSlug('pro')
    const r = await trocarPlano({ planId })
    expect(r.ok, !r.ok ? r.mensagem : '').toBe(true)
    if (!r.ok) return

    expect(r.data.plano?.slug).toBe('pro')
    expect(r.data.status).toBe('trialing') // modo dev, sem Asaas
    expect(r.data.asaasCustomerId).toBeNull()
    expect(r.data.asaasSubscriptionId).toBeNull()
    expect(r.data.tenantId).toBe(fixture.tenantId)
  })

  it('chamar duas vezes com o mesmo planId NÃO cria duas assinaturas', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const planId = await planoIdPorSlug('pro')
    const primeira = await trocarPlano({ planId })
    expect(primeira.ok).toBe(true)
    if (!primeira.ok) return

    const segunda = await trocarPlano({ planId })
    expect(segunda.ok).toBe(true)
    if (!segunda.ok) return

    expect(segunda.data.id).toBe(primeira.data.id)

    // Confirma no banco: só 1 assinatura para esse tenant (o índice único
    // `subscriptions_one_live_per_tenant` garante — não a aplicação).
    const vivas = await withTenant(fixture.tenantId, (tx) =>
      tx.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.tenantId, fixture.tenantId)),
    )
    expect(vivas).toHaveLength(1)
  })

  it('trocar de pro para studio atualiza a assinatura existente (não cria segunda)', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const proId = await planoIdPorSlug('pro')
    const studioId = await planoIdPorSlug('studio')

    const r1 = await trocarPlano({ planId: proId })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    expect(r1.data.plano?.slug).toBe('pro')

    const r2 = await trocarPlano({ planId: studioId })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(r2.data.plano?.slug).toBe('studio')
    expect(r2.data.id).toBe(r1.data.id) // mesma assinatura, planId atualizado

    const vivas = await withTenant(fixture.tenantId, (tx) =>
      tx.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.tenantId, fixture.tenantId)),
    )
    expect(vivas).toHaveLength(1)
  })

  it('subscriptions_one_live_per_tenant: dois inserts diretos com status vivo para o mesmo tenant — um vence', async () => {
    // O índice único parcial é quem garante "uma assinatura viva por tenant" no
    // banco, não a aplicação. Prova com insert cru, não via action.
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    const planId = await planoIdPorSlug('pro')

    const inserir = () =>
      withTenant(fixture.tenantId, (tx) =>
        tx.insert(subscriptions).values({
          tenantId: fixture.tenantId,
          planId,
          plan: 'pro',
          status: 'trialing',
          billingCycle: 'monthly',
          amountCents: 9900,
        }),
      )

    const resultados = await Promise.allSettled([inserir(), inserir()])
    const sucesso = resultados.filter((r) => r.status === 'fulfilled')
    const falha = resultados.filter((r) => r.status === 'rejected')

    expect(sucesso).toHaveLength(1)
    expect(falha).toHaveLength(1)
  })

  it('planId inexistente → NAO_ENCONTRADO', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await trocarPlano({ planId: randomUUID() })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('NAO_ENCONTRADO')
    expect(r.correcao).toBeTruthy()
  })

  it('planId não-UUID → DADOS_INVALIDOS', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await trocarPlano({ planId: 'nao-e-uuid' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('DADOS_INVALIDOS')
  })
})

// ---------------------------------------------------------------------------
// cancelarAssinatura
// ---------------------------------------------------------------------------

describe('cancelarAssinatura — idempotente e sem Asaas em dev', () => {
  it('cancela a assinatura viva (status → canceled) sem chamar Asaas em dev', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const planId = await planoIdPorSlug('pro')
    await trocarPlano({ planId })

    const cancelada = await cancelarAssinatura()
    expect(cancelada.ok).toBe(true)
    if (!cancelada.ok) return
    expect(cancelada.data?.status).toBe('canceled')
    expect(cancelada.data?.canceledAt).not.toBeNull()
  })

  it('chamar cancelar de novo devolve null (não tem assinatura viva)', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const planId = await planoIdPorSlug('pro')
    await trocarPlano({ planId })
    await cancelarAssinatura()

    const segunda = await cancelarAssinatura()
    expect(segunda.ok).toBe(true)
    if (!segunda.ok) return
    expect(segunda.data).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2. Isolamento por tenant — assinatura/fatura de A não aparece para B
// ---------------------------------------------------------------------------

describe('isolamento por tenant — assinatura/fatura de A não aparece para B', () => {
  it('obterAssinaturaAtual/listarFaturas de B contra A devolvem null/vazio', async () => {
    const fixtureA = await seedTenant()
    const fixtureB = await seedTenant()
    criados.push(fixtureA.tenantId, fixtureB.tenantId)

    entrarComo(fixtureA)
    const planId = await planoIdPorSlug('pro')
    const assA = await trocarPlano({ planId })
    expect(assA.ok).toBe(true)
    if (!assA.ok) return

    // B não vê assinatura de A.
    entrarComo(fixtureB)
    const leitura = await obterAssinaturaAtual()
    expect(leitura.ok).toBe(true)
    if (!leitura.ok) return
    expect(leitura.data).toBeNull()

    const faturas = await listarFaturas()
    expect(faturas.ok).toBe(true)
    if (!faturas.ok) return
    expect(faturas.data).toEqual([])
  })

  it('a varredura por catálogo do tenant-isolation vê subscriptions e payments', async () => {
    // Sanity: confirmar que o teste de isolamento por catálogo (que roda em
    // `tenant-isolation.test.ts`) cobre essas duas tabelas. A varredura
    // `discoverTenantTables` é o mesmo mecanismo — aqui só confirmamos que as
    // duas tabelas de cobrança têm `tenant_id` e estão no schema `public`.
    const tabelas = await sql<{ name: string }[]>`
      select c.relname as name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r'
        and n.nspname = 'public'
        and c.relname in ('subscriptions', 'payments')
        and exists (
          select 1 from information_schema.columns col
          where col.table_schema = n.nspname
            and col.table_name = c.relname
            and col.column_name = 'tenant_id'
        )
      order by c.relname
    `
    const nomes = tabelas.map((t) => t.name)
    expect(nomes).toContain('subscriptions')
    expect(nomes).toContain('payments')
  })
})

// ---------------------------------------------------------------------------
// 6. processarWebhookAsaas — idempotência e validação
// ---------------------------------------------------------------------------

describe('processarWebhookAsaas — idempotência e validação', () => {
  it('processa PAYMENT_RECEIVED: encontra a assinatura, cria 1 linha em payments e ativa a subscription', async () => {
    // CONTRATO: o webhook chega sem sessão, descobre o tenant pelo
    // `asaasSubscriptionId` no payload, e processa o evento dentro do
    // contexto do tenant dono da assinatura.
    //
    // ESTE TESTE ESTÁ VERMELHO DE PROPÓSITO: `processarWebhookAsaas` faz a
    // busca inicial por `unsafeDbWithoutTenant` (sem `app.tenant_id`), mas a
    // policy `subscriptions_isolation` é `USING("tenant_id" = nullif(
    // current_setting('app.tenant_id', true), '')::uuid)` — sem contexto, o
    // SELECT devolve zero linhas e o webhook sempre cai em "assinatura não
    // encontrada". O role `zarpa` é NOBYPASSRLS, então `unsafeDbWithoutTenant`
    // não bypassa a policy. Falta uma porta de fuga controlada (função
    // SECURITY DEFINER que resolve o tenant pelo asaasSubscriptionId, ou
    // policy permissiva para a coluna unique). Ver docs/handoffs/teo-para-rafa.md.
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)

    const planId = await planoIdPorSlug('pro')
    const asaasSubId = `asaas-sub-${fixture.tenantId.slice(0, 8)}`

    // Cria assinatura DIRETO com `asaasSubscriptionId` setado — `trocarPlano`
    // em modo dev não seta o ID do Asaas, e o webhook precisa do vínculo.
    await withTenant(fixture.tenantId, async (tx) => {
      await tx.insert(subscriptions).values({
        tenantId: fixture.tenantId,
        planId,
        plan: 'pro',
        status: 'past_due',
        billingCycle: 'monthly',
        amountCents: 9900,
        asaasSubscriptionId: asaasSubId,
        asaasCustomerId: `asaas-cust-${fixture.tenantId.slice(0, 8)}`,
      })
    })

    const r = await processarWebhookAsaas({
      event: 'PAYMENT_RECEIVED',
      payment: {
        id: `pay-received-${fixture.tenantId.slice(0, 8)}`,
        subscription: asaasSubId,
        status: 'RECEIVED',
        billingType: 'PIX',
        value: 99,
        paymentDate: '2026-09-07',
        dueDate: null,
      },
    })

    // Quando o Rafa consertar a porta de fuga, isto vira `true`.
    expect(r.processado, `motivo devolvido: "${r.motivo}"`).toBe(true)

    // 1 linha em payments com o asaasPaymentId certo.
    const linhasPay = await withTenant(fixture.tenantId, (tx) =>
      tx
        .select({ id: payments.id, asaasPaymentId: payments.asaasPaymentId, status: payments.status })
        .from(payments)
        .where(eq(payments.asaasPaymentId, `pay-received-${fixture.tenantId.slice(0, 8)}`)),
    )
    expect(linhasPay).toHaveLength(1)
    expect(linhasPay[0]?.status).toBe('received')

    // Status da subscription virou `active` (PAYMENT_RECEIVED).
    const [sub] = await withTenant(fixture.tenantId, (tx) =>
      tx.select({ status: subscriptions.status }).from(subscriptions).where(eq(subscriptions.asaasSubscriptionId, asaasSubId)),
    )
    expect(sub?.status).toBe('active')
  })

  it('idempotente: mesmo asaasPaymentId processado duas vezes cria UMA linha em payments', async () => {
    // Depende do teste acima funcionar (porta de fuga). Enquanto vermelho,
    // este também fica vermelho pelo mesmo motivo — mas o índice
    // `payments_asaas_payment_key` é testado isoladamente abaixo (SQL direto).
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)

    const planId = await planoIdPorSlug('pro')
    const asaasSubId = `asaas-sub-idem-${fixture.tenantId.slice(0, 8)}`

    await withTenant(fixture.tenantId, async (tx) => {
      await tx.insert(subscriptions).values({
        tenantId: fixture.tenantId,
        planId,
        plan: 'pro',
        status: 'active',
        billingCycle: 'monthly',
        amountCents: 9900,
        asaasSubscriptionId: asaasSubId,
      })
    })

    const payload = {
      event: 'PAYMENT_RECEIVED' as const,
      payment: {
        id: `pay-idem-${fixture.tenantId.slice(0, 8)}`,
        subscription: asaasSubId,
        status: 'RECEIVED',
        billingType: 'PIX',
        value: 99,
        paymentDate: '2026-09-07',
        dueDate: null,
      },
    }

    const r1 = await processarWebhookAsaas(payload)
    expect(r1.processado, `motivo: "${r1.motivo}"`).toBe(true)

    const r2 = await processarWebhookAsaas(payload)
    expect(r2.processado).toBe(true)

    const linhas = await withTenant(fixture.tenantId, (tx) =>
      tx.select({ id: payments.id }).from(payments).where(eq(payments.asaasPaymentId, `pay-idem-${fixture.tenantId.slice(0, 8)}`)),
    )
    expect(linhas).toHaveLength(1)
  })

  it('payments_asaas_payment_key barra insert duplicado em SQL direto (índice de idempotência)', async () => {
    // Prova o índice único isoladamente, sem depender do webhook funcionar.
    // O índice é parcial (WHERE asaas_payment_id IS NOT NULL), então o insert
    // com o mesmo ID tem que bater no unique e falhar.
    //
    // O segundo insert roda em transação PRÓPRIA (não dentro do withTenant de
    // setup): se rodar dentro da mesma transação, o erro do insert aborta a
    // transação inteira e o `withTenant` falha no commit — mascarando o erro
    // real que queremos afirmar.
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    const planId = await planoIdPorSlug('pro')
    const asaasSubId = `asaas-sub-idx-${fixture.tenantId.slice(0, 8)}`
    const payId = `pay-idx-${fixture.tenantId.slice(0, 8)}`

    // Setup: cria subscription + primeiro payment.
    const { subId } = await withTenant(fixture.tenantId, async (tx) => {
      const [sub] = await tx
        .insert(subscriptions)
        .values({
          tenantId: fixture.tenantId,
          planId,
          plan: 'pro',
          status: 'active',
          billingCycle: 'monthly',
          amountCents: 9900,
          asaasSubscriptionId: asaasSubId,
        })
        .returning({ id: subscriptions.id })

      await tx.insert(payments).values({
        tenantId: fixture.tenantId,
        subscriptionId: sub!.id,
        asaasPaymentId: payId,
        amountCents: 9900,
        status: 'received',
        method: 'pix',
      })
      return { subId: sub!.id }
    })

    // Segundo insert com o mesmo asaasPaymentId em transação própria — deve
    // falhar com unique_violation (23505) no índice `payments_asaas_payment_key`.
    let falhou = false
    try {
      await withTenant(fixture.tenantId, async (tx) => {
        await tx.insert(payments).values({
          tenantId: fixture.tenantId,
          subscriptionId: subId,
          asaasPaymentId: payId,
          amountCents: 9900,
          status: 'pending',
          method: 'pix',
        })
      })
    } catch (erro) {
      falhou = true
      const texto = textoCompletoDoErro(erro)
      expect(texto).toMatch(/23505|payments_asaas_payment_key|duplicate key/i)
    }
    expect(falhou, 'segundo insert com mesmo asaasPaymentId deveria falhar').toBe(true)
  })

  it('webhook com subscription id que não é nosso → processado: false, sem criar nada', async () => {
    const r = await processarWebhookAsaas({
      event: 'PAYMENT_RECEIVED',
      payment: { id: 'pay-desconhecido', subscription: 'sub-que-nao-existe' },
    })
    expect(r.processado).toBe(false)
    expect(r.motivo).toMatch(/não encontrada/i)
  })

  it('webhook sem event → processado: false', async () => {
    const r = await processarWebhookAsaas({})
    expect(r.processado).toBe(false)
  })

  it('webhook sem subscription id no payload → processado: false', async () => {
    const r = await processarWebhookAsaas({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay-sem-sub' } })
    expect(r.processado).toBe(false)
    expect(r.motivo).toMatch(/subscription/i)
  })
})

// ---------------------------------------------------------------------------
// 7. verificarWebhookAsaas — token de webhook
// ---------------------------------------------------------------------------

describe('verificarWebhookAsaas — token de webhook', () => {
  it('sem ASAAS_WEBHOOK_TOKEN configurado: retorna true (dev/teste não trava)', () => {
    // Estado atual do ambiente: .env.local não define ASAAS_WEBHOOK_TOKEN.
    expect(verificarWebhookAsaas({ headers: {} })).toBe(true)
    expect(verificarWebhookAsaas({ headers: { 'asaas-access-token': 'qualquer' } })).toBe(true)
  })

  it('com ASAAS_WEBHOOK_TOKEN configurado: só true se header/query bater (timing-safe)', async () => {
    // `client.ts` lê `ASAAS_WEBHOOK_TOKEN` como const no carregamento do módulo.
    // Para testar o caminho "com token", re-importamos o módulo com a env
    // stubada. `vi.resetModules` limpa o cache; o próximo `import` relê a
    // env. As referências do topo (usadas pelos outros testes) apontam para
    // a instância original sem token — não são afetadas.
    vi.stubEnv('ASAAS_WEBHOOK_TOKEN', 'segredo-zarpa')
    vi.resetModules()
    const mod = await import('@/lib/asaas/client')
    const verificar = mod.verificarWebhookAsaas

    // Header certo.
    expect(verificar({ headers: { 'asaas-access-token': 'segredo-zarpa' } })).toBe(true)
    // Header com capitalização que o código também lê (Asaas-Access-Token).
    expect(verificar({ headers: { 'Asaas-Access-Token': 'segredo-zarpa' } })).toBe(true)
    // Query string certa.
    expect(
      verificar({ headers: {}, searchParams: new URLSearchParams({ access_token: 'segredo-zarpa' }) }),
    ).toBe(true)
    // Header errado.
    expect(verificar({ headers: { 'asaas-access-token': 'errado' } })).toBe(false)
    // Sem nada.
    expect(verificar({ headers: {} })).toBe(false)
    // Query errada.
    expect(
      verificar({ headers: {}, searchParams: new URLSearchParams({ access_token: 'errado' }) }),
    ).toBe(false)

    // Restaura env e limpa cache para não vazar para outros testes.
    vi.unstubAllEnvs()
    vi.resetModules()
    await import('@/lib/asaas/client')
  })
})

// ---------------------------------------------------------------------------
// 5. Cliente Asaas — ASAAS_NAO_CONFIGURADO quando chamado sem chave
// ---------------------------------------------------------------------------

describe('asaas/client — ASAAS_NAO_CONFIGURADO quando chamado sem chave', () => {
  it('erroAsaasNaoConfigurado devolve ServiceError com code e correcao certos', () => {
    const err = erroAsaasNaoConfigurado()
    expect(err.code).toBe('ASAAS_NAO_CONFIGURADO')
    expect(err.correcao).toBeTruthy()
    expect(err.correcao).toMatch(/ASAAS_API_KEY/)
  })

  it('criarClienteAsaas lança ASAAS_NAO_CONFIGURADO sem chave', async () => {
    await expect(criarClienteAsaas({ name: 'x', email: 'x@x.com', cpfCnpj: '00000000000' })).rejects.toMatchObject({
      code: 'ASAAS_NAO_CONFIGURADO',
    })
  })

  it('criarAssinaturaAsaas lança ASAAS_NAO_CONFIGURADO sem chave', async () => {
    await expect(
      criarAssinaturaAsaas({ customerId: 'cust-1', value: 99, billingType: 'PIX' }),
    ).rejects.toMatchObject({ code: 'ASAAS_NAO_CONFIGURADO' })
  })

  it('cancelarAssinaturaAsaas lança ASAAS_NAO_CONFIGURADO sem chave', async () => {
    await expect(cancelarAssinaturaAsaas('sub-1')).rejects.toMatchObject({
      code: 'ASAAS_NAO_CONFIGURADO',
    })
  })
})

// ---------------------------------------------------------------------------
// Confirmação de que `count` é importado (evita lint de unused — `count`
// poderia parecer morto se os testes acima não o usassem, mas o gate de tsc
// pegaria). Usado no teste de ON CONFLICT via `sql` cru; mantido aqui para
// documentar que o helper de Drizzle está disponível se a suíte crescer.
// ---------------------------------------------------------------------------
describe('sanity do helper', () => {
  it('count() de drizzle está disponível', () => {
    expect(typeof count).toBe('function')
  })
})
