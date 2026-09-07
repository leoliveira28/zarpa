/**
 * S4 — o funil (`docs/handoffs/rafa-para-teo.md`, seção "S4 — o funil (`src/server/deals.ts`)").
 *
 * Mesma filosofia de `tests/sales/vendas.test.ts` e `tests/followups/regua.test.ts`: chama
 * as funções REAIS de `src/server/deals.ts` contra um Postgres de verdade, só mockando
 * `requireAuthContext` (não existe sessão HTTP fora de uma requisição).
 * `tenant-isolation.test.ts` já cobre, por varredura de catálogo, que `deals`/`activities`
 * têm RLS e que SELECT/UPDATE/DELETE cruzados devolvem zero linhas em SQL direto — o que
 * ESTE arquivo cobre é a camada de cima: a Server Action, a regra de negócio ("motivo de
 * perda obrigatório"), idempotência sob clique duplo E sob concorrência real, o filtro de
 * "parados", e um teste de contrato para o bug de `sql<Date>()` que a Rafa documentou em
 * `docs/status/rafa.md` (seção S4, "Dois defeitos reais encontrados", item 3): um
 * `sql<Date>()` livre chega na aplicação como STRING crua do driver, nunca como `Date`,
 * mesmo com `::timestamptz` no SQL — `paraDataOuNula()` em `deals.ts` existe para proteger
 * disso, e é exatamente esse comportamento que este arquivo trava contra regressão.
 *
 * Pontos do pedido do PO cobertos aqui:
 *  1. `moverEstagioDoNegocio(id, 'perdido')` sem `motivoPerda` (ou curto demais) falha com
 *     `DADOS_INVALIDOS`/`campo: 'motivoPerda'` e NÃO muda o estágio no banco; com motivo
 *     válido, sucede e grava `lostReason`/`closedAt`/`activity` com `metadata.motivoPerda`.
 *  2. Idempotência: sequencial (clique duplo não duplica `activity`/`audit_log`) e
 *     concorrência real via `Promise.allSettled` (mesmo idioma de `vendas.test.ts`); mais
 *     reabertura limpando `closedAt`/`lostReason`.
 *  3. `listarNegociosParados()` exclui `ganho`/`perdido` mesmo "velhos" — só inclui quem
 *     está de fato aberto e parado.
 *  4. Isolamento nas 6 actions: negócio de um tenant não aparece nem é alterável por outro.
 *  5. Contrato de regressão para `sql<Date>()`: `diasParado` bate com o valor esperado
 *     (não `NaN`, não um número absurdo) tanto sem quanto com `activity`, inclusive no caso
 *     em que a `activity` é mais recente que `updatedAt` e por isso tem que vencer o cálculo.
 *
 * Bônus (baixo custo, pedido explícito da Rafa no handoff, item 5): trava o enum inteiro de
 * `listarNegociosDoFunil` — `perdido` nunca aparece, os outros 5 estágios batem exatamente
 * com `COLUNAS_DO_FUNIL` — porque foi exatamente uma divergência desse tipo (5 colunas de
 * exemplo vs. 6 valores do banco) que motivou o pedido.
 *
 * O que este arquivo NÃO cobre (registrado também em docs/status/teo.md):
 *  - O bug de `obterContato` (`src/server/contacts.ts`, `totalViajantes`/`totalNegocios`)
 *    que a Rafa corrigiu "de carona" nesta rodada — é outro arquivo, fora do pedido do PO
 *    para esta entrega, e merece teste próprio em `tests/contacts/`.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { activities, auditLog, contacts, deals, tenants, user } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'
// Type-only: apagado na compilação, não conflita com o `vi.mock('@/lib/auth/session', ...)`
// nem com o `await import('@/server/deals')` mais abaixo (que traz o runtime real já sob o
// mock ativo) — mesmo padrão de `tests/sales/vendas.test.ts`.
import type { DealStage, NegocioMovido } from '@/server/deals'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: 'qa-deals-user',
  email: 'qa-deals@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const {
  listarNegociosDoFunil,
  moverEstagioDoNegocio,
  criarNegocio,
  obterNegocio,
  listarNegociosParados,
  obterResumoDoPipeline,
} = await import('@/server/deals')
// `COLUNAS_DO_FUNIL` mora em `dealStages.ts` (não `deals.ts`, que é `'use server'`
// e só pode exportar função assíncrona).
const { COLUNAS_DO_FUNIL } = await import('@/server/dealStages')

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

type TenantFixture = { tenantId: string; userId: string }

/** Troca a sessão mockada para o tenant (e usuário DE VERDADE — `activities.actorUserId`
 * e `audit_log.actor_user_id` têm FK real para `user`, então `authCtx.userId` precisa
 * apontar para uma linha que existe, não uma string qualquer). */
function entrarComo(fixture: TenantFixture): void {
  authCtx.tenantId = fixture.tenantId
  authCtx.userId = fixture.userId
}

/** Cria tenant + usuário, inteiramente via `withTenant` — o mesmo caminho que uma
 * requisição real usaria para o tenant nascer. */
async function seedTenant(prefix: string): Promise<TenantFixture> {
  const tenantId = randomUUID()
  const seedTag = `qa-funil-${prefix}-${tenantId.slice(0, 8)}`
  const userId = `qa-funil-${prefix}-${randomUUID()}`

  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `Agência QA Funil ${seedTag}`, slug: seedTag })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Funil Bot',
      email: `${userId}@exemplo-zarpa.com.br`,
    })
  })

  return { tenantId, userId }
}

async function seedContato(tenantId: string, name = 'Cliente QA Funil'): Promise<string> {
  return withTenant(tenantId, async (tx) => {
    const [c] = await tx.insert(contacts).values({ tenantId, name }).returning({ id: contacts.id })
    return c!.id
  })
}

type NovoNegocioOverrides = Partial<{
  title: string
  destination: string | null
  valueCents: number
  stage: DealStage
  updatedAt: Date
  createdAt: Date
  closedAt: Date | null
  lostReason: string | null
}>

/** Insere um `deal` DIRETO (sem passar por `criarNegocio`) — é o único jeito de plantar
 * `updatedAt`/`stage`/`closedAt` "no passado" para os testes de "parado"/`diasParado`, já
 * que a Server Action sempre grava a hora corrente. */
async function seedNegocioDireto(
  tenantId: string,
  contactId: string,
  overrides: NovoNegocioOverrides = {},
): Promise<string> {
  return withTenant(tenantId, async (tx) => {
    const agora = new Date()
    const [linha] = await tx
      .insert(deals)
      .values({
        tenantId,
        contactId,
        title: overrides.title ?? 'Negócio QA funil',
        destination: overrides.destination ?? null,
        valueCents: overrides.valueCents ?? 100_000,
        stage: overrides.stage ?? 'novo',
        updatedAt: overrides.updatedAt ?? agora,
        createdAt: overrides.createdAt ?? agora,
        closedAt: overrides.closedAt ?? null,
        lostReason: overrides.lostReason ?? null,
      })
      .returning({ id: deals.id })
    return linha!.id
  })
}

/** Insere uma `activity` DIRETO, com `occurredAt` conhecido — é o que permite provar que
 * `diasParado` usa a `activity` mais recente e não só `updatedAt`. */
async function seedActivity(tenantId: string, dealId: string, occurredAt: Date): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.insert(activities).values({ tenantId, dealId, type: 'note', body: 'nota QA', occurredAt }),
  )
}

/** `N` dias atrás, com milissegundos zerados — Postgres `timestamptz` guarda microssegundos
 * e o driver devolve `Date`; comparar por dias inteiros exige não carregar frações que o
 * banco arredonde de um jeito e o teste calcule de outro (mesmo cuidado de
 * `tests/followups/regua.test.ts`, função `dataCongelada`). */
function diasAtras(dias: number): Date {
  const agora = new Date()
  agora.setUTCMilliseconds(0)
  agora.setUTCDate(agora.getUTCDate() - dias)
  return agora
}

async function lerNegocio(
  tenantId: string,
  dealId: string,
): Promise<{ stage: DealStage; lostReason: string | null; closedAt: Date | null; updatedAt: Date } | null> {
  return withTenant(tenantId, async (tx) => {
    const [linha] = await tx
      .select({ stage: deals.stage, lostReason: deals.lostReason, closedAt: deals.closedAt, updatedAt: deals.updatedAt })
      .from(deals)
      .where(eq(deals.id, dealId))
      .limit(1)
    return linha ?? null
  })
}

async function contarActivitiesDeTransicao(tenantId: string, dealId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const linhas = await tx
      .select({ id: activities.id })
      .from(activities)
      .where(and(eq(activities.dealId, dealId), eq(activities.type, 'stage_changed')))
    return linhas.length
  })
}

async function contarAuditoria(tenantId: string, dealId: string, action: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const linhas = await tx
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.entityId, dealId), eq(auditLog.action, action)))
    return linhas.length
  })
}

const criados: string[] = []

afterAll(async () => {
  // `globalSetup` recria o schema do zero a cada rodada da suíte inteira — isto é limpeza
  // cosmética para quem rodar a suíte várias vezes localmente, não requisito de isolamento
  // entre arquivos (cada teste usa um `tenantId` novo e aleatório).
  for (const tenantId of criados) {
    try {
      await withTenant(tenantId, async (tx) => {
        await tx.delete(auditLog).where(eq(auditLog.tenantId, tenantId))
        await tx.delete(activities).where(eq(activities.tenantId, tenantId))
        await tx.delete(deals).where(eq(deals.tenantId, tenantId))
        await tx.delete(contacts).where(eq(contacts.tenantId, tenantId))
        await tx.delete(user).where(eq(user.tenantId, tenantId))
      })
    } catch {
      // best-effort
    }
  }
})

// ---------------------------------------------------------------------------
// 1) Motivo de perda obrigatório
// ---------------------------------------------------------------------------

describe('motivo de perda obrigatório — moverEstagioDoNegocio(id, "perdido")', () => {
  it('sem motivoPerda falha com DADOS_INVALIDOS/campo "motivoPerda" e o estágio NÃO muda no banco', async () => {
    const fixture = await seedTenant('perda-sem')
    criados.push(fixture.tenantId)
    const contatoId = await seedContato(fixture.tenantId)
    const dealId = await seedNegocioDireto(fixture.tenantId, contatoId, { stage: 'negociando' })

    entrarComo(fixture)

    const semMotivo = await moverEstagioDoNegocio(dealId, 'perdido')
    expect(semMotivo.ok).toBe(false)
    if (semMotivo.ok) return
    expect(semMotivo.code).toBe('DADOS_INVALIDOS')
    expect(semMotivo.campo).toBe('motivoPerda')

    // Motivo curto demais (menos de 3 caracteres depois de trim) tem que falhar igual.
    const motivoCurto = await moverEstagioDoNegocio(dealId, 'perdido', ' a ')
    expect(motivoCurto.ok).toBe(false)
    if (motivoCurto.ok) return
    expect(motivoCurto.code).toBe('DADOS_INVALIDOS')
    expect(motivoCurto.campo).toBe('motivoPerda')

    // A prova que importa: lendo de volta do banco, não só o retorno da action.
    const negocio = await lerNegocio(fixture.tenantId, dealId)
    expect(negocio?.stage).toBe('negociando')
    expect(negocio?.lostReason).toBeNull()
    expect(negocio?.closedAt).toBeNull()

    // Nenhuma activity/audit_log deveria ter nascido de uma tentativa recusada.
    expect(await contarActivitiesDeTransicao(fixture.tenantId, dealId)).toBe(0)
    expect(await contarAuditoria(fixture.tenantId, dealId, 'deal.stage_changed')).toBe(0)
  })

  it('com motivo válido (>= 3 caracteres depois de trim): sucede, grava lostReason/closedAt e uma activity com metadata.motivoPerda', async () => {
    const fixture = await seedTenant('perda-com')
    criados.push(fixture.tenantId)
    const contatoId = await seedContato(fixture.tenantId)
    const dealId = await seedNegocioDireto(fixture.tenantId, contatoId, { stage: 'negociando' })

    entrarComo(fixture)
    const resultado = await moverEstagioDoNegocio(dealId, 'perdido', '  Cliente escolheu outra agência  ')
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)
    if (!resultado.ok) return

    expect(resultado.data.stage).toBe('perdido')
    // Trimado — o espaço em volta do texto digitado não deveria sobreviver.
    expect(resultado.data.lostReason).toBe('Cliente escolheu outra agência')
    expect(resultado.data.closedAt).not.toBeNull()

    const negocio = await lerNegocio(fixture.tenantId, dealId)
    expect(negocio?.stage).toBe('perdido')
    expect(negocio?.lostReason).toBe('Cliente escolheu outra agência')
    expect(negocio?.closedAt).not.toBeNull()

    const linhasActivity = await withTenant(fixture.tenantId, (tx) =>
      tx
        .select({ metadata: activities.metadata })
        .from(activities)
        .where(and(eq(activities.dealId, dealId), eq(activities.type, 'stage_changed'))),
    )
    expect(linhasActivity).toHaveLength(1)
    expect((linhasActivity[0]!.metadata as Record<string, unknown>).motivoPerda).toBe(
      'Cliente escolheu outra agência',
    )
  })
})

// ---------------------------------------------------------------------------
// 2) Idempotência sob clique duplo — sequencial, concorrente de verdade, e reabertura
// ---------------------------------------------------------------------------

describe('idempotência sob clique duplo — moverEstagioDoNegocio', () => {
  it('sequencial: mover novo→cotando duas vezes com o MESMO novoEstagio não duplica activity nem audit_log', async () => {
    const fixture = await seedTenant('duplo-seq')
    criados.push(fixture.tenantId)
    const contatoId = await seedContato(fixture.tenantId)
    const dealId = await seedNegocioDireto(fixture.tenantId, contatoId, { stage: 'novo' })

    entrarComo(fixture)

    const primeira = await moverEstagioDoNegocio(dealId, 'cotando')
    expect(primeira.ok).toBe(true)

    const segunda = await moverEstagioDoNegocio(dealId, 'cotando')
    expect(segunda.ok).toBe(true)

    expect(await contarActivitiesDeTransicao(fixture.tenantId, dealId)).toBe(1)
    expect(await contarAuditoria(fixture.tenantId, dealId, 'deal.stage_changed')).toBe(1)

    const negocio = await lerNegocio(fixture.tenantId, dealId)
    expect(negocio?.stage).toBe('cotando')
  })

  it('concorrente de verdade (Promise.allSettled): mover para "ganho" duas vezes ao mesmo tempo cria só UMA activity stage_changed', async () => {
    const fixture = await seedTenant('duplo-par')
    criados.push(fixture.tenantId)
    const contatoId = await seedContato(fixture.tenantId)
    const dealId = await seedNegocioDireto(fixture.tenantId, contatoId, { stage: 'negociando' })

    entrarComo(fixture)

    const resultados = await Promise.allSettled([
      moverEstagioDoNegocio(dealId, 'ganho'),
      moverEstagioDoNegocio(dealId, 'ganho'),
    ])

    // `comoResultado` captura qualquer erro e devolve `{ ok: false, ... }` — a promise em
    // si nunca deveria rejeitar (mesma doutrina de `vendas.test.ts`).
    expect(
      resultados.every((r) => r.status === 'fulfilled'),
      'nenhuma chamada deveria rejeitar a promise — comoResultado captura tudo',
    ).toBe(true)

    const valores = (resultados as PromiseFulfilledResult<Awaited<ReturnType<typeof moverEstagioDoNegocio>>>[]).map(
      (r) => r.value,
    )
    for (const v of valores) {
      expect(v.ok, !v.ok ? `chamada concorrente falhou: ${v.mensagem}` : '').toBe(true)
    }

    // A prova que importa: a verdade do banco, relida DEPOIS que as duas promises já
    // resolveram — é o `UPDATE ... WHERE stage <> novoEstagio` (comentado em `deals.ts`)
    // quem garante isto sob corrida real, não a leitura-antes-de-gravar sozinha.
    const negocio = await lerNegocio(fixture.tenantId, dealId)
    expect(negocio?.stage).toBe('ganho')
    expect(negocio?.closedAt).not.toBeNull()
    expect(await contarActivitiesDeTransicao(fixture.tenantId, dealId)).toBe(1)
  })

  it('reabertura limpa o estado: ganho→negociando zera closedAt; perdido→negociando zera lostReason', async () => {
    const fixture = await seedTenant('reabre')
    criados.push(fixture.tenantId)
    const contatoId = await seedContato(fixture.tenantId)

    entrarComo(fixture)

    const dealGanho = await seedNegocioDireto(fixture.tenantId, contatoId, { stage: 'negociando' })
    const ganho = await moverEstagioDoNegocio(dealGanho, 'ganho')
    expect(ganho.ok).toBe(true)
    if (ganho.ok) expect(ganho.data.closedAt).not.toBeNull()

    const reaberto = await moverEstagioDoNegocio(dealGanho, 'negociando')
    expect(reaberto.ok).toBe(true)
    if (reaberto.ok) expect((reaberto.data as NegocioMovido).closedAt).toBeNull()
    expect((await lerNegocio(fixture.tenantId, dealGanho))?.closedAt).toBeNull()

    const dealPerdido = await seedNegocioDireto(fixture.tenantId, contatoId, { stage: 'negociando' })
    const perdido = await moverEstagioDoNegocio(dealPerdido, 'perdido', 'Motivo válido qualquer')
    expect(perdido.ok).toBe(true)
    if (perdido.ok) expect(perdido.data.lostReason).toBe('Motivo válido qualquer')

    const reabertoPerdido = await moverEstagioDoNegocio(dealPerdido, 'negociando')
    expect(reabertoPerdido.ok).toBe(true)
    if (reabertoPerdido.ok) {
      expect(reabertoPerdido.data.lostReason).toBeNull()
      expect(reabertoPerdido.data.closedAt).toBeNull()
    }
    const negocio = await lerNegocio(fixture.tenantId, dealPerdido)
    expect(negocio?.lostReason).toBeNull()
    expect(negocio?.closedAt).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3) listarNegociosParados — exclui ganho/perdido, mesmo "velhos"
// ---------------------------------------------------------------------------

describe('listarNegociosParados — exclui ganho/perdido mesmo com updatedAt de mais de 7 dias', () => {
  it('só o negócio ABERTO e parado aparece; ganho/perdido "velhos" ficam de fora', async () => {
    const fixture = await seedTenant('parados')
    criados.push(fixture.tenantId)
    const contatoId = await seedContato(fixture.tenantId)

    const aberto = await seedNegocioDireto(fixture.tenantId, contatoId, {
      title: 'Aberto parado',
      valueCents: 12_345,
      stage: 'novo',
      updatedAt: diasAtras(10),
      createdAt: diasAtras(10),
    })
    const ganhoVelho = await seedNegocioDireto(fixture.tenantId, contatoId, {
      title: 'Ganho velho',
      valueCents: 99_999,
      stage: 'ganho',
      updatedAt: diasAtras(10),
      createdAt: diasAtras(10),
      closedAt: diasAtras(10),
    })
    const perdidoVelho = await seedNegocioDireto(fixture.tenantId, contatoId, {
      title: 'Perdido velho',
      valueCents: 77_777,
      stage: 'perdido',
      updatedAt: diasAtras(10),
      createdAt: diasAtras(10),
      closedAt: diasAtras(10),
      lostReason: 'Não fechou',
    })

    entrarComo(fixture)
    const parados = await listarNegociosParados()
    expect(parados.ok, !parados.ok ? parados.mensagem : '').toBe(true)
    if (!parados.ok) return

    const ids = parados.data.itens.map((i) => i.id)
    expect(ids).toContain(aberto)
    expect(ids).not.toContain(ganhoVelho)
    expect(ids).not.toContain(perdidoVelho)
    expect(parados.data.itens).toHaveLength(1)
    // totalCents bate exatamente com o único item — não a soma dos três.
    expect(parados.data.totalCents).toBe(12_345)
  })

  it('negócio aberto mas parado há MENOS de 7 dias não aparece (limite é > 7, não >= 7)', async () => {
    const fixture = await seedTenant('parados-limite')
    criados.push(fixture.tenantId)
    const contatoId = await seedContato(fixture.tenantId)

    await seedNegocioDireto(fixture.tenantId, contatoId, {
      title: 'Parado há 3 dias',
      stage: 'novo',
      updatedAt: diasAtras(3),
      createdAt: diasAtras(3),
    })

    entrarComo(fixture)
    const parados = await listarNegociosParados()
    expect(parados.ok).toBe(true)
    if (!parados.ok) return
    expect(parados.data.itens).toHaveLength(0)
    expect(parados.data.totalCents).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 4) diasParado — guarda de regressão para o bug de `sql<Date>()` (docs/status/rafa.md, S4)
// ---------------------------------------------------------------------------

describe('diasParado — o maior entre updatedAt e a última activity (contrato de sql<Date>())', () => {
  it('sem nenhuma activity, updatedAt de HOJE: diasParado = 0', async () => {
    const fixture = await seedTenant('dias-hoje')
    criados.push(fixture.tenantId)
    const contatoId = await seedContato(fixture.tenantId)
    const dealId = await seedNegocioDireto(fixture.tenantId, contatoId, {})

    entrarComo(fixture)
    const board = await listarNegociosDoFunil()
    expect(board.ok).toBe(true)
    if (!board.ok) return
    const linha = board.data.find((d) => d.id === dealId)
    expect(linha).toBeDefined()
    expect(linha!.diasParado).toBe(0)
  })

  it('sem nenhuma activity, updatedAt de 8 dias atrás: diasParado = 8 — sem null/NaN por falta de activity', async () => {
    const fixture = await seedTenant('dias-sem-activity')
    criados.push(fixture.tenantId)
    const contatoId = await seedContato(fixture.tenantId)
    const dealId = await seedNegocioDireto(fixture.tenantId, contatoId, {
      updatedAt: diasAtras(8),
      createdAt: diasAtras(8),
    })

    entrarComo(fixture)
    const board = await listarNegociosDoFunil()
    expect(board.ok).toBe(true)
    if (!board.ok) return
    const linha = board.data.find((d) => d.id === dealId)
    expect(linha).toBeDefined()
    expect(Number.isFinite(linha!.diasParado)).toBe(true)
    expect(linha!.diasParado).toBe(8)
  })

  it('updatedAt de 30 dias atrás mas activity de ONTEM: a activity mais recente VENCE — diasParado = 1, nunca NaN/Infinity/absurdo', async () => {
    // Este é o caso que pegaria a regressão de `sql<Date>()`: se `ultimaAtividadeSql()`
    // voltasse a chegar como string crua do driver (sem `paraDataOuNula()`), comparar
    // `Date` com `string` dentro de `maisRecente`/`diasDesde` produziria um resultado
    // silenciosamente errado (não um erro de tipo — `tsc` não pega isto, é bug de
    // runtime, documentado em `docs/status/rafa.md`, seção S4).
    const fixture = await seedTenant('dias-activity-vence')
    criados.push(fixture.tenantId)
    const contatoId = await seedContato(fixture.tenantId)
    const dealId = await seedNegocioDireto(fixture.tenantId, contatoId, {
      updatedAt: diasAtras(30),
      createdAt: diasAtras(30),
    })
    await seedActivity(fixture.tenantId, dealId, diasAtras(1))

    entrarComo(fixture)
    const board = await listarNegociosDoFunil()
    expect(board.ok).toBe(true)
    if (!board.ok) return
    const linha = board.data.find((d) => d.id === dealId)
    expect(linha).toBeDefined()
    expect(Number.isNaN(linha!.diasParado)).toBe(false)
    expect(Number.isFinite(linha!.diasParado)).toBe(true)
    expect(linha!.diasParado).toBe(1)

    // Mesma subquery é usada por `listarNegociosParados` — 1 dia é MENOR que o limite de
    // 7, então este negócio não deveria aparecer lá, mesmo tendo `updatedAt` de 30 dias.
    const parados = await listarNegociosParados()
    expect(parados.ok).toBe(true)
    if (!parados.ok) return
    expect(parados.data.itens.some((i) => i.id === dealId)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 5) Bônus: o enum inteiro do board — perdido nunca aparece, os outros 5 batem com
//    COLUNAS_DO_FUNIL (pedido explícito da Rafa, docs/handoffs/rafa-para-teo.md, item 5)
// ---------------------------------------------------------------------------

describe('listarNegociosDoFunil — exclui "perdido" e só ele; o resto bate com COLUNAS_DO_FUNIL', () => {
  it('seed com um negócio em cada um dos 6 estágios: o retorno tem exatamente 5, nunca "perdido"', async () => {
    const fixture = await seedTenant('enum')
    criados.push(fixture.tenantId)
    const contatoId = await seedContato(fixture.tenantId)

    const porEstagio = new Map<DealStage, string>()
    for (const { estagio } of [
      ...COLUNAS_DO_FUNIL,
      { estagio: 'perdido' as const, label: '' },
    ]) {
      const overrides: NovoNegocioOverrides =
        estagio === 'perdido'
          ? { stage: estagio, lostReason: 'Motivo QA', closedAt: new Date() }
          : { stage: estagio }
      const dealId = await seedNegocioDireto(fixture.tenantId, contatoId, {
        title: `Negócio ${estagio}`,
        ...overrides,
      })
      porEstagio.set(estagio, dealId)
    }

    entrarComo(fixture)
    const board = await listarNegociosDoFunil()
    expect(board.ok).toBe(true)
    if (!board.ok) return

    expect(board.data).toHaveLength(5)
    const idPerdido = porEstagio.get('perdido')
    expect(board.data.some((d) => d.id === idPerdido)).toBe(false)

    for (const { estagio } of COLUNAS_DO_FUNIL) {
      const id = porEstagio.get(estagio)
      const linha = board.data.find((d) => d.id === id)
      expect(linha, `estágio ${estagio} não apareceu no board`).toBeDefined()
      expect(linha!.stage).toBe(estagio)
    }
  })
})

// ---------------------------------------------------------------------------
// 6) Isolamento por tenant — nas 6 actions
// ---------------------------------------------------------------------------

describe('isolamento por tenant — negócio de A não aparece nem é alterável por B, nas 6 actions', () => {
  it('listarNegociosDoFunil, obterNegocio, moverEstagioDoNegocio, criarNegocio, listarNegociosParados, obterResumoDoPipeline', async () => {
    const A = await seedTenant('iso-a')
    const B = await seedTenant('iso-b')
    criados.push(A.tenantId, B.tenantId)

    const contatoA = await seedContato(A.tenantId, 'Cliente A')
    const contatoB = await seedContato(B.tenantId, 'Cliente B')

    // Negócio de A, "parado" e com valor canário — não deveria vazar em NADA que B chame.
    const dealA = await seedNegocioDireto(A.tenantId, contatoA, {
      title: 'Negócio A canário',
      valueCents: 999_999,
      stage: 'novo',
      updatedAt: diasAtras(10),
      createdAt: diasAtras(10),
    })

    // Negócio de B, valor conhecido — usado para confirmar que o resumo de B não inclui
    // nada de A (não só que não erra, mas que a SOMA bate exatamente).
    const dealB = await seedNegocioDireto(B.tenantId, contatoB, {
      title: 'Negócio B',
      valueCents: 50_000,
      stage: 'novo',
    })

    entrarComo(B)

    const board = await listarNegociosDoFunil()
    expect(board.ok).toBe(true)
    if (board.ok) {
      expect(board.data.some((d) => d.id === dealA)).toBe(false)
      expect(board.data.every((d) => d.contactId !== contatoA)).toBe(true)
      expect(board.data.some((d) => d.id === dealB)).toBe(true)
    }

    const detalhe = await obterNegocio(dealA)
    expect(detalhe.ok).toBe(false)
    if (!detalhe.ok) expect(detalhe.code).toBe('NAO_ENCONTRADO')

    const movido = await moverEstagioDoNegocio(dealA, 'cotando')
    expect(movido.ok).toBe(false)
    if (!movido.ok) expect(movido.code).toBe('NAO_ENCONTRADO')

    // Tentativa de criar negócio em cima de um CONTATO de A, a partir do contexto de B —
    // RLS decide "existe": zero linhas, então NAO_ENCONTRADO, nunca um negócio criado
    // "por engano" ligado ao contato errado.
    const criacao = await criarNegocio({
      contactId: contatoA,
      title: 'Tentativa de B com contato de A',
      departureOn: undefined,
      returnOn: undefined,
      expectedCloseOn: undefined,
    })
    expect(criacao.ok).toBe(false)
    if (!criacao.ok) expect(criacao.code).toBe('NAO_ENCONTRADO')

    const parados = await listarNegociosParados()
    expect(parados.ok).toBe(true)
    if (parados.ok) {
      expect(parados.data.itens.some((i) => i.id === dealA)).toBe(false)
      expect(parados.data.totalCents).not.toBe(999_999)
    }

    const resumo = await obterResumoDoPipeline()
    expect(resumo.ok).toBe(true)
    if (resumo.ok) {
      // Só o negócio de B — o canário de A (999_999) não pode aparecer somado aqui.
      expect(resumo.data.pipelineAbertoCents).toBe(50_000)
    }

    // O negócio de A continua completamente intocado — lido de volta sob o contexto de A.
    entrarComo(A)
    const aindaA = await lerNegocio(A.tenantId, dealA)
    expect(aindaA?.stage).toBe('novo')
    const obterA = await obterNegocio(dealA)
    expect(obterA.ok).toBe(true)
    if (obterA.ok) expect(obterA.data.valueCents).toBe(999_999)
  })

  it('negócio de A não aparece na varredura por catálogo de B (SQL direto, sem passar pela action)', async () => {
    const A = await seedTenant('iso-sql-a')
    const B = await seedTenant('iso-sql-b')
    criados.push(A.tenantId, B.tenantId)

    const contatoA = await seedContato(A.tenantId)
    const dealA = await seedNegocioDireto(A.tenantId, contatoA)

    const vistoPorB = await withTenant(B.tenantId, (tx) =>
      tx.select({ id: deals.id }).from(deals).where(eq(deals.id, dealA)),
    )
    expect(vistoPorB).toHaveLength(0)
  })
})
