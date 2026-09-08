/**
 * S14 §2 + §3 — `resumoDoPeriodo` (`src/server/money.ts`) e `listarEmViagem`
 * (`src/server/viagens.ts`).
 *
 * Mesma filosofia de `tests/periodo/periodo.test.ts`: funções REAIS contra o Postgres,
 * mockando só `requireAuthContext`.
 *
 *  §2 — a tab "Resumo do período": agregações de vendas/comissão com canários de valor
 *  distintos por status (prevista/recebida/atrasada), origem do contato (incluindo a
 *  linha "sem origem", que é `null` e não categoria inventada), ticket médio SEM venda
 *  (zero, nunca NaN) e motivos de perda recortados por `closedAt` do deal `perdido`.
 *
 *  §3 — "Em viagem": os três grupos MUTUAMENTE EXCLUSIVOS classificados contra um
 *  relógio fixo (fixture com datas relativas a "hoje"), incluindo `returnOn` null =
 *  segue em viagem, contato com whatsapp pronto para o CTA, e negócio ganho SEM data
 *  fica fora de propósito.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { contacts, deals, proposals, sales, tenants, user } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'
import type { EmViagemGrupos } from '@/server/viagens'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: '',
  email: 'qa-money@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { resumoDoPeriodo } = await import('@/server/money')
const { listarEmViagem } = await import('@/server/viagens')

type TenantFixture = { tenantId: string; userId: string }

function entrarComo(fixture: TenantFixture): void {
  authCtx.tenantId = fixture.tenantId
  authCtx.userId = fixture.userId
}

const tenantIds: string[] = []

function registrar(tenantId: string): void {
  tenantIds.push(tenantId)
}

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
    /* best-effort — o globalSetup recria o schema a cada rodada */
  }
}

afterAll(async () => {
  for (const tenantId of [...new Set(tenantIds)]) {
    await apagar(tenantId)
  }
})

/** Data ISO `AAAA-MM-DD` relativa a hoje (UTC), deslocada de N dias. */
function diaRelativo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// §2 — resumoDoPeriodo
// ---------------------------------------------------------------------------

describe('resumoDoPeriodo — vendas, comissão, origem e motivos de perda', () => {
  it('agrega vendas, comissão por status, ticket médio e origem — e zero limpo sem vendas', async () => {
    const tenantId = randomUUID()
    registrar(tenantId)
    const tag = `qa-money-${tenantId.slice(0, 8)}`
    const userId = `qa-money-${randomUUID()}`

    await withTenant(tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `Agência ${tag}`, slug: tag })
      await tx.insert(user).values({
        id: userId,
        tenantId,
        name: 'QA Money Bot',
        email: `${userId}@exemplo-zarpa.test`,
      })
    })

    const seed = async (tx: Parameters<Parameters<typeof withTenant>[1]>[0], opts: {
      origem: 'whatsapp' | 'instagram' | null
      status: 'prevista' | 'recebida' | 'atrasada'
      valorBruto: number
      comissao: number
      taxa: number
    }) => {
      const [contato] = await tx
        .insert(contacts)
        .values({ tenantId, name: `Cliente ${opts.origem ?? 'sem-origem'}`, source: opts.origem })
        .returning({ id: contacts.id })
      const [deal] = await tx
        .insert(deals)
        .values({
          tenantId,
          contactId: contato!.id,
          title: `Viagem ${opts.origem ?? 'sem-origem'}`,
          stage: 'ganho',
          valueCents: opts.valorBruto,
          closedAt: new Date('2026-09-05T12:00:00Z'),
        })
        .returning({ id: deals.id })
      const [proposta] = await tx
        .insert(proposals)
        .values({
          tenantId,
          dealId: deal!.id,
          publicToken: randomUUID(),
          title: `Proposta ${opts.origem ?? 'sem-origem'}`,
          status: 'accepted',
          sentAt: new Date('2026-09-01T12:00:00Z'),
          acceptedAt: new Date('2026-09-05T12:00:00Z'),
        })
        .returning({ id: proposals.id })
      const [sale] = await tx
        .insert(sales)
        .values({
          tenantId,
          dealId: deal!.id,
          proposalId: proposta!.id,
          valorBrutoCents: opts.valorBruto,
          custoCents: 0,
          comissaoPrevistaCents: opts.comissao,
          taxaServicoCents: opts.taxa,
          comissaoStatus: opts.status,
          createdAt: new Date('2026-09-05T12:00:00Z'),
        })
        .returning({ id: sales.id })
      return sale!.id
    }

    // Vendas do MÊS CORRENTE (sem período) — o default das telas.
    await withTenant(tenantId, async (tx) => {
      await seed(tx, { origem: 'instagram', status: 'recebida', valorBruto: 800_000, comissao: 80_000, taxa: 30_000 })
      await seed(tx, { origem: 'instagram', status: 'prevista', valorBruto: 500_000, comissao: 50_000, taxa: 20_000 })
      await seed(tx, { origem: null, status: 'atrasada', valorBruto: 300_000, comissao: 30_000, taxa: 10_000 })
    })

    entrarComo({ tenantId, userId })

    // Um deal perdido no período, com motivo — para o §2 devolvê-lo.
    await withTenant(tenantId, async (tx) => {
      const [contato] = await tx
        .insert(contacts)
        .values({ tenantId, name: 'Cliente perdido' })
        .returning({ id: contacts.id })
      await tx.insert(deals).values({
        tenantId,
        contactId: contato!.id,
        title: 'Viagem perdida',
        stage: 'perdido',
        valueCents: 1_200_000,
        lostReason: 'preco',
        closedAt: new Date('2026-09-06T12:00:00Z'),
      })
    })

    const resultado = await resumoDoPeriodo()
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)
    if (!resultado.ok) return

    const resumo = resultado.data
    expect(resumo.vendas.total).toBe(3)
    expect(resumo.vendas.receitaBrutaCents).toBe(1_600_000)
    expect(resumo.vendas.taxaServicoCents).toBe(60_000)
    // 1.600.000 / 3 = 533.333,33… — inteiro truncado pela action.
    expect(resumo.vendas.ticketMedioCents).toBe(Math.floor(1_600_000 / 3))

    expect(resumo.comissao.recebidaCents).toBe(80_000)
    expect(resumo.comissao.previstaCents).toBe(50_000)
    expect(resumo.comissao.atrasadaCents).toBe(30_000)
    expect(resumo.comissao.totalCents).toBe(160_000)

    // Origem: instagram soma as duas primeiras; "sem origem" é linha de verdade.
    const porOrigem = (origem: string | null) =>
      resumo.porOrigem.find((o) => o.origem === origem)
    expect(porOrigem('instagram')).toMatchObject({ vendas: 2, receitaBrutaCents: 1_300_000 })
    expect(porOrigem(null)).toMatchObject({ vendas: 1, receitaBrutaCents: 300_000 })
    // Maior receita primeiro — instagram acima de null.
    expect(resumo.porOrigem[0]!.origem).toBe('instagram')

    // Motivo de perda do deal perdido do período.
    const perdidas = resumo.motivosDePerda.filter((m) => m.motivo === 'preco')
    expect(perdidas).toHaveLength(1)
    expect(perdidas[0]!.negocios).toBe(1)
    expect(perdidas[0]!.valorCents).toBe(1_200_000)
  })

  it('sem vendas no período: zeros e arrays vazios — nunca NaN', async () => {
    const tenantId = randomUUID()
    registrar(tenantId)
    const tag = `qa-money-vazio-${tenantId.slice(0, 8)}`
    const userId = `qa-money-${randomUUID()}`

    await withTenant(tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `Agência ${tag}`, slug: tag })
      await tx.insert(user).values({
        id: userId,
        tenantId,
        name: 'QA Money Vazio Bot',
        email: `${userId}@exemplo-zarpa.test`,
      })
    })

    entrarComo({ tenantId, userId })

    const resultado = await resumoDoPeriodo({ mes: '2026-02' })
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)
    if (!resultado.ok) return

    expect(resultado.data.vendas).toMatchObject({
      total: 0,
      receitaBrutaCents: 0,
      taxaServicoCents: 0,
      ticketMedioCents: 0, // 0/0 é NaN em JS — a action promete 0
    })
    expect(resultado.data.comissao.totalCents).toBe(0)
    expect(resultado.data.porOrigem).toEqual([])
    expect(resultado.data.motivosDePerda).toEqual([])
    expect(resultado.data.periodo.rotulo).toBe('2026-02')
  })

  it('período inválido volta como DADOS_INVALIDOS — nunca 500', async () => {
    const tenantId = randomUUID()
    registrar(tenantId)
    const tag = `qa-money-erro-${tenantId.slice(0, 8)}`
    const userId = `qa-money-${randomUUID()}`

    await withTenant(tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `Agência ${tag}`, slug: tag })
      await tx.insert(user).values({
        id: userId,
        tenantId,
        name: 'QA Money Erro Bot',
        email: `${userId}@exemplo-zarpa.test`,
      })
    })

    entrarComo({ tenantId, userId })

    const resultado = await resumoDoPeriodo({ mes: '2026-09', de: '2026-09-01', ate: '2026-09-30' })
    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.code).toBe('DADOS_INVALIDOS')
  })
})

// ---------------------------------------------------------------------------
// §3 — listarEmViagem
// ---------------------------------------------------------------------------

describe('listarEmViagem — três grupos mutuamente exclusivos', () => {
  /** Fixture com UM deal por caso, com datas relativas ao relógio real (a action usa
   * "hoje" de UTC — o teste planta os casos ao redor). */
  async function seedViagens(): Promise<TenantFixture> {
    const tenantId = randomUUID()
    registrar(tenantId)
    const tag = `qa-viagens-${tenantId.slice(0, 8)}`
    const userId = `qa-viagens-${randomUUID()}`

    await withTenant(tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `Agência ${tag}`, slug: tag })
      await tx.insert(user).values({
        id: userId,
        tenantId,
        name: 'QA Viagens Bot',
        email: `${userId}@exemplo-zarpa.test`,
      })
    })

    const casos: {
      titulo: string
      partida: string | null
      volta: string | null
      whatsapp?: string
    }[] = [
      { titulo: 'Viaja em 5 dias', partida: diaRelativo(5), volta: diaRelativo(15), whatsapp: '11987650001' },
      { titulo: 'Viaja hoje', partida: diaRelativo(0), volta: diaRelativo(10) },
      { titulo: 'Em viagem com volta', partida: diaRelativo(-3), volta: diaRelativo(7) },
      { titulo: 'Em viagem sem volta', partida: diaRelativo(-3), volta: null },
      { titulo: 'Retornou ontem', partida: diaRelativo(-10), volta: diaRelativo(-1), whatsapp: '11987650002' },
      { titulo: 'Retornou há 20 dias', partida: diaRelativo(-30), volta: diaRelativo(-20) },
      { titulo: 'Ganho sem data', partida: null, volta: null },
    ]

    await withTenant(tenantId, async (tx) => {
      for (const caso of casos) {
        const [contato] = await tx
          .insert(contacts)
          .values({ tenantId, name: `Cliente ${caso.titulo}`, whatsapp: caso.whatsapp ?? null })
          .returning({ id: contacts.id })
        await tx.insert(deals).values({
          tenantId,
          contactId: contato!.id,
          title: caso.titulo,
          destination: 'Lisboa',
          stage: 'ganho',
          valueCents: 400_000,
          departureOn: caso.partida,
          returnOn: caso.volta,
          closedAt: new Date(),
        })
      }
    })

    return { tenantId, userId }
  }

  it('classifica os sete casos nos três grupos certos, sem sobreposição', async () => {
    const fixture = await seedViagens()
    entrarComo(fixture)

    const resultado = await listarEmViagem()
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)
    if (!resultado.ok) return
    const grupos: EmViagemGrupos = resultado.data

    const titulos = (lista: { title: string }[]) => lista.map((i) => i.title)

    // partindo: departureOn >= hoje, mais próxima primeiro (hoje com 0 vem primeiro).
    expect(titulos(grupos.partindo)).toEqual(['Viaja hoje', 'Viaja em 5 dias'])
    expect(grupos.partindo[0]!.diasRestantes).toBe(0)
    expect(grupos.partindo[1]!.diasRestantes).toBe(5)

    // emViagem: partida passada, volta futura OU null.
    expect(titulos(grupos.emViagem)).toEqual(['Em viagem com volta', 'Em viagem sem volta'])
    const semVolta = grupos.emViagem.find((i) => i.title === 'Em viagem sem volta')!
    expect(semVolta.returnOn).toBeNull()
    const comVolta = grupos.emViagem.find((i) => i.title === 'Em viagem com volta')!
    expect(comVolta.returnOn).toBe(diaRelativo(7))

    // retornou: returnOn no passado, mais RECENTE primeiro.
    expect(titulos(grupos.retornou)).toEqual(['Retornou ontem', 'Retornou há 20 dias'])
    expect(grupos.retornou[0]!.diasDesdeRetorno).toBe(1)
    expect(grupos.retornou[1]!.diasDesdeRetorno).toBe(20)

    // "Ganho sem data" não existe em grupo nenhum — sem a ida não há "em viagem".
    const todos = [...grupos.partindo, ...grupos.emViagem, ...grupos.retornou]
    expect(titulos(todos)).not.toContain('Ganho sem data')
    // Mutuamente exclusivos: 6 casos classificados, 6 entradas.
    expect(todos).toHaveLength(6)
  })

  it('contato vem com whatsapp pronto para o CTA de depoimento', async () => {
    const fixture = await seedViagens()
    entrarComo(fixture)

    const resultado = await listarEmViagem()
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return

    const ontem = resultado.data.retornou.find((i) => i.title === 'Retornou ontem')!
    expect(ontem.contactName).toBe('Cliente Retornou ontem')
    expect(ontem.contactWhatsapp).toBe('11987650002')
  })

  it('negócio de OUTRO tenant não entra — o escopo é o próprio tenant', async () => {
    const fixtureA = await seedViagens()
    const fixtureB = await seedViagens()
    entrarComo(fixtureA)

    const resultado = await listarEmViagem()
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return

    // A semeou 7 deals; se a leitura vazasse, viriam os 14.
    const todos = [
      ...resultado.data.partindo,
      ...resultado.data.emViagem,
      ...resultado.data.retornou,
    ]
    expect(todos).toHaveLength(6)
  })
})
