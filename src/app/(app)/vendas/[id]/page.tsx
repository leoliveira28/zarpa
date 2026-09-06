import type { Metadata } from "next";
import { VendaScreen } from "./VendaScreen";

export const metadata: Metadata = { title: "Venda" };

export default async function VendaDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <VendaScreen vendaId={id} />;
}
