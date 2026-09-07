"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  atualizarOpcao,
  atualizarProposta,
  converterPropostaEmVenda,
  criarOpcao,
  enviarProposta,
  excluirOpcao,
  marcarPropostaComoAceita,
  obterPropostaParaEdicao,
  reordenarOpcoes,
  type BlocoEdicao,
  type OpcaoEdicao,
  type PropostaEdicao,
} from "@/server";
import { avisarRecusaDeEscrita } from "@/lib/ui/assinatura";
// Helpers síncronos de matemática pura (não `'use server'`) — ver
// docs/handoffs/rafa-para-nina.md, seção Parcelamento: seguro de importar
// direto em componente de cliente, o arquivo não toca em banco nem em auth.
import { sugerirComissaoCents, sugerirValorParcelaCents } from "@/server/pricing";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardAction, CardBody, CardFooter, CardHeader } from "@/components/ui/Card";
import { CentsInput } from "@/components/ui/Money";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { Field, FieldError, FieldHint, Label, SavedMark } from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/Input";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { ChevronRightIcon, LinkIcon, PlusIcon, SearchIcon } from "@/components/app/icons";
import { CotacaoSheet } from "@/components/app/CotacaoSheet";
import { cn } from "@/lib/ui/cn";
import { useAutosave } from "@/lib/ui/useAutosave";
import { BlocksEditor } from "./BlocksEditor";
import { ProposalPreview } from "./ProposalPreview";

/* =============================================================================
   Editor de proposta — o coração do produto (S5/S6)
   -----------------------------------------------------------------------------
   Miolo silencioso à esquerda (uma cor de destaque, fio em vez de moldura),
   prévia editorial à direita — "o link web é o produto" continua valendo
   dentro do próprio construtor: a agente nunca perde de vista o que o
   cliente vai ver. Em 390px os dois registros não cabem lado a lado, então
   viram abas: "Editar" / "Prévia", sem esconder informação nenhuma — só uma
   de cada vez.

   Autosave em toda parte, sem botão Salvar. `sugerirComissaoCents` e
   `sugerirValorParcelaCents` (server/pricing.ts, síncronas, não Server
   Action) alimentam o palpite ANTES do agente digitar por cima — é o que
   faz montar uma opção em segundos, não em idas e vindas ao servidor.
   ========================================================================== */

type Status = "loading" | "ready" | "error";
type View = "editar" | "previa";

export function PropostaEditorScreen({ propostaId }: { propostaId: string }) {
  const [status, setStatus] = React.useState<Status>("loading");
  const [proposta, setProposta] = React.useState<PropostaEdicao | null>(null);
  const [errorInfo, setErrorInfo] = React.useState<{ mensagem: string; correcao?: string } | null>(null);
  const [view, setView] = React.useState<View>("editar");
  const [reloadToken, setReloadToken] = React.useState(0);
  const retry = React.useCallback(() => setReloadToken((t) => t + 1), []);

  React.useEffect(() => {
    let active = true;
    void obterPropostaParaEdicao(propostaId).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setErrorInfo({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setProposta(result.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [propostaId, reloadToken]);

  const patchMeta = React.useCallback((update: Partial<PropostaEdicao>) => {
    setProposta((current) => (current ? { ...current, ...update } : current));
  }, []);

  const setOptions = React.useCallback((updater: (options: OpcaoEdicao[]) => OpcaoEdicao[]) => {
    setProposta((current) => (current ? { ...current, options: updater(current.options) } : current));
  }, []);

  const setBlocks = React.useCallback((updater: (blocks: BlocoEdicao[]) => BlocoEdicao[]) => {
    setProposta((current) => (current ? { ...current, blocks: updater(current.blocks) } : current));
  }, []);

  if (status === "loading") {
    return <EditorSkeleton />;
  }

  if (status === "error" || !proposta) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <Card className="flex flex-col items-start gap-3 p-5">
          <p className="text-15 text-ink">{errorInfo?.mensagem}</p>
          <Button variant="secondary" onClick={retry}>
            {errorInfo?.correcao ?? "Tentar de novo"}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:h-full">
      <div className="flex shrink-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <BackLink />
          <PublishBar proposta={proposta} onPatched={patchMeta} />
        </div>
        <ViewToggle view={view} onChange={setView} />
      </div>

      <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-2 lg:overflow-hidden">
        <div
          className={cn(
            "flex min-h-0 flex-col gap-6 lg:overflow-y-auto lg:pr-1",
            view === "previa" && "hidden lg:flex",
          )}
        >
          <MetaCard proposta={proposta} onPatched={patchMeta} />
          <OptionsCard proposta={proposta} setOptions={setOptions} />
          <BlocksEditor proposta={proposta} setBlocks={setBlocks} />
        </div>

        <div
          className={cn(
            "min-h-0 lg:overflow-y-auto",
            view === "editar" && "hidden lg:block",
          )}
        >
          <ProposalPreview proposta={proposta} />
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/propostas"
      className="flex w-fit items-center gap-1 text-13 font-medium text-muted hover:text-ink"
    >
      <ChevronRightIcon className="size-3.5 -scale-x-100" />
      Propostas
    </Link>
  );
}

/* =============================================================================
   Enviar — o botão que liga o link público (S7)
   -----------------------------------------------------------------------------
   Rascunho não tem link nenhum (a policy de leitura pública exige status
   diferente de "draft" + `sentAt`). Depois de enviada, o botão vira "Copiar
   link"/"Abrir" — reenviar é permitido (o contrato é idempotente), então não
   escondo a ação, só troco o rótulo.
   ========================================================================== */

const STATUS_META: Record<string, { label: string; tone: "neutral" | "accent" | "ok" | "warn" | "danger" }> = {
  draft: { label: "Rascunho", tone: "neutral" },
  sent: { label: "Enviada", tone: "accent" },
  viewed: { label: "Aberta pelo cliente", tone: "accent" },
  accepted: { label: "Aceita", tone: "ok" },
  declined: { label: "Recusada", tone: "danger" },
  expired: { label: "Expirada", tone: "warn" },
};

function PublishBar({
  proposta,
  onPatched,
}: {
  proposta: PropostaEdicao;
  onPatched: (patch: Partial<PropostaEdicao>) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [sending, setSending] = React.useState(false);
  const [convertingSale, setConvertingSale] = React.useState(false);
  const [markingAccepted, setMarkingAccepted] = React.useState(false);
  const [selectOptionOpen, setSelectOptionOpen] = React.useState(false);
  const isDraft = proposta.status === "draft";
  // Estados que antecedem o aceite — a agente registra o aceite quando o
  // cliente confirmou por outro canal (telefone, WhatsApp fora do app).
  const canMarkAccepted = proposta.status === "sent" || proposta.status === "viewed";
  const canSend = proposta.options.length > 0;
  const meta = STATUS_META[proposta.status] ?? { label: proposta.status, tone: "neutral" as const };

  // Idempotente do lado do servidor (índice único em `sales.proposal_id`):
  // clicar duas vezes não cria venda duplicada, só devolve a mesma — por isso
  // não escondo o botão depois do primeiro clique bem-sucedido, e o `router.push`
  // sempre acerta a venda certa mesmo que o agente clique de novo por engano.
  async function handleGenerateSale() {
    setConvertingSale(true);
    const result = await converterPropostaEmVenda(proposta.id);
    setConvertingSale(false);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      toast.show({
        title: "Não consegui gerar a venda",
        description: result.mensagem,
        tone: "danger",
        action: result.correcao ? { label: result.correcao, onClick: () => void handleGenerateSale() } : undefined,
      });
      return;
    }
    router.push(`/vendas/${result.data.id}`);
  }

  async function handleSend() {
    setSending(true);
    const result = await enviarProposta(proposta.id);
    setSending(false);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      toast.show({
        title: "Não consegui enviar a proposta",
        description: result.mensagem,
        tone: "danger",
        action: result.correcao ? { label: result.correcao, onClick: () => void handleSend() } : undefined,
      });
      return;
    }
    onPatched(result.data);
    // O próximo passo óbvio vem no próprio toast — "mandei o link, agora
    // preciso dele no WhatsApp do cliente" é um toque, sem caçar o botão.
    // `publicToken` já existe (nasce com a proposta), então copiar funciona
    // mesmo com o `proposta` do closure ainda em `draft`.
    toast.show({
      title: "Proposta enviada",
      description: "O link público já está no ar.",
      tone: "ok",
      action: { label: "Copiar link", onClick: () => void handleCopy() },
    });
  }

  // Aceite manual pela agente — o caminho que faltava. O cliente nem sempre
  // clica "Aceitar" no link público; quando aceita por telefone/WhatsApp fora
  // do app, a agente precisa registrar o aceite para destravar o "Gerar
  // venda". Otimista com reversão: a UI vira `accepted` na hora, e se o
  // servidor recusar, volta ao estado anterior + toast com a correção.
  //
  // Sem toast de desfazer de 8s (decisão argumentada em docs/status/nina.md):
  // `marcarPropostaComoAceita` é mudança de estado, não destrutivo; não há
  // action de "desmarcar aceite" no servidor, então o desfazer só reverteria
  // localmente e voltaria `accepted` na próxima recarga — promete o que não
  // cumpre. Se clicou errado, a agente simplesmente não gera a venda, ou
  // arquivava a proposta. Um botão explícito "Desfazer aceite" no futuro
  // (action de "desmarcar" a criar) seria honesto; por ora não invento.
  async function handleMarkAccepted(optionId: string) {
    const previous: Pick<PropostaEdicao, "status" | "acceptedOptionId" | "acceptedAt"> = {
      status: proposta.status,
      acceptedOptionId: proposta.acceptedOptionId,
      acceptedAt: proposta.acceptedAt,
    };
    // Otimista: o `PublishBar` re-renderiza em `accepted` e o "Gerar venda"
    // aparece imediatamente, sem esperar round-trip.
    onPatched({
      status: "accepted",
      acceptedOptionId: optionId,
      acceptedAt: new Date(),
    });
    setMarkingAccepted(true);
    setSelectOptionOpen(false);
    const result = await marcarPropostaComoAceita(proposta.id, optionId);
    setMarkingAccepted(false);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      // Reverte o estado otimista — volta para `sent`/`viewed` como era.
      onPatched(previous);
      toast.show({
        title: "Não consegui marcar como aceita",
        description: result.mensagem,
        tone: "danger",
        action: result.correcao ? { label: result.correcao, onClick: () => void handleMarkAccepted(optionId) } : undefined,
      });
      return;
    }
    // Reconcilia com o estado real do servidor (data de aceite, etc.).
    onPatched(result.data as Partial<PropostaEdicao>);
    toast.show({ title: "Proposta marcada como aceita", tone: "ok" });
  }

  function triggerMarkAccepted() {
    const sorted = [...proposta.options].sort((a, b) => a.position - b.position);
    if (sorted.length === 0) return;
    // Uma opção só: aceita direto, sem perguntar qual.
    if (sorted.length === 1) {
      void handleMarkAccepted(sorted[0]!.id);
      return;
    }
    // Mais de uma: abre o seletor curto.
    setSelectOptionOpen(true);
  }

  function publicUrl() {
    return `${window.location.origin}/p/${proposta.publicToken}`;
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(publicUrl());
      toast.show({ title: "Link copiado" });
    } catch {
      toast.show({
        title: "Não consegui copiar o link",
        description: "Copie manualmente no campo de endereço.",
        tone: "danger",
      });
    }
  }

  const sortedOptions = [...proposta.options].sort((a, b) => a.position - b.position);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={meta.tone}>{meta.label}</Badge>
      {isDraft ? (
        <>
          <Button size="sm" loading={sending} disabled={!canSend} onClick={handleSend}>
            Enviar proposta
          </Button>
          {!canSend ? <span className="text-13 text-muted">Adicione uma opção para enviar.</span> : null}
        </>
      ) : proposta.status === "accepted" ? (
        <>
          <Button size="sm" loading={convertingSale} onClick={() => void handleGenerateSale()}>
            Gerar venda
          </Button>
          <CardAction onClick={() => window.open(publicUrl(), "_blank", "noopener")}>Ver proposta</CardAction>
        </>
      ) : (
        <>
          {canMarkAccepted ? (
            <Button
              size="sm"
              variant="secondary"
              loading={markingAccepted}
              disabled={sortedOptions.length === 0}
              onClick={triggerMarkAccepted}
            >
              Marcar como aceita
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={handleCopy}>
            <LinkIcon className="size-4" />
            Copiar link
          </Button>
          <CardAction onClick={() => window.open(publicUrl(), "_blank", "noopener")}>Abrir</CardAction>
          {sending ? null : (
            <CardAction className="text-muted" onClick={() => void handleSend()}>
              Reenviar
            </CardAction>
          )}
        </>
      )}

      {/*
        Seletor curto de opção aceita — só abre quando a proposta tem MAIS de
        uma opção. `Dialog` (não `Sheet`): é uma decisão de uma só escolha,
        não um formulário; o `Sheet` pesado com campos ficaria desproporcional
        para "qual opção o cliente escolheu?". Lista de botões em vez de
        `Select` dropdown: a ação é destructive-adjacent (muda estado da
        proposta), e botões explícitos com o nome da opção são mais diretos
        que um dropdown que esconde as opções atrás de um clique extra.
      */}
      <Dialog open={selectOptionOpen} onOpenChange={setSelectOptionOpen}>
        <DialogContent
          title="Qual opção foi aceita?"
          description="O cliente escolheu qual das opções da proposta?"
        >
          <div className="flex flex-col gap-1 py-1">
            {sortedOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onPointerDown={() => void handleMarkAccepted(option.id)}
                disabled={markingAccepted}
                className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-line px-4 py-3 text-left text-15 font-medium text-ink [transition:transform_120ms_var(--curve-out)] hover:border-line-strong active:scale-[0.995] disabled:opacity-60"
              >
                <span className="min-w-0 truncate">{option.name}</span>
                {option.isRecommended ? <Badge tone="accent">Recomendada</Badge> : null}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * "Editar"/"Prévia" — não é Tabs.tsx (que tem painel único e permanente):
 * aqui os dois painéis existem sempre no DOM, só a visibilidade muda por
 * breakpoint. Um segmented control simples, sem sublinhado viajante — a
 * troca é binária e instantânea, não uma navegação.
 */
function ViewToggle({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  return (
    <div className="inline-flex w-fit gap-0.5 rounded-md bg-surface-2 p-0.5 lg:hidden">
      {(["editar", "previa"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onPointerDown={() => onChange(option)}
          className={cn(
            "min-h-9 rounded-sm px-3.5 text-13 font-medium capitalize",
            view === option ? "bg-surface text-ink shadow-1" : "text-muted",
          )}
        >
          {option === "editar" ? "Editar" : "Prévia"}
        </button>
      ))}
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-4 w-24 rounded-xs" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-2/3 rounded-sm" />
      </div>
      <Card className="p-4">
        <SkeletonText lines={3} />
      </Card>
      <Card className="p-4">
        <SkeletonText lines={4} />
      </Card>
    </div>
  );
}

/* =============================================================================
   Meta — título, resumo, validade, termos
   ========================================================================== */

function MetaCard({
  proposta,
  onPatched,
}: {
  proposta: PropostaEdicao;
  onPatched: (patch: Partial<PropostaEdicao>) => void;
}) {
  const [title, setTitle] = React.useState(proposta.title);
  const titleAutosave = useAutosave(async (value: string) => {
    const result = await atualizarProposta(proposta.id, { title: value });
    if (result.ok) onPatched({ title: value });
    return result;
  });
  const titleSavedRef = React.useRef(proposta.title);

  const [validUntil, setValidUntil] = React.useState(proposta.validUntil ?? "");
  const validAutosave = useAutosave(async (value: string) => {
    const result = await atualizarProposta(proposta.id, { validUntil: value });
    if (result.ok) onPatched({ validUntil: value || null });
    return result;
  });

  const [summary, setSummary] = React.useState(proposta.summary ?? "");
  const summaryAutosave = useAutosave(
    async (value: string) => {
      const result = await atualizarProposta(proposta.id, { summary: value });
      if (result.ok) onPatched({ summary: value || null });
      return result;
    },
    { debounceMs: 800 },
  );

  const [terms, setTerms] = React.useState(proposta.terms ?? "");
  const termsAutosave = useAutosave(
    async (value: string) => {
      const result = await atualizarProposta(proposta.id, { terms: value });
      if (result.ok) onPatched({ terms: value || null });
      return result;
    },
    { debounceMs: 800 },
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => {
              if (title.trim() === titleSavedRef.current) return;
              titleSavedRef.current = title.trim();
              void titleAutosave.commit(title.trim());
            }}
            className="display min-w-0 flex-1 bg-transparent text-20 text-ink focus-visible:outline-none"
            aria-label="Título da proposta"
          />
          <SavedMark state={titleAutosave.state} />
        </div>
      </CardHeader>
      <CardBody>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <div className="flex items-baseline justify-between gap-2">
              <Label optional>Validade</Label>
              <SavedMark state={validAutosave.state} />
            </div>
            <Input
              type="date"
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
              onBlur={() => void validAutosave.commit(validUntil)}
            />
            <FieldHint>Depois dessa data a proposta pública avisa que os valores podem ter mudado.</FieldHint>
          </Field>
          <Field>
            <Label>Moeda</Label>
            <Badge className="w-fit" tone="neutral">
              {proposta.currency}
            </Badge>
          </Field>
        </div>

        <Field className="mt-1">
          <div className="flex items-baseline justify-between gap-2">
            <Label optional>Resumo</Label>
            <SavedMark state={summaryAutosave.state} />
          </div>
          <Textarea
            value={summary}
            onChange={(event) => {
              setSummary(event.target.value);
              summaryAutosave.schedule(event.target.value);
            }}
            onBlur={() => void summaryAutosave.commit(summary)}
            placeholder="Uma ou duas frases sobre a viagem — aparece no topo da proposta pública."
            rows={2}
          />
        </Field>

        <Field>
          <div className="flex items-baseline justify-between gap-2">
            <Label optional>Condições e forma de pagamento</Label>
            <SavedMark state={termsAutosave.state} />
          </div>
          <Textarea
            value={terms}
            onChange={(event) => {
              setTerms(event.target.value);
              termsAutosave.schedule(event.target.value);
            }}
            onBlur={() => void termsAutosave.commit(terms)}
            placeholder="Política de cancelamento, prazo de confirmação, o que não está incluso…"
            rows={3}
          />
        </Field>
      </CardBody>
    </Card>
  );
}

/* =============================================================================
   Opções — até 3, comparáveis
   ========================================================================== */

function OptionsCard({
  proposta,
  setOptions,
}: {
  proposta: PropostaEdicao;
  setOptions: (updater: (options: OpcaoEdicao[]) => OpcaoEdicao[]) => void;
}) {
  const toast = useToast();
  const [creating, setCreating] = React.useState(false);
  const options = proposta.options;

  async function handleAdd() {
    setCreating(true);
    const result = await criarOpcao(proposta.id, {
      name: `Opção ${options.length + 1}`,
      position: options.length,
      isRecommended: options.length === 0,
    });
    setCreating(false);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      toast.show({ title: "Não consegui criar a opção", description: result.mensagem, tone: "danger" });
      return;
    }
    setOptions((current) => [...current, result.data]);
  }

  async function handleMove(option: OpcaoEdicao, direction: -1 | 1) {
    const sorted = [...options].sort((a, b) => a.position - b.position);
    const index = sorted.findIndex((o) => o.id === option.id);
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    const a = sorted[index]!;
    const b = sorted[target]!;
    const items = [
      { id: a.id, position: b.position },
      { id: b.id, position: a.position },
    ];
    setOptions((current) =>
      current.map((o) => {
        const match = items.find((i) => i.id === o.id);
        return match ? { ...o, position: match.position } : o;
      }),
    );
    const result = await reordenarOpcoes(proposta.id, items);
    if (!result.ok) {
      toast.show({ title: "Não consegui reordenar", description: result.mensagem, tone: "danger" });
    }
  }

  function handleRemoved(optionId: string) {
    setOptions((current) => current.filter((o) => o.id !== optionId));
  }

  function handleUpdated(updated: OpcaoEdicao) {
    setOptions((current) =>
      current.map((o) => {
        if (o.id === updated.id) return updated;
        // marcar recomendada desmarca as outras — a UI reflete sem round-trip
        return updated.isRecommended ? { ...o, isRecommended: false } : o;
      }),
    );
  }

  const sorted = [...options].sort((a, b) => a.position - b.position);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <span className="text-17 font-semibold text-ink">Opções</span>
          <span className="text-13 tabular-nums text-muted">{options.length}/3</span>
        </div>
      </CardHeader>
      <CardBody flush={sorted.length === 0}>
        {sorted.length === 0 ? (
          <div className="flex flex-col gap-3 p-4">
            <p className="text-13 text-muted">
              Toda proposta compara até 3 opções lado a lado — a mesma viagem, preços
              diferentes. Comece pela primeira.
            </p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-line-subtle">
            {sorted.map((option, index) => (
              <OptionRow
                key={option.id}
                proposta={proposta}
                option={option}
                canMoveLeft={index > 0}
                canMoveRight={index < sorted.length - 1}
                onMove={(direction) => void handleMove(option, direction)}
                onRemoved={() => handleRemoved(option.id)}
                onUpdated={handleUpdated}
              />
            ))}
          </div>
        )}
      </CardBody>
      <CardFooter
        action={
          <Button variant="secondary" size="sm" loading={creating} disabled={options.length >= 3} onClick={handleAdd}>
            <PlusIcon className="size-4" />
            Adicionar opção
          </Button>
        }
      >
        {options.length >= 3 ? "Máximo de 3 opções por proposta." : null}
      </CardFooter>
    </Card>
  );
}

function OptionRow({
  proposta,
  option,
  canMoveLeft,
  canMoveRight,
  onMove,
  onRemoved,
  onUpdated,
}: {
  proposta: PropostaEdicao;
  option: OpcaoEdicao;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMove: (direction: -1 | 1) => void;
  onRemoved: () => void;
  onUpdated: (option: OpcaoEdicao) => void;
}) {
  const toast = useToast();
  const [name, setName] = React.useState(option.name);
  const nameAutosave = useAutosave(async (value: string) => {
    const result = await atualizarOpcao(option.id, { name: value });
    if (result.ok) onUpdated(result.data);
    return result;
  });

  const priceAutosave = useAutosave(async (cents: number) => {
    const result = await atualizarOpcao(option.id, { priceCents: cents });
    if (result.ok) onUpdated(result.data);
    return result;
  });
  const costAutosave = useAutosave(async (cents: number) => {
    const result = await atualizarOpcao(option.id, { costCents: cents });
    if (result.ok) onUpdated(result.data);
    return result;
  });
  const commissionAutosave = useAutosave(async (cents: number) => {
    const result = await atualizarOpcao(option.id, { commissionCents: cents });
    if (result.ok) onUpdated(result.data);
    return result;
  });
  // O contrato não aceita `null` para limpar `installments`/`installmentCents`
  // (zod exige inteiro positivo quando o campo vem no patch) — uma vez
  // definido, o parcelamento só se ajusta para outro número, não se apaga
  // por aqui. Registrado em docs/status/nina.md.
  const installmentsAutosave = useAutosave(async (patch: { installments?: number; installmentCents?: number }) => {
    const result = await atualizarOpcao(option.id, patch);
    if (result.ok) onUpdated(result.data);
    return result;
  });

  const scheduleDelete = React.useCallback(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      const result = await excluirOpcao(option.id);
      if (!result.ok) {
        avisarRecusaDeEscrita(result);
        toast.show({ title: `Não consegui remover ${option.name}`, description: result.mensagem, tone: "danger" });
      }
    }, 8000);
    toast.undo(`Opção removida: ${option.name}`, () => {
      cancelled = true;
      window.clearTimeout(timer);
    }, { duration: 8000 });
  }, [option.id, option.name, toast]);

  const [cotacaoOpen, setCotacaoOpen] = React.useState(false);

  const suggestedCommission = sugerirComissaoCents(option.priceCents, option.costCents);
  const suggestedInstallment = option.installments
    ? sugerirValorParcelaCents(option.priceCents, option.installments)
    : null;

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Input
            size="sm"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              if (name.trim() === option.name) return;
              void nameAutosave.commit(name.trim());
            }}
            className="max-w-[14rem] font-medium"
          />
          <SavedMark state={nameAutosave.state} />
          {option.isRecommended ? <Badge tone="accent">Recomendada</Badge> : null}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Mover para a esquerda"
            disabled={!canMoveLeft}
            onPointerDown={() => onMove(-1)}
            className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-ink disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronRightIcon className="size-3.5 -scale-x-100" />
          </button>
          <button
            type="button"
            aria-label="Mover para a direita"
            disabled={!canMoveRight}
            onPointerDown={() => onMove(1)}
            className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-ink disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronRightIcon className="size-3.5" />
          </button>
          <CardAction
            className="text-danger hover:text-danger"
            onClick={() => {
              onRemoved();
              scheduleDelete();
            }}
          >
            Remover
          </CardAction>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field>
          <div className="flex items-baseline justify-between gap-2">
            <Label>Preço de venda</Label>
            <SavedMark state={priceAutosave.state} />
          </div>
          <CentsInput cents={option.priceCents} onCommit={(cents) => void priceAutosave.commit(cents)} />
        </Field>
        <Field>
          <div className="flex items-baseline justify-between gap-2">
            <Label>Custo</Label>
            <SavedMark state={costAutosave.state} />
          </div>
          <CentsInput cents={option.costCents} onCommit={(cents) => void costAutosave.commit(cents)} />
        </Field>
        <Field>
          <div className="flex items-baseline justify-between gap-2">
            <Label>Comissão</Label>
            <SavedMark state={commissionAutosave.state} />
          </div>
          <CentsInput
            cents={option.commissionCents}
            placeholder={(suggestedCommission / 100).toFixed(2).replace(".", ",")}
            onCommit={(cents) => void commissionAutosave.commit(cents)}
          />
        </Field>
      </div>

      <button
        type="button"
        onPointerDown={() => setCotacaoOpen(true)}
        className="flex w-fit items-center gap-1.5 text-13 font-medium text-muted hover:text-ink [@media(pointer:coarse)]:min-h-9"
      >
        <SearchIcon className="size-3.5" />
        Buscar cotação
      </button>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field>
          <Label optional>Parcelas</Label>
          <Input
            type="number"
            min={1}
            max={24}
            numeric
            defaultValue={option.installments ?? ""}
            placeholder="1–24"
            onBlur={(event) => {
              const raw = event.target.value.trim();
              if (!raw) return; // sem endpoint para limpar — ver comentário acima
              const installments = Math.min(24, Math.max(1, Number(raw)));
              if (installments === option.installments) return;
              const installmentCents = option.installmentCents
                ? undefined
                : sugerirValorParcelaCents(option.priceCents, installments);
              void installmentsAutosave.commit(
                installmentCents !== undefined ? { installments, installmentCents } : { installments },
              );
            }}
          />
        </Field>
        <Field className="sm:col-span-2">
          <div className="flex items-baseline justify-between gap-2">
            <Label optional>Valor da parcela</Label>
            <SavedMark state={installmentsAutosave.state} />
          </div>
          <CentsInput
            cents={option.installmentCents}
            placeholder={suggestedInstallment ? (suggestedInstallment / 100).toFixed(2).replace(".", ",") : "0,00"}
            disabled={!option.installments}
            onCommit={(cents) => {
              if (!option.installments) return;
              void installmentsAutosave.commit({ installments: option.installments, installmentCents: cents });
            }}
          />
          {option.installments ? (
            <FieldHint>
              {option.installments}x — palpite sem juros:{" "}
              {((suggestedInstallment ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </FieldHint>
          ) : null}
        </Field>
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-2">
        <Checkbox
          checked={option.isRecommended}
          onCheckedChange={(checked) => {
            if (checked !== true) return;
            void (async () => {
              const result = await atualizarOpcao(option.id, { isRecommended: true });
              if (result.ok) onUpdated(result.data);
            })();
          }}
        />
        <span className="text-13 text-ink">Recomendar esta opção na proposta pública</span>
      </label>

      <CotacaoSheet
        open={cotacaoOpen}
        onOpenChange={setCotacaoOpen}
        optionName={option.name}
        onConfirm={(custoCents, fornecedor) => {
          void costAutosave.commit(custoCents);
          toast.show({
            title: "Custo preenchido",
            description: `${fornecedor} — R$ ${(custoCents / 100).toFixed(2).replace(".", ",")}`,
            tone: "ok",
          });
        }}
      />
    </div>
  );
}
