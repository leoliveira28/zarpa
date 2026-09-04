"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/ui/cn";

/* =============================================================================
   Tooltip
   -----------------------------------------------------------------------------
   Tooltip é COMPLEMENTO, nunca a única fonte de uma informação: no celular não
   existe hover, e quem navega por teclado só vê no foco. Se o texto é
   necessário para entender a ação, ele vai no rótulo, não aqui.

   Superfície invertida de propósito — o balão não é "mais um card", é uma nota
   sobreposta.
   ========================================================================== */

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  children,
  content,
  side = "top",
  align = "center",
  delay = 250,
}: {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  delay?: number;
}) {
  return (
    <TooltipPrimitive.Root delayDuration={delay}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            "zk-pop z-50 max-w-64 rounded-md px-2.5 py-1.5",
            "bg-inverse-surface text-13 text-inverse shadow-2",
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-[var(--surface-inverse)]" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
