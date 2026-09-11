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
   O bloco carrega id="interesse": é o alvo da âncora do cartão de preço.
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
      <div id="interesse" className="scroll-mt-24 rounded-xl border border-line bg-surface p-5 shadow-2">
        <p className="text-17 font-medium text-ink">Interesse registrado!</p>
        <p className="mt-1 text-15 leading-[1.5] text-muted">
          A {agenciaNome} recebeu seu contato sobre “{titulo}” e responde em até 1 dia.
        </p>
      </div>
    );
  }

  if (estado === "fechado") {
    return (
      <div
        id="interesse"
        className="flex scroll-mt-24 flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-2"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-17 font-semibold text-ink">Fale com a {agenciaNome}</h2>
          <p className="text-13 leading-[1.5] text-muted">
            Deixe seu contato sobre “{titulo}” — a agência responde em até 1 dia.
          </p>
        </div>
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
      </div>
    );
  }

  return (
    <form
      id="interesse"
      onSubmit={handleSubmit}
      className="flex scroll-mt-24 flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-2"
    >
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
