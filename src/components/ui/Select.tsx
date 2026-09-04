"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { cn } from "@/lib/ui/cn";
import { useFieldControl } from "./Field";

/* =============================================================================
   Select
   -----------------------------------------------------------------------------
   Radix Select por causa do teclado e do leitor de tela; visual todo nosso.
   O painel entra em `opacity` + `scale(0.97)` ancorado no gatilho — sem
   deslizar de lugar nenhum, porque a lista não "vem de fora", ela cresce de
   onde você clicou.
   ========================================================================== */

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & {
    size?: "sm" | "md";
  }
>(function SelectTrigger({ className, children, size = "md", ...props }, ref) {
  const fieldProps = useFieldControl();
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md border bg-surface text-left text-ink",
        "border-line",
        size === "sm"
          ? "h-9 px-2.5 text-13"
          : "h-10 px-3 text-15 [@media(pointer:coarse)]:h-11",
        "[transition:border-color_120ms_var(--curve-out),background-color_120ms_var(--curve-out)]",
        "hover:border-line-strong",
        "data-[state=open]:border-accent",
        "data-[placeholder]:text-muted",
        "disabled:cursor-not-allowed disabled:bg-inset disabled:opacity-70",
        "aria-[invalid]:border-danger",
        className,
      )}
      {...fieldProps}
      {...props}
    >
      <span className="truncate">{children}</span>
      <SelectPrimitive.Icon asChild>
        <ChevronGlyph className="shrink-0 text-subtle" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

export const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent(
  { className, children, position = "popper", ...props },
  ref,
) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        sideOffset={6}
        className={cn(
          "zk-pop relative z-50 max-h-[min(24rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)]",
          "overflow-hidden rounded-lg border border-line bg-surface shadow-3",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

export const SelectLabel = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(function SelectLabel({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Label
      ref={ref}
      className={cn(
        "px-2 py-1.5 text-13 font-semibold tracking-[0.04em] text-muted uppercase",
        className,
      )}
      {...props}
    />
  );
});

export const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item> & {
    hint?: React.ReactNode;
  }
>(function SelectItem({ className, children, hint, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        "relative flex cursor-pointer items-center gap-2 rounded-md py-2 pr-2 pl-8 text-15 text-ink outline-none select-none",
        "min-h-9 [@media(pointer:coarse)]:min-h-11",
        "data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent-soft-ink",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 grid size-4 place-items-center">
        <SelectPrimitive.ItemIndicator>
          <TickGlyph />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      {hint ? (
        <span className="ml-auto pl-3 text-13 text-muted">{hint}</span>
      ) : null}
    </SelectPrimitive.Item>
  );
});

export function SelectSeparator({ className }: { className?: string }) {
  return (
    <SelectPrimitive.Separator
      className={cn("my-1 h-px bg-line-subtle", className)}
    />
  );
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
