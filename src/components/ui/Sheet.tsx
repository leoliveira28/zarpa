"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useMotionValue, animate } from "motion/react";
import { cn } from "@/lib/ui/cn";
import {
  rubberBandClamp,
  shouldDismiss,
  springSheet,
  usePrefersReducedMotion,
} from "@/lib/ui/motion";

/* =============================================================================
   Sheet — o painel arrastável
   -----------------------------------------------------------------------------
   É o componente onde o produto ganha ou perde a sensação de app. Três coisas
   que nenhum sheet de biblioteca acerta:

   1. O arrasto é 1:1 com o dedo no sentido de fechar, e com RESISTÊNCIA no
      sentido contrário (rubber-banding). Puxar pra cima e o painel subir
      livremente é o que denuncia um sheet falso.

   2. A decisão de fechar olha velocidade, não só distância. Um flick curto e
      rápido fecha; um arrasto longo e lento que voltou, não.

   3. O gesto só começa quando o conteúdo já está com o scroll no topo — senão
      arrastar pra ler vira arrastar pra fechar, e o usuário perde o lugar.

   O foco, o Esc e o `aria-modal` são do Radix Dialog. O movimento é nosso.

   O contorno de 1px aqui é deliberado: camada FLUTUANTE, não caixa sobre o
   papel — ver a doutrina do fio em src/components/plates/index.tsx (Rule).
   ========================================================================== */

type Side = "bottom" | "right";
/** `auto` (padrão): gaveta INFERIOR no celular (polegar manda), LATERAL DIREITA
 * no desktop (tela grande pede mais espaço — pedido do PO na revisão da Vitrine). */
type SideRequest = Side | "auto";

/** O lado EFETIVO de um pedido, reagindo ao breakpoint lg. */
function useLadoEfetivo(pedido: SideRequest): Side {
  const [lateral, setLateral] = React.useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches,
  );

  React.useEffect(() => {
    if (pedido !== "auto") return;
    const media = window.matchMedia("(min-width: 1024px)");
    const mudou = (evento: MediaQueryListEvent) => setLateral(evento.matches);
    media.addEventListener("change", mudou);
    return () => media.removeEventListener("change", mudou);
  }, [pedido]);

  if (pedido !== "auto") return pedido;
  return lateral ? "right" : "bottom";
}

interface SheetContextValue {
  side: Side;
}
const SheetContext = React.createContext<SheetContextValue>({ side: "bottom" });

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export interface SheetContentProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    "title"
  > {
  /** `auto` (padrão) resolve bottom no celular, right no desktop. */
  side?: SideRequest;
  /** Título obrigatório: Radix exige, e o leitor de tela também. */
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Rodapé fixo, fora da área rolável — onde vive a ação principal. */
  footer?: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Desliga o arrasto (ex.: formulário longo onde o gesto atrapalha). */
  draggable?: boolean;
}

export function SheetContent({
  side: sidePedido = "auto",
  title,
  description,
  footer,
  open,
  onOpenChange,
  draggable = true,
  className,
  children,
  ...props
}: SheetContentProps) {
  const reducedMotion = usePrefersReducedMotion();
  const side = useLadoEfetivo(sidePedido);
  const axis = side === "bottom" ? "y" : "x";
  const offset = useMotionValue(0);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{
    pointerId: number;
    start: number;
    last: number;
    lastTime: number;
    velocity: number;
    active: boolean;
  } | null>(null);

  const canDrag = draggable && !reducedMotion;

  function measure() {
    const node = panelRef.current;
    if (!node) return 1;
    return side === "bottom" ? node.offsetHeight : node.offsetWidth;
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!canDrag || event.pointerType === "mouse") return;
    // se a área rolável não está no topo, o gesto é scroll, não arrasto
    if ((scrollRef.current?.scrollTop ?? 0) > 0) return;
    const point = side === "bottom" ? event.clientY : event.clientX;
    drag.current = {
      pointerId: event.pointerId,
      start: point,
      last: point,
      lastTime: event.timeStamp,
      velocity: 0,
      active: true,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state?.active || state.pointerId !== event.pointerId) return;
    const point = side === "bottom" ? event.clientY : event.clientX;
    const elapsed = Math.max(1, event.timeStamp - state.lastTime);
    state.velocity = ((point - state.last) / elapsed) * 1000;
    state.last = point;
    state.lastTime = event.timeStamp;

    // fechar é 1:1; o sentido contrário tem resistência
    offset.set(
      rubberBandClamp(point - state.start, 0, Number.POSITIVE_INFINITY, measure()),
    );
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state?.active || state.pointerId !== event.pointerId) return;
    state.active = false;
    drag.current = null;

    if (shouldDismiss(offset.get(), state.velocity)) {
      onOpenChange(false);
      return;
    }
    animate(offset, 0, springSheet);
  }

  const closedOffset = "100%";

  return (
    <AnimatePresence>
      {open ? (
        <SheetContext.Provider value={{ side }}>
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reducedMotion ? 0 : 0.2 }}
                className="fixed inset-0 z-40 bg-scrim"
              />
            </DialogPrimitive.Overlay>

            <DialogPrimitive.Content asChild forceMount {...props}>
              {/* Duas camadas de propósito: a de fora faz entrada e saída, a de
                  dentro carrega o arrasto. Separadas, um gesto no meio da
                  animação de entrada não briga com ela — os dois transforms
                  compõem em vez de se sobrescrever. */}
              <motion.div
                initial={reducedMotion ? { opacity: 0 } : { [axis]: closedOffset }}
                animate={reducedMotion ? { opacity: 1 } : { [axis]: 0 }}
                exit={reducedMotion ? { opacity: 0 } : { [axis]: closedOffset }}
                transition={reducedMotion ? { duration: 0 } : springSheet}
                className={cn(
                  "fixed z-50 flex",
                  side === "bottom"
                    ? "inset-x-0 bottom-0 justify-center"
                    : "inset-y-0 right-0",
                )}
              >
                <motion.div
                  ref={panelRef}
                  style={axis === "y" ? { y: offset } : { x: offset }}
                  className={cn(
                    "flex flex-col bg-surface shadow-3",
                    side === "bottom"
                      ? "max-h-[88dvh] w-full rounded-t-xl border-t border-line sm:w-[32rem] sm:border-x"
                      : "h-dvh w-[min(32rem,100vw)] rounded-l-xl border-l border-line",
                    className,
                  )}
                >
                  {/* alça: a área que aceita o gesto. 44px de alvo, 4px de traço. */}
                  <div
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    className={cn(
                      "shrink-0",
                      canDrag ? "touch-none" : undefined,
                    )}
                  >
                    {side === "bottom" ? (
                      <div className="flex h-5 items-center justify-center pt-2">
                        <span
                          aria-hidden
                          className="h-1 w-9 rounded-pill bg-line-strong"
                        />
                      </div>
                    ) : null}

                    <div className="flex items-start justify-between gap-4 px-4 pt-3 pb-3">
                      <div className="min-w-0">
                        <DialogPrimitive.Title className="text-20 font-semibold text-ink">
                          {title}
                        </DialogPrimitive.Title>
                        {description ? (
                          <DialogPrimitive.Description className="mt-1 text-13 text-muted">
                            {description}
                          </DialogPrimitive.Description>
                        ) : null}
                      </div>
                      <DialogPrimitive.Close
                        aria-label="Fechar"
                        className="-mr-1 grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-ink"
                      >
                        <CloseGlyph />
                      </DialogPrimitive.Close>
                    </div>
                  </div>

                  <div
                    ref={scrollRef}
                    className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4"
                  >
                    {children}
                  </div>

                  {footer ? (
                    <div className="shrink-0 border-t border-hairline bg-surface px-4 pb-4 pt-3" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
                      {footer}
                    </div>
                  ) : null}
                </motion.div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </SheetContext.Provider>
      ) : null}
    </AnimatePresence>
  );
}

function CloseGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
    </svg>
  );
}
