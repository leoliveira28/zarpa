/**
 * Smoke de acessibilidade do /kitchen-sink (rota da Nina, critério da S2).
 *
 * Três coisas, nesta ordem de importância:
 *   1. foco por teclado VISÍVEL em todo elemento interativo
 *   2. contraste mínimo (regra color-contrast do axe, WCAG AA)
 *   3. nenhuma violação de impacto crítico do axe
 *
 * Usa `axe-core` injetado direto na página. `@axe-core/playwright` não está
 * instalado e não precisa estar: ele é um wrapper fino em cima disso.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'

const require = createRequire(import.meta.url)

const ROUTE = '/kitchen-sink'

type AxeNode = { html: string; target: string[]; failureSummary?: string }
type AxeViolation = {
  id: string
  impact: 'minor' | 'moderate' | 'serious' | 'critical' | null
  help: string
  helpUrl: string
  nodes: AxeNode[]
}
type AxeResults = { violations: AxeViolation[] }

function axeSource(): string {
  try {
    return readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
  } catch {
    throw new Error(
      'axe-core não encontrado em node_modules. Hoje ele entra por transitividade ' +
        '(eslint-plugin-jsx-a11y). Pedido para virar devDependency direta em ' +
        'docs/handoffs/teo-para-po.md.',
    )
  }
}

async function runAxe(page: Page): Promise<AxeResults> {
  await page.evaluate(axeSource())
  return page.evaluate(async () => {
    // @ts-expect-error axe é injetado em runtime
    return (await window.axe.run(document, {
      resultTypes: ['violations'],
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    })) as AxeResults
  })
}

function formatViolations(violations: AxeViolation[]): string {
  return violations
    .map(
      (v) =>
        `  [${v.impact ?? 'sem impacto'}] ${v.id}: ${v.help}\n` +
        v.nodes
          .slice(0, 5)
          .map((n) => `      ${n.target.join(' ')} → ${n.html.slice(0, 120)}`)
          .join('\n') +
        `\n      ${v.helpUrl}`,
    )
    .join('\n')
}

test.describe('/kitchen-sink — acessibilidade', () => {
  test.beforeEach(async ({ page }) => {
    const response = await page.goto(ROUTE, { waitUntil: 'networkidle' })
    expect(
      response?.status(),
      `${ROUTE} não respondeu 200. A rota é da Nina (critério de aceite da S2). ` +
        `Enquanto ela não existir, este teste fica vermelho de propósito.`,
    ).toBe(200)
  })

  test('todo elemento interativo mostra foco visível pelo teclado', async ({ page }) => {
    const SELECTOR = [
      'a[href]',
      'button',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      '[tabindex]:not([tabindex="-1"])',
      '[role="button"]',
      '[role="link"]',
      '[role="tab"]',
      '[role="checkbox"]',
      '[role="switch"]',
      '[role="menuitem"]',
    ].join(', ')

    const offenders = await page.evaluate((selector) => {
      const relevant = ['outline', 'outlineWidth', 'outlineStyle', 'outlineColor', 'boxShadow', 'borderColor', 'backgroundColor', 'color', 'textDecoration'] as const

      const snapshot = (el: Element): string => {
        const cs = getComputedStyle(el)
        const pseudo = getComputedStyle(el, '::after').boxShadow + getComputedStyle(el, '::before').outline
        return relevant.map((k) => cs[k as keyof CSSStyleDeclaration] as string).join('|') + '|' + pseudo
      }

      const bad: { html: string; reason: string }[] = []
      const els = Array.from(document.querySelectorAll(selector)) as HTMLElement[]

      for (const el of els) {
        const rect = el.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) continue // invisível, não é foco de teclado
        if (el.hasAttribute('disabled')) continue
        if (el.getAttribute('aria-hidden') === 'true') continue

        const before = snapshot(el)
        el.focus()
        if (document.activeElement !== el) {
          bad.push({ html: el.outerHTML.slice(0, 120), reason: 'não recebe foco por .focus()' })
          continue
        }
        const after = snapshot(el)
        el.blur()

        if (before === after) {
          bad.push({
            html: el.outerHTML.slice(0, 120),
            reason: 'nenhuma mudança visual no foco (sem outline, box-shadow ou borda)',
          })
        }
      }
      return bad
    }, SELECTOR)

    expect(
      offenders,
      `elementos interativos sem indicador de foco visível:\n` +
        offenders.map((o) => `  - ${o.reason}\n      ${o.html}`).join('\n') +
        `\nRegra: quem navega por teclado precisa saber onde está. Dono: Nina.`,
    ).toEqual([])
  })

  test('a ordem de tabulação percorre os elementos interativos', async ({ page }) => {
    // Foco preso ou pulando é tão ruim quanto foco invisível.
    const visited = new Set<string>()
    let previous = ''
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      const current = await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return ''
        return `${el.tagName}#${el.id}.${el.className}`.slice(0, 100)
      })
      if (current === '') break
      if (current === previous) {
        expect(current, `Tab ficou preso em ${current} (foco não avança)`).toBe('')
      }
      visited.add(current)
      previous = current
    }
    expect(visited.size, 'Tab não alcançou nenhum elemento interativo em /kitchen-sink').toBeGreaterThan(0)
  })

  test('contraste mínimo (WCAG AA)', async ({ page }) => {
    const results = await runAxe(page)
    const contrast = results.violations.filter((v) => v.id === 'color-contrast')
    expect(contrast, `violações de contraste:\n${formatViolations(contrast)}`).toEqual([])
  })

  test('nenhuma violação de impacto crítico do axe', async ({ page }) => {
    const results = await runAxe(page)
    const critical = results.violations.filter((v) => v.impact === 'critical')
    const serious = results.violations.filter((v) => v.impact === 'serious')

    if (serious.length > 0) {
      // Sério não derruba o build hoje, mas aparece na saída. Cobertura calada
      // é cobertura falsa.
      console.log(`[a11y] violações "serious" (não bloqueiam):\n${formatViolations(serious)}`)
    }

    expect(critical, `violações críticas:\n${formatViolations(critical)}`).toEqual([])
  })
})
