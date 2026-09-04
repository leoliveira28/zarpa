import * as React from "react";
import { cn } from "@/lib/ui/cn";

/* =============================================================================
   Badge
   -----------------------------------------------------------------------------
   Nada de pílula colorida gritante. Fundo suave, texto na cor forte do mesmo
   matiz, traço de 1px pra segurar a forma em fundo escuro.

   `dot` desenha um ponto sólido antes do rótulo: cor sozinha não é informação
   acessível, e o ponto ajuda a bater o olho na coluna de status.
   ========================================================================== */

type BadgeTone = "neutral" | "accent" | "ok" | "warn" | "danger";
type BadgeSize = "sm" | "md";

const tones: Record<BadgeTone, { chip: string; dot: string }> = {
  neutral: {
    chip: "bg-surface-3 text-muted border-line",
    dot: "bg-muted",
  },
  accent: {
    chip: "bg-accent-soft text-accent-soft-ink border-accent-line/50",
    dot: "bg-accent",
  },
  ok: {
    chip: "bg-ok-soft text-ok-soft-ink border-ok/25",
    dot: "bg-ok",
  },
  warn: {
    chip: "bg-warn-soft text-warn-soft-ink border-warn/25",
    dot: "bg-warn",
  },
  danger: {
    chip: "bg-danger-soft text-danger-soft-ink border-danger/25",
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
        "inline-flex shrink-0 items-center rounded-sm border font-medium whitespace-nowrap",
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
