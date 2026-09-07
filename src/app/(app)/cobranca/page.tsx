import type { Metadata } from "next";
import { CobrancaScreen } from "./CobrancaScreen";

export const metadata: Metadata = { title: "Cobrança" };

export default function CobrancaPage() {
  return <CobrancaScreen />;
}
