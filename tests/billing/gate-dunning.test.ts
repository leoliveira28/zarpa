/**
 * S13a — gate de dunning (`src/server/subscriptionGate.ts`) aplicado às Server Actions.
 *
 * Decisão de produto travada: quando a assinatura está `past_due`/`canceled`/`expired` ou
 * o trial venceu, o app fica READ-ONLY — leitura NUNCA bloqueada, escrita recusada com
 * `ASSINATURA_INATIVA` e correção apontando `/cobranca`.
 *
 * Mesmo padrão de `tests/billing/cobranca.test.ts` e `tests/deals/funil.test.ts`: chama
 * as funções REAIS de `src/server/**` contra o Postgres de teste, mockando só
 * `requireAuthContext` (sessão não existe fora de uma requisição HTTP). Nada de mock na
 * lógica sob teste — o gate roda de verdade, dentro do `withTenant` de verdade.
 *
 * Dois níveis:
 *   - `vereditoDaAssinatura` é função PURA exportada justamente para testar a tabela de
 *     decisão sem plantar linha nenhuma — cobertura completa da árvore, incluindo as
 *     fronteiras (`trialEndsAt` exatamente agora; status desconhecido; trial sem data).
 *   - O comportamento nas actions usa fixtures com assinatura plantada direto (o gate é
 *     código de aplicação, não RLS: plantar `past_due` direto no banco é o estado real de
 *     uma conta em dunning).
 *
 * Pontos do handoff (rafa-para-teo.md §S13a.1) cobertos:
 *  1. Tabela do veredito pura, inteira, com fronteiras.
 *  2. Trial vencido promove para `expired` e a promoção SOBREVIVE ao rollback da action
 *     (transação própria) + idempotência da segunda passada (audit não duplica).
 *  3. `past_due` recusa SEM promover — nada muda no banco.
 *  4. Leitura nunca bloqueada (`listarContatos`, `obterResumoDoMes`, `obterAssinaturaAtual`,
 *     `listarFaturas` com a conta bloqueada).
 *  5. `billing.ts` NÃO tem gate — `trocarPlano`/`cancelarAssinatura` funcionam com
 *     `past_due` (é o caminho de destravamento).
 *  6. Proposta pública NUNCA bloqueada (`obterPropostaPublica` lê e `aceitarOpcaoPublica`
 *     GRAVA com a conta bloqueada — o cliente da agente não paga a conta dela).
 *  7. Runners de sistema sem gate — `rodarFilaDeFollowups` continua escrevendo a régua.
 *  8. Isolamento: o gate lê a assinatura DENTRO do contexto de cada tenant — conta
 *     bloqueada de A não bloqueia B.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { and, eq, like } from 'drizzle-orm'
import {
  auditLog,
  contacts,
  deals,
  proposals,
  proposalOptions,
  subscriptions,
  tasks,
  tenants,
  user,
} from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'
import { unsafeDbWithoutTenant } from '@/db/client'

// ---------------------------------------------------------------------------
// Mock de sessão — mesmo padrão de tests/billing/cobranca.test.ts.
// ---------------------------------------------------------------------------

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: 'qa-gate-user',
  email: 'qa-gate@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { criarContato, listarContatos } = await import('@/server/contacts')
const {
  trocarPlano,
  cancelarAssinatura,
  obterAssinaturaAtual,
  listarFaturas,
} = await import('@/server/billing')
const { vereditoDaAssinatura, CORRECAO_COBRANCA } = await import('@/server/subscriptionGate')
const { obterPropostaPublica, aceitarOpcaoPublica } = await import('@/server/publicProposals')
const { obterResumoDoMes } = await import('@/server/dashboard')
const { rodarFilaDeFollowups } = await import('@/server/followups')

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const DIAS_EM_MS = 24 * 60 * 60 * 1000

type Fixture = { tenantId: string; userId: string }

async function seedTenant(): Promise<Fixture> {
  const tenantId = randomUUID()
  const userId = `qa-gate-${randomUUID()}`
  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: `Agência QA Gate ${tenantId.slice(0, 8)}`,
      slug: `qa-gate-${tenantId.slice(0, 8)}`,
    })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Gate Bot',
      email: `${userId}@exemplo-zarpa.com.br`,
    })
  })
  return { tenantId, userId }
}

function entrarComo(fixture: Pick<Fixture, 'tenantId' | 'userId'>): void {
  authCtx.tenantId = fixture.tenantId
  authCtx.userId = fixture.userId
}

let soloPlanId: string | null = null

/** Planta a assinatura do tenant no estado pedido — é o estado real de uma conta em dunning. */
async function plantarAssinatura(
  tenantId: string,
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired',
  opts: { trialEndsAt?: Date | null } = {},
): Promise<string> {
  const row = await withTenant(tenantId, async (tx) => {
    if (!soloPlanId) {
      const { plans } = await import('@/db/schema')
      const [p] = await tx.select({ id: plans.id }).from(plans).where(eq(plans.slug, 'solo')).limit(1)
      soloPlanId = p!.id
    }
    const [r] = await tx
      .insert(subscriptions)
      .values({
        tenantId,
        planId: soloPlanId,
        plan: 'solo',
        status,
        amountCents: 4900,
        billingCycle: 'monthly',
        trialEndsAt: opts.trialEndsAt ?? null,
      })
      .returning({ id: subscriptions.id })
    return r!
  })
  return row.id
}

/** O gate avalia a assinatura viva mais recente — ler por esse mesmo critério. */
async function statusDaAssinatura(tenantId: string): Promise<string | null> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId))
      .limit(1),
  )
  return row?.status ?? null
}

/** Contato plantado DIRETO (fora de action): dado que existia antes do bloqueio. O gate é
 * código de aplicação — nada no RLS impede este insert, e é exatamente isso que torna o
 * "somente leitura" uma promessa da camada de serviço, não do banco. */
async function plantarContato(tenantId: string, name: string): Promise<string> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx.insert(contacts).values({ tenantId, name }).returning({ id: contacts.id }),
  )
  return row!.id
}

async function contarContatos(tenantId: string): Promise<number> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.tenantId, tenantId)),
  )
  return rows.length
}

async function auditorias(tenantId: string, action: string): Promise<number> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, action))),
  )
  return rows.length
}

type PropostaFixture = { slug: string; optionId: string; propostaId: string }

/** Contato + negócio + proposta `sent` com uma opção — o mínimo para o link público existir. */
async function seedPropostaPublicavel(
  tenantId: string,
  opts: { sentAt?: Date } = {},
): Promise<PropostaFixture> {
  return withTenant(tenantId, async (tx) => {
    const [contact] = await tx
      .insert(contacts)
      .values({ tenantId, name: 'Cliente QA Gate' })
      .returning({ id: contacts.id })
    const [deal] = await tx
      .insert(deals)
      .values({
        tenantId,
        contactId: contact!.id,
        title: 'Negócio QA gate',
        destination: 'Lisboa',
      })
      .returning({ id: deals.id })
    const slug = randomUUID() // 36 chars, [A-Za-z0-9_-] — passa no slugSchema da página pública
    const [proposta] = await tx
      .insert(proposals)
      .values({
        tenantId,
        dealId: deal!.id,
        publicToken: slug,
        title: 'Proposta QA gate',
        status: 'sent',
        sentAt: opts.sentAt ?? new Date(),
      })
      .returning({ id: proposals.id })
    const [opcao] = await tx
      .insert(proposalOptions)
      .values({ tenantId, proposalId: proposta!.id, name: 'Econômica', priceCents: 350000 })
      .returning({ id: proposalOptions.id })
    return { slug, optionId: opcao!.id, propostaId: proposta!.id }
  })
}

const criados: string[] = []

afterAll(async () => {
  for (const tenantId of criados) {
    try {
      // Cascade em subscriptions/contacts/deals/proposals/tasks/audit/user.
      await withTenant(tenantId, (tx) => tx.delete(tenants).where(eq(tenants.id, tenantId)))
    } catch {
      // best-effort — o globalSetup recria o schema a cada rodada
    }
  }
})

// ---------------------------------------------------------------------------
// 1. Tabela pura do veredito — sem banco, sem fixture, toda a árvore de decisão
// ---------------------------------------------------------------------------

describe('vereditoDaAssinatura — tabela pura de decisão (sem banco)', () => {
  const agora = new Date('2026-09-07T12:00:00.000Z')

  it('a correção do gate é sempre o botão que leva a /cobranca', () => {
    expect(CORRECAO_COBRANCA).toBe('Ir para Cobrança')
  })

  it('assinatura inexistente (null) → PASSA (agente pode estar antes do primeiro registro)', () => {
    expect(vereditoDaAssinatura(null, agora)).toEqual({ permite: true })
  })

  it('trialing com trialEndsAt futuro → PASSA', () => {
    const assinatura = { status: 'trialing', trialEndsAt: new Date(agora.getTime() + DIAS_EM_MS) }
    expect(vereditoDaAssinatura(assinatura, agora)).toEqual({ permite: true })
  })

  it('trialing SEM trialEndsAt → PASSA (fail-open: punição não nasce de dado faltando)', () => {
    // `trocarPlano` em modo dev cria assinatura trialing sem data — fail-closed aqui
    // seria bloquear quem não deve nada por causa de dado incompleto.
    expect(vereditoDaAssinatura({ status: 'trialing', trialEndsAt: null }, agora)).toEqual({
      permite: true,
    })
  })

  it('trialing com trialEndsAt que vence EXATAMENTE agora → RECUSA (o corte é estritamente >)', () => {
    const veredito = vereditoDaAssinatura({ status: 'trialing', trialEndsAt: agora }, agora)
    expect(veredito).toEqual({
      permite: false,
      motivo: 'trial_expirado',
      mensagem: 'Seu teste gratuito acabou.',
    })
  })

  it('trialing com trialEndsAt no passado → RECUSA trial_expirado', () => {
    const assinatura = { status: 'trialing', trialEndsAt: new Date(agora.getTime() - 1) }
    expect(vereditoDaAssinatura(assinatura, agora)).toEqual({
      permite: false,
      motivo: 'trial_expirado',
      mensagem: 'Seu teste gratuito acabou.',
    })
  })

  it('active → PASSA', () => {
    expect(vereditoDaAssinatura({ status: 'active', trialEndsAt: null }, agora)).toEqual({
      permite: true,
    })
  })

  it('past_due → RECUSA com a mensagem de atraso', () => {
    expect(vereditoDaAssinatura({ status: 'past_due', trialEndsAt: null }, agora)).toEqual({
      permite: false,
      motivo: 'past_due',
      mensagem: 'Sua assinatura está em atraso — o app está em modo somente leitura.',
    })
  })

  it('canceled → RECUSA com a mensagem de cancelamento', () => {
    expect(vereditoDaAssinatura({ status: 'canceled', trialEndsAt: null }, agora)).toEqual({
      permite: false,
      motivo: 'canceled',
      mensagem: 'Sua assinatura está cancelada — o app está em modo somente leitura.',
    })
  })

  it('expired → RECUSA com a mensagem do trial', () => {
    expect(vereditoDaAssinatura({ status: 'expired', trialEndsAt: null }, agora)).toEqual({
      permite: false,
      motivo: 'expired',
      mensagem: 'Seu teste gratuito acabou.',
    })
  })

  it('status desconhecido → PASSA (a cerca erra para o lado de deixar passar com dado novo)', () => {
    // O enum do banco impede status estranho hoje, mas o gate é uma cerca que vai viver
    // mais que este enum — o contrato para dado novo é fail-open, não erro.
    expect(vereditoDaAssinatura({ status: 'plano_secreto', trialEndsAt: null }, agora)).toEqual({
      permite: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 2. O gate na escrita — a mesma assinatura, agora com banco e action de verdade
// ---------------------------------------------------------------------------

describe('gate na escrita — criarContato com a conta em cada estado', () => {
  it('trial futuro PASSA', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    await plantarAssinatura(fixture.tenantId, 'trialing', {
      trialEndsAt: new Date(Date.now() + 7 * DIAS_EM_MS),
    })
    entrarComo(fixture)

    const r = await criarContato({ name: 'Cliente Trial Futuro' })
    expect(r.ok, !r.ok ? r.mensagem : '').toBe(true)
    expect(await contarContatos(fixture.tenantId)).toBe(1)
  })

  it('active PASSA', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    await plantarAssinatura(fixture.tenantId, 'active')
    entrarComo(fixture)

    const r = await criarContato({ name: 'Cliente Ativo' })
    expect(r.ok, !r.ok ? r.mensagem : '').toBe(true)
    expect(await contarContatos(fixture.tenantId)).toBe(1)
  })

  it('sem assinatura nenhuma PASSA (a decisão pura `null` vale no banco de verdade)', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await criarContato({ name: 'Cliente Sem Assinatura' })
    expect(r.ok, !r.ok ? r.mensagem : '').toBe(true)
    expect(await contarContatos(fixture.tenantId)).toBe(1)
  })

  it('past_due RECUSA: ASSINATURA_INATIVA, correção /cobranca, nada gravado e nada promovido', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    await plantarAssinatura(fixture.tenantId, 'past_due')
    entrarComo(fixture)

    const r = await criarContato({ name: 'Cliente Bloqueado' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('ASSINATURA_INATIVA')
    expect(r.mensagem).toBe('Sua assinatura está em atraso — o app está em modo somente leitura.')
    expect(r.correcao).toBe(CORRECAO_COBRANCA)

    // O gate é a PRIMEIRA linha do withTenant: a recusa sobe antes de qualquer escrita e
    // a transação fecha vazio — o contato não existe, e não existe audit de tentativa.
    expect(await contarContatos(fixture.tenantId)).toBe(0)
    expect(await auditorias(fixture.tenantId, 'contact.created')).toBe(0)

    // past_due NÃO promove para nada — só trial vencido é promovido.
    expect(await statusDaAssinatura(fixture.tenantId)).toBe('past_due')
    expect(await auditorias(fixture.tenantId, 'subscription.expired')).toBe(0)
  })

  it('canceled RECUSA com a mensagem de cancelamento', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    await plantarAssinatura(fixture.tenantId, 'canceled')
    entrarComo(fixture)

    const r = await criarContato({ name: 'Cliente Cancelada' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('ASSINATURA_INATIVA')
    expect(r.mensagem).toBe('Sua assinatura está cancelada — o app está em modo somente leitura.')
    expect(r.correcao).toBe(CORRECAO_COBRANCA)
    expect(await contarContatos(fixture.tenantId)).toBe(0)
  })

  it('expired RECUSA com a mensagem do trial', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    await plantarAssinatura(fixture.tenantId, 'expired')
    entrarComo(fixture)

    const r = await criarContato({ name: 'Cliente Expirada' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('ASSINATURA_INATIVA')
    expect(r.mensagem).toBe('Seu teste gratuito acabou.')
    expect(r.correcao).toBe(CORRECAO_COBRANCA)
    expect(await contarContatos(fixture.tenantId)).toBe(0)
  })

  it('trial vencido RECUSA e PROMOVE para expired — a promoção sobrevive ao rollback da action', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    const subscriptionId = await plantarAssinatura(fixture.tenantId, 'trialing', {
      trialEndsAt: new Date(Date.now() - DIAS_EM_MS), // venceu ontem
    })
    entrarComo(fixture)

    const r = await criarContato({ name: 'Cliente Trial Vencido' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('ASSINATURA_INATIVA')
    expect(r.mensagem).toBe('Seu teste gratuito acabou.')

    // A parte não-óbvia: a action fez ROLLBACK (nenhum contato, nenhum audit de contato),
    // mas a promoção rodou numa transação PRÓPRIA — o banco aprendeu que o trial acabou.
    expect(await contarContatos(fixture.tenantId)).toBe(0)
    expect(await auditorias(fixture.tenantId, 'contact.created')).toBe(0)
    expect(await statusDaAssinatura(fixture.tenantId)).toBe('expired')

    const promo = await withTenant(fixture.tenantId, (tx) =>
      tx
        .select({ metadata: auditLog.metadata, actorUserId: auditLog.actorUserId, entityId: auditLog.entityId })
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, fixture.tenantId), eq(auditLog.action, 'subscription.expired'))),
    )
    expect(promo).toHaveLength(1)
    expect(promo[0]!.metadata).toEqual({ motivo: 'trial_expirado', origem: 'gate_dunning' })
    expect(promo[0]!.actorUserId).toBeNull() // é o motor de dunning, não a agente
    expect(promo[0]!.entityId).toBe(subscriptionId)
  })

  it('a promoção é IDEMPOTENTE: segunda tentativa recusa de novo e o audit continua em 1', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    await plantarAssinatura(fixture.tenantId, 'trialing', {
      trialEndsAt: new Date(Date.now() - DIAS_EM_MS),
    })
    entrarComo(fixture)

    const primeira = await criarContato({ name: 'Cliente Primeira Recusa' })
    expect(primeira.ok).toBe(false)
    expect(await statusDaAssinatura(fixture.tenantId)).toBe('expired')
    expect(await auditorias(fixture.tenantId, 'subscription.expired')).toBe(1)

    const segunda = await criarContato({ name: 'Cliente Segunda Recusa' })
    expect(segunda.ok).toBe(false)
    if (!segunda.ok) {
      expect(segunda.code).toBe('ASSINATURA_INATIVA')
      expect(segunda.mensagem).toBe('Seu teste gratuito acabou.')
    }
    // A guarda `WHERE status = 'trialing'` fez o segundo UPDATE afetar zero linhas —
    // nenhum audit duplicado.
    expect(await auditorias(fixture.tenantId, 'subscription.expired')).toBe(1)
    expect(await statusDaAssinatura(fixture.tenantId)).toBe('expired')
  })
})

// ---------------------------------------------------------------------------
// 3. Leitura NUNCA bloqueada — read-only significa que a agente VÊ tudo
// ---------------------------------------------------------------------------

describe('leitura nunca bloqueada — a mesma assinatura past_due não impede ler', () => {
  it('listarContatos continua devolvendo dado com a conta bloqueada', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    await plantarAssinatura(fixture.tenantId, 'past_due')
    const contatoId = await plantarContato(fixture.tenantId, 'Cliente Visível')
    entrarComo(fixture)

    const r = await listarContatos()
    expect(r.ok, !r.ok ? r.mensagem : '').toBe(true)
    if (!r.ok) return
    const visivel = r.data.find((c) => c.id === contatoId)
    expect(visivel, 'a agente em atraso perdeu a própria lista — leitura foi bloqueada').toBeDefined()
    expect(visivel!.name).toBe('Cliente Visível')
  })

  it('obterResumoDoMes e listarFaturas respondem com a conta bloqueada', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    await plantarAssinatura(fixture.tenantId, 'past_due')
    entrarComo(fixture)

    const resumo = await obterResumoDoMes()
    expect(resumo.ok, !resumo.ok ? resumo.mensagem : '').toBe(true)

    const faturas = await listarFaturas()
    expect(faturas.ok, !faturas.ok ? faturas.mensagem : '').toBe(true)
    if (faturas.ok) expect(faturas.data).toEqual([])
  })

  it('obterAssinaturaAtual devolve o estado bloqueado (a tela /cobranca precisa dele para destravar)', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    await plantarAssinatura(fixture.tenantId, 'past_due')
    entrarComo(fixture)

    const r = await obterAssinaturaAtual()
    expect(r.ok, !r.ok ? r.mensagem : '').toBe(true)
    if (!r.ok) return
    expect(r.data).not.toBeNull()
    expect(r.data!.status).toBe('past_due')
    expect(r.data!.plano?.slug).toBe('solo')
  })
})

// ---------------------------------------------------------------------------
// 4. billing.ts NÃO tem o gate — é o caminho de destravamento do dunning
// ---------------------------------------------------------------------------

describe('billing sem gate — trocarPlano/cancelarAssinatura funcionam com a conta past_due', () => {
  it('trocarPlano atualiza o plano com a conta em past_due (e não mexe no status bloqueado)', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    await plantarAssinatura(fixture.tenantId, 'past_due')
    entrarComo(fixture)

    const { plans } = await import('@/db/schema')
    const [planoPro] = await unsafeDbWithoutTenant.select().from(plans).where(eq(plans.slug, 'pro')).limit(1)
    expect(planoPro).toBeDefined()

    const r = await trocarPlano({ planId: planoPro!.id })
    expect(r.ok, !r.ok ? `${r.code}: ${r.mensagem}` : '').toBe(true)
    if (!r.ok) return
    // A assinatura continua em atraso — regularizar o status é trabalho do webhook/pagamento,
    // não da troca de plano. O que importa aqui é que a action NÃO recusou.
    expect(r.data.status).toBe('past_due')
    expect(r.data.plano?.slug).toBe('pro')
    expect(await statusDaAssinatura(fixture.tenantId)).toBe('past_due')
  })

  it('cancelarAssinatura funciona com a conta em past_due (a agente pode desistir com dívida aberta)', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    await plantarAssinatura(fixture.tenantId, 'past_due')
    entrarComo(fixture)

    const r = await cancelarAssinatura()
    expect(r.ok, !r.ok ? `${r.code}: ${r.mensagem}` : '').toBe(true)
    if (!r.ok) return
    expect(r.data?.status).toBe('canceled')
    expect(r.data?.canceledAt).not.toBeNull()
    expect(await statusDaAssinatura(fixture.tenantId)).toBe('canceled')
  })
})

// ---------------------------------------------------------------------------
// 5. Proposta pública NUNCA bloqueada — quem lê é o CLIENTE da agente
// ---------------------------------------------------------------------------

describe('proposta pública nunca bloqueada pela assinatura', () => {
  it('obterPropostaPublica devolve a proposta com a conta em past_due', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    await plantarAssinatura(fixture.tenantId, 'past_due')
    const { slug } = await seedPropostaPublicavel(fixture.tenantId)

    // Sem sessão mockada de propósito: a leitura pública não passa por requireAuthContext.
    const r = await obterPropostaPublica(slug)
    expect(r.ok, !r.ok ? r.mensagem : '').toBe(true)
    if (!r.ok) return
    expect(r.data).not.toBeNull()
    expect(r.data!.options).toHaveLength(1)
    expect(r.data!.options[0]!.name).toBe('Econômica')
  })

  it('aceitarOpcaoPublica GRAVA o aceite com a conta em past_due (SECURITY DEFINER não passa pelo gate)', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    await plantarAssinatura(fixture.tenantId, 'past_due')
    const { slug, optionId, propostaId } = await seedPropostaPublicavel(fixture.tenantId)

    const r = await aceitarOpcaoPublica({ slug, optionId })
    expect(r.ok, !r.ok ? r.mensagem : '').toBe(true)
    if (!r.ok) return

    // O aceite do cliente é uma ESCRITA — e mesmo assim acontece: o dunning não pode
    // custar a venda da agente. É exatamente a escrita que o gate NÃO pode pegar.
    const [proposta] = await withTenant(fixture.tenantId, (tx) =>
      tx
        .select({ status: proposals.status, acceptedOptionId: proposals.acceptedOptionId, acceptedAt: proposals.acceptedAt })
        .from(proposals)
        .where(eq(proposals.id, propostaId)),
    )
    expect(proposta!.status).toBe('accepted')
    expect(proposta!.acceptedOptionId).toBe(optionId)
    expect(proposta!.acceptedAt).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 6. Runners de sistema NÃO recebem o gate — a régua de follow-up não é ação da agente
// ---------------------------------------------------------------------------

describe('runners de sistema sem gate — rodarFilaDeFollowups escreve com a conta bloqueada', () => {
  it('a régua D+2/D+5/D+10 nasce mesmo com a assinatura em past_due', async () => {
    const fixture = await seedTenant()
    criados.push(fixture.tenantId)
    await plantarAssinatura(fixture.tenantId, 'past_due')
    const sentAt = new Date(Date.now() - 3 * DIAS_EM_MS) // "sexta passada" — dentro da janela
    const { propostaId } = await seedPropostaPublicavel(fixture.tenantId, { sentAt })

    const r = await rodarFilaDeFollowups()
    expect(r.ok, !r.ok ? r.mensagem : '').toBe(true)

    // Conta no banco, não no retorno: o runner varre TODOS os tenants, e o que importa
    // aqui é que as tarefas DESTE tenant (bloqueado) nasceram.
    const geradas = await withTenant(fixture.tenantId, (tx) =>
      tx
        .select({ dedupeKey: tasks.dedupeKey })
        .from(tasks)
        .where(like(tasks.dedupeKey, `followup:proposta:${propostaId}:%`)),
    )
    expect(geradas).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// 7. Isolamento — o gate lê a assinatura DENTRO do contexto de cada tenant
// ---------------------------------------------------------------------------

describe('isolamento — a conta bloqueada de A não bloqueia B', () => {
  it('A em past_due recusa, B com trial futuro passa, e nada de A é tocado por B', async () => {
    const fixtureA = await seedTenant()
    const fixtureB = await seedTenant()
    criados.push(fixtureA.tenantId, fixtureB.tenantId)
    await plantarAssinatura(fixtureA.tenantId, 'past_due')
    await plantarAssinatura(fixtureB.tenantId, 'trialing', {
      trialEndsAt: new Date(Date.now() + 7 * DIAS_EM_MS),
    })

    entrarComo(fixtureA)
    const recusa = await criarContato({ name: 'Cliente de A' })
    expect(recusa.ok).toBe(false)
    if (!recusa.ok) expect(recusa.code).toBe('ASSINATURA_INATIVA')

    entrarComo(fixtureB)
    const passagem = await criarContato({ name: 'Cliente de B' })
    expect(passagem.ok, !passagem.ok ? passagem.mensagem : '').toBe(true)

    // A leitura do gate é tenant-scoped (RLS em `subscriptions` dentro do withTenant de
    // cada um): se vazasse, a assinatura past_due de A teria bloqueado B também.
    expect(await contarContatos(fixtureB.tenantId)).toBe(1)
    expect(await contarContatos(fixtureA.tenantId)).toBe(0)
    expect(await statusDaAssinatura(fixtureA.tenantId)).toBe('past_due')
    expect(await statusDaAssinatura(fixtureB.tenantId)).toBe('trialing')
  })
})
