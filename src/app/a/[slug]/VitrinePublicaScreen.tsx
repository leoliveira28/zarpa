import Link from "next/link";
import { PublicBrandBar } from "@/components/public/PublicBrandBar";
import { Assinatura } from "@/components/public/Assinatura";
import { TIPO_LABEL } from "@/lib/ui/ofertaTipo";
import { Money } from "@/components/ui/Money";
import type { VitrinePublica } from "@/server/offers";
import { waMeLink } from "@/lib/ui/whatsapp";

/* =============================================================================
   A Vitrine pública — o catálogo do agente, sem login
   -----------------------------------------------------------------------------
   O padrão dos players (verificado em docs/FIT7_VITRINE.md §3): cards
   consistentes para comparar, preço visível, UM CTA. O registro é o das
   páginas públicas da casa: papel, a marca da agência no topo (mesma
   fotografia de /p/ e /r/), e a assinatura no pé.
   ========================================================================== */

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

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-8 px-5 pb-16 pt-10 sm:px-8">
      <header className="flex flex-col gap-1">
        <PublicBrandBar
          brand={{
            name: agencia.nome,
            logoUrl: agencia.logo,
            whatsappLink: agencia.whatsapp ? waMeLink(agencia.whatsapp) : null,
          }}
        />
        <p className="mt-2 text-15 leading-[1.5] text-muted">
          Ofertas publicadas pela agência — fale com a gente para reservar.
        </p>
      </header>

      {ofertas.length === 0 ? (
        <p className="text-15 text-muted">
          Nenhuma oferta publicada no momento — volte em breve.
        </p>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2">
          {ofertas.map((oferta) => (
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
                  <span className="text-13 font-medium text-muted">
                    {TIPO_LABEL[oferta.type as keyof typeof TIPO_LABEL] ?? oferta.type}
                    {oferta.temLugares ? ` · restam ${oferta.lugaresRestantes} lugares` : ""}
                  </span>
                  <span className="text-17 font-medium leading-snug text-ink">{oferta.title}</span>
                  {oferta.summary ? (
                    <span className="line-clamp-2 text-13 leading-[1.5] text-muted">{oferta.summary}</span>
                  ) : null}
                  <span className="mt-auto pt-2">
                    <Money cents={oferta.priceCents} size="20" reserveFor={50_000_000} />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-auto pt-8">
        <Assinatura
          marca={{ brandName: agencia.nome, agentDisplayName: agencia.agentName }}
          instagram={agencia.instagram}
        />
      </footer>
    </main>
  );
}
