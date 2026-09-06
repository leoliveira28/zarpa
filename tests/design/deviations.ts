/**
 * Registro de desvios da direção visual.
 *
 * Por que existe: um guarda que fica vermelho no dia em que nasce, sem que
 * ninguém possa consertar o código naquele dia, é um guarda que alguém desliga
 * na sexta-feira. E guarda desligado é pior que guarda inexistente, porque
 * deixa a marca de cobertura sem a cobertura.
 *
 * O que ele NÃO é: uma forma de baixar a régua. Três coisas garantem isso:
 *
 *   1. Toda entrada tem dono e motivo escritos. Não existe tolerância anônima.
 *   2. Entrada morta quebra o CI (`tests/design/deviations.test.ts`). No dia em
 *      que o código para de violar, o registro tem que encolher — senão a
 *      próxima violação igual entra de graça.
 *   3. Nada que force LAYOUT é registrável (`rules.ts` > LAYOUT_PROPS). Animar
 *      `width` não tem exceção: o caminho é reescrever com `transform`.
 *
 * O `id` vem de `collect.ts` e é estável. Se mudar, o teste de entrada morta
 * grita — de propósito.
 */

export type Deviation = {
  id: string
  owner: string
  /** Por que é tolerado HOJE, e o que faria a entrada sair daqui. */
  reason: string
}

export const DEVIATIONS: readonly Deviation[] = [
  /* ---------------------------------------------------------------------
     Transição de cor a 120ms nos controles.
     Está em toda a camada de UI da Nina, sempre no mesmo tempo e na mesma
     curva (`--curve-out`). Isso é sistema, não descuido. Cor cruzando não é
     movimento: nada muda de lugar, nada relayouta.

     Continua registrado, e não removido do guarda, porque a decisão é de
     direção e não minha: o CLAUDE.md diz "Só transform e opacity animam" sem
     ressalva. Pedido de decisão em docs/handoffs/teo-para-po.md.
     --------------------------------------------------------------------- */
  ...(
    [
      ['src/components/ui/Button.tsx', ['background-color', 'border-color']],
      // Card.tsx tem DOIS pontos de transição: a linha 65 (registrada abaixo,
      // por conta própria, porque é débito de verdade) e a 203, que é
      // `transition-colors` — a mesma utilitária bare do Tabs/AppShell/
      // ThemeToggle, e portanto expande para o mesmo conjunto de 6
      // propriedades. Registrar só `border-color` aqui era gap de cadastro,
      // não decisão: as outras 5 já eram produzidas pelo guarda e ficavam
      // QUEBRA (não DESVIO) até este achado — ver docs/status/teo.md.
      ['src/components/ui/Card.tsx', ['color', 'background-color', 'border-color', 'text-decoration-color', 'fill', 'stroke']],
      ['src/components/ui/Input.tsx', ['border-color', 'background-color']],
      ['src/components/ui/Select.tsx', ['border-color', 'background-color']],
      ['src/components/ui/Checkbox.tsx', ['background-color', 'border-color']],
      ['src/components/ui/Combobox.tsx', ['border-color']],
      ['src/components/ui/Tabs.tsx', ['color', 'background-color', 'border-color', 'text-decoration-color', 'fill', 'stroke']],
      ['src/components/app/AppShell.tsx', ['color', 'background-color', 'border-color', 'text-decoration-color', 'fill', 'stroke']],
      ['src/components/app/ThemeToggle.tsx', ['color', 'background-color', 'border-color', 'text-decoration-color', 'fill', 'stroke']],
      ['src/app/(app)/funil/FunnelScreen.tsx', ['background-color']],
    ] as const
  ).flatMap(([file, props]) =>
    props.map((prop) => ({
      id: `animates:${file}:${prop}`,
      owner: 'Nina',
      reason:
        'cross-fade de cor a 120ms, padrão em toda a camada de controles. Não move ' +
        'nem relayouta. Sai daqui quando o PO decidir se a regra "só transform e ' +
        'opacity" cobre cor (handoff teo-para-po, item 1).',
    })),
  ),

  /* ---------------------------------------------------------------------
     Card interativo animando box-shadow.
     Este NÃO é cor: box-shadow repinta a caixa inteira a cada quadro, e o
     card é o elemento que a agente arrasta no funil, no celular. É débito de
     verdade, com correção conhecida.
     --------------------------------------------------------------------- */
  {
    id: 'animates:src/components/ui/Card.tsx:box-shadow',
    owner: 'Nina',
    reason:
      'box-shadow repinta a caixa a cada quadro, e o Card é o elemento arrastado do ' +
      'funil. Correção: sombra num ::after e animar a opacidade dele. ' +
      'Reprodução em docs/handoffs/teo-para-nina.md, item 1.',
  },

  /* ---------------------------------------------------------------------
     Tique do checkbox por stroke-dashoffset.
     Propriedade de SVG: não causa layout nem repaint de página, e é o único
     jeito de desenhar um traço progressivo sem trocar o path.
     --------------------------------------------------------------------- */
  {
    id: 'animates:src/app/globals.css:stroke-dashoffset',
    owner: 'Nina',
    reason:
      'traço do tique do Checkbox. stroke-dashoffset é composto no SVG, não causa ' +
      'layout. Alternativa (trocar o path) é pior. Tolerado por desenho, não por dívida.',
  },

  /* ---------------------------------------------------------------------
     Rótulo de "Salvo/Salvando" com transition-opacity.
     `transition-opacity` já é só opacity — entra aqui só porque a utilitária
     bare do Tailwind é expandida pelo guarda. Se aparecer, é falso positivo do
     próprio guarda e a entrada morta vai acusar.
     --------------------------------------------------------------------- */
] as const

const INDEX = new Set(DEVIATIONS.map((d) => d.id))

export const isDeviation = (id: string): boolean => INDEX.has(id)

export const deviationFor = (id: string): Deviation | undefined =>
  DEVIATIONS.find((d) => d.id === id)
