"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/ui/cn";

/* =============================================================================
   Button
   -----------------------------------------------------------------------------
   Duas obsessões aqui:

   1. A pressão responde no `pointerdown`, não no `click`. No celular o `click`
      chega ~100ms depois do dedo encostar (e às vezes nem chega, se o gesto
      virou scroll). Esperar por ele é a diferença entre um app que parece
      colado no dedo e um que parece um site.

   2. Carregando não é spinner. O rótulo continua lá — sumir com o texto é
      apagar a informação de qual ação está em curso — e uma régua fina de
      acento corre embaixo, animada só em `transform: scaleX`.
   ========================================================================== */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
type Size = "sm" | "md" | "lg";

const base = cn(
  "relative inline-flex select-none items-center justify-center gap-2",
  "whitespace-nowrap font-medium",
  // o percurso da pressão: só transform e opacity, 120ms, interrompível
  "[transition:transform_120ms_var(--curve-out),background-color_120ms_var(--curve-out),border-color_120ms_var(--curve-out),opacity_120ms_var(--curve-out)]",
  "data-[pressed]:scale-[0.97]",
  "disabled:pointer-events-none disabled:opacity-45",
  "data-[busy]:cursor-progress",
  // toque nunca pinta o retângulo cinza do Android/iOS
  "touch-manipulation",
);

const variants: Record<Variant, string> = {
  primary: cn(
    "bg-accent text-on-accent shadow-1",
    "hover:bg-accent-hover data-[pressed]:bg-accent-active",
  ),
  secondary: cn(
    "bg-surface text-ink border border-line shadow-1",
    "hover:bg-surface-2 hover:border-line-strong",
    "data-[pressed]:bg-surface-3",
  ),
  ghost: cn(
    "bg-transparent text-ink border border-transparent",
    "hover:bg-surface-3 data-[pressed]:bg-surface-3",
  ),
  quiet: cn(
    "bg-transparent text-muted border border-transparent",
    "hover:text-ink hover:bg-surface-3 data-[pressed]:bg-surface-3",
  ),
  danger: cn(
    "bg-danger text-on-accent shadow-1",
    "hover:bg-danger-hover data-[pressed]:bg-danger-hover",
  ),
};

/* Altura em múltiplos de 4. `md` fica em 40px no desktop e cresce pro alvo de
   toque de 44px em ponteiro grosso — o agente vive no celular. */
const sizes: Record<Size, string> = {
  sm: "h-8 rounded-md px-3 text-13 [@media(pointer:coarse)]:h-9",
  md: "h-10 rounded-md px-4 text-15 [@media(pointer:coarse)]:h-11",
  lg: "h-12 rounded-lg px-5 text-17 [@media(pointer:coarse)]:h-12",
};

const iconOnlySizes: Record<Size, string> = {
  sm: "w-8 px-0 [@media(pointer:coarse)]:w-9",
  md: "w-10 px-0 [@media(pointer:coarse)]:w-11",
  lg: "w-12 px-0",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Ação em curso: mantém o rótulo, marca `aria-busy`, corre a régua. */
  loading?: boolean;
  /** Botão só de ícone — exige `aria-label`. */
  iconOnly?: boolean;
  /** Ocupa a largura toda (padrão nas ações principais do mobile). */
  block?: boolean;
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant = "secondary",
      size = "md",
      loading = false,
      iconOnly = false,
      block = false,
      asChild = false,
      disabled,
      children,
      onPointerDown,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
      ...props
    },
    ref,
  ) {
    const [pressed, setPressed] = React.useState(false);
    const Comp = asChild ? Slot : "button";

    const release = React.useCallback(() => setPressed(false), []);

    return (
      <Comp
        ref={ref}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        data-pressed={pressed && !disabled && !loading ? "" : undefined}
        data-busy={loading ? "" : undefined}
        data-variant={variant}
        className={cn(
          base,
          variants[variant],
          sizes[size],
          iconOnly && iconOnlySizes[size],
          block && "w-full",
          className,
        )}
        onPointerDown={(event: React.PointerEvent<HTMLButtonElement>) => {
          // resposta no toque, antes de qualquer click
          if (!disabled && !loading) setPressed(true);
          onPointerDown?.(event);
        }}
        onPointerUp={(event: React.PointerEvent<HTMLButtonElement>) => {
          release();
          onPointerUp?.(event);
        }}
        onPointerCancel={(event: React.PointerEvent<HTMLButtonElement>) => {
          release();
          onPointerCancel?.(event);
        }}
        onPointerLeave={(event: React.PointerEvent<HTMLButtonElement>) => {
          release();
          onPointerLeave?.(event);
        }}
        {...props}
      >
        {children}
        {loading ? <BusyRule /> : null}
      </Comp>
    );
  },
);

/** Régua indeterminada. Anima `transform` e nada mais. Keyframes em globals.css. */
function BusyRule() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-1 bottom-[3px] h-[2px] overflow-hidden rounded-pill"
    >
      <span className="absolute inset-0 rounded-pill bg-current opacity-25" />
      <span className="zk-busy-bar absolute inset-y-0 left-0 w-1/3 rounded-pill bg-current" />
    </span>
  );
}
