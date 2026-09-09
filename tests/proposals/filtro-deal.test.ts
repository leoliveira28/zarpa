/**
 * `listarPropostas({ dealId })` — o filtro que destrava a ficha do negócio
 * (`docs/handoffs/old_nao_abrir/nina-para-rafa.md`, item 4.1).
 *
 * Mesma filosofia de `tests/deals/funil.test.ts`: chama as funções REAIS de
 * `src/server/proposals.ts` contra um Postgres de verdade, só mockando
 * `requireAuthContext` (não existe sessão HTTP fora de uma requisição).
 *
 * O que este arquivo cobre (e nenhum outro cobria — `listarPropostas` não tinha
 * NENHUM teste direto antes dele):
 *  1. O filtro devolve SÓ as propostas do negócio pedido — e não filtrar devolve todas.
 *  2. `incluirArquivadas` continua valendo dentro do filtro: proposta arquivada do
 *     negócio some da lista a menos que o chamador peça de volta.
 *  3. ISOLAMENTO: `dealId` de outro tenant devolve lista vazia com `ok: true` — o corte
 *     é do RLS (`withTenant`), não do WHERE. Nem aparece que a proposta do outro
 *     tenant existia.
 *  4. `dealId` malformado falha com `DADOS_INVALIDOS`/`campo: 'dealId'` ANTES de abrir
 *     transação — uuid cru no Postgres seria erro 22P02 de driver, não envelope.
 *
 * Bônus de caminho: as propostas nascem via `criarPropostaAPartirDoNegocio` de verdade e
 * os negócios são inseridos só com o enum `stage` — o que atravessa o trigger
 * `deals_estagio_sync` da 0016 (que semeia o funil do tenant e resolve `stage_id`) em
 * todos os caminhos deste arquivo.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'
import { auditLog, contacts, deals, proposals, tenants, user } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: 'qa-propostas-user',
  email: 'qa-propostas@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { criarPropostaAPartirDoNegocio, listarPropostas } = await import('@/server/proposals')

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
  const seedTag = `qa-prop-deal-${prefix}-${tenantId.slice(0, 8)}`
  const userId = `qa-prop-deal-${prefix}-${randomUUID()}`

  await withTenant(tenantId, async (tx) => {
    await tx
      .insert(tenants)
      .values({ id: tenantId, name: `Agência QA Propostas ${seedTag}`, slug: seedTag })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Propostas Bot',
      email: `${userId}@exemplo-zarpa.com.br`,
    })
  })

  return { tenantId, userId }
}

async function seedContato(tenantId: string, name = 'Cliente QA Propostas'): Promise<string> {
  return withTenant(tenantId, async (tx) => {
    const [c] = await tx.insert(contacts).values({ tenantId, name }).returning({ id: contacts.id })
    return c!.id
  })
}

/** Insere o negócio DIRETO, só com o enum — é o caminho do seed e dos testes antigos,
 * e é o trigger da 0016 que resolve `stage_id` (semeando o funil do tenant). */
async function seedNegocio(tenantId: string, contactId: string, title: string): Promise<string> {
  return withTenant(tenantId, async (tx) => {
    const [linha] = await tx
      .insert(deals)
      .values({ tenantId, contactId, title, stage: 'novo' })
      .returning({ id: deals.id })
    return linha!.id
  })
}

/** Proposta de verdade, pelo caminho do produto (nunca insert cru no que a action cobre). */
async function seedProposta(tenantId: string, dealId: string, title: string): Promise<string> {
  const r = await criarPropostaAPartirDoNegocio({ dealId, title })
  if (!r.ok) throw new Error(`fixture: criarPropostaAPartirDoNegocio falhou: ${r.mensagem}`)
  return r.data.id
}

async function arquivarProposta(tenantId: string, propostaId: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx
      .update(proposals)
      .set({ archivedAt: new Date() })
      .where(and(eq(proposals.id, propostaId), isNull(proposals.archivedAt)))
  })
}

const criados: string[] = []

afterAll(async () => {
  // `globalSetup` recria o schema do zero a cada rodada da suíte inteira — limpeza
  // cosmética para rodadas locais repetidas, não requisito de isolamento (cada teste
  // usa `tenantId` novo e aleatório).
  for (const tenantId of criados) {
    try {
      await withTenant(tenantId, async (tx) => {
        await tx.delete(auditLog).where(eq(auditLog.tenantId, tenantId))
        await tx.delete(proposals).where(eq(proposals.tenantId, tenantId))
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
// 1) O filtro devolve só o negócio pedido
// ---------------------------------------------------------------------------

describe('listarPropostas({ dealId })', () => {
  it('devolve só as propostas do negócio pedido; sem filtro, devolve todas', async () => {
    const fixture = await seedTenant('filtro')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const contatoId = await seedContato(fixture.tenantId)
    const dealA = await seedNegocio(fixture.tenantId, contatoId, 'Lua de mel em Fernando de Noronha')
    const dealB = await seedNegocio(fixture.tenantId, contatoId, 'Família em Bariloche')

    const propostaA1 = await seedProposta(fixture.tenantId, dealA, 'Noronha — pacing colônia')
    const propostaA2 = await seedProposta(fixture.tenantId, dealA, 'Noronha — pousada boutique')
    await seedProposta(fixture.tenantId, dealB, 'Bariloche — julho')

    const filtrado = await listarPropostas({ dealId: dealA })
    expect(filtrado.ok).toBe(true)
    if (!filtrado.ok) return
    expect(filtrado.data).toHaveLength(2)
    expect(filtrado.data.map((p) => p.id).sort()).toEqual([propostaA1, propostaA2].sort())
    expect(filtrado.data.every((p) => p.dealId === dealA)).toBe(true)

    // Sem filtro, o comportamento de sempre continua: todas do tenant.
    const tudo = await listarPropostas()
    expect(tudo.ok).toBe(true)
    if (!tudo.ok) return
    expect(tudo.data).toHaveLength(3)

    // Um negócio pode ter mais de uma proposta — por isso o retorno é lista, não single.
    expect(tudo.data.filter((p) => p.dealId === dealA)).toHaveLength(2)
  })

  it('proposta arquivada do negócio só entra com incluirArquivadas', async () => {
    const fixture = await seedTenant('arquivada')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const contatoId = await seedContato(fixture.tenantId)
    const dealId = await seedNegocio(fixture.tenantId, contatoId, 'Casal no Chile')

    const ativa = await seedProposta(fixture.tenantId, dealId, 'Chile — ativa')
    const arquivada = await seedProposta(fixture.tenantId, dealId, 'Chile — arquivada')
    await arquivarProposta(fixture.tenantId, arquivada)

    const soAtivas = await listarPropostas({ dealId })
    expect(soAtivas.ok).toBe(true)
    if (!soAtivas.ok) return
    expect(soAtivas.data.map((p) => p.id)).toEqual([ativa])

    const comArquivadas = await listarPropostas({ dealId, incluirArquivadas: true })
    expect(comArquivadas.ok).toBe(true)
    if (!comArquivadas.ok) return
    expect(comArquivadas.data.map((p) => p.id).sort()).toEqual([ativa, arquivada].sort())
  })

  it('dealId de outro tenant devolve zero linhas — o corte é do RLS, não do WHERE', async () => {
    const dono = await seedTenant('dono')
    const visitante = await seedTenant('visitante')
    criados.push(dono.tenantId, visitante.tenantId)

    const contatoId = await seedContato(dono.tenantId)
    const dealAlheio = await seedNegocio(dono.tenantId, contatoId, 'Negócio de outro tenant')
    entrarComo(dono)
    await seedProposta(dono.tenantId, dealAlheio, 'Proposta de outro tenant')

    // Mesmo com o uuid EXATO do negócio alheio na mão: lista vazia, ok — nem aparece
    // que existia. É a mesma resposta de um dealId que não existe.
    entrarComo(visitante)
    const espiando = await listarPropostas({ dealId: dealAlheio })
    expect(espiando.ok).toBe(true)
    if (!espiando.ok) return
    expect(espiando.data).toHaveLength(0)
  })

  it('uuid malformado falha com DADOS_INVALIDOS/campo "dealId" antes de tocar no banco', async () => {
    const fixture = await seedTenant('malformado')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await listarPropostas({ dealId: 'nao-e-um-uuid' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('DADOS_INVALIDOS')
    expect(r.campo).toBe('dealId')
  })
})
