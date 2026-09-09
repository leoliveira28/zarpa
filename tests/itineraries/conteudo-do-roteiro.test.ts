/**
 * Editor de roteiro — `atualizarConteudoDoRoteiro` e as leituras apontadas
 * (`listarRoteiroDoNegocio`, `obterConteudoDoRoteiro`, `obterPropostaAceitaDoNegocio`),
 * `src/server/itineraries.ts`. Arquivo NOVO de propósito: `tests/itineraries/roteiro.test.ts`
 * (do S14) cobre a FOTOGRAFIA; este cobre a reescrita de SÓ CONTEÚDO do que já foi
 * fotografado.
 *
 * Os quatro pontos que o contrato promete e nenhum outro arquivo prova:
 *  1. Só conteúdo muda — `publicToken`, `proposalId`, título, cliente, datas e marca
 *     ficam EXATAMENTE como eram (o link que já foi pelo WhatsApp continua válido), e o
 *     snapshot gravado é o que a action recebeu.
 *  2. Portaria §4 — chave de `content` que cheire a preço/custo/comissão/documento é
 *     recusada antes do UPDATE, com `campo` apontando o bloco exato; o snapshot fica
 *     intocado e nenhum audit nasce.
 *  3. Idempotência barata — o MESMO conteúdo é no-op: sem UPDATE (updatedAt parado) e sem
 *     audit novo (o autosave martela, a históriografia não).
 *  4. ISOLAMENTO — dealId de outro tenant é "não existe" para escrever e `null` para ler;
 *     o corte é do RLS via `withTenant`.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { auditLog, itineraries } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'
import {
  apagarCenarioRoteiro,
  seedCenarioRoteiro,
  type CenarioRoteiro,
} from '../helpers/roteiro'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: '',
  email: 'qa-conteudo-roteiro@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}));

const {
  atualizarConteudoDoRoteiro,
  listarRoteiroDoNegocio,
  obterConteudoDoRoteiro,
  obterPropostaAceitaDoNegocio,
  gerarRoteiro,
} = await import('@/server/itineraries')
// Type-only: apagado na compilação, não toca no módulo 'use server' em runtime.
type BlocoDoRoteiro = import('@/server/itineraries').BlocoDoRoteiro

function entrarComo(cenario: Pick<CenarioRoteiro, 'tenantId' | 'userId'>): void {
  authCtx.tenantId = cenario.tenantId
  authCtx.userId = cenario.userId
}

async function snapshotNoBanco(tenantId: string, dealId: string) {
  return withTenant(tenantId, async (tx) => {
    const [linha] = await tx
      .select({ blocksSnapshot: itineraries.blocksSnapshot, updatedAt: itineraries.updatedAt })
      .from(itineraries)
      .where(eq(itineraries.dealId, dealId))
    return linha!
  })
}

async function auditsDoRoteiro(tenantId: string, roteiroId: string) {
  return withTenant(tenantId, async (tx) => {
    const linhas = await tx
      .select({ action: auditLog.action, metadata: auditLog.metadata })
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'itinerary'), eq(auditLog.entityId, roteiroId)))
    return linhas
  })
}

/** Gera o roteiro do cenário (caminho real de produto) e devolve o resumo. */
async function roteiroGerado(cenario: CenarioRoteiro) {
  entrarComo(cenario)
  const r = await gerarRoteiro(cenario.dealId)
  if (!r.ok) throw new Error(`fixture: gerarRoteiro falhou: ${r.mensagem}`)
  return r.data
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

describe('atualizarConteudoDoRoteiro — escrita de SÓ conteúdo', () => {
  it('grava o conteúdo novo e NÃO muda link, proposta, título, cliente, datas nem marca', async () => {
    const cenario = registrar(await seedCenarioRoteiro())
    const gerado = await roteiroGerado(cenario)

    const atuais = await obterConteudoDoRoteiro(cenario.dealId)
    expect(atuais.ok).toBe(true)
    if (!atuais.ok || !atuais.data) throw new Error('conteúdo não veio')

    // Edita o que existe, dá semântica nova pelo `content` e acrescenta o bloco que a
    // agente tinha esquecido — o caso real do pedido (contato de emergência depois do
    // link já no WhatsApp). Telefone no CORPO é prosa de conteúdo, não chave proibida.
    const novos: BlocoDoRoteiro[] = atuais.data.map((b) => ({
      ...b,
      ...(b.kind === 'text' ? { body: 'Bem-vindo — leia antes de embarcar.' } : {}),
    }))
    novos[0]!.content = { ...novos[0]!.content, portao: '12', dia: '2026-10-10' }
    novos.push({
      kind: 'text',
      position: 4,
      title: 'Contato de emergência',
      body: 'Guia local: +55 11 91234-5678. Emergência: 112.',
      images: [],
      content: {},
    })

    const r = await atualizarConteudoDoRoteiro(cenario.dealId, novos)
    expect(r.ok, !r.ok ? r.mensagem : '').toBe(true)
    if (!r.ok) return

    // O que NUNCA muda: o link e a fotografia comercial.
    expect(r.data.id).toBe(gerado.id)
    expect(r.data.publicToken).toBe(gerado.publicToken)
    expect(r.data.proposalId).toBe(gerado.proposalId)
    expect(r.data.title).toBe(gerado.title)
    expect(r.data.clientName).toBe(gerado.clientName)
    expect(r.data.currency).toBe(gerado.currency)
    expect(r.data.departureOn).toBe(gerado.departureOn)
    expect(r.data.returnOn).toBe(gerado.returnOn)
    expect(r.data.createdAt).toEqual(gerado.createdAt)

    // O que muda: o snapshot gravado é o que a action recebeu (jsonb sem ordem de chave).
    const { blocksSnapshot } = await snapshotNoBanco(cenario.tenantId, cenario.dealId)
    expect(blocksSnapshot).toEqual(novos)

    // A leitura do editor devolve o conteúdo novo na mesma forma.
    const relido = await obterConteudoDoRoteiro(cenario.dealId)
    expect(relido.ok).toBe(true)
    if (!relido.ok || !relido.data) return
    expect(relido.data).toHaveLength(4)
    expect(relido.data.at(-1)!.title).toBe('Contato de emergência')

    // Auditoria nova: itinerary.updated com dealId no metadata.
    const audits = await auditsDoRoteiro(cenario.tenantId, gerado.id)
    expect(audits.map((a) => a.action).sort()).toEqual(['itinerary.created', 'itinerary.updated'])
    const updated = audits.find((a) => a.action === 'itinerary.updated')
    expect(updated!.metadata).toEqual({ dealId: cenario.dealId })
  })

  it('o MESMO conteúdo é no-op: updatedAt parado e nenhum audit novo (autosave pode martelar)', async () => {
    const cenario = registrar(await seedCenarioRoteiro())
    const gerado = await roteiroGerado(cenario)

    const atuais = await obterConteudoDoRoteiro(cenario.dealId)
    if (!atuais.ok || !atuais.data) throw new Error('conteúdo não veio')

    // Primeira escrita: conteúdo NOVO (a lista atual tem um bloco a mais).
    const comBloco: BlocoDoRoteiro[] = [
      ...atuais.data,
      { kind: 'text', position: 4, title: 'Documentos', body: 'Passaporte válido.', images: [], content: {} },
    ]
    const comContent = comBloco.map((b, i) =>
      i === 0 ? { ...b, content: { voo: b.content.voo, portao: '12', bagagem: '23kg' } } : b,
    )
    const primeira = await atualizarConteudoDoRoteiro(cenario.dealId, comContent)
    expect(primeira.ok, !primeira.ok ? primeira.mensagem : '').toBe(true)
    const antes = await snapshotNoBanco(cenario.tenantId, cenario.dealId)

    // Mesma lista, chaves do `content` em OUTRA ordem — o jsonb reordena chaves, então
    // "mesmo conteúdo" tem que ser provado sem depender de ordem.
    const remontado = comContent.map((b, i) =>
      i === 0 ? { ...b, content: { bagagem: '23kg', portao: '12', voo: b.content.voo } } : b,
    )
    const segunda = await atualizarConteudoDoRoteiro(cenario.dealId, remontado)
    expect(segunda.ok, !segunda.ok ? segunda.mensagem : '').toBe(true)
    if (!segunda.ok) return
    expect(segunda.data.id).toBe(gerado.id)

    const depois = await snapshotNoBanco(cenario.tenantId, cenario.dealId)
    expect(depois.updatedAt).toEqual(antes.updatedAt)

    const audits = await auditsDoRoteiro(cenario.tenantId, gerado.id)
    expect(audits.map((a) => a.action).sort()).toEqual(['itinerary.created', 'itinerary.updated'])
  })

  it('chave de `content` com cheiro de dinheiro/documento é recusada ANTES do banco, apontando o bloco', async () => {
    const cenario = registrar(await seedCenarioRoteiro())
    const gerado = await roteiroGerado(cenario)

    const atuais = await obterConteudoDoRoteiro(cenario.dealId)
    if (!atuais.ok || !atuais.data) throw new Error('conteúdo não veio')
    const antes = await snapshotNoBanco(cenario.tenantId, cenario.dealId)

    const casos: { content: Record<string, unknown>; campo: string }[] = [
      { content: { preco: 3500 }, campo: 'blocos[0].content.preco' },
      { content: { opcoes: [{ custoTransfer: 12000 }] }, campo: 'blocos[0].content.opcoes[0].custoTransfer' },
      { content: { emergencia: { whatsapp: '+5511999999999' } }, campo: 'blocos[0].content.emergencia.whatsapp' },
    ]

    for (const caso of casos) {
      const blocos = atuais.data.map((b, i) => (i === 0 ? { ...b, content: caso.content } : b))
      const r = await atualizarConteudoDoRoteiro(cenario.dealId, blocos)
      expect(r.ok, 'esperava recusa').toBe(false)
      if (r.ok) return
      expect(r.code).toBe('DADOS_INVALIDOS')
      expect(r.campo).toBe(caso.campo)
      expect(r.correcao).toBe('Remover esse campo do bloco e salvar de novo')
    }

    // Nada foi gravado — nem parcialmente: a portaria recusa antes do UPDATE e a
    // transação volta atrás inteira.
    const depois = await snapshotNoBanco(cenario.tenantId, cenario.dealId)
    expect(depois.blocksSnapshot).toEqual(antes.blocksSnapshot)
    expect((await auditsDoRoteiro(cenario.tenantId, gerado.id)).map((a) => a.action)).toEqual([
      'itinerary.created',
    ])
  })

  it('bloco com `kind` fora do vocabulário e lista acima do teto são recusados com campo certo', async () => {
    const cenario = registrar(await seedCenarioRoteiro())
    await roteiroGerado(cenario)

    const atuais = await obterConteudoDoRoteiro(cenario.dealId)
    if (!atuais.ok || !atuais.data) throw new Error('conteúdo não veio')

    const kindEstranho = await atualizarConteudoDoRoteiro(cenario.dealId, [
      ...atuais.data,
      {
        kind: 'dica-local',
        position: 5,
        title: 'Dica local',
        body: null,
        images: [],
        content: {},
      } as BlocoDoRoteiro,
    ])
    expect(kindEstranho.ok).toBe(false)
    if (!kindEstranho.ok) {
      expect(kindEstranho.code).toBe('DADOS_INVALIDOS')
      expect(kindEstranho.campo).toBe('blocos.3.kind')
    }

    const centena = Array.from({ length: 101 }, (_, i) => ({
      kind: 'text',
      position: i,
      title: `Bloco ${i}`,
      body: null,
      images: [],
      content: {},
    })) as BlocoDoRoteiro[]
    const teto = await atualizarConteudoDoRoteiro(cenario.dealId, centena)
    expect(teto.ok).toBe(false)
    if (!teto.ok) expect(teto.mensagem).toMatch(/100 blocos/)
  })

  it('deal de OUTRO tenant: escrever é NAO_ENCONTRADO e ler é null — o snapshot alheio não mexe', async () => {
    const cenarioA = registrar(await seedCenarioRoteiro())
    const cenarioB = registrar(await seedCenarioRoteiro())
    const gerado = await roteiroGerado(cenarioA)

    const atuais = await obterConteudoDoRoteiro(cenarioA.dealId)
    if (!atuais.ok || !atuais.data) throw new Error('conteúdo não veio')
    const antes = await snapshotNoBanco(cenarioA.tenantId, cenarioA.dealId)

    // B tenta escrever no roteiro de A com o uuid EXATO na mão.
    entrarComo(cenarioB)
    const escrita = await atualizarConteudoDoRoteiro(cenarioA.dealId, atuais.data)
    expect(escrita.ok).toBe(false)
    if (!escrita.ok) {
      expect(escrita.code).toBe('NAO_ENCONTRADO')
      expect(escrita.mensagem).toBe('Este negócio ainda não tem roteiro gerado.')
    }

    // B lendo: null com ok — nem aparece que existia (mesma resposta de id inexistente).
    const leitura = await listarRoteiroDoNegocio(cenarioA.dealId)
    expect(leitura.ok).toBe(true)
    if (leitura.ok) expect(leitura.data).toBeNull()

    // A segue intocado: mesmo snapshot, nenhum audit novo.
    entrarComo(cenarioA)
    const depois = await snapshotNoBanco(cenarioA.tenantId, cenarioA.dealId)
    expect(depois.blocksSnapshot).toEqual(antes.blocksSnapshot)
    expect((await auditsDoRoteiro(cenarioA.tenantId, gerado.id)).map((a) => a.action)).toEqual([
      'itinerary.created',
    ])
  })
})

describe('leituras apontadas do negócio', () => {
  it('listarRoteiroDoNegocio devolve o roteiro do negócio; dealId malformado é DADOS_INVALIDOS', async () => {
    const cenario = registrar(await seedCenarioRoteiro())
    const gerado = await roteiroGerado(cenario)

    entrarComo(cenario)
    const r = await listarRoteiroDoNegocio(cenario.dealId)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data?.id).toBe(gerado.id)
    expect(r.data?.publicToken).toBe(gerado.publicToken)

    // Negócio que não existe (uuid válido qualquer): null com ok — é o estado "antes de
    // gerar", não erro.
    const vazio = await listarRoteiroDoNegocio(randomUUID())
    expect(vazio.ok).toBe(true)
    if (vazio.ok) expect(vazio.data).toBeNull()

    const malformado = await listarRoteiroDoNegocio('nao-e-um-uuid')
    expect(malformado.ok).toBe(false)
    if (!malformado.ok) {
      expect(malformado.code).toBe('DADOS_INVALIDOS')
      expect(malformado.campo).toBe('dealId')
    }
  })

  it('obterPropostaAceitaDoNegocio aponta a MESMA proposta que o gerarRoteiro fotografaria', async () => {
    const cenario = registrar(await seedCenarioRoteiro())
    entrarComo(cenario)

    // Antes de gerar: aponta a aceita pelo id e título.
    const antes = await obterPropostaAceitaDoNegocio(cenario.dealId)
    expect(antes.ok).toBe(true)
    if (!antes.ok) return
    expect(antes.data).toEqual({ proposalId: cenario.propostaId, title: cenario.propostaTitle })

    // E a promessa é cumprida: gerar fotografa exatamente a apontada.
    const gerado = await gerarRoteiro(cenario.dealId)
    expect(gerado.ok).toBe(true)
    if (!gerado.ok) return
    expect(gerado.data.proposalId).toBe(cenario.propostaId)

    // Sem proposta aceita: null (o mesmo caso que a recusa do gerar aponta o aceite).
    const semAceite = registrar(await seedCenarioRoteiro({ propostaAceita: false }))
    entrarComo(semAceite)
    const vazio = await obterPropostaAceitaDoNegocio(semAceite.dealId)
    expect(vazio.ok).toBe(true)
    if (vazio.ok) expect(vazio.data).toBeNull()
  })
})
