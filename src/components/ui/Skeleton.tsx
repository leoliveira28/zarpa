import * as React from "react";
import { cn } from "@/lib/ui/cn";

/* =============================================================================
   Skeleton — nunca spinner.
   -----------------------------------------------------------------------------
   Um spinner diz "espera". Um skeleton diz "o que vem aqui, e quanto ocupa" —
   e o layout não pula quando o dado chega. O brilho é um pseudo-elemento em
   translateX; a caixa em si não anima.
   ========================================================================== */

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Sem brilho: para blocos grandes ou quando há muitos na tela. */
  still?: boolean;
}

export function Skeleton({ className, still, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        "rounded-sm",
        still ? "bg-skeleton" : "zk-skeleton",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Linhas de texto falso com larguras irregulares — parágrafo de verdade não
 * tem todas as linhas do mesmo tamanho, e o olho percebe a diferença.
 */
export function SkeletonText({
  lines = 3,
  className,
  ...props
}: SkeletonProps & { lines?: number }) {
  const widths = ["100%", "92%", "68%", "84%", "56%"];
  return (
    <div className={cn("flex flex-col gap-2", className)} {...props}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className="h-[0.875rem] rounded-xs"
          style={{ width: widths[index % widths.length] }}
        />
      ))}
    </div>
  );
}

/** Bloco de linha de lista: avatar + duas linhas. Usado no carregamento de Hoje. */
export function SkeletonRow({ className, ...props }: SkeletonProps) {
  return (
    <div className={cn("flex items-center gap-3", className)} {...props}>
      <Skeleton className="size-10 shrink-0 rounded-md" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-[0.875rem] w-2/5 rounded-xs" />
        <Skeleton className="h-3 w-3/5 rounded-xs" />
      </div>
    </div>
  );
}

/** Região que anuncia carregamento a leitor de tela sem poluir a UI. */
export function LoadingRegion({
  label = "Carregando",
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
