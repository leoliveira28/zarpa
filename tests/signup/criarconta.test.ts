/**
 * S13a — cadastro público: `criarConta` (`src/server/signup.ts`) e `criarTenant`
 * (`src/server/tenants.ts`).
 *
 * Mesma filosofia de `tests/billing/cobranca.test.ts`: chama as funções REAIS contra o
 * Postgres de teste (o `authDb`/`unsafeDbWithoutTenant` de `src/db` apontam para
 * `TEST_DATABASE_URL` porque o vitest roda com `NODE_ENV=test`). O que é mockado aqui é
 * UMA coisa só, e de propósito:
 *
 *   - `@/lib/auth/auth` — o objeto Better Auth é embrulhado num Proxy que delega TUDO ao
 *     módulo real, interceptando só `auth.api.signUpEmail` quando o teste arma o
 *     interceptador. O caminho feliz NÃO é mockado: o usuário nasce de verdade, com hash
 *     de senha de verdade, via Better Auth de verdade. O interceptador existe para forçar
 *     a falha do `signUpEmail` DEPOIS do tenant ter nascido — é a única forma
 *     determinística de exercer a compensação (`desfazerTenant`), que é justamente o
 *     caminho que o Rafa não conseguiu exercer ao vivo (ver docs/status/rafa.md, "Riscos").
 *
 *   - `@/lib/auth/session` — mock que LANÇA se chamado: `criarConta` é o único caminho
 *     sem sessão que cria tenant. Se algum dia um `requireAuthContext()` aparecer no
 *     meio deste fluxo, o teste falha dizendo onde.
 *
 * Pontos do handoff cobertos (rafa-para-teo.md §S13a.2):
 *  1. Tenant + assinatura trial + audit na MESMA transação; usuário Better Auth logo
 *     depois; trial = 14 dias, idêntico em `tenants` e `subscriptions`, `amountCents` do
 *     catálogo `plans`, `planId` preenchido.
 *  2. E-mail duplicado → `CONFLITO` campo `email`, sem tenant órfão. Inclui a corrida
 *     real (duplo submit) — `Promise.all` com o MESMO input.
 *  3. Compensação: `signUpEmail` falhando APÓS o tenant nascer apaga o tenant (CASCADE
 *     leva assinatura + audit) — nos dois sabores de erro (genérico e "already exists").
 *  4. Regressão do bug latente: pré-cheque de slug sob FORCE RLS não pode ser código
 *     morto — colisão de slug vira `CONFLITO` amigável, NUNCA o 23505 cru. Direto e em
 *     corrida, mais o sufixo `-2` do `criarConta` e o esgotamento das 10 tentativas.
 *  5. PII: a senha não sai em retorno, audit, `user`, `session` nem `account`; metadata
 *     do audit é `{ plano, trialDias }`.
 *  6. Isolamento: `tenantId` no corpo é ignorado — o tenant nasce aqui dentro (zod
 *     descarta o campo; o usuário recebe o tenant por `withPendingTenant`, nunca do
 *     corpo).
 */
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { auditLog, plans, subscriptions, tenants, user } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'
import { authDb, authSql } from '@/lib/auth/db'
import type { CriarContaInput } from '@/server/signup'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/**
 * Interceptador do `signUpEmail`. Desligado por padrão — o caminho feliz usa o Better
 * Auth real. `afterEach` reseta, porque mock que vaza para o teste seguinte é teste que
 * testa o próprio mock.
 */
const interceptador = vi.hoisted(() => ({
  ligado: false,
  erro: null as Error | null,
}))

vi.mock('@/lib/auth/auth', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/auth/auth')>()
  return {
    ...real,
    auth: new Proxy(real.auth, {
      get(alvo, prop, receptor) {
        if (prop !== 'api') return Reflect.get(alvo, prop, receptor)
        const api = Reflect.get(alvo, 'api', receptor)
        return new Proxy(api, {
          get(alvoApi, propApi, receptorApi) {
            if (propApi === 'signUpEmail' && interceptador.ligado && interceptador.erro) {
              return async () => {
                throw interceptador.erro
              }
            }
            return Reflect.get(alvoApi, propApi, receptorApi)
          },
        })
      },
    }) as typeof real.auth,
  }
})

/**
 * O cadastro público é o único fluxo de criação de conta que NÃO tem sessão. O mock
 * lança de propósito: se `criarConta`/`criarTenant` um dia chamarem
 * `requireAuthContext`, este teste quebra apontando o vazamento — não deixa passar.
 */
vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async (): Promise<never> => {
    throw new Error('criarConta é o caminho SEM sessão — requireAuthContext não deveria ser chamado aqui')
  },
  getAuthContext: async () => null,
}))

const { criarConta } = await import('@/server/signup')
const { criarTenant } = await import('@/server/tenants')
const { slugificar } = await import('@/server/normalize')
const { ServiceError } = await import('@/server/errors')

// ---------------------------------------------------------------------------
// Fixture e limpeza
// ---------------------------------------------------------------------------

const DIAS_EM_MS = 24 * 60 * 60 * 1000
const SENHA = 'senha-forte-de-teste-123'

/** Sufixo aleatório: dois testes nunca disputam o mesmo slug/e-mail, nem entre rodadas. */
function unico(prefixo: string): string {
  return `${prefixo}-${randomUUID().slice(0, 8)}`
}

function conta(overrides: Partial<CriarContaInput> = {}): CriarContaInput {
  return {
    nomeAgente: 'Marina QA',
    email: `${unico('qa-signup')}@exemplo-zarpa.test`,
    senha: SENHA,
    nomeAgencia: `Agência ${unico('Mare Alta')}`,
    ...overrides,
  }
}

/**
 * Tenants (e o que pendurar neles) a apagar no fim. `session`/`account`/`verification`
 * só são visíveis com `app.auth_context=on` — apago pelo pool de auth (`authSql`) antes
 * de apagar o tenant, para o CASCADE nunca depender de RLS em tabela de credencial.
 */
const limpeza: string[] = []

async function limparTenant(tenantId: string): Promise<void> {
  await authSql`delete from "session" where user_id in (select id from "user" where tenant_id = ${tenantId})`
  await authSql`delete from "account" where user_id in (select id from "user" where tenant_id = ${tenantId})`
  await authSql`delete from "verification" where user_id in (select id from "user" where tenant_id = ${tenantId})`
  await authSql`delete from "user" where tenant_id = ${tenantId}`
  await withTenant(tenantId, (tx) => tx.delete(tenants).where(eq(tenants.id, tenantId)))
}

afterEach(() => {
  interceptador.ligado = false
  interceptador.erro = null
})

afterAll(async () => {
  for (const tenantId of limpeza) {
    try {
      await limparTenant(tenantId)
    } catch {
      // best-effort — o globalSetup recria o schema a cada rodada de qualquer forma
    }
  }
  await authSql.end({ timeout: 5 })
})

// ---------------------------------------------------------------------------
// 1. A conta inteira numa chamada — tenant + trial + usuário, atômico
// ---------------------------------------------------------------------------

describe('criarConta — cria a conta inteira numa chamada', () => {
  it('nasce tenant (trialing) + assinatura trial de 14 dias + usuário Better Auth + audit, na mesma chamada', async () => {
    const input = conta()
    const antes = Date.now()
    const resultado = await criarConta(input)
    const depois = Date.now()

    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)
    if (!resultado.ok) return
    const { tenantId, userId, slug, nomeAgencia, email } = resultado.data
    limpeza.push(tenantId)

    // Retorno: exatamente as chaves do contrato — sem hash, sem token, sem campo a mais
    // que um dia poderia carregar credencial.
    expect(Object.keys(resultado.data).sort()).toEqual([
      'email',
      'nomeAgencia',
      'slug',
      'tenantId',
      'userId',
    ])
    expect(userId).toBeTruthy()
    expect(nomeAgencia).toBe(input.nomeAgencia)
    expect(email).toBe(input.email)
    expect(slug).toBe(slugificar(input.nomeAgencia))

    // Tenant: fotografia do estado da conta.
    const [tenant] = await authDb.select().from(tenants).where(eq(tenants.id, tenantId))
    expect(tenant).toBeDefined()
    expect(tenant!.status).toBe('trialing')
    expect(tenant!.plan).toBe('solo')
    expect(tenant!.name).toBe(input.nomeAgencia)
    expect(tenant!.contactEmail).toBe(input.email)

    // Assinatura: o que o gate de dunning avalia. `amountCents` vem do CATÁLOGO `plans`
    // (não da tabela fixa) e `planId` nasce preenchido.
    const [assinatura] = await withTenant(tenantId, (tx) =>
      tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)),
    )
    expect(assinatura).toBeDefined()
    expect(assinatura!.status).toBe('trialing')
    expect(assinatura!.plan).toBe('solo')
    expect(assinatura!.planId).toBeTruthy()
    const [planoSolo] = await authDb.select().from(plans).where(eq(plans.slug, 'solo'))
    expect(assinatura!.planId).toBe(planoSolo!.id)
    expect(assinatura!.amountCents).toBe(planoSolo!.priceCents)
    expect(assinatura!.amountCents).toBe(4900)
    expect(assinatura!.billingCycle).toBe('monthly')

    // Trial = 14 dias corridos, com drift limitado à própria chamada (não comparo contra
    // um segundo `new Date()` dentro da asserção — é assim que teste passa por acaso).
    const janela = 14 * DIAS_EM_MS
    const trial = assinatura!.trialEndsAt!.getTime()
    expect(trial).toBeGreaterThanOrEqual(antes + janela)
    expect(trial).toBeLessThanOrEqual(depois + janela)
    // `tenants.trialEndsAt` e `subscriptions.trialEndsAt` são O MESMO valor (mesmo Date
    // gravado nas duas — divergência aqui seria duas fontes de verdade de trial).
    expect(tenant!.trialEndsAt!.getTime()).toBe(trial)

    // Usuário Better Auth de verdade (não mockado): hash de senha, tenant certo.
    const [usuario] = await authDb.select().from(user).where(eq(user.id, userId!))
    expect(usuario).toBeDefined()
    expect(usuario!.tenantId).toBe(tenantId) // entra por withPendingTenant, nunca do corpo
    expect(usuario!.email).toBe(input.email)
    expect(usuario!.name).toBe(input.nomeAgente)
    expect(usuario!.role).toBe('owner')

    // Audit `account.created` na MESMA transação do tenant — metadata sem PII.
    const auditorias = await withTenant(tenantId, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.tenantId, tenantId)),
    )
    const criacao = auditorias.filter((a) => a.action === 'account.created')
    expect(criacao).toHaveLength(1)
    expect(criacao[0]!.entity).toBe('tenant')
    expect(criacao[0]!.entityId).toBe(tenantId)
    expect(criacao[0]!.actorUserId).toBeNull() // o usuário ainda não existia
    expect(criacao[0]!.metadata).toEqual({ plano: 'solo', trialDias: 14 })
  })

  it('a senha em claro não aparece em NENHUM artefato gravado (retorno, audit, user, account, session)', async () => {
    const input = conta()
    const resultado = await criarConta(input)
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)
    if (!resultado.ok) return
    const { tenantId, userId, email } = resultado.data
    limpeza.push(tenantId)

    expect(JSON.stringify(resultado.data)).not.toContain(SENHA)

    const auditorias = await withTenant(tenantId, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.tenantId, tenantId)),
    )
    for (const a of auditorias) {
      const texto = JSON.stringify(a)
      expect(texto, `audit ${a.action} carrega a senha`).not.toContain(SENHA)
      // e-mail também não vai para o audit (metadata é { plano, trialDias }).
      expect(texto, `audit ${a.action} carrega o e-mail`).not.toContain(email)
    }

    const [usuario] = await authDb.select().from(user).where(eq(user.id, userId!))
    expect(JSON.stringify(usuario)).not.toContain(SENHA)

    // Onde a senha DEVE estar é no `account`, mas como hash — nunca em claro.
    const contas = await authSql`
      select * from "account" where user_id = ${userId}
    `
    for (const contaAuth of contas) {
      expect(JSON.stringify(contaAuth)).not.toContain(SENHA)
    }

    const sessoes = await authSql`select * from "session" where user_id = ${userId}`
    for (const sessao of sessoes) {
      expect(JSON.stringify(sessao)).not.toContain(SENHA)
    }
  })

  it('tenantId no corpo é IGNORADO — o tenant nasce aqui dentro, nunca vem do input', async () => {
    // Tenant "da vítima" plantado fora: se o cadastro aceitasse `tenantId` do corpo, a
    // conta nova nasceria DENTRO dele. É o ataque que `input: false` + `withPendingTenant`
    // existem para impedir — o teste prova o comportamento de ponta a ponta.
    const tenantAlheio = randomUUID()
    await withTenant(tenantAlheio, (tx) =>
      tx.insert(tenants).values({ id: tenantAlheio, name: 'Tenant Alheio QA', slug: unico('qa-alheio') }),
    )
    limpeza.push(tenantAlheio)

    const input = conta()
    // O zod do `criarConta` não conhece `tenantId` — a chave extra é descartada. O cast
    // existe para simular exatamente o corpo que um cliente malicioso mandaria.
    const resultado = await criarConta({ ...input, tenantId: tenantAlheio } as CriarContaInput)
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)
    if (!resultado.ok) return
    limpeza.push(resultado.data.tenantId)

    expect(resultado.data.tenantId).not.toBe(tenantAlheio)
    const [usuario] = await authDb
      .select()
      .from(user)
      .where(eq(user.id, resultado.data.userId!))
    expect(usuario!.tenantId).toBe(resultado.data.tenantId)

    // E o tenant alheio ficou intocado: nenhuma conta nova nasceu dentro dele.
    const usuariosNoAlheio = await authSql`
      select count(*)::int as n from "user" where tenant_id = ${tenantAlheio}
    `
    expect(usuariosNoAlheio[0]!.n).toBe(0)
  })

  it('input inválido recusa ANTES de criar qualquer coisa (senha curta → DADOS_INVALIDOS campo senha)', async () => {
    const input = conta({ senha: 'curta' })
    const resultado = await criarConta(input)
    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.code).toBe('DADOS_INVALIDOS')
    expect(resultado.campo).toBe('senha')
    expect(resultado.correcao).toBeTruthy()

    // Nada nasceu: nem tenant, nem usuário — a recusa é anterior a qualquer escrita.
    const orfaos = await authDb
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.contactEmail, input.email))
    expect(orfaos).toHaveLength(0)
    const usuarios = await authDb.select({ id: user.id }).from(user).where(eq(user.email, input.email))
    expect(usuarios).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 2. E-mail duplicado — mensagem decente, sem tenant órfão (pré-cheque + corrida)
// ---------------------------------------------------------------------------

describe('criarConta — e-mail duplicado', () => {
  it('segunda conta com o mesmo e-mail → CONFLITO campo email, sem tenant órfão (pré-cheque compara forma canônica)', async () => {
    // Primeira conta com e-mail em caixa mista; a duplicata vem todo minúsculo. O
    // pré-cheque compara a forma canônica (lowercase) — se regredir para comparação
    // crua, este teste pega pelo caminho do catch do Better Auth, que devolve o MESMO
    // contrato (por isso a asserção não depende de qual dos dois caminhos respondeu).
    const email = `${unico('qa-duplicado')}@Exemplo-Zarpa.TEST`
    const primeira = await criarConta(conta({ email, nomeAgencia: `Agência ${unico('Primeira')}` }))
    expect(primeira.ok, !primeira.ok ? primeira.mensagem : '').toBe(true)
    if (!primeira.ok) return
    limpeza.push(primeira.data.tenantId)

    const segunda = await criarConta(conta({ email: email.toLowerCase(), nomeAgencia: `Agência ${unico('Segunda')}` }))
    expect(segunda.ok).toBe(false)
    if (segunda.ok) return
    expect(segunda.code).toBe('CONFLITO')
    expect(segunda.campo).toBe('email')
    expect(segunda.mensagem).toBe('Já existe uma conta com esse e-mail.')
    expect(segunda.correcao).toBe('Entrar com esse e-mail em /entrar')

    // Nada nasceu da segunda tentativa: 1 usuário e 1 tenant, não 2.
    const usuarios = await authDb.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()))
    expect(usuarios).toHaveLength(1)
    const donos = await authDb
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.contactEmail, email.toLowerCase()))
    expect(donos).toHaveLength(1)
  })

  it('corrida real (duplo submit, MESMO input): uma conta vence, a outra compensa — 1 usuário, 1 tenant, nenhum órfão', async () => {
    // O cenário de verdade do produto: a agente toca "Criar conta" duas vezes antes da
    // resposta chegar. As duas chamadas passam pelo pré-cheque (o e-mail ainda não
    // existe), criam tenant cada uma, e só uma vence o `signUpEmail` — a outra tem que
    // APAGAR o próprio tenant (compensação) ou recusar no pré-cheque. O contrato que
    // importa é o estado FINAL do banco, não qual chamada ganhou.
    const input = conta({ nomeAgencia: `Agência ${unico('Corrida')}` })
    const resultados = await Promise.all([
      criarConta(input),
      criarConta({ ...input }),
    ])

    const vencedoras = resultados.filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
    const perdedoras = resultados.filter((r): r is Extract<typeof r, { ok: false }> => !r.ok)
    expect(vencedoras, 'exatamente uma chamada vence a corrida').toHaveLength(1)
    for (const r of perdedoras) {
      expect(r.code, 'a perdedora recusa com CONFLITO, não com erro cru').toBe('CONFLITO')
    }
    const vencedora = vencedoras[0]!
    limpeza.push(vencedora.data.tenantId)

    // Verdade do banco depois da poeira baixar: 1 usuário, 1 tenant — o tenant da
    // perdedora foi apagado pela compensação (ou nem nasceu, se o pré-cheque pegou).
    const email = input.email.toLowerCase()
    const usuarios = await authDb.select({ id: user.id }).from(user).where(eq(user.email, email))
    expect(usuarios).toHaveLength(1)
    const donos = await authDb
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.contactEmail, email))
    expect(donos).toHaveLength(1)
    expect(donos[0]!.id).toBe(vencedora.data.tenantId)
  })
})

// ---------------------------------------------------------------------------
// 3. Compensação — signUpEmail falha DEPOIS do tenant nascer
// ---------------------------------------------------------------------------

describe('criarConta — compensação quando signUpEmail falha', () => {
  it('falha genérica após o tenant nascer: CONFLITO genérico e o tenant (com assinatura e audit) é APAGADO', async () => {
    interceptador.ligado = true
    interceptador.erro = new Error('boom de teste dentro do signUpEmail')

    const input = conta({ nomeAgencia: `Agência ${unico('Compensada')}` })
    const resultado = await criarConta(input)
    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.code).toBe('CONFLITO')
    expect(resultado.mensagem).toBe('Não consegui criar sua conta agora.')
    expect(resultado.correcao).toBe('Tentar de novo em instantes')
    // O erro de teste não vaza para a resposta — quem lê a tela não precisa do stack.
    expect(JSON.stringify(resultado)).not.toContain('boom de teste')

    // Sem tenant órfão. `authDb` (policy `tenants_auth_service`) enxerga TODOS os
    // tenants — é a mesma lente do pré-cheque; se o CASCADE falhasse, apareceria aqui.
    const orfaos = await authDb
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.contactEmail, input.email))
    expect(orfaos, 'tenant nasceu e ninguém apagou — compensação não rodou').toHaveLength(0)

    // E sem usuário pela metade: o signUpEmail que falhou não deixou linha.
    const usuarios = await authDb.select({ id: user.id }).from(user).where(eq(user.email, input.email))
    expect(usuarios).toHaveLength(0)
  })

  it('erro "already exists" que escapar do pré-cheque vira CONFLITO campo email (mesma resposta do pré-cheque)', async () => {
    // Força o `signUpEmail` a falhar com a mensagem nativa do Better Auth DEPOIS do
    // tenant já criado — é a corrida que o comentário do código descreve, exercida de
    // forma determinística via interceptador.
    interceptador.ligado = true
    interceptador.erro = new Error('User already exists')

    const input = conta({ nomeAgencia: `Agência ${unico('Jah Existe')}` })
    const resultado = await criarConta(input)
    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.code).toBe('CONFLITO')
    expect(resultado.campo).toBe('email')
    expect(resultado.mensagem).toBe('Já existe uma conta com esse e-mail.')
    expect(resultado.correcao).toBe('Entrar com esse e-mail em /entrar')

    // A compensação rodou também neste caminho: nada de tenant órfão.
    const orfaos = await authDb
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.contactEmail, input.email))
    expect(orfaos).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 4. Slug — colisão vira CONFLITO amigável, nunca o 23505 cru (regressão do fix)
// ---------------------------------------------------------------------------

describe('slug — colisão vira CONFLITO amigável (regressão do pré-cheque sob FORCE RLS)', () => {
  it('criarTenant com slug já existente → CONFLITO de campo slug, sem erro cru de unicidade', async () => {
    // REGRESSÃO: o pré-cheque antigo usava o cliente cru — sob FORCE RLS, SELECT sem GUC
    // em `tenants` devolve ZERO linhas, o CONFLITO nunca disparava e a colisão estourava
    // como 23505 cru. Hoje o pré-cheque usa `authDb`; este teste prende o CONTRATO
    // (CONFLITO amigável, mensagem sem "duplicate key"), venha ele do pré-cheque ou da
    // tradução do 23505 no catch.
    const base = unico('qa-slug-direto')
    const primeira = await criarTenant({ name: `Agência ${base}`, slug: base })
    limpeza.push(primeira.tenantId)

    const segunda = criarTenant({ name: `Outra agência ${base}`, slug: base })
    await expect(segunda).rejects.toBeInstanceOf(ServiceError)
    const erro = (await segunda.catch((e: unknown) => e)) as InstanceType<typeof ServiceError>
    expect(erro.code).toBe('CONFLITO')
    expect(erro.campo).toBe('slug')
    expect(erro.mensagem).toBe('Esse endereço já está em uso.')
    expect(erro.correcao).toBe('Escolher outro endereço')
    // Nem a mensagem de topo (message = `${code}: ${mensagem}`) nem a amigável carregam
    // o erro cru do Postgres.
    expect(erro.message).not.toMatch(/duplicate key|23505/i)
  })

  it('duas criarTenant simultâneas com o mesmo slug: exatamente uma vence e só um tenant nasce', async () => {
    // Corrida do comentário do código: as duas passam pelo pré-cheque (nada existe
    // ainda) e uma perde o INSERT no índice `tenants_slug_key`. O índice único é a
    // garantia real — o contrato observável é "UM tenant com esse slug, jamais dois".
    //
    // ACHADO DESTA RODADA (documentado em docs/handoffs/teo-para-rafa.md): quem PERDE a
    // corrida recebe hoje o erro CRU do drizzle (DrizzleQueryError "Failed query: insert
    // into tenants..."), NÃO o CONFLITO do pré-cheque — a tradução do 23505 no catch de
    // `criarTenant` é código morto porque `ehViolacaoDeUnicidade` lê `error.code` e o
    // drizzle 0.45 traz o PostgresError original em `error.cause`. Aqui o teste afirma só
    // o que é determinístico: uma vitoriosa, uma perdedora, um tenant no banco. Se o
    // pré-cheque vencer a corrida (janela inversa), a perdedora é ServiceError CONFLITO —
    // as duas formas são aceitas, com assert extra quando for ServiceError.
    const base = unico('qa-slug-corrida')
    const [a, b] = await Promise.allSettled([
      criarTenant({ name: `Agência A ${base}`, slug: base }),
      criarTenant({ name: `Agência B ${base}`, slug: base }),
    ])

    const venceu = [a, b].filter((r) => r.status === 'fulfilled')
    const perdeu = [a, b].filter((r) => r.status === 'rejected')
    expect(venceu, 'as duas passaram — o índice único não protegeu o slug').toHaveLength(1)
    expect(perdeu, 'as duas falharam — nenhum tenant nasceu').toHaveLength(1)

    if (venceu[0]!.status === 'fulfilled') limpeza.push(venceu[0]!.value.tenantId)
    const erro = (perdeu[0] as PromiseRejectedResult).reason
    expect(erro).toBeInstanceOf(Error)

    // Pré-cheque venceu a corrida → o perdedor recebe o CONFLITO amigável (caminho que o
    // teste anterior cobre de forma determinística).
    if (erro instanceof ServiceError) {
      expect(erro.code).toBe('CONFLITO')
      expect(erro.mensagem).toBe('Esse endereço já está em uso.')
      expect(`${erro.message} ${erro.mensagem}`).not.toMatch(/duplicate key|23505/i)
    }

    // A garantia real (índice único) valeu: exatamente UM tenant com esse slug.
    const comOSlug = await authDb
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, base))
    expect(comOSlug).toHaveLength(1)
    expect(comOSlug[0]!.id).toBe(
      venceu[0]!.status === 'fulfilled' ? venceu[0]!.value.tenantId : comOSlug[0]!.id,
    )
  })

  it('criarConta com o mesmo nome de agência duas vezes: a segunda vira sufixo -2 (a agente nunca vê erro)', async () => {
    const nomeAgencia = `Maré Norte ${unico('qa')}`
    const base = slugificar(nomeAgencia)

    const primeira = await criarConta(conta({ nomeAgencia }))
    expect(primeira.ok, !primeira.ok ? primeira.mensagem : '').toBe(true)
    if (!primeira.ok) return
    limpeza.push(primeira.data.tenantId)
    expect(primeira.data.slug).toBe(base)

    const segunda = await criarConta(conta({ nomeAgencia })) // e-mail novo, agência igual
    expect(segunda.ok, !segunda.ok ? segunda.mensagem : '').toBe(true)
    if (!segunda.ok) return
    limpeza.push(segunda.data.tenantId)
    expect(segunda.data.slug).toBe(`${base}-2`)
    expect(segunda.data.tenantId).not.toBe(primeira.data.tenantId)
  })

  it('esgotadas as 10 tentativas de sufixo → CONFLITO campo nomeAgencia, e nada é criado', async () => {
    const base = unico('mare-cheia')
    const nomeAgencia = base.replace(/-/g, ' ')
    const input = conta({ nomeAgencia })
    expect(slugificar(nomeAgencia)).toBe(base)

    // Ocupam o endereço base e TODOS os sufixos que `criarConta` tenta (base, -2 … -10).
    for (let i = 1; i <= 10; i += 1) {
      const slug = i === 1 ? base : `${base}-${i}`
      const id = randomUUID()
      await withTenant(id, (tx) =>
        tx.insert(tenants).values({ id, name: `Ocupado ${slug}`, slug }),
      )
      limpeza.push(id)
    }

    const resultado = await criarConta(input)
    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.code).toBe('CONFLITO')
    expect(resultado.campo).toBe('nomeAgencia')
    expect(resultado.mensagem).toBe(
      'Não encontrei um endereço livre para essa agência — tente um nome um pouco diferente.',
    )
    expect(resultado.correcao).toBe('Ajustar o nome da agência')

    // Nenhuma conta nasceu com este e-mail — o esgotamento não destra tentativa órfã.
    const usuarios = await authDb.select({ id: user.id }).from(user).where(eq(user.email, input.email))
    expect(usuarios).toHaveLength(0)
  })
})
