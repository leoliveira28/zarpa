import { FernPlate } from "@/components/plates";
import { APP_NAME } from "@/lib/ui/brand";

/* =============================================================================
   Roteiro indisponível — registro intermediário
   -----------------------------------------------------------------------------
   Mesma disciplina do 404 da proposta (`src/app/p/[slug]/not-found.tsx`):
   cobre os casos que `obterRoteiroPublico` se recusa a distinguir — token
   errado, roteiro apagado, negócio de outro tenant — sem apontar qual.
   Uma prancha, discreta: isto não é o roteiro (editorial pleno), é a porta
   fechada dele.
   ========================================================================== */
export default function RoteiroIndisponivel() {
  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-5 px-6 py-24 text-center">
      <FernPlate size={72} className="plate-wash" />
      <div className="flex flex-col gap-2">
        <h1 className="text-20 font-semibold text-ink">Este roteiro não está disponível</h1>
        <p className="text-15 leading-[1.5] text-muted">
          O link pode estar errado, ou o roteiro deixou de existir. Fale com quem te
          mandou o link para confirmar o endereço.
        </p>
      </div>
      <p className="text-13 text-subtle">{APP_NAME}</p>
    </main>
  );
}
