import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { obterPropostaPublica } from "@/server";
import { PublicProposalScreen } from "./PublicProposalScreen";

/**
 * A proposta pública — S7. Fora do grupo `(app)` de propósito: sem AppShell,
 * sem sessão, sem nenhuma navegação nossa. É a única tela que o cliente final
 * do agente vê.
 *
 * `cache()` faz `generateMetadata` e o componente de página compartilharem a
 * mesma chamada dentro do mesmo request — sem isso seriam duas idas ao banco
 * (via a função `SECURITY DEFINER`) para a mesma proposta.
 *
 * Contrato (docs/handoffs/rafa-para-nina.md): `obterPropostaPublica` nunca
 * distingue "slug não existe" de "existe mas não é pública" — os dois casos
 * chegam aqui como `data: null`, e os dois viram o MESMO 404 elegante
 * (`not-found.tsx` nesta pasta). Nenhuma pista sobre qual dos dois aconteceu.
 */
const carregarProposta = cache(async (slug: string) => {
  const result = await obterPropostaPublica(slug);
  return result.ok ? result.data : null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await carregarProposta(slug);
  if (!data) return { title: "Proposta não encontrada" };
  return {
    title: data.proposal.title,
    description: data.proposal.summary ?? undefined,
    // Nunca no índice: é um link nominal, mandado por WhatsApp, não uma
    // página para aparecer numa busca do Google com preço de terceiro.
    robots: { index: false, follow: false },
  };
}

export default async function PropostaPublicaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await carregarProposta(slug);
  if (!data) notFound();

  return <PublicProposalScreen data={data} slug={slug} />;
}
