import type { Metadata } from "next";
import { ContatoScreen } from "./ContatoScreen";

export const metadata: Metadata = { title: "Cliente" };

export default async function ClienteDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ContatoScreen contatoId={id} />;
}
