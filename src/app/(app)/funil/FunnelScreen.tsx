"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { motion, type PanInfo } from "motion/react";
import { cn } from "@/lib/ui/cn";
import { formatDayMonthUTC } from "@/lib/ui/format";
import {
  projectThrow,
  springLayout,
  usePrefersReducedMotion,
} from "@/lib/ui/motion";
import {
  PROPOSALS,
  STAGES,
  sumCents,
  travelDate,
  type Proposal,
  type Stage,
} from "@/lib/ui/sample-data";
import { Badge } from "@/components/ui/Badge";
import { Money } from "@/components/ui/Money";
import { Rule } from "@/components/plates";
import { useToast } from "@/components/ui/Toast";
import { CheckIcon, ClockIcon, OpenedIcon } from "@/components/app/icons";

/* =============================================================================
   Funil — quadro de cinco estágios
   -----------------------------------------------------------------------------
   v2. Especificação em docs/design/funil-v2.md — parte do diagnóstico de que a
   v1 (docs/design/funil.md) tirou a borda dos quatro lados certo, mas não pôs
   nada no lugar: cinco listas de texto flutuando no papel, sem raia visível, o
   arrasto sem alvo. O que muda aqui:

   1. A RAIA É UM CAMPO PREENCHIDO, DO TOPO À BASE DA COLUNA — sempre, não só
      enquanto um card está no ar. `bg-inset` é o papel rebaixado (um passo
      abaixo de `--bg`, corrigido em tokens.css — antes era idêntico a --bg e
      não aparecia); a section ocupa 100% da altura da célula do grid, então o
      preenchimento vai até o rodapé da janela mesmo com zero ou um card. É a
      correção direta de "a coluna perdeu identidade" e "mais vazio, não
      menos". Sem raio de canto: a raia é estrutura reta; o card é que vira
      objeto (raio + sombra) quando levantado.

   2. NO DESKTOP O QUADRO OCUPA A JANELA. A rota está em `WIDE_ROUTES` no
      AppShell: sai do `max-w-[64rem]` (medida de linha, e o funil não é
      leitura) e ganha altura de viewport. Quem rola é o CORPO DE CADA COLUNA,
      não a página. No celular continua o scroller com encaixe, mesma tela em
      dois registros.

   3. CABEÇALHO DE PÁGINA VOLTA A SER SÓ O TÍTULO — do mesmo tamanho das outras
      telas, sem subtítulo de instrução permanente. O total "Em aberto" desceu
      para dentro do quadro (linha única, colada à cornija que sublinha os
      cinco cabeçalhos de coluna) — antes ficava solto no canto da página,
      desconectado do que soma. A instrução de gesto virou dica de primeiro
      uso, some depois do primeiro arrasto ou do primeiro uso do menu.

   4. "FECHADA" LÊ DIFERENTE: soma em tinta de estado (`tone="ok"`, verde —
      licenciado pelo CLAUDE.md como estado, não marca), um símbolo de
      checagem ao lado do rótulo, e os cards de lá não mostram sinal de
      abertura/estagnação — venda fechada não é algo a monitorar.

   5. O SELO DE ABERTURA PAROU DE USAR O ACCENT. Era a única cor "clicável" da
      tela usada como status, competindo com "onde clicar" — agora é neutro. O
      accent só aparece em controle real.

   O que NÃO mudou, porque já estava certo: card e card se separam por um fio
   interno; card levantado ganha papel, raio e sombra de arraste; o card herda
   a velocidade do gesto — onde ele cai é onde ele PARARIA se continuasse
   desacelerando, `(v/1000) * d/(1-d)`, d = 0.998 (src/lib/ui/motion.ts) — e
   arrastar nunca é o único caminho: o menu de estágio continua operável por
   teclado.
   ========================================================================== */

/** Teto de largura do valor de um card. Mantém a coluna de dígitos alinhada. */
const CARD_MONEY_CEILING = 5_940_000;

/** Piso do teto de largura das somas de coluna (R$ 100.000,00). */
const COLUMN_MONEY_FLOOR = 10_000_000;

/** Estágio terminal — soma em tinta de estado, sem sinal de estagnação no card. */
const CLOSED_STAGE: Stage = "fechada";

const HINT_SEEN_KEY = "zarpa.funil.hintSeen";

function subscribeToHintSeen(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function readHintSeen(): boolean {
  try {
    return window.localStorage.getItem(HINT_SEEN_KEY) === "1";
  } catch {
    return false; // navegação privada: a dica reaparece toda vez. Não é erro.
  }
}

/**
 * A dica de gesto é de primeiro uso, não subtítulo de página (a v1 errou
 * nisto: ocupava ~24px do cabeçalho toda vez que a agente abria a tela, a
 * quinquagésima vez incluída). `useSyncExternalStore` — não `useEffect` +
 * `setState` — para ler o localStorage: o snapshot do servidor é sempre
 * "não vista" (bate com o HTML do servidor, sem flash), e o do cliente lê o
 * valor real sem precisar corrigir depois de montar.
 */
function useDragHint(): [boolean, () => void] {
  const seen = React.useSyncExternalStore(
    subscribeToHintSeen,
    readHintSeen,
    () => false,
  );

  const dismiss = React.useCallback(() => {
    try {
      window.localStorage.setItem(HINT_SEEN_KEY, "1");
    } catch {
      // idem — só não persiste entre sessões.
    }
    // "storage" só dispara nativamente em OUTRAS abas; dispara aqui também
    // para este componente reler o snapshot e esconder a dica na hora.
    window.dispatchEvent(new Event("storage"));
  }, []);

  return [seen, dismiss];
}

export function FunnelScreen() {
  const toast = useToast();
  const reducedMotion = usePrefersReducedMotion();
  const [items, setItems] = React.useState<Proposal[]>(PROPOSALS);
  const [dragging, setDragging] = React.useState<string | null>(null);
  /* O card levantado é desenhado FORA da raia, num sobrevoo preso à viewport.
     Sem isto ele fica preso a dois cercos: o `overflow-y-auto` da pilha o
     RECORTA, e o `z-index` só vale dentro do contexto de empilhamento da
     própria raia — as raias seguintes têm fundo opaco e pintam por cima. Era
     isso o "card passando por baixo da coluna". */
  const [lift, setLift] = React.useState<{
    proposal: Proposal;
    width: number;
    dx: number;
    dy: number;
    x: number;
    y: number;
  } | null>(null);
  const [target, setTarget] = React.useState<Stage | null>(null);
  const [hintSeen, dismissHint] = useDragHint();

  const columnRefs = React.useRef(new Map<Stage, HTMLElement>());

  const registerColumn = React.useCallback(
    (stage: Stage) => (node: HTMLElement | null) => {
      if (node) columnRefs.current.set(stage, node);
      else columnRefs.current.delete(stage);
    },
    [],
  );

  /** Qual coluna contém (ou está mais perto de) uma coordenada X da viewport. */
  const columnAtX = React.useCallback((x: number): Stage | null => {
    let best: { stage: Stage; distance: number } | null = null;
    for (const [stage, node] of columnRefs.current) {
      const rect = node.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right) return stage;
      const center = rect.left + rect.width / 2;
      const distance = Math.abs(center - x);
      if (!best || distance < best.distance) best = { stage, distance };
    }
    return best?.stage ?? null;
  }, []);

  const columns = React.useMemo(
    () =>
      STAGES.map((stage) => {
        const cards = items.filter((item) => item.stage === stage.id);
        return { ...stage, cards, cents: sumCents(cards) };
      }),
    [items],
  );

  // Uma reserva de largura para as cinco somas: o alinhamento entre colunas é
  // o que transforma cinco números em uma comparação.
  const columnCeiling = Math.max(
    COLUMN_MONEY_FLOOR,
    ...columns.map((column) => column.cents),
  );

  const openCents = React.useMemo(
    () => sumCents(items.filter((item) => item.stage !== CLOSED_STAGE)),
    [items],
  );

  function moveTo(proposal: Proposal, stage: Stage, viaGesture: boolean) {
    if (stage === proposal.stage) return;
    dismissHint();
    const previousStage = proposal.stage;
    const previousIdle = proposal.idleDays;
    setItems((current) =>
      current.map((item) =>
        item.id === proposal.id ? { ...item, stage, idleDays: 0 } : item,
      ),
    );
    const label = STAGES.find((s) => s.id === stage)?.label ?? stage;
    toast.undo(
      `${proposal.client} → ${label}`,
      () =>
        setItems((current) =>
          current.map((item) =>
            item.id === proposal.id
              ? { ...item, stage: previousStage, idleDays: previousIdle }
              : item,
          ),
        ),
      {
        description: viaGesture ? undefined : "Movida pelo menu do card",
        tone: "ok",
      },
    );
  }

  /** Onde o card PARARIA — não onde o dedo está agora. */
  function projectedStage(info: PanInfo): Stage | null {
    return columnAtX(info.point.x + projectThrow(info.velocity.x));
  }

  function handleDragEnd(proposal: Proposal, info: PanInfo) {
    setDragging(null);
    setLift(null);
    setTarget(null);
    const stage = projectedStage(info);
    if (stage) moveTo(proposal, stage, true);
  }

  return (
    <div className="flex flex-col gap-3 lg:h-full lg:min-h-0">
      {/* cabeçalho de PÁGINA: só o título, do mesmo tamanho das outras telas.
          Nem subtítulo de instrução, nem total — os dois comiam altura do
          quadro na v1, e nenhum dos dois é conteúdo da página: são conteúdo
          do quadro (abaixo). */}
      <header className="lg:shrink-0">
        <h2 className="text-32 font-semibold text-ink">Funil</h2>
      </header>

      {/* faixa do QUADRO: o total "Em aberto" mora aqui, não na página — é o
          que o conecta ao que ele soma, em vez de flutuar solto num canto. A
          cornija por baixo dela é a mesma que sublinha os cinco cabeçalhos de
          coluna: o total e as colunas são uma coisa só. */}
      <div className="lg:shrink-0">
        <div className="flex items-baseline justify-between gap-3">
          <p
            aria-hidden={hintSeen}
            className={cn(
              "text-13 text-subtle [transition:opacity_120ms_var(--curve-out)]",
              hintSeen && "pointer-events-none opacity-0",
            )}
          >
            Arraste o card — ele segue a velocidade do gesto. Ou use o menu do
            card.
          </p>
          <div className="ml-auto flex items-baseline gap-2">
            <span className="shrink-0 text-13 text-muted">Em aberto</span>
            <Money
              cents={openCents}
              size="17"
              reserveFor={30_000_000}
              align="left"
            />
          </div>
        </div>
        <Rule className="mt-2" />
      </div>

      {/* celular: um scroller com encaixe por coluna, o polegar manda.
          desktop: cinco colunas de altura cheia. A largura mínima de 11rem é o
          que impede a coluna de virar tira ilegível: abaixo dela o QUADRO rola
          na horizontal em vez de espremer. As cinco cabem inteiras a partir de
          1280px, que é o laptop mais comum — abaixo disso o quadro rola, e a
          coluna continua legível. */}
      <div
        className={cn(
          "-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2",
          "sm:-mx-6 sm:px-6",
          "[scrollbar-width:thin]",
          "lg:mx-0 lg:min-h-0 lg:flex-1 lg:snap-none lg:px-0 lg:pb-0",
          "lg:grid lg:grid-cols-[repeat(5,minmax(11rem,1fr))] lg:overflow-y-hidden",
          "2xl:gap-6",
        )}
      >
        {columns.map((column, columnIndex) => {
          const active = dragging !== null && target === column.id;
          const closed = column.id === CLOSED_STAGE;
          return (
            <section
              key={column.id}
              ref={registerColumn(column.id)}
              aria-label={column.label}
              className={cn(
                "flex w-[78vw] shrink-0 snap-start flex-col",
                "sm:w-[20rem] lg:w-auto lg:min-h-0",
                // a raia é um campo preenchido do topo à base, sempre — não só
                // enquanto um card está no ar. Cantos retos de propósito: a
                // raia é estrutura; o card é que vira objeto (raio + sombra)
                // quando levantado. `bg-inset` é o papel rebaixado (um passo
                // abaixo de `--bg`, tokens.css); alvo de solta aprofunda mais
                // um passo, sem cor.
                "bg-inset [transition:background-color_120ms_var(--curve-out)]",
                active && "bg-surface-3",
                // reforço de grade: um fio vertical no meio da goteira larga
                // (2xl, 24px) — a goteira de 16px já basta sozinha, um fio ali
                // tocaria as duas raias.
                columnIndex > 0 && "2xl:border-l 2xl:border-hairline",
              )}
            >
              <header className="flex shrink-0 flex-col gap-1 px-3 pt-2 pb-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="flex min-w-0 items-center gap-1 truncate text-13 font-semibold tracking-[0.04em] text-muted uppercase">
                    {column.label}
                    {closed ? (
                      <CheckIcon className="size-3 shrink-0 text-ok" />
                    ) : null}
                  </h3>
                  <span
                    data-numeric
                    className="shrink-0 text-13 tabular-nums text-subtle"
                    title={column.hint}
                  >
                    {column.cards.length}
                  </span>
                </div>
                <Money
                  cents={column.cents}
                  size="17"
                  tone={closed ? "ok" : "default"}
                  reserveFor={columnCeiling}
                  align="left"
                />
              </header>

              {/* a cornija: fecha o cabeçalho e abre a pilha. Enquanto um card
                  está no ar, o fio da coluna alvo escurece e engrossa — por
                  scaleY, que não relayouta. Sem azul: o azul diz onde clicar,
                  e aqui não se clica, se solta. */}
              <Rule
                className={cn(
                  "mx-3 origin-bottom [transition:transform_120ms_var(--curve-out)]",
                  active && "scale-y-[2] bg-plate",
                )}
              />

              <div
                className={cn(
                  "flex flex-col",
                  "lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain",
                  "[scrollbar-width:thin]",
                )}
              >
                {column.cards.length === 0 ? (
                  <p className="px-3 py-4 text-13 text-subtle">{column.hint}</p>
                ) : (
                  column.cards.map((proposal, index) => (
                    <React.Fragment key={proposal.id}>
                      {index > 0 ? <Rule inner className="mx-3" /> : null}
                      <FunnelCard
                        proposal={proposal}
                        dragging={dragging === proposal.id}
                        hideSignal={closed}
                        reducedMotion={reducedMotion}
                        onDragStart={(rect, point) => {
                          setDragging(proposal.id);
                          setLift({
                            proposal,
                            width: rect.width,
                            dx: point.x - rect.left,
                            dy: point.y - rect.top,
                            x: point.x,
                            y: point.y,
                          });
                        }}
                        onDrag={(info) => {
                          const stage = projectedStage(info);
                          setTarget((current) =>
                            current === stage ? current : stage,
                          );
                          setLift((current) =>
                            current
                              ? { ...current, x: info.point.x, y: info.point.y }
                              : current,
                          );
                        }}
                        onDragEnd={(info) => handleDragEnd(proposal, info)}
                        onMove={(stage) => moveTo(proposal, stage, false)}
                      />
                    </React.Fragment>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* Sobrevoo: fora de toda raia, preso à viewport, acima de tudo. É a
          mesma marcação do card — levantado ele vira objeto (papel, raio,
          sombra); pousado volta a ser linha de lista. `pointer-events-none`
          para não roubar o alvo de solta de baixo dele. */}
      {lift
        ? createPortal(
            <div
              aria-hidden
              className="pointer-events-none fixed left-0 top-0 z-[100] will-change-transform"
              style={{
                width: lift.width,
                transform: `translate3d(${lift.x - lift.dx}px, ${lift.y - lift.dy}px, 0) scale(1.03)`,
                transformOrigin: "top left",
              }}
            >
              <div className="rounded-lg bg-surface px-3 py-3 shadow-drag">
                <CardBody proposal={lift.proposal} hideSignal={false} inert />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/* ------------------------------------------------------------------- o card */

/**
 * Três linhas, e a hierarquia é de peso e espaço — não de caixa:
 *
 *   cliente                                    ⋯
 *   destino                               6 nov
 *   R$ 12.840,00                       há 1 d  ◦6
 *
 * Cinco informações num registro que continua respirando. O valor fica na
 * mesma coluna de dígitos em todos os cards (largura reservada), então a
 * leitura vertical de uma coluna inteira é um movimento só de olho.
 */
function FunnelCard({
  proposal,
  dragging,
  hideSignal = false,
  reducedMotion,
  onDragStart,
  onDrag,
  onDragEnd,
  onMove,
}: {
  proposal: Proposal;
  dragging: boolean;
  /** Fechada não é estado a monitorar: sem sinal de abertura/estagnação. */
  hideSignal?: boolean;
  reducedMotion: boolean;
  onDragStart: (rect: DOMRect, point: { x: number; y: number }) => void;
  onDrag: (info: PanInfo) => void;
  onDragEnd: (info: PanInfo) => void;
  onMove: (stage: Stage) => void;
}) {
  const ref = React.useRef<HTMLElement>(null);

  return (
    <motion.article
      ref={ref}
      layout={!reducedMotion}
      layoutId={reducedMotion ? undefined : proposal.id}
      transition={springLayout}
      drag
      dragSnapToOrigin
      dragElastic={0.25}
      dragMomentum={false}
      onDragStart={(_, info) => {
        const rect = ref.current?.getBoundingClientRect();
        if (rect) onDragStart(rect, info.point);
      }}
      onDrag={(_, info) => onDrag(info)}
      onDragEnd={(_, info) => onDragEnd(info)}
      className={cn(
        "group/card relative cursor-grab touch-none px-3 py-3",
        "active:cursor-grabbing",
        // Enquanto levantado, este elemento continua sendo a SUPERFICIE que
        // recebe o gesto — mas quem aparece é o sobrevoo, no topo do body. Aqui
        // fica o vazio que guarda o lugar, para a coluna nao colapsar de altura
        // e as outras linhas nao pularem.
        dragging && "opacity-0",
      )}
    >
      <CardBody
        proposal={proposal}
        hideSignal={hideSignal}
        menu={<StageMenu proposal={proposal} onMove={onMove} />}
      />
    </motion.article>
  );
}

/**
 * O desenho do card, sem o gesto. Existe separado porque o MESMO desenho
 * precisa ser pintado em dois lugares: na pilha da raia e no sobrevoo preso à
 * viewport. Duas marcações divergiriam no primeiro ajuste.
 */
function CardBody({
  proposal,
  hideSignal,
  menu,
  inert = false,
}: {
  proposal: Proposal;
  hideSignal: boolean;
  menu?: React.ReactNode;
  /** No sobrevoo não há menu: o card está no ar, não há o que clicar. */
  inert?: boolean;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-1">
        <p className="min-w-0 flex-1 truncate text-15 font-medium text-ink">
          {proposal.client}
        </p>
        {inert ? <span className="w-7 shrink-0" aria-hidden /> : menu}
      </div>

      <div className="mt-0.5 flex items-baseline justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-13 text-muted">
          {proposal.destination}
        </p>
        <TravelDate proposal={proposal} />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <Money
          cents={proposal.cents}
          size="15"
          reserveFor={CARD_MONEY_CEILING}
          align="left"
        />
        {hideSignal ? null : <Signal proposal={proposal} />}
      </div>
    </>
  );
}

/**
 * Data da viagem. Formatada em UTC de propósito: servidor e navegador estão em
 * fusos diferentes, e `getDate()` local faria os dois renderizarem dias
 * diferentes no mesmo instante — hydration mismatch, e o texto PISCA. Aqui a
 * conta é a mesma nos dois lados.
 */
function TravelDate({ proposal }: { proposal: Proposal }) {
  return (
    <span data-numeric className="shrink-0 text-13 tabular-nums text-subtle">
      <span className="sr-only">viagem em </span>
      {formatDayMonthUTC(travelDate(proposal))}
    </span>
  );
}

/**
 * UM sinal por card, à direita do valor, nesta ordem de prioridade:
 *
 *   1. o cliente abriu o link  — é o evento central do produto
 *   2. parada há mais de 7 dias — é o dinheiro escorrendo pelo ralo
 *   3. há quantos dias está parada, em texto simples
 *
 * Um card nunca mostra dois. A versão anterior desta linha mostrava o texto
 * "12 d" ao lado de um chip "⏱ 12d" — a mesma informação duas vezes, e o
 * conjunto estourava a largura da coluna. Numa coluna de dez cards, dois chips
 * por card viram renda: a tela fica cheia de cor e vazia de hierarquia.
 *
 * O ícone faz o papel do ponto do Badge (cor não é informação acessível), por
 * isso `dot` fica de fora: ponto + ícone + número são três marcas para um fato.
 *
 * `tone="neutral"`, não `accent`: abriu o link é status, não é "onde clicar" —
 * accent usado como rótulo de card era a única cor da tela competindo com a
 * própria regra de uma cor só (CLAUDE.md: "se o azul aparecer duas vezes na
 * mesma tela, uma das duas está errada"; aqui ele aparecia uma vez por card).
 */
function Signal({ proposal }: { proposal: Proposal }) {
  if (proposal.opens > 0) {
    return (
      <Badge tone="neutral" className="shrink-0">
        <OpenedIcon className="size-3" />
        <span className="tabular-nums">{proposal.opens}</span>
        <span className="sr-only">
          {proposal.opens === 1 ? "abertura" : "aberturas"}
        </span>
      </Badge>
    );
  }
  if (proposal.idleDays > 7) {
    return (
      <Badge tone="warn" className="shrink-0">
        <ClockIcon className="size-3" />
        <span className="tabular-nums">{proposal.idleDays} d</span>
        <span className="sr-only">parada</span>
      </Badge>
    );
  }
  if (proposal.idleDays === 0) {
    return <span className="shrink-0 text-13 text-subtle">hoje</span>;
  }
  return (
    <span data-numeric className="shrink-0 text-13 tabular-nums text-subtle">
      <span className="sr-only">parada há </span>
      {proposal.idleDays} d
    </span>
  );
}

/* --------------------------------------------------------- caminho de teclado */

/** Caminho de teclado para a mesma ação do arrasto. */
function StageMenu({
  proposal,
  onMove,
}: {
  proposal: Proposal;
  onMove: (stage: Stage) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Mover ${proposal.client} de estágio`}
        className={cn(
          "-mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-sm",
          "text-muted hover:bg-surface-3 hover:text-ink",
          // some no repouso do ponteiro fino e volta no hover, no foco e
          // enquanto o menu está aberto. Em ponteiro grosso não há hover:
          // lá ele fica sempre visível, senão vira ação inalcançável.
          "opacity-0 [transition:opacity_120ms_var(--curve-out)]",
          "group-hover/card:opacity-100 focus-visible:opacity-100",
          "data-[state=open]:opacity-100",
          "[@media(pointer:coarse)]:opacity-100",
        )}
      >
        <svg
          viewBox="0 0 16 16"
          className="size-4"
          fill="currentColor"
          aria-hidden
        >
          <circle cx="8" cy="3.5" r="1.15" />
          <circle cx="8" cy="8" r="1.15" />
          <circle cx="8" cy="12.5" r="1.15" />
        </svg>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="zk-pop z-50 min-w-48 rounded-lg border border-line bg-surface p-1 shadow-3"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-13 font-semibold tracking-[0.04em] text-muted uppercase">
            Mover para
          </DropdownMenu.Label>
          {STAGES.map((stage) => (
            <DropdownMenu.Item
              key={stage.id}
              disabled={stage.id === proposal.stage}
              onSelect={() => onMove(stage.id)}
              className={cn(
                "flex min-h-9 cursor-pointer items-center rounded-md px-2 text-15 text-ink outline-none",
                "data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent-soft-ink",
                "data-[disabled]:pointer-events-none data-[disabled]:text-subtle",
                "[@media(pointer:coarse)]:min-h-11",
              )}
            >
              {stage.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
