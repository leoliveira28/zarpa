"use client";

import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { motion, type PanInfo } from "motion/react";
import { cn } from "@/lib/ui/cn";
import { projectThrow, springLayout, usePrefersReducedMotion } from "@/lib/ui/motion";
import {
  PROPOSALS,
  STAGES,
  sumCents,
  type Proposal,
  type Stage,
} from "@/lib/ui/sample-data";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { useToast } from "@/components/ui/Toast";
import { ClockIcon, OpenedIcon } from "@/components/app/icons";

/* =============================================================================
   Funil
   -----------------------------------------------------------------------------
   Kanban de 5 estágios. O que importa aqui é UMA coisa:

   **o card herda a velocidade do gesto.** Onde ele cai não é onde o dedo
   soltou — é onde ele PARARIA se continuasse desacelerando. É a mesma projeção
   que o iOS usa pra decidir em que página um carrossel encaixa:
   `(v/1000) * d/(1-d)`, com d = 0.998 (src/lib/ui/motion.ts).

   Sem isso, um flick rápido e curto não move o card, e o gesto parece
   emperrado. Com isso, jogar o card pra direita funciona como jogar um objeto
   numa mesa.

   Arrastar não pode ser o ÚNICO caminho: cada card tem um menu de estágio,
   operável por teclado. Kanban só com mouse exclui gente do produto.
   ========================================================================== */

export function FunnelScreen() {
  const toast = useToast();
  const reducedMotion = usePrefersReducedMotion();
  const [items, setItems] = React.useState<Proposal[]>(PROPOSALS);
  const [dragging, setDragging] = React.useState<string | null>(null);

  const columnRefs = React.useRef(new Map<Stage, HTMLElement>());

  const registerColumn = React.useCallback(
    (stage: Stage) => (node: HTMLElement | null) => {
      if (node) columnRefs.current.set(stage, node);
      else columnRefs.current.delete(stage);
    },
    [],
  );

  /** Qual coluna contém (ou está mais perto de) uma coordenada X da viewport. */
  function columnAtX(x: number): Stage | null {
    let best: { stage: Stage; distance: number } | null = null;
    for (const [stage, node] of columnRefs.current) {
      const rect = node.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right) return stage;
      const center = rect.left + rect.width / 2;
      const distance = Math.abs(center - x);
      if (!best || distance < best.distance) best = { stage, distance };
    }
    return best?.stage ?? null;
  }

  function moveTo(proposal: Proposal, stage: Stage, viaGesture: boolean) {
    if (stage === proposal.stage) return;
    const previousStage = proposal.stage;
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
            item.id === proposal.id ? { ...item, stage: previousStage } : item,
          ),
        ),
      {
        description: viaGesture ? undefined : "Movida pelo menu do card",
        tone: "ok",
      },
    );
  }

  function handleDragEnd(proposal: Proposal, info: PanInfo) {
    setDragging(null);
    // aqui mora a herança de velocidade: projeta onde o card PARARIA
    const projectedX = info.point.x + projectThrow(info.velocity.x);
    const target = columnAtX(projectedX);
    if (target) moveTo(proposal, target, true);
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-32 font-semibold text-ink">Funil</h2>
          <p className="mt-1 text-13 text-muted">
            Arraste o card — ele segue a velocidade do gesto. Ou use o menu do
            card, se preferir o teclado.
          </p>
        </div>
        <Money
          cents={sumCents(items.filter((item) => item.stage !== "fechada"))}
          size="20"
          reserveFor={30_000_000}
        />
      </header>

      {/* mobile: rolagem horizontal com encaixe por coluna. desktop: cinco colunas. */}
      <div
        className={cn(
          "-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2",
          "sm:-mx-6 sm:px-6",
          "lg:mx-0 lg:snap-none lg:px-0",
          "[scrollbar-width:thin]",
        )}
      >
        {STAGES.map((stage) => {
          const cards = items.filter((item) => item.stage === stage.id);
          return (
            <section
              key={stage.id}
              ref={registerColumn(stage.id)}
              aria-label={stage.label}
              className={cn(
                "flex w-[78vw] shrink-0 snap-start flex-col gap-2 rounded-lg",
                "border border-line bg-surface-2 p-2",
                "sm:w-[20rem] lg:w-auto lg:flex-1",
                dragging ? "border-dashed border-accent-line" : undefined,
              )}
            >
              <header className="flex items-center justify-between gap-2 px-1 pt-1">
                <h3 className="text-13 font-semibold tracking-[0.03em] text-muted uppercase">
                  {stage.label}
                </h3>
                <span
                  data-numeric
                  className="text-13 tabular-nums text-muted"
                  title={stage.hint}
                >
                  {cards.length}
                </span>
              </header>

              <p className="px-1 pb-1">
                <Money
                  cents={sumCents(cards)}
                  size="13"
                  tone="muted"
                  reserveFor={30_000_000}
                />
              </p>

              <div className="flex flex-col gap-2">
                {cards.length === 0 ? (
                  <EmptyState
                    compact
                    className="border-line-subtle bg-transparent"
                    title="Vazio"
                    description={stage.hint}
                  />
                ) : (
                  cards.map((proposal) => (
                    <motion.article
                      key={proposal.id}
                      layout={!reducedMotion}
                      layoutId={reducedMotion ? undefined : proposal.id}
                      transition={springLayout}
                      drag
                      dragSnapToOrigin
                      dragElastic={0.25}
                      dragMomentum={false}
                      onDragStart={() => setDragging(proposal.id)}
                      onDragEnd={(_, info) => handleDragEnd(proposal, info)}
                      whileDrag={{ scale: 1.03, zIndex: 40 }}
                      className={cn(
                        "cursor-grab touch-none rounded-md border border-line bg-surface p-3 shadow-1",
                        "active:cursor-grabbing",
                        dragging === proposal.id && "shadow-drag",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate text-15 font-medium text-ink">
                          {proposal.client}
                        </p>
                        <StageMenu
                          proposal={proposal}
                          onMove={(stageId) => moveTo(proposal, stageId, false)}
                        />
                      </div>

                      <p className="mt-0.5 truncate text-13 text-muted">
                        {proposal.destination}
                      </p>

                      <div className="mt-3 flex items-center justify-between gap-2">
                        <Money
                          cents={proposal.cents}
                          size="15"
                          reserveFor={5_940_000}
                        />
                        {proposal.opens > 0 ? (
                          <Badge tone="accent" dot>
                            <OpenedIcon className="size-3" />
                            {proposal.opens}
                          </Badge>
                        ) : proposal.idleDays > 7 ? (
                          <Badge tone="warn" dot>
                            <ClockIcon className="size-3" />
                            {proposal.idleDays}d
                          </Badge>
                        ) : null}
                      </div>
                    </motion.article>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

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
        className="-mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-sm text-muted hover:bg-surface-3 hover:text-ink"
      >
        <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden>
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
                "data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
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
