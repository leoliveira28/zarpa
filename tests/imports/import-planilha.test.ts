/**
 * Critério de aceite da S3: "importar uma planilha real de 200 linhas, com colunas fora
 * de ordem, sem perder registro nem duplicar."
 *
 * Este teste NÃO reimplementa a lógica de importação — chama `pravisualizarImportacao` e
 * `confirmarImportacao` de `src/server/imports.ts` de verdade, contra um Postgres de
 * verdade (a mesma filosofia de `tests/security/*`: mock de banco testa a crença sobre o
 * banco, não o banco). A única coisa mockada é a resolução de sessão
 * (`@/lib/auth/session`), porque essas Server Actions leem `tenantId`/`userId` de
 * `next/headers` + Better Auth, e não existe requisição HTTP de verdade num teste de
 * vitest. O que fica sob teste — parsing de CSV, normalização, dedupe, escrita — é 100%
 * código real.
 *
 * Fixture: 200 pessoas, CPF válido e ÚNICO cada (checado pelo `cpfValido` de verdade, não
 * por suposição), cabeçalho da planilha em ordem que ninguém escreveria de propósito
 * (telefone antes do nome, CPF antes de tudo) — exatamente o "fora de ordem" do critério.
 * Uma linha carrega um campo de observação com `;` DENTRO de aspas, porque é o delimitador
 * do arquivo: se o parser de CSV cortar errado, essa linha vira duas colunas a menos.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { connect, withTenant, type Sql } from '../helpers/db'

// vi.mock é hoisted para o topo do arquivo — antes até dos `import` abaixo. `authCtx` só
// pode ser lido por referência (não por valor) dentro da fábrica do mock, e só pode
// existir nesse ponto do arquivo via `vi.hoisted`. É o padrão documentado do vitest para
// "preciso popular o mock DEPOIS, com um valor que só existe em tempo de execução"
// (aqui, o tenant/usuário que o `beforeAll` ainda vai criar).
const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: '',
  email: 'qa-import@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const { confirmarImportacao, pravisualizarImportacao, obterRelatorioDeImportacao } = await import(
  '@/server/imports'
)
const { cpfValido } = await import('@/server/normalize')

// ---------------------------------------------------------------------------
// Fixture: 200 pessoas, CPF válido e único, cabeçalho fora de ordem
// ---------------------------------------------------------------------------

const TOTAL = 200

/** Dígitos verificadores por módulo 11 — o MESMO algoritmo de `src/server/normalize.ts`
 * (documentado ali, regra do CLAUDE.md nº 3 não entra aqui: isto só GERA fixture, quem
 * VALIDA é o `cpfValido` importado de verdade, conferido abaixo antes de qualquer coisa). */
function digitoVerificador(digitos: number[]): number {
  let soma = 0
  for (let i = 0; i < digitos.length; i++) soma += digitos[i]! * (digitos.length + 1 - i)
  const resto = (soma * 10) % 11
  return resto === 10 || resto === 11 ? 0 : resto
}

function gerarCpf(indice: number): string {
  const base = String(100000000 + indice * 7 + 13)
    .padStart(9, '0')
    .slice(-9)
    .split('')
    .map(Number)
  const d1 = digitoVerificador(base)
  const d2 = digitoVerificador([...base, d1])
  const todos = [...base, d1, d2]
  return `${todos.slice(0, 3).join('')}.${todos.slice(3, 6).join('')}.${todos.slice(6, 9).join('')}-${todos.slice(9).join('')}`
}

const ORIGENS = ['WhatsApp', 'Instagram', 'Indicação', 'Site', 'Evento', 'Outro']

type Pessoa = {
  linha: number // número de linha no arquivo (cabeçalho = 1)
  nome: string
  email: string
  telefone: string
  whatsapp: string
  cpf: string
  nascimento: string
  origem: string
  observacoes: string
}

function gerarPessoas(total: number): Pessoa[] {
  const pessoas: Pessoa[] = []
  for (let i = 0; i < total; i++) {
    const n = i + 1
    const dia = (i % 28) + 1
    const mes = (i % 12) + 1
    const ano = 1955 + (i % 55)
    pessoas.push({
      linha: n + 1, // +1 por causa do cabeçalho
      nome: `Cliente QA Importação ${String(n).padStart(3, '0')}`,
      email: `cliente.qa.${String(n).padStart(3, '0')}@exemplo-zarpa.com.br`,
      telefone: `(11) 9${String(8000 + n).padStart(4, '0')}-${String(1000 + n).padStart(4, '0')}`,
      whatsapp: `(11) 9${String(7000 + n).padStart(4, '0')}-${String(2000 + n).padStart(4, '0')}`,
      cpf: gerarCpf(i),
      nascimento: `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`,
      origem: ORIGENS[i % ORIGENS.length]!,
      observacoes:
        n === 1
          ? 'Prefere hotel; de preferência próximo à praia, sem escala'
          : n === 2
            ? 'Cliente "fiel"; sempre viaja em julho'
            : `Observação de importação em massa, linha ${n}`,
    })
  }
  return pessoas
}

/** RFC 4180 mínimo, o suficiente para a fixture: aspas quando o campo carrega o
 * delimitador, aspas ou quebra de linha; aspas internas escapadas dobrando. */
function csvField(value: string, delimitador: string): string {
  if (value.includes(delimitador) || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

// Ordem de colunas DELIBERADAMENTE fora do que qualquer um escreveria pensando no
// contato primeiro: telefone e CPF vêm antes do nome, WhatsApp separa nascimento de
// e-mail. É o "colunas fora de ordem" do critério de aceite — o mapeamento por CABEÇALHO
// (não por posição) é exatamente o que impede perda de linha aqui.
const COLUNAS: { titulo: string; campo: keyof Pessoa }[] = [
  { titulo: 'Telefone', campo: 'telefone' },
  { titulo: 'CPF', campo: 'cpf' },
  { titulo: 'Observações', campo: 'observacoes' },
  { titulo: 'Nome Completo', campo: 'nome' },
  { titulo: 'WhatsApp', campo: 'whatsapp' },
  { titulo: 'Data de Nascimento', campo: 'nascimento' },
  { titulo: 'E-mail', campo: 'email' },
  { titulo: 'Origem', campo: 'origem' },
]

const DELIMITADOR = ';'

function gerarCsv(pessoas: Pessoa[]): string {
  const cabecalho = COLUNAS.map((c) => c.titulo).join(DELIMITADOR)
  const linhas = pessoas.map((p) =>
    COLUNAS.map((c) => csvField(String(p[c.campo]), DELIMITADOR)).join(DELIMITADOR),
  )
  return [cabecalho, ...linhas].join('\r\n') + '\r\n'
}

function arquivoCsv(pessoas: Pessoa[], nome = 'clientes-200.csv'): File {
  const texto = gerarCsv(pessoas)
  return new File([Buffer.from(texto, 'utf-8')], nome, { type: 'text/csv' })
}

// ---------------------------------------------------------------------------
// Setup: um tenant e um usuário de verdade no banco de teste (tabelas com RLS —
// não dá para gravar sem contexto de tenant, então cria-se pelo mesmo caminho que
// tests/helpers/db.ts usa para semear tenant raiz).
// ---------------------------------------------------------------------------

const sql: Sql = connect()
const tenantId = randomUUID()
const userId = `qa-import-${randomUUID()}`
const pessoas = gerarPessoas(TOTAL)

beforeAll(async () => {
  authCtx.tenantId = tenantId
  authCtx.userId = userId

  await withTenant(sql, tenantId, (tx) => tx`
    insert into tenants (id, name, slug)
    values (${tenantId}, 'QA Importação', ${`qa-import-${tenantId.slice(0, 8)}`})
  `)
  await withTenant(sql, tenantId, (tx) => tx`
    insert into "user" (id, tenant_id, name, email)
    values (${userId}, ${tenantId}, 'QA Import Bot', ${`${userId}@exemplo-zarpa.com.br`})
  `)
})

afterAll(async () => {
  await sql.end({ timeout: 5 })
})

async function contarContatos(): Promise<number> {
  return withTenant(sql, tenantId, async (tx) => {
    const rows = await tx<{ n: string }[]>`select count(*)::text as n from contacts`
    return Number(rows[0]?.n ?? -1)
  })
}

async function contarNomesDistintos(): Promise<number> {
  return withTenant(sql, tenantId, async (tx) => {
    const rows = await tx<{ n: string }[]>`select count(distinct name)::text as n from contacts`
    return Number(rows[0]?.n ?? -1)
  })
}

async function hashesDuplicados(): Promise<{ document_hash: string; n: string }[]> {
  return withTenant(sql, tenantId, (tx) => tx<{ document_hash: string; n: string }[]>`
    select document_hash, count(*)::text as n
    from contacts
    where document_hash is not null
    group by document_hash
    having count(*) > 1
  `)
}

describe('fixture: os 200 CPFs gerados são válidos de verdade', () => {
  it('cpfValido (o validador real, não uma suposição) aceita todos', () => {
    const invalidos = pessoas.filter((p) => !cpfValido(p.cpf))
    expect(invalidos.map((p) => p.cpf)).toEqual([])
  })

  it('os 200 CPFs são todos distintos entre si', () => {
    const unicos = new Set(pessoas.map((p) => p.cpf.replace(/\D/g, '')))
    expect(unicos.size).toBe(TOTAL)
  })
})

describe('pré-visualização detecta formato e mapeia colunas fora de ordem', () => {
  it('lê 200 linhas de dado, delimitador ; e nenhuma coluna cai em "ignorar"', async () => {
    const resultado = await pravisualizarImportacao(arquivoCsv(pessoas))
    expect(resultado.ok, !resultado.ok ? resultado.mensagem : '').toBe(true)
    if (!resultado.ok) return

    expect(resultado.data.totalLinhas).toBe(TOTAL)
    expect(resultado.data.delimitador).toBe(DELIMITADOR)
    expect(resultado.data.encoding).toBe('utf-8')
    expect(resultado.data.colunas).toEqual(COLUNAS.map((c) => c.titulo))

    // O mapeamento sugerido tem que achar o campo certo em CADA coluna, mesmo com o
    // cabeçalho fora da ordem "óbvia" — se ele chutasse por POSIÇÃO em vez de por nome
    // de cabeçalho, isso aqui quebraria.
    const esperado: Record<string, string> = {
      Telefone: 'phone',
      CPF: 'document',
      Observações: 'notes',
      'Nome Completo': 'name',
      WhatsApp: 'whatsapp',
      'Data de Nascimento': 'birthDate',
      'E-mail': 'email',
      Origem: 'source',
    }
    expect(resultado.data.mapeamentoSugerido).toEqual(esperado)
  })
})

describe('importação de 200 linhas com colunas fora de ordem', () => {
  it('cria exatamente 200 contatos: zero perdido, zero duplicado', async () => {
    const arquivo = arquivoCsv(pessoas)
    const previa = await pravisualizarImportacao(arquivo)
    expect(previa.ok, !previa.ok ? previa.mensagem : '').toBe(true)
    if (!previa.ok) return

    const resultado = await confirmarImportacao(arquivo, previa.data.mapeamentoSugerido)
    expect(resultado.ok, !resultado.ok ? `${resultado.code}: ${resultado.mensagem}` : '').toBe(
      true,
    )
    if (!resultado.ok) return

    const relatorio = resultado.data

    // 1. O relatório em si: nada ignorado, nada mesclado (200 CPFs distintos não têm
    //    como colidir), 200 criados.
    expect(relatorio.totalLinhas).toBe(TOTAL)
    expect(relatorio.criados).toBe(TOTAL)
    expect(relatorio.atualizados).toBe(0)
    expect(relatorio.mesclados).toBe(0)
    expect(relatorio.ignorados).toBe(0)

    // 2. Toda LINHA do arquivo original (2..201, cabeçalho é a 1) aparece EXATAMENTE
    //    uma vez no relatório — não confio só no contador `criados`, que poderia bater
    //    por coincidência (ex.: perdeu uma e duplicou outra). Varre o relatório inteiro.
    const linhasRelatadas = relatorio.itens.map((item) => item.linha).sort((a, b) => a - b)
    const linhasEsperadas = pessoas.map((p) => p.linha).sort((a, b) => a - b)
    expect(linhasRelatadas).toEqual(linhasEsperadas)
    expect(relatorio.itens.every((item) => item.situacao === 'criado')).toBe(true)

    // 3. O banco bate com o relatório: 200 linhas em `contacts` para este tenant, 200
    //    nomes distintos, e nenhum document_hash repetido (a prova de "zero duplicado"
    //    que não depende de confiar no contador que a própria função devolveu).
    expect(await contarContatos()).toBe(TOTAL)
    expect(await contarNomesDistintos()).toBe(TOTAL)
    expect(await hashesDuplicados()).toEqual([])

    // 4. O campo com `;` dentro de aspas (o delimitador do arquivo) sobreviveu inteiro —
    //    se o parser de CSV tivesse cortado no `;` de dentro das aspas, a linha 2 teria
    //    uma coluna a menos e "de preferência..." teria ido para a coluna errada (ou
    //    quebrado o número de colunas da linha inteira).
    const notaComDelimitadorDentro = await withTenant(sql, tenantId, (tx) => tx<{ notes: string }[]>`
      select notes from contacts where name = ${'Cliente QA Importação 001'}
    `)
    expect(notaComDelimitadorDentro[0]?.notes).toBe(
      'Prefere hotel; de preferência próximo à praia, sem escala',
    )

    // 5. `import_batches` (o "recibo") também bate — mesmos números, acessível pelo
    //    caminho real de leitura (`obterRelatorioDeImportacao`), não direto do banco.
    const recibo = await obterRelatorioDeImportacao(relatorio.importBatchId)
    expect(recibo.ok, !recibo.ok ? recibo.mensagem : '').toBe(true)
    if (recibo.ok) {
      expect(recibo.data.totalLinhas).toBe(TOTAL)
      expect(recibo.data.criados).toBe(TOTAL)
      expect(recibo.data.ignorados).toBe(0)
    }
  })

  it('reimportar o MESMO arquivo não duplica — enriquece os 200 contatos existentes', async () => {
    const antesDoTotal = await contarContatos()
    expect(antesDoTotal, 'este teste depende do anterior já ter criado os 200 contatos').toBe(
      TOTAL,
    )

    const arquivo = arquivoCsv(pessoas)
    const previa = await pravisualizarImportacao(arquivo)
    expect(previa.ok).toBe(true)
    if (!previa.ok) return

    const resultado = await confirmarImportacao(arquivo, previa.data.mapeamentoSugerido)
    expect(resultado.ok, !resultado.ok ? `${resultado.code}: ${resultado.mensagem}` : '').toBe(
      true,
    )
    if (!resultado.ok) return

    // Casa por CPF (document_hash) contra o que já existe: reimportar o arquivo inteiro
    // não cria um segundo contato por pessoa — atualiza (mesmo que não haja nada novo
    // para preencher, a linha "bate" com um contato existente).
    expect(resultado.data.criados, 'reimportar o mesmo arquivo criou contato novo — duplicou').toBe(
      0,
    )
    expect(resultado.data.atualizados + resultado.data.mesclados).toBe(TOTAL)

    // A prova que importa: contagem no banco não muda. Se dobrasse para 400, a
    // deduplicação por CPF entre importações não existiria de verdade.
    expect(await contarContatos()).toBe(TOTAL)
    expect(await hashesDuplicados()).toEqual([])
  })
})
