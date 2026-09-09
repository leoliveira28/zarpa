import * as React from "react";
import { cn } from "@/lib/ui/cn";
import { initials } from "@/lib/ui/format";

/* =============================================================================
   Monograma — "de quem é isso" sem gastar a cor
   -----------------------------------------------------------------------------
   §8 de docs/MULTIUSUARIO_AGENCIAS.md e regra travada do CLAUDE.md (uma cor de
   destaque, só para onde se clica): identidade de agente NUNCA leva cor. O
   monograma é o mesmo gesto do <Rule /> fechado em círculo — CONTORNO em
   `currentColor`, nunca preenchido, nunca uma cor por pessoa. Um avatar
   colorido por agente é exatamente o visual de template SaaS que o produto
   proíbe; traço, não tinta, é o que envelhece bem.

   O usuário atual se distingue por PESO TIPOGRÁFICO no nome ao lado (font-
   semibold), nunca por fundo no monograma — quem decide quem é você é a
   tipografia, não uma pílula.

   `aria-hidden` de propósito: o monograma repete as iniciais de um nome que
   SEMPRE mora ao lado (linha de lista, célula de tabela, card). Ler "ML
   Marina Lima" para o leitor de tela é ler duas vezes. Se um dia ele for usado
   sozinho, remova o aria-hidden e etiquete.
   ========================================================================== */

const sizes = {
  /** 24px — linha de card de funil e célula de tabela. */
  sm: "size-6 text-13",
  /** 36px — linha de lista (Equipe). */
  md: "size-9 text-13",
  /** 48px — cabeçalho, uso raro. */
  lg: "size-12 text-15",
} as const;

export interface MonogramProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Nome completo — as iniciais (máx. 2 letras) vêm de `initials()`. */
  name: string;
  size?: keyof typeof sizes;
}

export function Monogram({ name, size = "md", className, ...props }: MonogramProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 select-none place-items-center rounded-full",
        "border border-current leading-none",
        sizes[size],
        className,
      )}
      {...props}
    >
      {initials(name)}
    </span>
  );
}
