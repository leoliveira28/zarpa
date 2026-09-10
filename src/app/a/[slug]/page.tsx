import type { Metadata } from "next";
import { obterVitrinePublica } from "@/server/offers";
import { VitrinePublicaScreen } from "./VitrinePublicaScreen";

export const metadata: Metadata = { title: "Ofertas" };

/**
 * A Vitrine pública do agente (Fit 7) — sem login, como /p/ e /r/. Slug do
 * tenant; a leitura é pelas funções SECURITY DEFINER da 0026.
 */
export default async function VitrinePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const vitrine = await obterVitrinePublica(slug);
  return <VitrinePublicaScreen slug={slug} vitrine={vitrine.ok ? vitrine.data : null} />;
}
