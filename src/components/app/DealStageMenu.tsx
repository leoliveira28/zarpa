"use client";

import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  COLUNAS_DO_FUNIL,
  moverEstagioDoNegocio,
  type DealStage,
  type EstagioDeFunil,
} from "@/server";
import { cn } from "@/lib/ui/cn";
import { Button } from "@/components/ui/Button";
import { CardAction } from "@/components/ui/Card";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/Dialog";
import { Field, FieldError, FieldHint, Label } from "@/components/ui/Field";
import { Textarea } from "@/components/ui/Input";

/* =============================================================================
   Mudar estágio — menu + motivo de perda, num lugar só
   -----------------------------------------------------------------------------
   Extraído de `FunnelScreen.tsx` (onde nasceu, v3/S4) para a ficha do negócio
   (`funil/[id]/NegocioScreen.tsx`) poder oferecer a MESMA ação sem duplicar a
   lista de estágios nem a validação do motivo de perda. Dois pontos de entrada,
   um só lugar que sabe como mover um negócio — mesmo raciocínio de
   `NovoNegocioSheet`/`contatoFixo` e agora `NovaPropostaSheet`/`negocioFixo`.

   `DealStageMenu` é só o CARDÁPIO — decide qual estágio, chama `onMove`/
   `onRequestLoss`, não fala com o servidor: quem chama decide como aplicar o
   patch otimista (a lista do funil e a ficha do negócio guardam o negócio de
   jeitos diferentes — array vs. objeto único — então essa parte não dava pra
   compartilhar sem inventar um estado genérico maior que o problema).

   `LossReasonDialog` é quem fala com o servidor: auto-contida (motivo,
   validação de 3 caracteres, estado de envio, erro) porque essa é a parte que
   tinha lógica de verdade, não só marcação — essa sim é 100% igual nos dois
   lugares.
   ========================================================================== */

/** Mesmo mínimo que o servidor exige (`moverEstagioDoNegocio`) — a UI recusa antes de gastar uma chamada de rede. */
export const MIN_LOST_REASON_LENGTH = 3;

/** Caminho de teclado para a mesma ação do arrasto no Funil — e a única porta para "perdida". */
export function DealStageMenu({
  contactName,
  currentStage,
  onMove,
  onRequestLoss,
  revealOnHover = false,
}: {
  contactName: string;
  currentStage: DealStage;
  onMove: (stage: EstagioDeFunil) => void;
  onRequestLoss: () => void;
  /**
   * O card do Funil é denso demais para um kebab sempre visível — ali ele só
   * aparece no hover/foco do `.group/card` mais próximo (e sempre, em
   * ponteiro grosso). Fora do card (ficha do negócio, com espaço de sobra) o
   * padrão é sempre visível: não existe `.group/card` ali, e um kebab que só
   * aparece com o mouse sobre uma área que não é hover de nada fica invisível
   * pra sempre no ponteiro fino.
   */
  revealOnHover?: boolean;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        data-stage-menu=""
        aria-label={`Mover ${contactName} de estágio`}
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-sm",
          "text-muted hover:bg-surface-3 hover:text-ink",
          revealOnHover &&
            cn(
              "-mt-1 -mr-1",
              // some no repouso do ponteiro fino e volta no hover, no foco e
              // enquanto o menu está aberto. Em ponteiro grosso não há hover:
              // lá ele fica sempre visível, senão vira ação inalcançável.
              "opacity-0 [transition:opacity_120ms_var(--curve-out)]",
              "group-hover/card:opacity-100 focus-visible:opacity-100",
              "data-[state=open]:opacity-100",
              "[@media(pointer:coarse)]:opacity-100",
            ),
        )}
      >
        <svg
          viewBox="0 0 16 16"
          className="size-4"
          fill="currentColor"
          aria-hidden
        >
          <circle cx="8" cy="3.5" r="1.15" />
          <circle cx="8" cy="8" r="1.15" />
          <circle cx="8" cy="12.5" r="1.15" />
        </svg>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="zk-pop z-50 min-w-48 rounded-lg border border-line bg-surface p-1 shadow-3"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-13 font-semibold tracking-[0.04em] text-muted uppercase">
            Mover para
          </DropdownMenu.Label>
          {COLUNAS_DO_FUNIL.map(({ estagio, label }) => (
            <DropdownMenu.Item
              key={estagio}
              disabled={estagio === currentStage}
              onSelect={() => onMove(estagio)}
              className={cn(
                "flex min-h-9 cursor-pointer items-center rounded-md px-2 text-15 text-ink outline-none",
                "data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent-soft-ink",
                "data-[disabled]:pointer-events-none data-[disabled]:text-subtle",
                "[@media(pointer:coarse)]:min-h-11",
              )}
            >
              {label}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="mx-1 my-1 h-px bg-hairline" />
          <DropdownMenu.Item
            onSelect={onRequestLoss}
            className={cn(
              "flex min-h-9 cursor-pointer items-center rounded-md px-2 text-15 text-danger outline-none",
              "data-[highlighted]:bg-danger-soft data-[highlighted]:text-danger-soft-ink",
              "[@media(pointer:coarse)]:min-h-11",
            )}
          >
            Marcar como perdida…
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * Diálogo — não sheet, porque isto é decisão que exige informação nova antes
 * de continuar (a doutrina de `Dialog.tsx`), não confirmação de "tem
 * certeza?". A parte destrutiva de verdade (o negócio some da lista/sai do
 * quadro) segue a regra normal do produto: acontece na hora, com toast de
 * DESFAZER de 8s — só a captação do motivo é que precisa de modal.
 *
 * Fala com o servidor sozinha (`moverEstagioDoNegocio`) para os dois pontos
 * de entrada nunca divergirem na validação. `onLost` só dispara DEPOIS do
 * servidor confirmar — quem chama faz o patch otimista da própria tela
 * (remover da lista do funil, ou atualizar o objeto único da ficha) e o
 * toast de desfazer.
 */
export function LossReasonDialog({
  deal,
  onOpenChange,
  onLost,
}: {
  /** `null` fecha o diálogo. */
  deal: { id: string; contactName: string } | null;
  onOpenChange: (open: boolean) => void;
  onLost: (dealId: string, motivo: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function handleOpenChange(open: boolean) {
    if (!open) {
      setReason("");
      setError(null);
      setSubmitting(false);
    }
    onOpenChange(open);
  }

  async function handleConfirm() {
    if (!deal) return;
    const motivo = reason.trim();
    if (motivo.length < MIN_LOST_REASON_LENGTH) {
      setError("Escreva pelo menos 3 caracteres — é o que fica no histórico do negócio.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await moverEstagioDoNegocio(deal.id, "perdido", motivo);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.mensagem);
      return;
    }
    onLost(deal.id, motivo);
  }

  return (
    <Dialog open={deal !== null} onOpenChange={handleOpenChange}>
      <DialogContent
        title="Marcar como perdida"
        description={
          deal
            ? `${deal.contactName} sai do quadro. O motivo fica na linha do tempo do negócio — obrigatório, não dá para arquivar sem ele.`
            : undefined
        }
        footer={
          <>
            <DialogClose asChild>
              <CardAction>cancelar</CardAction>
            </DialogClose>
            <Button
              variant="danger"
              loading={submitting}
              disabled={reason.trim().length < MIN_LOST_REASON_LENGTH}
              onClick={() => void handleConfirm()}
            >
              Marcar como perdida
            </Button>
          </>
        }
      >
        <Field invalid={error !== null}>
          <Label>Motivo da perda</Label>
          <Textarea
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              if (error) setError(null);
            }}
            placeholder="Ex.: escolheu outra agência, orçamento não fechou, foi remarcado sem previsão…"
            rows={3}
          />
          {error ? (
            <FieldError>{error}</FieldError>
          ) : (
            <FieldHint>Dá para desfazer por 8 segundos depois de confirmar.</FieldHint>
          )}
        </Field>
      </DialogContent>
    </Dialog>
  );
}
