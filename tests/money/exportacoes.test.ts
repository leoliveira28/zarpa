/**
 * Exportações CSV (fase 2 do roadmap) — o essencial: passageiros com PII DECIFRADA
 * (a via da casa) e vendas com BOM/parcelas, ambos escapando do tenant certo.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  contacts,
  dealContacts,
  deals,
  proposals,
  receivables,
  sales,
  tenants,
  travelers,
  user,
} from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: '',
  email: 'qa-export@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { csvPassageirosDoNegocio, csvVendasDoPeriodo } = await import('@/server/exportacoes')

const tenantIds: string[] = []

async function apagar(tenantId: string): Promise<void> {
  try {
    await withTenant(tenantId, async (tx) => {
      await tx.delete(receivables)
      await tx.delete(sales)
      await tx.delete(travelers)
      await tx.delete(proposals)
      await tx.delete(deals)
      await tx.delete(contacts)
      await tx.delete(user)
      await tx.delete(tenants)
    })
  } catch {
    /* best-effort */
  }
}

afterAll(async () => {
  for (const tenantId of [...new Set(tenantIds)]) {
    await apagar(tenantId)
  }
})

const baseTenant = async (tag: string) => {
  const tenantId = randomUUID()
  const userId = `qa-exp-${randomUUID()}`
  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `Agência ${tag}`, slug: tag })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Export Bot',
      email: `${userId}@exemplo-zarpa.test`,
    })
  })
  tenantIds.push(tenantId)
  authCtx.tenantId = tenantId
  authCtx.userId = userId
  return tenantId
}

describe('csvPassageirosDoNegocio', () => {
  it('CSV com PII decifrada, células vazias sem documento — e nada do vizinho', async () => {
    const tenantId = await baseTenant(`qa-exp-${randomUUID().slice(0, 8)}`)

    const dealId = await withTenant(tenantId, async (tx) => {
      const [contato] = await tx
        .insert(contacts)
        .values({ tenantId, name: 'Família Reis' })
        .returning({ id: contacts.id })
      const [outro] = await tx
        .insert(contacts)
        .values({ tenantId, name: 'Outra família' })
        .returning({ id: contacts.id })
      const [deal] = await tx
        .insert(deals)
        .values({
          tenantId,
          contactId: contato!.id,
          title: 'Buenos Aires em novembro',
          destination: 'Buenos Aires',
          currency: 'BRL',
        })
        .returning({ id: deals.id })
      // Invariante da 0020: todo negócio tem a linha principal em deal_contacts —
      // é por ela que a lista do grupo (Fase 5a) varre.
      await tx.insert(dealContacts).values({ tenantId, dealId: deal!.id, contactId: contato!.id, principal: true })
      await tx.insert(travelers).values([
        {
          tenantId,
          contactId: contato!.id,
          fullName: 'Helena Reis',
          kind: 'adult',
          cpf: '529.982.247-25',
          cpfHash: `hash-${randomUUID()}`,
          cpfHashKeyId: 'v1',
          passportNumber: 'FG123456',
        },
        { tenantId, contactId: contato!.id, fullName: 'Tomás Reis', kind: 'child' },
        // Viajante do OUTRO contato — não pode vazar para o CSV deste deal.
        {
          tenantId,
          contactId: outro!.id,
          fullName: 'Terceiro Alheio',
          kind: 'adult',
          cpf: '111.444.777-35',
          cpfHash: `hash-${randomUUID()}`,
          cpfHashKeyId: 'v1',
        },
      ])
      return deal!.id
    })

    const resultado = await csvPassageirosDoNegocio(dealId)
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)
    if (!resultado.ok) return

    const { nomeArquivo, conteudo } = resultado.data
    expect(nomeArquivo).toContain('passageiros-buenos-aires')
    // BOM na frente — e depois some da comparação de linhas.
    expect(conteudo.charCodeAt(0)).toBe(0xfeff)
    const linhas = conteudo.slice(1).replace(/\r\n$/, '').split('\r\n')
    // Fase 5a: a coluna "Comprador" entrou (o grupo inteiro, titular e secundários).
    expect(linhas[0]).toBe('Nome;Tipo;CPF;Passaporte;Comprador')
    // PII decifrada — ciphertext na planilha não serve para NADA para o fornecedor.
    // (Ordem entre viajantes do mesmo milissegundo não é promessa — busca por nome.)
    const linhaDe = (nome: string) => linhas.find((l) => l.startsWith(nome))!
    expect(linhaDe('Helena Reis')).toBe('Helena Reis;Adulto;529.982.247-25;FG123456;Família Reis')
    expect(linhaDe('Tomás Reis')).toBe('Tomás Reis;Criança;;;Família Reis')
    expect(linhas).toHaveLength(3)
    expect(conteudo).not.toContain('Terceiro Alheio')
    expect(conteudo).not.toContain('111.444.777-35')
    // Começa com BOM UTF-8 (Excel BR).
    expect(conteudo.charCodeAt(0)).toBe(0xfeff)
  })
})

describe('csvVendasDoPeriodo', () => {
  it('CSV das vendas do mês corrente com parcelas "1/2 pagas" — e escopo de tenant', async () => {
    const tenantId = await baseTenant(`qa-exp-v-${randomUUID().slice(0, 8)}`)

    await withTenant(tenantId, async (tx) => {
      const [contato] = await tx
        .insert(contacts)
        .values({ tenantId, name: 'Diana Prado' })
        .returning({ id: contacts.id })
      const [deal] = await tx
        .insert(deals)
        .values({
          tenantId,
          contactId: contato!.id,
          title: 'Nova York',
          destination: 'Nova York',
          currency: 'BRL',
          stage: 'ganho',
          valueCents: 800_000,
          closedAt: new Date(),
        })
        .returning({ id: deals.id })
      const [proposta] = await tx
        .insert(proposals)
        .values({
          tenantId,
          dealId: deal!.id,
          publicToken: randomUUID(),
          title: 'Proposta — Nova York',
        })
        .returning({ id: proposals.id })
      const [venda] = await tx
        .insert(sales)
        .values({
          tenantId,
          dealId: deal!.id,
          proposalId: proposta!.id,
          valorBrutoCents: 800_000,
          custoCents: 500_000,
          comissaoPrevistaCents: 120_000,
          comissaoStatus: 'prevista',
        })
        .returning({ id: sales.id })
      await tx.insert(receivables).values([
        { tenantId, saleId: venda!.id, venceEm: '2026-09-01', valorCents: 400_000, status: 'pago', pagoEm: new Date() },
        { tenantId, saleId: venda!.id, venceEm: '2026-10-01', valorCents: 400_000, status: 'pendente' },
      ])
    })

    const resultado = await csvVendasDoPeriodo()
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)
    if (!resultado.ok) return

    const { nomeArquivo, conteudo } = resultado.data
    // Mês corrente vem do resolverPeriodo como FAIXA (primeiro → último dia).
    const agora = new Date()
    const primeiroDia = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10)
    const ultimoDia = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10)
    expect(nomeArquivo).toBe(`vendas-${primeiroDia}_a_${ultimoDia}.csv`)
    expect(conteudo.charCodeAt(0)).toBe(0xfeff)
    const linhas = conteudo.slice(1).replace(/\r\n$/, '').split('\r\n')
    expect(linhas[0]).toBe('Data;Cliente;Viagem;Valor;Comissão;Status da comissão;Parcelas;Centro de custo')
    expect(linhas[1]).toContain('Diana Prado')
    expect(linhas[1]).toContain('Nova York')
    expect(linhas[1]).toContain('8.000,00')
    expect(linhas[1]).toContain('1.200,00')
    expect(linhas[1]).toContain('1/2 pagas')
  })
})
