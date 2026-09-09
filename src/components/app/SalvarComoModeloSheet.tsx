"use client";

import * as React from "react";
import { Button } from "@/components/ui/Button";
import { Field, FieldError, Label } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { avisarRecusaDeEscrita } from "@/lib/ui/assinatura";
import { criarTemplateDeProposta } from "@/lib/ui/fase12Api";

/* =============================================================================
   Salvar como modelo — a proposta atual vira ponto de partida
   -----------------------------------------------------------------------------
   Fase 1 do Monde, o nosso jeito: a agente caprichou numa proposta (blocos,
   fotos, opções na ordem certa) e vai refazer quase igual para o próximo
   cliente. O botão mora na barra de publicação do editor — é LÁ que ela está
   olhando para o trabalho pronto — e abre uma sheet de UM campo: o nome.
   Nada de formulário de "gerenciar modelos": gerenciar é remover, e remover
   mora onde a lista aparece (Nova proposta), no mesmo lugar que lista.

   Sheet pequena de propósito: uma decisão de nome não merece a altura de um
   formulário. O nome já vem preenchido com o título da proposta — o caso
   comum ("usar o mesmo nome") é apertar o botão e pronto; renomear é o
   desvio, não o caminho.
   ========================================================================== */

export function SalvarComoModeloSheet({
  open,
  onOpenChange,
  propostaId,
  propostaTitulo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propostaId: string;
  /** Título atual da proposta — o palpite do campo de nome. */
  propostaTitulo: string;
}) {
  const toast = useToast();
  const [name, setName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<{ campo?: string; mensagem: string } | null>(null);

  // Prefill a cada abertura: a proposta pode ter sido renomeada desde a última.
  React.useEffect(() => {
    if (open) {
      setName(propostaTitulo);
      setFieldError(null);
    }
  }, [open, propostaTitulo]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nome = name.trim();
    if (!nome) {
      setFieldError({ campo: "name", mensagem: "Dê um nome para achar o modelo depois." });
      return;
    }
    setSaving(true);
    setFieldError(null);
    const result = await criarTemplateDeProposta({ proposalId: propostaId, name: nome });
    setSaving(false);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      setFieldError({ campo: result.campo, mensagem: result.mensagem });
      return;
    }
    onOpenChange(false);
    toast.show({
      title: "Modelo salvo",
      description: "Ele aparece em Nova proposta, em “Começar de um modelo”.",
      tone: "ok",
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        open={open}
        onOpenChange={onOpenChange}
        title="Salvar como modelo"
        description="Os blocos e as opções desta proposta viram o ponto de partida das próximas. O cliente e os valores não vão junto."
        footer={
          <Button
            variant="primary"
            block
            type="submit"
            form="salvar-modelo-form"
            loading={saving}
            disabled={!name.trim()}
          >
            Salvar modelo
          </Button>
        }
      >
        <form id="salvar-modelo-form" onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <Field invalid={fieldError?.campo === "name"}>
            <Label>Nome do modelo</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Portugal em casal"
              autoFocus
            />
            {fieldError?.campo === "name" ? <FieldError>{fieldError.mensagem}</FieldError> : null}
          </Field>
          {fieldError && !fieldError.campo ? <FieldError>{fieldError.mensagem}</FieldError> : null}
        </form>
      </SheetContent>
    </Sheet>
  );
}
