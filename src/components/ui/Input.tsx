"use client";

import * as React from "react";
import { cn } from "@/lib/ui/cn";
import { useFieldControl } from "./Field";

/* =============================================================================
   Input / Textarea
   -----------------------------------------------------------------------------
   Altura 40 no desktop, 44 no dedo. `font-size: 15px` no mínimo — abaixo de 16
   o iOS dá zoom no foco, e o zoom quebra o layout inteiro da tela.
   (15px + `text-size-adjust: 100%` no html evita o zoom sem estourar a escala.)

   O anel de foco é o mesmo de todo o resto do sistema: outline do :focus-visible
   em globals.css, mais uma borda de acento pra dizer qual campo está ativo
   mesmo quando o foco veio do toque.
   ========================================================================== */

const shell = cn(
  "w-full rounded-md border bg-surface text-ink",
  "border-line",
  "placeholder:text-subtle",
  "[transition:border-color_120ms_var(--curve-out),background-color_120ms_var(--curve-out)]",
  "hover:border-line-strong",
  // o anel de :focus-visible vem do globals.css; aqui só a borda de acento,
  // que aparece também quando o foco veio do toque
  "focus:border-accent",
  "disabled:cursor-not-allowed disabled:bg-inset disabled:text-subtle disabled:opacity-70",
  "aria-[invalid]:border-danger aria-[invalid]:focus:border-danger",
  "read-only:bg-inset",
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> {
  size?: "sm" | "md" | "lg";
  /** Prefixo fixo dentro do campo: "R$", "@", "https://". */
  prefix?: React.ReactNode;
  /** Sufixo: unidade, botão de limpar, contador. */
  suffix?: React.ReactNode;
  /** Alinha à direita e liga tabular-nums — para valor e quantidade. */
  numeric?: boolean;
}

const heights = {
  sm: "h-9 px-2.5 text-13",
  md: "h-10 px-3 text-15 [@media(pointer:coarse)]:h-11",
  lg: "h-12 px-3.5 text-17",
} as const;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input(
    { className, size = "md", prefix, suffix, numeric, ...props },
    ref,
  ) {
    const fieldProps = useFieldControl();
    const merged = { ...fieldProps, ...props };

    const input = (
      <input
        ref={ref}
        className={cn(
          shell,
          heights[size],
          numeric && "text-right tabular-nums",
          (prefix || suffix) &&
            "h-full rounded-none border-0 bg-transparent px-0 focus-visible:outline-none disabled:bg-transparent",
          !prefix && !suffix && className,
        )}
        {...merged}
      />
    );

    if (!prefix && !suffix) return input;

    return (
      <div
        className={cn(
          shell,
          heights[size],
          "flex items-center gap-2",
          "focus-within:border-accent",
          "has-[input:focus-visible]:focus-ring",
          "has-[input:disabled]:bg-inset has-[input:disabled]:opacity-70",
          className,
        )}
      >
        {prefix ? (
          <span className="shrink-0 text-15 text-muted select-none">{prefix}</span>
        ) : null}
        {input}
        {suffix ? (
          <span className="shrink-0 text-13 text-muted">{suffix}</span>
        ) : null}
      </div>
    );
  },
);

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Cresce com o conteúdo até `maxRows`. Sem barra de rolagem interna cedo. */
  autoResize?: boolean;
  maxRows?: number;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { className, autoResize = true, maxRows = 12, rows = 3, onInput, ...props },
    forwardedRef,
  ) {
    const fieldProps = useFieldControl();
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);

    const setRef = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        innerRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    const resize = React.useCallback(() => {
      const node = innerRef.current;
      if (!node || !autoResize) return;
      const style = window.getComputedStyle(node);
      const lineHeight = parseFloat(style.lineHeight) || 22;
      const vertical =
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom) +
        parseFloat(style.borderTopWidth) +
        parseFloat(style.borderBottomWidth);
      node.style.height = "auto";
      node.style.height = `${Math.min(node.scrollHeight, lineHeight * maxRows + vertical)}px`;
    }, [autoResize, maxRows]);

    React.useLayoutEffect(resize, [resize, props.value, props.defaultValue]);

    return (
      <textarea
        ref={setRef}
        rows={rows}
        className={cn(shell, "resize-none px-3 py-2.5 text-15 leading-[1.5]", className)}
        onInput={(event) => {
          resize();
          onInput?.(event);
        }}
        {...fieldProps}
        {...props}
      />
    );
  },
);

/**
 * Contador de caracteres com largura reservada — mesmo princípio do Money.
 * Fica cinza até 90% do limite, depois avisa.
 */
export function CharCount({
  value,
  max,
  className,
}: {
  value: string;
  max: number;
  className?: string;
}) {
  const used = value.length;
  const tight = used > max * 0.9;
  return (
    <span
      data-numeric
      className={cn(
        "shrink-0 text-13 tabular-nums",
        tight ? "text-warn" : "text-muted",
        className,
      )}
      style={{ minWidth: `${String(max).length * 2 + 2}ch` }}
    >
      {used}/{max}
    </span>
  );
}
