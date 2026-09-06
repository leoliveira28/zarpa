"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/ui/cn";

/* =============================================================================
   MoneyHubTabs — o segmented control que liga /vendas e /financeiro
   -----------------------------------------------------------------------------
   Mesma gramática visual do `ViewToggle` do construtor de proposta
   (editar/prévia): duas rotas de verdade, cada uma com seu Server Action
   próprio, que a agente enxerga como UMA pergunta ("fechei, me pagaram?").
   Ver a nota em `AppShell.tsx` (`NavItem.activeMatch`) sobre por que isso
   não virou um sexto ícone na barra inferior.
   ========================================================================== */

const TABS = [
  { href: "/vendas", label: "Vendas" },
  { href: "/financeiro", label: "Recebíveis" },
] as const;

export function MoneyHubTabs() {
  const pathname = usePathname();
  return (
    <div className="inline-flex w-fit gap-0.5 rounded-md bg-surface-2 p-0.5">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-9 items-center rounded-sm px-3.5 text-13 font-medium",
              active ? "bg-surface text-ink shadow-1" : "text-muted",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
