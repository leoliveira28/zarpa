import type { Metadata } from "next";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata: Metadata = { title: "Clientes" };

/** Lugar reservado. Cadastro de cliente depende da cifragem de PII (Rafa, S3). */
export default function ClientesPage() {
  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-32 font-semibold text-ink">Clientes</h2>
      <EmptyState
        title="O cadastro de clientes chega na S3"
        description="Depende da cifragem de dado sensível (CPF, passaporte, nascimento) que o Rafa está montando. Enquanto isso, a proposta funciona só com nome e WhatsApp."
        action={<Button variant="primary">Adicionar cliente</Button>}
      />
    </div>
  );
}
