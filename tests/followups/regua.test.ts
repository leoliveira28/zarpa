/**
 * Critério de aceite da S8, ao pé da letra (`docs/handoffs/rafa-para-teo.md`):
 * "proposta enviada numa sexta gera três tarefas (D+2, D+5, D+10) nas datas certas, com
 * mensagem sugerida pronta, sem duplicar quando o cron roda duas vezes."
 *
 * Mesma filosofia de `tests/imports/import-planilha.test.ts`: chama as funções REAIS de
 * `src/server/followups.ts` contra um Postgres de verdade. Só a resolução de sessão
 * (`@/lib/auth/session`) é mockada, porque `listarTarefasDeHoje` lê `tenantId` de
 * `next/headers` + Better Auth, que não existe fora de uma requisição HTTP.
 * `rodarFilaDeFollowups` e `gerarFollowupsDaProposta` não passam por sessão nenhuma — são
 * o runner do cron e a peça reaproveitável, respectivamente — então não há mock ali.
 *
 * `sentAt` é congelado UMA VEZ por fixture, calculado a partir de "agora menos N dias" (a
 * janela de geração é 15 dias, então não dá para usar uma data absoluta fixa sem o teste
 * ficar sensível a quando ele roda) e reaproveitado em toda asserção de data — nunca
 * `new Date()` de novo dentro de uma asserção, isso é exatamente o tipo de teste que passa
 * por acaso quando os dois `new Date()` caem em milissegundos diferentes.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq, like, sql as dsql } from 'drizzle-orm'
import { contacts, deals, proposals, tasks, tenants } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'

// `vi.mock` é hoisted — precisa do padrão `vi.hoisted` para popular depois com valores
// que só existem em tempo de execução (mesmo padrão de `import-planilha.test.ts`).
const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: 'qa-followups-user',
  email: 'qa-followups@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { gerarFollowupsDaProposta, rodarFilaDeFollowups, listarTarefasDeHoje } = await import(
  '@/server/followups'
)

// ---------------------------------------------------------------------------
// Fixture: helpers para criar tenant + contato + negócio + proposta "sent" de verdade.
// Cada teste usa seu próprio tenant, para não depender de ordem nem se atrapalhar com
// `rodarFilaDeFollowups()` varrendo TODOS os tenants do banco (inclusive os de outros
// arquivos de teste, que ficam no mesmo `zarpa_test`).
// ---------------------------------------------------------------------------

type PropostaFixture = {
  tenantId: string
  contactId: string
  dealId: string
  propostaId: string
  sentAt: Date
}

/** Marca a data sem os milissegundos: Postgres `timestamptz` guarda microssegundos, o
 * driver `postgres.js` devolve `Date` — comparar por `getTime()` exige que a entrada
 * também não carregue frações que o banco vá arredondar de forma diferente. */
function dataCongelada(diasAtras: number): Date {
  const agora = new Date()
  agora.setUTCMilliseconds(0)
  agora.setUTCDate(agora.getUTCDate() - diasAtras)
  return agora
}

function somarDias(base: Date, dias: number): Date {
  const resultado = new Date(base.getTime())
  resultado.setUTCDate(resultado.getUTCDate() + dias)
  return resultado
}

/** Cria tenant + contato + negócio + proposta em status `sent`, com `sentAt` fixo,
 * inteiramente através de `withTenant` (o mesmo caminho que qualquer Server Action usa —
 * a fixture não escreve nada que a policy não aceitaria de uma requisição de verdade). */
async function seedPropostaEnviada(opts: {
  sentAt: Date
  destination?: string
  contactName?: string
}): Promise<PropostaFixture> {
  const tenantId = randomUUID()
  const seedTag = `qa-followups-${tenantId.slice(0, 8)}`

  const { contactId, dealId, propostaId } = await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: `Agência QA Followups ${seedTag}`,
      slug: seedTag,
    })

    const [contact] = await tx
      .insert(contacts)
      .values({
        tenantId,
        name: opts.contactName ?? 'Cliente QA Régua',
      })
      .returning({ id: contacts.id })

    const [deal] = await tx
      .insert(deals)
      .values({
        tenantId,
        contactId: contact!.id,
        title: 'Negócio QA régua de follow-up',
        destination: opts.destination ?? 'Lisboa',
      })
      .returning({ id: deals.id })

    const [proposta] = await tx
      .insert(proposals)
      .values({
        tenantId,
        dealId: deal!.id,
        publicToken: randomUUID(),
        title: 'Proposta QA régua de follow-up',
        status: 'sent',
        sentAt: opts.sentAt,
      })
      .returning({ id: proposals.id })

    return { contactId: contact!.id, dealId: deal!.id, propostaId: proposta!.id }
  })

  return { tenantId, contactId, dealId, propostaId, sentAt: opts.sentAt }
}

async function contarTarefasDaProposta(tenantId: string, propostaId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const linhas = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(like(tasks.dedupeKey, `followup:proposta:${propostaId}:%`))
    return linhas.length
  })
}

async function listarTarefasDaProposta(
  tenantId: string,
  propostaId: string,
): Promise<{ dedupeKey: string | null; dueAt: Date; suggestedMessage: string | null }[]> {
  return withTenant(tenantId, async (tx) => {
    const linhas = await tx
      .select({
        dedupeKey: tasks.dedupeKey,
        dueAt: tasks.dueAt,
        suggestedMessage: tasks.suggestedMessage,
      })
      .from(tasks)
      .where(like(tasks.dedupeKey, `followup:proposta:${propostaId}:%`))
      .orderBy(tasks.dueAt)
    return linhas
  })
}

const criados: string[] = [] // tenantIds a limpar no fim (best-effort — ver afterAll)

afterAll(async () => {
  // As tabelas de tenant estão sob FORCE ROW LEVEL SECURITY: apagar exige contexto do
  // próprio tenant. `globalSetup` recria o schema do zero a cada rodada da suíte inteira,
  // então isto é limpeza cosmética, não requisito de isolamento entre arquivos.
  for (const tenantId of criados) {
    try {
      await withTenant(tenantId, async (tx) => {
        await tx.delete(tasks).where(eq(tasks.tenantId, tenantId))
        await tx.delete(proposals).where(eq(proposals.tenantId, tenantId))
        await tx.delete(deals).where(eq(deals.tenantId, tenantId))
        await tx.delete(contacts).where(eq(contacts.tenantId, tenantId))
      })
    } catch {
      // best-effort
    }
  }
})

describe('aceite do S8 — proposta enviada gera D+2/D+5/D+10 com mensagem pronta', () => {
  it('gerarFollowupsDaProposta cria exatamente 3 tarefas, nas datas certas', async () => {
    const sentAt = dataCongelada(3) // "enviada há 3 dias" — dentro da janela de 15 dias
    const fixture = await seedPropostaEnviada({ sentAt, destination: 'Lisboa', contactName: 'Marina QA' })
    criados.push(fixture.tenantId)

    const criadas = await withTenant(fixture.tenantId, (tx) =>
      gerarFollowupsDaProposta(tx, fixture.tenantId, fixture.propostaId),
    )
    expect(criadas).toBe(3)

    const tarefas = await listarTarefasDaProposta(fixture.tenantId, fixture.propostaId)
    expect(tarefas).toHaveLength(3)

    const porSufixo = new Map(
      tarefas.map((t) => [t.dedupeKey?.split(':').pop() ?? '', t]),
    )
    expect([...porSufixo.keys()].sort()).toEqual(['d10', 'd2', 'd5'])

    // As datas são o ponto central do critério de aceite — não só a contagem.
    const esperado: Record<string, Date> = {
      d2: somarDias(sentAt, 2),
      d5: somarDias(sentAt, 5),
      d10: somarDias(sentAt, 10),
    }
    for (const [sufixo, dueAtEsperado] of Object.entries(esperado)) {
      const tarefa = porSufixo.get(sufixo)
      expect(tarefa, `tarefa ${sufixo} não encontrada`).toBeDefined()
      expect(tarefa!.dueAt.getTime()).toBe(dueAtEsperado.getTime())
    }

    // Mensagem sugerida presente e diferente marco a marco (não é a mesma frase 3x).
    for (const tarefa of tarefas) {
      expect(tarefa.suggestedMessage, 'suggestedMessage vazia').toBeTruthy()
      expect(tarefa.suggestedMessage!.length).toBeGreaterThan(10)
    }
    const mensagensUnicas = new Set(tarefas.map((t) => t.suggestedMessage))
    expect(mensagensUnicas.size).toBe(3)
  })

  it('rodar de novo (mesma proposta) não duplica — idempotência sequencial', async () => {
    const sentAt = dataCongelada(4)
    const fixture = await seedPropostaEnviada({ sentAt })
    criados.push(fixture.tenantId)

    const primeira = await withTenant(fixture.tenantId, (tx) =>
      gerarFollowupsDaProposta(tx, fixture.tenantId, fixture.propostaId),
    )
    expect(primeira).toBe(3)

    const segunda = await withTenant(fixture.tenantId, (tx) =>
      gerarFollowupsDaProposta(tx, fixture.tenantId, fixture.propostaId),
    )
    expect(segunda).toBe(0)

    // A prova que não depende do valor de retorno: conta o banco de novo.
    expect(await contarTarefasDaProposta(fixture.tenantId, fixture.propostaId)).toBe(3)
  })

  it('rodarFilaDeFollowups() duas vezes em sequência não duplica', async () => {
    const sentAt = dataCongelada(5)
    const fixture = await seedPropostaEnviada({ sentAt })
    criados.push(fixture.tenantId)

    const r1 = await rodarFilaDeFollowups()
    expect(r1.ok, !r1.ok ? r1.mensagem : '').toBe(true)

    const apos1 = await contarTarefasDaProposta(fixture.tenantId, fixture.propostaId)
    expect(apos1).toBe(3)

    const r2 = await rodarFilaDeFollowups()
    expect(r2.ok, !r2.ok ? r2.mensagem : '').toBe(true)

    const apos2 = await contarTarefasDaProposta(fixture.tenantId, fixture.propostaId)
    expect(apos2).toBe(3)
  })

  it('duas chamadas de rodarFilaDeFollowups() EM PARALELO não duplicam (cron concorrente)', async () => {
    const sentAt = dataCongelada(6)
    const fixture = await seedPropostaEnviada({ sentAt })
    criados.push(fixture.tenantId)

    const [r1, r2] = await Promise.all([rodarFilaDeFollowups(), rodarFilaDeFollowups()])
    expect(r1.ok, !r1.ok ? r1.mensagem : '').toBe(true)
    expect(r2.ok, !r2.ok ? r2.mensagem : '').toBe(true)

    // O índice único parcial (`tasks_tenant_dedupe_key`) é quem garante isto sob corrida
    // de verdade — sem ele, as duas transações concorrentes veriam "ainda não existe" ao
    // mesmo tempo e cada uma inseriria a sua, duplicando.
    expect(await contarTarefasDaProposta(fixture.tenantId, fixture.propostaId)).toBe(3)
  })

  it('proposta enviada há mais de 15 dias não gera régua (fora da janela)', async () => {
    const sentAt = dataCongelada(20)
    const fixture = await seedPropostaEnviada({ sentAt })
    criados.push(fixture.tenantId)

    const r = await rodarFilaDeFollowups()
    expect(r.ok, !r.ok ? r.mensagem : '').toBe(true)

    expect(await contarTarefasDaProposta(fixture.tenantId, fixture.propostaId)).toBe(0)
  })
})

describe('isolamento por tenant — proposta enviada num tenant não cria tarefa em outro', () => {
  it('duas propostas "sexta passada", tenants diferentes, cada um só vê a própria régua', async () => {
    const sentAt = dataCongelada(3)
    const fixtureA = await seedPropostaEnviada({ sentAt, destination: 'Porto' })
    const fixtureB = await seedPropostaEnviada({ sentAt, destination: 'Roma' })
    criados.push(fixtureA.tenantId, fixtureB.tenantId)

    const resultado = await rodarFilaDeFollowups()
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)

    expect(await contarTarefasDaProposta(fixtureA.tenantId, fixtureA.propostaId)).toBe(3)
    expect(await contarTarefasDaProposta(fixtureB.tenantId, fixtureB.propostaId)).toBe(3)

    // A prova de isolamento de verdade: dentro do contexto do tenant A, a régua da
    // proposta B é invisível — não porque a régua de B não rodou (rodou, a linha acima
    // prova), mas porque o RLS barra a leitura cruzada. Se algum dia esta feature
    // guardasse `tenantId` errado no INSERT, este teste veria vazamento aqui.
    const dedupeKeysDeBVistosPorA = await withTenant(fixtureA.tenantId, async (tx) => {
      const linhas = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(like(tasks.dedupeKey, `followup:proposta:${fixtureB.propostaId}:%`))
      return linhas.length
    })
    expect(dedupeKeysDeBVistosPorA).toBe(0)

    const dealsDeA = await withTenant(fixtureA.tenantId, async (tx) => {
      const linhas = await tx
        .select({ dealId: tasks.dealId })
        .from(tasks)
        .where(like(tasks.dedupeKey, `followup:proposta:${fixtureA.propostaId}:%`))
      return linhas.map((l) => l.dealId)
    })
    expect(dealsDeA.every((id) => id === fixtureA.dealId)).toBe(true)
  })
})

describe('listarTarefasDeHoje — leitura tenant-scoped, respeita doneAt e janela de data', () => {
  it('mostra tarefa vencida (D+2 no passado), esconde D+5/D+10 (futuro) e tarefa concluída', async () => {
    const sentAt = dataCongelada(3) // D+2 já venceu, D+5/D+10 ainda não
    const fixture = await seedPropostaEnviada({ sentAt, destination: 'Buenos Aires', contactName: 'Diego QA' })
    criados.push(fixture.tenantId)

    await withTenant(fixture.tenantId, (tx) =>
      gerarFollowupsDaProposta(tx, fixture.tenantId, fixture.propostaId),
    )

    authCtx.tenantId = fixture.tenantId

    const antesDeConcluir = await listarTarefasDeHoje()
    expect(antesDeConcluir.ok, !antesDeConcluir.ok ? antesDeConcluir.mensagem : '').toBe(true)
    if (!antesDeConcluir.ok) return

    const daProposta = antesDeConcluir.data.filter((t) =>
      t.dealId === fixture.dealId,
    )
    // Só D+2 apareceu — D+5 e D+10 estão no futuro.
    expect(daProposta).toHaveLength(1)
    expect(daProposta[0]!.vencida).toBe(true)
    expect(daProposta[0]!.suggestedMessage).toBeTruthy()
    expect(daProposta[0]!.destination).toBe('Buenos Aires')
    expect(daProposta[0]!.contactName).toBe('Diego QA')

    // Conclui a tarefa (doneAt) e confirma que ela some da lista.
    await withTenant(fixture.tenantId, async (tx) => {
      await tx
        .update(tasks)
        .set({ doneAt: new Date() })
        .where(and(eq(tasks.dealId, fixture.dealId), eq(tasks.tenantId, fixture.tenantId)))
    })

    const depoisDeConcluir = await listarTarefasDeHoje()
    expect(depoisDeConcluir.ok).toBe(true)
    if (!depoisDeConcluir.ok) return
    expect(depoisDeConcluir.data.filter((t) => t.dealId === fixture.dealId)).toHaveLength(0)
  })

  it('não vaza tarefa de outro tenant — a sessão mockada só enxerga a própria', async () => {
    const sentAt = dataCongelada(3)
    const fixtureMeu = await seedPropostaEnviada({ sentAt })
    const fixtureOutro = await seedPropostaEnviada({ sentAt })
    criados.push(fixtureMeu.tenantId, fixtureOutro.tenantId)

    await withTenant(fixtureMeu.tenantId, (tx) =>
      gerarFollowupsDaProposta(tx, fixtureMeu.tenantId, fixtureMeu.propostaId),
    )
    await withTenant(fixtureOutro.tenantId, (tx) =>
      gerarFollowupsDaProposta(tx, fixtureOutro.tenantId, fixtureOutro.propostaId),
    )

    authCtx.tenantId = fixtureMeu.tenantId
    const resultado = await listarTarefasDeHoje()
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return

    expect(resultado.data.some((t) => t.dealId === fixtureOutro.dealId)).toBe(false)
  })
})

describe('sanidade da fixture: dataCongelada/somarDias fazem o que dizem', () => {
  it('somarDias(sentAt, 2) é exatamente 2 dias em UTC depois de sentAt', () => {
    const base = new Date('2026-01-01T10:00:00.000Z')
    expect(somarDias(base, 2).toISOString()).toBe('2026-01-03T10:00:00.000Z')
  })
})
