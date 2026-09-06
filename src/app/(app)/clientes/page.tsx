import type { Metadata } from "next";
import { ClientesScreen } from "./ClientesScreen";

export const metadata: Metadata = { title: "Clientes" };

export default function ClientesPage() {
  return <ClientesScreen />;
}
