import * as React from "react";
import { cn } from "@/lib/ui/cn";

/* =============================================================================
   Card
   -----------------------------------------------------------------------------
   Raio 14 (--r-lg), não o raio de controle. Sombra 1 é quase invisível de
   propósito: a separação vem do traço e do fundo, a sombra só desgruda o card
   do papel. Card com sombra forte vira caixa flutuando sem motivo.
   ========================================================================== */

type CardTone = "default" | "raised" | "inset" | "accent" | "warn";

const tones: Record<CardTone, string> = {
  default: "bg-surface border-line shadow-1",
  raised: "bg-surface border-line shadow-2",
  inset: "bg-inset border-line-subtle",
  accent: "bg-accent-soft border-accent-line/60",
  warn: "bg-warn-soft border-warn/25",
};

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: CardTone;
  /** Card clicável: ganha realce de hover e resposta de pressão. */
  interactive?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, tone = "default", interactive, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-lg border",
        tones[tone],
        interactive &&
          cn(
            "cursor-pointer [transition:transform_120ms_var(--curve-out),border-color_120ms_var(--curve-out),box-shadow_160ms_var(--curve-out)]",
            "hover:border-line-strong hover:shadow-2",
            "active:scale-[0.995]",
          ),
        className,
      )}
      {...props}
    />
  );
});

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-start justify-between gap-4 p-4 pb-3", className)}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn("text-17 font-semibold text-ink", className)} {...props} />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-13 text-muted", className)} {...props} />;
}

export function CardBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pb-4", className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-t border-line-subtle px-4 py-3",
        className,
      )}
      {...props}
    />
  );
}

/** Título de seção fora do card. Escala 13 em maiúsculas comedidas, não caixa alta gritada. */
export function SectionHeading({
  className,
  children,
  action,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { action?: React.ReactNode }) {
  return (
    <div
      className={cn("flex items-baseline justify-between gap-4 pb-3", className)}
      {...props}
    >
      <h2 className="text-13 font-semibold tracking-[0.04em] text-muted uppercase">
        {children}
      </h2>
      {action}
    </div>
  );
}
