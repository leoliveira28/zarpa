"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { cn } from "@/lib/ui/cn";

/* =============================================================================
   Checkbox
   -----------------------------------------------------------------------------
   O tique é um <path> com `pathLength=1` desenhado por stroke-dashoffset —
   que é uma propriedade animável barata, não dispara layout, e some sozinha
   com reduced-motion. A caixa em si só muda cor e escala.

   Alvo de toque: a caixa desenhada tem 20px, mas o alvo real é 44px via
   pseudo-elemento. Ninguém acerta 20px com o polegar no ônibus.
   ========================================================================== */

export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(function Checkbox({ className, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        "relative grid size-5 shrink-0 place-items-center rounded-sm border bg-surface",
        "border-line-strong",
        "[transition:background-color_120ms_var(--curve-out),border-color_120ms_var(--curve-out),transform_120ms_var(--curve-out)]",
        "hover:border-accent",
        "active:scale-[0.92]",
        "data-[state=checked]:border-accent data-[state=checked]:bg-accent",
        "data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent",
        "disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-line-strong",
        "aria-[invalid]:border-danger",
        // alvo de toque de 44px sem mexer no layout
        "before:absolute before:-inset-3 before:content-['']",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="text-on-accent">
        {props.checked === "indeterminate" ? <DashGlyph /> : <TickGlyph />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

function TickGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="zk-tick size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3.25 8.5 6.5 11.75 12.75 4.75" pathLength={1} />
    </svg>
  );
}

function DashGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 8h8" />
    </svg>
  );
}

/**
 * Linha inteira clicável: caixa + rótulo + descrição. É o formato que a gente
 * usa em listas de opção — clicar no texto marca, como todo mundo espera.
 */
export function CheckboxRow({
  label,
  description,
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
  label: React.ReactNode;
  description?: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-md py-1.5",
        props.disabled && "opacity-55",
        className,
      )}
    >
      <Checkbox id={id} className="mt-0.5" {...props} />
      <label htmlFor={id} className="min-w-0 cursor-pointer select-none">
        <span className="block text-15 text-ink">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-13 text-muted">{description}</span>
        ) : null}
      </label>
    </div>
  );
}
