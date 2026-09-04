import * as React from "react";
import { cn } from "@/lib/ui/cn";

/* =============================================================================
   EmptyState
   -----------------------------------------------------------------------------
   Regra do CLAUDE.md: "estado vazio sempre com conteúdo de exemplo". Um vazio
   que só diz "nada aqui" transfere pro usuário o trabalho de imaginar o que
   apareceria. O `preview` mostra uma linha de exemplo desbotada, com aria-hidden,
   e a ação principal fica logo abaixo — o caminho pra sair do vazio.

   Nada é centralizado por padrão: alinhado à esquerda, como o resto do produto.
   ========================================================================== */

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Ação que resolve o vazio. Uma só — duas viram indecisão. */
  action?: React.ReactNode;
  /** Ação secundária discreta (importar, ver exemplo). */
  secondaryAction?: React.ReactNode;
  /** Amostra do que apareceria aqui. Puramente visual. */
  preview?: React.ReactNode;
  /** Variante compacta para dentro de card e coluna de kanban. */
  compact?: boolean;
}

export function EmptyState({
  title,
  description,
  action,
  secondaryAction,
  preview,
  compact,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-dashed border-line bg-surface-2",
        compact ? "gap-3 p-4" : "gap-4 p-6",
        className,
      )}
      {...props}
    >
      {preview ? (
        <div
          aria-hidden
          className="pointer-events-none select-none opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]"
        >
          {preview}
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <p className={cn("font-semibold text-ink", compact ? "text-15" : "text-17")}>
          {title}
        </p>
        {description ? (
          <p className="max-w-prose text-13 text-muted">{description}</p>
        ) : null}
      </div>

      {action || secondaryAction ? (
        <div className="flex flex-wrap items-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
