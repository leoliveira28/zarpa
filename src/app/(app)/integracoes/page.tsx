import type { Metadata } from "next";
import { IntegracoesScreen } from "./IntegracoesScreen";

export const metadata: Metadata = { title: "Integrações" };

export default function IntegracoesPage() {
  return <IntegracoesScreen />;
}
