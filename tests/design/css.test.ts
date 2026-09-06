/**
 * Testes do tokenizador de CSS (`css.ts`). Ele não é um parser completo —
 * mas o CONTEXTO que ele extrai (seletor efetivo, cadeia de at-rules, linha)
 * é exatamente o que `collect.ts` usa para decidir "essa cor só existe dentro
 * de @media?" ou "essa propriedade está dentro de @keyframes?". Um erro aqui
 * não quebra um teste com mensagem clara — ele faz o guarda de cor ou de
 * movimento deixar passar (ou acusar à toa) em silêncio.
 */
import { describe, expect, it } from 'vitest'
import {
  baseSelector,
  isMediaAtRule,
  keyframesName,
  mentionsDataTheme,
  parseCss,
  splitTopLevel,
  stripComments,
} from './css'

describe('stripComments', () => {
  it('vira espaço preservando quebras de linha (offset/linha intactos)', () => {
    const src = 'a {\n  /* x\n  y */\n  color: red;\n}'
    const out = stripComments(src)
    expect(out).not.toContain('/*')
    expect(out.split('\n').length).toBe(src.split('\n').length)
  })

  it('não apaga comentário dentro de string', () => {
    const src = `content: "/* não é comentário */";`
    expect(stripComments(src)).toContain('/* não é comentário */')
  })
})

describe('parseCss — contexto de seletor e at-rule', () => {
  it('declaração simples fora de qualquer at-rule tem atRules vazio', () => {
    const { declarations } = parseCss('a.css', ':root { --ink: #14181B; }')
    expect(declarations).toHaveLength(1)
    expect(declarations[0]).toMatchObject({ prop: '--ink', value: '#14181B', selector: ':root', atRules: [] })
  })

  it('declaração dentro de @media carrega o at-rule na cadeia', () => {
    const css = `@media (prefers-color-scheme: dark) {\n  :root { --ink: #F4F3F0; }\n}`
    const { declarations } = parseCss('a.css', css)
    expect(declarations[0].selector).toBe(':root')
    expect(declarations[0].atRules).toEqual(['@media (prefers-color-scheme: dark)'])
  })

  it('seletor efetivo é o mais interno que NÃO é at-rule, mesmo com at-rules aninhados', () => {
    const css = `@media (prefers-color-scheme: dark) {\n  @supports (color: oklch(0 0 0)) {\n    :root[data-theme="dark"] { --ink: #fff; }\n  }\n}`
    const { declarations } = parseCss('a.css', css)
    expect(declarations[0].selector).toBe(':root[data-theme="dark"]')
    expect(declarations[0].atRules).toEqual([
      '@media (prefers-color-scheme: dark)',
      '@supports (color: oklch(0 0 0))',
    ])
  })

  it('número da linha aponta a linha real da declaração, não do bloco', () => {
    const css = 'a {\n  color: red;\n  background: blue;\n}'
    const { declarations } = parseCss('a.css', css)
    expect(declarations[0].line).toBe(2)
    expect(declarations[1].line).toBe(3)
  })

  it('parênteses não fecham bloco: função CSS com vírgula/chave não existe, mas parens contam', () => {
    const css = ':root { --grad: linear-gradient(90deg, red, blue); }'
    const { declarations } = parseCss('a.css', css)
    expect(declarations).toHaveLength(1)
    expect(declarations[0].value).toBe('linear-gradient(90deg, red, blue)')
  })

  it('at-rule sem bloco (@import) não vira declaração nem quebra o parser', () => {
    const css = `@import "tokens.css";\n:root { --a: 1; }`
    const { declarations } = parseCss('a.css', css)
    expect(declarations).toHaveLength(1)
    expect(declarations[0].prop).toBe('--a')
  })

  it('@keyframes: cada passo vira um bloco cujo ancestral é o @keyframes', () => {
    const css = `@keyframes zk-tick {\n  0% { stroke-dashoffset: 12; }\n  100% { stroke-dashoffset: 0; }\n}`
    const { blocks } = parseCss('a.css', css)
    const steps = blocks.filter((b) => b.prelude !== '@keyframes zk-tick')
    expect(steps).toHaveLength(2)
    for (const step of steps) expect(step.ancestors).toContain('@keyframes zk-tick')
  })

  it('comentário entre declarações não vaza para prop/value', () => {
    const css = 'a {\n  color: red; /* nota */\n  background: blue;\n}'
    const { declarations } = parseCss('a.css', css)
    expect(declarations.map((d) => d.prop)).toEqual(['color', 'background'])
  })

  it('duas regras irmãs não compartilham cadeia de ancestrais', () => {
    const css = '.a { color: red; }\n.b { color: blue; }'
    const { declarations } = parseCss('a.css', css)
    expect(declarations[0].selector).toBe('.a')
    expect(declarations[1].selector).toBe('.b')
    expect(declarations[0].atRules).toEqual([])
  })
})

describe('splitTopLevel', () => {
  it('separa por vírgula ignorando vírgula dentro de parênteses', () => {
    expect(splitTopLevel('rgb(0, 0, 0), var(--a, 1)')).toEqual(['rgb(0, 0, 0)', 'var(--a, 1)'])
  })

  it('não separa vírgula dentro de string', () => {
    expect(splitTopLevel(`"a, b", c`)).toEqual(['"a, b"', 'c'])
  })

  it('separador customizado', () => {
    expect(splitTopLevel('a; b; c', ';')).toEqual(['a', 'b', 'c'])
  })

  it('string vazia não produz partes fantasmas', () => {
    expect(splitTopLevel('')).toEqual([])
  })
})

describe('keyframesName', () => {
  it('reconhece @keyframes simples e com vendor prefix', () => {
    expect(keyframesName('@keyframes zk-tick')).toBe('zk-tick')
    expect(keyframesName('@-webkit-keyframes zk-tick')).toBe('zk-tick')
  })
  it('tira aspas do nome', () => {
    expect(keyframesName('@keyframes "zk-tick"')).toBe('zk-tick')
  })
  it('devolve null para prelúdio que não é @keyframes', () => {
    expect(keyframesName('@media (min-width: 1px)')).toBeNull()
    expect(keyframesName(':root')).toBeNull()
  })
})

describe('isMediaAtRule', () => {
  it.each(['@media (min-width: 100px)', '@supports (display: grid)', '@container (min-width: 1px)'])(
    'reconhece: %s',
    (rule) => {
      expect(isMediaAtRule(rule)).toBe(true)
    },
  )
  it.each(['@keyframes x', '@font-face', ':root'])('não confunde: %s', (rule) => {
    expect(isMediaAtRule(rule)).toBe(false)
  })
})

describe('mentionsDataTheme', () => {
  it.each(['[data-theme="dark"]', ":root[data-theme='light']", '[data-theme~=dark]'])(
    'reconhece seletor com [data-theme]: %s',
    (sel) => {
      expect(mentionsDataTheme(sel)).toBe(true)
    },
  )
  it(':root puro não menciona tema', () => {
    expect(mentionsDataTheme(':root')).toBe(false)
  })
})

describe('baseSelector', () => {
  it('tira :not([data-theme="light"]) e mantém o resto', () => {
    expect(baseSelector(':root:not([data-theme="light"])')).toBe(':root')
  })
  it('tira [data-theme="dark"] direto', () => {
    expect(baseSelector(':root[data-theme="dark"]')).toBe(':root')
  })
  it('seletor sem qualificador de tema não muda', () => {
    expect(baseSelector(':root')).toBe(':root')
  })
})
