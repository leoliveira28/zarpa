import type { Metadata } from "next";
import { PropostaEditorScreen } from "./PropostaEditorScreen";

export const metadata: Metadata = { title: "Editar proposta" };

export default async function EditarPropostaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PropostaEditorScreen propostaId={id} />;
}
