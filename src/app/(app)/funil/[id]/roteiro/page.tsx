import type { Metadata } from "next";
import { RoteiroEditorScreen } from "./RoteiroEditorScreen";

export const metadata: Metadata = { title: "Roteiro" };

/**
 * O editor de roteiro — dentro da ficha do negócio (`/funil/[id]/roteiro`),
 * porque é ali que a agente já está quando o negócio fecha. Mesmo esqueleto do
 * editor de proposta (`/propostas/[id]/editar`): miolo silencioso à esquerda,
 * prévia editorial à direita, abas em 390px. Zero aprendizado para quem já
 * monta proposta — é o pedido do brief.
 */
export default async function RoteiroPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RoteiroEditorScreen dealId={id} />;
}
