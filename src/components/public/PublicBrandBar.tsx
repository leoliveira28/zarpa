import { ChatIcon } from "@/components/app/icons";
import { cn } from "@/lib/ui/cn";

/* =============================================================================
   PublicBrandBar — a barra de marca das páginas públicas
   -----------------------------------------------------------------------------
   Extraída da proposta pública (`/p/[slug]`) para o roteiro (`/r/[slug]`)
   herdar a MESMA gramática: logo redonda + nome no canto, WhatsApp no canto
   oposto. Duas páginas públicas com duas barras de marca diferentes seria o
   tipo de divergência que ninguém decide — acontece.

   Server-compatible de propósito (sem `"use client"`, sem hook): o roteiro
   público é um server component, e esta barra não precisa de nada vivo.
   ========================================================================== */

/** Mesma forma de `PropostaPublicaBrand`/`RoteiroPublicoBrand` — os dois
 * contratos têm exatamente estes campos, e aqui só interessam estes três. */
export type PublicBrand = {
  name: string | null;
  logoUrl: string | null;
  whatsappLink: string | null;
};

export function PublicBrandBar({
  brand,
  whatsappText,
  className,
}: {
  brand: PublicBrand;
  /** Mensagem pronta para o WhatsApp; sem ela o link abre sem texto. */
  whatsappText?: string;
  className?: string;
}) {
  const whatsappHref = brand.whatsappLink
    ? whatsappText
      ? `${brand.whatsappLink}?text=${encodeURIComponent(whatsappText)}`
      : brand.whatsappLink
    : null;

  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div className="flex min-w-0 items-center gap-2">
        {brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logoUrl} alt="" className="size-8 shrink-0 rounded-full object-cover" />
        ) : null}
        <span className="truncate text-13 font-medium text-muted">
          {brand.name ?? "Proposta de viagem"}
        </span>
      </div>
      {whatsappHref ? (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 text-13 font-medium text-muted hover:text-ink"
        >
          <ChatIcon className="size-4" />
          WhatsApp
        </a>
      ) : null}
    </div>
  );
}
