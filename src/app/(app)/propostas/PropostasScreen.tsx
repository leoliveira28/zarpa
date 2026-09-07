"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  listarPropostas,
  restaurarProposta,
  type PropostaResumo,
} from "@/server";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Money } from "@/components/ui/Money";
import { Rule } from "@/components/plates";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { NovaPropostaSheet } from "@/components/app/NovaPropostaSheet";
import { PlusIcon, SearchIcon } from "@/components/app/icons";
import { formatDayMonth } from "@/lib/ui/format";
import { cn } from "@/lib/ui/cn";

/* =============================================================================
   Propostas — a lista
   -----------------------------------------------------------------------------
   Mesma gramática de Clientes: registro silencioso, busca sem apagar o
   resultado anterior, uma linha de papel por proposta separada por fio.

   "Nova proposta" pede o negócio de origem (`dealId`) — regra do contrato
   (`criarPropostaAPartirDoNegocio`). Hoje isso é um campo de ID colado à mão:
   não existe ainda um serviço que LISTE negócios para um seletor por nome
   (só `proposals.ts`, que devolve negócio já como leitura de uma proposta
   existente). Pedido em docs/handoffs/nina-para-rafa.md — trocar por um
   Combobox por título de negócio assim que `listarNegocios()` existir é uma
   linha, não uma reforma: a Sheet já isola esse campo dos demais.
   ========================================================================== */

type Status = "loading" | "ready" | "error";

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  sent: "Enviada",
  viewed: "Aberta",
  accepted: "Aceita",
  declined: "Recusada",
  expired: "Expirada",
};

const STATUS_TONE: Record<string, "neutral" | "accent" | "ok" | "warn" | "danger"> = {
  draft: "neutral",
  sent: "accent",
  viewed: "accent",
  accepted: "ok",
  declined: "danger",
  expired: "warn",
};

export function PropostasScreen() {
  const router = useRouter();
  const toast = useToast();

  const [status, setStatus] = React.useState<Status>("loading");
  const [propostas, setPropostas] = React.useState<PropostaResumo[]>([]);
  const [errorInfo, setErrorInfo] = React.useState<{ mensagem: string; correcao?: string } | null>(null);
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const [includeArchived, setIncludeArchived] = React.useState(false);
  const [isPending, setIsPending] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [reloadToken, setReloadToken] = React.useState(0);
  const hasLoadedOnce = React.useRef(false);
  const retry = React.useCallback(() => setReloadToken((token) => token + 1), []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  React.useEffect(() => {
    let active = true;
    if (hasLoadedOnce.current) setIsPending(true);
    else setStatus("loading");

    void listarPropostas({
      busca: debouncedQuery || undefined,
      incluirArquivadas: includeArchived,
    }).then((result) => {
      if (!active) return;
      hasLoadedOnce.current = true;
      setIsPending(false);
      if (!result.ok) {
        setStatus("error");
        setErrorInfo({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setPropostas(result.data);
      setStatus("ready");
    });

    return () => {
      active = false;
    };
  }, [debouncedQuery, includeArchived, reloadToken]);

  async function handleRestore(proposta: PropostaResumo) {
    const result = await restaurarProposta(proposta.id);
    if (!result.ok) {
      toast.show({ title: "Não consegui restaurar", description: result.mensagem, tone: "danger" });
      return;
    }
    toast.show({ title: `Proposta restaurada: ${proposta.title}`, tone: "ok" });
    retry();
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="display text-32 text-ink">Propostas</h2>
          <Button
            variant="primary"
            iconOnly
            aria-label="Nova proposta"
            onPointerDown={() => setSheetOpen(true)}
          >
            <PlusIcon className="size-4" />
          </Button>
        </div>

        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cliente, destino ou título"
          aria-label="Buscar proposta"
          prefix={<SearchIcon className="size-4" />}
        />
      </header>

      <div className={cn("transition-opacity duration-150", isPending && "opacity-60")}>
        {status === "loading" ? (
          <Card className="flex flex-col divide-y divide-line-subtle p-1">
            {[0, 1, 2].map((row) => (
              <div key={row} className="p-3">
                <SkeletonRow />
              </div>
            ))}
          </Card>
        ) : status === "error" ? (
          <Card className="flex flex-col items-start gap-3 p-5">
            <p className="text-15 text-ink">{errorInfo?.mensagem}</p>
            <Button variant="secondary" onClick={retry}>
              {errorInfo?.correcao ?? "Tentar de novo"}
            </Button>
          </Card>
        ) : propostas.length === 0 ? (
          <EmptyState
            plate
            title={query ? "Nenhuma proposta encontrada" : "Nenhuma proposta ainda"}
            description={
              query
                ? "Tente outro nome, destino ou título."
                : "Monte a primeira proposta a partir de um negócio: até 3 opções comparáveis e blocos de hotel, voo, transfer, passeio ou seguro."
            }
            preview={
              <Card className="flex items-center justify-between gap-3 p-3">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-15 font-medium text-ink">Marina Albuquerque</span>
                  <span className="text-13 text-muted">Fernando de Noronha</span>
                </span>
                <Money cents={1_284_000} size="15" reserveFor={5_940_000} />
              </Card>
            }
            action={
              !query ? (
                <Button variant="primary" onPointerDown={() => setSheetOpen(true)}>
                  <PlusIcon className="size-4" />
                  Nova proposta
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Card className="flex flex-col p-1">
            {propostas.map((proposta, index) => (
              <React.Fragment key={proposta.id}>
                {index > 0 ? <Rule inner /> : null}
                <PropostaRow
                  proposta={proposta}
                  onOpen={() => router.push(`/propostas/${proposta.id}/editar`)}
                  onRestore={proposta.archivedAt ? () => void handleRestore(proposta) : undefined}
                />
              </React.Fragment>
            ))}
          </Card>
        )}

        {status === "ready" && propostas.length > 0 ? (
          <button
            type="button"
            onClick={() => setIncludeArchived((current) => !current)}
            className="mt-3 text-13 font-medium text-muted hover:text-ink"
          >
            {includeArchived ? "Ocultar arquivadas" : "Mostrar arquivadas"}
          </button>
        ) : null}
      </div>

      <NovaPropostaSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onCreated={(id) => {
          setSheetOpen(false);
          router.push(`/propostas/${id}/editar`);
        }}
      />
    </div>
  );
}

function PropostaRow({
  proposta,
  onOpen,
  onRestore,
}: {
  proposta: PropostaResumo;
  onOpen: () => void;
  onRestore?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex min-h-14 w-full items-center gap-3 rounded-md px-3 py-2.5 text-left",
        "hover:bg-surface-2",
        proposta.archivedAt && "opacity-60",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate text-15 font-medium text-ink">{proposta.contactName}</span>
          <Badge tone={STATUS_TONE[proposta.status] ?? "neutral"}>
            {STATUS_LABEL[proposta.status] ?? proposta.status}
          </Badge>
        </span>
        <span className="truncate text-13 text-muted">
          {proposta.destination ?? proposta.dealTitle} · {proposta.title}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-13 tabular-nums text-muted">
          {proposta.validUntil ? `válida até ${formatDayMonth(new Date(`${proposta.validUntil}T00:00:00`))}` : "sem validade"}
        </span>
        {proposta.viewCount > 0 ? (
          <span className="text-13 tabular-nums text-accent">
            {proposta.viewCount === 1 ? "aberta 1 vez" : `aberta ${proposta.viewCount} vezes`}
          </span>
        ) : null}
      </span>
      {onRestore ? (
        <span
          role="button"
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation();
            onRestore();
          }}
          className="shrink-0 rounded-md px-2 py-1.5 text-13 font-medium text-accent hover:bg-accent-soft"
        >
          Restaurar
        </span>
      ) : null}
    </button>
  );
}

