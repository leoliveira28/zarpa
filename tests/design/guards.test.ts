/**
 * O PORTÃO. Diferente de `deviations.test.ts` (audita o registro) e de
 * `rules.test.ts`/`css.test.ts` (auditam a lógica), este arquivo é o que
 * efetivamente falha o CI quando `src/**` foge da direção "Papel e Pedra"
 * sem que ninguém tenha decidido tolerar.
 *
 * Contrato de cada bloco: TODA violação crua (`collect.ts`) que não está no
 * registro (`deviations.ts`) reprova. O que está registrado passa — com
 * dono e motivo visíveis em `deviations.test.ts`, não aqui.
 */
import { describe, expect, it } from 'vitest'
import {
  colorContextViolations,
  cssAnimatedRules,
  hasGlobalReducedMotionReset,
  jsMotionWithoutReducedMotion,
  motionViolations,
  reducedMotionSelectors,
  themeParityViolations,
  typographyViolations,
  type Violation,
} from './collect'
import { isDeviation } from './deviations'

function blocking(violations: Violation[]): Violation[] {
  return violations.filter((v) => !isDeviation(v.id))
}

function reportOf(violations: Violation[]): string {
  return violations
    .map((v) => `  ${v.message}\n    → registre em tests/design/deviations.ts (com dono e motivo) ou corrija.`)
    .join('\n')
}

describe('guarda de direção visual — "Papel e Pedra" (src/**)', () => {
  it('tipografia: nenhuma serifa, nenhuma Inter, nenhuma Space Grotesk fora do registro', () => {
    const offenders = blocking(typographyViolations())
    expect(offenders, `\n${reportOf(offenders)}`).toEqual([])
  })

  it('cor: nenhum token ou regra com definição única em @media/[data-theme]', () => {
    const offenders = blocking(colorContextViolations())
    expect(offenders, `\n${reportOf(offenders)}`).toEqual([])
  })

  it('cor: os dois blocos de tema escuro (@media e [data-theme="dark"]) redefinem o mesmo conjunto de tokens', () => {
    const offenders = blocking(themeParityViolations())
    expect(offenders, `\n${reportOf(offenders)}`).toEqual([])
  })

  it('movimento: só transform e opacity animam, fora do registro', () => {
    const offenders = blocking(motionViolations())
    expect(offenders, `\n${reportOf(offenders)}`).toEqual([])
  })

  it('movimento em JS (motion): todo componente que anima consulta reduced-motion', () => {
    const offenders = blocking(jsMotionWithoutReducedMotion())
    expect(offenders, `\n${reportOf(offenders)}`).toEqual([])
  })

  it('prefers-reduced-motion: existe corte global, OU toda regra animada em CSS tem contrapartida', () => {
    const reset = hasGlobalReducedMotionReset()
    if (reset.found) {
      // Corte universal (* { animation: none; transition: none } dentro do
      // media query) cobre todo o CSS carregado — nada mais a checar.
      expect(reset.found).toBe(true)
      return
    }
    const covered = reducedMotionSelectors()
    const uncovered = cssAnimatedRules().filter((r) => !covered.has(r.selector))
    expect(
      uncovered.map((r) => `${r.file}:${r.line}  ${r.selector} { ${r.prop} }  — sem bloco @media (prefers-reduced-motion: reduce) próprio nem corte global`),
    ).toEqual([])
  })
})
