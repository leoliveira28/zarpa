/**
 * Fase 3 (§4) — o escopo `own` FORA da RLS, decidido no service layer.
 *
 * A decisão do doc: RLS continua garantindo isolamento ENTRE tenants (isso é
 * segurança, coberto por `tenant-isolation.test.ts`). DENTRO do tenant, quem é da
 * equipe passa a ver só o PRÓPRIO trabalho — e isso NÃO é policy de banco, é filtro de
 * aplicação (`TenantScope`/`filtroDeEscopoProprio` em `withTenant.ts`), porque visibilidade
 * é regra de produto, não fronteira de segurança. A decisão de escopo mora em
 * `escopoDaSessao` (`src/server/escopo.ts`): papel 'owner' → tenant inteiro; qualquer
 * outro → só as linhas com `agent_id = userId`.
 *
 * O que está travado aqui (o essencial do escopo, no funil — a listagem quente):
 *  1. Membro (role 'agent'): `listarNegociosDoFunil` devolve SÓ os negócios atribuídos
 *     a ele — nem do dono, nem de outro membro.
 *  2. Negócio SEM vendedor (`agent_id` null, estado legítimo de dado antigo/import):
 *     invisível para o membro (o filtro é igualdade, null não casa) — e visível para o
 *     dono, que é quem resolve a atribuição.
 *  3. Dono (role 'owner'): vê o tenant inteiro, atribuído ou não.
 *  4. A guarda de reatribuição: membro NÃO muda `agent_id` (`atualizarNegocio` recusa
 *     com a correção certa) — o escopo `own` não vira escalada disfarçada.
 *
 * Sem mock de RLS, sem segundo banco: as MESMAS policies do funil seguem valendo — o
 * escopo só estreita por cima delas.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { contacts, deals, tenants, user } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: '',
  email: 'qa-escopo@example.com',
  role: 'agent',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { listarNegociosDoFunil, atualizarNegocio } = await import('@/server/deals')

// ---------------------------------------------------------------------------
// Fixture — um tenant, dois usuários (dono e agente), três negócios
// ---------------------------------------------------------------------------

type Fixture = {
  tenantId: string
  donoId: string
  agenteId: string
  contatoId: string
  dealDoAgente: string
  dealDoDono: string
  dealSemVendedor: string
}

async function seedEscopo(): Promise<Fixture> {
  const tenantId = randomUUID()
  // Ids de usuário são uuid DE VERDADE: `withTenant` afirma que o `scope.userId` do
  // escopo `own` é uuid (falha alta de propósito — nunca alargar escopo silenciosamente),
  // e o zod da reatribuição (`z.uuid`) também recusaria um id falso pelo motivo errado.
  const donoId = randomUUID()
  const agenteId = randomUUID()

  const ids = await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: `Agência QA Escopo ${tenantId.slice(0, 8)}`,
      slug: `qa-escopo-${tenantId.slice(0, 8)}`,
    })
    await tx.insert(user).values([
      { id: donoId, tenantId, name: 'Dono QA', email: `${donoId}@exemplo-zarpa.com.br`, role: 'owner' },
      { id: agenteId, tenantId, name: 'Agente QA', email: `${agenteId}@exemplo-zarpa.com.br`, role: 'agent' },
    ])
    const [contato] = await tx
      .insert(contacts)
      .values({ tenantId, name: 'Cliente QA Escopo' })
      .returning({ id: contacts.id })

    const plantar = (title: string, agentId: string | null) =>
      tx
        .insert(deals)
        .values({ tenantId, contactId: contato!.id, title, valueCents: 100_000, agentId })
        .returning({ id: deals.id })

    const [doAgente] = await plantar('Negócio do AGENTE', agenteId)
    const [doDono] = await plantar('Negócio do DONO', donoId)
    const [semVendedor] = await plantar('Negócio sem vendedor (dado antigo)', null)

    return {
      contatoId: contato!.id,
      dealDoAgente: doAgente!.id,
      dealDoDono: doDono!.id,
      dealSemVendedor: semVendedor!.id,
    }
  })

  return { tenantId, donoId, agenteId, ...ids }
}

function entrarComo(
  fixture: Pick<Fixture, 'tenantId'>,
  usuario: { id: string; role: 'owner' | 'agent' },
): void {
  authCtx.tenantId = fixture.tenantId
  authCtx.userId = usuario.id
  authCtx.role = usuario.role
}

const criados: string[] = []

afterAll(async () => {
  for (const tenantId of criados) {
    try {
      await withTenant(tenantId, async (tx) => {
        await tx.delete(deals).where(eq(deals.tenantId, tenantId))
        await tx.delete(contacts).where(eq(contacts.tenantId, tenantId))
        await tx.delete(user).where(eq(user.tenantId, tenantId))
        await tx.delete(tenants).where(eq(tenants.id, tenantId))
      })
    } catch {
      // best-effort
    }
  }
})

// ---------------------------------------------------------------------------
// 1 + 2 + 3. A listagem do funil sob os dois escopos
// ---------------------------------------------------------------------------

describe('escopo own no funil — membro vê o próprio, dono vê o tenant', () => {
  it('role "agent": só os negócios com agent_id = ele; nem do dono, nem sem vendedor', async () => {
    const f = await seedEscopo()
    criados.push(f.tenantId)
    entrarComo(f, { id: f.agenteId, role: 'agent' })

    const board = await listarNegociosDoFunil()
    expect(board.ok, !board.ok ? board.mensagem : '').toBe(true)
    if (!board.ok) return

    const ids = board.data.map((d) => d.id)
    expect(ids).toContain(f.dealDoAgente)
    expect(ids).not.toContain(f.dealDoDono)
    // Igualdade não casa NULL — negócio sem vendedor é para o DONO resolver, não
    // aparecer na mesa de quem não pode atribuir.
    expect(ids).not.toContain(f.dealSemVendedor)
    expect(ids).toHaveLength(1)

    // E a linha devolvida diz quem é o agente (o contrato do board da Fase 3).
    const linha = board.data.find((d) => d.id === f.dealDoAgente)!
    expect(linha.agentId).toBe(f.agenteId)
    expect(linha.agentName).toBe('Agente QA')
  })

  it('role "owner": o tenant inteiro — os dois atribuídos e o sem vendedor', async () => {
    const f = await seedEscopo()
    criados.push(f.tenantId)
    entrarComo(f, { id: f.donoId, role: 'owner' })

    const board = await listarNegociosDoFunil()
    expect(board.ok, !board.ok ? board.mensagem : '').toBe(true)
    if (!board.ok) return

    const ids = board.data.map((d) => d.id)
    expect(ids).toEqual(
      expect.arrayContaining([f.dealDoAgente, f.dealDoDono, f.dealSemVendedor]),
    )
    // A linha do agente traz o NOME dele para o dono — é a visão de gestão.
    const linha = board.data.find((d) => d.id === f.dealDoAgente)!
    expect(linha.agentId).toBe(f.agenteId)
  })
})

// ---------------------------------------------------------------------------
// 4. Reatribuição — decisão de dono, nunca de quem está sob escopo own
// ---------------------------------------------------------------------------

describe('guarda de reatribuição — membro não muda agent_id', () => {
  it('role "agent" tenta reatribuir o próprio negócio: DADOS_INVALIDOS com a correção, e o banco não muda', async () => {
    const f = await seedEscopo()
    criados.push(f.tenantId)
    entrarComo(f, { id: f.agenteId, role: 'agent' })

    const r = await atualizarNegocio(f.dealDoAgente, { agentId: f.donoId })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('DADOS_INVALIDOS')
    expect(r.campo).toBe('agentId')
    expect(r.mensagem).toMatch(/dono da conta/i)
    expect(r.correcao).toBeTruthy()

    const [depois] = await withTenant(f.tenantId, (tx) =>
      tx.select({ agentId: deals.agentId }).from(deals).where(eq(deals.id, f.dealDoAgente)),
    )
    expect(depois?.agentId).toBe(f.agenteId)
  })
})
