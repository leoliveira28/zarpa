"use client";

import * as React from "react";
import { MotionConfig } from "motion/react";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { ToastProvider } from "@/components/ui/Toast";

/**
 * Provedores de cliente da aplicação inteira.
 *
 * `MotionConfig reducedMotion="user"` faz o motion respeitar
 * `prefers-reduced-motion` sozinho, além do que já tratamos à mão nos hooks —
 * cinto e suspensório, porque essa é a preferência mais fácil de esquecer
 * num componente novo.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={250} skipDelayDuration={300}>
        <ToastProvider>{children}</ToastProvider>
      </TooltipProvider>
    </MotionConfig>
  );
}
