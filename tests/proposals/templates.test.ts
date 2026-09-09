/**
 * Modelos de proposta (fase 1 do roadmap) — `src/server/proposalTemplates.ts` +
 * migration `0018_modelos_de_proposta`.
 *
 * Funções REAIS contra o Postgres, mockando só `requireAuthContext` (mesma filosofia
 * de `tests/money/resumo.test.ts`). O essencial de UMA tabela nova:
 *   1. fotografar blocos na criação (e virar padrão do tenant);
 *   2. nascer proposta de modelo com os blocos copiados;
 *   3. O ISOLAMENTO — modelo de outro tenant não lista, não copia e não apaga
 *      (RLS provado pela via da aplicação, que roda NOBYPASSRLS).
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import {
  contacts,
  deals,
  proposalBlocks,
  proposalTemplates,
  proposals,
  tenants,
  user,
} from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: '',
  email: 'qa-template@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const {
  listarTemplates,
  obterConteudoDoTemplate,
  criarTemplateDeProposta,
  removerTemplate,
  definirTemplatePadrao,
  criarPropostaDeTemplate,
} = await import('@/server/proposalTemplates')

type TenantFixture = { tenantId: string; userId: string }

function entrarComo(fixture: TenantFixture): void {
  authCtx.tenantId = fixture.tenantId
  authCtx.userId = fixture.userId
}

const tenantIds: string[] = []

async function apagar(tenantId: string): Promise<void> {
  try {
    await withTenant(tenantId, async (tx) => {
      await tx.delete(proposalBlocks)
      await tx.delete(proposalTemplates)
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

const userPorTenant = new Map<string, string>()

/** Proposta com três blocos (posições com buraco de propósito — a fotografia renumera). */
async function seedPropostaComBlocos(tenantId: string): Promise<{ propostaId: string; dealId: string }> {
  const tag = `qa-tpl-${tenantId.slice(0, 8)}`
  const userId = `qa-tpl-${randomUUID()}`

  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `Agência ${tag}`, slug: tag })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Template Bot',
      email: `${userId}@exemplo-zarpa.test`,
    })
  })
  userPorTenant.set(tenantId, userId)
  if (!tenantIds.includes(tenantId)) tenantIds.push(tenantId)

  return withTenant(tenantId, async (tx) => {
    const [contato] = await tx
      .insert(contacts)
      .values({ tenantId, name: 'Cliente Modelo' })
      .returning({ id: contacts.id })
    const [deal] = await tx
      .insert(deals)
      .values({
        tenantId,
        contactId: contato!.id,
        title: 'Japão em abril',
        destination: 'Tóquio',
        currency: 'BRL',
      })
      .returning({ id: deals.id })
    const [proposta] = await tx
      .insert(proposals)
      .values({
        tenantId,
        dealId: deal!.id,
        publicToken: randomUUID(),
        title: 'Proposta — Tóquio',
      })
      .returning({ id: proposals.id })
    await tx.insert(proposalBlocks).values([
      { tenantId, proposalId: proposta!.id, kind: 'flight', position: 0, title: 'Voo GR → NRT' },
      { tenantId, proposalId: proposta!.id, kind: 'hotel', position: 4, title: 'Shinjuku' },
      {
        tenantId,
        proposalId: proposta!.id,
        kind: 'text',
        position: 9,
        title: 'Sobre a viagem',
        body: 'Dez dias de primavera.',
        content: { noites: 10 },
      },
    ])
    return { propostaId: proposta!.id, dealId: deal!.id }
  })
}

describe('modelos de proposta', () => {
  it('fotografa os blocos da proposta e vira padrão do tenant', async () => {
    const tenantId = randomUUID()
    const { propostaId } = await seedPropostaComBlocos(tenantId)
    entrarComo({ tenantId, userId: userPorTenant.get(tenantId)! })

    const resultado = await criarTemplateDeProposta({ proposalId: propostaId, name: 'Japão base' })
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)
    if (!resultado.ok) return

    expect(resultado.data.name).toBe('Japão base')
    expect(resultado.data.isDefault).toBe(false)

    // A fotografia: três blocos, posições RENUMERADAS 0..n-1, content preservado.
    const blocos = await obterConteudoDoTemplate(resultado.data.id)
    expect(blocos.ok).toBe(true)
    if (!blocos.ok) return
    expect(blocos.data.map((b) => b.kind)).toEqual(['flight', 'hotel', 'text'])
    expect(blocos.data.map((b) => b.position)).toEqual([0, 1, 2])
    expect(blocos.data[2]!.content).toEqual({ noites: 10 })
    expect(blocos.data.every((b) => !('optionId' in b))).toBe(true)

    // Padrão do tenant: liga, e a lista traz primeiro.
    const padrao = await definirTemplatePadrao(resultado.data.id)
    expect(padrao.ok).toBe(true)
    if (!padrao.ok) return
    expect(padrao.data.isDefault).toBe(true)

    const lista = await listarTemplates()
    expect(lista.ok).toBe(true)
    if (!lista.ok) return
    expect(lista.data[0]!.id).toBe(resultado.data.id)
  })

  it('nasce proposta de modelo com os blocos copiados — draft, sem opção', async () => {
    const tenantId = randomUUID()
    const { propostaId, dealId } = await seedPropostaComBlocos(tenantId)
    entrarComo({ tenantId, userId: userPorTenant.get(tenantId)! })

    const modelo = await criarTemplateDeProposta({ proposalId: propostaId, name: 'Base Tóquio' })
    expect(modelo.ok, !modelo.ok ? modelo.mensagem : '').toBe(true)
    if (!modelo.ok) return

    const resultado = await criarPropostaDeTemplate({ templateId: modelo.data.id, dealId })
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)
    if (!resultado.ok) return

    // A proposta nova existe, é draft, e tem os três blocos de volta (sem option_id).
    const copiada = await withTenant(tenantId, async (tx) => {
      const [proposta] = await tx
        .select({
          id: proposals.id,
          status: proposals.status,
          title: proposals.title,
          dealId: proposals.dealId,
        })
        .from(proposals)
        .where(eq(proposals.id, resultado.data.proposalId))
        .limit(1)
      const blocos = await tx
        .select({
          kind: proposalBlocks.kind,
          position: proposalBlocks.position,
          optionId: proposalBlocks.optionId,
        })
        .from(proposalBlocks)
        .where(eq(proposalBlocks.proposalId, resultado.data.proposalId))
        .orderBy(asc(proposalBlocks.position))
      return { proposta, blocos }
    })

    expect(copiada.proposta!.status).toBe('draft')
    expect(copiada.proposta!.dealId).toBe(dealId)
    expect(copiada.proposta!.title).toBe('Proposta — Tóquio')
    expect(copiada.blocos.map((b) => b.kind)).toEqual(['flight', 'hotel', 'text'])
    expect(copiada.blocos.every((b) => b.optionId === null)).toBe(true)
  })

  it('isolamento: modelo de outro tenant não lista, não copia e não apaga', async () => {
    const tenantA = randomUUID()
    const { propostaId } = await seedPropostaComBlocos(tenantA)
    entrarComo({ tenantId: tenantA, userId: userPorTenant.get(tenantA)! })

    const criado = await criarTemplateDeProposta({ proposalId: propostaId, name: 'Secreto' })
    expect(criado.ok).toBe(true)
    if (!criado.ok) return
    const idAlheio = criado.data.id

    // Outro tenant (nem precisa de fixture: com outro GUC, o RLS devolve vazio/morta).
    const tenantB = randomUUID()
    entrarComo({ tenantId: tenantB, userId: `qa-tpl-outro-${randomUUID()}` })

    const lista = await listarTemplates()
    expect(lista.ok).toBe(true)
    if (!lista.ok) return
    expect(lista.data.find((t) => t.id === idAlheio)).toBeUndefined()

    const conteudoAlheio = await obterConteudoDoTemplate(idAlheio)
    expect(conteudoAlheio.ok).toBe(false)
    if (conteudoAlheio.ok) return
    expect(conteudoAlheio.code).toBe('NAO_ENCONTRADO')

    const remocao = await removerTemplate(idAlheio)
    expect(remocao.ok).toBe(false)
    if (remocao.ok) return
    expect(remocao.code).toBe('NAO_ENCONTRADO')

    // E o modelo continua lá para o dono.
    entrarComo({ tenantId: tenantA, userId: userPorTenant.get(tenantA)! })
    const conteudo = await obterConteudoDoTemplate(idAlheio)
    expect(conteudo.ok).toBe(true)
  })
})
