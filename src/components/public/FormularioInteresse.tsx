"use client";

import * as React from "react";
import { registrarInteresseOferta } from "@/server";
import { Field, FieldError, Label } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

/* =============================================================================
   Formulário de interesse da oferta pública (Fit 7b, início: nome + WhatsApp)
   -----------------------------------------------------------------------------
   O CTA é ISTO — formulário curto, contexto da oferta visível, expectativa
   dita ("a agência responde"). O cliente NUNCA loga no Zarpa: o servidor cria
   (ou reusa) o contato com a tag `vitrine` e registra o interesse — a agente
   vê na ficha da oferta e transforma em negócio.
   ========================================================================== */

type Estado = "fechado" | "formulario" | "enviando" | "sucesso";

export function FormularioInteresse({
  slug,
  token,
  titulo,
  agenciaNome,
  whatsappFallback,
}: {
  slug: string;
  token: string;
  titulo: string;
  agenciaNome: string;
  /** Link wa.me da agência — o caminho B se o formulário falhar. */
  whatsappFallback: string | null;
}) {
  const [estado, setEstado] = React.useState<Estado>("fechado");
  const [name, setName] = React.useState("");
  const [whatsapp, setWhatsapp] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setEstado("enviando");
    setErro(null);
    const resultado = await registrarInteresseOferta({ slug, token, name, whatsapp });
    if (!resultado.ok) {
      setEstado("formulario");
      setErro(resultado.mensagem ?? "Não deu certo — tente de novo.");
      return;
    }
    setEstado("sucesso");
  }

  if (estado === "sucesso") {
    return (
      <div className="rounded-lg border border-line bg-surface p-5">
        <p className="text-17 font-medium text-ink">Interesse registrado!</p>
        <p className="mt-1 text-15 leading-[1.5] text-muted">
          A {agenciaNome} recebeu seu contato sobre “{titulo}” e responde em até 1 dia.
        </p>
      </div>
    );
  }

  if (estado === "fechado") {
    return (
      <div className="flex flex-col gap-2">
        <Button
          variant="primary"
          onClick={() => setEstado("formulario")}
          className="min-h-11"
        >
          Tenho interesse
        </Button>
        {whatsappFallback ? (
          <a
            href={whatsappFallback}
            target="_blank"
            rel="noopener"
            className="w-fit text-13 font-medium text-muted underline underline-offset-4 hover:text-ink"
          >
            ou fala direto no WhatsApp
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <p className="text-13 text-muted">
        Deixe seu contato que a {agenciaNome} fala com você sobre “{titulo}”.
      </p>
      <Field invalid={Boolean(erro && name.trim().length < 2)}>
        <Label>Seu nome</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Como você se chama"
          autoComplete="name"
          required
        />
      </Field>
      <Field invalid={Boolean(erro && /WhatsApp/i.test(erro ?? ""))}>
        <Label>WhatsApp</Label>
        <Input
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          placeholder="(11) 99999-0000"
          inputMode="tel"
          autoComplete="tel"
          required
        />
      </Field>
      {erro ? <FieldError>{erro}</FieldError> : null}
      <div className="flex items-center gap-2">
        <Button variant="primary" type="submit" loading={estado === "enviando"} className="min-h-11">
          Quero saber mais
        </Button>
        <button
          type="button"
          onClick={() => setEstado("fechado")}
          className="text-13 font-medium text-muted underline underline-offset-4 hover:text-ink"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
