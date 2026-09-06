"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/ui/cn";
import { useFieldControl } from "./Field";
import { Skeleton } from "./Skeleton";

/* =============================================================================
   Combobox — buscar e escolher
   -----------------------------------------------------------------------------
   Radix não tem combobox, então a navegação por teclado é nossa: setas para
   percorrer, Enter escolhe, Esc fecha, Home/End nas pontas, e o item ativo
   sempre rolado para dentro da vista. `aria-activedescendant` mantém o foco no
   campo de texto — o leitor de tela anuncia a opção sem perder o que foi digitado.

   Nunca esconde a lista enquanto carrega: mostra skeletons no mesmo formato
   das linhas, então nada pula quando o resultado chega.
   ========================================================================== */

export interface ComboboxOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value?: string | null;
  onValueChange?: (value: string | null) => void;
  placeholder?: string;
  /** Texto do campo de busca dentro do painel. */
  searchPlaceholder?: string;
  emptyMessage?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  id?: string;
  /** Nasce aberto. Só para o /kitchen-sink mostrar o painel parado. */
  defaultOpen?: boolean;
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Selecione",
  searchPlaceholder = "Buscar",
  emptyMessage = "Nada encontrado",
  loading = false,
  disabled,
  invalid,
  className,
  id,
  defaultOpen = false,
}: ComboboxProps) {
  const fieldProps = useFieldControl();
  const [open, setOpen] = React.useState(defaultOpen);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();

  const selected = options.find((option) => option.value === value) ?? null;

  const filtered = React.useMemo(() => {
    const needle = normalize(query);
    if (!needle) return options;
    return options.filter((option) =>
      normalize(`${option.label} ${option.hint ?? ""}`).includes(needle),
    );
  }, [options, query]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  // mantém o item ativo visível sem sequestrar o scroll da página
  React.useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function move(delta: number) {
    if (filtered.length === 0) return;
    setActiveIndex((current) => {
      let next = current;
      for (let step = 0; step < filtered.length; step++) {
        next = (next + delta + filtered.length) % filtered.length;
        if (!filtered[next]?.disabled) return next;
      }
      return current;
    });
  }

  function choose(index: number) {
    const option = filtered[index];
    if (!option || option.disabled) return;
    onValueChange?.(option.value === value ? null : option.value);
    setOpen(false);
    setQuery("");
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          id={id ?? fieldProps.id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-invalid={invalid || fieldProps["aria-invalid"]}
          aria-describedby={fieldProps["aria-describedby"]}
          disabled={disabled ?? fieldProps.disabled}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-md border bg-surface px-3 text-left text-15 text-ink",
            "h-10 border-line [@media(pointer:coarse)]:h-11",
            "[transition:border-color_120ms_var(--curve-out)]",
            "hover:border-line-strong data-[state=open]:border-accent",
            "disabled:cursor-not-allowed disabled:bg-inset disabled:opacity-70",
            "aria-[invalid]:border-danger",
            className,
          )}
        >
          <span className={cn("truncate", !selected && "text-muted")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronGlyph className="shrink-0 text-subtle" />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          sideOffset={6}
          align="start"
          className={cn(
            "zk-pop z-50 w-[var(--radix-popover-trigger-width)] overflow-hidden",
            "rounded-lg border border-line bg-surface shadow-3",
          )}
          onOpenAutoFocus={(event) => {
            // o foco vai pro campo de busca, não pro primeiro item
            event.preventDefault();
            (
              event.currentTarget as HTMLElement
            ).querySelector<HTMLInputElement>("input")?.focus();
          }}
        >
          <div className="border-b border-line-subtle p-1">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              autoComplete="off"
              role="searchbox"
              aria-controls={listId}
              aria-activedescendant={
                filtered[activeIndex]
                  ? `${listId}-${filtered[activeIndex].value}`
                  : undefined
              }
              className="h-9 w-full rounded-md bg-transparent px-2 text-15 text-ink placeholder:text-subtle focus-visible:outline-none"
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  move(1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  move(-1);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  setActiveIndex(0);
                } else if (event.key === "End") {
                  event.preventDefault();
                  setActiveIndex(Math.max(0, filtered.length - 1));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  choose(activeIndex);
                }
              }}
            />
          </div>

          <div
            ref={listRef}
            id={listId}
            role="listbox"
            className="max-h-64 overflow-y-auto overscroll-contain p-1"
          >
            {loading ? (
              <div className="flex flex-col gap-1 p-1">
                {[0, 1, 2].map((row) => (
                  <Skeleton key={row} className="h-8 rounded-md" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-13 text-muted">
                {emptyMessage}
              </p>
            ) : (
              filtered.map((option, index) => (
                <div
                  key={option.value}
                  id={`${listId}-${option.value}`}
                  data-index={index}
                  role="option"
                  aria-selected={option.value === value}
                  aria-disabled={option.disabled || undefined}
                  onPointerDown={(event) => {
                    // decide no pointerdown: no celular o click chega tarde
                    event.preventDefault();
                    choose(index);
                  }}
                  onPointerMove={() => setActiveIndex(index)}
                  className={cn(
                    "flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-15",
                    "[@media(pointer:coarse)]:min-h-11",
                    index === activeIndex
                      ? "bg-accent-soft text-accent-soft-ink"
                      : "text-ink",
                    option.disabled && "pointer-events-none opacity-45",
                  )}
                >
                  <span className="grid size-4 shrink-0 place-items-center">
                    {option.value === value ? <TickGlyph /> : null}
                  </span>
                  <span className="truncate">{option.label}</span>
                  {option.hint ? (
                    <span className="ml-auto pl-3 text-13 text-muted">
                      {option.hint}
                    </span>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("size-4", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
    </svg>
  );
}

function TickGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5 text-accent"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3.25 8.5 6.5 11.75 12.75 4.75" />
    </svg>
  );
}
