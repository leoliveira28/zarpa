import type { Metadata } from "next";
import { ImportWizard } from "./ImportWizard";

export const metadata: Metadata = { title: "Importar clientes" };

export default function ImportarClientesPage() {
  return <ImportWizard />;
}
