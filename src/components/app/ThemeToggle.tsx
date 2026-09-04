"use client";

import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/ui/cn";
import { useTheme, type ThemeChoice } from "@/lib/ui/theme";
import { useTransitionPreset } from "@/lib/ui/motion";

/* =============================================================================
   Alternador de tema
   -----------------------------------------------------------------------------
   Segmentado de três posições, não um interruptor. "Sistema" precisa ser uma
   escolha visível: quem nunca abriu isso está em sistema, e esconder esse
   estado faz o controle mentir sobre o que está ativo.

   O fundo do segmento ativo é um único elemento que desliza (layoutId), então
   a troca mostra a direção. Só transform.
   ========================================================================== */

const options: { value: ThemeChoice; label: string; icon: React.ReactNode }[] = [
  { value: "system", label: "Sistema", icon: <SystemGlyph /> },
  { value: "light", label: "Claro", icon: <SunGlyph /> },
  { value: "dark", label: "Escuro", icon: <MoonGlyph /> },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { choice, setChoice, mounted } = useTheme();
  const transition = useTransitionPreset("snap");

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className={cn(
        "relative inline-flex items-center gap-0.5 rounded-md border border-line bg-surface-2 p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const active = mounted && choice === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            onPointerDown={() => setChoice(option.value)}
            className={cn(
              "relative grid size-8 place-items-center rounded-sm",
              "transition-colors duration-[120ms]",
              active ? "text-ink" : "text-muted hover:text-ink",
            )}
          >
            {active ? (
              <motion.span
                layoutId="theme-toggle-thumb"
                transition={transition}
                className="absolute inset-0 rounded-sm border border-line bg-surface shadow-1"
              />
            ) : null}
            <span className="relative">{option.icon}</span>
          </button>
        );
      })}
    </div>
  );
}

function SystemGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="3" width="12" height="8" rx="1.5" />
      <path d="M5.5 13.5h5" />
    </svg>
  );
}

function SunGlyph() {
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
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M12.6 3.4l-.85.85M4.25 11.75l-.85.85" />
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M13 9.6A5.6 5.6 0 0 1 6.4 3a5.6 5.6 0 1 0 6.6 6.6Z" />
    </svg>
  );
}
