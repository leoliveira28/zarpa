/**
 * `reabrirEstagio` (`src/server/pipelineStages.ts`) — o par do `arquivarEstagio`, que até
 * esta rodada não existia: arquivar coluna era sem volta. Arquivo NOVO de propósito —
 * `tests/deals/funil.test.ts` é do S16 e não foi editado.
 *
 * O que este arquivo trava:
 *  1. A coluna volta NO FIM DO ABERTO — antes do primeiro fim de funil ("Fechada"/
 *     "Perdida" continuam sendo as últimas do quadro), no mesmo lugar onde uma coluna
 *     NOVA entra (`criarEstagio` sem `position`); o buraco que o arquivar fechou é
 *     reaberto sem dupla posição.
 *  2. Rótulo em conflito com coluna ATIVA → entra com sufixo `(arquivada)`, a MESMA
 *     regra feia-de-propósito da semente de fábrica (`semear_estagios_padrao`, 0016) —
 *     a reativação nunca derruba no índice único `(tenant_id, lower(label))`.
 *  3. Idempotente: reabrir o que já está no quadro devolve o estado atual, sem audit
 *     novo.
 *  4. Teto de 12 colunas ativas vale para reabrir — reabrir é ganhar uma coluna de volta.
 *  5. Coluna de OUTRO tenant → NAO_ENCONTRADO (RLS transforma "não é seu" em "não
 *     existe").
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { auditLog, contacts, deals, pipelineStages, tenants, user } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: 'qa-reabrir-user',
  email: 'qa-reabrir@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}));

const {
  arquivarEstagio,
  criarEstagio,
  listarEstagios,
  reabrirEstagio,
} = await import('@/server/pipelineStages')

type TenantFixture = { tenantId: string; userId: string }

function entrarComo(fixture: TenantFixture): void {
  authCtx.tenantId = fixture.tenantId
  authCtx.userId = fixture.userId
}

async function seedTenant(prefix: string): Promise<TenantFixture> {
  const tenantId = randomUUID()
  const seedTag = `qa-reabrir-${prefix}-${tenantId.slice(0, 8)}`
  const userId = `qa-reabrir-${prefix}-${randomUUID()}`

  await withTenant(tenantId, async (tx) => {
    await tx
      .insert(tenants)
      .values({ id: tenantId, name: `Agência QA Reabrir ${seedTag}`, slug: seedTag })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Reabrir Bot',
      email: `${userId}@exemplo-zarpa.com.br`,
    })
  })

  return { tenantId, userId }
}

/** Funil de fábrica garantido: um negócio (com contato) atravessa o trigger da 0016,
 * que chama `semear_estagios_padrao` para tenants nascidos fora do serviço. */
async function semearFunil(tenantId: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const [contato] = await tx
      .insert(contacts)
      .values({ tenantId, name: 'Cliente QA Reabrir' })
      .returning({ id: contacts.id })
    await tx.insert(deals).values({ tenantId, contactId: contato!.id, title: 'Viagem QA', stage: 'novo' })
  })
}

async function auditsDeColuna(tenantId: string, stageId: string): Promise<string[]> {
  return withTenant(tenantId, async (tx) => {
    const linhas = await tx
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityId, stageId))
    return linhas.map((l) => l.action)
  })
}

const criados: string[] = []

beforeEach(() => {
  authCtx.userId = 'qa-reabrir-user'
})

afterAll(async () => {
  for (const tenantId of criados) {
    try {
      await withTenant(tenantId, async (tx) => {
        await tx.delete(auditLog).where(eq(auditLog.tenantId, tenantId))
        await tx.delete(deals).where(eq(deals.tenantId, tenantId))
        await tx.delete(contacts).where(eq(contacts.tenantId, tenantId))
        await tx.delete(pipelineStages).where(eq(pipelineStages.tenantId, tenantId))
        await tx.delete(user).where(eq(user.tenantId, tenantId))
        await tx.delete(tenants).where(eq(tenants.id, tenantId))
      })
    } catch {
      // best-effort — o globalSetup recria o schema a cada rodada
    }
  }
})

describe('reabrirEstagio', () => {
  it('devolve a coluna ao FIM DO ABERTO, na frente do fim de funil, fechando o próprio buraco', async () => {
    const fixture = await seedTenant('posicao')
    criados.push(fixture.tenantId)
    entrarComo(fixture)
    await semearFunil(fixture.tenantId)

    // Fábrica: Novo contato(0) Montando(1) Enviada(2) Negociando(3) Fechada(4) Perdida(5).
    const criada = await criarEstagio({ label: 'Orçamento' })
    expect(criada.ok).toBe(true)
    if (!criada.ok) return
    expect(criada.data.position).toBe(4)

    const arquivada = await arquivarEstagio({ id: criada.data.id })
    expect(arquivada.ok).toBe(true)
    if (!arquivada.ok) return
    // O arquivar fechou o buraco: Fechada desceu para 4.
    const depoisDeArquivar = await listarEstagios()
    expect(depoisDeArquivar.ok).toBe(true)
    if (!depoisDeArquivar.ok) return
    const fechadaDepois = depoisDeArquivar.data.find((e) => e.isWon)
    expect(fechadaDepois?.position).toBe(4)
    expect(depoisDeArquivar.data.find((e) => e.id === criada.data.id)).toBeUndefined()

    const reaberta = await reabrirEstagio({ id: criada.data.id })
    expect(reaberta.ok, !reaberta.ok ? reaberta.mensagem : '').toBe(true)
    if (!reaberta.ok) return
    expect(reaberta.data.archivedAt).toBeNull()
    expect(reaberta.data.label).toBe('Orçamento')
    // Fim do aberto: de volta à posição 4, EMPURRANDO Fechada/Perdida para o fim.
    expect(reaberta.data.position).toBe(4)
    expect(reaberta.data.totalNegocios).toBe(0)

    const quadro = await listarEstagios()
    expect(quadro.ok).toBe(true)
    if (!quadro.ok) return
    expect(quadro.data.map((e) => e.label)).toEqual([
      'Novo contato',
      'Montando',
      'Enviada',
      'Negociando',
      'Orçamento',
      'Fechada',
      'Perdida',
    ])
    // Sem dupla posição: cada posição ativa é única.
    const posicoes = quadro.data.map((e) => e.position)
    expect(new Set(posicoes).size).toBe(posicoes.length)

    // Auditoria do ciclo inteiro: created + archived + reopened (de/para iguais no
    // reopened, porque o rótulo não conflitou).
    const audits = await auditsDeColuna(fixture.tenantId, criada.data.id)
    expect(audits.sort()).toEqual([
      'pipeline_stage.archived',
      'pipeline_stage.created',
      'pipeline_stage.reopened',
    ])
  })

  it('rótulo em conflito com coluna ATIVA: volta com sufixo "(arquivada)" — a regra da semente', async () => {
    const fixture = await seedTenant('rotulo')
    criados.push(fixture.tenantId)
    entrarComo(fixture)
    await semearFunil(fixture.tenantId)

    const original = await criarEstagio({ label: 'Orçamento' })
    expect(original.ok).toBe(true)
    if (!original.ok) return

    const arquivada = await arquivarEstagio({ id: original.data.id })
    expect(arquivada.ok).toBe(true)
    if (!arquivada.ok) return

    // A agente recriou uma coluna de mesmo nome enquanto a antiga dormia arquivada.
    const nova = await criarEstagio({ label: 'Orçamento' })
    expect(nova.ok, !nova.ok ? nova.mensagem : '').toBe(true)
    if (!nova.ok) return

    const reaberta = await reabrirEstagio({ id: original.data.id })
    expect(reaberta.ok, !reaberta.ok ? reaberta.mensagem : '').toBe(true)
    if (!reaberta.ok) return
    // Determinístico e feio de propósito — e o quadro segue com as duas.
    expect(reaberta.data.label).toBe('Orçamento (arquivada)')
    const quadro = await listarEstagios()
    if (!quadro.ok) return
    expect(quadro.data.filter((e) => e.label.startsWith('Orçamento'))).toHaveLength(2)
  })

  it('idempotente: reabrir o que já está no quadro devolve o estado atual, sem audit novo', async () => {
    const fixture = await seedTenant('idempotente')
    criados.push(fixture.tenantId)
    entrarComo(fixture)
    await semearFunil(fixture.tenantId)

    const criada = await criarEstagio({ label: 'Documentos' })
    if (!criada.ok) throw new Error(`fixture: criarEstagio falhou: ${criada.mensagem}`)

    const primeira = await reabrirEstagio({ id: criada.data.id })
    expect(primeira.ok).toBe(true)
    if (!primeira.ok) return
    expect(primeira.data.archivedAt).toBeNull()
    expect(primeira.data.position).toBe(criada.data.position)

    const segunda = await reabrirEstagio({ id: criada.data.id })
    expect(segunda.ok).toBe(true)
    if (!segunda.ok) return
    expect(segunda.data.position).toBe(primeira.data.position)
    expect(segunda.data.archivedAt).toBeNull()

    // Só o audit da criação — reabrir coluna viva não escreve história.
    expect(await auditsDeColuna(fixture.tenantId, criada.data.id)).toEqual([
      'pipeline_stage.created',
    ])
  })

  it('teto de 12 colunas ativas: sem vaga no quadro, a reabertura é recusada', async () => {
    const fixture = await seedTenant('teto')
    criados.push(fixture.tenantId)
    entrarComo(fixture)
    await semearFunil(fixture.tenantId)

    // 6 de fábrica + 6 criadas = 12 (o máximo).
    const ids: string[] = []
    for (let n = 1; n <= 6; n += 1) {
      const r = await criarEstagio({ label: `Coluna ${n}` })
      expect(r.ok, !r.ok ? r.mensagem : '').toBe(true)
      if (!r.ok) return
      ids.push(r.data.id)
    }

    // Arquiva uma para abrir vaga, cria outra para consumir a vaga, e tenta reabrir.
    const arquivada = await arquivarEstagio({ id: ids[0]! })
    expect(arquivada.ok).toBe(true)
    if (!arquivada.ok) return
    const ocupante = await criarEstagio({ label: 'Coluna que ficou' })
    expect(ocupante.ok).toBe(true)
    if (!ocupante.ok) return

    const reaberta = await reabrirEstagio({ id: ids[0]! })
    expect(reaberta.ok).toBe(false)
    if (reaberta.ok) return
    expect(reaberta.code).toBe('CONFLITO')
    expect(reaberta.mensagem).toBe('O funil já tem 12 colunas — o máximo.')
    expect(reaberta.correcao).toBe('Arquivar uma coluna ativa antes de reabrir outra')
  })

  it('coluna de OUTRO tenant → NAO_ENCONTRADO (RLS transforma "não é seu" em "não existe")', async () => {
    const dona = await seedTenant('dona')
    const visitante = await seedTenant('visitante')
    criados.push(dona.tenantId, visitante.tenantId)
    await semearFunil(dona.tenantId)

    // O id da coluna alheia, lido no contexto DELA.
    const idAlheio = await withTenant(dona.tenantId, async (tx) => {
      const [linha] = await tx
        .select({ id: pipelineStages.id })
        .from(pipelineStages)
        .where(eq(pipelineStages.legacyStage, 'negociando'))
      return linha!.id
    })

    entrarComo(visitante)
    const r = await reabrirEstagio({ id: idAlheio })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('NAO_ENCONTRADO')
    expect(r.mensagem).toBe('Essa coluna não existe mais.')
  })
})
