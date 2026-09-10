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
   O padrão dos players (docs/FIT7_VITRINE.md §3): cabeçalho com menu (marca à
   esquerda, contato à direita), hero com a promessa, FILTROS por tipo (com
   contagem — filtro que não diz quanto esconde é filtro que não se usa) e
   cards consistentes com imagem, preço visível e UM CTA. Revisão do PO:
   a página nua de antes não era vitrine.
   ========================================================================== */

type OfertaDoCatalogo = VitrinePublica["ofertas"][number];

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

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-5 pb-16 pt-10 sm:px-8">
        {/* Hero — a promessa específica, nunca "viagem dos sonhos". */}
        <section className="flex flex-col gap-2">
          <h1 className="display text-32 text-ink">Ofertas da {agencia.nome}</h1>
          <p className="max-w-[36rem] text-15 leading-[1.5] text-muted">
            Pacotes, voos, hospedagens e serviços montados por quem acompanha
            você na viagem — com preço na mesa e sem letra miúda.
          </p>
          <a
            href="#ofertas"
            className="w-fit text-13 font-medium text-accent underline underline-offset-4"
          >
            Ver as {ofertas.length} ofertas
          </a>
        </section>

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
   Catálogo — filtros por tipo (com contagem) + grid de cards.
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
    <section id="ofertas" className="flex scroll-mt-20 flex-col gap-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-20 font-semibold text-ink">Ofertas</h2>
        <span className="text-13 tabular-nums text-muted">
          {visiveis.length} {visiveis.length === 1 ? "oferta" : "ofertas"}
        </span>
      </div>

      {ofertas.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por tipo">
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
      ) : null}

      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {visiveis.map((oferta) => (
          <li key={oferta.id}>
            <Link
              href={`/a/${slug}/o/${oferta.token}`}
              className="flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-1"
            >
              {oferta.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- capa da oferta pública (mesma via de /p/)
                <img src={oferta.coverUrl} alt="" className="aspect-[16/9] w-full object-cover" />
              ) : (
                <div className="aspect-[16/9] w-full bg-surface-2" />
              )}
              <span className="flex flex-1 flex-col gap-1.5 p-4">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-11 font-semibold uppercase tracking-wider text-subtle">
                    {TIPO_LABEL[oferta.type as OfertaTipo] ?? oferta.type}
                  </span>
                  {oferta.temLugares ? (
                    <span className="text-11 font-medium tabular-nums text-danger">
                      restam {oferta.lugaresRestantes}
                    </span>
                  ) : null}
                </span>
                <span className="text-15 font-medium leading-snug text-ink">{oferta.title}</span>
                {oferta.summary ? (
                  <span className="line-clamp-2 text-13 leading-[1.5] text-muted">
                    {oferta.summary}
                  </span>
                ) : null}
                <span className="mt-auto pt-2">
                  <Money cents={oferta.priceCents} size="20" reserveFor={50_000_000} />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
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
