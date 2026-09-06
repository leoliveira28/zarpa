import type { Metadata } from "next";
import { PropostasScreen } from "./PropostasScreen";

export const metadata: Metadata = { title: "Propostas" };

export default function PropostasPage() {
  return <PropostasScreen />;
}
