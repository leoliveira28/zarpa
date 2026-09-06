import type { Metadata } from "next";
import { VendasScreen } from "./VendasScreen";

export const metadata: Metadata = { title: "Vendas" };

export default function VendasPage() {
  return <VendasScreen />;
}
