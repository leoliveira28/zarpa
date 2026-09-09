"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  atualizarNegocio,
  listarEquipe,
  listarEstagios,
  listarNegociosDoFunil,
  listarPropostas,
  listarViajantes,
  moverEstagioDoNegocio,
  obterNegocio,
  type AtividadeDoNegocio,
  type EquipeResumo,
  type EstagioDoFunil,
  type NegocioDetalhe,
  type NegocioMovido,
  type PropostaResumo,
  type RoteiroResumo,
  type ServiceResult,
  type ViajanteResumo,
} from "@/server";
import { listarRoteiroDoNegocio } from "@/lib/ui/roteiroApi";
import { avisarRecusaDeEscrita } from "@/lib/ui/assinatura";
import { cn } from "@/lib/ui/cn";
import {
  resultadoDaViagem,
  urlDoCsvDePassageiros,
  type ResultadoDaViagem,
} from "@/lib/ui/fase12Api";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardAction,
  CardBody,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldError, FieldHint, Label, SavedMark } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { CentsInput, MoneyStat } from "@/components/ui/Money";
import { Monogram } from "@/components/ui/Monogram";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Skeleton, SkeletonRow, SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { DealStageMenu, LossReasonDialog } from "@/components/app/DealStageMenu";
import { NovaPropostaSheet } from "@/components/app/NovaPropostaSheet";
import { ResultadoViagemCard } from "@/components/app/ResultadoViagemCard";
import { ChevronRightIcon, DownloadIcon, PlusIcon } from "@/components/app/icons";
import { TRAVELER_KIND_LABELS } from "../../clientes/shared";
import { formatDayMonth, formatarFaixaDeDatas, formatTime } from "@/lib/ui/format";
import { useAutosave } from "@/lib/ui/useAutosave";

/* =============================================================================
   Ficha do negócio — o clique que faltava no Funil
   -----------------------------------------------------------------------------
   Auditoria do PO: clicar num card do Funil não abria nada. Dava para mudar de
   estágio pelo menu do card, mas não tinha como ver datas, pax, histórico nem
   a proposta ligada — `obterNegocio` já trazia tudo isso desde o S4
   (`src/server/deals.ts`, seção 4), só não tinha tela nenhuma consumindo.

   Registro silencioso, mesma gramática de `ContatoScreen`/`VendaScreen`:
   fio como cornija, uma cor de destaque, `tabular-nums` em todo valor. NÃO é
   editável — não existe `atualizarNegocio` no servidor ainda (só
   `criarNegocio`/`moverEstagioDoNegocio`), então os campos da viagem são
   leitura. Pedido de escrita fica em docs/handoffs/nina-para-rafa.md.

   Mudar estágio aqui reaproveita EXATAMENTE a lógica do menu do card do Funil
   — `DealStageMenu`/`LossReasonDialog`, extraídos de `FunnelScreen.tsx` para
   `src/components/app/DealStageMenu.tsx` nesta mesma entrega, um lugar só que
   sabe validar motivo de perda e falar com `moverEstagioDoNegocio`.

   S16 — ESTÁGIO É COLUNA, E A COLUNA É DO TENANT. O cardápio passa a listar
   TODAS as colunas ativas de `listarEstagios()` (rótulos reais — inclusive os
   de colunas que a agente criou) e o movimento é por `{ stageId }`, a FK de
   verdade (0016). O badge do cabeçalho usa `stageLabel` que já vem no
   `NegocioDetalhe`; ganho/perdido são `isWon`/`isLost` da coluna, não
   comparação de enum. A timeline lê os ids NOVOS que `moverEstagioDoNegocio`
   grava na metadata (`deStageId`/`paraStageId`/`paraLabel`) para reconstruir
   a frase com o rótulo do momento — e usa `incluirArquivadas` na leitura das
   colunas porque o "de onde veio" pode ser uma coluna que a agente arquivou
   depois. Para atividades antigas (pré-0016, metadata só com enum) o fallback
   é o rótulo de fábrica — enum cru na tela é defeito, foi varrido.

   "Conectar à proposta": `obterNegocio` não devolve propostas (não é dado do
   negócio, é dado da proposta) — o card `PropostaCard` abaixo faz a própria
   busca (`listarPropostas`, filtrada por `dealId` no cliente — não existe
   ainda um `obterPropostaDoNegocio(dealId)` no servidor; no volume esperado
   [10-15 vendas/mês] isso é seguro, mesmo padrão de soma em JS já documentado
   em `deals.ts`). Handoff aberto para um filtro de verdade se um tenant um
   dia crescer além disso.
   ========================================================================== */

type Status = "loading" | "ready" | "error";

/**
 * Rótulos de fábrica — fallback para atividade cuja metadata não carrega os
 * ids novos (pré-0016) ou veio de formato inesperado. O rótulo real vem de
 * `listarEstagios`; para coluna criada pela agente NEM EXISTE enum, então
 * este mapa nunca é a primeira escolha.
 */
const ROTULO_DE_ENUM: Record<string, string> = {
  novo: "Novo contato",
  cotando: "Montando",
  proposta_enviada: "Enviada",
  negociando: "Negociando",
  ganho: "Fechada",
  perdido: "Perdida",
};

function rotuloDeEnum(value: unknown): string | null {
  return typeof value === "string" && value in ROTULO_DE_ENUM
    ? ROTULO_DE_ENUM[value]
    : null;
}

/**
 * O espelho enum↔coluna, só para o `body` da entrada otimista manter a MESMA
 * frase que o servidor grava (mesmo CASE do trigger `deals_estagio_sync`,
 * 0016). Quem desenha o rótulo na tela é `activityLabel`, pelos ids.
 */
function espelhoDoEstagio(coluna: EstagioDoFunil | undefined): string {
  if (!coluna) return "negociando";
  if (coluna.legacyStage) return coluna.legacyStage;
  if (coluna.isWon) return "ganho";
  if (coluna.isLost) return "perdido";
  return "negociando";
}

/** `body` não existe para todo tipo de `activity` (`proposal_sent` nasce sem — ver `proposals.ts`). */
const ACTIVITY_FALLBACK: Record<string, string> = {
  note: "Nota registrada.",
  stage_changed: "Estágio alterado.",
  proposal_sent: "Proposta enviada.",
  proposal_viewed: "Proposta aberta pelo cliente.",
  proposal_accepted: "Proposta aceita.",
  task_done: "Tarefa concluída.",
  message: "Mensagem registrada.",
  contact_created: "Negócio criado.",
};

function optimisticActivityId(): string {
  return `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * `stage_changed` chega do servidor com `body` em enum cru — "Movido de
 * proposta_enviada para novo." — porque `moverEstagioDoNegocio` (deals.ts)
 * escreve o `body` com o valor de banco, não com a copy de interface. Desde a
 * 0016 ele grava TAMBÉM os endereços novos na metadata (`deStageId`/
 * `paraStageId`/`paraLabel`), e é por eles que a frase é reconstruída: o
 * rótulo vem das colunas do tenant (`colunas`, lidas com
 * `incluirArquivadas` — o "de onde veio" pode ser coluna arquivada depois),
 * caindo para `paraLabel` e para o rótulo de fábrica só quando o id não está
 * mais na lista. Enum cru na tela é defeito — foi varrido nesta rodada.
 */
function activityLabel(
  activity: AtividadeDoNegocio,
  colunas: Map<string, EstagioDoFunil>,
): string {
  if (activity.type === "stage_changed") {
    const m = activity.metadata;
    const deId = typeof m.deStageId === "string" ? m.deStageId : null;
    const paraId = typeof m.paraStageId === "string" ? m.paraStageId : null;
    const deNome =
      (deId ? colunas.get(deId)?.label : undefined) ?? rotuloDeEnum(m.de);
    const paraColuna = paraId ? (colunas.get(paraId) ?? null) : null;
    const paraLabelMetadata =
      typeof m.paraLabel === "string" && m.paraLabel.trim().length > 0
        ? m.paraLabel
        : null;
    const paraNome =
      paraColuna?.label ?? paraLabelMetadata ?? rotuloDeEnum(m.para);

    // A saída: `isLost` da COLUNA é a verdade (0016); `para === "perdido"`
    // cobre metadata antiga, quando o enum era o único endereço.
    if (paraColuna?.isLost || m.para === "perdido") {
      const motivo = m.motivoPerda;
      return typeof motivo === "string" && motivo.trim().length > 0
        ? `Marcada como perdida: ${motivo}`
        : "Marcada como perdida.";
    }
    if (deNome && paraNome) {
      return `Movido de ${deNome} para ${paraNome}.`;
    }
    // metadata inesperada: a frase genérica, nunca o enum cru do `body`.
    return "Estágio alterado.";
  }
  const body = activity.body?.trim();
  return body && body.length > 0 ? body : (ACTIVITY_FALLBACK[activity.type] ?? activity.type);
}

/** Mesmo texto que `moverEstagioDoNegocio` grava em `activities.body` (deals.ts) — a entrada otimista não pode divergir do que um F5 traria de volta. */
function stageActivityBody(from: string, to: string, motivo?: string): string {
  return to === "perdido" ? `Marcado como perdido: ${motivo}` : `Movido de ${from} para ${to}.`;
}

function formatOptionalDate(iso: string | null): string {
  return iso ? formatDayMonth(new Date(`${iso}T00:00:00`)) : "Não definida";
}

function paxLabel(adults: number, children: number): string {
  const parts = [`${adults} ${adults === 1 ? "adulto" : "adultos"}`];
  if (children > 0) parts.push(`${children} ${children === 1 ? "criança" : "crianças"}`);
  return parts.join(" · ");
}

export function NegocioScreen({ dealId }: { dealId: string }) {
  const toast = useToast();

  const [status, setStatus] = React.useState<Status>("loading");
  const [negocio, setNegocio] = React.useState<NegocioDetalhe | null>(null);
  const [estagios, setEstagios] = React.useState<EstagioDoFunil[]>([]);
  const [errorInfo, setErrorInfo] = React.useState<{ mensagem: string; correcao?: string } | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const retry = React.useCallback(() => setReloadToken((token) => token + 1), []);

  const [lossDialogOpen, setLossDialogOpen] = React.useState(false);

  function patch(update: Partial<NegocioDetalhe>) {
    setNegocio((current) => (current ? { ...current, ...update } : current));
  }

  React.useEffect(() => {
    let active = true;
    setStatus((current) => (current === "ready" ? current : "loading"));
    // As colunas entram junto: o cardápio do menu precisa delas, e a linha do
    // tempo só reconstrói frases com rótulo se tiver a lista completa —
    // `incluirArquivadas` porque o "de onde veio" de um movimento antigo pode
    // ser uma coluna que a agente arquivou depois.
    void Promise.all([
      obterNegocio(dealId),
      listarEstagios({ incluirArquivadas: true }),
    ]).then(([negocioResult, colunasResult]) => {
      if (!active) return;
      if (!negocioResult.ok) {
        setStatus("error");
        setErrorInfo({
          mensagem: negocioResult.mensagem,
          correcao: negocioResult.correcao,
        });
        return;
      }
      if (!colunasResult.ok) {
        setStatus("error");
        setErrorInfo({
          mensagem: colunasResult.mensagem,
          correcao: colunasResult.correcao,
        });
        return;
      }
      setNegocio(negocioResult.data);
      setEstagios(colunasResult.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [dealId, reloadToken]);

  /** Todas as colunas (ativas + arquivadas), para rótulo da timeline. */
  const colunaPorId = React.useMemo(
    () => new Map(estagios.map((estagio) => [estagio.id, estagio])),
    [estagios],
  );
  /** O cardápio do menu: só as ativas, na ordem do quadro. */
  const estagiosAtivos = React.useMemo(
    () => estagios.filter((estagio) => estagio.archivedAt == null),
    [estagios],
  );
  /** A saída do funil — "Perdida", ou o nome que a agente deu a ela. */
  const colunaPerdida = React.useMemo(
    () => estagiosAtivos.find((estagio) => estagio.isLost) ?? null,
    [estagiosAtivos],
  );

  /** Patch de estágio a partir do retorno de `moverEstagioDoNegocio`. */
  function aplicarMovido(movido: NegocioMovido): Partial<NegocioDetalhe> {
    return {
      stage: movido.stage,
      stageId: movido.stageId,
      stageLabel: movido.stageLabel,
      isWon: movido.isWon,
      isLost: movido.isLost,
      lostReason: movido.lostReason,
      closedAt: movido.closedAt,
      updatedAt: movido.updatedAt,
    };
  }

  /** Reabre numa coluna — o desfazer de um movimento normal E o de "marcar como perdida" caem aqui. */
  async function reopenTo(previous: NegocioDetalhe) {
    setNegocio((current) =>
      current
        ? {
            ...current,
            stage: previous.stage,
            stageId: previous.stageId,
            stageLabel: previous.stageLabel,
            isWon: previous.isWon,
            isLost: previous.isLost,
          }
        : current,
    );
    const motivo = previous.isLost
      ? (previous.lostReason ?? "reaberto por engano")
      : undefined;
    const result = await moverEstagioDoNegocio(
      previous.id,
      { stageId: previous.stageId },
      motivo,
    );
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      toast.show({ title: "Não consegui desfazer", description: result.mensagem, tone: "danger" });
      retry(); // não tenta adivinhar o estado certo sozinha — reconsulta tudo
      return;
    }
    setNegocio((current) =>
      current ? { ...current, ...aplicarMovido(result.data) } : current,
    );
  }

  async function handleMove(stageId: string) {
    if (!negocio || stageId === negocio.stageId) return;
    const previous = negocio;
    const destino = colunaPorId.get(stageId);
    const label = destino?.label ?? stageId;

    // otimista: o toque não espera a rede, e a linha do tempo já mostra a
    // mudança na hora — com os MESMOS campos de metadata que o servidor grava
    // (`de`/`para` em enum para o `body`, `deStageId`/`paraStageId`/`paraLabel`
    // para o rótulo), então um F5 antes da resposta chegar não muda o que a
    // agente já leu.
    setNegocio({
      ...negocio,
      stageId,
      stageLabel: label,
      isWon: destino?.isWon ?? false,
      isLost: destino?.isLost ?? false,
      activities: [
        {
          id: optimisticActivityId(),
          type: "stage_changed",
          body: stageActivityBody(negocio.stage, espelhoDoEstagio(destino)),
          metadata: {
            de: negocio.stage,
            para: espelhoDoEstagio(destino),
            deStageId: negocio.stageId,
            paraStageId: stageId,
            paraLabel: label,
          },
          actorUserId: null,
          occurredAt: new Date(),
        },
        ...negocio.activities,
      ],
    });

    const result = await moverEstagioDoNegocio(negocio.id, { stageId });
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      setNegocio(previous);
      toast.show({
        title: `Não consegui mover para ${label}`,
        description: result.mensagem,
        tone: "danger",
        action: result.correcao ? { label: result.correcao, onClick: retry } : undefined,
      });
      return;
    }

    setNegocio((current) =>
      current ? { ...current, ...aplicarMovido(result.data) } : current,
    );
    toast.undo(`Movido para ${label}`, () => void reopenTo(previous), { tone: "ok" });
  }

  function handleLost(movedDealId: string, motivo: string) {
    if (!negocio || negocio.id !== movedDealId) return;
    const previous = negocio;
    setNegocio({
      ...negocio,
      stage: "perdido",
      stageId: colunaPerdida?.id ?? negocio.stageId,
      stageLabel: colunaPerdida?.label ?? negocio.stageLabel,
      isWon: false,
      isLost: true,
      lostReason: motivo,
      activities: [
        {
          id: optimisticActivityId(),
          type: "stage_changed",
          body: stageActivityBody(negocio.stage, "perdido", motivo),
          metadata: {
            de: negocio.stage,
            para: "perdido",
            deStageId: negocio.stageId,
            paraStageId: colunaPerdida?.id,
            paraLabel: colunaPerdida?.label,
            motivoPerda: motivo,
          },
          actorUserId: null,
          occurredAt: new Date(),
        },
        ...negocio.activities,
      ],
    });
    setLossDialogOpen(false);

    toast.undo(
      "Marcado como perdido",
      () => void reopenTo(previous),
      { description: `Motivo: ${motivo}`, tone: "warn" },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/funil"
        className="flex w-fit items-center gap-1 text-13 font-medium text-muted hover:text-ink"
      >
        <ChevronRightIcon className="size-3.5 -scale-x-100" />
        Funil
      </Link>

      {status === "loading" ? (
        <NegocioSkeleton />
      ) : status === "error" || !negocio ? (
        <Card className="flex flex-col items-start gap-3 p-5">
          <p className="text-15 text-ink">{errorInfo?.mensagem}</p>
          <Button variant="secondary" onClick={retry}>
            {errorInfo?.correcao ?? "Tentar de novo"}
          </Button>
        </Card>
      ) : (
        <>
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="display truncate text-32 text-ink">{negocio.title}</h2>
              <p className="text-13 text-muted">
                <Link
                  href={`/clientes/${negocio.contactId}`}
                  className="font-medium text-ink hover:text-accent hover:underline"
                >
                  {negocio.contactName}
                </Link>
                {" · criado em "}
                {formatDayMonth(new Date(negocio.createdAt))}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* O rótulo é o da coluna real (`stageLabel` vem no detalhe);
                  ganho/perdido são propriedade da coluna, não do enum. */}
              <Badge tone={negocio.isWon ? "ok" : negocio.isLost ? "danger" : "neutral"} dot>
                {negocio.stageLabel}
              </Badge>
              <DealStageMenu
                contactName={negocio.contactName}
                colunas={estagiosAtivos}
                currentStageId={negocio.stageId}
                onMove={(stageId) => void handleMove(stageId)}
                onRequestLoss={() => setLossDialogOpen(true)}
              />
            </div>
          </header>

          {negocio.isLost && negocio.lostReason ? (
            <Card tone="warn" className="p-4">
              <p className="text-13 text-ink">
                <span className="font-medium">Motivo da perda:</span> {negocio.lostReason}
              </p>
            </Card>
          ) : null}

          <ViagemCard negocio={negocio} dealId={negocio.id} onPatched={patch} />
          <PassageirosCard negocio={negocio} />
          <PropostaCard negocio={negocio} />
          {/* Fase 2 Monde — o dinheiro da viagem fechada. Só em `isWon` pelo
              mesmo recorte do roteiro: negócio aberto não tem resultado, e o
              contrato (`resultadoDaViagem`) recusa de qualquer forma. */}
          {negocio.isWon ? <ResultadoCard dealId={negocio.id} /> : null}
          {/* §4 — o roteiro existe só na coluna de fechamento ganho (`isWon`):
              é pós-venda, não argumento de venda. Entre a proposta e a linha
              do tempo. */}
          {negocio.isWon ? <RoteiroCard negocio={negocio} /> : null}
          <TimelineCard activities={negocio.activities} colunas={colunaPorId} />

          {colunaPerdida ? (
            <LossReasonDialog
              deal={lossDialogOpen ? { id: negocio.id, contactName: negocio.contactName } : null}
              destinoPerdida={colunaPerdida.id}
              onOpenChange={setLossDialogOpen}
              onLost={handleLost}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function NegocioSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-2/3 rounded-sm" />
        <Skeleton className="h-3.5 w-1/2 rounded-xs" />
      </div>
      <Card className="p-4">
        <SkeletonText lines={4} />
      </Card>
      <Card className="flex flex-col gap-4 p-4">
        <SkeletonRow />
        <SkeletonRow />
      </Card>
    </div>
  );
}

/* =============================================================================
   Viagem — destino, pax, datas, valor. Editável com autosave campo a campo,
   mesmo padrão da ficha de cliente (ContatoScreen) e da ficha de venda
   (VendaScreen): TextAutoField/CentsAutoField/DateAutoField/NumberAutoField +
   SavedMark discreto, sem botão Salvar grande.
   ========================================================================== */

function ViagemCard({
  negocio,
  dealId,
  onPatched,
}: {
  negocio: NegocioDetalhe;
  dealId: string;
  onPatched: (patch: Partial<NegocioDetalhe>) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Viagem</CardTitle>
      </CardHeader>
      <CardBody>
        <TextAutoField
          label="Destino"
          optional
          initialValue={negocio.destination ?? ""}
          placeholder="Não definido"
          onSave={async (value) => {
            const result = await atualizarNegocio(dealId, { destination: value });
            if (result.ok) onPatched({ destination: value || null });
            return result;
          }}
        />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <NumberAutoField
            label="Adultos"
            initialValue={negocio.paxAdults}
            min={1}
            max={50}
            onSave={async (value) => {
              const result = await atualizarNegocio(dealId, { paxAdults: value });
              if (result.ok) onPatched({ paxAdults: value });
              return result;
            }}
          />
          <NumberAutoField
            label="Crianças"
            optional
            initialValue={negocio.paxChildren}
            min={0}
            max={50}
            onSave={async (value) => {
              const result = await atualizarNegocio(dealId, { paxChildren: value });
              if (result.ok) onPatched({ paxChildren: value });
              return result;
            }}
          />
          <DateAutoField
            label="Ida"
            optional
            initialValue={negocio.departureOn ?? ""}
            onSave={async (value) => {
              const result = await atualizarNegocio(dealId, { departureOn: value });
              if (result.ok) onPatched({ departureOn: value || null });
              return result;
            }}
          />
          <DateAutoField
            label="Volta"
            optional
            initialValue={negocio.returnOn ?? ""}
            onSave={async (value) => {
              const result = await atualizarNegocio(dealId, { returnOn: value });
              if (result.ok) onPatched({ returnOn: value || null });
              return result;
            }}
          />
        </div>

        <CentsAutoField
          label="Valor"
          initialCents={negocio.valueCents}
          onSave={async (cents) => {
            const result = await atualizarNegocio(dealId, { valueCents: cents });
            if (result.ok) onPatched({ valueCents: cents });
            return result;
          }}
        />

        {/* Fase 3 (§13.6) — de quem é este negócio. Só o dono vê: reatribuir
            é decisão dele (o guard está no servidor e o erro DADOS_INVALIDOS
            de lá é a verdade, não este sumiço). */}
        <VendedorField negocio={negocio} dealId={dealId} />
      </CardBody>
    </Card>
  );
}

/* -----------------------------------------------------------------------------
   VendedorField — reatribuição de negócio (§13.6), dono only
   -------------------------------------------------------------------------
   Duas leituras extra, com precedente na própria ficha (a PropostaCard lê
   `listarPropostas` e filtra por `dealId` no cliente):

   1. `listarEquipe()` diz SE eu sou o dono (o membro cujo `userId` é o
      `solicitanteUserId` com papel 'owner') e quem são os membros — o
      cardápio do select. Não-dono: o campo nem nasce.

   2. `NegocioDetalhe` NÃO carrega `agentId`/`agentName` — furo de contrato
      registrado em docs/handoffs/nina-para-rafa.md. O contorno honesto é ler
      o valor ATUAL do quadro (`listarNegociosDoFunil`, que tem os dois) e
      achar o negócio pelo id. Em negócio PERDIDO o quadro não o devolve, e o
      campo diz isso: sem fingir valor que não sei, sem esconder o controle.

   Commit no change (select não tem blur útil), "Salvo" discreto como todo
   campo da ficha, e o desfazer do toast devolve o vendedor anterior.
   ------------------------------------------------------------------------- */

/** Valor sentinela do select — Radix não aceita `value=""` num item. */
const SEM_VENDEDOR = "sem-vendedor";

function VendedorField({
  negocio,
  dealId,
}: {
  negocio: NegocioDetalhe;
  dealId: string;
}) {
  const toast = useToast();

  const [status, setStatus] = React.useState<"loading" | "indisponivel" | "pronto">("loading");
  const [membros, setMembros] = React.useState<EquipeResumo["membros"]>([]);
  /** `{ agentId, agentName }` do negócio — `null` quando não dá para saber. */
  const [atual, setAtual] = React.useState<{ agentId: string | null; agentName: string | null } | null>(null);
  const [valor, setValor] = React.useState<string>(SEM_VENDEDOR);
  const [state, setState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [erro, setErro] = React.useState<{ mensagem: string; correcao?: string } | null>(null);

  React.useEffect(() => {
    let active = true;
    void Promise.all([listarEquipe(), listarNegociosDoFunil()]).then(
      ([equipeResult, quadroResult]) => {
        if (!active) return;
        if (!equipeResult.ok) {
          setStatus("indisponivel");
          return;
        }
        const resumo = equipeResult.data;
        const eu = resumo.membros.find((m) => m.userId === resumo.solicitanteUserId);
        if (eu?.role !== "owner") {
          setStatus("indisponivel"); // agente/admin não reatribuem — campo nem nasce
          return;
        }
        setMembros(resumo.membros);
        if (quadroResult.ok) {
          const meu = quadroResult.data.find((item) => item.id === negocio.id);
          if (meu) {
            setAtual({ agentId: meu.agentId, agentName: meu.agentName });
            setValor(meu.agentId ?? SEM_VENDEDOR);
          }
        }
        setStatus("pronto");
      },
    );
    return () => {
      active = false;
    };
  }, [negocio.id]);

  /** Grava a atribuição. `anunciar` é falso no caminho do DESFAZER — o toast
      que o chamou já é a mensagem; um segundo toast repetindo a volta é
      ruído (mesmo critério do `reopenAt` do quadro). */
  async function salvar(proximo: string, anunciar: boolean) {
    const anterior = valor;
    setValor(proximo);
    setState("saving");
    setErro(null);
    const result = await atualizarNegocio(dealId, {
      agentId: proximo === SEM_VENDEDOR ? null : proximo,
    });
    if (!result.ok) {
      // O erro do servidor é a verdade (§13.6): o select volta e o campo
      // diz o que aconteceu com o conserto ao lado.
      setValor(anterior);
      setState("error");
      setErro({ mensagem: result.mensagem, correcao: result.correcao });
      return;
    }
    setState("saved");
    setAtual({
      agentId: proximo === SEM_VENDEDOR ? null : proximo,
      agentName:
        proximo === SEM_VENDEDOR
          ? null
          : (membros.find((m) => m.userId === proximo)?.name ?? null),
    });
    if (!anunciar) return;
    toast.undo(
      proximo === SEM_VENDEDOR
        ? "Vendedor removido do negócio"
        : `Reatribuído para ${primeiroNomeDe(nomeDe(proximo) ?? "novo vendedor")}`,
      () => void salvar(anterior, false),
      { tone: "ok" },
    );
  }

  function nomeDe(userId: string): string | null {
    return membros.find((m) => m.userId === userId)?.name ?? null;
  }

  if (status === "loading") {
    // Esqueleto na MESMA altura do campo que vem: o card não pula quando a
    // equipe chega — número que muda de altura ao carregar é bug como número
    // que muda de largura.
    return (
      <Field className="mt-4" aria-busy="true">
        <div className="flex items-baseline justify-between gap-2">
          <Label>Vendedor</Label>
        </div>
        <Skeleton className="h-9 w-full rounded-sm" />
      </Field>
    );
  }
  if (status === "indisponivel") return null;

  const semValorConhecido = atual === null;

  return (
    <Field invalid={state === "error"} className="mt-4">
      <div className="flex items-baseline justify-between gap-2">
        <Label>Vendedor</Label>
        <SavedMark state={state} />
      </div>
      <Select
        value={valor}
        onValueChange={(proximo) => void salvar(proximo, true)}
      >
        <SelectTrigger
          aria-invalid={state === "error" || undefined}
          aria-label="Vendedor do negócio"
        >
          <SelectValue placeholder="Escolher vendedor" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SEM_VENDEDOR}>Sem vendedor</SelectItem>
          {membros.map((membro) => (
            <SelectItem key={membro.memberId} value={membro.userId}>
              <span className="flex items-center gap-2">
                <Monogram
                  name={membro.name ?? membro.email}
                  size="sm"
                  className="text-muted"
                />
                <span className={cn("truncate", membro.name ? undefined : "text-muted")}>
                  {membro.name ?? membro.email}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {state === "error" && erro ? (
        <FieldError
          action={
            <button
              type="button"
              className="font-medium text-danger underline underline-offset-2"
              onClick={() => void salvar(valor, true)}
            >
              {erro.correcao ?? "Tentar de novo"}
            </button>
          }
        >
          {erro.mensagem}
        </FieldError>
      ) : semValorConhecido ? (
        // Negócio perdido: o quadro não devolve o vendedor atual (furo do
        // contrato). O hint diz o que o campo faz — não finge que sabe.
        <FieldHint>
          De quem era não aparece em negócio perdido — escolher aqui reatribui.
        </FieldHint>
      ) : null}
    </Field>
  );
}

/** Primeiro nome para frases — registro, não chamada formal. */
function primeiroNomeDe(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

/** Campo de texto com salvamento automático no blur — igual ao de `ContatoScreen`/`VendaScreen`. */
function TextAutoField({
  label,
  optional,
  initialValue,
  placeholder,
  onSave,
}: {
  label: string;
  optional?: boolean;
  initialValue: string;
  placeholder?: string;
  onSave: (value: string) => Promise<ServiceResult<unknown>>;
}) {
  const [value, setValue] = React.useState(initialValue);
  const savedRef = React.useRef(initialValue);
  const { state, error, commit } = useAutosave(onSave);

  function handleBlur() {
    if (value === savedRef.current) return;
    savedRef.current = value;
    void commit(value);
  }

  return (
    <Field invalid={state === "error"}>
      <div className="flex items-baseline justify-between gap-2">
        <Label optional={optional}>{label}</Label>
        <SavedMark state={state} />
      </div>
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        aria-invalid={state === "error" || undefined}
      />
      {state === "error" ? (
        <FieldError
          action={
            <button
              type="button"
              className="font-medium text-danger underline underline-offset-2"
              onClick={() => void commit(value)}
            >
              Tentar de novo
            </button>
          }
        >
          {error}
        </FieldError>
      ) : null}
    </Field>
  );
}

/** Campo de data com autosave no blur — `<input type="date">` em hora local, nunca meia-noite UTC. */
function DateAutoField({
  label,
  optional,
  initialValue,
  onSave,
}: {
  label: string;
  optional?: boolean;
  initialValue: string;
  onSave: (value: string) => Promise<ServiceResult<unknown>>;
}) {
  const [value, setValue] = React.useState(initialValue);
  const savedRef = React.useRef(initialValue);
  const { state, error, commit } = useAutosave(onSave);

  function handleBlur() {
    if (value === savedRef.current) return;
    savedRef.current = value;
    void commit(value);
  }

  return (
    <Field invalid={state === "error"}>
      <div className="flex items-baseline justify-between gap-2">
        <Label optional={optional}>{label}</Label>
        <SavedMark state={state} />
      </div>
      <Input
        type="date"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={handleBlur}
        aria-invalid={state === "error" || undefined}
      />
      {state === "error" ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

/** Campo numérico inteiro com autosave no blur — para pax (adultos/crianças). */
function NumberAutoField({
  label,
  optional,
  initialValue,
  min,
  max,
  onSave,
}: {
  label: string;
  optional?: boolean;
  initialValue: number;
  min?: number;
  max?: number;
  onSave: (value: number) => Promise<ServiceResult<unknown>>;
}) {
  const [value, setValue] = React.useState(String(initialValue));
  const savedRef = React.useRef(String(initialValue));
  const { state, error, commit } = useAutosave(onSave);

  function handleBlur() {
    if (value === savedRef.current) return;
    const num = Number(value);
    if (Number.isNaN(num)) {
      setValue(savedRef.current);
      return;
    }
    savedRef.current = value;
    void commit(num);
  }

  return (
    <Field invalid={state === "error"}>
      <div className="flex items-baseline justify-between gap-2">
        <Label optional={optional}>{label}</Label>
        <SavedMark state={state} />
      </div>
      <Input
        type="number"
        numeric
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        onChange={(event) => setValue(event.target.value)}
        onBlur={handleBlur}
        aria-invalid={state === "error" || undefined}
      />
      {state === "error" ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

/** Campo de centavos com autosave no blur/Enter — a metade "edição" de `Money`. */
function CentsAutoField({
  label,
  initialCents,
  onSave,
}: {
  label: string;
  initialCents: number;
  onSave: (cents: number) => Promise<ServiceResult<unknown>>;
}) {
  const { state, error, commit } = useAutosave(onSave);

  return (
    <Field invalid={state === "error"} className="mt-4">
      <div className="flex items-baseline justify-between gap-2">
        <Label>{label}</Label>
        <SavedMark state={state} />
      </div>
      <CentsInput
        cents={initialCents}
        onCommit={(cents) => void commit(cents)}
        invalid={state === "error"}
      />
      {state === "error" ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

/* =============================================================================
   Passageiros — quem viaja, e o CSV que vai para o fornecedor
   -----------------------------------------------------------------------------
   Fase 2 do Monde ("lista de passageiros exportável"). No nosso desenho o
   passageiro mora no cadastro do cliente (`travelers.contactId`) — a lista da
   viagem é a dos passageiros DESTE negócio, pelo contato dele. O export não
   pede nada a mais: a rota `/api/export/passageiros/[dealId]` resolve o mesmo
   recorte no servidor, então o botão é um link — download é navegação, não
   action, e o arquivo não depende de JavaScript para existir.

   O aviso do rodapé existe porque o CSV sai com documento: o arquivo é para o
   fornecedor que vai operar a viagem, não para qualquer Grupo de WhatsApp.
   ========================================================================== */

function PassageirosCard({ negocio }: { negocio: NegocioDetalhe }) {
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [travelers, setTravelers] = React.useState<ViajanteResumo[]>([]);
  const [reloadToken, setReloadToken] = React.useState(0);
  const reload = React.useCallback(() => setReloadToken((token) => token + 1), []);

  React.useEffect(() => {
    let active = true;
    setStatus("loading");
    void listarViajantes({ contatoId: negocio.contactId }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        return;
      }
      setTravelers(result.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [negocio.contactId, reloadToken]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Passageiros</CardTitle>
        {status === "ready" && travelers.length > 0 ? (
          <span className="text-13 tabular-nums text-muted">
            {travelers.length} {travelers.length === 1 ? "passageiro" : "passageiros"}
          </span>
        ) : null}
      </CardHeader>
      <CardBody flush={status !== "ready" || travelers.length === 0}>
        {status === "loading" ? (
          <div className="flex flex-col gap-4 p-4">
            <SkeletonRow />
          </div>
        ) : status === "error" ? (
          <div className="flex flex-col items-start gap-3 p-4">
            <FieldError>Não consegui carregar os passageiros deste cliente.</FieldError>
            <Button variant="secondary" size="sm" onClick={reload}>
              Tentar de novo
            </Button>
          </div>
        ) : travelers.length === 0 ? (
          <EmptyState
            compact
            title="Nenhum passageiro cadastrado"
            description="Os passageiros da viagem moram no cadastro do cliente — nome completo e documento para reservar com o fornecedor."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line-subtle">
            {travelers.map((traveler) => (
              <li key={traveler.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-15 text-ink">{traveler.fullName}</span>
                  <span className="truncate text-13 text-muted">
                    {TRAVELER_KIND_LABELS[traveler.kind] ?? traveler.kind} · {traveler.nationality}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {traveler.temCpf ? <Badge size="sm">CPF</Badge> : null}
                  {traveler.temPassaporte ? <Badge size="sm">Passaporte</Badge> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <CardFooter
        action={
          <Button variant="secondary" size="sm" asChild>
            <a href={urlDoCsvDePassageiros(negocio.id)} download>
              <DownloadIcon className="size-4" />
              Exportar CSV
            </a>
          </Button>
        }
      >
        O arquivo sai com nome e documento de cada passageiro — mande só para quem vai operar a viagem.
      </CardFooter>
    </Card>
  );
}

/* =============================================================================
   Resultado da viagem — o dinheiro do fechamento (fase 2 do Monde)
   -----------------------------------------------------------------------------
   O card só existe em negócio ganho (`isWon`): recém-fechado é exatamente o
   momento em que a agente quer saber quanto sobrou. Quem busca é este card;
   quem desenha é `ResultadoViagemCard` (o mesmo do Relatório, com a soma do
   período no lugar do negócio).
   ========================================================================== */

function ResultadoCard({ dealId }: { dealId: string }) {
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [dados, setDados] = React.useState<ResultadoDaViagem | null>(null);
  const [erro, setErro] = React.useState<{ mensagem: string; correcao?: string } | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const reload = React.useCallback(() => setReloadToken((token) => token + 1), []);

  React.useEffect(() => {
    let active = true;
    setStatus("loading");
    void resultadoDaViagem(dealId).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setErro({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setDados(result.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [dealId, reloadToken]);

  if (status === "ready" && dados) {
    return <ResultadoViagemCard dados={dados} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resultado da viagem</CardTitle>
      </CardHeader>
      {status === "loading" ? (
        <div className="flex flex-col gap-3 px-4 py-4">
          <Skeleton className="h-8 w-44 rounded-sm" />
          <Skeleton className="h-3.5 w-56 rounded-xs" />
          <div className="pt-2">
            <SkeletonRow />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3 px-4 py-4">
          <FieldError>
            {erro?.mensagem ?? "Não consegui carregar o resultado desta viagem."}
          </FieldError>
          <Button variant="secondary" size="sm" onClick={reload}>
            {erro?.correcao ?? "Tentar de novo"}
          </Button>
        </div>
      )}
    </Card>
  );
}

/* =============================================================================
   Proposta — link direto se já existe, atalho de criação se não existe
   ========================================================================== */

type PropostasStatus = "loading" | "ready" | "error";

const PROPOSTA_STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  sent: "Enviada",
  viewed: "Aberta pelo cliente",
  accepted: "Aceita",
  declined: "Recusada",
  expired: "Expirada",
};

const PROPOSTA_STATUS_TONE: Record<string, BadgeProps["tone"]> = {
  draft: "neutral",
  sent: "accent",
  viewed: "accent",
  accepted: "ok",
  declined: "danger",
  expired: "warn",
};

function PropostaCard({ negocio }: { negocio: NegocioDetalhe }) {
  const router = useRouter();
  const [status, setStatus] = React.useState<PropostasStatus>("loading");
  const [propostas, setPropostas] = React.useState<PropostaResumo[]>([]);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  const [reloadToken, setReloadToken] = React.useState(0);
  const reload = React.useCallback(() => setReloadToken((token) => token + 1), []);

  React.useEffect(() => {
    let active = true;
    setStatus("loading");
    // Não existe `obterPropostaDoNegocio(dealId)` no servidor ainda — ver o
    // comentário de topo do arquivo. `incluirArquivadas: true` porque uma
    // proposta arquivada ainda é a proposta DESTE negócio; esconder ela
    // faria a tela oferecer "Nova proposta" para um negócio que já tem uma.
    void listarPropostas({ incluirArquivadas: true, limite: 200 }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        return;
      }
      setPropostas(result.data.filter((p) => p.dealId === negocio.id));
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [negocio.id, reloadToken]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Proposta</CardTitle>
      </CardHeader>
      <CardBody flush={status !== "ready" || propostas.length === 0}>
        {status === "loading" ? (
          <div className="flex flex-col gap-4 p-4">
            <SkeletonRow />
          </div>
        ) : status === "error" ? (
          <div className="flex flex-col items-start gap-3 p-4">
            <FieldError>Não consegui verificar se já existe proposta para este negócio.</FieldError>
            <Button variant="secondary" size="sm" onClick={reload}>
              Tentar de novo
            </Button>
          </div>
        ) : propostas.length === 0 ? (
          <EmptyState
            compact
            title="Nenhuma proposta ainda"
            description="Monte a proposta a partir dos dados deste negócio: até 3 opções comparáveis e blocos de hotel, voo, transfer, passeio ou seguro."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line-subtle">
            {propostas.map((proposta) => (
              <li key={proposta.id}>
                <Link
                  href={`/propostas/${proposta.id}/editar`}
                  className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface-2"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-15 font-medium text-ink">{proposta.title}</span>
                      <Badge tone={PROPOSTA_STATUS_TONE[proposta.status] ?? "neutral"}>
                        {PROPOSTA_STATUS_LABEL[proposta.status] ?? proposta.status}
                      </Badge>
                    </span>
                    <span className="text-13 text-muted">
                      {proposta.viewCount > 0
                        ? proposta.viewCount === 1
                          ? "aberta 1 vez"
                          : `aberta ${proposta.viewCount} vezes`
                        : "ainda não aberta"}
                    </span>
                  </span>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <CardFooter
        action={
          propostas.length === 0 ? (
            <Button variant="primary" size="sm" onPointerDown={() => setSheetOpen(true)}>
              <PlusIcon className="size-4" />
              Nova proposta
            </Button>
          ) : (
            <CardAction onClick={() => setSheetOpen(true)}>+ nova versão</CardAction>
          )
        }
      />

      <NovaPropostaSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        negocioFixo={{
          id: negocio.id,
          title: negocio.title,
          contactName: negocio.contactName,
          destination: negocio.destination,
        }}
        onCreated={(id) => {
          setSheetOpen(false);
          router.push(`/propostas/${id}/editar`);
        }}
      />
    </Card>
  );
}

/* =============================================================================
   Roteiro — §4, pós-venda. O card só existe quando o negócio fechou como
   ganho (`isWon` da coluna): o roteiro é documento de viagem para o CLIENTE —
   sem custo, sem comissão, sem preço.

   A tela de configuração agora existe: o editor de roteiro
   (`/funil/<id>/roteiro`), irmão do editor de proposta. O card é a ENTRADA —
   sem roteiro, convida a montar (a geração acontece lá, e é idempotente no
   servidor); com roteiro, a ação principal é EDITAR o conteúdo, porque o
   link e os dados comerciais não mudam: o cliente recarrega a MESMA URL e vê
   o conteúdo novo. Copiar (para o WhatsApp) e abrir (a própria URL, clicável)
   ficam a um toque de texto.

   A leitura usa `listarRoteiroDoNegocio(dealId)` (contrato do rafa; ponte
   provisória em `src/lib/ui/roteiroApi.ts`) — o filtro de 200 linhas no
   cliente que existia aqui era o jeito de ontem.
   ========================================================================== */

function RoteiroCard({ negocio }: { negocio: NegocioDetalhe }) {
  const toast = useToast();
  const router = useRouter();
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [roteiro, setRoteiro] = React.useState<RoteiroResumo | null>(null);
  const [loadError, setLoadError] = React.useState<{ mensagem: string; correcao?: string } | null>(null);
  const [copiado, setCopiado] = React.useState(false);
  const [reloadToken, setReloadToken] = React.useState(0);
  const reload = React.useCallback(() => setReloadToken((token) => token + 1), []);

  React.useEffect(() => {
    let active = true;
    setStatus("loading");
    void listarRoteiroDoNegocio(negocio.id).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setLoadError({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setRoteiro(result.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [negocio.id, reloadToken]);

  const url = roteiro ? `${window.location.origin}/r/${roteiro.publicToken}` : null;
  const datas = roteiro ? formatarFaixaDeDatas(roteiro.departureOn, roteiro.returnOn) : null;

  async function copiarLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.show({
        title: "Não consegui copiar o link",
        description: "Copie o link exibido no corpo do card.",
        tone: "danger",
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roteiro</CardTitle>
      </CardHeader>
      <CardBody flush={status !== "ready" || !roteiro}>
        {status === "loading" ? (
          <div className="flex flex-col gap-4 p-4">
            <SkeletonRow />
          </div>
        ) : status === "error" ? (
          <div className="flex flex-col items-start gap-3">
            <FieldError>
              {loadError?.mensagem ?? "Não consegui carregar o roteiro deste negócio."}
            </FieldError>
            <Button variant="secondary" size="sm" onClick={reload}>
              {loadError?.correcao ?? "Tentar de novo"}
            </Button>
          </div>
        ) : roteiro ? (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-15 font-medium text-ink">{roteiro.title}</span>
            <span className="truncate text-13 text-muted">
              {roteiro.clientName}
              {datas ? ` · ${datas}` : ""}
            </span>
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                data-numeric
                className="mt-1 max-w-full truncate text-13 tabular-nums text-subtle hover:text-accent hover:underline"
              >
                {url}
              </a>
            ) : null}
          </div>
        ) : (
          <EmptyState
            compact
            title="Nenhum roteiro montado"
            description="Monte por blocos o que o cliente abre durante a viagem — dias, paradas, hospedagem, dicas locais, contato de emergência e fotos. O roteiro nasce da proposta aceita e o link público continua o mesmo depois de cada ajuste."
          />
        )}
      </CardBody>
      <CardFooter
        action={
          <Button
            variant="primary"
            size="sm"
            onPointerDown={() => router.push(`/funil/${negocio.id}/roteiro`)}
            disabled={status === "error"}
          >
            {roteiro ? "Editar roteiro" : "Montar roteiro"}
          </Button>
        }
        secondary={
          roteiro && url ? (
            <CardAction onClick={() => void copiarLink(url)}>
              {copiado ? "Copiado" : "Copiar link"}
            </CardAction>
          ) : undefined
        }
      >
        {roteiro ? "Editar não muda o link — mande por WhatsApp." : "O roteiro nasce da proposta aceita."}
      </CardFooter>
    </Card>
  );
}

/* =============================================================================
   Linha do tempo — `activities`, mais recente primeiro (já vem assim de
   `obterNegocio`). Sem dot colorido por tipo: aqui não é onde se clica, e o
   azul é reservado pra isso — texto quieto, data tabular.
   ========================================================================== */

function TimelineCard({
  activities,
  colunas,
}: {
  activities: AtividadeDoNegocio[];
  /** Todas as colunas do tenant (ativas + arquivadas), por id — de onde os rótulos vêm. */
  colunas: Map<string, EstagioDoFunil>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Linha do tempo</CardTitle>
      </CardHeader>
      <CardBody flush={activities.length === 0}>
        {activities.length === 0 ? (
          <EmptyState
            compact
            title="Nenhuma atividade ainda"
            description="Toda mudança de estágio e todo envio de proposta aparece aqui, na ordem em que aconteceu."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line-subtle">
            {activities.map((activity) => {
              const when = new Date(activity.occurredAt);
              return (
                <li key={activity.id} className="flex flex-col gap-0.5 px-4 py-3">
                  <p className="text-15 text-ink">{activityLabel(activity, colunas)}</p>
                  <p data-numeric className="text-13 tabular-nums text-muted">
                    {formatDayMonth(when)} · {formatTime(when)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
