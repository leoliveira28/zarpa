"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, type PanInfo } from "motion/react";
import {
  listarEstagios,
  listarNegociosDoFunil,
  moverEstagioDoNegocio,
  type EstagioDoFunil,
  type NegocioDoFunil,
} from "@/server";
import { avisarRecusaDeEscrita } from "@/lib/ui/assinatura";
import { cn } from "@/lib/ui/cn";
import { formatDayMonth } from "@/lib/ui/format";
import {
  projectThrow,
  springLayout,
  usePrefersReducedMotion,
} from "@/lib/ui/motion";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FieldError } from "@/components/ui/Field";
import { Money } from "@/components/ui/Money";
import { Monogram } from "@/components/ui/Monogram";
import { Rule } from "@/components/plates";
import { Skeleton, SkeletonRow } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { CheckIcon, ClockIcon, PlusIcon, SlidersIcon } from "@/components/app/icons";
import {
  DealStageMenu,
  LossReasonDialog,
} from "@/components/app/DealStageMenu";
import { EditarColunasSheet } from "@/components/app/EditarColunasSheet";
import { NovoNegocioSheet } from "@/components/app/NovoNegocioSheet";

/* =============================================================================
   Funil — o quadro do tenant, não o de fábrica
   -----------------------------------------------------------------------------
   v4. S16 — as colunas passam a ser AS COLUNAS REAIS do funil deste tenant:
   `listarEstagios()` (`src/server/pipelineStages.ts`) substitui a lista fixa
   `COLUNAS_DO_FUNIL`, e cada cartão entra na coluna do seu `stageId` — a FK
   de verdade (`drizzle/0016_negocio_aponta_para_estagio.sql`), não o enum que
   é projeção dela. Fim do defeito que motivou esta rodada: negócio numa
   coluna criada pela agente aparecia embaixo de "Negociando" (o espelho que o
   trigger dá a `deals.stage` para coluna sem `legacy_stage`).

   O que muda em relação à v3 (S4), e o que NÃO muda:

   1. DUAS LEITURAS, UM ESTADO. `listarNegociosDoFunil()` e `listarEstagios()`
      chegam juntos (Promise.all) — coluna sem negócio existe, negócio sem
      coluna não. É `EstagioDoFunil` que manda: `label` real (a agente pode
      ter renomeado), `position` (ordem do quadro), `isWon` (coluna de
      fechamento — check, dinheiro em tom de estado, card sem sinal de
      estagnação), `isLost` (saída do funil: NÃO vira coluna, como "Perdida"
      nunca foi — o próprio servidor já devolve o quadro sem elas, filtrando
      por `is_lost`), e `totalNegocios` (o número que a Sheet de edição usa
      para NÃO oferecer arquivar em coluna cheia).

   2. MOVER É POR `{ stageId }`. `moverEstagioDoNegocio` aceita o enum antigo
      e o id (tipo `DestinoDeEstagio`); a UI passa o id — para coluna
      customizada o enum não existe. A física otimista da v3 está intacta: o
      cartão obedece o gesto (e herda a velocidade dele via `projectThrow`),
      reconcilia com o servidor, e recusa reverte sozinha com toast.

   3. "MARCAR COMO PERDIDA" SEGUE SENDO DIÁLOGO, AGORA COM DESTINO REAL. O
      motivo é obrigatório quando `isLost` da COLUNA (não mais `=== 'perdido'`)
      — se a agente renomeou "Perdida" para "Não rolou", a regra é a mesma.
      O movimento usa o id da coluna `isLost` do tenant.

   4. EDITAR COLUNAS ENTRA NO CABEÇALHO DO QUADRO (`EditarColunasSheet`):
      reordenar (subir/descer — dentro de sheet, arrasto brigaria com o
      scroll), renomear inline, arquivar em dois toques (não existe
      "desarquivar" no servidor, então o primeiro toque diz o que acontece) e
      criar no fim, antes do fim de funil. As mudanças aplicam no MESMO
      estado `estagios` desta tela — o quadro atrás da sheet atualiza na hora.

   5. COLUNA VAZIA: as de fábrica mantêm a copy da v3 (por `legacyStage`);
      as que a agente criou têm a genérica digna — "Nenhuma viagem aqui
      ainda". Vocabulário do pedido, não jargão de pipeline.

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

/**
 * Copy de coluna vazia. As de fábrica têm a frase que descreve o que ali
 * acontece; a de coluna criada pela agente é a genérica — não dá para inventar
 * semântica que só ela conhece. Chave é o `legacy_stage` (nulo na customizada).
 */
const HINT_BY_LEGACY: Record<string, string> = {
  novo: "chegou, ainda não virou proposta",
  cotando: "roteiro em construção",
  proposta_enviada: "link no WhatsApp do cliente",
  negociando: "ajuste de valor ou data",
  ganho: "venda confirmada",
  perdido: "não rolou — o motivo está no card",
};

const HINT_CUSTOM = "Nenhuma viagem aqui ainda";

function hintDaColuna(estagio: EstagioDoFunil): string {
  return (estagio.legacyStage && HINT_BY_LEGACY[estagio.legacyStage]) || HINT_CUSTOM;
}

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
 * nisto: ocupava ~24px do cabeçalho toda vez que a agente abriu a tela, a
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

/** O que o desfazer precisa guardar do card antes de movê-lo. */
type PosicaoAnterior = Pick<
  NegocioDoFunil,
  "stageId" | "stageLabel" | "diasParado"
>;

export function FunnelScreen() {
  const router = useRouter();
  const toast = useToast();
  const reducedMotion = usePrefersReducedMotion();

  const [status, setStatus] = React.useState<Status>("loading");
  const [items, setItems] = React.useState<NegocioDoFunil[]>([]);
  const [estagios, setEstagios] = React.useState<EstagioDoFunil[]>([]);
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
  const [target, setTarget] = React.useState<string | null>(null);
  const [hintSeen, dismissHint] = useDragHint();

  const [lossDialog, setLossDialog] = React.useState<NegocioDoFunil | null>(
    null,
  );

  // "+ Novo negócio" — o ponto de entrada que faltava (docs/status/nina.md).
  // `criarNegocio` devolve o MESMO shape de `listarNegociosDoFunil`, então
  // o card entra direto na coluna dele (`stageId`) sem reconsultar o quadro.
  const [negocioSheetOpen, setNegocioSheetOpen] = React.useState(false);

  // Editar colunas — gestão do próprio quadro (S16).
  const [colunasSheetOpen, setColunasSheetOpen] = React.useState(false);

  const columnRefs = React.useRef(new Map<string, HTMLElement>());

  const registerColumn = React.useCallback(
    (stageId: string) => (node: HTMLElement | null) => {
      if (node) columnRefs.current.set(stageId, node);
      else columnRefs.current.delete(stageId);
    },
    [],
  );

  /** Qual coluna contém (ou está mais perto de) uma coordenada X da viewport. */
  const columnAtX = React.useCallback((x: number): string | null => {
    let best: { stageId: string; distance: number } | null = null;
    for (const [stageId, node] of columnRefs.current) {
      const rect = node.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right) return stageId;
      const center = rect.left + rect.width / 2;
      const distance = Math.abs(center - x);
      if (!best || distance < best.distance) best = { stageId, distance };
    }
    return best?.stageId ?? null;
  }, []);

  React.useEffect(() => {
    let active = true;
    // Sem setStatus síncrono: num reload o quadro que já está em tela fica
    // até o dado novo chegar (o quadro não pisca skeleton), e num retry o
    // cartão de erro permanece até a resposta — some só quando há quadro.
    void Promise.all([listarNegociosDoFunil(), listarEstagios()]).then(
      ([negocios, colunas]) => {
        if (!active) return;
        if (!negocios.ok) {
          setStatus("error");
          setLoadError({
            mensagem: negocios.mensagem,
            correcao: negocios.correcao,
          });
          return;
        }
        if (!colunas.ok) {
          setStatus("error");
          setLoadError({
            mensagem: colunas.mensagem,
            correcao: colunas.correcao,
          });
          return;
        }
        setItems(negocios.data);
        setEstagios(colunas.data);
        setStatus("ready");
      },
    );
    return () => {
      active = false;
    };
  }, [reloadToken]);

  /** Reler as colunas sem piscar o quadro — a correção da Sheet de edição. */
  const refreshEstagios = React.useCallback(() => {
    void listarEstagios().then((result) => {
      if (result.ok) setEstagios(result.data);
    });
  }, []);

  const colunaPorId = React.useMemo(
    () => new Map(estagios.map((estagio) => [estagio.id, estagio])),
    [estagios],
  );

  /** A saída do funil ("Perdida", ou o nome que a agente deu a ela). */
  const colunaPerdida = React.useMemo(
    () => estagios.find((estagio) => estagio.isLost) ?? null,
    [estagios],
  );

  /**
   * O quadro: colunas ativas + PERDIDOS no fim (pedido do PO, Fase 5) — a saída do
   * funil agora é visível tanto quanto a entrada. `isLost` continua por último e
   * o drop para ela abre o diálogo de motivo (não move direto — motivo é obrigatório).
   */
  const colunasDoQuadro = React.useMemo(() => {
    const perdida = estagios.find((estagio) => estagio.isLost);
    const ativas = estagios.filter((estagio) => !estagio.isLost);
    return perdida ? [...ativas, perdida] : ativas;
  }, [estagios]);

  const columns = React.useMemo(
    () =>
      colunasDoQuadro.map((estagio) => {
        const cards = items.filter((item) => item.stageId === estagio.id);
        return {
          estagio,
          hint: hintDaColuna(estagio),
          cards,
          cents: sumValueCents(cards),
        };
      }),
    [items, colunasDoQuadro],
  );

  // Uma reserva de largura para as somas: o alinhamento entre colunas é
  // o que transforma vários números em uma comparação.
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

  /**
   * Fase 3 (§13.6): a atribuição no card só existe quando o quadro tem MAIS
   * DE UM vendedor. Em escopo `own` (membro) todos os cards carregam o mesmo
   * `agentId` — o dele —, então a linha nasce e morre sozinha: o membro não
   * vê um rótulo redundante em cada card, e o dono de conta recém-saída do
   * Solo também não (um vendedor não precisa de etiqueta). O funil já vem
   * escopado do servidor; nada aqui filtra de novo.
   */
  const variosVendedores =
    new Set(items.map((item) => item.agentId)).size > 1;

  const openCents = React.useMemo(
    () =>
      sumValueCents(
        items.filter((item) => !colunaPorId.get(item.stageId)?.isWon),
      ),
    [items, colunaPorId],
  );

  /**
   * Conta recém-criada: o quadro de colunas vazias não ensina o funil —
   * ensina que está vazio. No lugar dele, UM painel com o primeiro passo real
   * ("Criar primeiro negócio"); o quadro volta na hora em que `onCreated`
   * insere o card, e a agente vê a própria viagem ganhar o lugar que o vazio
   * estava guardando. A dica de arrasto também cala: não há card para
   * arrastar, e instrução de gesto sem objeto é ruído.
   */
  const quadroVazio = status === "ready" && items.length === 0;

  /**
   * Reabre um negócio numa coluna aberta — o desfazer de um movimento normal
   * E o desfazer de "marcar como perdida" caem aqui, porque as duas coisas
   * são a mesma operação vista do servidor (voltar para um `stageId`).
   * Reinsere otimisticamente (o item pode ter saído da lista, se veio de uma
   * perda) e só then confirma; se o servidor recusar essa SEGUNDA chamada
   * (rede caiu de novo, bem raro), a tela não tenta adivinhar — reconsulta o
   * quadro inteiro para não arriscar divergir do banco silenciosamente.
   */
  async function reopenAt(deal: NegocioDoFunil, anterior: PosicaoAnterior) {
    setItems((current) => {
      const patched: NegocioDoFunil = {
        ...deal,
        stageId: anterior.stageId,
        stageLabel: anterior.stageLabel,
        diasParado: anterior.diasParado,
      };
      return current.some((item) => item.id === deal.id)
        ? current.map((item) => (item.id === deal.id ? patched : item))
        : [...current, patched];
    });
    const result = await moverEstagioDoNegocio(deal.id, {
      stageId: anterior.stageId,
    });
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
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
    destino: { stageId: string },
    viaGesture: boolean,
  ) {
    if (destino.stageId === deal.stageId) return;
    // Perder segue sendo DIÁLOGO: o motivo é obrigatório (0016) e a coluna Perdidos
    // não recebe drop direto — o gesto encaminha para o mesmo diálogo do menu.
    if (colunaPorId.get(destino.stageId)?.isLost) {
      setLossDialog(deal);
      return;
    }
    dismissHint();
    const anterior: PosicaoAnterior = {
      stageId: deal.stageId,
      stageLabel: deal.stageLabel,
      diasParado: deal.diasParado,
    };
    const label = colunaPorId.get(destino.stageId)?.label ?? destino.stageId;

    // otimista: o toque não espera a rede. `stage` (o enum, projeção do
    // banco) fica como está de propósito — aqui quem posiciona é o `stageId`;
    // o valor reconciliado do enum volta do servidor e nada na tela o lê.
    setItems((current) =>
      current.map((item) =>
        item.id === deal.id
          ? { ...item, stageId: destino.stageId, stageLabel: label, diasParado: 0 }
          : item,
      ),
    );

    const result = await moverEstagioDoNegocio(deal.id, destino);

    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      // o servidor recusou — a posição do card não pode divergir do banco.
      setItems((current) =>
        current.map((item) =>
          item.id === deal.id
            ? {
                ...item,
                stageId: anterior.stageId,
                stageLabel: anterior.stageLabel,
                diasParado: anterior.diasParado,
              }
            : item,
        ),
      );
      toast.show({
        title: `Não consegui mover ${deal.contactName}`,
        description: result.mensagem,
        tone: "danger",
        action:
          result.correcao ? { label: result.correcao, onClick: reload } : undefined,
      });
      return;
    }

    toast.undo(
      `${deal.contactName} → ${label}`,
      () => void reopenAt(deal, anterior),
      {
        description: viaGesture ? undefined : "Movida pelo menu do card",
        tone: "ok",
      },
    );
  }

  function openLossDialog(deal: NegocioDoFunil) {
    dismissHint();
    setLossDialog(deal);
  }

  function handleLossDialogChange(open: boolean) {
    if (!open) setLossDialog(null);
  }

  /** Chamado por `LossReasonDialog` DEPOIS que o servidor já confirmou a perda. */
  function handleLost(dealId: string, motivo: string) {
    const deal = lossDialog;
    if (!deal || deal.id !== dealId) return; // não deveria divergir — proteção, não fluxo esperado
    const anterior: PosicaoAnterior = {
      stageId: deal.stageId,
      stageLabel: deal.stageLabel,
      diasParado: deal.diasParado,
    };
    // Fase 5: Perdidos tem coluna — o card ENTRA nela (não some do quadro) e o
    // desfazer devolve para a coluna anterior como sempre.
    const perdidaId = colunaPerdida?.id;
    setItems((current) =>
      current.map((item) =>
        item.id === deal.id
          ? {
              ...item,
              stageId: perdidaId ?? item.stageId,
              stageLabel: colunaPerdida?.label ?? item.stageLabel,
              lostReason: motivo,
              diasParado: 0,
            }
          : item,
      ),
    );
    setLossDialog(null);

    toast.undo(
      `${deal.contactName} → ${colunaPerdida?.label ?? "Perdida"}`,
      () => void reopenAt(deal, anterior),
      { description: `Motivo: ${motivo}`, tone: "warn" },
    );
  }

  /** Onde o card PARARIA — não onde o dedo está agora. */
  function projectedStage(info: PanInfo): string | null {
    return columnAtX(info.point.x + projectThrow(info.velocity.x));
  }

  function handleDragEnd(deal: NegocioDoFunil, info: PanInfo) {
    setDragging(null);
    setLift(null);
    setTarget(null);
    const stageId = projectedStage(info);
    if (stageId) void moveTo(deal, { stageId }, true);
  }

  return (
    <div className="flex flex-col gap-3 lg:h-full lg:min-h-0">
      {/* cabeçalho de PÁGINA: só o título, do mesmo tamanho das outras telas.
          Nem subtítulo de instrução, nem total — os dois comiam altura do
          quadro na v1, e nenhum dos dois é conteúdo da página: são conteúdo
          do quadro (abaixo). A edição de colunas mora aqui — é tarefa do
          funil, não do TopBar. */}
      <header className="flex items-center justify-between gap-3 lg:shrink-0">
        <h2 className="text-32 font-semibold text-ink">Funil</h2>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="quiet"
            iconOnly
            aria-label="Editar colunas do funil"
            onPointerDown={() => {
              setColunasSheetOpen(true);
              refreshEstagios(); // contagens frescas — é delas que o arquivar depende
            }}
          >
            <SlidersIcon className="size-4" />
          </Button>
          <Button
            variant="primary"
            iconOnly
            aria-label="Novo negócio"
            onPointerDown={() => setNegocioSheetOpen(true)}
          >
            <PlusIcon className="size-4" />
          </Button>
        </div>
      </header>

      {/* faixa do QUADRO: o total "Em aberto" mora aqui, não na página — é o
          que o conecta ao que ele soma, em vez de flutuar solto num canto. A
          cornija por baixo dela é a mesma que sublinha os cabeçalhos de
          coluna: o total e as colunas são uma coisa só. */}
      <div className="lg:shrink-0">
        <div className="flex items-baseline justify-between gap-3">
          <p
            aria-hidden={hintSeen || status !== "ready" || quadroVazio}
            className={cn(
              "text-13 text-subtle [transition:opacity_120ms_var(--curve-out)]",
              (hintSeen || status !== "ready" || quadroVazio) &&
                "pointer-events-none opacity-0",
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
      ) : quadroVazio ? (
        <EmptyState
          plate
          title="Nenhuma viagem em negociação"
          description="Cada negócio é uma viagem em negociação: entra na primeira coluna e você arrasta pelo funil até fechar. Todo negócio nasce de um cliente já cadastrado."
          preview={<NegocioPreview />}
          action={
            <Button
              variant="primary"
              onPointerDown={() => setNegocioSheetOpen(true)}
            >
              <PlusIcon className="size-4" />
              Criar primeiro negócio
            </Button>
          }
          secondaryAction={
            <Link
              href="/clientes"
              className="text-13 font-medium text-muted hover:text-ink hover:underline hover:underline-offset-4"
            >
              Cadastrar cliente
            </Link>
          }
        />
      ) : (
        /* celular: um scroller com encaixe por coluna, o polegar manda.
           desktop: colunas de altura cheia. A largura mínima de 11rem é o
           que impede a coluna de virar tira ilegível: abaixo dela a LINHA
           rola na horizontal em vez de espremer. O quadro agora tem o número
           de colunas do tenant — de cinco de fábrica até o teto de doze —
           então a linha é flex em todo tamanho de tela: poucas colunas
           esticam, muitas rolam. */
        <div
          data-tour="funil-quadro"
          className={cn(
            "-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2",
            "sm:-mx-6 sm:px-6",
            "[scrollbar-width:thin]",
            "lg:mx-0 lg:min-h-0 lg:flex-1 lg:snap-none lg:px-0 lg:pb-0",
            "2xl:gap-6",
          )}
        >
          {columns.map((column, columnIndex) => {
            const active = dragging !== null && target === column.estagio.id;
            const closed = column.estagio.isWon;
            return (
              <section
                key={column.estagio.id}
                ref={registerColumn(column.estagio.id)}
                aria-label={column.estagio.label}
                className={cn(
                  "flex w-[78vw] shrink-0 snap-start flex-col",
                  "sm:w-[20rem]",
                  "lg:w-auto lg:min-w-[11rem] lg:flex-1 lg:min-h-0",
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
                      {column.estagio.label}
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
                          mostrarVendedor={variosVendedores}
                          reducedMotion={reducedMotion}
                          colunas={colunasDoQuadro}
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
                            const stageId = projectedStage(info);
                            setTarget((current) =>
                              current === stageId ? current : stageId,
                            );
                            setLift((current) =>
                              current
                                ? { ...current, x: info.point.x, y: info.point.y }
                                : current,
                            );
                          }}
                          onDragEnd={(info) => handleDragEnd(deal, info)}
                          onMove={(stageId) =>
                            void moveTo(deal, { stageId }, false)
                          }
                          onRequestLoss={() => openLossDialog(deal)}
                          onOpen={() => router.push(`/funil/${deal.id}`)}
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
                  mostrarVendedor={variosVendedores}
                  inert
                />
              </div>
            </div>,
            document.body,
          )
        : null}

      {colunaPerdida ? (
        <LossReasonDialog
          deal={
            lossDialog
              ? { id: lossDialog.id, contactName: lossDialog.contactName }
              : null
          }
          destinoPerdida={colunaPerdida.id}
          onOpenChange={handleLossDialogChange}
          onLost={handleLost}
        />
      ) : null}

      <EditarColunasSheet
        open={colunasSheetOpen}
        onOpenChange={setColunasSheetOpen}
        estagios={estagios}
        onApply={setEstagios}
        onRefresh={refreshEstagios}
      />

      <NovoNegocioSheet
        open={negocioSheetOpen}
        onOpenChange={setNegocioSheetOpen}
        onCreated={(negocio) => {
          setItems((current) => [negocio, ...current]);
          setNegocioSheetOpen(false);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ carregando */

/**
 * Skeleton, nunca spinner — mesma armação de coluna do quadro real. Cinco
 * colunas de força: a contagem verdadeira só existe depois da leitura, e um
 * skeleton com rótulo de coluna mentiria o que ainda não veio.
 */
function FunnelSkeleton() {
  return (
    <div
      aria-hidden
      className={cn(
        "-mx-4 flex gap-4 overflow-x-hidden px-4 pb-2",
        "sm:-mx-6 sm:px-6",
        "lg:mx-0 lg:min-h-0 lg:flex-1 lg:px-0 lg:pb-0",
      )}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <section
          key={i}
          className="flex w-[78vw] shrink-0 flex-col bg-inset sm:w-[20rem] lg:w-auto lg:min-w-[11rem] lg:flex-1"
        >
          <header className="flex shrink-0 flex-col gap-2 px-3 pt-2 pb-2">
            <Skeleton className="h-3.5 w-20 rounded-xs" />
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
 * Amostra de card no estado vazio do quadro — o MESMO exemplo do /hoje e da
 * lista de propostas (Marina · Fernando de Noronha · R$ 12.840,00), no MESMO
 * desenho de três linhas do card real: o vazio mostra o objeto que vai existir,
 * não um buraco. Só visual (`aria-hidden` pelo EmptyState).
 */
function NegocioPreview() {
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-surface p-3 shadow-1">
      <span className="truncate text-15 font-medium text-ink">
        Marina Albuquerque
      </span>
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-13 text-muted">
          Fernando de Noronha
        </span>
        <span data-numeric className="shrink-0 text-13 tabular-nums text-subtle">
          <span className="sr-only">viagem em </span>
          6 nov
        </span>
      </span>
      <span className="mt-1">
        <Money cents={1_284_000} size="15" reserveFor={5_940_000} align="left" />
      </span>
    </div>
  );
}

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
  mostrarVendedor,
  reducedMotion,
  colunas,
  onDragStart,
  onDrag,
  onDragEnd,
  onMove,
  onRequestLoss,
  onOpen,
}: {
  deal: NegocioDoFunil;
  dragging: boolean;
  /** Coluna de fechamento não é estado a monitorar: sem sinal de abertura/estagnação. */
  hideSignal?: boolean;
  moneyCeiling: number;
  /** Quadro com 2+ vendedores: o card diz de quem é (monograma + nome). */
  mostrarVendedor: boolean;
  reducedMotion: boolean;
  /** Colunas ativas do tenant, na ordem do quadro — o cardápio do menu. */
  colunas: EstagioDoFunil[];
  onDragStart: (rect: DOMRect, point: { x: number; y: number }) => void;
  onDrag: (info: PanInfo) => void;
  onDragEnd: (info: PanInfo) => void;
  onMove: (stageId: string) => void;
  onRequestLoss: () => void;
  /** Abre a ficha do negócio — tudo que o card não resolve sozinho (histórico, proposta). */
  onOpen: () => void;
}) {
  const ref = React.useRef<HTMLElement>(null);
  /* O card é arrastável E abre a ficha — os dois gestos começam no mesmo
     pointerdown, e só um dos dois pode vencer. `moved` marca se o framer
     chegou a reconhecer um arrasto de verdade (acima do próprio limiar
     dele); só quando ele NÃO reconheceu é que o pointerup conta como toque.
     Isto (e não `onTap` do motion) porque `onTap` teria que reconciliar seu
     próprio limiar de gesto com o de `drag` no mesmo nó — dois relógios
     medindo a mesma coisa é onde bug de gesto nasce. Um booleano só, fechado
     entre o pointerdown e o pointerup, não tem essa fresta. */
  const movedRef = React.useRef(false);

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
        movedRef.current = true;
        const rect = ref.current?.getBoundingClientRect();
        if (rect) onDragStart(rect, info.point);
      }}
      onDrag={(_, info) => onDrag(info)}
      onDragEnd={(_, info) => onDragEnd(info)}
      onPointerDown={() => {
        movedRef.current = false;
      }}
      onPointerUp={(event: React.PointerEvent<HTMLElement>) => {
        if (movedRef.current) return; // foi arrasto — o solta já decidiu o destino
        const target = event.target as HTMLElement;
        if (target.closest("[data-stage-menu]")) return; // o menu cuida do próprio toque
        onOpen();
      }}
      onKeyDown={(event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key !== "Enter") return;
        if ((event.target as HTMLElement).closest("[data-stage-menu]")) return;
        event.preventDefault();
        onOpen();
      }}
      role="link"
      tabIndex={0}
      aria-label={`Abrir negócio de ${deal.contactName}${deal.destination ? ` — ${deal.destination}` : ""}`}
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
        mostrarVendedor={mostrarVendedor}
        menu={
          <DealStageMenu
            contactName={deal.contactName}
            colunas={colunas}
            currentStageId={deal.stageId}
            onMove={onMove}
            onRequestLoss={onRequestLoss}
            revealOnHover
          />
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
  mostrarVendedor = false,
  menu,
  inert = false,
}: {
  deal: NegocioDoFunil;
  hideSignal: boolean;
  moneyCeiling: number;
  /** Quadro com 2+ vendedores: a quarta linha, com o monograma de contorno
      (§8 — nunca preenchido, nunca uma cor por pessoa; a cor do quadro segue
      dizendo só onde se clica). */
  mostrarVendedor?: boolean;
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
        {/* 0020 — acompanhantes do mesmo negócio ("Ana +2"). CONTAGEM, nunca
            lista (a lista completa é da ficha) e nunca cor: é informação, não
            convite a clicar. Fora do truncate de propósito — nome comprido não
            come o número. */}
        {deal.clientesSecundarios > 0 ? (
          <span className="shrink-0 pt-0.5 text-13 tabular-nums text-muted">
            +{deal.clientesSecundarios}
          </span>
        ) : null}
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

      {/* Meta Grupos (6b) — o chip do grupo, MESMA linha quieta do vendedor:
          texto, não cor (nada ali se clica; a ficha é que leva ao grupo). */}
      {deal.grupoTitle ? (
        <p className="mt-1.5 truncate text-13 text-muted">{deal.grupoTitle}</p>
      ) : null}

      {mostrarVendedor ? (
        <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-13 text-muted">
          {deal.agentName ? (
            <>
              <Monogram
                name={deal.agentName}
                size="sm"
                className="text-subtle"
              />
              <span className="truncate">{primeiroNome(deal.agentName)}</span>
            </>
          ) : (
            // Negócio sem vendedor é linha de verdade (dado antigo/importado):
            // o quadro diz o que falta, não finge que a atribuição existe.
            <span className="truncate">sem vendedor</span>
          )}
        </p>
      ) : null}
    </>
  );
}

/** Nome de chamada: o que a equipe usa para falar da colega, não o registro. */
function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
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
