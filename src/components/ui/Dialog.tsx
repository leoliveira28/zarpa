"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/ui/cn";

/* =============================================================================
   Dialog
   -----------------------------------------------------------------------------
   Modal aqui é para DECISÃO, não para confirmação. Apagar coisa não abre
   modal — apaga e mostra toast com desfazer (ver Toast.tsx). Modal fica para
   o que exige informação nova do usuário antes de continuar.

   Entra com opacity + scale(0.98). Nada de deslizar de cima: o diálogo não vem
   de lugar nenhum, ele acontece no lugar onde a atenção já está.
   ========================================================================== */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export interface DialogContentProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    "title"
  > {
  title: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  /** Largura do painel. `sm` para decisão curta, `md` para formulário. */
  width?: "sm" | "md";
}

export function DialogContent({
  title,
  description,
  footer,
  width = "sm",
  className,
  children,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="zk-fade fixed inset-0 z-40 bg-scrim" />
      <DialogPrimitive.Content
        className={cn(
          "zk-dialog fixed top-1/2 left-1/2 z-50 flex max-h-[85dvh] w-[calc(100vw-2rem)] flex-col",
          "-translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-surface shadow-3",
          width === "sm" ? "sm:w-[24rem]" : "sm:w-[34rem]",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 p-4 pb-2">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-17 font-semibold text-ink">
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
            className="-mt-1 -mr-1 grid size-9 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-ink"
          >
            <CloseGlyph />
          </DialogPrimitive.Close>
        </div>

        {children ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
            {children}
          </div>
        ) : null}

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line-subtle px-4 py-3">
            {footer}
          </div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
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
