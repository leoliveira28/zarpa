import * as React from "react";
import { cn } from "@/lib/ui/cn";

/* =============================================================================
   Badge
   -----------------------------------------------------------------------------
   Nada de pílula colorida gritante. Fundo suave e texto na cor forte do mesmo
   matiz — e SEM contorno: o fundo já define a forma nos dois temas, e um traço
   a mais em volta de cada status vira renda na tela de funil, onde cabem vinte
   badges de uma vez.

   `dot` desenha um ponto sólido antes do rótulo: cor sozinha não é informação
   acessível, e o ponto ajuda a bater o olho na coluna de status.
   ========================================================================== */

type BadgeTone = "neutral" | "accent" | "ok" | "warn" | "danger";
type BadgeSize = "sm" | "md";

const tones: Record<BadgeTone, { chip: string; dot: string }> = {
  neutral: {
    chip: "bg-surface-3 text-muted",
    dot: "bg-muted",
  },
  accent: {
    chip: "bg-accent-soft text-accent-soft-ink",
    dot: "bg-accent",
  },
  ok: {
    chip: "bg-ok-soft text-ok-soft-ink",
    dot: "bg-ok",
  },
  warn: {
    chip: "bg-warn-soft text-warn-soft-ink",
    dot: "bg-warn",
  },
  danger: {
    chip: "bg-danger-soft text-danger-soft-ink",
    dot: "bg-danger",
  },
};

const sizes: Record<BadgeSize, string> = {
  sm: "h-5 px-1.5 text-13 gap-1",
  md: "h-6 px-2 text-13 gap-1.5",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
  dot?: boolean;
}

export function Badge({
  className,
  tone = "neutral",
  size = "sm",
  dot = false,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-sm font-medium whitespace-nowrap",
        tones[tone].chip,
        sizes[size],
        className,
      )}
      {...props}
    >
      {dot ? (
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-pill", tones[tone].dot)}
        />
      ) : null}
      {children}
    </span>
  );
}

/**
 * Contador. Largura reservada pelo maior número esperado — igual ao Money,
 * pelo mesmo motivo: badge que cresce empurra o resto da linha.
 */
export function CountBadge({
  value,
  max = 99,
  className,
  ...props
}: BadgeProps & { value: number; max?: number }) {
  const label = value > max ? `${max}+` : String(value);
  return (
    <Badge
      className={cn("justify-center tabular-nums", className)}
      style={{ minWidth: `${String(max).length + 1.5}ch` }}
      {...props}
    >
      {label}
    </Badge>
  );
}
