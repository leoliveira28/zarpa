/**
 * Fase 4b — faturamento consolidado (`docs/FASE4_PJ.md` §4): a fatura da empresa, o
 * boleto no Asaas (mockado — os TESTES não falam com o sandbox; o PO testa contra o
 * sandbox real com credencial em `.env.local`) e a baixa automática pelo webhook.
 *
 * Mesmo padrão de `tests/billing/webhook-par-asaas.test.ts`: cliente Asaas mockado,
 * banco e actions REAIS contra o Postgres de teste. Cobertura:
 *
 *  1. `criarFatura` consolida SÓ as parcelas PENDENTES do período (paga e fora do
 *     período ficam de fora), grava a soma e marca `invoice_id` — a parcela mantém
 *     o vencimento dela.
 *  2. Consolidar o MESMO período de novo → CONFLITO (uniqueIndex parcial); período
 *     sem parcelas → recusa com a correção.
 *  3. `emitirBoletoDaFatura`: customer criado UMA vez e cacheado em
 *     `contacts.asaas_customer_id`; o segundo clique devolve o estado, sem segunda
 *     cobrança no "Asaas".
 *  4. Webhook `PAYMENT_RECEIVED` da cobrança avulsa (sem subscription no payload!):
 *     fatura → 'paga' e as parcelas consolidadas → 'pago' — a baixa automática.
 *  5. Replay do mesmo evento → idempotente (nada muda, nada duplica).
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { contacts, deals, invoices, proposals, receivables, sales, tenants, user } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'
import { camposDocumentoDoContato } from '@/server/piiFields'

// ---------------------------------------------------------------------------
// Mock do cliente Asaas — a parte EXTERNA. Banco, actions e webhook são reais.
// ---------------------------------------------------------------------------

const asaasState = vi.hoisted(() => ({
  customers: [] as { name: string; cpfCnpj: string }[],
  cobrancas: [] as { customerId: string; value: number; dueDate: string }[],
}))

vi.mock('@/lib/asaas/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/asaas/client')>()
  return {
    ...actual,
    asaasConfigurado: () => true,
    criarClienteAsaas: async (input: { name: string; cpfCnpj: string }) => {
      asaasState.customers.push(input)
      return { asaasCustomerId: `cus-qa-${crypto.randomUUID().slice(0, 8)}` }
    },
    criarCobrancaAsaas: async (input: {
      customerId: string
      value: number
      dueDate: string
    }) => {
      asaasState.cobrancas.push(input)
      return {
        asaasPaymentId: `pay-qa-${crypto.randomUUID().slice(0, 8)}`,
        boletoUrl: 'https://sandbox.asaas.com/i/qa-boleto',
      }
    },
  }
})

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: 'qa-fatura-user',
  email: 'qa-fatura@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { criarFatura, listarFaturasDoCliente, obterFatura, emitirBoletoDaFatura } = await import(
  '@/server/invoices'
)
const { processarWebhookAsaas } = await import('@/server/billing')

// ---------------------------------------------------------------------------
// Fixture — empresa PJ com duas vendas: parcelas no período, paga e fora do período
// ---------------------------------------------------------------------------

type Fixture = {
  tenantId: string
  userId: string
  contatoId: string
}

function entrarComo(fixture: Fixture): void {
  authCtx.tenantId = fixture.tenantId
  authCtx.userId = fixture.userId
}

async function seedEmpresaComParcelas(prefix: string): Promise<Fixture> {
  const tenantId = randomUUID()
  const seedTag = `qa-fatura-${prefix}-${tenantId.slice(0, 8)}`
  const userId = `qa-fatura-${randomUUID()}`

  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `Agência QA Fatura ${seedTag}`, slug: seedTag })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Fatura Bot',
      email: `${userId}@exemplo-zarpa.com.br`,
    })

    const [contato] = await tx
      .insert(contacts)
      .values({
        tenantId,
        name: 'Alfa Turismo Ltda',
        personType: 'juridica',
        email: 'financeiro@alfaturismo.com.br',
        // CNPJ cifrado + índice cego, pela MESMA via da aplicação.
        ...camposDocumentoDoContato(tenantId, '04.252.011/0001-10'),
      })
      .returning({ id: contacts.id })

    const [deal] = await tx
      .insert(deals)
      .values({ tenantId, contactId: contato!.id, title: 'Convenção anual', stage: 'ganho' })
      .returning({ id: deals.id })

    const [proposta] = await tx
      .insert(proposals)
      .values({ tenantId, dealId: deal!.id, publicToken: randomUUID(), title: 'Proposta da convenção', status: 'accepted' })
      .returning({ id: proposals.id })

    const [venda] = await tx
      .insert(sales)
      .values({
        tenantId,
        dealId: deal!.id,
        proposalId: proposta!.id,
        valorBrutoCents: 1_000_000,
      })
      .returning({ id: sales.id })

    // Três parcelas: duas no período (09/2026), uma paga e uma fora.
    await tx.insert(receivables).values([
      { tenantId, saleId: venda!.id, venceEm: '2026-09-10', valorCents: 400_000, status: 'pendente' },
      { tenantId, saleId: venda!.id, venceEm: '2026-09-25', valorCents: 300_000, status: 'pendente' },
      { tenantId, saleId: venda!.id, venceEm: '2026-09-05', valorCents: 100_000, status: 'pago', pagoEm: new Date() },
      { tenantId, saleId: venda!.id, venceEm: '2026-10-10', valorCents: 200_000, status: 'pendente' },
    ])
  })

  return { tenantId, userId, contatoId: '' }
}

// O contatoId é preciso de outra leitura (a fixture devolve o objeto todo).
async function contatoDaFixture(fixture: Fixture): Promise<string> {
  const [linha] = await withTenant(fixture.tenantId, (tx) =>
    tx.select({ id: contacts.id }).from(contacts).limit(1),
  )
  return linha!.id
}

afterAll(async () => {
  vi.restoreAllMocks()
})

describe('faturamento consolidado (4b)', () => {
  it('consolida só as parcelas pendentes do período; segundo período vazio recusa', async () => {
    const fixture = await seedEmpresaComParcelas('consolida')
    fixture.contatoId = await contatoDaFixture(fixture)
    entrarComo(fixture)

    const criada = await criarFatura({ contactId: fixture.contatoId, de: '2026-09-01', ate: '2026-09-30' })
    expect(criada.ok).toBe(true)
    if (!criada.ok) return
    // 400k + 300k: a paga e a de outubro ficam de fora.
    expect(criada.data.valorCents).toBe(700_000)
    expect(criada.data.totalParcelas).toBe(2)
    expect(criada.data.status).toBe('aberta')

    // As parcelas da fatura mantêm o vencimento delas.
    const detalhe = await obterFatura(criada.data.id)
    expect(detalhe.ok).toBe(true)
    if (!detalhe.ok) return
    expect(detalhe.data.parcelas.map((p) => p.venceEm)).toEqual(['2026-09-10', '2026-09-25'])

    // Mesmo período de novo → CONFLITO (a fatura aberta já existe).
    const repetida = await criarFatura({ contactId: fixture.contatoId, de: '2026-09-01', ate: '2026-09-30' })
    expect(repetida.ok).toBe(false)

    // Período sem pendentes → recusa com a correção.
    const vazia = await criarFatura({ contactId: fixture.contatoId, de: '2026-12-01', ate: '2026-12-31' })
    expect(vazia.ok).toBe(false)
    if (!vazia.ok) {
      expect(vazia.mensagem).toContain('Não há parcelas pendentes')
    }
  })

  it('boleto: customer criado UMA vez e cacheado; segundo clique não recobra', async () => {
    const fixture = await seedEmpresaComParcelas('boleto')
    fixture.contatoId = await contatoDaFixture(fixture)
    entrarComo(fixture)

    const criada = await criarFatura({ contactId: fixture.contatoId, de: '2026-09-01', ate: '2026-09-30' })
    expect(criada.ok).toBe(true)
    if (!criada.ok) return

    const primeira = await emitirBoletoDaFatura({ faturaId: criada.data.id })
    expect(primeira.ok).toBe(true)
    if (!primeira.ok) return
    expect(primeira.data.boletoEmitido).toBe(true)
    expect(primeira.data.boletoUrl).toBeTruthy()
    expect(asaasState.customers).toHaveLength(1)
    // CNPJ decifrado chega ao Asaas com 14 dígitos.
    expect(asaasState.customers[0]?.cpfCnpj).toBe('04252011000110')
    expect(asaasState.cobrancas).toHaveLength(1)
    expect(asaasState.cobrancas[0]?.value).toBeCloseTo(7000)

    const segunda = await emitirBoletoDaFatura({ faturaId: criada.data.id })
    expect(segunda.ok).toBe(true)
    if (!segunda.ok) return
    // Nada novo no "Asaas" — o reenvio do clique devolve o estado.
    expect(asaasState.cobrancas).toHaveLength(1)
    expect(segunda.data.boletoEmitido).toBe(true)
  })

  it('webhook da cobrança avulsa dá a baixa automática — e o replay é idempotente', async () => {
    const fixture = await seedEmpresaComParcelas('webhook')
    fixture.contatoId = await contatoDaFixture(fixture)
    entrarComo(fixture)

    const criada = await criarFatura({ contactId: fixture.contatoId, de: '2026-09-01', ate: '2026-09-30' })
    expect(criada.ok).toBe(true)
    if (!criada.ok) return
    const emitida = await emitirBoletoDaFatura({ faturaId: criada.data.id })
    expect(emitida.ok).toBe(true)
    if (!emitida.ok) return
    // Recupera o id real do "Asaas" (a fatura o grava na emissão).
    const [faturaLida] = await withTenant(fixture.tenantId, (tx) =>
      tx.select({ asaasPaymentId: invoices.asaasPaymentId }).from(invoices).where(eq(invoices.id, criada.data.id)),
    )
    expect(faturaLida?.asaasPaymentId).toBeTruthy()

    // O evento NÃO traz subscription — cobrança avulsa. `authCtx` desligado não é
    // preciso: o webhook não tem sessão mesmo.
    const payload = {
      event: 'PAYMENT_RECEIVED',
      dateCreated: new Date().toISOString(),
      payment: { id: faturaLida!.asaasPaymentId, status: 'RECEIVED', billingType: 'BOLETO', value: 7000, dueDate: '2026-09-20' },
    } as Parameters<typeof processarWebhookAsaas>[0]

    const primeira = await processarWebhookAsaas(payload)
    expect(primeira.processado).toBe(true)

    // Fatura paga + parcelas consolidadas pagas.
    const [apos] = await withTenant(fixture.tenantId, (tx) =>
      tx.select({ status: invoices.status, pagoEm: invoices.pagoEm }).from(invoices).where(eq(invoices.id, criada.data.id)),
    )
    expect(apos?.status).toBe('paga')
    expect(apos?.pagoEm).not.toBeNull()

    const parcelasPagas = await withTenant(fixture.tenantId, (tx) =>
      tx.select({ id: receivables.id, status: receivables.status }).from(receivables).where(eq(receivables.invoiceId, criada.data.id)),
    )
    expect(parcelasPagas.every((p) => p.status === 'pago')).toBe(true)

    // Replay do MESMO evento: processado de novo, sem efeito acumulado.
    const replay = await processarWebhookAsaas(payload)
    expect(replay.processado).toBe(true)
    const parcelasAposReplay = await withTenant(fixture.tenantId, (tx) =>
      tx.select({ id: receivables.id }).from(receivables).where(eq(receivables.invoiceId, criada.data.id)),
    )
    expect(parcelasAposReplay).toHaveLength(2)

    // E a listagem da ficha mostra a fatura paga.
    const lista = await listarFaturasDoCliente({ contactId: fixture.contatoId })
    expect(lista.ok).toBe(true)
    if (!lista.ok) return
    expect(lista.data.find((f) => f.id === criada.data.id)?.status).toBe('paga')
  })
})
