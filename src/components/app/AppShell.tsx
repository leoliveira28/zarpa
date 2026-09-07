"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "motion/react";
import { cn } from "@/lib/ui/cn";
import { APP_NAME } from "@/lib/ui/brand";
import { useTransitionPreset } from "@/lib/ui/motion";
import { signOut } from "@/lib/auth/client";
import { Button } from "@/components/ui/Button";
import { NovaPropostaSheet } from "./NovaPropostaSheet";
import { ThemeToggle } from "./ThemeToggle";
import {
  ClientsIcon,
  FunnelIcon,
  MoneyIcon,
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
  /**
   * Rotas extras que acendem este mesmo item. Existe por causa de "Dinheiro":
   * `/vendas` e `/financeiro` (S9) são duas telas com contratos de servidor
   * diferentes, mas para a agente são a MESMA pergunta ("fechei, me pagaram?")
   * — colocar as duas na barra inferior custaria o sexto ícone num alvo de
   * toque que já está no limite em 390px. Dentro de cada tela, um segmented
   * control (`MoneyHubTabs`, `vendas/shared.tsx`) troca de uma para outra sem
   * esconder rota nenhuma: as duas continuam linkáveis e indexáveis, só não
   * duplicam item de navegação principal.
   */
  activeMatch?: string[];
}

const NAV: NavItem[] = [
  { href: "/hoje", label: "Hoje", icon: TodayIcon },
  { href: "/funil", label: "Funil", icon: FunnelIcon },
  { href: "/propostas", label: "Propostas", icon: ProposalIcon },
  { href: "/clientes", label: "Clientes", icon: ClientsIcon },
  { href: "/vendas", label: "Dinheiro", icon: MoneyIcon, activeMatch: ["/financeiro"] },
];

/**
 * Rotas de QUADRO: ocupam a largura útil da janela e não rolam a página.
 *
 * O `max-w-[64rem]` do miolo existe para medida de linha — Hoje, Propostas e
 * Clientes são leitura, e leitura larga demais cansa. O funil não é leitura: é
 * uma comparação entre cinco conjuntos, e comparar pede que os cinco caibam na
 * tela ao mesmo tempo. Espremer isso em 64rem é o que fazia a tela parecer um
 * padrão de celular esticado.
 *
 * A exceção mora AQUI, nomeada, e não em margem negativa dentro da tela: uma
 * `-mx-*` que tenta desfazer um `mx-auto max-w` não desfaz — ela desalinha, e
 * some no dia em que o shell mudar de padding.
 */
const WIDE_ROUTES = ["/funil"];

/**
 * O construtor de proposta (S5/S6) entra na mesma exceção, mas só a TELA DE
 * EDIÇÃO — a lista de propostas continua com medida de linha, como Clientes.
 * O editor precisa da largura da janela porque no desktop ele é DOIS
 * registros lado a lado (miolo silencioso + prévia editorial); comprimir os
 * dois em 64rem é o que fazia o preview nascer estreito demais para
 * comunicar "é assim que o cliente vê".
 */
const WIDE_PATH_PATTERNS = [/^\/propostas\/[^/]+\/editar$/];

function useWideRoute(): boolean {
  const pathname = usePathname();
  return React.useMemo(
    () =>
      WIDE_ROUTES.some(
        (route) => pathname === route || pathname.startsWith(`${route}/`),
      ) || WIDE_PATH_PATTERNS.some((pattern) => pattern.test(pathname)),
    [pathname],
  );
}

function useActiveHref() {
  const pathname = usePathname();
  return React.useMemo(() => {
    const hits = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
    const match = NAV.find(
      (item) => hits(item.href) || item.activeMatch?.some(hits),
    );
    return match?.href ?? null;
  }, [pathname]);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const activeHref = useActiveHref();
  const pathname = usePathname();
  const wide = useWideRoute();
  const title =
    NAV.find((item) => item.href === activeHref)?.label ??
    (pathname === "/kitchen-sink" ? "Kitchen sink" : APP_NAME);

  return (
    <div
      className={cn(
        "min-h-dvh bg-bg lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]",
        // altura travada na viewport: quem rola passa a ser o conteúdo do
        // quadro, não a página. Só no desktop — no celular a página rola.
        wide && "lg:h-dvh",
      )}
    >
      <SideNav activeHref={activeHref} />

      <div
        className={cn(
          "flex min-h-dvh min-w-0 flex-col",
          wide && "lg:h-full lg:min-h-0",
        )}
      >
        <TopBar title={title} />

        <main
          id="conteudo"
          className={cn(
            "mx-auto w-full max-w-[64rem] flex-1 px-4 py-4",
            // espaço para a barra inferior + safe area do iPhone
            "pb-[calc(env(safe-area-inset-bottom,0px)+5.5rem)]",
            "sm:px-6 lg:px-8 lg:pb-10",
            wide &&
              cn(
                "lg:mx-0 lg:max-w-none",
                // min-h-0 é o que permite a um filho rolar dentro de um flex:
                // sem ele o item cresce até o conteúdo e a página volta a rolar
                "lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden",
                "lg:px-6 lg:pb-6",
              ),
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
    <aside className="sticky top-0 hidden h-dvh flex-col border-r border-hairline bg-surface lg:flex">
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

      <div className="mt-auto flex flex-col gap-3 border-t border-hairline p-3">
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
        <SignOutButton />
      </div>
    </aside>
  );
}

/**
 * Fecha o ciclo da sessão pelo lado de dentro: sem isto, `/entrar` existia
 * mas ninguém tinha como voltar para lá a não ser apagando cookie na mão.
 * `signOut()` derruba a sessão no servidor; o `router.push` + `refresh` força
 * o layout de `(app)` a rodar de novo e encontrar `getAuthContext()` vazio —
 * o mesmo caminho que qualquer rota sem sessão já passa.
 */
function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function handleSignOut() {
    setPending(true);
    await signOut();
    router.push("/entrar");
    router.refresh();
  }

  return (
    <button
      type="button"
      onPointerDown={handleSignOut}
      disabled={pending}
      data-disabled={pending || undefined}
      className={cn(
        "rounded-md px-3 py-2 text-left text-13 text-muted",
        "hover:bg-surface-3 hover:text-ink",
        "data-[disabled]:pointer-events-none data-[disabled]:text-subtle",
      )}
    >
      {pending ? "Saindo…" : "Sair"}
    </button>
  );
}

/* -------------------------------------------------------------------- topo */

/**
 * O "+" do topo é o único CTA global do app — mesmo botão em toda tela
 * autenticada. Abre `NovaPropostaSheet` SEM `negocioFixo`: o agente está
 * em qualquer lugar (Hoje, Funil, Clientes) e precisa escolher o negócio
 * de origem no Combobox (`listarNegocios`). Os outros dois pontos de
 * entrada da mesma Sheet (PropostasScreen sem `negocioFixo`; ficha do
 * negócio COM `negocioFixo`) são o mesmo desenho, só variando se a busca
 * do negócio já está decidida ou não.
 */
function TopBar({ title }: { title: string }) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = React.useState(false);

  return (
    <>
      <header
        className={cn(
          "veil sticky top-0 z-30 border-b border-hairline",
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
          <Button
            variant="primary"
            size="sm"
            onPointerDown={() => setSheetOpen(true)}
          >
            <PlusIcon className="size-4" />
            <span className="hidden sm:inline">Nova proposta</span>
            <span className="sr-only sm:hidden">Nova proposta</span>
          </Button>
        </div>
      </header>

      <NovaPropostaSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onCreated={(id) => {
          setSheetOpen(false);
          router.push(`/propostas/${id}/editar`);
        }}
      />
    </>
  );
}

/* ----------------------------------------------------------------- inferior */

function BottomNav({ activeHref }: { activeHref: string | null }) {
  const transition = useTransitionPreset("snap");
  return (
    <nav
      aria-label="Principal"
      className={cn(
        "veil-strong fixed inset-x-0 bottom-0 z-30 border-t border-hairline lg:hidden",
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
