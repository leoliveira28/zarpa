/**
 * Pranchas — desenho de linha, Papel e Pedra.
 *
 * Gramática compartilhada por prancha botânica e desenho técnico:
 * traço de espessura constante, sem sombra, sem preenchimento, sem cor.
 * É o que faz as duas coisas envelhecerem bem — não há moda numa linha de 1px.
 *
 * REGRAS (CLAUDE.md > Regras de interface):
 *  - monocromático em `currentColor`; quem pinta é o container, com `--plate`.
 *    NUNCA no accent: o azul é reservado para dizer onde clicar.
 *  - `vector-effect: non-scaling-stroke` para o traço não engordar no retina.
 *  - no máximo UMA prancha por tela.
 *  - desenho original. Nunca prancha histórica escaneada — o que queremos é a
 *    gramática, não o acervo de outra pessoa.
 *  - decorativa por padrão (`aria-hidden`). Passe `title` só quando a prancha
 *    carregar informação que o texto ao redor não dá.
 */

type PlateProps = {
  /** Lado do quadrado em px. Padrão 160. */
  size?: number
  /** Descrição acessível. Sem isto a prancha é decorativa e fica escondida do leitor de tela. */
  title?: string
  className?: string
}

function frame({ size = 160, title, className }: PlateProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 160 160',
    className,
    ...(title
      ? { role: 'img' as const, 'aria-label': title }
      : { 'aria-hidden': true as const, focusable: 'false' as const }),
  }
}

/** Traço principal. `currentColor` — o container define a cor. */
const ink = {
  stroke: 'currentColor',
  fill: 'none',
  strokeWidth: 1.15,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  vectorEffect: 'non-scaling-stroke' as const,
}

/** Traço secundário: círculo de construção, cota, marca de eixo. */
const hair = {
  stroke: 'currentColor',
  fill: 'none',
  strokeWidth: 0.6,
  opacity: 0.65,
  vectorEffect: 'non-scaling-stroke' as const,
}

/**
 * Fig. III — fronde de samambaia.
 * Uso: estado vazio. É a prancha mais "viva" das três, e por isso a mais
 * discreta — entra a 12–16% de opacidade.
 */
export function FernPlate(props: PlateProps) {
  return (
    <svg {...frame(props)}>
      <path {...ink} d="M80 152 C 80 120, 80 82, 80 20" />
      <g {...ink}>
        <path d="M80 34 C 64 26, 50 28, 40 38 C 52 47, 68 45, 80 34Z" />
        <path d="M80 34 C 96 26, 110 28, 120 38 C 108 47, 92 45, 80 34Z" />
        <path d="M80 56 C 62 47, 46 49, 35 60 C 48 70, 66 68, 80 56Z" />
        <path d="M80 56 C 98 47, 114 49, 125 60 C 112 70, 94 68, 80 56Z" />
        <path d="M80 80 C 61 70, 44 73, 33 85 C 47 95, 65 93, 80 80Z" />
        <path d="M80 80 C 99 70, 116 73, 127 85 C 113 95, 95 93, 80 80Z" />
        <path d="M80 105 C 63 96, 48 99, 38 109 C 51 118, 67 116, 80 105Z" />
        <path d="M80 105 C 97 96, 112 99, 122 109 C 109 118, 93 116, 80 105Z" />
        <path d="M80 127 C 67 120, 55 122, 47 130 C 57 137, 70 135, 80 127Z" />
        <path d="M80 127 C 93 120, 105 122, 113 130 C 103 137, 90 135, 80 127Z" />
      </g>
      <circle cx="80" cy="18" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * Fig. IV — arco de volta plena, com cotas.
 * Uso: divisor de seção na proposta pública. É a peça que carrega o parentesco
 * com a arquitetura antiga sem virar cenário.
 */
export function ArchPlate(props: PlateProps) {
  return (
    <svg {...frame(props)}>
      <path
        stroke="currentColor"
        fill="none"
        strokeWidth={0.55}
        strokeDasharray="3 3"
        opacity={0.5}
        vectorEffect="non-scaling-stroke"
        d="M28 140 L 28 22 M132 140 L 132 22 M20 78 L 140 78"
      />
      <path {...ink} d="M40 140 L 40 78 A 40 40 0 0 1 120 78 L 120 140" />
      <path {...ink} d="M32 140 L 128 140 L 128 148 L 32 148 Z" />
      <path {...hair} d="M40 70 L 32 70 M120 70 L 128 70" />
      {/* pedra angular */}
      <path {...ink} d="M74 40 L 86 40 L 89 55 L 71 55 Z" />
      <path {...hair} d="M55 46 L 62 60 M105 46 L 98 60" />
    </svg>
  )
}

/**
 * Fig. V — rosa dos ventos.
 * Uso: marca e tela de entrada. É a única prancha que pode aparecer sozinha,
 * sem texto ao redor.
 */
export function CompassPlate(props: PlateProps) {
  return (
    <svg {...frame(props)}>
      <circle {...hair} cx="80" cy="80" r="58" />
      <circle {...hair} cx="80" cy="80" r="44" />
      <path {...ink} d="M80 22 L 90 70 L 80 80 L 70 70 Z" />
      <path {...ink} d="M80 138 L 70 90 L 80 80 L 90 90 Z" />
      <path {...ink} d="M22 80 L 70 70 L 80 80 L 70 90 Z" />
      <path {...ink} d="M138 80 L 90 90 L 80 80 L 90 70 Z" />
      <path {...hair} d="M39 39 L 76 76 M121 39 L 84 76 M39 121 L 76 84 M121 121 L 84 84" />
      <circle cx="80" cy="80" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * Fig. VI — biplano de células (motivo 14-bis).
 * Uso hoje: capa da proposta pública, como marca d'água quando a proposta
 * não tem foto de capa (`PublicProposalScreen`). Fica disponível também para
 * um estado vazio futuro sobre PARTIR (proposta enviada, viagem) — não a
 * usei ali agora para não abrir mão da `FernPlate` sem um pedido específico.
 * Traço técnico — a estrutura de célula (dois retângulos abertos ligados por
 * um chassi que afunila) é a mesma gramática de cota/eixo do `ArchPlate`,
 * não um desenho de avião "bonitinho": o 14-bis e a Demoiselle eram, na
 * prática, pipas de caixa empilhadas, e é essa geometria — não uma silhueta
 * pintada — que faz o traço único funcionar aqui. Original: nenhuma prancha
 * histórica foi decalcada. Nunca no accent. No máximo uma prancha por tela.
 */
export function BiplanePlate(props: PlateProps) {
  return (
    <svg {...frame(props)}>
      {/* célula dianteira — o canard, o profundor que ia na frente */}
      <path {...ink} d="M10 60 L 40 60 L 40 98 L 10 98 Z" />
      <path {...hair} d="M10 60 L 40 98 M40 60 L 10 98" />

      {/* chassi — afunila da célula dianteira até a célula principal, onde
          morava o motor e a cadeira do piloto */}
      <path {...ink} d="M40 60 L 100 32 M40 98 L 100 100" />
      <path {...hair} d="M40 98 L 100 32" />

      {/* cesto do piloto, pendurado no chassi */}
      <path {...ink} d="M58 99 L 60 114 L 82 114 L 84 99" />

      {/* hélice, no meio do chassi */}
      <circle {...hair} cx="70" cy="76" r="7" />
      <path {...ink} d="M70 69 L 70 83 M63 76 L 77 76" />

      {/* célula principal — o par de asas em caixa, mais alta que a
          dianteira: é o que lê como "subindo" sem precisar girar o desenho */}
      <path {...ink} d="M100 32 L 148 32 L 148 100 L 100 100 Z" />
      <path {...ink} d="M124 32 L 124 100" />
      <path {...hair} d="M100 32 L 148 100 M148 32 L 100 100" />

      {/* o ponto de partida, mesma gramática do ponto de eixo das outras
          pranchas — aqui, o bico do canard */}
      <circle cx="10" cy="79" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * Fio — a cornija. Separa registros; não envolve caixa.
 *
 * -----------------------------------------------------------------------------
 * ONDE O TRAÇO PODE E ONDE NÃO PODE (a regra vale para o sistema inteiro, e é a
 * primeira coisa que se quebra sem perceber):
 *
 *   PODE, na horizontal, separando dois registros:
 *     cabeçalho de card / corpo / rodapé, linha de lista, cabeçalho de tabela,
 *     título de seção e o que vem depois dele.
 *
 *   PODE, nos quatro lados, em duas famílias e só nelas:
 *     1. CONTROLE — campo, select, checkbox, botão secundário. Um campo é uma
 *        caixa que aceita entrada: sem contorno ele deixa de anunciar que é
 *        clicável, e a borda ali é affordance, não moldura.
 *     2. CAMADA FLUTUANTE — diálogo, sheet, painel de select/combobox/menu,
 *        tooltip, toast. Elas não estão SOBRE o papel, estão ACIMA dele, e no
 *        tema escuro a sombra sozinha não define aresta nenhuma.
 *
 *   NÃO PODE, nunca:
 *     em volta de conteúdo que mora na página — card, estado vazio, tabela,
 *     coluna de kanban, bloco de resumo. Ali quem separa é o papel (superfície
 *     + raio + sombra curta) e o fio na horizontal.
 * -----------------------------------------------------------------------------
 *
 * `animate` desenha da esquerda para a direita em 240ms via scaleX: é o único
 * ornamento animado permitido no sistema, e some com prefers-reduced-motion.
 * `inner` é o fio mais fraco, para separar itens do MESMO registro (linhas de
 * uma lista dentro de um card).
 *
 * `loose` dá 16px de cima e de baixo (`--space-4`) ao fio. Existe porque todo
 * "título + fio" que NÃO mora dentro de `CardHeader`/`CardFooter` — onde a
 * banda ao redor já reserva a distância — vinha inventando seu próprio
 * `mt-2`/`pt-3` na mão, tela a tela, quase sempre curto demais (8px de um
 * lado, zero do outro: a cornija ficava colada no título ou no que vinha
 * OK depois dela). Um lugar só, para não precisar decidir de novo em cada
 * tela: `SectionHeading`, o total do funil e o rodapé de opção/termos da
 * proposta pública usam esta variante.
 */
export function Rule({
  animate = false,
  inner = false,
  loose = false,
  className = '',
}: {
  animate?: boolean
  inner?: boolean
  loose?: boolean
  className?: string
}) {
  return (
    <hr
      aria-hidden
      className={[
        'plate-rule',
        inner ? 'plate-rule--inner' : '',
        loose ? 'plate-rule--loose' : '',
        animate ? 'plate-rule--draw' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    />
  )
}
