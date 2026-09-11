"use client";

import * as React from "react";
import Link from "next/link";
import { Assinatura } from "@/components/public/Assinatura";
import { Money } from "@/components/ui/Money";
import { waMeLink } from "@/lib/ui/whatsapp";
import { TIPO_LABEL, type OfertaTipo } from "@/lib/ui/ofertaTipo";
import type { VitrinePublica } from "@/server/offers";

/* =============================================================================
   A Vitrine pública — o catálogo do agente, sem login
   -----------------------------------------------------------------------------
   Rodada Decolar: a ENERGIA de vitrine de travel (hero grande com foto do
   destino, cartão de busca flutuante na base do hero, cards vendáveis com
   faixa de lugares e preço com "a partir de", linha de confiança abaixo do
   grid) dentro dos tokens da casa. O cartão de busca da Decolar aqui vira a
   barra de FILTROS por tipo (com contagem — filtro que não diz quanto esconde
   é filtro que não se usa); a lógica de filtro e os contratos de dados são os
   mesmos da rodada anterior.
   ========================================================================== */

type OfertaDoCatalogo = VitrinePublica["ofertas"][number];

/** Foto do hero — a mesma via do seed (`capa()` em src/db/seed.ts). */
const HERO_CAPA =
  "https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=1600&q=70";

export function VitrinePublicaScreen({
  slug,
  vitrine,
}: {
  slug: string;
  vitrine: VitrinePublica | null;
}) {
  if (!vitrine || !vitrine.agencia) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-20 text-ink">Esta vitrine não está disponível.</p>
        <p className="text-15 text-muted">
          Confira o link com a agência — talvez o endereço tenha mudado.
        </p>
      </main>
    );
  }

  const { agencia, ofertas } = vitrine;
  const whatsapp = agencia.whatsapp ? waMeLink(agencia.whatsapp) : null;

  return (
    <div className="min-h-dvh bg-bg">
      {/* Cabeçalho com menu — a mesma fixação das páginas de oferta dos
          players: marca à esquerda, contato à direita, papel sobre o
          conteúdo ao rolar. */}
      <header className="veil sticky top-0 z-30 border-b border-hairline">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-5 sm:px-8">
          <span className="flex items-center gap-2.5">
            {agencia.logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- logo da marca pública, mesma via de /p/
              <img src={agencia.logo} alt="" className="size-8 rounded-full object-cover" />
            ) : null}
            <span className="text-15 font-semibold text-ink">{agencia.nome}</span>
          </span>
          <nav
            aria-label="Seções da página"
            className="hidden items-center gap-5 text-13 font-medium text-muted sm:flex"
          >
            <a
              href="#ofertas"
              className="hover:text-ink hover:underline hover:underline-offset-4"
            >
              Ofertas
            </a>
            {whatsapp ? (
              <a
                href={whatsapp}
                target="_blank"
                rel="noopener"
                className="hover:text-ink hover:underline hover:underline-offset-4"
              >
                Contato
              </a>
            ) : null}
          </nav>
          {whatsapp ? (
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener"
              className="flex min-h-9 items-center rounded-md bg-accent px-4 text-13 font-medium text-on-accent hover:bg-accent-hover"
            >
              Falar com a agência
            </a>
          ) : null}
        </div>
      </header>

      {/* Hero grande — foto do destino, véu e gradiente escuro para o título
          branco respirar nos dois temas. A cor constante (`white`, primitivo
          do Tailwind, já usado em /p/) é de propósito: nenhum token semântico
          de texto serve sobre foto, porque todos trocam de tema. */}
      <section className="relative isolate overflow-hidden bg-plate">
        {/* eslint-disable-next-line @next/next/no-img-element -- capa do hero público, mesma via do seed */}
        <img
          src={HERO_CAPA}
          alt=""
          className="absolute inset-0 size-full object-cover"
        />
        <div aria-hidden className="absolute inset-0 bg-scrim" />
        <div
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(to_top,var(--scrim),var(--scrim)_30%,transparent_72%)]"
        />
        <div className="relative mx-auto flex max-w-5xl flex-col gap-3 px-5 pb-20 pt-16 sm:px-8 sm:pb-24 sm:pt-24">
          <p className="text-13 font-medium uppercase tracking-wider text-white/85">
            Pacotes · Voos · Hospedagens · Serviços
          </p>
          <h1 className="display text-32 text-white">Ofertas da {agencia.nome}</h1>
          <p className="max-w-[36rem] text-15 leading-[1.5] text-white/85">
            Montadas por quem acompanha você na viagem — com preço na mesa e sem
            letra miúda.
          </p>
        </div>
      </section>

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-5 pb-16 sm:px-8">
        <Catalogo slug={slug} ofertas={ofertas} />
      </main>

      <footer className="border-t border-hairline bg-surface">
        <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
          <Assinatura
            marca={{ brandName: agencia.nome, agentDisplayName: agencia.agentName }}
            instagram={agencia.instagram}
          />
        </div>
      </footer>
    </div>
  );
}

/* -----------------------------------------------------------------------------
   Catálogo — o cartão de busca flutuante (filtros por tipo, com contagem)
   sobre a base do hero + grid de cards vendáveis + linha de confiança.
   ------------------------------------------------------------------------- */

function Catalogo({
  slug,
  ofertas,
}: {
  slug: string;
  ofertas: OfertaDoCatalogo[];
}) {
  const [filtro, setFiltro] = React.useState<OfertaTipo | "todos">("todos");

  const tipos = React.useMemo(() => {
    const contagem = new Map<OfertaTipo, number>();
    for (const oferta of ofertas) {
      const tipo = oferta.type as OfertaTipo;
      contagem.set(tipo, (contagem.get(tipo) ?? 0) + 1);
    }
    return contagem;
  }, [ofertas]);

  const visiveis = filtro === "todos" ? ofertas : ofertas.filter((o) => o.type === filtro);

  return (
    <>
      {/* Cartão de busca flutuante — sobreposto à base do hero, como a busca
          da Decolar. Aqui dentro mora a barra de filtros por tipo. */}
      {ofertas.length > 1 ? (
        <div className="relative z-10 -mt-12 sm:-mt-10">
          <div className="rounded-xl border border-line bg-surface p-4 shadow-3">
            <p className="text-13 font-medium text-subtle">Filtrar por tipo</p>
            <div className="mt-2.5 flex flex-wrap gap-2" role="group" aria-label="Filtrar por tipo">
              <Filtro
                ativo={filtro === "todos"}
                onClick={() => setFiltro("todos")}
                label="Todos"
                contagem={ofertas.length}
              />
              {[...tipos.entries()].map(([tipo, contagem]) => (
                <Filtro
                  key={tipo}
                  ativo={filtro === tipo}
                  onClick={() => setFiltro(tipo)}
                  label={TIPO_LABEL[tipo] ?? tipo}
                  contagem={contagem}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <section id="ofertas" className="flex scroll-mt-20 flex-col gap-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-20 font-semibold text-ink">Ofertas</h2>
          <span className="text-13 tabular-nums text-muted">
            {visiveis.length} {visiveis.length === 1 ? "oferta" : "ofertas"}
          </span>
        </div>

        {visiveis.length === 0 ? (
          <p className="text-15 text-muted">Nenhuma oferta publicada por enquanto.</p>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {visiveis.map((oferta) => (
              <li key={oferta.id}>
                <Link
                  href={`/a/${slug}/o/${oferta.token}`}
                  className="group flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2 [transition:transform_200ms_var(--curve-out)] hover:-translate-y-0.5 active:translate-y-0"
                >
                  <span className="relative block">
                    {oferta.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- capa da oferta pública (mesma via de /p/)
                      <img src={oferta.coverUrl} alt="" className="aspect-[16/9] w-full object-cover" />
                    ) : (
                      <span className="block aspect-[16/9] w-full bg-surface-2" />
                    )}
                    {oferta.temLugares ? (
                      <span className="absolute left-3 top-3 inline-flex items-center rounded-full border border-warn bg-warn-soft px-2.5 py-1 text-13 font-semibold uppercase tracking-wider text-warn-soft-ink shadow-1">
                        Restam {oferta.lugaresRestantes} lugares
                      </span>
                    ) : null}
                  </span>
                  <span className="flex flex-1 flex-col gap-1.5 p-4">
                    <span className="text-13 font-semibold uppercase tracking-wider text-subtle">
                      {TIPO_LABEL[oferta.type as OfertaTipo] ?? oferta.type}
                    </span>
                    <span className="text-17 font-semibold leading-snug text-ink">{oferta.title}</span>
                    {oferta.summary ? (
                      <span className="line-clamp-2 text-13 leading-[1.5] text-muted">
                        {oferta.summary}
                      </span>
                    ) : null}
                    <span className="mt-auto flex flex-col gap-0.5 pt-3">
                      <span className="text-13 font-medium uppercase tracking-wider text-subtle">
                        A partir de
                      </span>
                      <Money
                        cents={oferta.priceCents}
                        size="20"
                        align="left"
                        reserveFor={50_000_000}
                      />
                    </span>
                    <span className="mt-3 flex min-h-9 items-center justify-center rounded-md bg-accent px-4 text-13 font-medium text-on-accent group-hover:bg-accent-hover">
                      Ver detalhes
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Confianca />
    </>
  );
}

/* -----------------------------------------------------------------------------
   Confiança — a linha simples abaixo do grid: três razões para comprar com
   a agência e não com um buscador.
   ------------------------------------------------------------------------- */

function Confianca() {
  const itens = [
    { titulo: "Atendimento humano no WhatsApp", icone: <IconeConversa /> },
    { titulo: "Preço na mesa, sem letra miúda", icone: <IconeEtiqueta /> },
    { titulo: "Agência verificada", icone: <IconeEscudo /> },
  ];

  return (
    <section
      aria-label="Por que comprar com a agência"
      className="border-t border-hairline pt-8"
    >
      <ul className="grid gap-4 sm:grid-cols-3">
        {itens.map((item) => (
          <li key={item.titulo} className="flex items-center gap-3">
            <span className="shrink-0 text-accent">{item.icone}</span>
            <span className="text-13 font-medium leading-[1.4] text-ink">{item.titulo}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function IconeConversa() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function IconeEtiqueta() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

function IconeEscudo() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

function Filtro({
  ativo,
  onClick,
  label,
  contagem,
}: {
  ativo: boolean;
  onClick: () => void;
  label: string;
  contagem: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={
        ativo
          ? "flex min-h-9 items-center gap-1.5 rounded-full border border-accent bg-accent-soft px-3.5 text-13 font-medium text-ink"
          : "flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-13 text-muted hover:border-line-strong hover:text-ink"
      }
    >
      {label}
      <span className="tabular-nums text-subtle">{contagem}</span>
    </button>
  );
}
