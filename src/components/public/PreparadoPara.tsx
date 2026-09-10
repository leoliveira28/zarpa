import { cn } from "@/lib/ui/cn";
import { juntarNomes } from "@/lib/ui/format";

/* =============================================================================
   Preparado para — o destinatário como tipografia
   -----------------------------------------------------------------------------
   0020 — uma viagem, vários clientes. A linha vive na capa da proposta
   pública; no roteiro (`/r/[slug]`) entra no dia em que o snapshot carregar a
   lista de nomes (hoje ele só tem `clientName` singular — pedido aberto no
   handoff Nina→Rafa). A junção dos nomes é a MESMA (`juntarNomes`) que a linha
   "Preparado para" do editor de proposta lê, então a agente nunca vê no editor
   algo diferente do que o cliente recebe.

   Gramática da capa (a mesma do roteiro): o rótulo fica quieto em muted, os
   NOMES levam o peso. Nada de azul — aqui não se clica em nada; a cor segue
   dizendo só onde se clica.
   ========================================================================== */
export function PreparadoPara({
  nomes,
  className,
  nada = null,
}: {
  nomes: string[];
  className?: string;
  /** O que renderizar com a lista vazia. */
  nada?: React.ReactNode;
}) {
  const texto = juntarNomes(nomes);
  if (!texto) return nada;
  return (
    <p className={cn("text-17 leading-[1.5] text-muted", className)}>
      Preparado para <span className="font-medium text-ink">{texto}</span>
    </p>
  );
}
