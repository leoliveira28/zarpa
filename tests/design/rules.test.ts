/**
 * "Guarda que não sabe acusar é pior que guarda nenhum" (rules.ts). Este
 * arquivo prova que cada regra pega exatamente o caso que ela existe para
 * pegar — e que não acusa o que é legítimo. Sem isto, um refactor em rules.ts
 * pode silenciosamente parar de detectar Georgia e ninguém notaria: os testes
 * de `collect.test.ts`/`guards.test.ts` só rodam contra o código real de
 * `src/**`, que pode simplesmente não conter mais nenhum caso daquele dia.
 */
import { describe, expect, it } from 'vitest'
import {
  ANIMATABLE,
  checkAnimatedProperty,
  checkFontStack,
  DISCRETE_PROPS,
  isColorValue,
  isFontToken,
  LAYOUT_PROPS,
  MOTION_TRANSFORM_ALIASES,
  tailwindTransitionProperties,
  transitionProperties,
} from './rules'

describe('checkFontStack — nenhuma serifa, nenhuma Inter/Space Grotesk', () => {
  it.each([
    ['Georgia, serif', 'Georgia'],
    ['"Times New Roman", serif', 'Times New Roman'],
    ['Playfair Display', 'Playfair Display'],
    ['Bodoni MT', 'Bodoni'],
    ['ui-serif', 'ui-serif'],
    ['Garamond', 'Garamond'],
  ])('acusa serifada: %s', (value) => {
    const v = checkFontStack(value)
    expect(v.ok, `esperava reprovar "${value}"`).toBe(false)
  })

  it.each(['Inter', 'Inter Tight', '"Inter Display", sans-serif', 'Space Grotesk', 'space-grotesk'])(
    'acusa proibida por nome: %s',
    (value) => {
      const v = checkFontStack(value)
      expect(v.ok, `esperava reprovar "${value}"`).toBe(false)
      if (!v.ok) expect(v.reason).toMatch(/proibida por nome/)
    },
  )

  it('acusa a genérica "serif" sozinha', () => {
    const v = checkFontStack('serif')
    expect(v.ok).toBe(false)
  })

  it.each([
    'Libre Franklin, system-ui, sans-serif',
    'system-ui, sans-serif',
    'var(--stack-display)',
    'sans-serif',
    '',
    '  ',
  ])('aceita pilha limpa: %s', (value) => {
    expect(checkFontStack(value).ok).toBe(true)
  })

  it('não confunde substring: "interval" não é "Inter"', () => {
    expect(checkFontStack('IntervalSans, system-ui').ok).toBe(true)
  })

  it('não confunde substring: "ui-sans-serif" não é a genérica "serif"', () => {
    expect(checkFontStack('ui-sans-serif').ok).toBe(true)
  })

  it('pega Georgia mesmo com hífen/underscore no lugar de espaço (Tailwind arbitrário)', () => {
    expect(checkFontStack('Times_New_Roman').ok).toBe(false)
  })
})

describe('isFontToken', () => {
  it.each(['--font-display', '--stack-display', '--type-family', '--typeface-body'])(
    'reconhece token de tipografia: %s',
    (name) => {
      expect(isFontToken(name)).toBe(true)
    },
  )
  it.each(['--color-accent', '--space-4', '--border-subtle', 'font-family'])(
    'não confunde com token comum ou propriedade normal: %s',
    (name) => {
      expect(isFontToken(name)).toBe(false)
    },
  )
})

describe('isColorValue', () => {
  it.each(['#12557F', '#fff', 'rgba(0,0,0,.5)', 'oklch(0.6 0.1 250)', 'var(--z-gray-500)', 'red', 'navy'])(
    'reconhece cor: %s',
    (value) => {
      expect(isColorValue(value)).toBe(true)
    },
  )
  it.each(['transparent', 'inherit', 'initial', 'unset', 'none', 'currentColor', '', '  ', 'var(--space-4)'])(
    'não confunde não-cor: %s',
    (value) => {
      expect(isColorValue(value)).toBe(false)
    },
  )
})

describe('checkAnimatedProperty — só transform e opacity', () => {
  it.each(['transform', 'opacity'])('aceita direto: %s', (p) => {
    expect(checkAnimatedProperty(p)).toEqual({ ok: true })
  })

  it.each([...MOTION_TRANSFORM_ALIASES])('aceita alias de transform do motion: %s', (p) => {
    expect(checkAnimatedProperty(p).ok).toBe(true)
  })

  it.each([...DISCRETE_PROPS])('aceita discreta (sem percurso): %s', (p) => {
    expect(checkAnimatedProperty(p).ok).toBe(true)
  })

  it.each([...LAYOUT_PROPS])('reprova propriedade de LAYOUT sem perdão: %s', (p) => {
    const v = checkAnimatedProperty(p)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.severity).toBe('layout')
  })

  it.each(['color', 'background-color', 'border-color', 'box-shadow', 'fill', 'stroke'])(
    'reprova pintura como "paint" (registrável em deviations.ts): %s',
    (p) => {
      const v = checkAnimatedProperty(p)
      expect(v.ok).toBe(false)
      if (!v.ok) expect(v.severity).toBe('paint')
    },
  )

  it('reprova "all" como layout — não é desviável', () => {
    const v = checkAnimatedProperty('all')
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.severity).toBe('layout')
  })

  it('string vazia é inerte, não violação', () => {
    expect(checkAnimatedProperty('').ok).toBe(true)
  })
})

describe('ANIMATABLE não vaza para LAYOUT_PROPS nem DISCRETE_PROPS', () => {
  it('os três conjuntos não se sobrepõem', () => {
    for (const p of ANIMATABLE) {
      expect(LAYOUT_PROPS.has(p), `${p} está em ANIMATABLE e LAYOUT_PROPS`).toBe(false)
      expect(DISCRETE_PROPS.has(p), `${p} está em ANIMATABLE e DISCRETE_PROPS`).toBe(false)
    }
    for (const p of LAYOUT_PROPS) {
      expect(DISCRETE_PROPS.has(p), `${p} está em LAYOUT_PROPS e DISCRETE_PROPS`).toBe(false)
    }
  })
})

describe('transitionProperties — extrai nome de propriedade, ignora tempo/curva', () => {
  it('shorthand com tempo, curva e var()', () => {
    expect(transitionProperties('border-color 120ms var(--curve-out), opacity 1s ease-in-out')).toEqual([
      'border-color',
      'opacity',
    ])
  })

  it('valor arbitrário do Tailwind com underscore como espaço', () => {
    expect(transitionProperties('background-color_120ms_var(--curve-out)')).toEqual(['background-color'])
  })

  it('transition-property: lista simples de nomes', () => {
    expect(transitionProperties('transform, box-shadow')).toEqual(['transform', 'box-shadow'])
  })

  it('ignora "all" isolado quando é palavra de curva/tempo composta? não — "all" é nome de propriedade', () => {
    // "all" É um nome de propriedade válido de transition-property; quem
    // decide se é aceitável é checkAnimatedProperty, não o extrator.
    expect(transitionProperties('all 200ms')).toEqual(['all'])
  })

  it('string vazia não produz propriedade', () => {
    expect(transitionProperties('')).toEqual([])
  })
})

describe('tailwindTransitionProperties — mapeamento de utilitária bare para propriedades reais', () => {
  it('transition-colors expande para o conjunto de 6', () => {
    expect(tailwindTransitionProperties('transition-colors')).toEqual([
      'color',
      'background-color',
      'border-color',
      'text-decoration-color',
      'fill',
      'stroke',
    ])
  })

  it('transition-all é "all" — sempre reprovável', () => {
    expect(tailwindTransitionProperties('transition-all')).toEqual(['all'])
  })

  it('transition-transform e transition-opacity são as únicas limpas', () => {
    expect(tailwindTransitionProperties('transition-transform')).toEqual(['transform'])
    expect(tailwindTransitionProperties('transition-opacity')).toEqual(['opacity'])
  })

  it('tira variante (hover:, dark:) antes de casar o nome', () => {
    expect(tailwindTransitionProperties('hover:transition-colors')).toEqual(
      tailwindTransitionProperties('transition-colors'),
    )
  })

  it('utilitária desconhecida devolve null, não [] — "não sei" != "nada anima"', () => {
    expect(tailwindTransitionProperties('transition-inexistente')).toBeNull()
    expect(tailwindTransitionProperties('bg-accent')).toBeNull()
  })
})
