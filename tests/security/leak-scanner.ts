/**
 * Varredura de vazamento em payload.
 *
 * Não confere campo a campo — conferir campo a campo só encontra o que quem
 * escreveu o teste já imaginou. Aqui a gente percorre o payload INTEIRO
 * (objetos, arrays, strings com JSON dentro) procurando:
 *
 *   1. nomes de campo proibidos (custo, comissão, CPF, passaporte, e-mail, telefone)
 *   2. padrões no VALOR (regex de CPF com dígito verificador, e-mail, telefone BR)
 *   3. canários — valores que o teste plantou no banco e que não podem sair
 *
 * Campo novo chamado `preco_de_custo` cai na regra 1 sem ninguém tocar no teste.
 */

export type Leak = {
  path: string
  kind: 'nome-de-campo' | 'padrao-no-valor' | 'canario'
  what: string
  sample: string
}

/** Nome de campo que nunca pode aparecer numa proposta pública. */
export const FORBIDDEN_KEY_PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'custo', re: /(^|_)(cost|custo|net_?rate|net_?price|tarifa_?net|supplier_?price|preco_?de_?custo|valor_?de_?custo|buy_?price)($|_)/i },
  { label: 'comissão / margem', re: /(^|_)(commission|comissao|comissão|markup|margin|margem|profit|lucro|spread|rav|over)($|_)/i },
  { label: 'CPF / documento', re: /(^|_)(cpf|rg|documento|document(_?number)?|doc_?num|tax_?id)($|_)/i },
  { label: 'passaporte', re: /(^|_)(passport|passaporte|passport_?number|passport_?expiry)($|_)/i },
  { label: 'e-mail', re: /(^|_)(email|e_?mail|mail)($|_)/i },
  { label: 'telefone', re: /(^|_)(phone|telefone|tel|celular|mobile|whatsapp|wpp|msisdn)($|_)/i },
  { label: 'nascimento', re: /(^|_)(birth(date|day)?|nascimento|data_?nasc|dob)($|_)/i },
]

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
/** Telefone BR com DDD, formatado ou não. Exige 10-11 dígitos após o DDD plausível. */
const PHONE_BR_RE = /(?:\+?55\s?)?\(?[1-9]{2}\)?\s?9?\d{4}[-\s]?\d{4}(?!\d)/
/** Passaporte brasileiro: 2 letras + 6 dígitos. */
const PASSPORT_RE = /\b[A-Z]{2}\d{6}\b/

/** CPF formatado, OU 11 dígitos crus que passam no dígito verificador. */
export function findCpf(text: string): string | null {
  const candidates = text.match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g)
  if (!candidates) return null
  for (const c of candidates) {
    const digits = c.replace(/\D/g, '')
    if (digits.length !== 11) continue
    // Formatado já é sinal suficiente; cru só conta se o dígito bater,
    // senão qualquer id numérico de 11 dígitos viraria falso positivo.
    if (/[.-]/.test(c) || isValidCpf(digits)) return c
  }
  return null
}

export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false
  const calc = (len: number): number => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(digits[i]) * (len + 1 - i)
    const mod = (sum * 10) % 11
    return mod === 10 ? 0 : mod
  }
  return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10])
}

const VALUE_PATTERNS: { label: string; test: (s: string) => string | null }[] = [
  { label: 'CPF', test: findCpf },
  { label: 'e-mail', test: (s) => s.match(EMAIL_RE)?.[0] ?? null },
  { label: 'telefone BR', test: (s) => s.match(PHONE_BR_RE)?.[0] ?? null },
  { label: 'passaporte', test: (s) => s.match(PASSPORT_RE)?.[0] ?? null },
]

/**
 * Caminhos cujo VALOR aciona uma heurística de padrão sensível DE PROPÓSITO, porque o
 * dado é público por natureza — não afrouxa a checagem por NOME de campo (regra 1) nem
 * canário (regra 3), só a regra 2 (padrão no valor), e só no caminho exato.
 *
 * `brand.whatsappLink` (`https://wa.me/<dígitos>`): o WhatsApp COMERCIAL do agente,
 * congelado em `proposals.brand_snapshot` e devolvido de propósito pela proposta
 * pública (CLAUDE.md pede o contato do agente na proposta). `PHONE_BR_RE` não distingue
 * "número do cliente vazando" de "número do agente publicado" — qualquer formatação de
 * DDD+celular bate nele. Ver docs/handoffs/rafa-para-teo.md, item 4 da seção S7. Se um
 * dia `brand.whatsappLink` vier de outra fonte que não `brand_snapshot` (ex.: telefone do
 * PASSAGEIRO vazando por engano com esse mesmo nome de campo), esta allowlist mascararia
 * o vazamento — por isso ela é restrita ao path exato, não a qualquer campo `whatsappLink`
 * solto em outro lugar do payload.
 */
const VALUE_PATTERN_ALLOWLIST: { path: RegExp; label: string }[] = [
  { path: /(^|\.)brand\.whatsappLink$/, label: 'telefone BR' },
]

function isAllowedValuePattern(path: string, label: string): boolean {
  return VALUE_PATTERN_ALLOWLIST.some((a) => a.label === label && a.path.test(path))
}

function truncate(s: string, n = 80): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

/**
 * Percorre o payload inteiro. Strings que contêm JSON são reabertas e varridas
 * por dentro — dado sensível escondido num campo `metadata` de texto é
 * exatamente o tipo de coisa que passa despercebida.
 */
export function scanPayload(payload: unknown, canaries: Record<string, string> = {}): Leak[] {
  const leaks: Leak[] = []
  const seen = new WeakSet<object>()

  const visit = (node: unknown, path: string, depth: number): void => {
    if (depth > 24) return

    if (node === null || node === undefined) return

    if (typeof node === 'string') {
      for (const [name, value] of Object.entries(canaries)) {
        if (value !== '' && node.includes(value)) {
          leaks.push({ path, kind: 'canario', what: name, sample: truncate(node) })
        }
      }
      for (const p of VALUE_PATTERNS) {
        const hit = p.test(node)
        if (hit !== null && !isAllowedValuePattern(path, p.label)) {
          leaks.push({ path, kind: 'padrao-no-valor', what: p.label, sample: truncate(hit) })
        }
      }
      // JSON embutido em string
      const trimmed = node.trim()
      if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        try {
          visit(JSON.parse(trimmed), `${path}(json)`, depth + 1)
        } catch {
          /* não era JSON, segue */
        }
      }
      return
    }

    if (typeof node === 'number' || typeof node === 'boolean') {
      for (const [name, value] of Object.entries(canaries)) {
        if (value !== '' && String(node) === value) {
          leaks.push({ path, kind: 'canario', what: name, sample: String(node) })
        }
      }
      return
    }

    if (typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)

    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${path}[${i}]`, depth + 1))
      return
    }

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const childPath = path === '' ? key : `${path}.${key}`
      for (const p of FORBIDDEN_KEY_PATTERNS) {
        if (p.re.test(key)) {
          leaks.push({
            path: childPath,
            kind: 'nome-de-campo',
            what: p.label,
            sample: truncate(JSON.stringify(value) ?? String(value)),
          })
        }
      }
      visit(value, childPath, depth + 1)
    }
  }

  visit(payload, '', 0)
  return leaks
}

export function formatLeaks(leaks: Leak[]): string {
  if (leaks.length === 0) return 'nenhum vazamento'
  return leaks
    .map((l) => `  - [${l.kind}] ${l.path || '<raiz>'} → ${l.what}: ${l.sample}`)
    .join('\n')
}

/** Canários plantados no banco: se qualquer um sair na resposta pública, é vazamento. */
export const CANARIES = {
  cpf: '529.982.247-25',
  passaporte: 'YB123456',
  email: 'canario-passageiro@teo.invalid',
  telefone: '(11) 98765-4321',
  custo: '1234.56',
  comissao: '987.65',
  nascimento: '1980-01-31',
} as const
