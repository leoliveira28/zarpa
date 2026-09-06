import * as React from "react";
import { cn } from "@/lib/ui/cn";
import { FernPlate } from "@/components/plates";

/* =============================================================================
   EmptyState
   -----------------------------------------------------------------------------
   REESCRITO na direção Papel e Pedra. A versão anterior era uma caixa de borda
   tracejada — ou seja, um retângulo desenhado em volta do nada, que é a forma
   mais direta de dizer "aqui falta alguma coisa e nós também não sabemos o quê".

   Agora o vazio é um REGISTRO como qualquer outro: papel, espaço generoso,
   texto à esquerda, uma ação. Quem separa ele do que veio antes é a cornija do
   `SectionHeading`, não um contorno próprio.

   Duas regras do CLAUDE.md moram aqui:

     - "estado vazio sempre com conteúdo de exemplo": `preview` mostra uma linha
       de exemplo desbotada e `aria-hidden`, e a ação fica logo abaixo — o
       caminho para sair do vazio.

     - a prancha: `plate` desenha a FernPlate ao fundo, a 14% (`.plate-wash`),
       na cor de tinta, NUNCA no accent. No máximo UMA por tela — por isso ela
       é opcional e ligada de fora: o componente não tem como saber quantos
       vazios a tela tem, mas a tela tem.
   ========================================================================== */

export interface EmptyStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Ação que resolve o vazio. Uma só — duas viram indecisão. */
  action?: React.ReactNode;
  /** Ação secundária discreta (importar, ver exemplo). Texto, não botão. */
  secondaryAction?: React.ReactNode;
  /** Amostra do que apareceria aqui. Puramente visual. */
  preview?: React.ReactNode;
  /** Variante compacta para dentro de card e coluna de kanban. Sem prancha. */
  compact?: boolean;
  /** Liga a prancha de fundo. UMA por tela. */
  plate?: boolean;
}

export function EmptyState({
  title,
  description,
  action,
  secondaryAction,
  preview,
  compact,
  plate = false,
  className,
  ...props
}: EmptyStateProps) {
  const showPlate = plate && !compact;

  return (
    <div
      className={cn(
        "relative isolate flex flex-col overflow-hidden rounded-lg bg-surface-2",
        compact ? "gap-3 px-4 py-5" : "gap-4 px-5 py-8 sm:px-6 sm:py-10",
        className,
      )}
      {...props}
    >
      {showPlate ? (
        <FernPlate
          size={200}
          className={cn(
            "plate-wash pointer-events-none absolute -z-10 select-none",
            // sangra pela direita: a fronde entra na página, não posa no meio
            "-top-6 -right-6 sm:-top-8 sm:-right-4",
          )}
        />
      ) : null}

      {preview ? (
        <div
          aria-hidden
          className="pointer-events-none max-w-md select-none opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]"
        >
          {preview}
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <p
          className={cn(
            "font-semibold text-ink",
            compact ? "text-15" : "text-17",
          )}
        >
          {title}
        </p>
        {description ? (
          <p className="max-w-prose text-13 text-muted">{description}</p>
        ) : null}
      </div>

      {action || secondaryAction ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
