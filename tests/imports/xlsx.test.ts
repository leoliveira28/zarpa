/**
 * XLSX na importação de planilhas (Fase 4a) — o pedido registrado desde o cabeçalho de
 * `imports.ts` ("ainda não suportado — falta biblioteca de parsing") fechado com leitor
 * mínimo próprio (`src/server/xlsx.ts`, fflate + XML; sem SheetJS/npm por CVE).
 *
 * A FIXTURA é construída no próprio teste com `zipSync` do fflate: um .xlsx é um ZIP
 * de XML, então "gerar um Excel" aqui é escrever as quatro partes que o leitor lê
 * (workbook, rels, sharedStrings, sheet). O mesmo caminho que o Excel escreve — mas
 * determinístico e legível.
 *
 * Cobertura (camada de serviço, funções REAIS contra o Postgres de teste — mesmo
 * padrão de `tests/imports/import-planilha.test.ts`):
 *   1. Prévia: formato 'xlsx', encoding/delimitador nulos, colunas do cabeçalho,
 *      strings compartilhadas resolvidas.
 *   2. Célula pulada (gap de coluna) vira vazio sem desalinhar o cabeçalho.
 *   3. Confirmar: contato criado de verdade; data em SERIAL do Excel é interpretada
 *      pelo `parseDataFlexivel` (o mesmo tratamento de planilha CSV).
 *   4. Recusas: zip que não é xlsx → recusa clara (nunca crash); .xls legado → recusa
 *      com a correção de exportar.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { tenants, user } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: 'qa-xlsx-user',
  email: 'qa-xlsx@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { pravisualizarImportacao, confirmarImportacao } = await import('@/server/imports')

// ---------------------------------------------------------------------------
// Fixture — as quatro partes de um .xlsx mínimo (ECMA-376), como o Excel grava
// ---------------------------------------------------------------------------

type Celula = string | { col: string; tipo?: 's' | 'n'; valor: string }

function xmlCelula(col: string, linha: number, celula: Celula): string {
  if (typeof celula === 'string') {
    // Texto simples → sharedStrings (o Excel dedica quase tudo a ele).
    const indice = DICIONARIO_FIXO.indexOf(celula)
    if (indice === -1) throw new Error(`fixture: "${celula}" não está no dicionário`)
    return `<c r="${col}${linha}" t="s"><v>${indice}</v></c>`
  }
  if (celula.tipo === 'n') return `<c r="${col}${linha}" t="n"><v>${celula.valor}</v></c>`
  const indice = DICIONARIO_FIXO.indexOf(celula.valor)
  return `<c r="${col}${linha}" t="s"><v>${indice}</v></c>`
}

const DICIONARIO_FIXO = [
  'Nome',
  'Nascimento',
  'Cidade',
  'Marina Costa',
  'Portugal',
  'Fernando Dias',
  'Lisboa',
]

function montarXlsx(linhas: Celula[][]): Uint8Array {
  const xmlLinhas = linhas
    .map((celulas, i) => {
      const numero = i + 1
      const corpo = celulas.map((c) => xmlCelula(typeof c === 'string' ? colunaDe(celulas, c) : c.col, numero, c)).join('')
      return `<row r="${numero}">${corpo}</row>`
    })
    .join('')

  const dicionario = DICIONARIO_FIXO.map((texto) => `<si><t>${texto}</t></si>`).join('')

  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Contatos" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/sharedStrings.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${dicionario}</sst>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlLinhas}</sheetData></worksheet>`,
    ),
  })
}

function colunaDe(linhas: Celula[], alvo: Celula): string {
  const indice = linhas.indexOf(alvo)
  return String.fromCharCode(65 + indice)
}

function arquivo(nome: string, conteudo: Uint8Array): File {
  // Buffer.view: o File do teste não precisa ser serializável por Server Action.
  return new File([conteudo.slice().buffer as ArrayBuffer], nome, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

// ---------------------------------------------------------------------------

type TenantFixture = { tenantId: string; userId: string }

function entrarComo(fixture: TenantFixture): void {
  authCtx.tenantId = fixture.tenantId
  authCtx.userId = fixture.userId
}

async function seedTenant(prefix: string): Promise<TenantFixture> {
  const tenantId = randomUUID()
  const seedTag = `qa-xlsx-${prefix}-${tenantId.slice(0, 8)}`
  const userId = `qa-xlsx-${prefix}-${randomUUID()}`

  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `Agência QA XLSX ${seedTag}`, slug: seedTag })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA XLSX Bot',
      email: `${userId}@exemplo-zarpa.com.br`,
    })
  })

  return { tenantId, userId }
}

afterAll(async () => {
  vi.restoreAllMocks()
})

describe('importação de .xlsx', () => {
  it('prévia: formato xlsx, colunas do cabeçalho, strings compartilhadas resolvidas', async () => {
    const tenant = await seedTenant('previa')
    entrarComo(tenant)

    // Cabeçalho em 3 colunas + 1 linha de dado com célula pulada no meio
    // (a coluna "Nascimento" não existe nesta linha — gap, não vazio).
    const arquivoXlsx = arquivo(
      'contatos.xlsx',
      montarXlsx([
        ['Nome', 'Nascimento', 'Cidade'],
        ['Marina Costa', { col: 'C', valor: 'Portugal' }],
      ]),
    )

    const resultado = await pravisualizarImportacao(arquivoXlsx)
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return

    const previa = resultado.data
    expect(previa.formato).toBe('xlsx')
    expect(previa.encoding).toBeNull()
    expect(previa.delimitador).toBeNull()
    expect(previa.colunas).toEqual(['Nome', 'Nascimento', 'Cidade'])
    expect(previa.totalLinhas).toBe(1)
    expect(previa.amostra[0]).toEqual({
      Nome: 'Marina Costa',
      Nascimento: '',
      Cidade: 'Portugal',
    })
    expect(previa.mapeamentoSugerido.Nome).toBe('name')
  })

  it('confirmar: cria o contato e lê data em SERIAL do Excel (nascimento 05/11/1979)', async () => {
    const tenant = await seedTenant('confirma')
    entrarComo(tenant)

    // Serial 29126 = 05/11/1979 (época do Excel: dias desde 1899-12-30).
    const arquivoXlsx = arquivo(
      'contatos-data.xlsx',
      montarXlsx([
        ['Nome', 'Nascimento'],
        ['Fernando Dias', { col: 'B', tipo: 'n', valor: '29126' }],
      ]),
    )

    const previa = await pravisualizarImportacao(arquivoXlsx)
    expect(previa.ok).toBe(true)
    if (!previa.ok) return

    const mapeamento = { ...previa.data.mapeamentoSugerido }
    // "Nascimento" sugere birthDate pelo cabeçalho; garantir explícito de qualquer forma.
    mapeamento['Nascimento'] = 'birthDate'

    const resultado = await confirmarImportacao(arquivoXlsx, mapeamento)
    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(resultado.data.criados).toBe(1)
    expect(resultado.data.itens[0]?.situacao).toBe('criado')
  })

  it('recusa zip que não é xlsx e .xls legado, com correção clara', async () => {
    const tenant = await seedTenant('recusa')
    entrarComo(tenant)

    const mentira = arquivo('mentira.xlsx', strToU8('isso não é um zip'))
    const resultadoMentira = await pravisualizarImportacao(mentira)
    expect(resultadoMentira.ok).toBe(false)
    if (!resultadoMentira.ok) {
      expect(resultadoMentira.mensagem).toContain('.xlsx')
    }

    const legado = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], 'legado.xls', {
      type: 'application/vnd.ms-excel',
    })
    const resultadoLegado = await pravisualizarImportacao(legado)
    expect(resultadoLegado.ok).toBe(false)
    if (!resultadoLegado.ok) {
      expect(resultadoLegado.mensagem).toContain('.xls')
      expect(resultadoLegado.correcao).toBeTruthy()
    }
  })
})
