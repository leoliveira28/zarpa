"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  atualizarParcela,
  atualizarStatusComissao,
  atualizarVenda,
  criarParcela,
  excluirParcela,
  excluirVenda,
  gerarParcelasDaVenda,
  listarParcelas,
  marcarParcelaPaga,
  obterVenda,
  type ComissaoStatus,
  type ParcelaResumo,
  type ServiceResult,
  type VendaResumo,
} from "@/server";
import { Badge } from "@/components/ui/Badge";
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
import { CentsInput, Money, MoneyStat } from "@/components/ui/Money";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { Skeleton, SkeletonRow, SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { ChevronRightIcon, PlusIcon } from "@/components/app/icons";
import { formatDayMonth } from "@/lib/ui/format";
import { useAutosave } from "@/lib/ui/useAutosave";
import { useDeferredDelete } from "@/lib/ui/useDeferredDelete";
import {
  COMISSAO_STATUS_LABEL,
  COMISSAO_STATUS_OPTIONS,
  COMISSAO_STATUS_TONE,
  PARCELA_STATUS_LABEL,
  PARCELA_STATUS_TONE,
  diasParaVencimento,
  formatVencimento,
  margemCents,
  vencimentoLabel,
} from "../shared";

/* =============================================================================
   Ficha da venda
   -----------------------------------------------------------------------------
   Mesma gramática da ficha de cliente: registro silencioso, autosave por
   campo, nada de botão "Salvar". Três cartas na razão base/fuste/capitel:
   Resumo (a fotografia da opção aceita, editável — o contrato deixa
   explícito que isso pode divergir do que a proposta guardou), Comissão
   (a conferência manual) e Parcelas (o que falta o cliente pagar).
   ========================================================================== */

type Status = "loading" | "ready" | "error";

export function VendaScreen({ vendaId }: { vendaId: string }) {
  const [status, setStatus] = React.useState<Status>("loading");
  const [venda, setVenda] = React.useState<VendaResumo | null>(null);
  const [errorInfo, setErrorInfo] = React.useState<{ mensagem: string; correcao?: string } | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const retry = React.useCallback(() => setReloadToken((token) => token + 1), []);

  React.useEffect(() => {
    let active = true;
    void obterVenda(vendaId).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setErrorInfo({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setVenda(result.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [vendaId, reloadToken]);

  function patch(update: Partial<VendaResumo>) {
    setVenda((current) => (current ? { ...current, ...update } : current));
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/vendas"
        className="flex w-fit items-center gap-1 text-13 font-medium text-muted hover:text-ink"
      >
        <ChevronRightIcon className="size-3.5 -scale-x-100" />
        Vendas
      </Link>

      {status === "loading" ? (
        <VendaSkeleton />
      ) : status === "error" || !venda ? (
        <Card className="flex flex-col items-start gap-3 p-5">
          <p className="text-15 text-ink">{errorInfo?.mensagem}</p>
          <Button variant="secondary" onClick={retry}>
            {errorInfo?.correcao ?? "Tentar de novo"}
          </Button>
        </Card>
      ) : (
        <>
          <header className="flex flex-col gap-1">
            <h2 className="display truncate text-32 text-ink">
              {venda.fornecedor ?? "Venda sem fornecedor"}
            </h2>
            <p className="text-13 text-muted">
              Fechada em {formatDayMonth(new Date(venda.createdAt))} ·{" "}
              <Link
                href={`/propostas/${venda.proposalId}/editar`}
                className="font-medium text-accent hover:underline"
              >
                Ver proposta de origem
              </Link>
            </p>
          </header>

          <ResumoCard venda={venda} onPatched={patch} />
          <ComissaoCard venda={venda} onPatched={patch} />
          <ParcelasCard venda={venda} />
          <EncerramentoCard venda={venda} />
        </>
      )}
    </div>
  );
}

function VendaSkeleton() {
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
   Resumo — a fotografia da opção aceita, editável
   ========================================================================== */

function ResumoCard({
  venda,
  onPatched,
}: {
  venda: VendaResumo;
  onPatched: (patch: Partial<VendaResumo>) => void;
}) {
  const margem = margemCents(venda);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Resumo</CardTitle>
      </CardHeader>
      <CardBody>
        <TextAutoField
          label="Fornecedor"
          optional
          initialValue={venda.fornecedor ?? ""}
          placeholder="Nome da operadora"
          onSave={async (value) => {
            const result = await atualizarVenda(venda.id, { fornecedor: value });
            if (result.ok) onPatched({ fornecedor: value || null });
            return result;
          }}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <CentsAutoField
            label="Valor bruto"
            initialCents={venda.valorBrutoCents}
            onSave={async (cents) => {
              const result = await atualizarVenda(venda.id, { valorBrutoCents: cents });
              if (result.ok) onPatched({ valorBrutoCents: cents });
              return result;
            }}
          />
          <CentsAutoField
            label="Custo"
            initialCents={venda.custoCents}
            onSave={async (cents) => {
              const result = await atualizarVenda(venda.id, { custoCents: cents });
              if (result.ok) onPatched({ custoCents: cents });
              return result;
            }}
          />
          <CentsAutoField
            label="Comissão prevista"
            initialCents={venda.comissaoPrevistaCents}
            onSave={async (cents) => {
              const result = await atualizarVenda(venda.id, { comissaoPrevistaCents: cents });
              if (result.ok) onPatched({ comissaoPrevistaCents: cents });
              return result;
            }}
          />
          <CentsAutoField
            label="Taxa de serviço"
            initialCents={venda.taxaServicoCents}
            onSave={async (cents) => {
              const result = await atualizarVenda(venda.id, { taxaServicoCents: cents });
              if (result.ok) onPatched({ taxaServicoCents: cents });
              return result;
            }}
          />
        </div>

        <MoneyStat
          label="Margem (comissão + taxa de serviço)"
          cents={margem}
          size="20"
          tone="accent"
          align="left"
          className="mt-1"
        />
      </CardBody>
    </Card>
  );
}

/** Campo de texto com autosave no blur — igual ao de `ContatoScreen`. */
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
    <Field invalid={state === "error"} className="mb-4">
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
    <Field invalid={state === "error"}>
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
   Comissão — a conferência manual (prevista → recebida/atrasada)
   ========================================================================== */

function ComissaoCard({
  venda,
  onPatched,
}: {
  venda: VendaResumo;
  onPatched: (patch: Partial<VendaResumo>) => void;
}) {
  const { state, commit } = useAutosave(async (status: ComissaoStatus) => {
    const result = await atualizarStatusComissao(venda.id, status);
    if (result.ok) onPatched({ comissaoStatus: status });
    return result;
  });

  return (
    <Card tone={venda.comissaoStatus === "atrasada" ? "warn" : "default"}>
      <CardHeader>
        <CardTitle>Comissão da operadora</CardTitle>
      </CardHeader>
      <CardBody>
        <p className="text-13 text-muted">
          Não é um fluxo travado — dá para voltar de &ldquo;recebida&rdquo; para
          &ldquo;prevista&rdquo; se marcar errado. É conferência de extrato, não aprovação.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={COMISSAO_STATUS_TONE[venda.comissaoStatus]} size="md" dot>
            {COMISSAO_STATUS_LABEL[venda.comissaoStatus]}
          </Badge>
          <div className="flex items-center gap-2">
            <Select value={venda.comissaoStatus} onValueChange={(value) => void commit(value as ComissaoStatus)}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMISSAO_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {COMISSAO_STATUS_LABEL[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SavedMark state={state} />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

/* =============================================================================
   Parcelas — o que falta o cliente pagar
   ========================================================================== */

type ParcelasStatus = "loading" | "ready" | "error";

function ParcelasCard({ venda }: { venda: VendaResumo }) {
  const toast = useToast();
  const [status, setStatus] = React.useState<ParcelasStatus>("loading");
  const [parcelas, setParcelas] = React.useState<ParcelaResumo[]>([]);
  const [gerarOpen, setGerarOpen] = React.useState(false);
  const [novaOpen, setNovaOpen] = React.useState(false);

  const [reloadToken, setReloadToken] = React.useState(0);
  const reload = React.useCallback(() => setReloadToken((token) => token + 1), []);

  React.useEffect(() => {
    let active = true;
    void listarParcelas(venda.id).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        return;
      }
      setParcelas(result.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [venda.id, reloadToken]);

  const scheduleDelete = useDeferredDelete<ParcelaResumo>({
    label: (item) => `Parcela removida: ${formatVencimento(item.venceEm)}`,
    commit: (item) => excluirParcela(item.id),
    onFailure: (item, mensagem) => {
      toast.show({ title: "Não consegui remover a parcela", description: mensagem, tone: "danger" });
      reload();
    },
  });

  function handleRemove(parcela: ParcelaResumo) {
    setParcelas((current) => current.filter((p) => p.id !== parcela.id));
    scheduleDelete(parcela);
  }

  function handleUpdated(updated: ParcelaResumo) {
    setParcelas((current) => current.map((p) => (p.id === updated.id ? updated : p)));
  }

  async function handleMarkPaid(parcela: ParcelaResumo) {
    const result = await marcarParcelaPaga(parcela.id);
    if (!result.ok) {
      toast.show({ title: "Não consegui marcar como paga", description: result.mensagem, tone: "danger" });
      return;
    }
    handleUpdated(result.data);
    toast.show({ title: `Parcela de ${formatVencimento(parcela.venceEm)} marcada como paga`, tone: "ok" });
  }

  const totalPendente = parcelas
    .filter((p) => p.status === "pendente" || p.status === "atrasado")
    .reduce((sum, p) => sum + p.valorCents, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Parcelas</CardTitle>
      </CardHeader>
      <CardBody flush={status !== "ready" || parcelas.length === 0}>
        {status === "loading" ? (
          <div className="flex flex-col gap-4 p-4">
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : status === "error" ? (
          <div className="flex flex-col items-start gap-3 p-4">
            <FieldError>Não consegui carregar as parcelas.</FieldError>
            <Button variant="secondary" size="sm" onClick={reload}>
              Tentar de novo
            </Button>
          </div>
        ) : parcelas.length === 0 ? (
          <EmptyState
            compact
            title="Nenhuma parcela gerada"
            description="Divida o valor bruto em parcelas mensais iguais, ou monte manualmente (útil quando tem entrada maior)."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line-subtle">
            {parcelas.map((parcela) => (
              <ParcelaRow
                key={parcela.id}
                parcela={parcela}
                onRemoved={() => handleRemove(parcela)}
                onMarkPaid={() => void handleMarkPaid(parcela)}
              />
            ))}
          </ul>
        )}
      </CardBody>
      <CardFooter
        secondary={
          parcelas.length === 0 ? (
            <CardAction onClick={() => setGerarOpen(true)}>Gerar parcelas mensais</CardAction>
          ) : undefined
        }
        action={
          <Button variant="secondary" size="sm" onClick={() => setNovaOpen(true)}>
            <PlusIcon className="size-4" />
            Adicionar parcela
          </Button>
        }
      >
        {parcelas.length > 0 ? (
          <span>
            Em aberto: <Money cents={totalPendente} size="13" tone="muted" reserveFor={venda.valorBrutoCents} />
          </span>
        ) : null}
      </CardFooter>

      <GerarParcelasSheet
        open={gerarOpen}
        onOpenChange={setGerarOpen}
        vendaId={venda.id}
        onCreated={(criadas) => {
          setParcelas(criadas);
          setGerarOpen(false);
        }}
      />
      <NovaParcelaSheet
        open={novaOpen}
        onOpenChange={setNovaOpen}
        vendaId={venda.id}
        onCreated={(parcela) => {
          setParcelas((current) => [...current, parcela].sort((a, b) => a.venceEm.localeCompare(b.venceEm)));
          setNovaOpen(false);
        }}
      />
    </Card>
  );
}

function ParcelaRow({
  parcela,
  onRemoved,
  onMarkPaid,
}: {
  parcela: ParcelaResumo;
  onRemoved: () => void;
  onMarkPaid: () => void;
}) {
  const dias = diasParaVencimento(parcela.venceEm);
  const late = (parcela.status === "pendente" || parcela.status === "atrasado") && dias < 0;
  const canPay = parcela.status === "pendente" || parcela.status === "atrasado";

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2 text-15 text-ink">
          {formatVencimento(parcela.venceEm)}
          <Badge tone={late ? "danger" : PARCELA_STATUS_TONE[parcela.status]} dot>
            {PARCELA_STATUS_LABEL[parcela.status]}
          </Badge>
        </span>
        <span className="text-13 text-muted">{vencimentoLabel(dias)}</span>
      </div>

      <Money cents={parcela.valorCents} size="15" reserveFor={parcela.valorCents} />

      <div className="flex items-center gap-1">
        {canPay ? (
          <CardAction onClick={onMarkPaid}>Marcar paga</CardAction>
        ) : null}
        <CardAction className="text-danger hover:text-danger" onClick={onRemoved}>
          Remover
        </CardAction>
      </div>
    </li>
  );
}

function GerarParcelasSheet({
  open,
  onOpenChange,
  vendaId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendaId: string;
  onCreated: (parcelas: ParcelaResumo[]) => void;
}) {
  const [quantidade, setQuantidade] = React.useState("3");
  const [primeiraVencimento, setPrimeiraVencimento] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<{ campo?: string; mensagem: string } | null>(null);

  React.useEffect(() => {
    if (!open) {
      setQuantidade("3");
      setPrimeiraVencimento("");
      setFieldError(null);
    }
  }, [open]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setFieldError(null);
    const result = await gerarParcelasDaVenda(vendaId, {
      quantidade: Number(quantidade) || 0,
      primeiraVencimento,
    });
    setCreating(false);
    if (!result.ok) {
      setFieldError({ campo: result.campo, mensagem: result.mensagem });
      return;
    }
    onCreated(result.data);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        open={open}
        onOpenChange={onOpenChange}
        title="Gerar parcelas mensais"
        description="Divide o valor bruto em N parcelas iguais — a última absorve o resto em centavos."
        footer={
          <Button
            variant="primary"
            block
            type="submit"
            form="gerar-parcelas-form"
            loading={creating}
            disabled={!primeiraVencimento || Number(quantidade) < 1}
          >
            Gerar parcelas
          </Button>
        }
      >
        <form id="gerar-parcelas-form" onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <Field invalid={fieldError?.campo === "quantidade"}>
            <Label>Quantidade de parcelas</Label>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={24}
              value={quantidade}
              onChange={(event) => setQuantidade(event.target.value)}
            />
            {fieldError?.campo === "quantidade" ? <FieldError>{fieldError.mensagem}</FieldError> : null}
          </Field>
          <Field invalid={fieldError?.campo === "primeiraVencimento"}>
            <Label>Primeiro vencimento</Label>
            <Input
              type="date"
              value={primeiraVencimento}
              onChange={(event) => setPrimeiraVencimento(event.target.value)}
            />
            {fieldError?.campo === "primeiraVencimento" ? (
              <FieldError>{fieldError.mensagem}</FieldError>
            ) : null}
          </Field>
          {fieldError && !fieldError.campo ? <FieldError>{fieldError.mensagem}</FieldError> : null}
        </form>
      </SheetContent>
    </Sheet>
  );
}

function NovaParcelaSheet({
  open,
  onOpenChange,
  vendaId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendaId: string;
  onCreated: (parcela: ParcelaResumo) => void;
}) {
  const [venceEm, setVenceEm] = React.useState("");
  const [valor, setValor] = React.useState<number | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<{ campo?: string; mensagem: string } | null>(null);

  React.useEffect(() => {
    if (!open) {
      setVenceEm("");
      setValor(null);
      setFieldError(null);
    }
  }, [open]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setFieldError(null);
    const result = await criarParcela(vendaId, { venceEm, valorCents: valor ?? 0 });
    setCreating(false);
    if (!result.ok) {
      setFieldError({ campo: result.campo, mensagem: result.mensagem });
      return;
    }
    onCreated(result.data);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        open={open}
        onOpenChange={onOpenChange}
        title="Adicionar parcela"
        description="Para parcelamento manual — entrada maior, ou uma parcela avulsa."
        footer={
          <Button
            variant="primary"
            block
            type="submit"
            form="nova-parcela-form"
            loading={creating}
            disabled={!venceEm || !valor}
          >
            Adicionar
          </Button>
        }
      >
        <form id="nova-parcela-form" onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <Field invalid={fieldError?.campo === "venceEm"}>
            <Label>Vencimento</Label>
            <Input type="date" value={venceEm} onChange={(event) => setVenceEm(event.target.value)} />
            {fieldError?.campo === "venceEm" ? <FieldError>{fieldError.mensagem}</FieldError> : null}
          </Field>
          <Field invalid={fieldError?.campo === "valorCents"}>
            <Label>Valor</Label>
            <CentsInput cents={valor} onCommit={setValor} invalid={fieldError?.campo === "valorCents"} />
            {fieldError?.campo === "valorCents" ? <FieldError>{fieldError.mensagem}</FieldError> : null}
          </Field>
          {fieldError && !fieldError.campo ? <FieldError>{fieldError.mensagem}</FieldError> : null}
        </form>
      </SheetContent>
    </Sheet>
  );
}

/* =============================================================================
   Encerramento — excluir venda (sem endpoint de restauração, ver
   `useDeferredDelete`). O servidor já recusa (`CONFLITO`) se existir parcela
   paga — o `onFailure` é onde esse aviso chega, e o mesmo texto de correção
   que o contrato manda vira o botão junto do erro.
   ========================================================================== */

function EncerramentoCard({ venda }: { venda: VendaResumo }) {
  const router = useRouter();
  const toast = useToast();

  const scheduleDelete = useDeferredDelete<VendaResumo>({
    label: (item) => `Venda excluída: ${item.fornecedor ?? "sem fornecedor"}`,
    commit: (item) => excluirVenda(item.id),
    onFailure: (item, mensagem, correcao) => {
      toast.show({
        title: "Não consegui excluir a venda",
        description: mensagem,
        tone: "danger",
        action: correcao ? { label: "Ver venda", onClick: () => router.push(`/vendas/${item.id}`) } : undefined,
      });
    },
  });

  function handleDelete() {
    scheduleDelete(venda);
    router.push("/vendas");
  }

  return (
    <Card tone="inset">
      <CardHeader>
        <CardTitle>Encerramento</CardTitle>
      </CardHeader>
      <CardBody flush>
        <p className="px-4 pt-4 text-13 text-muted">
          Excluir apaga a venda e as parcelas em aberto. Se houver parcela já paga, a
          exclusão é recusada — cancele as parcelas em aberto primeiro.
        </p>
      </CardBody>
      <CardFooter
        action={
          <CardAction className="text-danger hover:text-danger" onClick={handleDelete}>
            Excluir venda
          </CardAction>
        }
      />
    </Card>
  );
}
