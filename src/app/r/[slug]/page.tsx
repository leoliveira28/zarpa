import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { obterRoteiroPublico } from "@/server";
import { RoteiroPublicoScreen } from "./RoteiroPublicoScreen";

/**
 * O roteiro público — §4. Mesma arquitetura da proposta pública
 * (`src/app/p/[slug]/page.tsx`): fora do grupo `(app)` de propósito — sem
 * AppShell, sem sessão, sem navegação nossa. É a página que o cliente final
 * abre na semana da viagem, provavelmente do celular, provavelmente no aeroporto.
 *
 * `cache()` faz `generateMetadata` e a página compartilharem a mesma chamada
 * dentro do request — uma ida só à função `SECURITY DEFINER`
 * `public.roteiro_publica` (que devolve SÓ snapshot de título, cliente, datas,
 * blocos e marca; nunca preço, custo ou comissão).
 *
 * Contrato: `obterRoteiroPublico` não distingue "token não existe" de "existe
 * mas não é público" — os dois chegam como `data: null` e viram o MESMO 404
 * elegante (`not-found.tsx` nesta pasta). Nenhuma pista sobre o que aconteceu.
 */
const carregarRoteiro = cache(async (slug: string) => {
  const result = await obterRoteiroPublico(slug);
  return result.ok ? result.data : null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await carregarRoteiro(slug);
  if (!data) return { title: "Roteiro não encontrado" };
  return {
    title: data.roteiro.title,
    description: `Roteiro de viagem preparado para ${data.roteiro.clientName}.`,
    // Nunca no índice: é um link nominal, mandado por WhatsApp — não é página
    // para aparecer numa busca com o nome do cliente do agente.
    robots: { index: false, follow: false },
  };
}

export default async function RoteiroPublicoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await carregarRoteiro(slug);
  if (!data) notFound();

  return <RoteiroPublicoScreen data={data} />;
}
