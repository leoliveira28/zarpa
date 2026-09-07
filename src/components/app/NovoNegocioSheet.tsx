"use client";

import * as React from "react";
import {
  criarNegocio,
  listarContatos,
  type ContatoResumo,
  type NegocioDoFunil,
} from "@/server";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Field, FieldError, FieldHint, Label } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { avisarRecusaDeEscrita } from "@/lib/ui/assinatura";

/* =============================================================================
   Novo negócio — o ponto de entrada que faltava
   -----------------------------------------------------------------------------
   Auditoria ao vivo (docs/handoffs/rafa-para-nina.md): não existia NENHUM jeito
   de criar um negócio pela interface. `criarNegocio` já funcionava no servidor
   desde o S4 — sem uma tela chamando, "Nova proposta" ficava travada num
   combobox vazio para todo tenant novo. Este é o bloqueio nº1 do produto.

   Dois pontos de entrada chamam esta MESMA Sheet (`FunnelScreen`, cabeçalho, e
   `ContatoScreen`, ficha do contato) — duas marcações divergiriam no primeiro
   ajuste, mesmo raciocínio que já vale para `CardBody` do card do funil.

   `contatoFixo` é a diferença entre os dois: vindo da ficha do contato, a
   pessoa já está decidida — buscar de novo o mesmo nome que está no topo da
   tela seria pedir a mesma informação duas vezes. O campo vira um rótulo fixo
   em vez de Combobox, e a busca de contatos nem roda.

   Sheet curta de propósito: contato, título, destino e datas — nada de
   moeda/pax/valor aqui. Quem precisar disso ajusta na ficha do negócio depois
   (o valor nasce em 0, e o funil já mostra "R$ 0,00" com largura reservada,
   não um traço vazio).
   ========================================================================== */

export interface NovoNegocioSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (negocio: NegocioDoFunil) => void;
  /** Presente quando a Sheet abre a partir da ficha do contato: pula a busca. */
  contatoFixo?: { id: string; nome: string };
}

export function NovoNegocioSheet({
  open,
  onOpenChange,
  onCreated,
  contatoFixo,
}: NovoNegocioSheetProps) {
  const [contactId, setContactId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [destination, setDestination] = React.useState("");
  const [departureOn, setDepartureOn] = React.useState("");
  const [returnOn, setReturnOn] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<{
    campo?: string;
    mensagem: string;
  } | null>(null);
  const [contatos, setContatos] = React.useState<ContatoResumo[]>([]);
  const [loadingContatos, setLoadingContatos] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setContactId("");
      setTitle("");
      setDestination("");
      setDepartureOn("");
      setReturnOn("");
      setFieldError(null);
      setContatos([]);
      return;
    }
    if (contatoFixo) return; // o contato já está decidido — nada para buscar
    setLoadingContatos(true);
    void listarContatos({ limite: 200 }).then((result) => {
      setLoadingContatos(false);
      if (result.ok) setContatos(result.data);
    });
  }, [open, contatoFixo]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setFieldError(null);
    const result = await criarNegocio({
      contactId: contatoFixo?.id ?? contactId,
      title: title.trim(),
      destination: destination.trim() || undefined,
      departureOn: departureOn || undefined,
      returnOn: returnOn || undefined,
      // Não coletado nesta Sheet curta — "data prevista de fechamento" é
      // ajuste fino de pipeline, não algo que se decide ao criar o negócio.
      expectedCloseOn: undefined,
    });
    setCreating(false);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      setFieldError({ campo: result.campo, mensagem: result.mensagem });
      return;
    }
    onCreated(result.data);
  }

  const selectedContato = contatos.find((c) => c.id === contactId);
  const effectiveContactId = contatoFixo?.id ?? contactId;
  const canSubmit = effectiveContactId.length > 0 && title.trim().length >= 2;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        open={open}
        onOpenChange={onOpenChange}
        title="Novo negócio"
        description="Todo negócio parte de um contato já cadastrado."
        footer={
          <Button
            variant="primary"
            block
            type="submit"
            form="novo-negocio-form"
            loading={creating}
            disabled={!canSubmit}
          >
            Criar negócio
          </Button>
        }
      >
        <form
          id="novo-negocio-form"
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 py-2"
        >
          {contatoFixo ? (
            <Field>
              <Label>Contato</Label>
              <div className="flex h-10 items-center rounded-md border border-line-subtle bg-inset px-3 text-15 text-ink [@media(pointer:coarse)]:h-11">
                {contatoFixo.nome}
              </div>
            </Field>
          ) : (
            <Field invalid={fieldError?.campo === "contactId"}>
              <Label>Contato</Label>
              <Combobox
                value={contactId}
                onValueChange={(value) => setContactId(value ?? "")}
                options={contatos.map((c) => ({
                  value: c.id,
                  label: c.name,
                  hint: c.whatsapp ?? c.phone ?? undefined,
                }))}
                placeholder="Selecione um contato"
                searchPlaceholder="Buscar por nome"
                loading={loadingContatos}
                emptyMessage="Nenhum contato encontrado"
                invalid={fieldError?.campo === "contactId"}
              />
              {fieldError?.campo === "contactId" ? (
                <FieldError>{fieldError.mensagem}</FieldError>
              ) : !loadingContatos && contatos.length === 0 ? (
                <FieldHint>
                  Nenhum cliente cadastrado ainda — cadastre um em Clientes primeiro.
                </FieldHint>
              ) : selectedContato ? (
                <FieldHint>
                  {selectedContato.whatsapp ?? selectedContato.phone ?? selectedContato.email ?? "Sem contato de retorno cadastrado"}
                </FieldHint>
              ) : null}
            </Field>
          )}

          <Field invalid={fieldError?.campo === "title"}>
            <Label>Título do negócio</Label>
            <Input
              autoFocus={!!contatoFixo}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex.: Lua de mel em Fernando de Noronha"
            />
            {fieldError?.campo === "title" ? (
              <FieldError>{fieldError.mensagem}</FieldError>
            ) : null}
          </Field>

          <Field>
            <Label optional>Destino</Label>
            <Input
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder="Fernando de Noronha"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field invalid={fieldError?.campo === "departureOn"}>
              <Label optional>Ida</Label>
              <Input
                type="date"
                value={departureOn}
                onChange={(event) => setDepartureOn(event.target.value)}
              />
              {fieldError?.campo === "departureOn" ? (
                <FieldError>{fieldError.mensagem}</FieldError>
              ) : null}
            </Field>
            <Field invalid={fieldError?.campo === "returnOn"}>
              <Label optional>Volta</Label>
              <Input
                type="date"
                value={returnOn}
                onChange={(event) => setReturnOn(event.target.value)}
              />
              {fieldError?.campo === "returnOn" ? (
                <FieldError>{fieldError.mensagem}</FieldError>
              ) : null}
            </Field>
          </div>

          {fieldError && !fieldError.campo ? (
            <FieldError>{fieldError.mensagem}</FieldError>
          ) : null}
        </form>
      </SheetContent>
    </Sheet>
  );
}
