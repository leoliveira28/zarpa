/**
 * Coleta e recorte dos fontes de `src/**` para os guardas de direção visual.
 *
 * Princípio: os guardas NÃO varrem o arquivo inteiro procurando substring.
 * Isso produz falso positivo (a palavra "Inter" vive dentro de "interval") e
 * falso positivo mata guarda mais rápido que falso negativo — o time desliga
 * o teste e a regra evapora.
 *
 * Em vez disso, cada guarda recebe SÍTIOS: pedaços de código com papel
 * conhecido (um valor de `font-family`, o corpo de um `[transition:…]`, as
 * chaves de um `animate={{…}}`). Um sítio carrega arquivo, linha e o texto
 * exato, para a mensagem de falha apontar o lugar em vez de descrever o
 * sintoma.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { REPO_ROOT } from '../setup/env'
import { parseCss, splitTopLevel, type ParsedCss } from './css'

export const SRC_ROOT = resolve(REPO_ROOT, 'src')

const SKIP_DIRS = new Set(['node_modules', '.next', 'coverage', '__snapshots__'])

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = resolve(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

export type SourceFile = { path: string; rel: string; text: string }

function collect(extensions: string[]): SourceFile[] {
  return walk(SRC_ROOT)
    .filter((p) => extensions.some((e) => p.endsWith(e)))
    .sort()
    .map((path) => ({
      path,
      rel: relative(REPO_ROOT, path),
      text: readFileSync(path, 'utf8'),
    }))
}

let cssCache: ParsedCss[] | null = null
let tsxCache: SourceFile[] | null = null

/** Todo CSS de `src/**`, já tokenizado com contexto. */
export function cssFiles(): ParsedCss[] {
  if (cssCache) return cssCache
  cssCache = collect(['.css']).map((f) => parseCss(f.rel, f.text))
  return cssCache
}

/** Todo TS/TSX de `src/**`. */
export function tsxFiles(): SourceFile[] {
  if (tsxCache) return tsxCache
  tsxCache = collect(['.ts', '.tsx'])
  return tsxCache
}

/** Número da linha (1-based) do offset dentro do texto. */
export function lineOf(text: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') line++
  return line
}

export type Site = {
  file: string
  line: number
  /** De onde saiu: `css:font-family`, `tsx:className[transition:…]`, … */
  origin: string
  /** O texto do sítio, já recortado. */
  text: string
}

export const formatSite = (s: Site): string => `${s.file}:${s.line}  (${s.origin})  ${s.text}`

/* =============================================================================
   Recorte de TSX
   ========================================================================== */

/**
 * Comentários de TS/TSX viram espaço, como no CSS: um comentário que explica
 * "não usamos serifa" não pode ser lido como uma serifa em uso.
 */
export function stripTsComments(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    const next = src[i + 1]
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      for (let k = i; k < stop; k++) out += src[k] === '\n' ? '\n' : ' '
      i = stop
      continue
    }
    if (ch === '/' && next === '/') {
      let stop = src.indexOf('\n', i)
      if (stop === -1) stop = src.length
      for (let k = i; k < stop; k++) out += ' '
      i = stop
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
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

/** Todos os literais de string/template do arquivo, com posição. */
export function stringLiterals(text: string): { value: string; offset: number }[] {
  const src = stripTsComments(text)
  const out: { value: string; offset: number }[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      const start = i
      i++
      let value = ''
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < src.length) {
          value += src[i + 1]
          i += 2
          continue
        }
        value += src[i]
        i++
      }
      i++
      out.push({ value, offset: start })
      continue
    }
    i++
  }
  return out
}

/**
 * Classes utilitárias mencionadas em literais de string. Cobre `className="…"`,
 * `cn("…", cond && "…")` e mapas de variante — todos são literais de string com
 * classes separadas por espaço, que é o formato que o Tailwind exige para
 * conseguir ver a classe.
 */
export function utilityClasses(file: SourceFile): { value: string; line: number }[] {
  const out: { value: string; line: number }[] = []
  for (const lit of stringLiterals(file.text)) {
    // Tailwind aceita `_` como espaço dentro de colchetes; fora deles, espaço.
    for (const token of lit.value.split(/\s+/)) {
      if (token === '') continue
      if (!/^[a-z[@:!-]/i.test(token)) continue
      out.push({ value: token, line: lineOf(file.text, lit.offset) })
    }
  }
  return out
}

/**
 * Corpo dos objetos passados a props do `motion` que descrevem estado animado.
 * Devolve as CHAVES do objeto — que são as propriedades que vão se mexer.
 */
export const MOTION_STATE_PROPS = [
  'animate',
  'initial',
  'exit',
  'whileHover',
  'whileTap',
  'whileFocus',
  'whileDrag',
  'whileInView',
] as const

export function motionAnimatedKeys(file: SourceFile): Site[] {
  const src = stripTsComments(file.text)
  const sites: Site[] = []
  const re = new RegExp(`\\b(${MOTION_STATE_PROPS.join('|')})\\s*=\\s*\\{`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const prop = m[1]
    // Casa as chaves para pegar o valor inteiro da prop JSX.
    let depth = 0
    let i = m.index + m[0].length - 1
    const start = i
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    const body = src.slice(start, i + 1)
    // Chaves de objeto no primeiro nível interno: `{ opacity: 0, y: 12 }`.
    for (const km of body.matchAll(/(?:^|[{,[])\s*(?:"([\w-]+)"|'([\w-]+)'|([A-Za-z_$][\w$]*))\s*:/g)) {
      const key = km[1] ?? km[2] ?? km[3]
      if (key === undefined) continue
      sites.push({
        file: file.rel,
        line: lineOf(file.text, m.index),
        origin: `tsx:motion ${prop}`,
        text: key,
      })
    }
  }
  return sites
}

/** Valor de `transition` dentro de um objeto de estilo inline. */
export function inlineStyleTransitions(file: SourceFile): Site[] {
  const src = stripTsComments(file.text)
  const sites: Site[] = []
  for (const m of src.matchAll(/\btransition(?:Property)?\s*:\s*(["'`])([^"'`]*)\1/g)) {
    sites.push({
      file: file.rel,
      line: lineOf(file.text, m.index ?? 0),
      origin: 'tsx:style transition',
      text: m[2],
    })
  }
  return sites
}

/** Valor de `fontFamily` em objeto de estilo inline, e `font-family` em template. */
export function inlineFontFamilies(file: SourceFile): Site[] {
  const src = stripTsComments(file.text)
  const sites: Site[] = []
  for (const m of src.matchAll(/\bfontFamily\s*:\s*(["'`])([^"'`]*)\1/g)) {
    sites.push({
      file: file.rel,
      line: lineOf(file.text, m.index ?? 0),
      origin: 'tsx:style fontFamily',
      text: m[2],
    })
  }
  for (const m of src.matchAll(/font-family\s*:\s*([^;"'`}]+)/g)) {
    sites.push({
      file: file.rel,
      line: lineOf(file.text, m.index ?? 0),
      origin: 'tsx:css font-family',
      text: m[1].trim(),
    })
  }
  return sites
}

/** Famílias importadas de `next/font/google` — a fonte entra por aqui, não por CSS. */
export function nextFontImports(file: SourceFile): Site[] {
  const src = stripTsComments(file.text)
  const sites: Site[] = []
  for (const m of src.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*["']next\/font\/(google|local)["']/g,
  )) {
    for (const name of splitTopLevel(m[1])) {
      const ident = name.split(/\s+as\s+/)[0].trim()
      if (ident === '') continue
      sites.push({
        file: file.rel,
        line: lineOf(file.text, m.index ?? 0),
        // `Libre_Franklin` -> `Libre Franklin`
        origin: `tsx:next/font/${m[2]}`,
        text: ident.replace(/_/g, ' '),
      })
    }
  }
  return sites
}
