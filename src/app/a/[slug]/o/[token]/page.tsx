import type { Metadata } from "next";
import Link from "next/link";
import { obterOfertaPublica } from "@/server/offers";
import { Assinatura } from "@/components/public/Assinatura";
import { PublicBlockSection } from "@/components/public/PublicBlockSection";
import { Money } from "@/components/ui/Money";
import { waMeLink } from "@/lib/ui/whatsapp";
import { TIPO_LABEL } from "@/lib/ui/ofertaTipo";

export const metadata: Metadata = { title: "Oferta" };

/**
 * A página pública da OFERTA (Fit 7) — o desenho dos players (docs/FIT7_VITRINE.md
 * §3): hero com a promessa, o que está incluso (os blocos, lidos pela
 * `PublicBlockSection` — o MESMO componente de /p/ e /r/), preço com UMA régua,
 * e UM CTA. Rodada 7a: o CTA é o WhatsApp da agência (o interesse com Google é
 * a 7b) — se a agência não tem WhatsApp cadastrado, o botão nem nasce e a
 * assinatura leva o contato.
 */
export default async function OfertaPublicaPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  const resultado = await obterOfertaPublica(slug, token);
  const dados = resultado.ok ? resultado.data : null;

  if (!dados?.oferta || !dados.agencia) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-20 text-ink">Esta oferta não está mais disponível.</p>
        <p className="text-15 text-muted">Confira o catálogo completo da agência.</p>
        <Link
          href={`/a/${slug}`}
          className="text-15 font-medium text-accent underline underline-offset-2"
        >
          Ver todas as ofertas
        </Link>
      </main>
    );
  }

  const { oferta, agencia } = dados;
  const whatsapp = agencia.whatsapp ? waMeLink(agencia.whatsapp) : null;
  const mensagem = encodeURIComponent(`Olá! Tenho interesse na oferta "${oferta.title}".`);

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 px-5 pb-16 pt-10 sm:px-8">
      <Link
        href={`/a/${slug}`}
        className="flex w-fit items-center gap-1 text-13 font-medium text-muted hover:text-ink"
      >
        <span aria-hidden>‹</span>
        Todas as ofertas
      </Link>

      <header className="flex flex-col gap-2">
        <p className="text-13 font-medium text-muted">
          {TIPO_LABEL[oferta.type as keyof typeof TIPO_LABEL] ?? oferta.type}
          {oferta.temLugares ? ` · restam ${oferta.lugaresRestantes} lugares` : ""}
        </p>
        <h1 className="display text-32 text-ink">{oferta.title}</h1>
        {oferta.summary ? (
          <p className="text-15 leading-[1.5] text-muted">{oferta.summary}</p>
        ) : null}
      </header>

      {oferta.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- capa da oferta pública (mesma via de /p/)
        <img
          src={oferta.coverUrl}
          alt=""
          className="aspect-[16/9] w-full rounded-lg border border-line object-cover"
        />
      ) : null}

      <section className="flex flex-col gap-1" aria-label="Preço">
        <Money
          cents={oferta.priceCents}
          size="32"
          tone="accent"
          align="left"
          reserveFor={50_000_000}
        />
        <p className="text-13 text-muted">valor por pessoa — fale com a agência para as formas de pagamento</p>
      </section>

      {oferta.blocks.length > 0 ? (
        <section className="flex flex-col gap-6" aria-label="Detalhes da oferta">
          {oferta.blocks.map((bloco, indice) => (
            <PublicBlockSection key={indice} block={bloco} />
          ))}
        </section>
      ) : null}

      {whatsapp ? (
        <a
          href={`${whatsapp}${mensagem ? `&text=${mensagem}` : ""}`}
          target="_blank"
          rel="noopener"
          className="flex min-h-11 items-center justify-center rounded-md bg-accent px-6 text-15 font-medium text-on-accent hover:bg-accent-hover"
        >
          Tenho interesse — falar com a agência
        </a>
      ) : null}

      <footer className="mt-auto pt-8">
        <Assinatura
          marca={{ brandName: agencia.nome, agentDisplayName: agencia.agentName }}
          instagram={agencia.instagram}
        />
      </footer>
    </main>
  );
}
