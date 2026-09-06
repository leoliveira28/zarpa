/**
 * Coleta os sítios de `src/**` e aplica as regras de `rules.ts`.
 *
 * Devolve VIOLAÇÕES CRUAS — sem consultar o registro de desvios. Quem decide o
 * que é tolerado é o teste (`tests/design/*.test.ts`), com `deviations.ts` na
 * mão. Manter a coleta ignorante do registro é o que permite o teste "o
 * registro não tem entrada morta": se a coleta já filtrasse, não haveria como
 * perguntar se uma tolerância ainda faz falta.
 */
import {
  baseSelector,
  isMediaAtRule,
  keyframesName,
  mentionsDataTheme,
  splitTopLevel,
  type CssDeclaration,
} from './css'
import {
  COLOR_PROPERTIES,
  checkAnimatedProperty,
  checkFontStack,
  isColorValue,
  isFontToken,
  tailwindTransitionProperties,
  transitionProperties,
  type MotionVerdict,
} from './rules'
import {
  cssFiles,
  formatSite,
  inlineFontFamilies,
  inlineStyleTransitions,
  lineOf,
  motionAnimatedKeys,
  nextFontImports,
  stripTsComments,
  tsxFiles,
  utilityClasses,
  type Site,
} from './sources'

export type Violation = {
  /** Chave estável usada pelo registro de desvios. Não mude sem migrar o registro. */
  id: string
  file: string
  line: number
  origin: string
  detail: string
  message: string
}

const violation = (v: Omit<Violation, 'message'>): Violation => ({
  ...v,
  message: `${v.file}:${v.line}  [${v.origin}]  ${v.detail}`,
})

/* =============================================================================
   1. Tipografia — nenhuma serifa, nenhuma Inter, nenhuma Space Grotesk
   ========================================================================== */

export function typographyViolations(): Violation[] {
  const out: Violation[] = []

  for (const css of cssFiles()) {
    for (const decl of css.declarations) {
      const relevant =
        decl.prop === 'font-family' || decl.prop === 'font' || isFontToken(decl.prop)
      if (!relevant) continue
      const verdict = checkFontStack(decl.value)
      if (verdict.ok) continue
      out.push(
        violation({
          id: `font:${decl.file}:${decl.prop}:${verdict.matched.toLowerCase()}`,
          file: decl.file,
          line: decl.line,
          origin: `css ${decl.prop}`,
          detail: `${decl.prop}: ${decl.value} — ${verdict.reason}`,
        }),
      )
    }
  }

  for (const file of tsxFiles()) {
    const sites: Site[] = [
      ...inlineFontFamilies(file),
      ...nextFontImports(file),
      ...utilityClasses(file)
        .filter((c) => /^font-\[/.test(c.value))
        .map((c) => ({
          file: file.rel,
          line: c.line,
          origin: 'tsx:className font-[…]',
          text: c.value.replace(/^font-\[/, '').replace(/\]$/, '').replace(/_/g, ' '),
        })),
    ]
    for (const site of sites) {
      const verdict = checkFontStack(site.text)
      if (verdict.ok) continue
      out.push(
        violation({
          id: `font:${site.file}:${site.origin}:${verdict.matched.toLowerCase()}`,
          file: site.file,
          line: site.line,
          origin: site.origin,
          detail: `${site.text} — ${verdict.reason}`,
        }),
      )
    }
  }

  return out
}

/* =============================================================================
   2. Cor — nenhuma definição única dentro de @media ou [data-theme]
   ========================================================================== */

/** Uma declaração está no contexto BASE (fora de media query e fora de tema)? */
export function isBaseContext(decl: CssDeclaration): boolean {
  if (decl.atRules.some(isMediaAtRule)) return false
  if (mentionsDataTheme(decl.selector)) return false
  return true
}

export function colorContextViolations(): Violation[] {
  const out: Violation[] = []

  /* --- 2a. Custom properties: o caso do CLAUDE.md, ao pé da letra --------- */
  const byToken = new Map<string, CssDeclaration[]>()
  for (const css of cssFiles()) {
    for (const decl of css.declarations) {
      if (!decl.prop.startsWith('--')) continue
      const list = byToken.get(decl.prop) ?? []
      list.push(decl)
      byToken.set(decl.prop, list)
    }
  }

  for (const [token, decls] of [...byToken].sort(([a], [b]) => a.localeCompare(b))) {
    const colorDecls = decls.filter((d) => isColorValue(d.value))
    if (colorDecls.length === 0) continue
    if (decls.some(isBaseContext)) continue
    const first = colorDecls[0]
    out.push(
      violation({
        id: `color-token-only-in-theme:${token}`,
        file: first.file,
        line: first.line,
        origin: 'css token',
        detail:
          `o token de cor \`${token}\` só existe dentro de ` +
          `${[...first.atRules, first.selector].filter(Boolean).join(' ')} — ` +
          `não há definição no \`:root\` base. Fora daquele contexto o valor é ` +
          `vazio e o que usa o token fica ilegível. ` +
          `CLAUDE.md: "Todo token existe no :root base."`,
      }),
    )
  }

  /* --- 2b. Declarações comuns: cor pintada só no tema escuro -------------- */
  type Key = string
  const baseDeclared = new Set<Key>()
  const themed: { decl: CssDeclaration; key: Key }[] = []

  for (const css of cssFiles()) {
    for (const decl of css.declarations) {
      if (decl.prop.startsWith('--')) continue
      if (!COLOR_PROPERTIES.has(decl.prop)) continue
      if (!isColorValue(decl.value)) continue
      const key = `${baseSelector(decl.selector)}|${decl.prop}`
      if (isBaseContext(decl)) baseDeclared.add(key)
      else themed.push({ decl, key })
    }
  }

  for (const { decl, key } of themed) {
    if (baseDeclared.has(key)) continue
    if (decl.selector === '') continue
    out.push(
      violation({
        id: `color-rule-only-in-theme:${decl.selector}:${decl.prop}`,
        file: decl.file,
        line: decl.line,
        origin: 'css rule',
        detail:
          `\`${decl.selector} { ${decl.prop} }\` só é pintado dentro de ` +
          `${[...decl.atRules].join(' ')} — não há valor base. ` +
          `Quem não casar com essa media query fica sem cor.`,
      }),
    )
  }

  /* --- 2c. TSX: variante `dark:` de cor sem contraparte base -------------- */
  const COLOR_UTILITY = /^(bg|text|border|fill|stroke|ring|shadow|decoration|outline|accent|caret|divide)-/
  for (const file of tsxFiles()) {
    const src = stripTsComments(file.text)
    for (const lit of src.matchAll(/(["'`])([^"'`]*)\1/g)) {
      const tokens = lit[2].split(/\s+/).filter(Boolean)
      const bare = new Set(tokens.filter((t) => !t.includes(':')))
      for (const token of tokens) {
        if (!token.startsWith('dark:')) continue
        const utility = token.slice('dark:'.length)
        if (!COLOR_UTILITY.test(utility)) continue
        const prefix = utility.split('-')[0]
        const hasBase = [...bare].some((t) => t.startsWith(`${prefix}-`))
        if (hasBase) continue
        out.push(
          violation({
            id: `dark-only-utility:${file.rel}:${utility}`,
            file: file.rel,
            line: lineOf(file.text, lit.index ?? 0),
            origin: 'tsx:className dark:',
            detail:
              `\`${token}\` sem contraparte clara na mesma lista de classes. ` +
              `No tema claro o elemento fica sem \`${prefix}\`.`,
          }),
        )
      }
    }
  }

  return out
}

/**
 * 2d. Paridade entre os dois blocos de tema escuro.
 *
 * O CLAUDE.md manda ter os dois: `@media (prefers-color-scheme: dark)` para o
 * automático e `:root[data-theme="dark"]` para o alternador. Eles têm que
 * redefinir o MESMO conjunto — um token presente só no automático fica com o
 * valor claro quando o usuário força escuro, que é exatamente o bug de
 * artefato ilegível, só que escondido atrás de um clique.
 */
export function themeParityViolations(): Violation[] {
  const auto = new Map<string, CssDeclaration>()
  const forced = new Map<string, CssDeclaration>()

  for (const css of cssFiles()) {
    for (const decl of css.declarations) {
      if (!decl.prop.startsWith('--')) continue
      const inDarkMedia = decl.atRules.some((r) => /prefers-color-scheme\s*:\s*dark/i.test(r))
      const inForcedDark = /\[data-theme\s*=\s*["']?dark["']?\]/.test(decl.selector)
      // Blocos de acessibilidade (contraste/transparência) redefinem por outro
      // eixo e não têm que espelhar o tema. Só o par de temas puros conta.
      const accessibilityAxis = decl.atRules.some((r) =>
        /prefers-(contrast|reduced-transparency|reduced-motion)/i.test(r),
      )
      if (accessibilityAxis) continue
      if (inDarkMedia && !inForcedDark) auto.set(decl.prop, decl)
      else if (inForcedDark && !decl.atRules.some(isMediaAtRule)) forced.set(decl.prop, decl)
    }
  }

  const out: Violation[] = []
  for (const [prop, decl] of [...auto].sort(([a], [b]) => a.localeCompare(b))) {
    if (forced.has(prop)) continue
    out.push(
      violation({
        id: `theme-parity-missing-forced:${prop}`,
        file: decl.file,
        line: decl.line,
        origin: 'css theme parity',
        detail:
          `\`${prop}\` é redefinido em @media (prefers-color-scheme: dark) mas NÃO em ` +
          `:root[data-theme="dark"]. Quem forçar o tema escuro pelo alternador recebe o ` +
          `valor do tema claro neste token.`,
      }),
    )
  }
  for (const [prop, decl] of [...forced].sort(([a], [b]) => a.localeCompare(b))) {
    if (auto.has(prop)) continue
    out.push(
      violation({
        id: `theme-parity-missing-auto:${prop}`,
        file: decl.file,
        line: decl.line,
        origin: 'css theme parity',
        detail:
          `\`${prop}\` é redefinido em :root[data-theme="dark"] mas NÃO em ` +
          `@media (prefers-color-scheme: dark). Quem deixa o tema em "sistema" e usa o ` +
          `celular no escuro recebe o valor do tema claro neste token.`,
      }),
    )
  }
  return out
}

/* =============================================================================
   3. Movimento — só transform e opacity animam
   ========================================================================== */

type AnimatedSite = Site & { property: string }

/** Todos os sítios de propriedade animada do repositório. */
export function animatedSites(): AnimatedSite[] {
  const sites: AnimatedSite[] = []

  for (const css of cssFiles()) {
    /* Corpo dos @keyframes: cada propriedade declarada lá dentro se move. */
    for (const block of css.blocks) {
      const insideKeyframes = [...block.ancestors, block.prelude].some(
        (p) => keyframesName(p) !== null,
      )
      if (!insideKeyframes) continue
      for (const decl of block.declarations) {
        sites.push({
          file: decl.file,
          line: decl.line,
          origin: `css @keyframes ${
            [...block.ancestors, block.prelude].map(keyframesName).filter(Boolean)[0]
          }`,
          text: `${decl.prop}: ${decl.value}`,
          property: decl.prop,
        })
      }
    }

    /* transition / transition-property */
    for (const decl of css.declarations) {
      if (decl.prop !== 'transition' && decl.prop !== 'transition-property') continue
      for (const property of transitionProperties(decl.value)) {
        sites.push({
          file: decl.file,
          line: decl.line,
          origin: `css ${decl.prop}`,
          text: decl.value,
          property,
        })
      }
    }
  }

  for (const file of tsxFiles()) {
    /* Valor arbitrário do Tailwind: className="[transition:border-color_120ms…]" */
    for (const cls of utilityClasses(file)) {
      const arbitrary = /^\[transition(?:-property)?:(.+)\]$/.exec(cls.value)
      if (arbitrary) {
        for (const property of transitionProperties(arbitrary[1])) {
          sites.push({
            file: file.rel,
            line: cls.line,
            origin: 'tsx:className [transition:…]',
            text: cls.value,
            property,
          })
        }
        continue
      }
      const tw = tailwindTransitionProperties(cls.value)
      if (tw) {
        for (const property of tw) {
          sites.push({
            file: file.rel,
            line: cls.line,
            origin: `tsx:className ${cls.value}`,
            text: cls.value,
            property,
          })
        }
      }
    }

    /* style={{ transition: "transform 100ms linear" }} */
    for (const site of inlineStyleTransitions(file)) {
      for (const property of transitionProperties(site.text)) {
        sites.push({ ...site, property })
      }
    }

    /* motion: animate={{ opacity: 1, y: 0 }} */
    for (const site of motionAnimatedKeys(file)) {
      sites.push({ ...site, property: site.text })
    }
  }

  return sites
}

export function motionViolations(): Violation[] {
  const out: Violation[] = []
  const seen = new Set<string>()
  for (const site of animatedSites()) {
    const verdict: MotionVerdict = checkAnimatedProperty(site.property)
    if (verdict.ok) continue
    const id = `animates:${site.file}:${verdict.property}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push(
      violation({
        id,
        file: site.file,
        line: site.line,
        origin: site.origin,
        detail: `${verdict.reason}  →  ${site.text}`,
      }),
    )
  }
  return out
}

/* =============================================================================
   4. prefers-reduced-motion — toda animação com contrapartida
   ========================================================================== */

/**
 * Um `@media (prefers-reduced-motion: reduce)` que zera `animation`/`transition`
 * no seletor universal cobre TODO o CSS carregado, inclusive o de outros
 * arquivos. Se existir um desses, o eixo CSS está resolvido e o guarda passa a
 * cobrar apenas o que a media query não alcança: o movimento em JS.
 */
export function hasGlobalReducedMotionReset(): { found: boolean; where: string | null } {
  for (const css of cssFiles()) {
    for (const block of css.blocks) {
      const inReduced = [...block.ancestors, block.prelude].some((p) =>
        /prefers-reduced-motion\s*:\s*reduce/i.test(p),
      )
      if (!inReduced) continue
      const universal = splitTopLevel(block.prelude).some((s) =>
        /^\*(\s*::?[\w-]+)?$/.test(s.trim()),
      )
      if (!universal) continue
      const killsAnimation = block.declarations.some((d) =>
        /^(animation|animation-duration|animation-iteration-count|animation-name)$/.test(d.prop),
      )
      const killsTransition = block.declarations.some((d) =>
        /^(transition|transition-duration|transition-property)$/.test(d.prop),
      )
      if (killsAnimation && killsTransition) {
        return { found: true, where: `${block.file}:${block.line}` }
      }
    }
  }
  return { found: false, where: null }
}

/** Seletores citados dentro de um bloco `prefers-reduced-motion: reduce`. */
export function reducedMotionSelectors(): Set<string> {
  const out = new Set<string>()
  for (const css of cssFiles()) {
    for (const block of css.blocks) {
      const inReduced = [...block.ancestors, block.prelude].some((p) =>
        /prefers-reduced-motion\s*:\s*reduce/i.test(p),
      )
      if (!inReduced) continue
      for (const sel of splitTopLevel(block.prelude)) out.add(sel.trim())
    }
  }
  return out
}

/** Regras CSS que declaram animação/transição, com o seletor onde vivem. */
export function cssAnimatedRules(): { file: string; line: number; selector: string; prop: string }[] {
  const out: { file: string; line: number; selector: string; prop: string }[] = []
  for (const css of cssFiles()) {
    for (const decl of css.declarations) {
      if (!/^(animation|transition)(-(name|property|duration))?$/.test(decl.prop)) continue
      if (decl.atRules.some((r) => /prefers-reduced-motion/i.test(r))) continue
      if (decl.atRules.some((r) => keyframesName(r) !== null)) continue
      if (/^(none|0s?|0ms)$/i.test(decl.value.trim())) continue
      out.push({ file: decl.file, line: decl.line, selector: decl.selector, prop: decl.prop })
    }
  }
  return out
}

/**
 * Componentes que animam em JS. `prefers-reduced-motion` no CSS não os alcança:
 * o motion escreve style inline a cada quadro e ganha da media query. Ou o
 * componente consulta a preferência, ou a árvore está dentro de um
 * `<MotionConfig reducedMotion="user">`.
 */
export const REDUCED_MOTION_HOOKS = [
  'usePrefersReducedMotion',
  'useTransitionPreset',
  'useMotionPreferences',
  'noMotion',
  'MotionConfig',
] as const

export function jsMotionWithoutReducedMotion(): Violation[] {
  const out: Violation[] = []
  for (const file of tsxFiles()) {
    const src = stripTsComments(file.text)
    const importsMotion = /from\s+["']motion(\/react)?["']/.test(src)
    if (!importsMotion) continue
    const animates =
      /<motion\.[a-zA-Z]/.test(src) ||
      new RegExp(`\\b(${['animate', 'initial', 'exit', 'whileHover', 'whileTap', 'whileDrag'].join('|')})\\s*=\\s*\\{`).test(
        src,
      )
    if (!animates) continue
    const guarded = REDUCED_MOTION_HOOKS.some((hook) =>
      new RegExp(`\\b${hook}\\b`).test(src),
    )
    if (guarded) continue
    out.push(
      violation({
        id: `js-motion-unguarded:${file.rel}`,
        file: file.rel,
        line: lineOf(file.text, src.search(/<motion\./)),
        origin: 'tsx:motion',
        detail:
          `anima com \`motion\` e não consulta ${REDUCED_MOTION_HOOKS.slice(0, 3).join('/')}. ` +
          `O @media (prefers-reduced-motion) do CSS não alcança style inline do motion — ` +
          `quem pediu menos movimento continua recebendo o percurso inteiro.`,
      }),
    )
  }
  return out
}

export { formatSite }
