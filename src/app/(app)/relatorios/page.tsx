import type { Metadata } from "next";
import { RelatoriosScreen } from "./RelatoriosScreen";

export const metadata: Metadata = { title: "Relatórios" };

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; aba?: string }>;
}) {
  const sp = await searchParams;
  return <RelatoriosScreen periodoParam={sp.periodo} abaParam={sp.aba} />;
}
