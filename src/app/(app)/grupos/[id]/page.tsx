import type { Metadata } from "next";
import { GrupoFichaScreen } from "./GrupoFichaScreen";

export const metadata: Metadata = { title: "Grupo" };

export default async function GrupoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GrupoFichaScreen grupoId={id} />;
}
