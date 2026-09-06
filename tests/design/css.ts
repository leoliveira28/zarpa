/**
 * Tokenizador de CSS suficiente para lint estrutural.
 *
 * NÃO é um parser de CSS completo e não quer ser. O que ele precisa acertar,
 * e acerta, é o CONTEXTO de cada declaração: dentro de qual seletor, dentro de
 * qual cadeia de at-rules, em que linha. É isso que as regras da direção
 * "Papel e Pedra" exigem para serem verificáveis:
 *
 *   - "nenhuma cor com definição única dentro de media query" é uma pergunta
 *     sobre o contexto da declaração, não sobre o valor dela;
 *   - "só transform e opacity animam" precisa saber quais propriedades vivem
 *     dentro de cada @keyframes;
 *   - "prefers-reduced-motion desde o primeiro componente" precisa saber quais
 *     seletores aparecem dentro daquele bloco.
 *
 * Usar um parser de verdade (postcss) exigiria dependência nova, que eu não
 * instalo (docs/OWNERSHIP.md, regra 1). Este arquivo tem testes próprios em
 * `tests/design/css.test.ts` — parser sem teste é parser que mente em silêncio.
 */

export type CssBlock = {
  file: string
  line: number
  /** Prelúdio deste bloco: o seletor, ou o at-rule com seus parâmetros. */
  prelude: string
  /** Prelúdios dos blocos ancestrais, do mais externo ao mais interno. */
  ancestors: string[]
  declarations: CssDeclaration[]
}

export type CssDeclaration = {
  file: string
  line: number
  prop: string
  value: string
  /** Seletor efetivo: o prelúdio não-at mais interno da cadeia. '' se não houver. */
  selector: string
  /** At-rules em vigor, do mais externo ao mais interno. */
  atRules: string[]
}

/**
 * Troca comentários por espaços, preservando quebras de linha.
 * Preservar o comprimento mantém os offsets — e portanto os números de linha —
 * corretos, que é o que faz a mensagem de falha ser acionável.
 */
export function stripComments(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      for (let k = i; k < stop; k++) out += src[k] === '\n' ? '\n' : ' '
      i = stop
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      out += ch
      i++
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < src.length) {
          out += src[i] + src[i + 1]
          i += 2
          continue
        }
        out += src[i]
        i++
      }
      if (i < src.length) {
        out += src[i]
        i++
      }
      continue
    }
    out += ch
    i++
  }
  return out
}

function lineIndexer(src: string): (offset: number) => number {
  const starts: number[] = [0]
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1)
  return (offset: number) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

const isAtRule = (prelude: string): boolean => prelude.startsWith('@')

function effectiveSelector(chain: string[]): string {
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!isAtRule(chain[i])) return chain[i]
  }
  return ''
}

const effectiveAtRules = (chain: string[]): string[] => chain.filter(isAtRule)

export type ParsedCss = {
  file: string
  blocks: CssBlock[]
  declarations: CssDeclaration[]
}

export function parseCss(file: string, source: string): ParsedCss {
  const src = stripComments(source)
  const lineAt = lineIndexer(src)

  const blocks: CssBlock[] = []
  const declarations: CssDeclaration[] = []

  /** Pilha de blocos abertos. `chain` é o caminho de prelúdios até aqui. */
  const stack: CssBlock[] = []
  const chain: string[] = []

  let buf = ''
  let bufStart = 0
  let parens = 0

  const pushDeclaration = (): void => {
    const raw = buf.trim()
    buf = ''
    if (raw === '') return
    // Um at-rule sem bloco (`@import "x";`) não é declaração.
    if (raw.startsWith('@')) return
    const colon = raw.indexOf(':')
    if (colon === -1) return
    const prop = raw.slice(0, colon).trim()
    const value = raw.slice(colon + 1).trim()
    if (prop === '' || /[{}]/.test(prop)) return
    const decl: CssDeclaration = {
      file,
      line: lineAt(bufStart),
      prop,
      value,
      selector: effectiveSelector(chain),
      atRules: effectiveAtRules(chain),
    }
    declarations.push(decl)
    const owner = stack[stack.length - 1]
    if (owner) owner.declarations.push(decl)
  }

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    // Precisa ser `.trim() === ''`, não `=== ''`: o primeiro caractere
    // acumulado depois de `{`/`;`/`}` costuma ser a quebra de linha que
    // fecha a linha ANTERIOR. Só travar quando o buffer já tem conteúdo de
    // verdade é o que faz `line` apontar a linha da declaração, não a linha
    // do separador que abriu o bloco (achado em css.test.ts).
    if (buf.trim() === '') bufStart = i

    if (ch === '(') parens++
    else if (ch === ')') parens = Math.max(0, parens - 1)

    if (parens === 0 && ch === '{') {
      const prelude = buf.replace(/\s+/g, ' ').trim()
      buf = ''
      const block: CssBlock = {
        file,
        line: lineAt(bufStart),
        prelude,
        ancestors: [...chain],
        declarations: [],
      }
      blocks.push(block)
      stack.push(block)
      chain.push(prelude)
      continue
    }

    if (parens === 0 && ch === '}') {
      pushDeclaration()
      stack.pop()
      chain.pop()
      continue
    }

    if (parens === 0 && ch === ';') {
      pushDeclaration()
      continue
    }

    buf += ch
  }

  return { file, blocks, declarations }
}

/** Divide uma lista separada por vírgula respeitando parênteses e aspas. */
export function splitTopLevel(value: string, separator = ','): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (quote) {
      current += ch
      if (ch === quote && value[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === separator && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim() !== '') parts.push(current.trim())
  return parts
}

/** `@keyframes zk-sheen` -> `zk-sheen`. Devolve null se não for keyframes. */
export function keyframesName(prelude: string): string | null {
  const m = /^@(?:-\w+-)?keyframes\s+(.+)$/i.exec(prelude.trim())
  if (!m) return null
  return m[1].trim().replace(/^["']|["']$/g, '')
}

export const isMediaAtRule = (rule: string): boolean =>
  /^@(media|supports|container)\b/i.test(rule)

export const mentionsDataTheme = (selector: string): boolean =>
  /\[data-theme\s*[~^|$*]?=/.test(selector)

/**
 * Seletor "base" equivalente: tira o qualificador de tema para poder perguntar
 * se existe uma definição correspondente fora do bloco temático.
 * `:root:not([data-theme="light"])` -> `:root`
 */
export function baseSelector(selector: string): string {
  return selector
    .replace(/:not\(\s*\[data-theme\s*[~^|$*]?=\s*["']?[\w-]+["']?\s*\]\s*\)/g, '')
    .replace(/\[data-theme\s*[~^|$*]?=\s*["']?[\w-]+["']?\s*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
