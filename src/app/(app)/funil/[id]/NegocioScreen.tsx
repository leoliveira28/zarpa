"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  COLUNAS_DO_FUNIL,
  atualizarNegocio,
  listarPropostas,
  moverEstagioDoNegocio,
  obterNegocio,
  type AtividadeDoNegocio,
  type DealStage,
  type EstagioDeFunil,
  type NegocioDetalhe,
  type PropostaResumo,
  type ServiceResult,
} from "@/server";
import { avisarRecusaDeEscrita } from "@/lib/ui/assinatura";
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
import { Field, FieldError, Label, SavedMark } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { CentsInput, MoneyStat } from "@/components/ui/Money";
import { Skeleton, SkeletonRow, SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { DealStageMenu, LossReasonDialog } from "@/components/app/DealStageMenu";
import { NovaPropostaSheet } from "@/components/app/NovaPropostaSheet";
import { ChevronRightIcon, PlusIcon } from "@/components/app/icons";
import { formatDayMonth, formatTime } from "@/lib/ui/format";
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

   "Conectar à proposta": `obterNegocio` não devolve propostas (não é dado do
   negócio, é dado da proposta) — o card `PropostaCard` abaixo faz a própria
   busca (`listarPropostas`, filtrada por `dealId` no cliente — não existe
   ainda um `obterPropostaDoNegocio(dealId)` no servidor; no volume esperado
   [10-15 vendas/mês] isso é seguro, mesmo padrão de soma em JS já documentado
   em `deals.ts`). Handoff aberto para um filtro de verdade se um tenant um
   dia crescer além disso.
   ========================================================================== */

type Status = "loading" | "ready" | "error";

/** Rótulo de estágio: as cinco colunas do quadro + "Perdida", que não é coluna. */
const STAGE_LABEL: Record<DealStage, string> = {
  ...Object.fromEntries(COLUNAS_DO_FUNIL.map((c) => [c.estagio, c.label])),
  perdido: "Perdida",
} as Record<DealStage, string>;

const STAGE_TONE: Record<DealStage, BadgeProps["tone"]> = {
  novo: "neutral",
  cotando: "neutral",
  proposta_enviada: "neutral",
  negociando: "neutral",
  ganho: "ok",
  perdido: "danger",
};

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

function isDealStage(value: unknown): value is DealStage {
  return typeof value === "string" && value in STAGE_LABEL;
}

/**
 * `stage_changed` chega do servidor com `body` em enum cru — "Movido de
 * proposta_enviada para novo." — porque `moverEstagioDoNegocio` (deals.ts)
 * escreve o `body` com o valor de banco, não com a copy de interface (ele
 * nem importa `COLUNAS_DO_FUNIL`, que é copy da Nina). Reconstruo a frase
 * aqui a partir de `metadata.de`/`metadata.para` (sempre presentes nesse
 * tipo) com `STAGE_LABEL` — mesmo texto que o badge do cabeçalho já usa, sem
 * pedir ao servidor pra mudar o que ele grava. `body` só entra como
 * min-fallback se a metadata vier de um formato inesperado.
 */
function activityLabel(activity: AtividadeDoNegocio): string {
  if (activity.type === "stage_changed") {
    const de = activity.metadata.de;
    const para = activity.metadata.para;
    if (isDealStage(de) && isDealStage(para)) {
      if (para === "perdido") {
        const motivo = activity.metadata.motivoPerda;
        return typeof motivo === "string" && motivo.trim().length > 0
          ? `Marcada como perdida: ${motivo}`
          : "Marcada como perdida.";
      }
      return `Movido de ${STAGE_LABEL[de]} para ${STAGE_LABEL[para]}.`;
    }
  }
  const body = activity.body?.trim();
  return body && body.length > 0 ? body : (ACTIVITY_FALLBACK[activity.type] ?? activity.type);
}

function optimisticActivityId(): string {
  return `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Mesmo texto que `moverEstagioDoNegocio` grava em `activities.body` (deals.ts) — a entrada otimista não pode divergir do que um F5 traria de volta. */
function stageActivityBody(from: DealStage, to: DealStage, motivo?: string): string {
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
    void obterNegocio(dealId).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setErrorInfo({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setNegocio(result.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [dealId, reloadToken]);

  /** Reabre num estágio — o desfazer de um movimento normal E o de "marcar como perdida" caem aqui. */
  async function reopenTo(previous: NegocioDetalhe) {
    setNegocio((current) => (current ? { ...current, stage: previous.stage } : current));
    const motivo = previous.stage === "perdido" ? (previous.lostReason ?? "reaberto por engano") : undefined;
    const result = await moverEstagioDoNegocio(previous.id, previous.stage, motivo);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      toast.show({ title: "Não consegui desfazer", description: result.mensagem, tone: "danger" });
      retry(); // não tenta adivinhar o estado certo sozinha — reconsulta tudo
      return;
    }
    setNegocio((current) =>
      current
        ? {
            ...current,
            stage: result.data.stage,
            lostReason: result.data.lostReason,
            closedAt: result.data.closedAt,
            updatedAt: result.data.updatedAt,
          }
        : current,
    );
  }

  async function handleMove(stage: EstagioDeFunil) {
    if (!negocio || stage === negocio.stage) return;
    const previous = negocio;
    const label = COLUNAS_DO_FUNIL.find((c) => c.estagio === stage)?.label ?? stage;

    // otimista: o toque não espera a rede, e a linha do tempo já mostra a
    // mudança na hora — o mesmo texto que o servidor grava (ver
    // `stageActivityBody`), então um F5 antes da resposta chegar não muda o
    // que a agente já leu.
    setNegocio({
      ...negocio,
      stage,
      activities: [
        {
          id: optimisticActivityId(),
          type: "stage_changed",
          body: stageActivityBody(negocio.stage, stage),
          metadata: { de: negocio.stage, para: stage },
          actorUserId: null,
          occurredAt: new Date(),
        },
        ...negocio.activities,
      ],
    });

    const result = await moverEstagioDoNegocio(negocio.id, stage);
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
      current
        ? {
            ...current,
            stage: result.data.stage,
            lostReason: result.data.lostReason,
            closedAt: result.data.closedAt,
            updatedAt: result.data.updatedAt,
          }
        : current,
    );
    toast.undo(`Movido para ${label}`, () => void reopenTo(previous), { tone: "ok" });
  }

  function handleLost(movedDealId: string, motivo: string) {
    if (!negocio || negocio.id !== movedDealId) return;
    const previous = negocio;
    setNegocio({
      ...negocio,
      stage: "perdido",
      lostReason: motivo,
      activities: [
        {
          id: optimisticActivityId(),
          type: "stage_changed",
          body: stageActivityBody(negocio.stage, "perdido", motivo),
          metadata: { de: negocio.stage, para: "perdido", motivoPerda: motivo },
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
              <Badge tone={STAGE_TONE[negocio.stage]} dot>
                {STAGE_LABEL[negocio.stage]}
              </Badge>
              <DealStageMenu
                contactName={negocio.contactName}
                currentStage={negocio.stage}
                onMove={(stage) => void handleMove(stage)}
                onRequestLoss={() => setLossDialogOpen(true)}
              />
            </div>
          </header>

          {negocio.stage === "perdido" && negocio.lostReason ? (
            <Card tone="warn" className="p-4">
              <p className="text-13 text-ink">
                <span className="font-medium">Motivo da perda:</span> {negocio.lostReason}
              </p>
            </Card>
          ) : null}

          <ViagemCard negocio={negocio} dealId={negocio.id} onPatched={patch} />
          <PropostaCard negocio={negocio} />
          <TimelineCard activities={negocio.activities} />

          <LossReasonDialog
            deal={lossDialogOpen ? { id: negocio.id, contactName: negocio.contactName } : null}
            onOpenChange={setLossDialogOpen}
            onLost={handleLost}
          />
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
      </CardBody>
    </Card>
  );
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
   Linha do tempo — `activities`, mais recente primeiro (já vem assim de
   `obterNegocio`). Sem dot colorido por tipo: aqui não é onde se clica, e o
   azul é reservado pra isso — texto quieto, data tabular.
   ========================================================================== */

function TimelineCard({ activities }: { activities: AtividadeDoNegocio[] }) {
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
                  <p className="text-15 text-ink">{activityLabel(activity)}</p>
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
