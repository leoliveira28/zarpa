"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { cn } from "@/lib/ui/cn";
import { APP_NAME } from "@/lib/ui/brand";
import { useTransitionPreset } from "@/lib/ui/motion";
import { Button } from "@/components/ui/Button";
import { ThemeToggle } from "./ThemeToggle";
import {
  ClientsIcon,
  FunnelIcon,
  PlusIcon,
  ProposalIcon,
  TodayIcon,
} from "./icons";

/* =============================================================================
   Shell do app
   -----------------------------------------------------------------------------
   Mobile-first de verdade: a barra inferior é a navegação principal, não um
   consolo pra tela pequena. O agente de viagem trabalha do celular, entre um
   compromisso e outro.

     celular  → barra inferior fixa (4 destinos, alvo de 56px) + topo translúcido
     desktop  → coluna lateral fixa de 15rem; a barra inferior some

   A barra superior usa `backdrop-filter: blur(20px) saturate(180%)` (utilitária
   `veil`). Com `prefers-reduced-transparency` os tokens já trocam o véu por
   superfície sólida — nenhuma regra a mais aqui.
   ========================================================================== */

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}

const NAV: NavItem[] = [
  { href: "/hoje", label: "Hoje", icon: TodayIcon },
  { href: "/funil", label: "Funil", icon: FunnelIcon },
  { href: "/propostas", label: "Propostas", icon: ProposalIcon },
  { href: "/clientes", label: "Clientes", icon: ClientsIcon },
];

function useActiveHref() {
  const pathname = usePathname();
  return React.useMemo(() => {
    const match = NAV.find(
      (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    );
    return match?.href ?? null;
  }, [pathname]);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const activeHref = useActiveHref();
  const pathname = usePathname();
  const title =
    NAV.find((item) => item.href === activeHref)?.label ??
    (pathname === "/kitchen-sink" ? "Kitchen sink" : APP_NAME);

  return (
    <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <SideNav activeHref={activeHref} />

      <div className="flex min-h-dvh min-w-0 flex-col">
        <TopBar title={title} />

        <main
          id="conteudo"
          className={cn(
            "mx-auto w-full max-w-[64rem] flex-1 px-4 py-4",
            // espaço para a barra inferior + safe area do iPhone
            "pb-[calc(env(safe-area-inset-bottom,0px)+5.5rem)]",
            "sm:px-6 lg:px-8 lg:pb-10",
          )}
        >
          {children}
        </main>
      </div>

      <BottomNav activeHref={activeHref} />
    </div>
  );
}

/* ------------------------------------------------------------------ lateral */

function SideNav({ activeHref }: { activeHref: string | null }) {
  const transition = useTransitionPreset("snap");
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">
      <div className="flex h-14 shrink-0 items-center gap-2 px-5">
        <Wordmark />
      </div>

      <nav aria-label="Principal" className="flex flex-col gap-0.5 px-3 py-2">
        {NAV.map((item) => {
          const active = item.href === activeHref;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-10 items-center gap-3 rounded-md px-3 text-15",
                "transition-colors duration-[120ms]",
                active ? "text-ink" : "text-muted hover:bg-surface-3 hover:text-ink",
              )}
            >
              {active ? (
                <motion.span
                  layoutId="sidenav-active"
                  transition={transition}
                  className="absolute inset-0 rounded-md bg-accent-soft"
                />
              ) : null}
              <item.icon className="relative size-4 shrink-0" />
              <span className="relative font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-3 border-t border-line p-3">
        <Link
          href="/kitchen-sink"
          className="rounded-md px-3 py-2 text-13 text-muted hover:bg-surface-3 hover:text-ink"
        >
          Kitchen sink
        </Link>
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-13 text-muted">Tema</span>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------- topo */

function TopBar({ title }: { title: string }) {
  return (
    <header
      className={cn(
        "veil sticky top-0 z-30 border-b border-line",
        "flex h-14 shrink-0 items-center gap-3 px-4 sm:px-6 lg:px-8",
      )}
    >
      <span className="lg:hidden">
        <Wordmark compact />
      </span>

      <h1 className="hidden truncate text-17 font-semibold text-ink lg:block">
        {title}
      </h1>

      <div className="ml-auto flex items-center gap-2">
        <span className="lg:hidden">
          <ThemeToggle />
        </span>
        <Button variant="primary" size="sm">
          <PlusIcon className="size-4" />
          <span className="hidden sm:inline">Nova proposta</span>
          <span className="sr-only sm:hidden">Nova proposta</span>
        </Button>
      </div>
    </header>
  );
}

/* ----------------------------------------------------------------- inferior */

function BottomNav({ activeHref }: { activeHref: string | null }) {
  const transition = useTransitionPreset("snap");
  return (
    <nav
      aria-label="Principal"
      className={cn(
        "veil-strong fixed inset-x-0 bottom-0 z-30 border-t border-line lg:hidden",
        "pb-safe",
      )}
    >
      <ul className="flex items-stretch">
        {NAV.map((item) => {
          const active = item.href === activeHref;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-14 flex-col items-center justify-center gap-1",
                  "transition-colors duration-[120ms]",
                  active ? "text-accent" : "text-muted",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="bottomnav-active"
                    transition={transition}
                    className="absolute inset-x-4 top-0 h-0.5 rounded-pill bg-accent"
                  />
                ) : null}
                <item.icon className="size-5" />
                <span className="text-13 leading-none font-medium">
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* --------------------------------------------------------------- marca */

/**
 * Marca provisória: o nome comercial ainda não foi decidido (CLAUDE.md), então
 * nada de logotipo. Uma vela estilizada + o codinome, os dois trocáveis num
 * arquivo só.
 */
function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className="grid size-7 place-items-center rounded-sm bg-accent text-on-accent"
      >
        <svg
          viewBox="0 0 16 16"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        >
          <path d="M8 2.5 12.5 10H8z" />
          <path d="M7 5.5 3.5 10H7z" />
          <path d="M2.5 12.25h11" />
        </svg>
      </span>
      <span
        className={cn(
          "text-17 font-semibold tracking-[-0.01em] text-ink",
          compact && "sr-only sm:not-sr-only",
        )}
      >
        {APP_NAME}
      </span>
    </span>
  );
}
