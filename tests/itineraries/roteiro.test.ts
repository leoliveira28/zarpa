/**
 * S14 §4 — o lado AUTENTICADO do roteiro: `gerarRoteiro`/`listarRoteiros`
 * (`src/server/itineraries.ts`) e o `obterRoteiroPublico` como consumidor do snapshot
 * (`src/server/publicItineraries.ts`).
 *
 * Mesma filosofia de `tests/sales/vendas.test.ts`: as funções REAIS contra o Postgres de
 * teste, mockando UMA coisa só — `requireAuthContext` (não existe sessão HTTP fora de
 * uma requisição). O que a varredura por catálogo (`tenant-isolation.test.ts`) já cobre
 * em SQL direto para `itineraries` não é repetido aqui; o que ESTE arquivo cobre é a
 * camada de cima:
 *
 *  1. Recusas com mensagem certa: negócio que não é `ganho` → `CONFLITO`; `ganho` sem
 *     proposta aceita → `CONFLITO` apontando o aceite; negócio inexistente/de outro
 *     tenant → `NAO_ENCONTRADO` (RLS transforma "existe em outro lugar" em "não existe").
 *  2. Idempotência sob clique duplo — sequencial E concorrente (`Promise.allSettled`):
 *     o índice único `itineraries_deal_id_key` + `onConflictDoNothing` + reselect, com a
 *     verdade contada NO BANCO, não no retorno.
 *  3. Fotografia, não vista: editar os blocos da proposta DEPOIS de gerar não muda o
 *     payload público (`blocks_snapshot`, não JOIN), e não há regeneração.
 *  4. `ON DELETE RESTRICT` — documento entregue não pode sumir por cascata.
 *
 * A varredura de VAZAMENTO do payload público (canários, campos proibidos, padrões) e o
 * isolamento A/B em SQL direto estão em `tests/security/public-roteiro.test.ts` — mesmo
 * padrão do par `public-proposal.test.ts`/`leak-scanner.ts`.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import {
  auditLog,
  itineraries,
  proposalBlocks,
  type NewItinerary,
} from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'
import {
  BRAND_SNAPSHOT_FIXTURE,
  PARTIDA_FIXTURE,
  VOLTA_FIXTURE,
  apagarCenarioRoteiro,
  seedCenarioRoteiro,
  type CenarioRoteiro,
} from '../helpers/roteiro'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: '',
  email: 'qa-roteiro@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { gerarRoteiro, listarRoteiros } = await import('@/server/itineraries')
const { obterRoteiroPublico } = await import('@/server/publicItineraries')
// Type-only: apagado na compilação, não toca no módulo 'use server' em runtime.
type BlocoDoRoteiro = import('@/server/itineraries').BlocoDoRoteiro

/** Troca a sessão mockada para o cenário dado (usuário DE VERDADE no banco — o audit
 * tem FK real para `user`). */
function entrarComo(cenario: Pick<CenarioRoteiro, 'tenantId' | 'userId'>): void {
  authCtx.tenantId = cenario.tenantId
  authCtx.userId = cenario.userId
}

/** O driver embrulha o erro real do Postgres em `.cause` — achata a cadeia inteira. */
function textoCompletoDoErro(erro: unknown): string {
  const partes: string[] = []
  let atual: unknown = erro
  let voltas = 0
  while (atual && voltas < 5) {
    if (atual instanceof Error) {
      partes.push(atual.message)
      atual = (atual as Error & { cause?: unknown }).cause
    } else {
      partes.push(String(atual))
      atual = undefined
    }
    voltas++
  }
  return partes.join(' | ')
}

async function contarRoteirosDoDeal(tenantId: string, dealId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const linhas = await tx
      .select({ id: itineraries.id })
      .from(itineraries)
      .where(eq(itineraries.dealId, dealId))
    return linhas.length
  })
}

async function contarAuditoriaDoRoteiro(
  tenantId: string,
  roteiroId: string,
): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const linhas = await tx
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'itinerary'), eq(auditLog.entityId, roteiroId)))
    return linhas.length
  })
}

const tenantIds: string[] = []

function registrar(cenario: CenarioRoteiro): CenarioRoteiro {
  tenantIds.push(cenario.tenantId)
  return cenario
}

afterAll(async () => {
  for (const tenantId of [...new Set(tenantIds)]) {
    await apagarCenarioRoteiro(tenantId)
  }
})

// ---------------------------------------------------------------------------
// Recusas
// ---------------------------------------------------------------------------

describe('gerarRoteiro — recusas', () => {
  it('negócio que não é ganho → CONFLITO, e nada é gravado', async () => {
    const cenario = registrar(await seedCenarioRoteiro({ stage: 'cotando' }))
    entrarComo(cenario)

    const resultado = await gerarRoteiro(cenario.dealId)
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(false)
    if (resultado.ok) return
    expect(resultado.code).toBe('CONFLITO')
    expect(resultado.mensagem).toBe('Só dá para gerar roteiro de negócio fechado como ganho.')
    expect(resultado.correcao).toBe('Mover o negócio para Fechada antes')

    expect(await contarRoteirosDoDeal(cenario.tenantId, cenario.dealId)).toBe(0)
  })

  it('negócio ganho SEM proposta aceita → CONFLITO apontando o aceite, e nada é gravado', async () => {
    const cenario = registrar(await seedCenarioRoteiro({ propostaAceita: false }))
    entrarComo(cenario)

    const resultado = await gerarRoteiro(cenario.dealId)
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(false)
    if (resultado.ok) return
    expect(resultado.code).toBe('CONFLITO')
    expect(resultado.mensagem).toBe('Este negócio fechado não tem proposta aceita.')
    expect(resultado.correcao).toBe('Registrar o aceite da proposta antes de gerar o roteiro')

    expect(await contarRoteirosDoDeal(cenario.tenantId, cenario.dealId)).toBe(0)
  })

  it('dealId inexistente → NAO_ENCONTRADO ("não existe mais", não erro de permissão)', async () => {
    const cenario = registrar(await seedCenarioRoteiro())
    entrarComo(cenario)

    const resultado = await gerarRoteiro(randomUUID())
    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.code).toBe('NAO_ENCONTRADO')
    expect(resultado.mensagem).toBe('Esse negócio não existe mais.')
  })

  it('deal de OUTRO tenant → NAO_ENCONTRADO (RLS transforma em "não existe")', async () => {
    const cenarioA = registrar(await seedCenarioRoteiro())
    const cenarioB = registrar(await seedCenarioRoteiro())
    entrarComo(cenarioB)

    const resultado = await gerarRoteiro(cenarioA.dealId)
    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.code).toBe('NAO_ENCONTRADO')

    // B não conseguiu gerar — o negócio de A segue sem roteiro.
    expect(await contarRoteirosDoDeal(cenarioA.tenantId, cenarioA.dealId)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Geração, snapshot, idempotência
// ---------------------------------------------------------------------------

describe('gerarRoteiro — fotografia do fechado', () => {
  it('gera o roteiro com título/cliente/datas da proposta aceita e token base64url de 128 bits', async () => {
    const cenario = registrar(await seedCenarioRoteiro())
    entrarComo(cenario)

    const resultado = await gerarRoteiro(cenario.dealId)
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)
    if (!resultado.ok) return

    expect(resultado.data.title).toBe(cenario.propostaTitle)
    expect(resultado.data.clientName).toBe(cenario.contactName)
    expect(resultado.data.currency).toBe('BRL')
    expect(resultado.data.departureOn).toBe(PARTIDA_FIXTURE)
    expect(resultado.data.returnOn).toBe(VOLTA_FIXTURE)
    expect(resultado.data.dealId).toBe(cenario.dealId)
    expect(resultado.data.proposalId).toBe(cenario.propostaId)
    // 16 bytes base64url = 22 caracteres, sem +/ (mesmo desenho do publicToken da proposta).
    expect(resultado.data.publicToken).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })

  it('snapshot leva os blocos compartilhados + os da opção aceita, e NUNCA os da outra opção', async () => {
    const cenario = registrar(await seedCenarioRoteiro())
    entrarComo(cenario)

    const gerado = await gerarRoteiro(cenario.dealId)
    expect(gerado.ok).toBe(true)
    if (!gerado.ok) return

    const snapshot = await withTenant(cenario.tenantId, async (tx) => {
      const [linha] = await tx
        .select({
          blocksSnapshot: itineraries.blocksSnapshot,
          brandSnapshot: itineraries.brandSnapshot,
        })
        .from(itineraries)
        .where(eq(itineraries.dealId, cenario.dealId))
      return linha!
    })

    // `blocks_snapshot` é jsonb sem $type no schema — o tipo NOMANDO a forma é
    // BlocoDoRoteiro, da própria action. Cast explícito, não `any`.
    const blocos = snapshot.blocksSnapshot as BlocoDoRoteiro[]
    expect(blocos).toHaveLength(3)
    expect(blocos.map((b) => b.position)).toEqual([1, 2, 3])
    // O bloco da opção econômica (position 4) ficou fora da fotografia.
    expect(blocos.map((b) => b.title)).toEqual(['Voo de ida', 'Hotel do conforto', 'Boas-vindas'])

    // Forma do bloco no snapshot: SEM id/optionId/proposalId/tenantId — linhagem
    // interna não é conteúdo para o cliente.
    for (const bloco of blocos) {
      expect(Object.keys(bloco).sort()).toEqual(
        ['body', 'content', 'images', 'kind', 'position', 'title'],
      )
      expect(Array.isArray(bloco.images)).toBe(true)
      expect(typeof bloco.content).toBe('object')
    }

    // Marca congelada da PROPOSTA (brand_snapshot), não do cadastro corrente.
    expect(snapshot.brandSnapshot).toMatchObject({
      name: BRAND_SNAPSHOT_FIXTURE.name,
      whatsapp: BRAND_SNAPSHOT_FIXTURE.whatsapp,
      instagram: BRAND_SNAPSHOT_FIXTURE.instagram,
    })
  })

  it('idempotência sequencial: segunda chamada devolve o MESMO roteiro, uma linha, um audit só', async () => {
    const cenario = registrar(await seedCenarioRoteiro())
    entrarComo(cenario)

    const primeira = await gerarRoteiro(cenario.dealId)
    expect(primeira.ok).toBe(true)
    if (!primeira.ok) return

    const segunda = await gerarRoteiro(cenario.dealId)
    expect(segunda.ok).toBe(true)
    if (!segunda.ok) return

    expect(segunda.data.id).toBe(primeira.data.id)
    expect(segunda.data.publicToken).toBe(primeira.data.publicToken)
    expect(await contarRoteirosDoDeal(cenario.tenantId, cenario.dealId)).toBe(1)
    // O caminho do "já existe" retorna cedo — sem segundo audit.
    expect(await contarAuditoriaDoRoteiro(cenario.tenantId, primeira.data.id)).toBe(1)
  })

  it('clique duplo CONCORRENTE (Promise.allSettled): uma linha no banco, respostas idênticas', async () => {
    const cenario = registrar(await seedCenarioRoteiro())
    entrarComo(cenario)

    const resultados = await Promise.allSettled([gerarRoteiro(cenario.dealId), gerarRoteiro(cenario.dealId)])
    const valores = resultados.map((r) => {
      if (r.status === 'rejected') {
        throw new Error(`gerarRoteiro rejeitou: ${textoCompletoDoErro(r.reason)}`)
      }
      return r.value
    })

    // Ambas as chamadas convergem para o MESMO roteiro (a que perdeu a corrida grava
    // via onConflictDoNothing e reseleciona o estado persistido).
    for (const v of valores) {
      expect(v.ok, !v.ok ? v.mensagem : '').toBe(true)
    }
    if (!valores[0]!.ok || !valores[1]!.ok) return
    expect(valores[1]!.data.id).toBe(valores[0]!.data.id)
    expect(valores[1]!.data.publicToken).toBe(valores[0]!.data.publicToken)

    // A verdade é o COUNT no banco, não o que cada chamada devolveu.
    expect(await contarRoteirosDoDeal(cenario.tenantId, cenario.dealId)).toBe(1)
  })

  it('audit registra itinerary.created com metadata sem PII', async () => {
    const cenario = registrar(await seedCenarioRoteiro())
    entrarComo(cenario)

    const gerado = await gerarRoteiro(cenario.dealId)
    expect(gerado.ok).toBe(true)
    if (!gerado.ok) return

    const [audit] = await withTenant(cenario.tenantId, async (tx) =>
      tx
        .select({
          action: auditLog.action,
          entity: auditLog.entity,
          entityId: auditLog.entityId,
          metadata: auditLog.metadata,
          actorUserId: auditLog.actorUserId,
        })
        .from(auditLog)
        .where(and(eq(auditLog.entity, 'itinerary'), eq(auditLog.entityId, gerado.data.id))),
    )

    expect(audit).toBeDefined()
    expect(audit!.action).toBe('itinerary.created')
    expect(audit!.entity).toBe('itinerary')
    expect(audit!.actorUserId).toBe(cenario.userId)
    expect(audit!.metadata).toEqual({ dealId: cenario.dealId, proposalId: cenario.propostaId })
  })

  it('fotografia, não vista: editar os blocos DEPOIS não muda o roteiro — e não há regeneração', async () => {
    const cenario = registrar(await seedCenarioRoteiro())
    entrarComo(cenario)

    const gerado = await gerarRoteiro(cenario.dealId)
    expect(gerado.ok).toBe(true)
    if (!gerado.ok) return
    const token = gerado.data.publicToken

    const payloadAntes = await obterRoteiroPublico(token)
    expect(payloadAntes.ok).toBe(true)
    if (!payloadAntes.ok || !payloadAntes.data) throw new Error('roteiro público não veio')
    const antes = JSON.stringify(payloadAntes.data)

    // Edita o que já existia, acrescenta bloco novo e apaga o da opção não aceita —
    // nenhum dos três pode aparecer no payload público.
    await withTenant(cenario.tenantId, async (tx) => {
      await tx
        .update(proposalBlocks)
        .set({ body: 'CORPO EDITADO DEPOIS DO ROTEIRO' })
        .where(eq(proposalBlocks.id, cenario.blocos.compartilhado1))
      await tx.insert(proposalBlocks).values({
        tenantId: cenario.tenantId,
        proposalId: cenario.propostaId,
        optionId: null,
        kind: 'text',
        position: 5,
        title: 'Bloco novo pós-roteiro',
        body: 'Não pode aparecer no roteiro já entregue.',
      })
      await tx.delete(proposalBlocks).where(eq(proposalBlocks.id, cenario.blocos.daOutra))
    })

    // Chamar gerarRoteiro de novo NÃO regenera: mesmo id, mesmo token.
    const segunda = await gerarRoteiro(cenario.dealId)
    expect(segunda.ok).toBe(true)
    if (!segunda.ok) return
    expect(segunda.data.id).toBe(gerado.data.id)
    expect(segunda.data.publicToken).toBe(token)

    const payloadDepois = await obterRoteiroPublico(token)
    expect(payloadDepois.ok).toBe(true)
    if (!payloadDepois.ok || !payloadDepois.data) throw new Error('roteiro público não veio')
    const depois = JSON.stringify(payloadDepois.data)

    expect(depois).toBe(antes)
    expect(depois).not.toContain('CORPO EDITADO DEPOIS DO ROTEIRO')
    expect(depois).not.toContain('Bloco novo pós-roteiro')
  })

  it('RESTRICT: apagar negócio ou proposta que tem roteiro falha no BANCO (documento entregue)', async () => {
    const cenario = registrar(await seedCenarioRoteiro())
    entrarComo(cenario)

    const gerado = await gerarRoteiro(cenario.dealId)
    expect(gerado.ok).toBe(true)
    if (!gerado.ok) return

    const { deals, proposals } = await import('@/db/schema')

    const apagarDeal = () =>
      withTenant(cenario.tenantId, (tx) => tx.delete(deals).where(eq(deals.id, cenario.dealId)))
    let falhou = false
    try {
      await apagarDeal()
    } catch (erro) {
      falhou = true
      expect(textoCompletoDoErro(erro)).toMatch(/itineraries_deal_id|foreign key|violates/i)
    }
    expect(falhou, 'esperava que o banco recusasse apagar negócio com roteiro (RESTRICT)').toBe(true)

    const apagarProposta = () =>
      withTenant(cenario.tenantId, (tx) =>
        tx.delete(proposals).where(eq(proposals.id, cenario.propostaId)),
      )
    falhou = false
    try {
      await apagarProposta()
    } catch (erro) {
      falhou = true
      expect(textoCompletoDoErro(erro)).toMatch(/itineraries_proposal_id|foreign key|violates/i)
    }
    expect(falhou, 'esperava que o banco recusasse apagar proposta com roteiro (RESTRICT)').toBe(true)

    // Nada sumiu.
    expect(await contarRoteirosDoDeal(cenario.tenantId, cenario.dealId)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Leitura pública — portão de token (o vazamento está no arquivo de security)
// ---------------------------------------------------------------------------

describe('obterRoteiroPublico — portão de token', () => {
  it('token inexistente devolve null (não erro) — a imprevisibilidade é quem decide', async () => {
    const resultado = await obterRoteiroPublico('token-que-nunca-existiu-xyz')
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(resultado.data).toBeNull()
  })

  it('lixo de token (curto, com caractere inválido) nem chega ao banco: devolve null', async () => {
    for (const lixo of ['', 'abc', '###', 'com espaço', 'a'.repeat(81) + 'b']) {
      const resultado = await obterRoteiroPublico(lixo)
      expect(resultado.ok, `lixo "${lixo}" não pode estourar erro`).toBe(true)
      if (!resultado.ok) return
      expect(resultado.data, `lixo "${lixo}" não pode renderizar roteiro`).toBeNull()
    }
  })

  it('o mesmo token é estável: duas leituras devolvem exatamente o mesmo payload', async () => {
    const cenario = registrar(await seedCenarioRoteiro())
    entrarComo(cenario)

    const gerado = await gerarRoteiro(cenario.dealId)
    expect(gerado.ok).toBe(true)
    if (!gerado.ok) return

    const a = await obterRoteiroPublico(gerado.data.publicToken)
    const b = await obterRoteiroPublico(gerado.data.publicToken)
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok || !a.data || !b.data) return
    expect(JSON.stringify(b.data)).toBe(JSON.stringify(a.data))
  })
})

// ---------------------------------------------------------------------------
// Isolamento no nível da action + listagem
// ---------------------------------------------------------------------------

describe('listarRoteiros — escopo de tenant e ordem', () => {
  it('devolve só os roteiros do próprio tenant, mais recente primeiro', async () => {
    const cenarioA = registrar(await seedCenarioRoteiro())
    entrarComo(cenarioA)

    const primeiro = await gerarRoteiro(cenarioA.dealId)
    expect(primeiro.ok).toBe(true)
    if (!primeiro.ok) return

    // Segundo deal no MESMO tenant — para a ordem significar algo.
    const cenarioA2 = registrar(
      await seedCenarioRoteiro({ reuso: { tenantId: cenarioA.tenantId, userId: cenarioA.userId } }),
    )
    const segundo = await gerarRoteiro(cenarioA2.dealId)
    expect(segundo.ok).toBe(true)
    if (!segundo.ok) return

    // Tenant B com seu próprio roteiro.
    const cenarioB = registrar(await seedCenarioRoteiro())
    entrarComo(cenarioB)
    const roteiroB = await gerarRoteiro(cenarioB.dealId)
    expect(roteiroB.ok).toBe(true)
    if (!roteiroB.ok) return

    entrarComo(cenarioA)
    const listaA = await listarRoteiros()
    expect(listaA.ok).toBe(true)
    if (!listaA.ok) return
    const idsA = listaA.data.map((r) => r.id)
    expect(idsA).toContain(primeiro.data.id)
    expect(idsA).toContain(segundo.data.id)
    expect(idsA).not.toContain(roteiroB.data!.id)
    // createdAt chega como Date (não string crua do driver) e a ordem é descendente.
    const tempos = listaA.data.map((r) => (r.createdAt instanceof Date ? r.createdAt.getTime() : NaN))
    for (const t of tempos) expect(Number.isNaN(t), 'createdAt deve ser Date, não string/NaN').toBe(false)
    expect([...tempos].sort((x, y) => y - x)).toEqual(tempos)

    entrarComo(cenarioB)
    const listaB = await listarRoteiros()
    expect(listaB.ok).toBe(true)
    if (!listaB.ok) return
    expect(listaB.data.map((r) => r.id)).toEqual([roteiroB.data.id])
  })
})

// Guarda de tipo: `NewItinerary` é a forma que a action grava — o import explícito
// impede o arquivo de apodrecer se o schema do roteiro mudar de forma incompatível.
export type __FormaDeGravacao = NewItinerary
