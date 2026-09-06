import type { Metadata } from "next";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Money } from "@/components/ui/Money";

export const metadata: Metadata = { title: "Propostas" };

/**
 * Ainda não é a tela de propostas — é o lugar dela, com o vazio já desenhado.
 * A lista completa entra na S3, quando o backend expuser leitura.
 */
export default function PropostasPage() {
  return (
    <div className="flex flex-col gap-5">
      <h2 className="display text-32 text-ink">Propostas</h2>
      <EmptyState
        title="A lista de propostas chega na S3"
        description="A tela existe para a navegação não mentir. Quando o backend expuser leitura, esta lista mostra cada proposta com valor, estágio e quantas vezes o cliente abriu."
        preview={
          <Card className="flex items-center justify-between gap-3 p-3">
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-15 font-medium text-ink">
                Marina Albuquerque
              </span>
              <span className="text-13 text-muted">Fernando de Noronha</span>
            </span>
            <Money cents={1_284_000} size="15" reserveFor={5_940_000} />
          </Card>
        }
        action={<Button variant="primary">Nova proposta</Button>}
      />
    </div>
  );
}
