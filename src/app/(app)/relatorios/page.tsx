import type { Metadata } from "next";
import { RelatoriosScreen } from "./RelatoriosScreen";

export const metadata: Metadata = { title: "Resumo do período" };

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const sp = await searchParams;
  return <RelatoriosScreen periodoParam={sp.periodo} />;
}
