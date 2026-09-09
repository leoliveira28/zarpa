import { Assinatura } from "@/components/public/Assinatura";
import { PublicBrandBar } from "@/components/public/PublicBrandBar";
import { RoteiroPublicoConteudo } from "@/components/public/RoteiroPublicoConteudo";
import { ArchPlate, Rule } from "@/components/plates";
import { ChatIcon } from "@/components/app/icons";
import { formatarFaixaDeDatas } from "@/lib/ui/format";
import type { RoteiroPublico } from "@/server";

/* =============================================================================
   O roteiro público — registro editorial pleno
   -----------------------------------------------------------------------------
   §4 de PROPOSTAS_PRODUTO. Superfície de marca, mesmo orçamento da proposta
   (`/p/[slug]`): tipografia como imagem na capa, margem de livro, o arco como
   divisor. A diferença é O LEITOR: a proposta é lida por quem COMPRA, no sofá;
   o roteiro é lido por quem JÁ PAGOU, na rua — aeroporto, fila de check-in,
   sol na tela. Então:

     - O ARCO abre o conteúdo, uma vez, na posição de divisor — é o portal da
       viagem (na proposta ele dividia opções; aqui divide a capa do guia). É
       a ÚNICA prancha da página: os dias se constroem com tipografia e fio,
       porque ornamento repetido a cada dia é o encanto que irrita na
       quinquagésima abertura — e o turista abre este link todo dia.
     - Contato de emergência SEMPRE visível: barra fixa no pé, véu translúcido
       (sólida sob prefers-reduced-transparency, via token), com o WhatsApp da
       marca. O azul está ali e nos telefones do conteúdo — só onde se clica.
     - Zero preço por design — a cotação mora na proposta aceita; o
       `RoteiroPublicoConteudo` ainda recusa `price_note` como segunda trava.

   Server component de propósito: nada aqui é vivo — não há aceite, não há
   beacon (o roteiro não tem "sabe quando abriu" nesta rodada), não há estado.
   ========================================================================== */
export function RoteiroPublicoScreen({ data }: { data: RoteiroPublico }) {
  const { roteiro, brand, blocks } = data;
  const datas = formatarFaixaDeDatas(roteiro.departureOn, roteiro.returnOn);

  const whatsappHref = brand.whatsappLink
    ? `${brand.whatsappLink}?text=${encodeURIComponent(
        `Olá! Estou na viagem "${roteiro.title}" e preciso de ajuda.`,
      )}`
    : null;

  return (
    <>
      <main className="enter mx-auto flex w-full max-w-[42rem] flex-col gap-12 px-6 pt-10 pb-32 sm:px-10 sm:pt-16">
        <PublicBrandBar
          brand={brand}
          whatsappText={`Olá! Tenho uma dúvida sobre o roteiro "${roteiro.title}".`}
        />

        {/* Capa tipográfica — a tipografia é a imagem da capa. Margem de livro,
            peso 800 sobre leading 0.94, nunca itálico. */}
        <header className="flex flex-col gap-4">
          <p className="text-13 uppercase tracking-[0.08em] text-muted">Roteiro de viagem</p>
          <h1 className="display text-32 text-ink lg:text-[56px]">{roteiro.title}</h1>
          <p className="text-17 leading-[1.5] text-muted">
            Preparado para <span className="font-medium text-ink">{roteiro.clientName}</span>
          </p>
          {datas ? (
            <p className="text-13 text-muted" data-numeric>
              {datas}
            </p>
          ) : null}
        </header>

        {/* O arco como divisor: a porta da viagem, uma vez só. */}
        <div aria-hidden className="flex items-center gap-4">
          <ArchPlate size={44} className="shrink-0 text-muted" />
          <Rule className="min-w-0 flex-1" />
        </div>

        {blocks.length > 0 ? (
          <RoteiroPublicoConteudo blocks={blocks} />
        ) : (
          <p className="text-15 leading-[1.5] text-muted">
            Os detalhes desta viagem ainda estão sendo preparados — fale com quem te mandou este
            link para receber a versão completa.
          </p>
        )}

        {/* O colofão: a agência assina, o produto assina junto — um componente
            só (`Assinatura`), o mesmo de /p/[slug]. A marca aqui é a CONGELADA
            no snapshot — inclusive o nome do agente, que viaja com a proposta. */}
        <footer>
          <Assinatura marca={brand} instagram={brand.instagram} />
        </footer>
      </main>

      {/* Emergência sem rolar: o leitor está na rua, não no sofá. Camada
          flutuante — contorno de aresta e véu, na doutrina do fio. */}
      {whatsappHref ? (
        <div className="veil fixed inset-x-0 bottom-0 z-30 border-t border-line">
          <div className="mx-auto flex w-full max-w-[42rem] items-center justify-between gap-3 px-6 py-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] sm:px-10">
            <p className="min-w-0 text-13 text-muted">
              Dúvida na viagem? Fale com{" "}
              <span className="font-medium text-ink">{brand.name ?? "quem te enviou o link"}</span>.
            </p>
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-md bg-accent px-4 text-15 font-medium text-on-accent [transition:transform_120ms_var(--curve-out)] hover:bg-accent-hover active:scale-[0.98]"
            >
              <ChatIcon className="size-4" />
              WhatsApp
            </a>
          </div>
        </div>
      ) : null}
    </>
  );
}
