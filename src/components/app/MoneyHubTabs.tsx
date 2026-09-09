"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/ui/cn";
import { chaveDoParamPeriodo } from "@/lib/ui/periodo";

/* =============================================================================
   MoneyHubTabs — o segmented control que liga /vendas, /financeiro e /relatorios
   -----------------------------------------------------------------------------
   Mesma gramática visual do `ViewToggle` do construtor de proposta
   (editar/prévia): três rotas de verdade, cada uma com seu Server Action
   próprio, que a agente enxerga como UMA pergunta ("fechei, me pagaram? —
   e de onde veio?"). Ver a nota em `AppShell.tsx` (`NavItem.activeMatch`)
   sobre por que isso não virou um sexto ícone na barra inferior.

   As três abas CARREGAM o `?periodo=` (§1: o recorte mora na URL). São uma
   pergunta só sobre a MESMA janela de tempo: quem está olhando o trimestre em
   Vendas e toca em Relatórios quer o trimestre, não o mês corrente. Trocar de
   aba resetando o recorte em silêncio é a interface desfazendo a escolha da
   agente sem avisar. O parâmetro vem da página (server), como no
   `PeriodoSeletor` — nada de `useSearchParams` só para reler o que já desceu.
   ========================================================================== */

const TABS = [
  { href: "/vendas", label: "Vendas" },
  { href: "/financeiro", label: "Recebíveis" },
  { href: "/relatorios", label: "Relatórios" },
] as const;

export function MoneyHubTabs({ periodoParam }: { periodoParam?: string }) {
  const pathname = usePathname();
  // Param torto (link editado à mão) NÃO viaja para a próxima aba: o
  // `PeriodoInvalidoCard` já explica o problema na tela onde ele apareceu, e
  // propagar lixo faria o erro perseguir a agente pelo hub inteiro.
  const carregavel = periodoParam && chaveDoParamPeriodo(periodoParam) !== "invalido" ? periodoParam : null;
  const query = carregavel ? `?periodo=${encodeURIComponent(carregavel)}` : "";
  return (
    <div className="inline-flex w-fit gap-0.5 rounded-md bg-surface-2 p-0.5">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={`${tab.href}${query}`}
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
