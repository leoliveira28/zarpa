"use client";

import * as React from "react";
import {
  criarPropostaAPartirDoNegocio,
  listarNegocios,
  type NegocioResumo,
} from "@/server";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Field, FieldError, FieldHint, Label } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Sheet, SheetContent } from "@/components/ui/Sheet";

/* =============================================================================
   Nova proposta — a mesma Sheet, dois pontos de entrada
   -----------------------------------------------------------------------------
   Extraída de `PropostasScreen.tsx` (onde nasceu) para a ficha do negócio
   (`funil/[id]/NegocioScreen.tsx`) poder abrir a MESMA Sheet com o negócio já
   decidido — mesmo raciocínio de `contatoFixo` em `NovoNegocioSheet`: a ficha
   do negócio já mostra contato, título e destino no topo da tela; pedir de
   novo por um Combobox de busca seria perguntar a mesma coisa duas vezes.

   `negocioFixo` pula `listarNegocios()` inteiro (a busca nem roda) e troca o
   Combobox por um rótulo fixo — o mesmo desenho do campo "Contato" fixo de
   `NovoNegocioSheet`.
   ========================================================================== */

export interface NegocioFixo {
  id: string;
  title: string;
  contactName: string;
  destination: string | null;
}

export interface NovaPropostaSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
  /** Presente quando a Sheet abre a partir da ficha do negócio: pula a busca. */
  negocioFixo?: NegocioFixo;
}

export function NovaPropostaSheet({
  open,
  onOpenChange,
  onCreated,
  negocioFixo,
}: NovaPropostaSheetProps) {
  const [dealId, setDealId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<{ campo?: string; mensagem: string } | null>(null);
  const [negocios, setNegocios] = React.useState<NegocioResumo[]>([]);
  const [loadingNegocios, setLoadingNegocios] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setDealId("");
      setTitle("");
      setFieldError(null);
      setNegocios([]);
      return;
    }
    if (negocioFixo) return; // o negócio já está decidido — nada para buscar
    setLoadingNegocios(true);
    void listarNegocios({ limite: 100 }).then((result) => {
      setLoadingNegocios(false);
      if (result.ok) setNegocios(result.data);
    });
  }, [open, negocioFixo]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setFieldError(null);
    const result = await criarPropostaAPartirDoNegocio({
      dealId: (negocioFixo?.id ?? dealId).trim(),
      title: title.trim() || undefined,
    });
    setCreating(false);
    if (!result.ok) {
      setFieldError({ campo: result.campo, mensagem: result.mensagem });
      return;
    }
    onCreated(result.data.id);
  }

  const selectedNegocio = negocios.find((n) => n.id === dealId);
  const effectiveDealId = negocioFixo?.id ?? dealId;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        open={open}
        onOpenChange={onOpenChange}
        title="Nova proposta"
        description="Toda proposta parte de um negócio já existente."
        footer={
          <Button
            variant="primary"
            block
            type="submit"
            form="nova-proposta-form"
            loading={creating}
            disabled={!effectiveDealId}
          >
            Criar e montar
          </Button>
        }
      >
        <form id="nova-proposta-form" onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          {negocioFixo ? (
            <Field>
              <Label>Negócio</Label>
              <div className="flex h-10 items-center rounded-md border border-line-subtle bg-inset px-3 text-15 text-ink [@media(pointer:coarse)]:h-11">
                <span className="truncate">
                  {negocioFixo.title}
                  <span className="text-muted"> · {negocioFixo.contactName}</span>
                </span>
              </div>
            </Field>
          ) : (
            <Field invalid={fieldError?.campo === "dealId"}>
              <Label>Negócio</Label>
              <Combobox
                value={dealId}
                onValueChange={(value) => setDealId(value ?? "")}
                options={negocios.map((n) => ({
                  value: n.id,
                  label: n.title,
                  hint: n.contactName + (n.destination ? ` · ${n.destination}` : ""),
                }))}
                placeholder="Selecione um negócio"
                searchPlaceholder="Buscar por título, destino ou contato"
                loading={loadingNegocios}
                emptyMessage="Nenhum negócio encontrado"
                invalid={fieldError?.campo === "dealId"}
              />
              {fieldError?.campo === "dealId" ? (
                <FieldError>{fieldError.mensagem}</FieldError>
              ) : selectedNegocio ? (
                <FieldHint>
                  {selectedNegocio.contactName}
                  {selectedNegocio.destination && ` · ${selectedNegocio.destination}`}
                </FieldHint>
              ) : null}
            </Field>
          )}

          <Field>
            <Label optional>Título da proposta</Label>
            <Input
              autoFocus={!!negocioFixo}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Padrão: destino do negócio"
            />
          </Field>

          {fieldError && !fieldError.campo ? <FieldError>{fieldError.mensagem}</FieldError> : null}
        </form>
      </SheetContent>
    </Sheet>
  );
}
