import type { Metadata } from "next";
import { VendasScreen } from "./VendasScreen";

export const metadata: Metadata = { title: "Vendas" };

export default async function VendasPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const sp = await searchParams;
  return <VendasScreen periodoParam={sp.periodo} />;
}
