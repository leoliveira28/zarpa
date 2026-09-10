/**
 * Fase 4a — PJ no contato e centro de custo (`docs/FASE4_PJ.md`, 0022).
 *
 * Mesmo padrão de `tests/deals/clientes.test.ts`: funções REAIS contra o Postgres de
 * teste, só `requireAuthContext` mockado. Cobertura da CAMADA DE SERVIÇO:
 *
 *  1. `cnpjValido` — dígitos verificadores, formato pontuado, rejeição do literal.
 *  2. PJ no contato: criar com CNPJ válido grava `personType = 'juridica'` e deduplica
 *     pelo MESMO índice cego (duplicado → CONFLITO); CNPJ inválido e CPF em empresa
 *     recusam com DADOS_INVALIDOS; busca da lista acha por CNPJ inteiro.
 *  3. Centro de custo: criar, duplicado ativo → CONFLITO, arquivar sai da lista,
 *     reabrir volta; rótulo único é entre ATIVOS (arquivado não bloqueia).
 *  4. Atribuição no deal: `criarNegocio` e `atualizarNegocio` aceitam `costCenterId`,
 *     o detalhe devolve o par (id, rótulo); centro de OUTRO tenant recusa; `null` limpa.
 *
 * A fotografia na venda (`sales.cost_center_id` na conversão) não tem teste dedicado
 * aqui — o caminho da conversão já é coberto pela suíte de `tests/sales`, que passou
 * com a coluna nova no INSERT.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { contacts, costCenters, tenants, user } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'
import { cnpjValido, formatarCnpj } from '@/server/normalize'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: 'qa-pj-user',
  email: 'qa-pj@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { criarContato, listarContatos } = await import('@/server/contacts')
const {
  criarCentroDeCusto,
  listarCentrosDeCusto,
  arquivarCentroDeCusto,
  reabrirCentroDeCusto,
} = await import('@/server/costCenters')
const { criarNegocio, obterNegocio, atualizarNegocio } = await import('@/server/deals')

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
  const seedTag = `qa-pj-${prefix}-${tenantId.slice(0, 8)}`
  const userId = `qa-pj-${prefix}-${randomUUID()}`

  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `Agência QA PJ ${seedTag}`, slug: seedTag })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA PJ Bot',
      email: `${userId}@exemplo-zarpa.com.br`,
    })
  })

  return { tenantId, userId }
}

afterAll(async () => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// 1. CNPJ — a validação pura
// ---------------------------------------------------------------------------

describe('cnpjValido', () => {
  it('aceita um CNPJ válido, com ou sem pontuação', () => {
    expect(cnpjValido('04252011000110')).toBe(true)
    expect(cnpjValido('04.252.011/0001-10')).toBe(true)
  })

  it('recusa dígito verificador errado e tamanho errado', () => {
    expect(cnpjValido('04252011000111')).toBe(false)
    expect(cnpjValido('0425201100011')).toBe(false)
    expect(cnpjValido('')).toBe(false)
  })

  it('recusa literal (todos os dígitos iguais passa no módulo 11)', () => {
    expect(cnpjValido('11111111111111')).toBe(false)
  })

  it('formatarCnpj pontua os 14 dígitos e devolve a entrada intacta quando não dá', () => {
    expect(formatarCnpj('04252011000110')).toBe('04.252.011/0001-10')
    expect(formatarCnpj('123')).toBe('123')
  })
})

// ---------------------------------------------------------------------------
// 2. PJ no contato
// ---------------------------------------------------------------------------

describe('contato PJ', () => {
  it('cria empresa com CNPJ válido e deduplica pelo mesmo índice cego', async () => {
    const tenant = await seedTenant('cria')
    entrarComo(tenant)

    const criada = await criarContato({
      name: 'Alfa Turismo Ltda',
      personType: 'juridica',
      document: '04.252.011/0001-10',
    })
    expect(criada.ok).toBe(true)
    if (!criada.ok) return
    expect(criada.data.personType).toBe('juridica')
    expect(criada.data.temDocumento).toBe(true)

    // Mesmo CNPJ, formato diferente — a deduplicação é por DÍGITOS.
    const duplicada = await criarContato({
      name: 'Alfa Turismo (outra ficha)',
      personType: 'juridica',
      document: '04252011000110',
    })
    expect(duplicada.ok).toBe(false)
    if (duplicada.ok) return
    expect(duplicada.mensagem).toContain('CNPJ')

    // A busca da lista acha por CNPJ inteiro — índice cego compara igualdade.
    const lista = await listarContatos({ busca: '04252011000110' })
    expect(lista.ok).toBe(true)
    if (!lista.ok) return
    expect(lista.data.map((c) => c.id)).toContain(criada.data.id)
  })

  it('recusa CNPJ inválido e CPF em empresa, com o campo culpado', async () => {
    const tenant = await seedTenant('recusa')
    entrarComo(tenant)

    const invalido = await criarContato({
      name: 'Beta Comércio Ltda',
      personType: 'juridica',
      document: '04252011000111',
    })
    expect(invalido.ok).toBe(false)
    if (invalido.ok) return
    expect(invalido.mensagem).toBe('Esse CNPJ não é válido.')

    const cpfNaEmpresa = await criarContato({
      name: 'Gama Serviços Ltda',
      personType: 'juridica',
      document: '529.982.247-25',
    })
    expect(cpfNaEmpresa.ok).toBe(false)
    if (cpfNaEmpresa.ok) return
    expect(cpfNaEmpresa.mensagem).toBe('Esse CNPJ não é válido.')

    // PF continua com a régua de sempre: CNPJ em pessoa física recusa.
    const cnpjNaPessoa = await criarContato({
      name: 'Diana Prado',
      document: '04252011000110',
    })
    expect(cnpjNaPessoa.ok).toBe(false)
    if (cnpjNaPessoa.ok) return
    expect(cnpjNaPessoa.mensagem).toBe('Esse CPF não é válido.')
  })

  it('ausente = pessoa física (o contato de sempre não muda de forma)', async () => {
    const tenant = await seedTenant('default')
    entrarComo(tenant)

    const criado = await criarContato({ name: 'Eduardo Nunes' })
    expect(criado.ok).toBe(true)
    if (!criado.ok) return
    expect(criado.data.personType).toBe('fisica')

    const noBanco = await withTenant(tenant.tenantId, (tx) =>
      tx.select({ personType: contacts.personType }).from(contacts).where(eq(contacts.id, criado.data.id)),
    )
    expect(noBanco[0]?.personType).toBe('fisica')
  })
})

// ---------------------------------------------------------------------------
// 3. Centro de custo — a lista do tenant
// ---------------------------------------------------------------------------

describe('centros de custo', () => {
  it('cria, recusa duplicado ATIVO, arquiva e reabre', async () => {
    const tenant = await seedTenant('ciclo')
    entrarComo(tenant)

    const criado = await criarCentroDeCusto({ label: 'Diretoria' })
    expect(criado.ok).toBe(true)
    if (!criado.ok) return
    expect(criado.data.label).toBe('Diretoria')
    expect(criado.data.totalNegocios).toBe(0)

    // Rótulo único entre ativos — case-insensitive.
    const duplicado = await criarCentroDeCusto({ label: 'diretoria' })
    expect(duplicado.ok).toBe(false)
    if (!duplicado.ok) {
      expect(duplicado.mensagem).toContain('já tem um centro de custo')
    }

    const arquivado = await arquivarCentroDeCusto({ id: criado.data.id })
    expect(arquivado.ok).toBe(true)

    // Arquivado sai da lista — e libera o rótulo (unicidade é entre ATIVOS).
    const listaSem = await listarCentrosDeCusto()
    expect(listaSem.ok).toBe(true)
    if (listaSem.ok) {
      expect(listaSem.data.find((c) => c.id === criado.data.id)).toBeUndefined()
    }

    const recriado = await criarCentroDeCusto({ label: 'Diretoria' })
    expect(recriado.ok).toBe(true)

    const reaberto = await reabrirCentroDeCusto({ id: criado.data.id })
    // Agora HAVERIA dois ativos com o mesmo rótulo — a recusa é a verdade do banco.
    expect(reaberto.ok).toBe(false)
  })

  it('lista por posição: o segundo entra depois do primeiro', async () => {
    const tenant = await seedTenant('ordem')
    entrarComo(tenant)

    await criarCentroDeCusto({ label: 'Marketing' })
    await criarCentroDeCusto({ label: 'Operações' })

    const lista = await listarCentrosDeCusto()
    expect(lista.ok).toBe(true)
    if (!lista.ok) return
    expect(lista.data.map((c) => c.label)).toEqual(['Marketing', 'Operações'])
  })
})

// ---------------------------------------------------------------------------
// 4. Atribuição no deal
// ---------------------------------------------------------------------------

describe('centro de custo no negócio', () => {
  it('nasce atribuído, aparece no detalhe com rótulo, e null limpa', async () => {
    const tenant = await seedTenant('deal')
    entrarComo(tenant)

    const contato = await criarContato({ name: 'Hotel Horizonte Ltda', personType: 'juridica' })
    expect(contato.ok).toBe(true)
    if (!contato.ok) return

    const centro = await criarCentroDeCusto({ label: 'Eventos' })
    expect(centro.ok).toBe(true)
    if (!centro.ok) return

    const criado = await criarNegocio({
      contactId: contato.data.id,
      title: 'Convenção anual',
      departureOn: undefined,
      returnOn: undefined,
      expectedCloseOn: undefined,
      costCenterId: centro.data.id,
    })
    expect(criado.ok).toBe(true)
    if (!criado.ok) return

    const detalhe = await obterNegocio(criado.data.id)
    expect(detalhe.ok).toBe(true)
    if (!detalhe.ok) return
    expect(detalhe.data.costCenterId).toBe(centro.data.id)
    expect(detalhe.data.costCenterLabel).toBe('Eventos')

    const limpo = await atualizarNegocio(criado.data.id, { costCenterId: null })
    expect(limpo.ok).toBe(true)
    if (!limpo.ok) return
    expect(limpo.data.costCenterId).toBeNull()
    expect(limpo.data.costCenterLabel).toBeNull()
  })

  it('recusa centro de OUTRO tenant e centro inexistente', async () => {
    const alheio = await seedTenant('alheio')
    const dono = await seedTenant('dono')

    entrarComo(alheio)
    const centroAlheio = await criarCentroDeCusto({ label: 'Da outra agência' })
    expect(centroAlheio.ok).toBe(true)
    if (!centroAlheio.ok) return

    entrarComo(dono)
    const contato = await criarContato({ name: 'Cliente da casa' })
    expect(contato.ok).toBe(true)
    if (!contato.ok) return

    // No nascimento...
    const nasceErrado = await criarNegocio({
      contactId: contato.data.id,
      title: 'Viagem interditada',
      departureOn: undefined,
      returnOn: undefined,
      expectedCloseOn: undefined,
      costCenterId: centroAlheio.data.id,
    })
    expect(nasceErrado.ok).toBe(false)

    // ...e no patch.
    const negocio = await criarNegocio({
      contactId: contato.data.id,
      title: 'Viagem da casa',
      departureOn: undefined,
      returnOn: undefined,
      expectedCloseOn: undefined,
    })
    expect(negocio.ok).toBe(true)
    if (!negocio.ok) return
    const patchErrado = await atualizarNegocio(negocio.data.id, {
      costCenterId: centroAlheio.data.id,
    })
    expect(patchErrado.ok).toBe(false)
    if (patchErrado.ok) return
    expect(patchErrado.mensagem).toContain('centro de custo')

    const patchFantasma = await atualizarNegocio(negocio.data.id, { costCenterId: randomUUID() })
    expect(patchFantasma.ok).toBe(false)
  })
})
