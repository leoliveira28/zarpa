import type { Metadata } from "next";
import { NegocioScreen } from "./NegocioScreen";

export const metadata: Metadata = { title: "Negócio" };

export default async function NegocioDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <NegocioScreen dealId={id} />;
}
