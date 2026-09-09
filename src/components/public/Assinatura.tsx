import { Rule } from "@/components/plates";
import { linhaViaApp, type MarcaParaAssinatura } from "@/lib/assinatura";

/* =============================================================================
   Assinatura — o colofão da página entregue
   -----------------------------------------------------------------------------
   Cada artefato que sai do produto assina o produto: a proposta (/p/[slug]) e
   o roteiro (/r/[slug]) terminam com esta peça, e nenhuma outra. Um componente
   só porque duas assinaturas diferentes é o tipo de divergência que ninguém
   decide — acontece (mesma razão de existir do `PublicBrandBar`).

   As REGRAS de composição (quem entra quando falta nome, o "por", o token do
   APP) moram em `src/lib/assinatura.ts`, testadas em `tests/brand`. Aqui é só
   PESO VISUAL: a linha do helper repartida em duas, agência em destaque (caixa
   alta, peso, espaçamento — a mesma família tipográfica do cabeçalho de dia do
   roteiro) e o nome do agente em linha quieta embaixo. Quando só existe um dos
   nomes, a linha única é a linha inteira — a assinatura nunca inventa texto e
   nunca fica vazia: sem nome nenhum, resta a linha fina "via {APP_NAME}".

   Sem "use client" de propósito: as duas páginas públicas são server
   components e a assinatura não precisa de nada vivo.
   ========================================================================== */

export type AssinaturaProps = {
  /** Os nomes da marca, na forma que o helper do `src/lib/assinatura.ts` lê —
   * o objeto `brand` das páginas públicas entra direto. */
  marca: MarcaParaAssinatura;
  /** Instagram do cadastro (handle ou URL) — entra na linha fina, como link. */
  instagram?: string | null;
  className?: string;
};

export function Assinatura({ marca, instagram, className }: AssinaturaProps) {
  // A mesma leitura de `linhaDeAssinatura` (`brandName ?? name`, trim), só que
  // repartida: o helper devolve UMA linha canônica; o colofão pesa os dois
  // nomes de forma diferente. Quem não tem nome não rende linha.
  const agencia = (marca.brandName ?? marca.name ?? "").trim();
  const agente = (marca.agentDisplayName ?? "").trim();
  const instagramLimpo = instagramDoCadastro(instagram);

  return (
    <div className={className}>
      <Rule loose />
      <div className="flex flex-col items-center gap-1 pt-1">
        {agencia !== "" ? (
          <p className="text-center text-13 font-semibold uppercase tracking-[0.12em] text-ink">
            {agencia}
          </p>
        ) : null}
        {agente !== "" ? (
          <p className="text-center text-13 text-muted">
            {/* Sem agência, o nome do agente É a assinatura — sem "por", como
                na linha canônica do helper. */}
            {agencia !== "" ? "por " : ""}
            {agente}
          </p>
        ) : null}
        <p className="text-center text-13 text-subtle">
          {linhaViaApp()}
          {instagramLimpo ? (
            <>
              {" · "}
              <a
                href={instagramLimpo.href}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-ink hover:underline underline-offset-2"
              >
                {instagramLimpo.texto}
              </a>
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}

/* -----------------------------------------------------------------------------
   O cadastro aceita handle ("@marinaviagens", "marinaviagens") ou URL
   ("https://instagram.com/marinaviagens") — o comentário da coluna em
   `src/db/schema/tenants.ts`. O link precisa da URL; o rótulo fica melhor no
   handle. Um lugar só para concordar sobre isso.
   -------------------------------------------------------------------------- */
function instagramDoCadastro(valor: string | null | undefined): { href: string; texto: string } | null {
  const cru = (valor ?? "").trim();
  if (cru === "") return null;

  if (/^https?:\/\//i.test(cru)) {
    let caminho = cru;
    try {
      caminho = new URL(cru).pathname;
    } catch {
      // URL malformada: segue com o texto cru no cleanup de baixo.
    }
    const parte = caminho.split("/").filter(Boolean)[0];
    if (!parte) return null;
    return { href: cru, texto: `@${parte}` };
  }

  const handle = cru.replace(/^@+/, "").replace(/\/+$/, "");
  if (handle === "") return null;
  return { href: `https://instagram.com/${handle}`, texto: `@${handle}` };
}
