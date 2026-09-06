/**
 * S9 — vendas, comissão e recebíveis (`docs/handoffs/rafa-para-teo.md`, seção "S9").
 *
 * Mesma filosofia de `tests/followups/regua.test.ts`: chama as funções REAIS de
 * `src/server/sales.ts` contra um Postgres de verdade, só mockando `requireAuthContext`
 * (não existe sessão HTTP fora de uma requisição). `tenant-isolation.test.ts` já cobre,
 * por varredura de catálogo, que `sales`/`receivables` têm RLS e que SELECT/UPDATE/DELETE
 * cruzados devolvem zero linhas em SQL direto — o que ESTE arquivo cobre é a camada de
 * cima: a Server Action, o índice único sob concorrência, os dois lados do CHECK de
 * `pago_em`, o `ON DELETE RESTRICT`, e a recusa de exclusão com parcela paga.
 *
 * Pontos do handoff cobertos aqui:
 *  1. `converterPropostaEmVenda` idempotente (leitura antes de inserir) E o índice único
 *     `sales_proposal_id_key` segurando de verdade sob concorrência (dois inserts diretos
 *     simultâneos para a mesma proposta).
 *  2. Custo/comissão/taxa persistem em centavos exatamente como vieram da opção aceita.
 *  3. Parcelas: `gerarParcelasDaVenda` (soma exata, sem perder/sobrar centavo) e
 *     `marcarParcelaPaga`.
 *  4. `atualizarStatusComissao` (prevista → recebida/atrasada, sem máquina de estado
 *     travada — volta também).
 *  5. Isolamento: venda de um tenant não aparece nem é alterável pelo outro, via Server
 *     Action (não só via SQL direto).
 *  6. `receivables_pago_em_check` — as duas pontas, direto em SQL (a Server Action nunca
 *     desrespeita o CHECK sozinha, então só um UPDATE cru prova que o BANCO barra).
 *  7. `ON DELETE RESTRICT` de `sales.deal_id`/`sales.proposal_id`.
 *  8. `excluirVenda` recusa com `CONFLITO` quando existe parcela paga — não apaga nada.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  contacts,
  deals,
  proposalOptions,
  proposals,
  receivables,
  sales,
  tenants,
  user,
} from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: 'qa-sales-user',
  email: 'qa-sales@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const {
  converterPropostaEmVenda,
  obterVenda,
  atualizarVenda,
  atualizarStatusComissao,
  excluirVenda,
  gerarParcelasDaVenda,
  criarParcela,
  marcarParcelaPaga,
  listarParcelas,
} = await import('@/server/sales')

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

type PropostaAceitaFixture = {
  tenantId: string
  userId: string
  contactId: string
  dealId: string
  propostaId: string
  opcaoId: string
  priceCents: number
  costCents: number
  commissionCents: number
}

/** Troca a sessão mockada para o tenant (e o usuário DE VERDADE, gravado no seed —
 * `registrarAuditoria` tem FK real para `user`, então `authCtx.userId` precisa apontar
 * para uma linha que existe, não uma string qualquer) da fixture dada. */
function entrarComo(fixture: Pick<PropostaAceitaFixture, 'tenantId' | 'userId'>): void {
  authCtx.tenantId = fixture.tenantId
  authCtx.userId = fixture.userId
}

/** Cria tenant + contato + negócio + proposta ACEITA (com `accepted_option_id`
 * preenchido), inteiramente via `withTenant` — o mesmo caminho que uma requisição real
 * usaria. `priceCents`/`costCents`/`commissionCents` são canário: valores distintos entre
 * si para que qualquer troca de campo (ex. gravar custo no lugar de comissão) apareça na
 * asserção em vez de passar por coincidência. */
async function seedPropostaAceita(opts: {
  priceCents?: number
  costCents?: number
  commissionCents?: number
  status?: 'accepted'
} = {}): Promise<PropostaAceitaFixture> {
  const tenantId = randomUUID()
  const seedTag = `qa-sales-${tenantId.slice(0, 8)}`
  const priceCents = opts.priceCents ?? 500_000
  const costCents = opts.costCents ?? 320_000
  const commissionCents = opts.commissionCents ?? 45_000

  const userId = `qa-sales-${randomUUID()}`

  const { contactId, dealId, propostaId, opcaoId } = await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: `Agência QA Vendas ${seedTag}`,
      slug: seedTag,
    })

    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Vendas Bot',
      email: `${userId}@exemplo-zarpa.com.br`,
    })

    const [contact] = await tx
      .insert(contacts)
      .values({ tenantId, name: 'Cliente QA Vendas' })
      .returning({ id: contacts.id })

    const [deal] = await tx
      .insert(deals)
      .values({
        tenantId,
        contactId: contact!.id,
        title: 'Negócio QA vendas',
        destination: 'Cusco',
      })
      .returning({ id: deals.id })

    const [proposta] = await tx
      .insert(proposals)
      .values({
        tenantId,
        dealId: deal!.id,
        publicToken: randomUUID(),
        title: 'Proposta QA vendas',
        status: 'sent',
      })
      .returning({ id: proposals.id })

    const [opcao] = await tx
      .insert(proposalOptions)
      .values({
        tenantId,
        proposalId: proposta!.id,
        name: 'Pacote único',
        priceCents,
        costCents,
        commissionCents,
      })
      .returning({ id: proposalOptions.id })

    await tx
      .update(proposals)
      .set({ status: opts.status ?? 'accepted', acceptedOptionId: opcao!.id })
      .where(eq(proposals.id, proposta!.id))

    return { contactId: contact!.id, dealId: deal!.id, propostaId: proposta!.id, opcaoId: opcao!.id }
  })

  return { tenantId, userId, contactId, dealId, propostaId, opcaoId, priceCents, costCents, commissionCents }
}

/** O driver postgres-js/drizzle embrulha o erro real do Postgres em `.cause` — a
 * mensagem de topo é só "Failed query: ...". O detalhe da constraint (nome do índice
 * único, do CHECK, da FK) mora na causa. Achata a cadeia inteira para poder casar regex
 * contra o texto que realmente importa, em vez de contra o wrapper genérico. */
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

/** Espera que `promessa` rejeite e que a cadeia inteira de causa (não só a mensagem de
 * topo do driver) bata com `padrao`. Usa `textoCompletoDoErro` acima — `.rejects.toThrow`
 * do vitest só olha `error.message`, que no postgres-js/drizzle é o wrapper genérico
 * "Failed query: ...", nunca o texto da constraint. */
async function esperarFalhaComMensagem(promessa: Promise<unknown>, padrao: RegExp): Promise<void> {
  let falhou = false
  try {
    await promessa
  } catch (erro) {
    falhou = true
    expect(textoCompletoDoErro(erro)).toMatch(padrao)
  }
  expect(falhou, `esperava rejeição casando com ${padrao}, mas a promessa resolveu`).toBe(true)
}

async function contarVendasDaProposta(tenantId: string, propostaId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const linhas = await tx.select({ id: sales.id }).from(sales).where(eq(sales.proposalId, propostaId))
    return linhas.length
  })
}

const criados: string[] = []

afterAll(async () => {
  // `globalSetup` recria o schema do zero a cada rodada da suíte — isto é limpeza
  // cosmética, não requisito de isolamento entre arquivos.
  for (const tenantId of criados) {
    try {
      await withTenant(tenantId, async (tx) => {
        await tx.delete(receivables).where(eq(receivables.tenantId, tenantId))
        await tx.delete(sales).where(eq(sales.tenantId, tenantId))
        await tx.delete(proposalOptions).where(eq(proposalOptions.tenantId, tenantId))
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

describe('converterPropostaEmVenda — idempotência e fotografia de valores', () => {
  it('recusa converter proposta que ainda não foi aceita', async () => {
    const fixture = await seedPropostaAceita()
    criados.push(fixture.tenantId)
    // Derruba o aceite para simular proposta ainda `sent`.
    await withTenant(fixture.tenantId, (tx) =>
      tx.update(proposals).set({ status: 'sent', acceptedOptionId: null }).where(eq(proposals.id, fixture.propostaId)),
    )

    entrarComo(fixture)
    const resultado = await converterPropostaEmVenda(fixture.propostaId)
    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.code).toBe('CONFLITO')

    expect(await contarVendasDaProposta(fixture.tenantId, fixture.propostaId)).toBe(0)
  })

  it('converte proposta aceita e fotografa preço/custo/comissão em centavos exatos', async () => {
    const fixture = await seedPropostaAceita({ priceCents: 712_345, costCents: 401_000, commissionCents: 63_210 })
    criados.push(fixture.tenantId)

    entrarComo(fixture)
    const resultado = await converterPropostaEmVenda(fixture.propostaId, { fornecedor: 'CVC', taxaServicoCents: 9_900 })
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)
    if (!resultado.ok) return

    expect(resultado.data.valorBrutoCents).toBe(712_345)
    expect(resultado.data.custoCents).toBe(401_000)
    expect(resultado.data.comissaoPrevistaCents).toBe(63_210)
    expect(resultado.data.taxaServicoCents).toBe(9_900)
    expect(resultado.data.comissaoStatus).toBe('prevista')
    expect(resultado.data.fornecedor).toBe('CVC')

    // Margem do agente (bruto − custo do fornecedor) — o contrato não define um campo
    // `margem` armazenado, então a conta é feita aqui a partir dos valores persistidos.
    // Documentado em docs/status/teo.md como o que NÃO está coberto: não há regra formal
    // no schema/Server Action que declare a fórmula de margem "oficial" do produto.
    const margemBruta = resultado.data.valorBrutoCents - resultado.data.custoCents
    expect(margemBruta).toBe(311_345)

    expect(await contarVendasDaProposta(fixture.tenantId, fixture.propostaId)).toBe(1)
  })

  it('chamar duas vezes a mesma proposta NÃO cria duas vendas — devolve a existente', async () => {
    const fixture = await seedPropostaAceita()
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const primeira = await converterPropostaEmVenda(fixture.propostaId)
    expect(primeira.ok).toBe(true)
    if (!primeira.ok) return

    const segunda = await converterPropostaEmVenda(fixture.propostaId)
    expect(segunda.ok).toBe(true)
    if (!segunda.ok) return

    expect(segunda.data.id).toBe(primeira.data.id)
    expect(await contarVendasDaProposta(fixture.tenantId, fixture.propostaId)).toBe(1)
  })

  it('sales_proposal_id_key barra no BANCO duas vendas para a mesma proposta, mesmo sob concorrência', async () => {
    const fixture = await seedPropostaAceita()
    criados.push(fixture.tenantId)

    // Dois inserts diretos "simultâneos" (sem a checagem de leitura-antes-de-inserir da
    // Server Action) — é o índice único quem tem que segurar, não a convenção de código.
    const inserirDireto = () =>
      withTenant(fixture.tenantId, (tx) =>
        tx.insert(sales).values({
          tenantId: fixture.tenantId,
          dealId: fixture.dealId,
          proposalId: fixture.propostaId,
          proposalOptionId: fixture.opcaoId,
          valorBrutoCents: fixture.priceCents,
          custoCents: fixture.costCents,
          comissaoPrevistaCents: fixture.commissionCents,
          taxaServicoCents: 0,
        }),
      )

    const resultados = await Promise.allSettled([inserirDireto(), inserirDireto()])
    const sucesso = resultados.filter((r) => r.status === 'fulfilled')
    const falha = resultados.filter((r) => r.status === 'rejected')

    expect(sucesso).toHaveLength(1)
    expect(falha).toHaveLength(1)
    const erro = (falha[0] as PromiseRejectedResult).reason
    expect(textoCompletoDoErro(erro)).toMatch(/sales_proposal_id_key|duplicate key/i)

    expect(await contarVendasDaProposta(fixture.tenantId, fixture.propostaId)).toBe(1)
  })
})

describe('parcelas (receivables) — geração, pagamento e o CHECK de pago_em', () => {
  it('gerarParcelasDaVenda divide o valor bruto sem perder nem sobrar 1 centavo', async () => {
    const fixture = await seedPropostaAceita({ priceCents: 100_001 }) // não divide exato por 3
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const venda = await converterPropostaEmVenda(fixture.propostaId)
    expect(venda.ok).toBe(true)
    if (!venda.ok) return

    const parcelas = await gerarParcelasDaVenda(venda.data.id, { quantidade: 3, primeiraVencimento: '2026-01-10' })
    expect(parcelas.ok, !parcelas.ok ? parcelas.mensagem : '').toBe(true)
    if (!parcelas.ok) return

    expect(parcelas.data).toHaveLength(3)
    const soma = parcelas.data.reduce((acc, p) => acc + p.valorCents, 0)
    expect(soma).toBe(100_001)
    // Vencimentos mensais a partir da primeira data.
    expect(parcelas.data.map((p) => p.venceEm)).toEqual(['2026-01-10', '2026-02-10', '2026-03-10'])
  })

  it('recusa gerar parcelas de novo se a venda já tem parcela (não duplica parcelamento)', async () => {
    const fixture = await seedPropostaAceita()
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const venda = await converterPropostaEmVenda(fixture.propostaId)
    if (!venda.ok) throw new Error('setup falhou')

    const primeira = await gerarParcelasDaVenda(venda.data.id, { quantidade: 2, primeiraVencimento: '2026-01-01' })
    expect(primeira.ok).toBe(true)

    const segunda = await gerarParcelasDaVenda(venda.data.id, { quantidade: 2, primeiraVencimento: '2026-01-01' })
    expect(segunda.ok).toBe(false)
    if (segunda.ok) return
    expect(segunda.code).toBe('CONFLITO')
  })

  it('marcarParcelaPaga muda status e grava pagoEm', async () => {
    const fixture = await seedPropostaAceita()
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const venda = await converterPropostaEmVenda(fixture.propostaId)
    if (!venda.ok) throw new Error('setup falhou')
    const parcela = await criarParcela(venda.data.id, { venceEm: '2026-02-01', valorCents: fixture.priceCents })
    if (!parcela.ok) throw new Error('setup falhou')

    expect(parcela.data.status).toBe('pendente')
    expect(parcela.data.pagoEm).toBeNull()

    const paga = await marcarParcelaPaga(parcela.data.id)
    expect(paga.ok).toBe(true)
    if (!paga.ok) return
    expect(paga.data.status).toBe('pago')
    expect(paga.data.pagoEm).not.toBeNull()

    const lista = await listarParcelas(venda.data.id)
    expect(lista.ok).toBe(true)
    if (!lista.ok) return
    expect(lista.data.find((p) => p.id === parcela.data.id)?.status).toBe('pago')
  })

  it('receivables_pago_em_check barra as DUAS pontas em SQL direto (a action nunca desrespeita, o banco tem que barrar sozinho)', async () => {
    const fixture = await seedPropostaAceita()
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const venda = await converterPropostaEmVenda(fixture.propostaId)
    if (!venda.ok) throw new Error('setup falhou')
    const parcela = await criarParcela(venda.data.id, { venceEm: '2026-03-01', valorCents: 1000 })
    if (!parcela.ok) throw new Error('setup falhou')

    // Ponta 1: status = 'pago' sem pago_em.
    await esperarFalhaComMensagem(
      withTenant(fixture.tenantId, (tx) =>
        tx.update(receivables).set({ status: 'pago', pagoEm: null }).where(eq(receivables.id, parcela.data.id)),
      ),
      /receivables_pago_em_check/i,
    )

    // Ponta 2: status = 'pendente' com pago_em preenchido.
    await esperarFalhaComMensagem(
      withTenant(fixture.tenantId, (tx) =>
        tx
          .update(receivables)
          .set({ status: 'pendente', pagoEm: new Date() })
          .where(eq(receivables.id, parcela.data.id)),
      ),
      /receivables_pago_em_check/i,
    )
  })
})

describe('atualizarStatusComissao — conferência manual, sem máquina de estado travada', () => {
  it('prevista → recebida → atrasada → volta para prevista, tudo permitido', async () => {
    const fixture = await seedPropostaAceita()
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const venda = await converterPropostaEmVenda(fixture.propostaId)
    if (!venda.ok) throw new Error('setup falhou')

    const r1 = await atualizarStatusComissao(venda.data.id, 'recebida')
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.data.comissaoStatus).toBe('recebida')

    const r2 = await atualizarStatusComissao(venda.data.id, 'atrasada')
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.data.comissaoStatus).toBe('atrasada')

    const r3 = await atualizarStatusComissao(venda.data.id, 'prevista')
    expect(r3.ok).toBe(true)
    if (r3.ok) expect(r3.data.comissaoStatus).toBe('prevista')
  })
})

describe('ON DELETE RESTRICT — negócio/proposta já vendidos não podem sumir', () => {
  it('apagar o deal de uma venda existente falha no banco', async () => {
    const fixture = await seedPropostaAceita()
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const venda = await converterPropostaEmVenda(fixture.propostaId)
    if (!venda.ok) throw new Error('setup falhou')

    await esperarFalhaComMensagem(
      withTenant(fixture.tenantId, (tx) => tx.delete(deals).where(eq(deals.id, fixture.dealId))),
      /foreign key|violates/i,
    )
  })

  it('apagar a proposta de uma venda existente falha no banco', async () => {
    const fixture = await seedPropostaAceita()
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const venda = await converterPropostaEmVenda(fixture.propostaId)
    if (!venda.ok) throw new Error('setup falhou')

    await esperarFalhaComMensagem(
      withTenant(fixture.tenantId, (tx) => tx.delete(proposals).where(eq(proposals.id, fixture.propostaId))),
      /foreign key|violates/i,
    )
  })
})

describe('excluirVenda — recusa apagar histórico com parcela paga', () => {
  it('recusa com CONFLITO se existe parcela paga — nem a venda, nem nenhuma parcela some', async () => {
    const fixture = await seedPropostaAceita()
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const venda = await converterPropostaEmVenda(fixture.propostaId)
    if (!venda.ok) throw new Error('setup falhou')

    const paga = await criarParcela(venda.data.id, { venceEm: '2026-01-01', valorCents: 5000 })
    const aberta = await criarParcela(venda.data.id, { venceEm: '2026-02-01', valorCents: 5000 })
    if (!paga.ok || !aberta.ok) throw new Error('setup falhou')
    await marcarParcelaPaga(paga.data.id)

    const resultado = await excluirVenda(venda.data.id)
    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.code).toBe('CONFLITO')

    // Nada sumiu: venda, parcela paga e parcela em aberto continuam lá.
    const vendaAinda = await obterVenda(venda.data.id)
    expect(vendaAinda.ok).toBe(true)

    const parcelas = await listarParcelas(venda.data.id)
    expect(parcelas.ok).toBe(true)
    if (!parcelas.ok) return
    expect(parcelas.data).toHaveLength(2)
    expect(parcelas.data.find((p) => p.id === paga.data.id)?.status).toBe('pago')
    expect(parcelas.data.find((p) => p.id === aberta.data.id)?.status).toBe('pendente')
  })

  it('exclui normalmente quando não há parcela paga', async () => {
    const fixture = await seedPropostaAceita()
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const venda = await converterPropostaEmVenda(fixture.propostaId)
    if (!venda.ok) throw new Error('setup falhou')
    await criarParcela(venda.data.id, { venceEm: '2026-01-01', valorCents: 5000 })

    const resultado = await excluirVenda(venda.data.id)
    expect(resultado.ok).toBe(true)

    const depois = await obterVenda(venda.data.id)
    expect(depois.ok).toBe(false)
  })
})

describe('isolamento por tenant — venda de A não aparece nem é alterável por B', () => {
  it('obterVenda/atualizarVenda/atualizarStatusComissao/excluirVenda de B contra venda de A devolvem NAO_ENCONTRADO', async () => {
    const fixtureA = await seedPropostaAceita({ costCents: 111_100, commissionCents: 22_200 })
    const fixtureB = await seedPropostaAceita()
    criados.push(fixtureA.tenantId, fixtureB.tenantId)

    entrarComo(fixtureA)
    const vendaA = await converterPropostaEmVenda(fixtureA.propostaId)
    if (!vendaA.ok) throw new Error('setup falhou')

    // Troca de contexto para o tenant B — mesma sessão mockada, tenant diferente, exatamente
    // como um segundo agente logado enxergaria o app.
    entrarComo(fixtureB)

    const leitura = await obterVenda(vendaA.data.id)
    expect(leitura.ok).toBe(false)
    if (leitura.ok) return
    expect(leitura.code).toBe('NAO_ENCONTRADO')

    const escrita = await atualizarVenda(vendaA.data.id, { custoCents: 1 })
    expect(escrita.ok).toBe(false)
    if (!escrita.ok) expect(escrita.code).toBe('NAO_ENCONTRADO')

    const comissao = await atualizarStatusComissao(vendaA.data.id, 'recebida')
    expect(comissao.ok).toBe(false)
    if (!comissao.ok) expect(comissao.code).toBe('NAO_ENCONTRADO')

    const exclusao = await excluirVenda(vendaA.data.id)
    expect(exclusao.ok).toBe(false)
    if (!exclusao.ok) expect(exclusao.code).toBe('NAO_ENCONTRADO')

    // A venda de A continua intacta, com o canário de custo/comissão nunca alterado por B.
    entrarComo(fixtureA)
    const aindaA = await obterVenda(vendaA.data.id)
    expect(aindaA.ok).toBe(true)
    if (!aindaA.ok) return
    expect(aindaA.data.custoCents).toBe(111_100)
    expect(aindaA.data.comissaoPrevistaCents).toBe(22_200)
    expect(aindaA.data.comissaoStatus).toBe('prevista')
  })

  it('venda de A não aparece na varredura por catálogo de B (SQL direto, sem passar pela action)', async () => {
    const fixtureA = await seedPropostaAceita()
    const fixtureB = await seedPropostaAceita()
    criados.push(fixtureA.tenantId, fixtureB.tenantId)

    entrarComo(fixtureA)
    const vendaA = await converterPropostaEmVenda(fixtureA.propostaId)
    if (!vendaA.ok) throw new Error('setup falhou')

    const vistoPorB = await withTenant(fixtureB.tenantId, (tx) =>
      tx.select({ id: sales.id }).from(sales).where(eq(sales.id, vendaA.data.id)),
    )
    expect(vistoPorB).toHaveLength(0)
  })
})
