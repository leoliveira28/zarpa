/**
 * O registro de desvios (`deviations.ts`) só continua honesto se ele próprio
 * for testado — do contrário vira uma lista que só cresce, porque ninguém é
 * cobrado a tirar dali o que já foi corrigido. Duas garantias:
 *
 *   1. Entrada morta quebra o CI: se `id` não corresponde a nenhuma violação
 *      viva hoje em `src/**`, o registro está mentindo sobre o que tolera.
 *   2. Toda entrada tem dono e motivo não vazios, e nenhuma tolera algo que
 *      força LAYOUT — essa classe não é desviável por desenho (rules.ts).
 *
 * Isto SÓ audita o registro contra o código real. Se um dia sobrar violação
 * não registrada, quem acusa é `guards.test.ts` — aqui não.
 */
import { describe, expect, it } from 'vitest'
import {
  colorContextViolations,
  jsMotionWithoutReducedMotion,
  motionViolations,
  themeParityViolations,
  typographyViolations,
} from './collect'
import { DEVIATIONS } from './deviations'
import { checkAnimatedProperty } from './rules'

function allLiveViolationIds(): Set<string> {
  return new Set(
    [
      ...typographyViolations(),
      ...colorContextViolations(),
      ...themeParityViolations(),
      ...motionViolations(),
      ...jsMotionWithoutReducedMotion(),
    ].map((v) => v.id),
  )
}

describe('registro de desvios — tests/design/deviations.ts', () => {
  it('não tem id duplicado (duplicata mascara a segunda entrada)', () => {
    const ids = DEVIATIONS.map((d) => d.id)
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
    expect(dupes, `id(s) repetido(s): ${[...new Set(dupes)].join(', ')}`).toEqual([])
  })

  it('toda entrada tem owner e reason não vazios', () => {
    const bad = DEVIATIONS.filter((d) => d.owner.trim() === '' || d.reason.trim() === '')
    expect(bad.map((d) => d.id), 'entrada sem dono ou sem motivo não pode existir').toEqual([])
  })

  it('nenhuma entrada tolera propriedade de LAYOUT (não é desviável por desenho)', () => {
    const bad = DEVIATIONS.filter((d) => {
      const m = /^animates:.+:([^:]+)$/.exec(d.id)
      if (!m) return false
      const verdict = checkAnimatedProperty(m[1])
      return !verdict.ok && verdict.severity === 'layout'
    })
    expect(
      bad.map((d) => d.id),
      'CLAUDE.md > Movimento: propriedade de layout não tem exceção — reescreva com transform.',
    ).toEqual([])
  })

  it('toda entrada corresponde a uma violação viva em src/** hoje (nenhuma entrada morta)', () => {
    const live = allLiveViolationIds()
    const stale = DEVIATIONS.filter((d) => !live.has(d.id))
    expect(
      stale.map((d) => `${d.id} (dono: ${d.owner})`),
      'entrada registrada mas sem violação correspondente — o código já não faz mais isso. ' +
        'Remova a entrada de deviations.ts (o guarda ficou mais rígido de graça).',
    ).toEqual([])
  })
})
