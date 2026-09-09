import { RoteiroPublicoConteudo } from "@/components/public/RoteiroPublicoConteudo";
import { ArchPlate, Rule } from "@/components/plates";
import { formatarFaixaDeDatas } from "@/lib/ui/format";
import type { BlocoDoRoteiro, RoteiroResumo } from "@/server";

/* =============================================================================
   Prévia — o registro editorial dentro do miolo silencioso
   -----------------------------------------------------------------------------
   Aproximação HONESTA do link público: renderiza os blocos com o MESMO
   componente da página real (`RoteiroPublicoConteudo`) — capa, arco e conteúdo
   —, então o que a agente vê aqui é o que o turista vai ler, não um esboço.
   A única peça que fica de fora é a barra fixa de emergência (depende do
   WhatsApp cadastrado na marca, que não vem no `RoteiroResumo`) — dito no pé
   da prévia em vez de fingir que ela não existe.
   ========================================================================== */

export function RoteiroPreview({
  roteiro,
  blocos,
}: {
  roteiro: RoteiroResumo;
  blocos: BlocoDoRoteiro[];
}) {
  const datas = formatarFaixaDeDatas(roteiro.departureOn, roteiro.returnOn);

  return (
    <article className="mx-auto flex w-full max-w-[36rem] flex-col gap-8 rounded-lg bg-surface px-6 py-8 shadow-1 sm:px-10 sm:py-12">
      <header className="flex flex-col gap-3">
        <p className="text-13 uppercase tracking-[0.08em] text-muted">Roteiro de viagem</p>
        <h1 className="display text-32 text-ink">{roteiro.title}</h1>
        <p className="text-17 leading-[1.5] text-muted">
          Preparado para <span className="font-medium text-ink">{roteiro.clientName}</span>
        </p>
        {datas ? (
          <p className="text-13 text-muted" data-numeric>
            {datas}
          </p>
        ) : null}
      </header>

      <div aria-hidden className="flex items-center gap-4">
        <ArchPlate size={44} className="shrink-0 text-muted" />
        <Rule className="min-w-0 flex-1" />
      </div>

      {blocos.length > 0 ? (
        <RoteiroPublicoConteudo blocks={blocos} />
      ) : (
        <p className="text-15 leading-[1.5] text-muted">
          Sem blocos ainda — o cliente veria o aviso de que os detalhes estão sendo preparados.
        </p>
      )}

      <p className="text-13 leading-[1.5] text-subtle">
        Prévia do link público. A barra de WhatsApp de emergência aparece na página real quando
        você tem WhatsApp cadastrado na marca.
      </p>
    </article>
  );
}
