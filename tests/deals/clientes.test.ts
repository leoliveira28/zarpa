/**
 * 0020 — a composição de clientes do negócio (casal, família, amigos): as actions
 * `adicionarClienteAoNegocio`/`removerClienteDoNegocio` (`src/server/deals.ts`, seção 4c)
 * e a lista que a ficha e o funil passam a carregar (`NegocioDetalhe.clientes`,
 * `NegocioDoFunil.clientesSecundarios`).
 *
 * Mesmo padrão de `tests/deals/funil.test.ts`: funções REAIS contra o Postgres de teste,
 * só `requireAuthContext` mockado. O RLS da tabela nova é coberto em
 * `tests/security/deal-contacts-rls.test.ts` (catálogo + SQL cruzado + vazamento na
 * pública) — aqui é a CAMADA DE SERVIÇO:
 *
 *  1. Caminho feliz: adicionar secundário → lista com principal primeiro, telefone CRU
 *     (`whatsapp ?? phone`, sem formatação — quem monta `wa.me` é `waMeLink()` no cliente);
 *     `obterNegocio` e `listarNegociosDoFunil` refletem ("Ana +1").
 *  2. Recusas com o código certo: duplicado → CONFLITO (e 1 linha só no banco); adicionar
 *     o principal → CONFLITO; remover o principal → CONFLITO com a linha intacta.
 *  3. Remoção de secundário: some da lista.
 *  4. Gate de dunning ANTES de escrever (regra do gate): `past_due` recusa as duas actions
 *     com ASSINATURA_INATIVA e NADA é gravado/apagado (linhas de `deal_contacts` e
 *     auditoria intactas).
 *  5. Isolamento: negócio/contato de outro tenant = NAO_ENCONTRADO (a policy esconde a
 *     linha; a action não confirma existência de recurso alheio).
 *
 * O que este arquivo NÃO cobre (por escolha, "essenciais sem exagero"): o vazamento de
 * PII na proposta pública (teste próprio em `tests/security/`, com canários) e o RLS em
 * SQL direto (varredura de catálogo de Téo + arquivo de segurança citado acima).
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { auditLog, contacts, dealContacts, deals, subscriptions, tenants, user } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'
// Type-only: apagado na compilação — não conflita com o mock nem com o import dinâmico.
import type { ClienteDoNegocio } from '@/server/deals'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: 'qa-clientes-user',
  email: 'qa-clientes@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const {
  adicionarClienteAoNegocio,
  removerClienteDoNegocio,
  criarNegocio,
  listarNegociosDoFunil,
  obterNegocio,
} = await import('@/server/deals')

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

type TenantFixture = { tenantId: string; userId: string }

function entrarComo(fixture: TenantFixture): void {
  authCtx.tenantId = fixture.tenantId
  authCtx.userId = fixture.userId
}

async function seedTenant(prefix: string): Promise<TenantFixture> {
  const tenantId = randomUUID()
  const seedTag = `qa-clientes-${prefix}-${tenantId.slice(0, 8)}`
  const userId = `qa-clientes-${prefix}-${randomUUID()}`

  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `Agência QA Clientes ${seedTag}`, slug: seedTag })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Clientes Bot',
      email: `${userId}@exemplo-zarpa.com.br`,
    })
  })

  return { tenantId, userId }
}

type ContatoOverrides = Partial<{ name: string; phone: string | null; whatsapp: string | null }>

async function seedContato(tenantId: string, overrides: ContatoOverrides = {}): Promise<string> {
  return withTenant(tenantId, async (tx) => {
    const [c] = await tx
      .insert(contacts)
      .values({
        tenantId,
        name: overrides.name ?? 'Cliente QA',
        phone: overrides.phone ?? null,
        whatsapp: overrides.whatsapp ?? null,
      })
      .returning({ id: contacts.id })
    return c!.id
  })
}

/** Negócio pela ACTION (não insert direto): é `criarNegocio` que planta a linha principal
 * em `deal_contacts` — a invariante que 0020 estabeleceu para TODO negócio novo. Sessão
 * apontada para a fixture ANTES da action (a FK `deals.agent_id` → `user` é real). */
async function seedNegocio(fixture: TenantFixture, contatoId: string): Promise<string> {
  entrarComo(fixture)
  const criado = await criarNegocio({
    contactId: contatoId,
    title: 'Negócio QA do casal',
    departureOn: undefined,
    returnOn: undefined,
    expectedCloseOn: undefined,
  })
  if (!criado.ok) throw new Error(`fixture: criarNegocio falhou: ${criado.mensagem}`)
  return criado.data.id
}

async function lerLista(tenantId: string, dealId: string): Promise<ClienteDoNegocio[]> {
  return withTenant(tenantId, async (tx) => {
    const linhas = await tx
      .select({
        contactId: dealContacts.contactId,
        principal: dealContacts.principal,
      })
      .from(dealContacts)
      .where(eq(dealContacts.dealId, dealId))
      .orderBy(dealContacts.principal, dealContacts.createdAt)
    return linhas.map((l) => ({ contactId: l.contactId, nome: '', telefone: null, principal: l.principal }))
  })
}

async function contarAuditoria(tenantId: string, dealId: string, action: string): Promise<number> {
  const linhas = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.entityId, dealId), eq(auditLog.action, action))),
  )
  return linhas.length
}

let soloPlanId: string | null = null

/** Planta a assinatura do tenant no estado pedido — mesmo padrão de `gate-dunning.test.ts`. */
async function plantarAssinatura(
  tenantId: string,
  status: 'active' | 'past_due',
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    if (!soloPlanId) {
      const { plans } = await import('@/db/schema')
      const [p] = await tx.select({ id: plans.id }).from(plans).where(eq(plans.slug, 'solo')).limit(1)
      soloPlanId = p!.id
    }
    await tx.insert(subscriptions).values({
      tenantId,
      planId: soloPlanId,
      plan: 'solo',
      status,
      amountCents: 4900,
      billingCycle: 'monthly',
    })
  })
}

const criados: string[] = []

afterAll(async () => {
  // Limpeza cosmética (mesma nota de `funil.test.ts`): `deal_contacts` morre por CASCADE
  // de `deals`; `subscriptions` morre com o tenant.
  for (const tenantId of criados) {
    try {
      await withTenant(tenantId, async (tx) => {
        await tx.delete(auditLog).where(eq(auditLog.tenantId, tenantId))
        await tx.delete(deals).where(eq(deals.tenantId, tenantId))
        await tx.delete(contacts).where(eq(contacts.tenantId, tenantId))
        await tx.delete(subscriptions).where(eq(subscriptions.tenantId, tenantId))
        await tx.delete(user).where(eq(user.tenantId, tenantId))
      })
    } catch {
      // best-effort
    }
  }
})

// ---------------------------------------------------------------------------
// 1) Caminho feliz
// ---------------------------------------------------------------------------

describe('adicionarClienteAoNegocio — o casal', () => {
  it('adiciona o segundo cliente, lista principal primeiro com telefone CRU, e funil/ficha refletem', async () => {
    const fixture = await seedTenant('feliz')
    criados.push(fixture.tenantId)
    const ana = await seedContato(fixture.tenantId, { name: 'Ana QA', phone: '+5511999990001' })
    const carlos = await seedContato(fixture.tenantId, {
      name: 'Carlos QA',
      phone: '+5511999990002',
      whatsapp: '+5511999990099',
    })
    const dealId = await seedNegocio(fixture, ana)
    entrarComo(fixture)

    const adicionado = await adicionarClienteAoNegocio({ negocioId: dealId, contatoId: carlos })
    expect(adicionado.ok, !adicionado.ok ? adicionado.mensagem : '').toBe(true)
    if (!adicionado.ok) return

    // Principal primeiro; secundário com o telefone CRU do whatsapp (sem formatação —
    // quem monta `wa.me` é `waMeLink()` no cliente; sanitizar aqui seria segunda regra).
    expect(adicionado.data.clientes).toHaveLength(2)
    expect(adicionado.data.clientes[0]).toMatchObject({ contactId: ana, principal: true })
    expect(adicionado.data.clientes[1]).toMatchObject({
      contactId: carlos,
      principal: false,
      telefone: '+5511999990099',
    })

    // A ficha (`obterNegocio`) e o funil contam a mesma história.
    const detalhe = await obterNegocio(dealId)
    expect(detalhe.ok).toBe(true)
    if (detalhe.ok) expect(detalhe.data.clientes.map((c) => c.contactId)).toEqual([ana, carlos])

    const board = await listarNegociosDoFunil()
    expect(board.ok).toBe(true)
    if (board.ok) {
      const linha = board.data.find((d) => d.id === dealId)
      expect(linha?.clientesSecundarios).toBe(1)
    }

    // E a auditoria registra o fato — só ids, nunca nome/telefone.
    expect(await contarAuditoria(fixture.tenantId, dealId, 'deal.contact_added')).toBe(1)
  })

  it('contato sem whatsapp usa o phone; contato sem telefone nenhum sai com null', async () => {
    const fixture = await seedTenant('telefone')
    criados.push(fixture.tenantId)
    const ana = await seedContato(fixture.tenantId, { name: 'Ana QA', phone: '+5511999990001' })
    const soPhone = await seedContato(fixture.tenantId, {
      name: 'Só Phone QA',
      phone: '+5511999990003',
      whatsapp: null,
    })
    const semNenhum = await seedContato(fixture.tenantId, { name: 'Sem Telefone QA', phone: null, whatsapp: null })
    const dealId = await seedNegocio(fixture, ana)
    entrarComo(fixture)

    const primeiro = await adicionarClienteAoNegocio({ negocioId: dealId, contatoId: soPhone })
    expect(primeiro.ok).toBe(true)
    if (primeiro.ok) {
      expect(primeiro.data.clientes.find((c) => c.contactId === soPhone)?.telefone).toBe('+5511999990003')
    }

    const segundo = await adicionarClienteAoNegocio({ negocioId: dealId, contatoId: semNenhum })
    expect(segundo.ok).toBe(true)
    if (segundo.ok) {
      expect(segundo.data.clientes.find((c) => c.contactId === semNenhum)?.telefone).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// 2) Recusas — duplicado, principal
// ---------------------------------------------------------------------------

describe('recusas — duplicado e o principal é intocável', () => {
  it('duplicado → CONFLITO, e o banco tem 1 linha só (a PK é a garantia final)', async () => {
    const fixture = await seedTenant('duplicado')
    criados.push(fixture.tenantId)
    const ana = await seedContato(fixture.tenantId, { name: 'Ana QA', phone: '+5511999990001' })
    const carlos = await seedContato(fixture.tenantId, { name: 'Carlos QA' })
    const dealId = await seedNegocio(fixture, ana)
    entrarComo(fixture)

    const primeira = await adicionarClienteAoNegocio({ negocioId: dealId, contatoId: carlos })
    expect(primeira.ok).toBe(true)

    const segunda = await adicionarClienteAoNegocio({ negocioId: dealId, contatoId: carlos })
    expect(segunda.ok).toBe(false)
    if (!segunda.ok) expect(segunda.code).toBe('CONFLITO')

    const lista = await lerLista(fixture.tenantId, dealId)
    expect(lista.filter((c) => c.contactId === carlos)).toHaveLength(1)
    expect(await contarAuditoria(fixture.tenantId, dealId, 'deal.contact_added')).toBe(1)
  })

  it('adicionar o PRINCIPAL → CONFLITO; remover o PRINCIPAL → CONFLITO com a linha intacta', async () => {
    const fixture = await seedTenant('principal')
    criados.push(fixture.tenantId)
    const ana = await seedContato(fixture.tenantId, { name: 'Ana QA', phone: '+5511999990001' })
    const dealId = await seedNegocio(fixture, ana)
    entrarComo(fixture)

    const add = await adicionarClienteAoNegocio({ negocioId: dealId, contatoId: ana })
    expect(add.ok).toBe(false)
    if (!add.ok) expect(add.code).toBe('CONFLITO')

    const removido = await removerClienteDoNegocio({ negocioId: dealId, contatoId: ana })
    expect(removido.ok).toBe(false)
    if (!removido.ok) expect(removido.code).toBe('CONFLITO')

    // A prova: a linha principal continua no banco — a recusa não foi só de mensagem.
    const lista = await lerLista(fixture.tenantId, dealId)
    expect(lista).toHaveLength(1)
    expect(lista[0]).toMatchObject({ contactId: ana, principal: true })
    expect(await contarAuditoria(fixture.tenantId, dealId, 'deal.contact_removed')).toBe(0)
  })

  it('remover secundário: some da lista; remover quem não está → NAO_ENCONTRADO', async () => {
    const fixture = await seedTenant('remocao')
    criados.push(fixture.tenantId)
    const ana = await seedContato(fixture.tenantId, { name: 'Ana QA', phone: '+5511999990001' })
    const carlos = await seedContato(fixture.tenantId, { name: 'Carlos QA' })
    const Beatriz = await seedContato(fixture.tenantId, { name: 'Beatriz QA' })
    const dealId = await seedNegocio(fixture, ana)
    entrarComo(fixture)

    await adicionarClienteAoNegocio({ negocioId: dealId, contatoId: carlos })

    const removido = await removerClienteDoNegocio({ negocioId: dealId, contatoId: carlos })
    expect(removido.ok, !removido.ok ? removido.mensagem : '').toBe(true)
    if (removido.ok) expect(removido.data.clientes.map((c) => c.contactId)).toEqual([ana])
    expect(await contarAuditoria(fixture.tenantId, dealId, 'deal.contact_removed')).toBe(1)

    const fantasma = await removerClienteDoNegocio({ negocioId: dealId, contatoId: Beatriz })
    expect(fantasma.ok).toBe(false)
    if (!fantasma.ok) expect(fantasma.code).toBe('NAO_ENCONTRADO')
  })
})

// ---------------------------------------------------------------------------
// 3) Gate de dunning — a conta bloqueada não escreve
// ---------------------------------------------------------------------------

describe('gate de dunning — past_due recusa as duas actions sem escrever nada', () => {
  it('adicionar e remover falham com ASSINATURA_INATIVA; deal_contacts e auditoria intactos', async () => {
    const fixture = await seedTenant('gate')
    criados.push(fixture.tenantId)
    // A fixture do negócio usa a ACTION `criarNegocio` — que passa pelo gate. Então o
    // negócio nasce ANTES do bloqueio: o estado do teste é "dado que existia antes de a
    // conta bloquear" (mesma ordem de `gate-dunning.test.ts`).
    const ana = await seedContato(fixture.tenantId, { name: 'Ana QA', phone: '+5511999990001' })
    const carlos = await seedContato(fixture.tenantId, { name: 'Carlos QA' })
    const dealId = await seedNegocio(fixture, ana)
    await plantarAssinatura(fixture.tenantId, 'past_due')
    entrarComo(fixture)

    const antes = await lerLista(fixture.tenantId, dealId)

    const adicionado = await adicionarClienteAoNegocio({ negocioId: dealId, contatoId: carlos })
    expect(adicionado.ok).toBe(false)
    if (!adicionado.ok) {
      expect(adicionado.code).toBe('ASSINATURA_INATIVA')
      // A correção aponta o caminho de destravamento.
      expect(adicionado.correcao).toBeTruthy()
    }

    // E a recusa de REMOÇÃO também vale — modo somente leitura é nos dois sentidos.
    const removido = await removerClienteDoNegocio({ negocioId: dealId, contatoId: ana })
    expect(removido.ok).toBe(false)
    if (!removido.ok) expect(removido.code).toBe('ASSINATURA_INATIVA')

    const depois = await lerLista(fixture.tenantId, dealId)
    expect(depois).toEqual(antes)
    expect(await contarAuditoria(fixture.tenantId, dealId, 'deal.contact_added')).toBe(0)
    expect(await contarAuditoria(fixture.tenantId, dealId, 'deal.contact_removed')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 4) Isolamento — recurso de outro tenant é NAO_ENCONTRADO
// ---------------------------------------------------------------------------

describe('isolamento — negócio/contato de outro tenant não são alcançáveis', () => {
  it('negócio de A com contato de B (e o inverso): NAO_ENCONTRADO nas duas actions', async () => {
    const A = await seedTenant('iso-a')
    const B = await seedTenant('iso-b')
    criados.push(A.tenantId, B.tenantId)

    const anaA = await seedContato(A.tenantId, { name: 'Ana de A' })
    const carlosB = await seedContato(B.tenantId, { name: 'Carlos de B' })
    const dealA = await seedNegocio(A, anaA)
    const dealB = await seedNegocio(B, carlosB)

    entrarComo(B)
    const negocioAlheio = await adicionarClienteAoNegocio({ negocioId: dealA, contatoId: carlosB })
    expect(negocioAlheio.ok).toBe(false)
    if (!negocioAlheio.ok) expect(negocioAlheio.code).toBe('NAO_ENCONTRADO')

    const contatoAlheio = await adicionarClienteAoNegocio({ negocioId: dealB, contatoId: anaA })
    expect(contatoAlheio.ok).toBe(false)
    if (!contatoAlheio.ok) expect(contatoAlheio.code).toBe('NAO_ENCONTRADO')

    const remocaoAlheia = await removerClienteDoNegocio({ negocioId: dealA, contatoId: carlosB })
    expect(remocaoAlheia.ok).toBe(false)
    if (!remocaoAlheia.ok) expect(remocaoAlheia.code).toBe('NAO_ENCONTRADO')

    // O negócio de A continua com exatamente a linha principal dele.
    const listaA = await lerLista(A.tenantId, dealA)
    expect(listaA).toHaveLength(1)
    expect(listaA[0]).toMatchObject({ contactId: anaA, principal: true })
  })
})
