import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/* =============================================================================
   cn — junta classes e resolve conflitos do Tailwind (a última vence)
   -----------------------------------------------------------------------------
   O `extend` abaixo não é afinação: sem ele o design system estava PERDENDO
   classe silenciosamente, e foi assim que o rótulo do botão primário virou
   tinta preta sobre azul.

   Como: o tailwind-merge decide o grupo de uma classe pelo que vem depois do
   prefixo. `text-sm` ele reconhece como corpo de escala e classifica em
   `font-size`; `text-13` não é escala conhecida dele, então cai no grupo
   `text-color` — o mesmo de `text-ink`. Duas classes no mesmo grupo viram uma
   só, a última. Resultado, em toda a base:

     twMerge("bg-accent text-on-accent", "h-8 px-3 text-13")
       -> "bg-accent h-8 px-3 text-13"          // a COR sumiu

     twMerge("text-20", "text-ink")
       -> "text-ink"                            // o TAMANHO sumiu

   Ou seja: todo Button renderizava com a cor herdada do body (tinta escura
   sobre acento, ~2,5:1) e todo `size` do Money era decorativo — o número de
   32px saía com 15px. Nada disso aparece em revisão de código: as classes
   estão lá no componente, e somem entre o componente e o DOM.

   A correção é ensinar ao tailwind-merge a escala travada no CLAUDE.md
   (13 / 15 / 17 / 20 / 32) e os degraus de elevação (1 / 2 / 3 / drag). Quem
   adicionar degrau na escala — o que exige aprovação — adiciona aqui também.
   ========================================================================== */

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // escala tipográfica própria (globals.css > @theme inline > --text-13…)
      "font-size": [{ text: ["13", "15", "17", "20", "32"] }],
      // elevação própria (--shadow-1 … --shadow-drag)
      shadow: [{ shadow: ["1", "2", "3", "drag"] }],
    },
  },
});

/** Junta classes e resolve conflitos do Tailwind (a última vence). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
