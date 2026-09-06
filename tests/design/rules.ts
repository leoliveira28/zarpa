/**
 * As regras da direção "Papel e Pedra" em forma executável.
 *
 * Uma regra aqui é uma função pura de (sítio) -> (violação | nada). Os testes
 * em `tests/design/*.test.ts` só coletam sítios, chamam estas funções e
 * formatam. Separado assim porque a lógica precisa de teste próprio: um guarda
 * que não sabe acusar é pior que guarda nenhum (dá a sensação de cobertura sem
 * a cobertura). `tests/design/rules.test.ts` prova que cada regra pega o caso
 * que ela existe para pegar.
 */
import { splitTopLevel } from './css'

/* =============================================================================
   Tipografia
   ========================================================================== */

/**
 * Serifa genérica. `sans-serif` e `ui-serif` NÃO casam pela lookbehind do
 * hífen; `ui-serif` é serifa de verdade e entra na lista nomeada abaixo.
 */
const GENERIC_SERIF = /(?<![\w-])serif(?![\w-])/i

/** Serifadas e slab por nome. Lista curta e nomeada: falso positivo mata guarda. */
const SERIF_FAMILIES = [
  'ui-serif',
  'Georgia',
  'Times New Roman',
  'Times',
  'Bodoni',
  'Playfair',
  'Playfair Display',
  'Garamond',
  'EB Garamond',
  'Baskerville',
  'Libre Baskerville',
  'Didot',
  'Merriweather',
  'Lora',
  'PT Serif',
  'Source Serif',
  'Noto Serif',
  'DM Serif',
  'IBM Plex Serif',
  'Crimson',
  'Cormorant',
  'Spectral',
  'Tiempos',
  'Charter',
  'Palatino',
  'Book Antiqua',
  'Cambria',
  'Constantia',
  'Rockwell',
  'Zilla Slab',
  'Roboto Slab',
  'Bitter',
  'Arvo',
  'Domine',
  'Vollkorn',
] as const

/** Proibidas por nome no CLAUDE.md — não por serifa, por serem o clichê. */
const BANNED_SANS = ['Inter', 'Inter Tight', 'Inter Display', 'Space Grotesk'] as const

const nameRegex = (family: string): RegExp =>
  // `\\s+` (dois escapes) casaria uma barra invertida literal, não espaço —
  // nunca disparava, e "Times-New-Roman"/"space_grotesk" passavam batidos
  // sempre que o chamador não normalizasse antes (achado em rules.test.ts).
  new RegExp(`(?<![\\w-])${family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s_-]+')}(?![\\w-])`, 'i')

export type FontVerdict = { ok: true } | { ok: false; reason: string; matched: string }

/**
 * Um valor de pilha de fontes está limpo?
 * Aceita `var(--x)` sem inspecionar: a definição do token é ela própria um
 * sítio e será checada onde é declarada.
 */
export function checkFontStack(value: string): FontVerdict {
  const text = value.trim()
  if (text === '') return { ok: true }

  for (const family of BANNED_SANS) {
    if (nameRegex(family).test(text)) {
      return {
        ok: false,
        matched: family,
        reason: `"${family}" é proibida por nome no CLAUDE.md (Regras de interface > Proibido).`,
      }
    }
  }
  for (const family of SERIF_FAMILIES) {
    if (nameRegex(family).test(text)) {
      return {
        ok: false,
        matched: family,
        reason: `"${family}" é serifada/slab. "NENHUMA SERIFA no sistema, em nenhuma superfície."`,
      }
    }
  }
  // Genérica por último: `Georgia, serif` já foi pego pelo nome, com mensagem melhor.
  const generic = GENERIC_SERIF.exec(text)
  if (generic) {
    return {
      ok: false,
      matched: generic[0],
      reason: `família genérica "serif". "NENHUMA SERIFA no sistema, em nenhuma superfície."`,
    }
  }
  return { ok: true }
}

/** O nome de uma propriedade CSS custom carrega tipografia? */
export const isFontToken = (prop: string): boolean =>
  prop.startsWith('--') && /(^|-)(font|stack|family|typeface|type)(-|$)/i.test(prop)

/* =============================================================================
   Cor
   ========================================================================== */

const HEX = /#[0-9a-f]{3,8}(?![0-9a-z])/i
const COLOR_FN = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\s*\(/i
const NAMED = /(?<![\w-])(white|black|red|blue|green|gray|grey|silver|navy|teal|olive|maroon|purple|fuchsia|aqua|lime|yellow|orange)(?![\w-])/i
/** Rampa bruta de primitivos: `var(--z-gray-500)` é cor tanto quanto `#7c8b97`. */
const RAMP_VAR = /var\(\s*--z-[a-z]+-\d+/i

/** O valor desta declaração é uma cor? */
export function isColorValue(value: string): boolean {
  const v = value.trim()
  if (v === '' || /^(inherit|initial|unset|revert|none|transparent|currentcolor)$/i.test(v)) {
    return false
  }
  return HEX.test(v) || COLOR_FN.test(v) || RAMP_VAR.test(v) || NAMED.test(v)
}

/** Propriedades CSS normais (não-custom) que pintam cor. */
export const COLOR_PROPERTIES = new Set([
  'color',
  'background-color',
  'background',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'fill',
  'stroke',
  'caret-color',
  'text-decoration-color',
  'accent-color',
  'column-rule-color',
])

/* =============================================================================
   Movimento
   ========================================================================== */

/** Só estas duas animam. Regra literal do CLAUDE.md. */
export const ANIMATABLE = new Set(['transform', 'opacity'])

/**
 * Atalhos do motion que compilam para `transform`. Animar `x` É animar
 * transform — tratar como violação seria guarda que mente.
 */
export const MOTION_TRANSFORM_ALIASES = new Set([
  'x',
  'y',
  'z',
  'scale',
  'scaleX',
  'scaleY',
  'rotate',
  'rotateX',
  'rotateY',
  'rotateZ',
  'skew',
  'skewX',
  'skewY',
  'translateX',
  'translateY',
  'transformPerspective',
  'transformOrigin',
])

/**
 * Propriedades discretas: o motion/CSS troca o valor de uma vez, não há
 * percurso. Não são movimento e não entram na conta.
 */
export const DISCRETE_PROPS = new Set([
  'z-index',
  'zIndex',
  'pointer-events',
  'pointerEvents',
  'visibility',
  'display',
  'will-change',
  'willChange',
  'transform-origin',
  'transformOrigin',
  'content',
  'position',
  'overflow',
  'cursor',
  'none',
  'initial',
  'all-unset',
])

/**
 * Propriedades que forçam LAYOUT. Estas não têm perdão nem entrada em registro
 * de desvio: animar largura num app que o usuário abre quinze vezes por dia é
 * como o scroll fica serrilhado no celular dela. Se um dia forem necessárias,
 * o caminho é reescrever com transform, não abrir exceção.
 */
export const LAYOUT_PROPS = new Set([
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'inset-inline',
  'inset-block',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'font-size',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'border-width',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'flex',
  'flex-basis',
  'flex-grow',
  'flex-shrink',
  'gap',
  'row-gap',
  'column-gap',
  'grid-template-columns',
  'grid-template-rows',
  'order',
  'columns',
  'zoom',
  // camelCase, como aparecem no motion
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'borderWidth',
  'flexBasis',
  'gridTemplateColumns',
])

export type MotionVerdict =
  | { ok: true }
  | { ok: false; severity: 'layout' | 'paint'; property: string; reason: string }

/** Uma propriedade animada é aceitável? */
export function checkAnimatedProperty(rawProperty: string): MotionVerdict {
  const property = rawProperty.trim()
  if (property === '') return { ok: true }
  if (DISCRETE_PROPS.has(property)) return { ok: true }
  if (ANIMATABLE.has(property)) return { ok: true }
  if (MOTION_TRANSFORM_ALIASES.has(property)) return { ok: true }

  if (LAYOUT_PROPS.has(property)) {
    return {
      ok: false,
      severity: 'layout',
      property,
      reason:
        `"${property}" força layout a cada quadro. "Só transform e opacity animam" ` +
        `(CLAUDE.md > Movimento). Reescreva com transform — esta não é desviável.`,
    }
  }
  if (property === 'all') {
    return {
      ok: false,
      severity: 'layout',
      property,
      reason:
        `transition: all anima tudo que vier a existir na regra, inclusive layout. ` +
        `Nomeie as propriedades.`,
    }
  }
  return {
    ok: false,
    severity: 'paint',
    property,
    reason: `"${property}" não é transform nem opacity (CLAUDE.md > Movimento: "Só transform e opacity animam").`,
  }
}

/** Palavras que num valor de `transition` são tempo/curva, não propriedade. */
const NOT_A_PROPERTY =
  /^(\d|\.|-?\d)|^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|steps|cubic-bezier|var|infinite|alternate|alternate-reverse|reverse|normal|both|forwards|backwards|running|paused|allow-discrete|normal)$/i

/**
 * Extrai os nomes de propriedade de um valor de `transition` (shorthand ou
 * `transition-property`). `border-color 120ms var(--curve-out), opacity 1s`
 * -> ['border-color', 'opacity'].
 */
export function transitionProperties(value: string): string[] {
  const props: string[] = []
  for (const part of splitTopLevel(value)) {
    // Tailwind escreve espaço como `_` dentro de valor arbitrário.
    const normalized = part.replace(/_/g, ' ').trim()
    const first = normalized.split(/\s+/)[0]
    if (first === undefined || first === '') continue
    if (NOT_A_PROPERTY.test(first)) continue
    if (first.startsWith('var(')) continue
    props.push(first)
  }
  return props
}

/**
 * Propriedades por trás de uma utilitária `transition-*` do Tailwind.
 * Fonte: defaults do Tailwind v4 (`--default-transition-property`).
 */
export function tailwindTransitionProperties(utility: string): string[] | null {
  const name = utility.replace(/^[a-z-]*:/g, '') // tira variantes (hover:, dark:)
  switch (name) {
    case 'transition':
      return [
        'color',
        'background-color',
        'border-color',
        'text-decoration-color',
        'fill',
        'stroke',
        'opacity',
        'box-shadow',
        'transform',
        'filter',
        'backdrop-filter',
      ]
    case 'transition-all':
      return ['all']
    case 'transition-colors':
      return ['color', 'background-color', 'border-color', 'text-decoration-color', 'fill', 'stroke']
    case 'transition-opacity':
      return ['opacity']
    case 'transition-transform':
      return ['transform']
    case 'transition-shadow':
      return ['box-shadow']
    case 'transition-none':
      return []
    default:
      return null
  }
}
