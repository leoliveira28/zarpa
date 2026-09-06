import { FernPlate } from "@/components/plates";
import { APP_NAME } from "@/lib/ui/brand";

/* =============================================================================
   Proposta indisponível — registro intermediário
   -----------------------------------------------------------------------------
   Cobre os dois casos que `obterPropostaPublica` recusa a distinguir: slug
   errado e proposta que existe mas não é pública (rascunho, arquivada). A
   mensagem não aponta qual dos dois é — não é bug, é o mesmo cuidado de
   "não vazar pista sobre o que existe em outro tenant" que already vale para
   o resto do produto.

   Registro "entrada e estados vazios" do CLAUDE.md: uma prancha, discreta,
   nada de ilustração cheia — isto não é a proposta pública em si (editorial
   pleno), é a porta fechada dela.
   ========================================================================== */
export default function PropostaIndisponivel() {
  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-5 px-6 py-24 text-center">
      <FernPlate size={72} className="plate-wash" />
      <div className="flex flex-col gap-2">
        <h1 className="text-20 font-semibold text-ink">Esta proposta não está disponível</h1>
        <p className="text-15 leading-[1.5] text-muted">
          O link pode estar errado, ou a proposta ainda não foi enviada. Fale com quem
          te mandou o link para confirmar o endereço.
        </p>
      </div>
      <p className="text-13 text-subtle">{APP_NAME}</p>
    </main>
  );
}
