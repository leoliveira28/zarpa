/**
 * S14 §1 — o período de leitura (`src/server/periodo.ts`) e as quatro actions que o
 * aceitam (`obterResumoDoMes`, `exportarResumoDoMesCsv`, `obterResumoDoPipeline`,
 * `listarVendas`).
 *
 * Mesma filosofia de `tests/deals/funil.test.ts`: funções REAIS contra o Postgres de
 * teste, mockando UMA coisa só — `requireAuthContext`. Três lances:
 *
 *  1. `resolverPeriodo` puro — as recusas (mês+faixa, faixa incompleta, de>ate, data
 *     inexistente), o mês corrente por omissão e as duas formas válidas. Puro = não
 *     precisa banco; o relógio é argumento.
 *  2. As actions de verdade com dados semeados em meses DISTINTOS — a prova de que o
 *     recorte cai na query (venda de agosto não vira número de setembro), e de que
 *     AUSENTE = mês corrente (o comportamento que as telas já tinham).
 *  3. Período inválido chega à tela como `DADOS_INVALIDOS` com `correcao` — nunca 500.
 *
 * O isolamento de tenant dessas actions não é repetido aqui: `tenant-isolation.test.ts`
 * varre o catálogo inteiro (incluindo `sales`/`deals`/`proposals`) em SQL direto.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { contacts, deals, proposals, sales, tenants, user } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'
import { resolverPeriodo, type PeriodoInput } from '@/server/periodo'
import type { VendaResumo } from '@/server/sales'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: '',
  email: 'qa-periodo@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { obterResumoDoMes, exportarResumoDoMesCsv } = await import('@/server/dashboard')
const { obterResumoDoPipeline } = await import('@/server/deals')
const { listarVendas } = await import('@/server/sales')

// ---------------------------------------------------------------------------
// resolverPeriodo — puro, sem banco
// ---------------------------------------------------------------------------

describe('resolverPeriodo — recusas e defaults', () => {
  const agora = new Date('2026-09-07T12:00:00Z')

  it('ausente, null e objeto vazio = mês corrente (UTC)', () => {
    for (const input of [undefined, null, {}, { mes: undefined }] as (PeriodoInput | null | undefined)[]) {
      const p = resolverPeriodo(agora, input)
      expect(p.rotulo).toBe('2026-09')
      expect(p.de).toBe('2026-09-01')
      expect(p.ate).toBe('2026-09-30')
      expect(p.inicio.toISOString()).toBe('2026-09-01T00:00:00.000Z')
      // Meio exclusivo: 00:00 do dia seguinte ao último.
      expect(p.fimExclusivo.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    }
  })

  it('mês civil AAAA-MM resolve para o mês inteiro', () => {
    const p = resolverPeriodo(agora, { mes: '2026-02' })
    expect(p.rotulo).toBe('2026-02')
    expect(p.de).toBe('2026-02-01')
    expect(p.ate).toBe('2026-02-28') // 2026 não é bissexto
    expect(p.fimExclusivo.toISOString()).toBe('2026-03-01T00:00:00.000Z')
  })

  it('faixa de/ate resolve com pontas inclusivas', () => {
    const p = resolverPeriodo(agora, { de: '2026-01-01', ate: '2026-03-31' })
    expect(p.rotulo).toBe('2026-01-01..2026-03-31')
    expect(p.de).toBe('2026-01-01')
    expect(p.ate).toBe('2026-03-31')
    expect(p.inicio.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(p.fimExclusivo.toISOString()).toBe('2026-04-01T00:00:00.000Z')
  })

  it('mês E faixa juntos → DADOS_INVALIDOS', () => {
    expect(() =>
      resolverPeriodo(agora, { mes: '2026-09', de: '2026-09-01', ate: '2026-09-30' }),
    ).toThrowError(/não os dois juntos/)
  })

  it('faixa com uma ponta só → DADOS_INVALIDOS (metade de intervalo é bug de quem chama)', () => {
    expect(() => resolverPeriodo(agora, { de: '2026-09-01' })).toThrowError(/duas datas/)
    expect(() => resolverPeriodo(agora, { ate: '2026-09-30' })).toThrowError(/duas datas/)
  })

  it('de > ate → DADOS_INVALIDOS', () => {
    expect(() => resolverPeriodo(agora, { de: '2026-09-10', ate: '2026-09-01' })).toThrowError(
      /antes da inicial/,
    )
  })

  it('data inexistente (2026-02-30) → DADOS_INVALIDOS (o Date normalizaria para 03/03)', () => {
    expect(() => resolverPeriodo(agora, { de: '2026-02-30', ate: '2026-02-28' })).toThrowError(
      /não existe no calendário/,
    )
  })

  it('formato errado (2026-9, AAAA/DD/MM) → DADOS_INVALIDOS com campo apontado', () => {
    for (const ruim of [{ mes: '2026-9' }, { de: '01/09/2026', ate: '2026-09-30' }]) {
      expect(() => resolverPeriodo(agora, ruim as PeriodoInput)).toThrowError(
        /inválido — use|inválida — use/,
      )
    }
  })
})

// ---------------------------------------------------------------------------
// Fixture — vendas/deals em meses distintos para provar o recorte
// ---------------------------------------------------------------------------

type TenantFixture = { tenantId: string; userId: string }

function entrarComo(fixture: TenantFixture): void {
  authCtx.tenantId = fixture.tenantId
  authCtx.userId = fixture.userId
}

const tenantIds: string[] = []

async function seedTenantComVendas(): Promise<TenantFixture> {
  const tenantId = randomUUID()
  tenantIds.push(tenantId)
  const tag = `qa-periodo-${tenantId.slice(0, 8)}`
  const userId = `qa-periodo-${randomUUID()}`

  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `Agência ${tag}`, slug: tag })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Período Bot',
      email: `${userId}@exemplo-zarpa.test`,
    })

    const [contato] = await tx
      .insert(contacts)
      .values({ tenantId, name: 'Cliente QA Período' })
      .returning({ id: contacts.id })
    const contatoId = contato!.id

    // Dois negócios ganhos: um fechado em agosto, outro em setembro de 2026.
    const criarDealGanho = async (tag_: string, closedAt: Date) => {
      const [deal] = await tx
        .insert(deals)
        .values({
          tenantId,
          contactId: contatoId,
          title: `Viagem QA ${tag_}`,
          destination: 'Lisboa',
          stage: 'ganho',
          valueCents: 500_000,
          closedAt,
        })
        .returning({ id: deals.id })
      const [proposta] = await tx
        .insert(proposals)
        .values({
          tenantId,
          dealId: deal!.id,
          publicToken: randomUUID(),
          title: `Proposta QA ${tag_}`,
          status: 'accepted',
          sentAt: closedAt,
          acceptedAt: closedAt,
        })
        .returning({ id: proposals.id })
      return { dealId: deal!.id, proposalId: proposta!.id }
    }

    const agosto = await criarDealGanho('agosto', new Date('2026-08-10T14:00:00Z'))
    const setembro = await criarDealGanho('setembro', new Date('2026-09-03T14:00:00Z'))

    // Venda de agosto: R$ 5.000,00 · comissão prevista R$ 500,00 · taxa R$ 200,00.
    await tx.insert(sales).values({
      tenantId,
      dealId: agosto.dealId,
      proposalId: agosto.proposalId,
      fornecedor: 'Operadora QA',
      valorBrutoCents: 500_000,
      custoCents: 350_000,
      comissaoPrevistaCents: 50_000,
      taxaServicoCents: 20_000,
      comissaoStatus: 'prevista',
      createdAt: new Date('2026-08-10T14:00:00Z'),
    })

    // Venda de setembro: R$ 8.000,00 · comissão recebida R$ 800,00 · taxa R$ 300,00.
    await tx.insert(sales).values({
      tenantId,
      dealId: setembro.dealId,
      proposalId: setembro.proposalId,
      fornecedor: 'Operadora QA',
      valorBrutoCents: 800_000,
      custoCents: 550_000,
      comissaoPrevistaCents: 80_000,
      taxaServicoCents: 30_000,
      comissaoStatus: 'recebida',
      createdAt: new Date('2026-09-03T14:00:00Z'),
    })
  })

  return { tenantId, userId }
}

afterAll(async () => {
  for (const tenantId of [...new Set(tenantIds)]) {
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
      /* best-effort — o globalSetup recria o schema a cada rodada */
    }
  }
})

// ---------------------------------------------------------------------------
// As actions com o período de verdade
// ---------------------------------------------------------------------------

describe('obterResumoDoMes — recorte por período', () => {
  it('sem período = mês corrente: só a venda de setembro entra', async () => {
    const fixture = await seedTenantComVendas()
    entrarComo(fixture)

    const resultado = await obterResumoDoMes()
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)
    if (!resultado.ok) return
    expect(resultado.data.mes).toBe('2026-09')
    expect(resultado.data.vendas.totalVendas).toBe(1)
    expect(resultado.data.vendas.faturamentoBrutoCents).toBe(800_000)
  })

  it('mes 2026-08 isola a venda de agosto', async () => {
    const fixture = await seedTenantComVendas()
    entrarComo(fixture)

    const resultado = await obterResumoDoMes({ mes: '2026-08' })
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)
    if (!resultado.ok) return
    expect(resultado.data.mes).toBe('2026-08')
    expect(resultado.data.vendas.totalVendas).toBe(1)
    expect(resultado.data.vendas.faturamentoBrutoCents).toBe(500_000)
  })

  it('faixa cobrindo os dois meses soma as duas vendas', async () => {
    const fixture = await seedTenantComVendas()
    entrarComo(fixture)

    const resultado = await obterResumoDoMes({ de: '2026-08-01', ate: '2026-09-30' })
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)
    if (!resultado.ok) return
    expect(resultado.data.vendas.totalVendas).toBe(2)
    expect(resultado.data.vendas.faturamentoBrutoCents).toBe(1_300_000)
    // Pontas inclusivas: a venda das 14:00 do último dia entra.
    expect(resultado.data.periodo.rotulo).toBe('2026-08-01..2026-09-30')
  })

  it('período inválido volta como DADOS_INVALIDOS com correcao — nunca 500', async () => {
    const fixture = await seedTenantComVendas()
    entrarComo(fixture)

    const resultado = await obterResumoDoMes({ de: '2026-09-30', ate: '2026-09-01' })
    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.code).toBe('DADOS_INVALIDOS')
    expect(resultado.correcao).toBe('Corrigir o período')
  })

  it('CSV segue o período: nome de arquivo e conteúdo só com as vendas do recorte', async () => {
    const fixture = await seedTenantComVendas()
    entrarComo(fixture)

    const agosto = await exportarResumoDoMesCsv({ mes: '2026-08' })
    expect(agosto.ok).toBe(true)
    if (!agosto.ok) return
    expect(agosto.data.nomeArquivo).toContain('2026-08')
    expect(agosto.data.conteudo).toContain('5.000,00')

    const setembro = await exportarResumoDoMesCsv({ mes: '2026-09' })
    expect(setembro.ok).toBe(true)
    if (!setembro.ok) return
    expect(setembro.data.nomeArquivo).toContain('2026-09')
    expect(setembro.data.conteudo).toContain('8.000,00')
  })
})

describe('obterResumoDoPipeline e listarVendas — recorte por período', () => {
  it('pipeline: fechadoNoMesCents segue o período (agosto ≠ setembro); aberto sem recorte', async () => {
    const fixture = await seedTenantComVendas()
    entrarComo(fixture)

    const agosto = await obterResumoDoPipeline({ mes: '2026-08' })
    expect(agosto.ok).toBe(true)
    if (!agosto.ok) return
    expect(agosto.data.fechadoNoMesCents).toBe(500_000)

    const setembro = await obterResumoDoPipeline({ mes: '2026-09' })
    expect(setembro.ok).toBe(true)
    if (!setembro.ok) return
    expect(setembro.data.fechadoNoMesCents).toBe(500_000)

    const faixa = await obterResumoDoPipeline({ de: '2026-08-01', ate: '2026-09-30' })
    expect(faixa.ok).toBe(true)
    if (!faixa.ok) return
    expect(faixa.data.fechadoNoMesCents).toBe(1_000_000)
  })

  it('listarVendas com periodo mes: só as linhas do mês; sem periodo: sem filtro de data', async () => {
    const fixture = await seedTenantComVendas()
    entrarComo(fixture)

    const agosto = await listarVendas({ periodo: { mes: '2026-08' } })
    expect(agosto.ok).toBe(true)
    if (!agosto.ok) return
    expect(agosto.data).toHaveLength(1)
    expect(agosto.data[0]!.valorBrutoCents).toBe(500_000)
    expect((agosto.data[0] as VendaResumo).createdAt).toBeInstanceOf(Date)

    const todas = await listarVendas()
    expect(todas.ok).toBe(true)
    if (!todas.ok) return
    expect(todas.data).toHaveLength(2)
  })
})
