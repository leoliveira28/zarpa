/**
 * Guarda de contraste — WCAG 2.2, cálculo, não impressão.
 *
 * Lê `src/styles/tokens.css`, resolve os tokens semânticos do tema claro e do
 * tema escuro (var() -> var() -> literal), e calcula o contraste real de cada
 * par texto/fundo e cada par de contorno de controle/superfície declarado
 * abaixo. Falha (exit 1) se algum par cair abaixo do piso que a direção
 * "Papel e Pedra" (CLAUDE.md) e a WCAG exigem:
 *
 *   - texto normal (1.4.3, AA)            >= 4.5:1
 *   - contorno de CONTROLE em repouso/hover/pressionado (1.4.11) >= 3:1
 *
 * `--border-subtle` e `--hairline` não entram no piso de 3:1: são cornija e
 * fio interno de registro, não affordance de controle — CLAUDE.md é explícito
 * que só o contorno de controle tem piso.
 *
 *   npx tsx scripts/check/contrast.ts
 *
 * Sai 1 se algum par reprovar: é portão, não relatório.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const TOKENS_PATH = resolve(__dirname, '../../src/styles/tokens.css')

const RESET = '\x1b[0m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'

// -----------------------------------------------------------------------------
// Cor
// -----------------------------------------------------------------------------

type RGB = [number, number, number]

function hexToRgb(hex: string): RGB | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  }
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Mistura `fg` (com alpha) sobre `bg` opaco — para tokens rgb(a). */
function flattenOverOpaque(fg: RGB, alpha: number, bg: RGB): RGB {
  return [
    fg[0] * alpha + bg[0] * (1 - alpha),
    fg[1] * alpha + bg[1] * (1 - alpha),
    fg[2] * alpha + bg[2] * (1 - alpha),
  ]
}

function srgbToLinear(c: number): number {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function relativeLuminance([r, g, b]: RGB): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la]
  return (lighter + 0.05) / (darker + 0.05)
}

function fmt(ratio: number): string {
  return ratio.toFixed(2).replace('.', ',') + ':1'
}

// -----------------------------------------------------------------------------
// Leitura e resolução dos tokens de src/styles/tokens.css
// -----------------------------------------------------------------------------

type TokenMap = Map<string, string>

/** Extrai `--nome: valor;` de dentro de um bloco de regra já isolado (sem chaves externas). */
function extractDeclarations(block: string): TokenMap {
  const map: TokenMap = new Map()
  const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(block))) {
    map.set(m[1], m[2].trim())
  }
  return map
}

/** Isola o conteúdo de UM bloco de regra dado o texto que precede a chave de abertura. */
function isolateRuleBody(css: string, selectorRegex: RegExp): string | null {
  const m = selectorRegex.exec(css)
  if (!m) return null
  const start = css.indexOf('{', m.index)
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(start + 1, i)
    }
  }
  return null
}

/** Resolve var(--x) / var(--x, fallback) recursivamente contra um mapa de tokens já herdado. */
function resolveValue(raw: string, map: TokenMap, seen = new Set<string>()): string {
  const varRe = /var\(\s*--([a-z0-9-]+)\s*(?:,\s*([^)]+))?\)/i
  let value = raw
  let guard = 0
  while (varRe.test(value) && guard++ < 20) {
    value = value.replace(varRe, (_all, name: string, fallback?: string) => {
      if (seen.has(name)) return fallback ?? ''
      const next = map.get(name)
      if (next === undefined) return fallback ?? ''
      seen.add(name)
      return resolveValue(next, map, seen)
    })
  }
  return value.trim()
}

/**
 * Converte um valor de token já resolvido (hex sólido, ou rgb()/rgb(a) com
 * canal alpha) para RGB opaco, achatando sobre `over` quando houver alpha.
 * Retorna `null` para valores que não são cor pintável direta (ex.: sombra
 * composta) — esses pares não fazem sentido para contraste e são ignorados
 * pelo chamador.
 */
function toOpaqueRgb(value: string, over: RGB): RGB | null {
  const hex = hexToRgb(value)
  if (hex) return hex

  const rgbFn = /^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\)$/i.exec(value)
  if (rgbFn) {
    const [, r, g, b, a] = rgbFn
    const rgb: RGB = [Number(r), Number(g), Number(b)]
    const alpha = a === undefined ? 1 : Number(a)
    return alpha >= 1 ? rgb : flattenOverOpaque(rgb, alpha, over)
  }

  return null
}

// -----------------------------------------------------------------------------
// Carrega os dois temas
// -----------------------------------------------------------------------------

const css = readFileSync(TOKENS_PATH, 'utf8')

const rootBody = isolateRuleBody(css, /:root\s*\{/)
if (!rootBody) {
  console.error(`${RED}não encontrei :root em ${TOKENS_PATH}${RESET}`)
  process.exit(2)
}
const lightRaw = extractDeclarations(rootBody)

// Tema escuro forçado (`:root[data-theme="dark"]`) — mesmos valores que o
// automático via prefers-color-scheme, conferido à parte no bloco de paridade.
const darkBody = isolateRuleBody(css, /:root\[data-theme="dark"\](?:,\s*\.theme-dark)?\s*\{/)
if (!darkBody) {
  console.error(`${RED}não encontrei :root[data-theme="dark"] em ${TOKENS_PATH}${RESET}`)
  process.exit(2)
}
const darkOverrides = extractDeclarations(darkBody)

// O escuro só REDEFINE — cai no claro para o que não repetir (regra dura do
// próprio arquivo). Resolve cada tema no seu próprio mapa completo.
const darkRaw: TokenMap = new Map([...lightRaw, ...darkOverrides])

function resolveTheme(map: TokenMap): Map<string, string> {
  const resolved = new Map<string, string>()
  for (const key of map.keys()) {
    resolved.set(key, resolveValue(map.get(key)!, map))
  }
  return resolved
}

const light = resolveTheme(lightRaw)
const dark = resolveTheme(darkRaw)

function get(theme: Map<string, string>, name: string): string {
  const v = theme.get(name)
  if (v === undefined) {
    console.error(`${RED}token --${name} não existe${RESET}`)
    process.exit(2)
  }
  return v
}

// -----------------------------------------------------------------------------
// Pares a auditar
// -----------------------------------------------------------------------------

type Kind = 'text' | 'ui'

interface Pair {
  label: string
  fg: string
  bg: string
  kind: Kind
}

const TEXT_MIN = 4.5
const UI_MIN = 3.0

const SURFACES = ['bg', 'surface', 'surface-2', 'surface-3', 'surface-inset'] as const

const pairs: Pair[] = [
  // texto de corpo / rótulo sobre toda superfície clara onde ele pode aparecer
  ...SURFACES.map((s) => ({ label: `--text sobre --${s}`, fg: 'text', bg: s, kind: 'text' as Kind })),
  ...SURFACES.map((s) => ({
    label: `--text-muted sobre --${s}`,
    fg: 'text-muted',
    bg: s,
    kind: 'text' as Kind,
  })),
  ...SURFACES.map((s) => ({
    label: `--text-subtle sobre --${s}`,
    fg: 'text-subtle',
    bg: s,
    kind: 'text' as Kind,
  })),

  // texto sobre acento e sobre estado
  { label: '--text-on-accent sobre --accent', fg: 'text-on-accent', bg: 'accent', kind: 'text' },
  { label: '--text-on-accent sobre --accent-hover', fg: 'text-on-accent', bg: 'accent-hover', kind: 'text' },
  { label: '--text-on-accent sobre --accent-active', fg: 'text-on-accent', bg: 'accent-active', kind: 'text' },
  { label: '--text-on-accent sobre --danger', fg: 'text-on-accent', bg: 'danger', kind: 'text' },
  { label: '--text-on-accent sobre --danger-hover', fg: 'text-on-accent', bg: 'danger-hover', kind: 'text' },
  { label: '--accent-soft-text sobre --accent-soft', fg: 'accent-soft-text', bg: 'accent-soft', kind: 'text' },
  { label: '--ok-soft-text sobre --ok-soft', fg: 'ok-soft-text', bg: 'ok-soft', kind: 'text' },
  { label: '--warn-soft-text sobre --warn-soft', fg: 'warn-soft-text', bg: 'warn-soft', kind: 'text' },
  { label: '--danger-soft-text sobre --danger-soft', fg: 'danger-soft-text', bg: 'danger-soft', kind: 'text' },
  { label: '--accent sobre --surface (link/rótulo em acento)', fg: 'accent', bg: 'surface', kind: 'text' },

  // contorno de CONTROLE — piso 3:1 contra toda superfície em que ele pousa
  ...SURFACES.filter((s) => s !== 'surface-3').map((s) => ({
    label: `--border (repouso) sobre --${s}`,
    fg: 'border',
    bg: s,
    kind: 'ui' as Kind,
  })),
  ...SURFACES.filter((s) => s !== 'surface-3').map((s) => ({
    label: `--border-strong (hover/pressionado) sobre --${s}`,
    fg: 'border-strong',
    bg: s,
    kind: 'ui' as Kind,
  })),
  { label: '--border sobre --surface-3 (dead filled)', fg: 'border', bg: 'surface-3', kind: 'ui' },
];

// -----------------------------------------------------------------------------
// Execução
// -----------------------------------------------------------------------------

interface Row {
  label: string
  ratio: number
  min: number
  pass: boolean
}

function audit(theme: Map<string, string>, themeName: string): Row[] {
  const rows: Row[] = []
  for (const pair of pairs) {
    const bgValue = get(theme, pair.bg)
    const bgRgb = toOpaqueRgb(bgValue, [255, 255, 255])
    if (!bgRgb) {
      console.error(`${RED}[${themeName}] fundo --${pair.bg} não é cor pintável: "${bgValue}"${RESET}`)
      process.exit(2)
    }
    const fgValue = get(theme, pair.fg)
    const fgRgb = toOpaqueRgb(fgValue, bgRgb)
    if (!fgRgb) {
      console.error(`${RED}[${themeName}] cor --${pair.fg} não é cor pintável: "${fgValue}"${RESET}`)
      process.exit(2)
    }
    const ratio = contrastRatio(fgRgb, bgRgb)
    const min = pair.kind === 'text' ? TEXT_MIN : UI_MIN
    rows.push({ label: pair.label, ratio, min, pass: ratio >= min })
  }
  return rows
}

function report(themeName: string, rows: Row[]): boolean {
  console.log(`\n${BOLD}── ${themeName} ${'─'.repeat(Math.max(0, 60 - themeName.length))}${RESET}`)
  let ok = true
  for (const row of rows) {
    const color = row.pass ? GREEN : RED
    const tag = row.pass ? 'ok ' : 'FALHA'
    if (!row.pass) ok = false
    console.log(
      `  ${color}${tag}${RESET}  ${row.label.padEnd(48)} ${fmt(row.ratio)} ${DIM}(piso ${fmt(row.min)})${RESET}`,
    )
  }
  return ok
}

const lightOk = report('Tema claro', audit(light, 'claro'))
const darkOk = report('Tema escuro', audit(dark, 'escuro'))

console.log()
if (lightOk && darkOk) {
  console.log(`${GREEN}${BOLD}todos os pares dentro do piso.${RESET}`)
  process.exit(0)
} else {
  console.log(`${RED}${BOLD}há par abaixo do piso — corrija o token, não o componente.${RESET}`)
  process.exit(1)
}
