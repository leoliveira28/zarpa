"use client";

import * as React from "react";
import Link from "next/link";
import {
  criarPropostaAPartirDoNegocio,
  listarNegocios,
  type NegocioResumo,
} from "@/server";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { CardAction } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Field, FieldError, FieldHint, Label } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { PreviaDoModelo } from "@/components/app/PreviaDoModelo";
import { Rule } from "@/components/plates";
import { useToast } from "@/components/ui/Toast";
import { avisarRecusaDeEscrita } from "@/lib/ui/assinatura";
import {
  criarPropostaDeTemplate,
  definirTemplatePadrao,
  listarTemplates,
  removerTemplate,
  type TemplateResumo,
} from "@/lib/ui/fase12Api";
import { useDeferredDelete } from "@/lib/ui/useDeferredDelete";
import { cn } from "@/lib/ui/cn";

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

   Fase 1 do Monde — COMEÇAR DE UM MODELO. A escolha do ponto de partida vem
   ANTES dos campos: modelo pré-caprichado ou do zero, uma linha cada, o
   default do tenant já marcado. A escolha muda a ação do rodapé, não o
   formulário — negócio e título são comuns aos dois caminhos, e a troca de
   radio é só de intenção. E não é feita no escuro: o modelo escolhido tem
   PRÉVIA (`PreviaDoModelo`) — o sumário dos blocos antes de criar, logo
   abaixo da lista. Remover modelo mora AQUI, na mesma linha que
   lista — destrutivo com desfazer de 8s (`useDeferredDelete`), não modal:
   o modelo só é apagado de verdade se os 8 segundos passarem sem arrependimento.

   "Tornar padrão" só existe na linha ESCOLHIDA e ainda não-padrão: trocar o
   default é decisão rara e uma ação em toda linha viraria painel de controle
   numa sheet que abre quinze vezes por dia. O momento da ação é exatamente
   quando a agente acabou de preferir um modelo ao padrão — "esse que escolhi
   merece ser o de sempre" — e o toque troca o Badge de linha na hora.
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

/** A escolha "sem modelo" — o caminho de sempre, agora explicitado na lista. */
const DO_ZERO = "zero";

export function NovaPropostaSheet({
  open,
  onOpenChange,
  onCreated,
  negocioFixo,
}: NovaPropostaSheetProps) {
  const toast = useToast();
  const [dealId, setDealId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<{ campo?: string; mensagem: string } | null>(null);
  const [negocios, setNegocios] = React.useState<NegocioResumo[]>([]);
  const [loadingNegocios, setLoadingNegocios] = React.useState(false);

  // Modelos: `null` = carregando (o espaço fica reservado — nada pula quando
  // a lista chega), `[]` = nenhum modelo ainda (a seção inteira some: sem
  // modelos, esta sheet É o fluxo do zero de sempre, e a descoberta do
  // recurso mora no botão "Salvar como modelo" do editor).
  const [templates, setTemplates] = React.useState<TemplateResumo[] | null>(null);
  const [templatesError, setTemplatesError] = React.useState<string | null>(null);
  const [reloadTemplatesToken, setReloadTemplatesToken] = React.useState(0);
  const retryTemplates = React.useCallback(() => setReloadTemplatesToken((t) => t + 1), []);
  const [escolha, setEscolha] = React.useState(DO_ZERO);

  React.useEffect(() => {
    if (!open) {
      setDealId("");
      setTitle("");
      setFieldError(null);
      setNegocios([]);
      setTemplates(null);
      setTemplatesError(null);
      setEscolha(DO_ZERO);
      return;
    }
    if (negocioFixo) return; // o negócio já está decidido — nada para buscar
    setLoadingNegocios(true);
    void listarNegocios({ limite: 100 }).then((result) => {
      setLoadingNegocios(false);
      if (result.ok) setNegocios(result.data);
    });
  }, [open, negocioFixo]);

  React.useEffect(() => {
    if (!open) return;
    setTemplates(null);
    setTemplatesError(null);
    void listarTemplates().then((result) => {
      if (!result.ok) {
        setTemplatesError(result.mensagem);
        return;
      }
      setTemplates(result.data);
      // O default do tenant já vem marcado — o caminho provável é recomeçar
      // do que já funcionou; "do zero" é a escolha consciente, não a de fábrica.
      const padrao = result.data.find((t) => t.isDefault);
      setEscolha(padrao?.id ?? DO_ZERO);
    });
  }, [open, reloadTemplatesToken]);

  const scheduleDelete = useDeferredDelete<TemplateResumo>({
    label: (item) => `Modelo removido: ${item.name}`,
    commit: (item) => removerTemplate(item.id),
    onFailure: () => {
      // A recusa (gate de dunning, modelo já apagado em outra aba) volta a
      // lista ao estado real do servidor em vez de mentir em silêncio.
      retryTemplates();
    },
  });

  function handleRemoveTemplate(template: TemplateResumo) {
    // Sai da tela na hora (é o que a agente pediu); o banco só fica sabendo
    // depois dos 8s. Se estava escolhido, a escolha volta para o que sobrou.
    setTemplates((current) => {
      const restantes = current?.filter((t) => t.id !== template.id) ?? [];
      if (escolha === template.id) setEscolha(restantes.find((t) => t.isDefault)?.id ?? DO_ZERO);
      return restantes;
    });
    scheduleDelete(template);
  }

  async function handleDefinirPadrao(template: TemplateResumo) {
    // Otimista: o Badge "Padrão" troca de linha no toque — o servidor confirma
    // em seguida e, se recusar, a lista volta ao estado real.
    setTemplates(
      (current) => current?.map((t) => ({ ...t, isDefault: t.id === template.id })) ?? current,
    );
    const result = await definirTemplatePadrao(template.id);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      toast.show({
        title: "Não consegui tornar este o modelo padrão",
        description: result.mensagem,
        tone: "danger",
      });
      retryTemplates();
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setFieldError(null);
    const dealIdEfetivo = (negocioFixo?.id ?? dealId).trim();
    const result =
      escolha === DO_ZERO
        ? await criarPropostaAPartirDoNegocio({
            dealId: dealIdEfetivo,
            title: title.trim() || undefined,
          })
        : await criarPropostaDeTemplate({
            templateId: escolha,
            dealId: dealIdEfetivo,
          });
    setCreating(false);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      setFieldError({ campo: result.campo, mensagem: result.mensagem });
      return;
    }
    // Os dois caminhos devolvem formas diferentes do MESMO destino: o do zero
    // volta com a proposta inteira (`{ id }`), o de modelo com o endereço
    // (`{ proposalId }`). Normalizar aqui — a sheet só precisa do id.
    const novoId = "id" in result.data ? result.data.id : result.data.proposalId;
    onCreated(novoId);
  }

  const selectedNegocio = negocios.find((n) => n.id === dealId);
  const effectiveDealId = negocioFixo?.id ?? dealId;
  const temModelos = (templates?.length ?? 0) > 0;

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
            {escolha === DO_ZERO ? "Criar e montar" : "Criar do modelo"}
          </Button>
        }
      >
        <form id="nova-proposta-form" onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          {/* --- Ponto de partida (só existe quando há modelos) --------- */}
          {templates !== null || templatesError ? (
            <section aria-labelledby="modelo-heading" className="flex flex-col gap-2">
              <h3
                id="modelo-heading"
                className="text-13 font-semibold uppercase tracking-[0.04em] text-muted"
              >
                Começar de um modelo
              </h3>

              {templatesError ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="text-13 text-muted">{templatesError}</p>
                  <CardAction onClick={retryTemplates}>Tentar de novo</CardAction>
                </div>
              ) : templates === null ? (
                /* O lugar da lista fica reservado: a sheet não cresce de
                   repente quando os modelos chegam. */
                <div className="flex flex-col gap-2" aria-hidden>
                  <Skeleton className="h-5 w-2/3 rounded-xs" />
                  <Skeleton className="h-5 w-1/2 rounded-xs" />
                </div>
              ) : temModelos ? (
                <div role="radiogroup" aria-label="Ponto de partida da proposta" className="flex flex-col">
                  {templates.map((template) => (
                    <React.Fragment key={template.id}>
                      <ModeloRow
                        template={template}
                        checked={escolha === template.id}
                        onChoose={() => setEscolha(template.id)}
                        onRemove={() => handleRemoveTemplate(template)}
                        onTornarPadrao={
                          escolha === template.id && !template.isDefault
                            ? () => void handleDefinirPadrao(template)
                            : undefined
                        }
                      />
                      <Rule inner />
                    </React.Fragment>
                  ))}
                  <DoZeroRow checked={escolha === DO_ZERO} onChoose={() => setEscolha(DO_ZERO)} />
                </div>
              ) : null}

              {/* A prévia do modelo escolhido — inclusive do default, que já vem
                  marcado ao abrir: o sumário está na tela antes do primeiro
                  toque. Com "Do zero" ela não renderiza nada. */}
              <PreviaDoModelo
                templateId={escolha === DO_ZERO ? null : escolha}
                templateName={templates?.find((t) => t.id === escolha)?.name ?? ""}
                onComecarDoZero={() => setEscolha(DO_ZERO)}
              />

              {temModelos ? (
                /* Fora do radiogroup de propósito: parágrafo não é rádio. E a
                   redação sobrevive ao modelo sem blocos — "o que o modelo tem"
                   pode ser nada, e continua sendo verdade. */
                <FieldHint>
                  O que o modelo tem — blocos e opções — vai junto; cliente e
                  valores continuam saindo deste negócio.
                </FieldHint>
              ) : null}
            </section>
          ) : null}

          {temModelos ? <Rule loose /> : null}

          {/* --- Os campos comuns aos dois caminhos --------------------- */}
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
              ) : !loadingNegocios && negocios.length === 0 ? (
                /* Conta nova: o "+" global abre esta Sheet antes de existir
                   qualquer negócio. Sem isto, o Combobox vazio é um beco —
                   com o link, o toque mais tentador da tela ensina a ordem
                   certa (cliente → negócio → proposta) em vez de recusar. */
                <FieldHint>
                  Você ainda não tem negócio — ele nasce no funil, a partir de
                  um cliente.{" "}
                  <Link
                    href="/funil"
                    /* Fecha a sheet antes de navegar: ela vive no shell e
                       sobreviveria à troca de rota, aberta sobre o funil. */
                    onClick={() => onOpenChange(false)}
                    className="font-medium text-ink underline underline-offset-4 hover:text-muted"
                  >
                    Ir ao funil
                  </Link>
                </FieldHint>
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

/* ---------------------------------------------------------------- linhas --- */

/**
 * Uma linha do cardápio de partida. O alvo inteiro é o rádio (pointerdown —
 * a troca acontece no toque, não 100ms depois); as ações são texto FORA do
 * botão do rádio — button dentro de button não existe, e destrutivo não
 * disputa espaço com a escolha. "Tornar padrão" aparece só na linha escolhida
 * e ainda não-padrão (ver a nota do topo).
 */
function ModeloRow({
  template,
  checked,
  onChoose,
  onRemove,
  onTornarPadrao,
}: {
  template: TemplateResumo;
  checked: boolean;
  onChoose: () => void;
  onRemove: () => void;
  onTornarPadrao?: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        role="radio"
        aria-checked={checked}
        onPointerDown={onChoose}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 py-1.5 text-left"
      >
        <RadioGlyph checked={checked} />
        <span className={cn("truncate text-15", checked ? "font-medium text-ink" : "text-ink")}>
          {template.name}
        </span>
        {template.isDefault ? <Badge tone="accent">Padrão</Badge> : null}
      </button>
      {onTornarPadrao ? (
        <CardAction
          className="shrink-0 [@media(pointer:coarse)]:min-h-11"
          onClick={onTornarPadrao}
        >
          Tornar padrão
        </CardAction>
      ) : null}
      <CardAction
        className="shrink-0 text-danger hover:text-danger [@media(pointer:coarse)]:min-h-11"
        onClick={onRemove}
      >
        Remover
      </CardAction>
    </div>
  );
}

function DoZeroRow({ checked, onChoose }: { checked: boolean; onChoose: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onPointerDown={onChoose}
      className="flex min-h-11 items-center gap-3 py-1.5 text-left"
    >
      <RadioGlyph checked={checked} />
      <span className="text-15 text-ink">Do zero</span>
    </button>
  );
}

/** O rádio: a mesma caixa de 20px do Checkbox, redonda, ponto em vez de tique.
 * Selecionado é estado, não convite — o acento aqui marca O QUE está escolhido,
 * o mesmo contrato de `data-[state=checked]` do Checkbox. A cor da borda troca
 * NO TOQUE, sem transição (doutrina: só transform e opacity animam) — o
 * movimento que comunica é o ponto crescendo, e ele basta. */
function RadioGlyph({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-pill border bg-surface",
        checked ? "border-accent" : "border-line-strong",
      )}
    >
      <span
        className={cn(
          "size-2.5 rounded-pill bg-accent [transition:transform_120ms_var(--curve-out)]",
          checked ? "scale-100" : "scale-0",
        )}
      />
    </span>
  );
}
