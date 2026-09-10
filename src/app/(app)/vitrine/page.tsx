import type { Metadata } from "next";
import { VitrineScreen } from "./VitrineScreen";

export const metadata: Metadata = { title: "Vitrine" };

/**
 * Vitrine (Fit 7, docs/FIT7_VITRINE.md) — a gestão do catálogo público.
 * Irmã de /grupos, /equipe e /configuracoes no shell.
 */
export default function VitrinePage() {
  return <VitrineScreen />;
}
