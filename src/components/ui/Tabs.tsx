"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion } from "motion/react";
import { cn } from "@/lib/ui/cn";
import { useTransitionPreset } from "@/lib/ui/motion";

/* =============================================================================
   Tabs
   -----------------------------------------------------------------------------
   O sublinhado é um único elemento que VIAJA entre as abas (layoutId do motion),
   em vez de aparecer e sumir. Isso conta a direção da mudança — o olho segue o
   traço e sabe de onde veio.

   Rola horizontalmente no celular sem barra visível, com padding de sangria
   para a última aba não colar na borda.
   ========================================================================== */

const TabsContext = React.createContext<string>("zarpa-tabs");

export function Tabs({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>) {
  const id = React.useId();
  return (
    <TabsContext.Provider value={id}>
      <TabsPrimitive.Root className={cn("flex flex-col", className)} {...props} />
    </TabsContext.Provider>
  );
}

export function TabsList({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "relative -mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        // cornija: separa a fita de abas do painel, e usa o fio do sistema
        "border-b border-hairline",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  children,
  count,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
  count?: number;
}) {
  const groupId = React.useContext(TabsContext);
  const transition = useTransitionPreset("snap");

  return (
    <TabsPrimitive.Trigger
      className={cn(
        "group relative shrink-0 px-3 pt-2 pb-2.5 text-15 font-medium whitespace-nowrap",
        "text-muted transition-colors duration-[120ms]",
        "hover:text-ink",
        "data-[state=active]:text-ink",
        "disabled:pointer-events-none disabled:opacity-45",
        "[@media(pointer:coarse)]:min-h-11",
        className,
      )}
      {...props}
    >
      <span className="flex items-center gap-2">
        {children}
        {typeof count === "number" ? (
          <span
            data-numeric
            className="rounded-sm bg-surface-3 px-1.5 text-13 tabular-nums text-muted group-data-[state=active]:bg-accent-soft group-data-[state=active]:text-accent-soft-ink"
          >
            {count}
          </span>
        ) : null}
      </span>
      <TabUnderline groupId={groupId} transition={transition} />
    </TabsPrimitive.Trigger>
  );
}

/**
 * O traço só é renderizado na aba ativa; o `layoutId` faz o motion animar a
 * troca de posição como se fosse o mesmo objeto se mudando de lugar.
 */
function TabUnderline({
  groupId,
  transition,
}: {
  groupId: string;
  transition: ReturnType<typeof useTransitionPreset>;
}) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 group-data-[state=inactive]:hidden"
    >
      <motion.span
        layoutId={`${groupId}-underline`}
        transition={transition}
        className="block h-full w-full rounded-pill bg-accent"
      />
    </span>
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      // o painel é focável (Radix põe tabIndex=0); o anel de foco fica
      className={cn("pt-4", className)}
      {...props}
    />
  );
}
