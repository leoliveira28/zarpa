/**
 * Relatório legível dos guardas de direção visual.
 *
 * Os testes em `tests/design/*.test.ts` respondem sim/não. Este script responde
 * "o quê e onde", incluindo o que hoje está tolerado pelo registro de desvios —
 * que o teste, por definição, não mostra. É o caminho curto entre "mexi no
 * componente" e "quebrei a direção?".
 *
 *   npx tsx scripts/check/design-report.ts
 *
 * Sai 0 sempre: é relatório, não portão. O portão é o vitest.
 */
import {
  colorContextViolations,
  cssAnimatedRules,
  hasGlobalReducedMotionReset,
  jsMotionWithoutReducedMotion,
  motionViolations,
  themeParityViolations,
  typographyViolations,
  type Violation,
} from '../../tests/design/collect'
import { DEVIATIONS, isDeviation } from '../../tests/design/deviations'

const RESET = '\x1b[0m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'

function section(title: string, violations: Violation[]): void {
  console.log(`\n${BOLD}── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}${RESET}`)
  const blocking = violations.filter((v) => !isDeviation(v.id))
  const tolerated = violations.filter((v) => isDeviation(v.id))

  if (blocking.length === 0) {
    console.log(`  ${GREEN}limpo${RESET}`)
  }
  for (const v of blocking) {
    console.log(`  ${RED}QUEBRA${RESET}  ${v.message}`)
  }
  for (const v of tolerated) {
    const d = DEVIATIONS.find((x) => x.id === v.id)
    console.log(`  ${YELLOW}DESVIO${RESET}  ${v.message}`)
    console.log(`          ${DIM}registrado · dono: ${d?.owner} · ${d?.reason}${RESET}`)
  }
}

function main(): void {
  console.log(`\n${BOLD}Guardas de direção — "Papel e Pedra"${RESET}`)

  section('tipografia (nenhuma serifa, nenhuma Inter/Space Grotesk)', typographyViolations())
  section('cor (nenhuma definição única em @media ou [data-theme])', [
    ...colorContextViolations(),
    ...themeParityViolations(),
  ])
  section('movimento (só transform e opacity animam)', motionViolations())
  section('reduced-motion em movimento de JS', jsMotionWithoutReducedMotion())

  const reset = hasGlobalReducedMotionReset()
  console.log(`\n${BOLD}── reduced-motion no CSS ${'─'.repeat(37)}${RESET}`)
  console.log(
    reset.found
      ? `  ${GREEN}corte global${RESET} em ${reset.where} — cobre todo o CSS carregado`
      : `  ${RED}sem corte global${RESET}: cada regra animada precisa de contrapartida própria`,
  )
  console.log(`  ${DIM}${cssAnimatedRules().length} regra(s) CSS declaram animation/transition${RESET}`)

  const stale = DEVIATIONS.filter((d) => {
    const all = [
      ...typographyViolations(),
      ...colorContextViolations(),
      ...themeParityViolations(),
      ...motionViolations(),
      ...jsMotionWithoutReducedMotion(),
    ]
    return !all.some((v) => v.id === d.id)
  })
  console.log(`\n${BOLD}── registro de desvios ${'─'.repeat(39)}${RESET}`)
  console.log(`  ${DEVIATIONS.length} entrada(s); ${stale.length} sem violação correspondente`)
  for (const d of stale) console.log(`  ${YELLOW}MORTA${RESET}  ${d.id} — pode sair do registro`)
  console.log('')
}

main()
