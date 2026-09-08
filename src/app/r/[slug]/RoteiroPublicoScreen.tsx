import { PublicBlockSection } from "@/components/public/PublicBlockSection";
import { PublicBrandBar } from "@/components/public/PublicBrandBar";
import { BiplanePlate, Rule } from "@/components/plates";
import { APP_NAME } from "@/lib/ui/brand";
import { formatarFaixaDeDatas } from "@/lib/ui/format";
import type { RoteiroPublico } from "@/server";

/* =============================================================================
   O roteiro público — registro editorial pleno
   -----------------------------------------------------------------------------
   §4 de PROPOSTAS_PRODUTO. Mesma linguagem da proposta (`/p/[slug]`), com um
   recorte de propósito: a proposta é um ARGUMENTO de venda (preço, opções,
   aceite); o roteiro é um DOCUMENTO de viagem — o cliente abre na semana da
   viagem para conferir voo, hotel, transfer. Nenhum preço aqui por design:
   a cotação mora na proposta aceita, e reaparecer preço no roteiro
   transformaria o documento de viagem em nova negociação.

   Reuso onde importa: os blocos são `PublicBlockSection` e a marca é
   `PublicBrandBar` — os MESMOS componentes da proposta, para o cliente ler
   "Check-in" na proposta e reencontrar o mesmo desenho no roteiro.

   Prancha: a `BiplanePlate` na capa é a ÚNICA da tela — sem `ArchPlate` como
   divisor, o orçamento é uma prancha por página.

   Server component de propósito: nada aqui é vivo — não há aceite, não há
   beacon (o roteiro não tem "sabe quando abriu" nesta rodada), não há estado.
   ========================================================================== */
export function RoteiroPublicoScreen({ data }: { data: RoteiroPublico }) {
  const { roteiro, brand, blocks } = data;

  // Snapshot é imutável (fotografia da proposta aceita), então `index` como
  // key é seguro: a ordem não muda em runtime.
  const ordered = [...blocks].sort((a, b) => a.position - b.position);
  const datas = formatarFaixaDeDatas(roteiro.departureOn, roteiro.returnOn);

  return (
    <main className="enter mx-auto flex w-full max-w-[42rem] flex-col gap-10 px-6 pt-10 pb-20 sm:px-10 sm:pt-16">
      <PublicBrandBar
        brand={brand}
        whatsappText={`Olá! Tenho uma dúvida sobre o roteiro "${roteiro.title}".`}
      />

      {/* Capa tipográfica. Sem foto de capa no snapshot — a BiplanePlate faz
          o trabalho que a foto faria, sangrando pelo canto. `overflow-hidden`
          é o que evita o desenho empurrar a página para o lado em 390px. */}
      <header className="relative isolate flex flex-col gap-4 overflow-hidden">
        <BiplanePlate
          size={224}
          className="plate-wash pointer-events-none absolute -top-10 -right-10 -z-10 select-none sm:-top-12 sm:-right-6"
        />
        <p className="text-13 tracking-[0.08em] text-muted uppercase">Roteiro de viagem</p>
        {/* Capa: tipografia como IMAGEM — mesma exceção editorial da proposta
            (peso 800 sobre leading 0.94, nunca itálico). */}
        <h1 className="display text-32 text-ink lg:text-[56px]">{roteiro.title}</h1>
        <p className="text-17 leading-[1.5] text-muted">
          Preparado para <span className="font-medium text-ink">{roteiro.clientName}</span>
        </p>
        {datas ? <p className="text-13 tabular-nums text-muted">{datas}</p> : null}
      </header>

      {ordered.length > 0 ? (
        <section className="flex flex-col gap-6">
          {ordered.map((block, index) => (
            <PublicBlockSection key={index} block={block} />
          ))}
        </section>
      ) : (
        <p className="text-15 text-muted">
          Os detalhes desta viagem ainda estão sendo preparados — fale com quem te mandou
          este link para receber a versão completa.
        </p>
      )}

      <footer className="flex flex-col">
        <Rule loose />
        <p className="text-center text-13 text-subtle">Feito com {APP_NAME}</p>
      </footer>
    </main>
  );
}
