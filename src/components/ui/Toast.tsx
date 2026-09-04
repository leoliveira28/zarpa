"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/ui/cn";
import { springDefault, usePrefersReducedMotion } from "@/lib/ui/motion";

/* =============================================================================
   Toast — e o desfazer
   -----------------------------------------------------------------------------
   Regra do CLAUDE.md: ação destrutiva não abre modal "tem certeza?". Ela
   ACONTECE, e o toast oferece desfazer por 8 segundos.

   Por quê: o modal cobra confirmação de todo mundo, sempre, inclusive das 99
   vezes em que a pessoa tinha certeza. O desfazer cobra só de quem errou.

   Detalhes que fazem funcionar:
     - a régua de tempo é `transform: scaleX` com origem à esquerda; dá pra ver
       quanto resta sem ler número
     - o relógio PAUSA no hover e no foco. Ler o toast não pode consumir o
       tempo que você tem pra desfazer
     - o toast fica acima da barra inferior no celular (bottom-nav + safe-area)
     - `role="status"` + `aria-live="polite"`: o leitor de tela recebe a mesma
       chance de desfazer
   ========================================================================== */

export type ToastTone = "neutral" | "ok" | "warn" | "danger";

export interface ToastOptions {
  title: React.ReactNode;
  description?: React.ReactNode;
  tone?: ToastTone;
  /** Duração em ms. Toast com desfazer usa 8000 por decisão de produto. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastRecord extends ToastOptions {
  id: number;
  duration: number;
  createdAt: number;
}

interface ToastApi {
  /** Toast informativo. 5s. */
  show: (options: ToastOptions) => number;
  /** Ação destrutiva já executada + desfazer por 8s. */
  undo: (
    title: React.ReactNode,
    onUndo: () => void,
    options?: Omit<ToastOptions, "title" | "action">,
  ) => number;
  dismiss: (id: number) => void;
}

const UNDO_DURATION = 8000;
const DEFAULT_DURATION = 5000;

const ToastContext = React.createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = React.useContext(ToastContext);
  if (!api) {
    throw new Error("useToast precisa estar dentro de <ToastProvider>.");
  }
  return api;
}

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = React.useCallback((options: ToastOptions, duration: number) => {
    const id = nextId++;
    setToasts((current) => [
      // no máximo três na pilha: acima disso vira parede de aviso
      ...current.slice(-2),
      { ...options, id, duration, createdAt: Date.now() },
    ]);
    return id;
  }, []);

  const api = React.useMemo<ToastApi>(
    () => ({
      show: (options) => push(options, options.duration ?? DEFAULT_DURATION),
      undo: (title, onUndo, options) => {
        const id = push(
          {
            ...options,
            title,
            tone: options?.tone ?? "neutral",
            action: {
              label: "Desfazer",
              onClick: () => {
                onUndo();
                dismiss(id);
              },
            },
          },
          options?.duration ?? UNDO_DURATION,
        );
        return id;
      },
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      role="region"
      aria-label="Avisos"
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-stretch gap-2 p-3",
        // acima da barra inferior no celular; canto direito no desktop
        "pb-[calc(env(safe-area-inset-bottom,0px)+4.5rem)]",
        "sm:right-0 sm:left-auto sm:w-[24rem] sm:items-end sm:pb-3",
      )}
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}

const tones: Record<ToastTone, { rule: string; dot: string }> = {
  neutral: { rule: "bg-accent", dot: "bg-accent" },
  ok: { rule: "bg-ok", dot: "bg-ok" },
  warn: { rule: "bg-warn", dot: "bg-warn" },
  danger: { rule: "bg-danger", dot: "bg-danger" },
};

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastRecord;
  onDismiss: (id: number) => void;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const [paused, setPaused] = React.useState(false);
  const [remaining, setRemaining] = React.useState(toast.duration);
  const deadline = React.useRef(Date.now() + toast.duration);

  React.useEffect(() => {
    if (paused) return;
    deadline.current = Date.now() + remaining;
    const tick = window.setInterval(() => {
      const left = deadline.current - Date.now();
      if (left <= 0) {
        window.clearInterval(tick);
        onDismiss(toast.id);
      } else {
        setRemaining(left);
      }
    }, 100);
    return () => window.clearInterval(tick);
    // `remaining` de propósito fora da lista: ele é a saída, não a entrada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, toast.id, onDismiss]);

  const progress = Math.max(0, Math.min(1, remaining / toast.duration));
  const tone = tones[toast.tone ?? "neutral"];

  return (
    <motion.div
      role="status"
      aria-live="polite"
      layout={!reducedMotion}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
      animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
      transition={reducedMotion ? { duration: 0 } : springDefault}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className={cn(
        "pointer-events-auto relative w-full overflow-hidden rounded-lg border border-line",
        "bg-surface shadow-3 sm:w-[24rem]",
      )}
    >
      <div className="flex items-start gap-3 p-3">
        <span
          aria-hidden
          className={cn("mt-[0.45em] size-2 shrink-0 rounded-pill", tone.dot)}
        />
        <div className="min-w-0 flex-1">
          <p className="text-15 font-medium text-ink">{toast.title}</p>
          {toast.description ? (
            <p className="mt-0.5 text-13 text-muted">{toast.description}</p>
          ) : null}
        </div>

        {toast.action ? (
          <button
            type="button"
            onPointerDown={(event) => {
              // desfazer no pointerdown: é uma corrida contra 8 segundos
              event.preventDefault();
              toast.action?.onClick();
            }}
            className={cn(
              "-my-1 shrink-0 rounded-md px-2.5 py-2 text-15 font-medium text-accent",
              "hover:bg-accent-soft",
              "[@media(pointer:coarse)]:min-h-11",
            )}
          >
            {toast.action.label}
          </button>
        ) : null}

        <button
          type="button"
          aria-label="Dispensar aviso"
          onPointerDown={() => onDismiss(toast.id)}
          className="-my-1 -mr-1 grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-ink"
        >
          <svg
            viewBox="0 0 16 16"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
          </svg>
        </button>
      </div>

      {/* régua de tempo: scaleX, origem à esquerda. Some com reduced-motion. */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-x-0 bottom-0 h-0.5 origin-left",
          tone.rule,
          paused && "opacity-40",
        )}
        style={{
          transform: `scaleX(${progress})`,
          transition: "transform 100ms linear",
        }}
      />
    </motion.div>
  );
}
