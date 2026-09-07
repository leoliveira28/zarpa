"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { motion, type PanInfo } from "motion/react";
import {
  COLUNAS_DO_FUNIL,
  listarNegociosDoFunil,
  moverEstagioDoNegocio,
  type EstagioDeFunil,
  type NegocioDoFunil,
} from "@/server";
import { cn } from "@/lib/ui/cn";
import { formatDayMonth } from "@/lib/ui/format";
import {
  projectThrow,
  springLayout,
  usePrefersReducedMotion,
} from "@/lib/ui/motion";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardAction } from "@/components/ui/Card";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/Dialog";
import { Field, FieldError, FieldHint, Label } from "@/components/ui/Field";
import { Textarea } from "@/components/ui/Input";
import { Money } from "@/components/ui/Money";
import { Rule } from "@/components/plates";
import { Skeleton, SkeletonRow } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { CheckIcon, ClockIcon } from "@/components/app/icons";

/* =============================================================================
   Funil — quadro de cinco estágios
   -----------------------------------------------------------------------------
   v3. S4 — o quadro ligado ao servidor (`src/server/deals.ts`, contrato completo
   em docs/handoffs/rafa-para-nina.md). O que muda em relação à v2
   (docs/design/funil-v2.md), que ainda lia `src/lib/ui/sample-data.ts`:

   1. VOCABULÁRIO DE ESTÁGIO VEM DO SERVIDOR. `COLUNAS_DO_FUNIL` (5 colunas —
      `perdido` não é coluna, é saída do funil) substitui `STAGES` local. Uma
      segunda lista aqui desalinharia do enum do banco de novo — foi
      exatamente essa divergência que o comentário de `deals.ts` documenta.

   2. "MARCAR COMO PERDIDA" NÃO É ALVO DE ARRASTO. O servidor exige motivo (≥3
      caracteres) antes de aceitar `stage: 'perdido'`; um drop target não tem
      como coletar texto no meio do gesto. A saída vive no menu do card (☰ →
      "Marcar como perdida…"), que abre um DIÁLOGO — não um sheet, porque isto
      é decisão que exige informação nova antes de continuar (a doutrina de
      `Dialog.tsx`), não confirmação de "tem certeza?". Depois de confirmado,
      o card sai do quadro e vira um toast com DESFAZER de 8s — a parte
      destrutiva da ação (o card sumiu da tela) segue a regra normal do
      produto, só a captação do motivo é que precisou de modal.

   3. TODA CHAMADA AO SERVIDOR É OTIMISTA E REVERSÍVEL. Mover por arrasto ou
      pelo menu atualiza a tela na hora (o toque não pode esperar rede) e só
      confirma depois; se o servidor recusar, o card volta sozinho para onde
      estava, com toast de erro — nunca fica um estado que a tela mostra e o
      banco não tem. O desfazer (para movimento normal OU para perda) chama o
      servidor de novo para voltar ao estágio anterior; se ESSA chamada falhar
      (rede caiu duas vezes seguidas — raro, mas existe), a tela reconsulta o
      quadro inteiro em vez de tentar adivinhar o estado certo sozinha.

   4. O SELO DE "ABRIU O LINK" SAIU DO CARD. `NegocioDoFunil` não carrega
      `opens`/`lastOpenHours` — é sinal de PROPOSTA, não de negócio, e
      `contactId` não é 1:1 com `dealId` (um contato pode ter duas propostas
      em negócios diferentes). Cruzar por contato inflaria o selo errado no
      card errado. `Signal` ficou só com "parada há N dias" / "hoje".

   O que NÃO mudou, porque já estava certo: a raia é um campo preenchido do
   topo à base da coluna; card e card se separam por um fio interno; card
   levantado ganha papel, raio e sombra; ele herda a velocidade do gesto —
   onde cai é onde PARARIA se continuasse desacelerando,
   `(v/1000) * d/(1-d)`, d = 0.998 (src/lib/ui/motion.ts) — e arrastar nunca é
   o único caminho: o menu de estágio continua operável por teclado.
   ========================================================================== */

/** Piso do teto de largura do valor de UM card (R$ 10.000,00). */
const CARD_MONEY_FLOOR = 1_000_000;

/** Piso do teto de largura das somas de coluna (R$ 100.000,00). */
const COLUMN_MONEY_FLOOR = 10_000_000;

/** Estágio terminal — soma em tinta de estado, sem sinal de estagnação no card. */
const CLOSED_STAGE: EstagioDeFunil = "ganho";

/** Mesmo mínimo que o servidor exige (`moverEstagioDoNegocio`) — a tela recusa antes de gastar uma chamada de rede. */
const MIN_LOST_REASON_LENGTH = 3;

/**
 * `COLUNAS_DO_FUNIL` traz `estagio` + `label`; o texto de coluna vazia é copy
 * de interface, não contrato de servidor — por isso mora aqui, não em
 * `deals.ts` ("eu não tenho essa string, é copy sua", Rafa).
 */
const HINT_BY_STAGE: Record<EstagioDeFunil, string> = {
  novo: "chegou, ainda não virou proposta",
  cotando: "roteiro em construção",
  proposta_enviada: "link no WhatsApp do cliente",
  negociando: "ajuste de valor ou data",
  ganho: "venda confirmada",
};

function sumValueCents(list: NegocioDoFunil[]): number {
  return list.reduce((total, deal) => total + deal.valueCents, 0);
}

const HINT_SEEN_KEY = "zarpa.funil.hintSeen";

function subscribeToHintSeen(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function readHintSeen(): boolean {
  try {
    return window.localStorage.getItem(HINT_SEEN_KEY) === "1";
  } catch {
    return false; // navegação privada: a dica reaparece toda vez. Não é erro.
  }
}

/**
 * A dica de gesto é de primeiro uso, não subtítulo de página (a v1 errou
 * nisto: ocupava ~24px do cabeçalho toda vez que a agente abria a tela, a
 * quinquagésima vez incluída). `useSyncExternalStore` — não `useEffect` +
 * `setState` — para ler o localStorage: o snapshot do servidor é sempre
 * "não vista" (bate com o HTML do servidor, sem flash), e o do cliente lê o
 * valor real sem precisar corrigir depois de montar.
 */
function useDragHint(): [boolean, () => void] {
  const seen = React.useSyncExternalStore(
    subscribeToHintSeen,
    readHintSeen,
    () => false,
  );

  const dismiss = React.useCallback(() => {
    try {
      window.localStorage.setItem(HINT_SEEN_KEY, "1");
    } catch {
      // idem — só não persiste entre sessões.
    }
    // "storage" só dispara nativamente em OUTRAS abas; dispara aqui também
    // para este componente reler o snapshot e esconder a dica na hora.
    window.dispatchEvent(new Event("storage"));
  }, []);

  return [seen, dismiss];
}

type Status = "loading" | "ready" | "error";

export function FunnelScreen() {
  const toast = useToast();
  const reducedMotion = usePrefersReducedMotion();

  const [status, setStatus] = React.useState<Status>("loading");
  const [items, setItems] = React.useState<NegocioDoFunil[]>([]);
  const [loadError, setLoadError] = React.useState<{
    mensagem: string;
    correcao?: string;
  } | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const reload = React.useCallback(() => setReloadToken((n) => n + 1), []);

  const [dragging, setDragging] = React.useState<string | null>(null);
  /* O card levantado é desenhado FORA da raia, num sobrevoo preso à viewport.
     Sem isto ele fica preso a dois cercos: o `overflow-y-auto` da pilha o
     RECORTA, e o `z-index` só vale dentro do contexto de empilhamento da
     própria raia — as raias seguintes têm fundo opaco e pintam por cima. Era
     isso o "card passando por baixo da coluna". */
  const [lift, setLift] = React.useState<{
    deal: NegocioDoFunil;
    width: number;
    dx: number;
    dy: number;
    x: number;
    y: number;
  } | null>(null);
  const [target, setTarget] = React.useState<EstagioDeFunil | null>(null);
  const [hintSeen, dismissHint] = useDragHint();

  const [lossDialog, setLossDialog] = React.useState<NegocioDoFunil | null>(
    null,
  );
  const [lossReason, setLossReason] = React.useState("");
  const [lossSubmitting, setLossSubmitting] = React.useState(false);
  const [lossError, setLossError] = React.useState<string | null>(null);

  const columnRefs = React.useRef(new Map<EstagioDeFunil, HTMLElement>());

  const registerColumn = React.useCallback(
    (stage: EstagioDeFunil) => (node: HTMLElement | null) => {
      if (node) columnRefs.current.set(stage, node);
      else columnRefs.current.delete(stage);
    },
    [],
  );

  /** Qual coluna contém (ou está mais perto de) uma coordenada X da viewport. */
  const columnAtX = React.useCallback((x: number): EstagioDeFunil | null => {
    let best: { stage: EstagioDeFunil; distance: number } | null = null;
    for (const [stage, node] of columnRefs.current) {
      const rect = node.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right) return stage;
      const center = rect.left + rect.width / 2;
      const distance = Math.abs(center - x);
      if (!best || distance < best.distance) best = { stage, distance };
    }
    return best?.stage ?? null;
  }, []);

  React.useEffect(() => {
    let active = true;
    setStatus((current) => (current === "ready" ? current : "loading"));
    void listarNegociosDoFunil().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setLoadError({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setItems(result.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  const columns = React.useMemo(
    () =>
      COLUNAS_DO_FUNIL.map(({ estagio, label }) => {
        const cards = items.filter((item) => item.stage === estagio);
        return {
          estagio,
          label,
          hint: HINT_BY_STAGE[estagio],
          cards,
          cents: sumValueCents(cards),
        };
      }),
    [items],
  );

  // Uma reserva de largura para as cinco somas: o alinhamento entre colunas é
  // o que transforma cinco números em uma comparação.
  const columnCeiling = Math.max(
    COLUMN_MONEY_FLOOR,
    ...columns.map((column) => column.cents),
  );
  // Mesma reserva, por card — teto dinâmico: a v2 usava uma constante tirada
  // do maior valor de exemplo, e um negócio real pode passar longe disso.
  const cardMoneyCeiling = Math.max(
    CARD_MONEY_FLOOR,
    ...items.map((item) => item.valueCents),
  );

  const openCents = React.useMemo(
    () => sumValueCents(items.filter((item) => item.stage !== CLOSED_STAGE)),
    [items],
  );

  /**
   * Reabre um negócio num estágio aberto — o desfazer de um movimento normal
   * E o desfazer de "marcar como perdida" caem aqui, porque as duas coisas
   * são a mesma operação vista do servidor (voltar para um `EstagioDeFunil`).
   * Reinsere otimisticamente (o item pode ter saído da lista, se veio de uma
   * perda) e só then confirma; se o servidor recusar essa SEGUNDA chamada
   * (rede caiu de novo, bem raro), a tela não tenta adivinhar — reconsulta o
   * quadro inteiro para não arriscar divergir do banco silenciosamente.
   */
  async function reopenAt(
    deal: NegocioDoFunil,
    stage: EstagioDeFunil,
    diasParado: number,
  ) {
    setItems((current) => {
      const patched: NegocioDoFunil = { ...deal, stage, diasParado };
      return current.some((item) => item.id === deal.id)
        ? current.map((item) => (item.id === deal.id ? patched : item))
        : [...current, patched];
    });
    const result = await moverEstagioDoNegocio(deal.id, stage);
    if (!result.ok) {
      toast.show({
        title: `Não consegui desfazer — ${deal.contactName}`,
        description: result.mensagem,
        tone: "danger",
      });
      reload();
    }
  }

  async function moveTo(
    deal: NegocioDoFunil,
    stage: EstagioDeFunil,
    viaGesture: boolean,
  ) {
    if (stage === deal.stage) return;
    dismissHint();
    const previousStage = deal.stage;
    const previousIdle = deal.diasParado;

    // otimista: o toque não espera a rede.
    setItems((current) =>
      current.map((item) =>
        item.id === deal.id ? { ...item, stage, diasParado: 0 } : item,
      ),
    );

    const label = COLUNAS_DO_FUNIL.find((c) => c.estagio === stage)?.label ?? stage;
    const result = await moverEstagioDoNegocio(deal.id, stage);

    if (!result.ok) {
      // o servidor recusou — a posição do card não pode divergir do banco.
      setItems((current) =>
        current.map((item) =>
          item.id === deal.id
            ? { ...item, stage: previousStage, diasParado: previousIdle }
            : item,
        ),
      );
      toast.show({
        title: `Não consegui mover ${deal.contactName}`,
        description: result.mensagem,
        tone: "danger",
        action: result.correcao ? { label: result.correcao, onClick: reload } : undefined,
      });
      return;
    }

    toast.undo(
      `${deal.contactName} → ${label}`,
      () => void reopenAt(deal, previousStage, previousIdle),
      {
        description: viaGesture ? undefined : "Movida pelo menu do card",
        tone: "ok",
      },
    );
  }

  function openLossDialog(deal: NegocioDoFunil) {
    dismissHint();
    setLossDialog(deal);
    setLossReason("");
    setLossError(null);
  }

  function handleLossDialogChange(open: boolean) {
    if (open) return;
    setLossDialog(null);
    setLossReason("");
    setLossError(null);
    setLossSubmitting(false);
  }

  async function confirmLoss() {
    const deal = lossDialog;
    if (!deal) return;
    const motivo = lossReason.trim();
    if (motivo.length < MIN_LOST_REASON_LENGTH) {
      setLossError("Escreva pelo menos 3 caracteres — é o que fica no histórico do negócio.");
      return;
    }

    setLossSubmitting(true);
    setLossError(null);
    const result = await moverEstagioDoNegocio(deal.id, "perdido", motivo);
    setLossSubmitting(false);

    if (!result.ok) {
      setLossError(result.mensagem);
      return;
    }

    const previousStage = deal.stage;
    const previousIdle = deal.diasParado;
    setItems((current) => current.filter((item) => item.id !== deal.id));
    setLossDialog(null);
    setLossReason("");

    toast.undo(
      `${deal.contactName} → Perdida`,
      () => void reopenAt(deal, previousStage, previousIdle),
      { description: `Motivo: ${motivo}`, tone: "warn" },
    );
  }

  /** Onde o card PARARIA — não onde o dedo está agora. */
  function projectedStage(info: PanInfo): EstagioDeFunil | null {
    return columnAtX(info.point.x + projectThrow(info.velocity.x));
  }

  function handleDragEnd(deal: NegocioDoFunil, info: PanInfo) {
    setDragging(null);
    setLift(null);
    setTarget(null);
    const stage = projectedStage(info);
    if (stage) void moveTo(deal, stage, true);
  }

  return (
    <div className="flex flex-col gap-3 lg:h-full lg:min-h-0">
      {/* cabeçalho de PÁGINA: só o título, do mesmo tamanho das outras telas.
          Nem subtítulo de instrução, nem total — os dois comiam altura do
          quadro na v1, e nenhum dos dois é conteúdo da página: são conteúdo
          do quadro (abaixo). */}
      <header className="lg:shrink-0">
        <h2 className="text-32 font-semibold text-ink">Funil</h2>
      </header>

      {/* faixa do QUADRO: o total "Em aberto" mora aqui, não na página — é o
          que o conecta ao que ele soma, em vez de flutuar solto num canto. A
          cornija por baixo dela é a mesma que sublinha os cinco cabeçalhos de
          coluna: o total e as colunas são uma coisa só. */}
      <div className="lg:shrink-0">
        <div className="flex items-baseline justify-between gap-3">
          <p
            aria-hidden={hintSeen || status !== "ready"}
            className={cn(
              "text-13 text-subtle [transition:opacity_120ms_var(--curve-out)]",
              (hintSeen || status !== "ready") && "pointer-events-none opacity-0",
            )}
          >
            Arraste o card — ele segue a velocidade do gesto. Ou use o menu do
            card.
          </p>
          <div className="ml-auto flex items-baseline gap-2">
            <span className="shrink-0 text-13 text-muted">Em aberto</span>
            <Money
              cents={status === "ready" ? openCents : null}
              size="17"
              reserveFor={30_000_000}
              align="left"
            />
          </div>
        </div>
        <Rule loose />
      </div>

      {status === "loading" ? (
        <FunnelSkeleton />
      ) : status === "error" ? (
        <Card className="flex flex-col items-start gap-3 p-4">
          <FieldError>{loadError?.mensagem}</FieldError>
          <Button variant="secondary" size="sm" onClick={reload}>
            {loadError?.correcao ?? "Tentar de novo"}
          </Button>
        </Card>
      ) : (
        /* celular: um scroller com encaixe por coluna, o polegar manda.
           desktop: cinco colunas de altura cheia. A largura mínima de 11rem é
           o que impede a coluna de virar tira ilegível: abaixo dela o QUADRO
           rola na horizontal em vez de espremer. As cinco cabem inteiras a
           partir de 1280px, que é o laptop mais comum — abaixo disso o
           quadro rola, e a coluna continua legível. */
        <div
          className={cn(
            "-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2",
            "sm:-mx-6 sm:px-6",
            "[scrollbar-width:thin]",
            "lg:mx-0 lg:min-h-0 lg:flex-1 lg:snap-none lg:px-0 lg:pb-0",
            "lg:grid lg:grid-cols-[repeat(5,minmax(11rem,1fr))] lg:overflow-y-hidden",
            "2xl:gap-6",
          )}
        >
          {columns.map((column, columnIndex) => {
            const active = dragging !== null && target === column.estagio;
            const closed = column.estagio === CLOSED_STAGE;
            return (
              <section
                key={column.estagio}
                ref={registerColumn(column.estagio)}
                aria-label={column.label}
                className={cn(
                  "flex w-[78vw] shrink-0 snap-start flex-col",
                  "sm:w-[20rem] lg:w-auto lg:min-h-0",
                  // a raia é um campo preenchido do topo à base, sempre — não
                  // só enquanto um card está no ar. Cantos retos de
                  // propósito: a raia é estrutura; o card é que vira objeto
                  // (raio + sombra) quando levantado. `bg-inset` é o papel
                  // rebaixado (um passo abaixo de `--bg`, tokens.css); alvo
                  // de solta aprofunda mais um passo, sem cor.
                  "bg-inset [transition:background-color_120ms_var(--curve-out)]",
                  active && "bg-surface-3",
                  // reforço de grade: um fio vertical no meio da goteira
                  // larga (2xl, 24px) — a goteira de 16px já basta sozinha,
                  // um fio ali tocaria as duas raias.
                  columnIndex > 0 && "2xl:border-l 2xl:border-hairline",
                )}
              >
                <header className="flex shrink-0 flex-col gap-1 px-3 pt-2 pb-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="flex min-w-0 items-center gap-1 truncate text-13 font-semibold tracking-[0.04em] text-muted uppercase">
                      {column.label}
                      {closed ? (
                        <CheckIcon className="size-3 shrink-0 text-ok" />
                      ) : null}
                    </h3>
                    <span
                      data-numeric
                      className="shrink-0 text-13 tabular-nums text-subtle"
                      title={column.hint}
                    >
                      {column.cards.length}
                    </span>
                  </div>
                  <Money
                    cents={column.cents}
                    size="17"
                    tone={closed ? "ok" : "default"}
                    reserveFor={columnCeiling}
                    align="left"
                  />
                </header>

                {/* a cornija: fecha o cabeçalho e abre a pilha. Enquanto um
                    card está no ar, o fio da coluna alvo escurece e
                    engrossa — por scaleY, que não relayouta. Sem azul: o
                    azul diz onde clicar, e aqui não se clica, se solta. */}
                <Rule
                  className={cn(
                    "mx-3 origin-bottom [transition:transform_120ms_var(--curve-out)]",
                    active && "scale-y-[2] bg-plate",
                  )}
                />

                <div
                  className={cn(
                    "flex flex-col",
                    "lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain",
                    "[scrollbar-width:thin]",
                  )}
                >
                  {column.cards.length === 0 ? (
                    <p className="px-3 py-4 text-13 text-subtle">
                      {column.hint}
                    </p>
                  ) : (
                    column.cards.map((deal, index) => (
                      <React.Fragment key={deal.id}>
                        {index > 0 ? <Rule inner className="mx-3" /> : null}
                        <FunnelCard
                          deal={deal}
                          dragging={dragging === deal.id}
                          hideSignal={closed}
                          moneyCeiling={cardMoneyCeiling}
                          reducedMotion={reducedMotion}
                          onDragStart={(rect, point) => {
                            setDragging(deal.id);
                            setLift({
                              deal,
                              width: rect.width,
                              dx: point.x - rect.left,
                              dy: point.y - rect.top,
                              x: point.x,
                              y: point.y,
                            });
                          }}
                          onDrag={(info) => {
                            const stage = projectedStage(info);
                            setTarget((current) =>
                              current === stage ? current : stage,
                            );
                            setLift((current) =>
                              current
                                ? { ...current, x: info.point.x, y: info.point.y }
                                : current,
                            );
                          }}
                          onDragEnd={(info) => handleDragEnd(deal, info)}
                          onMove={(stage) => void moveTo(deal, stage, false)}
                          onRequestLoss={() => openLossDialog(deal)}
                        />
                      </React.Fragment>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Sobrevoo: fora de toda raia, preso à viewport, acima de tudo. É a
          mesma marcação do card — levantado ele vira objeto (papel, raio,
          sombra); pousado volta a ser linha de lista. `pointer-events-none`
          para não roubar o alvo de solta de baixo dele. */}
      {lift
        ? createPortal(
            <div
              aria-hidden
              className="pointer-events-none fixed left-0 top-0 z-[100] will-change-transform"
              style={{
                width: lift.width,
                transform: `translate3d(${lift.x - lift.dx}px, ${lift.y - lift.dy}px, 0) scale(1.03)`,
                transformOrigin: "top left",
              }}
            >
              <div className="rounded-lg bg-surface px-3 py-3 shadow-drag">
                <CardBody
                  deal={lift.deal}
                  hideSignal={false}
                  moneyCeiling={cardMoneyCeiling}
                  inert
                />
              </div>
            </div>,
            document.body,
          )
        : null}

      <Dialog open={lossDialog !== null} onOpenChange={handleLossDialogChange}>
        <DialogContent
          title="Marcar como perdida"
          description={
            lossDialog
              ? `${lossDialog.contactName} sai do quadro. O motivo fica na linha do tempo do negócio — obrigatório, não dá para arquivar sem ele.`
              : undefined
          }
          footer={
            <>
              <DialogClose asChild>
                <CardAction>cancelar</CardAction>
              </DialogClose>
              <Button
                variant="danger"
                loading={lossSubmitting}
                disabled={lossReason.trim().length < MIN_LOST_REASON_LENGTH}
                onClick={() => void confirmLoss()}
              >
                Marcar como perdida
              </Button>
            </>
          }
        >
          <Field invalid={lossError !== null}>
            <Label>Motivo da perda</Label>
            <Textarea
              value={lossReason}
              onChange={(event) => {
                setLossReason(event.target.value);
                if (lossError) setLossError(null);
              }}
              placeholder="Ex.: escolheu outra agência, orçamento não fechou, foi remarcado sem previsão…"
              rows={3}
            />
            {lossError ? (
              <FieldError>{lossError}</FieldError>
            ) : (
              <FieldHint>Dá para desfazer por 8 segundos depois de confirmar.</FieldHint>
            )}
          </Field>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ carregando */

/** Skeleton, nunca spinner — mesma armação de coluna do quadro real. */
function FunnelSkeleton() {
  return (
    <div
      aria-hidden
      className={cn(
        "-mx-4 flex gap-4 overflow-x-hidden px-4 pb-2",
        "sm:-mx-6 sm:px-6",
        "lg:mx-0 lg:min-h-0 lg:flex-1 lg:px-0 lg:pb-0",
        "lg:grid lg:grid-cols-[repeat(5,minmax(11rem,1fr))]",
      )}
    >
      {COLUNAS_DO_FUNIL.map(({ estagio, label }) => (
        <section
          key={estagio}
          className="flex w-[78vw] shrink-0 flex-col bg-inset sm:w-[20rem] lg:w-auto"
        >
          <header className="flex shrink-0 flex-col gap-2 px-3 pt-2 pb-2">
            <span className="truncate text-13 font-semibold tracking-[0.04em] text-muted uppercase">
              {label}
            </span>
            <Skeleton className="h-5 w-24 rounded-xs" />
          </header>
          <Rule className="mx-3" />
          <div className="flex flex-col gap-4 px-3 py-4">
            <SkeletonRow />
            <SkeletonRow />
          </div>
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- o card */

/**
 * Três linhas, e a hierarquia é de peso e espaço — não de caixa:
 *
 *   cliente                                    ⋯
 *   destino                               6 nov
 *   R$ 12.840,00                       parada há 1 d
 *
 * O valor fica na mesma coluna de dígitos em todos os cards (largura
 * reservada), então a leitura vertical de uma coluna inteira é um movimento
 * só de olho.
 */
function FunnelCard({
  deal,
  dragging,
  hideSignal = false,
  moneyCeiling,
  reducedMotion,
  onDragStart,
  onDrag,
  onDragEnd,
  onMove,
  onRequestLoss,
}: {
  deal: NegocioDoFunil;
  dragging: boolean;
  /** Fechada não é estado a monitorar: sem sinal de abertura/estagnação. */
  hideSignal?: boolean;
  moneyCeiling: number;
  reducedMotion: boolean;
  onDragStart: (rect: DOMRect, point: { x: number; y: number }) => void;
  onDrag: (info: PanInfo) => void;
  onDragEnd: (info: PanInfo) => void;
  onMove: (stage: EstagioDeFunil) => void;
  onRequestLoss: () => void;
}) {
  const ref = React.useRef<HTMLElement>(null);

  return (
    <motion.article
      ref={ref}
      layout={!reducedMotion}
      layoutId={reducedMotion ? undefined : deal.id}
      transition={springLayout}
      drag
      dragSnapToOrigin
      dragElastic={0.25}
      dragMomentum={false}
      onDragStart={(_, info) => {
        const rect = ref.current?.getBoundingClientRect();
        if (rect) onDragStart(rect, info.point);
      }}
      onDrag={(_, info) => onDrag(info)}
      onDragEnd={(_, info) => onDragEnd(info)}
      className={cn(
        "group/card relative cursor-grab touch-none px-3 py-3",
        "active:cursor-grabbing",
        // Enquanto levantado, este elemento continua sendo a SUPERFICIE que
        // recebe o gesto — mas quem aparece é o sobrevoo, no topo do body.
        // Aqui fica o vazio que guarda o lugar, para a coluna nao colapsar
        // de altura e as outras linhas nao pularem.
        dragging && "opacity-0",
      )}
    >
      <CardBody
        deal={deal}
        hideSignal={hideSignal}
        moneyCeiling={moneyCeiling}
        menu={
          <StageMenu deal={deal} onMove={onMove} onRequestLoss={onRequestLoss} />
        }
      />
    </motion.article>
  );
}

/**
 * O desenho do card, sem o gesto. Existe separado porque o MESMO desenho
 * precisa ser pintado em dois lugares: na pilha da raia e no sobrevoo preso à
 * viewport. Duas marcações divergiriam no primeiro ajuste.
 */
function CardBody({
  deal,
  hideSignal,
  moneyCeiling,
  menu,
  inert = false,
}: {
  deal: NegocioDoFunil;
  hideSignal: boolean;
  moneyCeiling: number;
  menu?: React.ReactNode;
  /** No sobrevoo não há menu: o card está no ar, não há o que clicar. */
  inert?: boolean;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-1">
        <p className="min-w-0 flex-1 truncate text-15 font-medium text-ink">
          {deal.contactName}
        </p>
        {inert ? <span className="w-7 shrink-0" aria-hidden /> : menu}
      </div>

      <div className="mt-0.5 flex items-baseline justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-13 text-muted">
          {/* `destination` é opcional no schema real (a v2, sobre dado de
              exemplo, sempre tinha); sem ela, o título do negócio ainda diz
              alguma coisa em vez de deixar a linha em branco. */}
          {deal.destination ?? deal.title}
        </p>
        <TravelDate departureOn={deal.departureOn} />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <Money
          cents={deal.valueCents}
          size="15"
          reserveFor={moneyCeiling}
          align="left"
        />
        {hideSignal ? null : <Signal deal={deal} />}
      </div>
    </>
  );
}

/**
 * Data da viagem. `departureOn` chega como calendário puro (`AAAA-MM-DD`,
 * sem hora) — mesma convenção de `formatVencimento` em `vendas/shared.ts`:
 * acrescenta `T00:00:00` (hora local, não UTC) antes de formatar, porque essa
 * tela é 100% cliente (os dados vêm de `listarNegociosDoFunil` num
 * `useEffect`, nunca no HTML do servidor) — não existe divergência de fuso
 * para hidratar, então o hack de `formatDayMonthUTC` da v2 (necessário só
 * porque `travelIn` computava a data a partir de `Date.now()`) não se aplica
 * mais aqui.
 */
function TravelDate({ departureOn }: { departureOn: string | null }) {
  if (!departureOn) return null;
  return (
    <span data-numeric className="shrink-0 text-13 tabular-nums text-subtle">
      <span className="sr-only">viagem em </span>
      {formatDayMonth(new Date(`${departureOn}T00:00:00`))}
    </span>
  );
}

/**
 * UM sinal por card, à direita do valor:
 *
 *   1. parada há mais de 7 dias — é o dinheiro escorrendo pelo ralo
 *   2. há quantos dias está parada, em texto simples
 *   3. "hoje", quando acabou de mexer
 *
 * O selo de "abriu o link" da v2 saiu daqui — `NegocioDoFunil` não carrega
 * esse dado (é sinal de proposta, não de negócio; ver o comentário de topo
 * do arquivo). `tone="warn"`, não `accent`: parado é estado, não é "onde
 * clicar" — o azul fica reservado para controle de verdade.
 */
function Signal({ deal }: { deal: NegocioDoFunil }) {
  if (deal.diasParado > 7) {
    return (
      <Badge tone="warn" className="shrink-0">
        <ClockIcon className="size-3" />
        <span className="tabular-nums">{deal.diasParado} d</span>
        <span className="sr-only">parada</span>
      </Badge>
    );
  }
  if (deal.diasParado === 0) {
    return <span className="shrink-0 text-13 text-subtle">hoje</span>;
  }
  return (
    <span data-numeric className="shrink-0 text-13 tabular-nums text-subtle">
      <span className="sr-only">parada há </span>
      {deal.diasParado} d
    </span>
  );
}

/* --------------------------------------------------------- caminho de teclado */

/** Caminho de teclado para a mesma ação do arrasto — e a única porta para "perdida". */
function StageMenu({
  deal,
  onMove,
  onRequestLoss,
}: {
  deal: NegocioDoFunil;
  onMove: (stage: EstagioDeFunil) => void;
  onRequestLoss: () => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Mover ${deal.contactName} de estágio`}
        className={cn(
          "-mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-sm",
          "text-muted hover:bg-surface-3 hover:text-ink",
          // some no repouso do ponteiro fino e volta no hover, no foco e
          // enquanto o menu está aberto. Em ponteiro grosso não há hover:
          // lá ele fica sempre visível, senão vira ação inalcançável.
          "opacity-0 [transition:opacity_120ms_var(--curve-out)]",
          "group-hover/card:opacity-100 focus-visible:opacity-100",
          "data-[state=open]:opacity-100",
          "[@media(pointer:coarse)]:opacity-100",
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
              disabled={estagio === deal.stage}
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
