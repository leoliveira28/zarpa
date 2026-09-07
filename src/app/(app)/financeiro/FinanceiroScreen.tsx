"use client";

import * as React from "react";
import Link from "next/link";
import {
  atualizarStatusComissao,
  listarParcelas,
  listarVendas,
  marcarParcelaPaga,
  type ComissaoStatus,
  type ParcelaResumo,
  type VendaResumo,
} from "@/server";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardAction, SectionHeading } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money, MoneyStat } from "@/components/ui/Money";
import { Rule } from "@/components/plates";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { MoneyHubTabs } from "@/components/app/MoneyHubTabs";
import { cn } from "@/lib/ui/cn";
import {
  COMISSAO_STATUS_LABEL,
  COMISSAO_STATUS_OPTIONS,
  COMISSAO_STATUS_TONE,
  PARCELA_STATUS_LABEL,
  PARCELA_STATUS_TONE,
  diasParaVencimento,
  formatVencimento,
  vencimentoLabel,
} from "../vendas/shared";

/* =============================================================================
   Financeiro — recebíveis do cliente + conferência de comissão da operadora
   -----------------------------------------------------------------------------
   O contrato de servidor não tem uma listagem "todas as parcelas do tenant" —
   só `listarParcelas(vendaId)`, por venda. Para o volume de um agente
   independente (10-15 vendas/mês) buscar `listarVendas` e depois as parcelas
   de cada uma em paralelo é uma tela, não um problema de escala; um endpoint
   agregado fica registrado como pedido a Rafa quando o volume justificar
   (ver docs/status/nina.md).

   Duas perguntas, duas seções, cada uma com sua cornija:
     1. "A receber" — o que falta o CLIENTE pagar, atraso primeiro.
     2. "Comissão da operadora" — o que falta o FORNECEDOR pagar À AGENTE.
   São dois fluxos de dinheiro diferentes, e confundi-los na mesma lista é
   o tipo de erro que só aparece quando já é tarde para reconciliar o mês.
   ========================================================================== */

type Status = "loading" | "ready" | "error";

type ParcelaComVenda = ParcelaResumo & { venda: VendaResumo };

export function FinanceiroScreen() {
  const [status, setStatus] = React.useState<Status>("loading");
  const [vendas, setVendas] = React.useState<VendaResumo[]>([]);
  const [parcelas, setParcelas] = React.useState<ParcelaComVenda[]>([]);
  const [errorInfo, setErrorInfo] = React.useState<{ mensagem: string; correcao?: string } | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const retry = React.useCallback(() => setReloadToken((token) => token + 1), []);

  React.useEffect(() => {
    let active = true;
    setStatus((current) => (current === "ready" ? current : "loading"));

    void listarVendas({ limite: 200 }).then(async (result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setErrorInfo({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }

      const vendasList = result.data;
      const porVenda = await Promise.all(
        vendasList.map(async (venda) => {
          const r = await listarParcelas(venda.id);
          return r.ok ? r.data.map((p) => ({ ...p, venda })) : [];
        }),
      );
      if (!active) return;
      setVendas(vendasList);
      setParcelas(porVenda.flat());
      setStatus("ready");
    });

    return () => {
      active = false;
    };
  }, [reloadToken]);

  function patchVenda(id: string, update: Partial<VendaResumo>) {
    setVendas((current) => current.map((v) => (v.id === id ? { ...v, ...update } : v)));
  }

  function patchParcela(updated: ParcelaResumo) {
    setParcelas((current) => current.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="display text-32 text-ink">Financeiro</h2>
          <Link
            href="/cobranca"
            className="shrink-0 pb-1 text-13 font-medium text-muted hover:text-ink"
          >
            Plano e cobrança
          </Link>
        </div>
        <MoneyHubTabs />
      </header>

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
      ) : (
        <>
          <RecebiveisSection parcelas={parcelas} onUpdated={patchParcela} />
          <ComissaoSection vendas={vendas} onPatched={patchVenda} />
        </>
      )}
    </div>
  );
}

/* =============================================================================
   A receber — parcelas do cliente, atraso primeiro
   ========================================================================== */

function RecebiveisSection({
  parcelas,
  onUpdated,
}: {
  parcelas: ParcelaComVenda[];
  onUpdated: (parcela: ParcelaResumo) => void;
}) {
  const toast = useToast();
  const [showSettled, setShowSettled] = React.useState(false);

  const open = parcelas
    .filter((p) => p.status === "pendente" || p.status === "atrasado")
    .sort((a, b) => a.venceEm.localeCompare(b.venceEm));
  const settled = parcelas.filter((p) => p.status === "pago" || p.status === "cancelado");

  const overdue = open.filter((p) => diasParaVencimento(p.venceEm) < 0).length;
  const totalOpen = open.reduce((sum, p) => sum + p.valorCents, 0);

  async function handleMarkPaid(parcela: ParcelaComVenda) {
    const result = await marcarParcelaPaga(parcela.id);
    if (!result.ok) {
      toast.show({ title: "Não consegui marcar como paga", description: result.mensagem, tone: "danger" });
      return;
    }
    onUpdated(result.data);
    toast.show({ title: `Parcela de ${formatVencimento(parcela.venceEm)} marcada como paga`, tone: "ok" });
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading
        action={
          overdue > 0 ? (
            <Badge tone="danger" dot>
              {overdue} {overdue === 1 ? "atrasada" : "atrasadas"}
            </Badge>
          ) : undefined
        }
      >
        A receber
      </SectionHeading>

      {open.length === 0 ? (
        <EmptyState
          compact
          title="Nada a receber em aberto"
          description="Parcelas geradas em cada venda aparecem aqui, atraso primeiro."
        />
      ) : (
        <Card className="flex flex-col p-1">
          {open.map((parcela, index) => (
            <React.Fragment key={parcela.id}>
              {index > 0 ? <Rule inner /> : null}
              <RecebivelRow parcela={parcela} onMarkPaid={() => void handleMarkPaid(parcela)} />
            </React.Fragment>
          ))}
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {open.length > 0 ? (
          <MoneyStat label="Total em aberto" cents={totalOpen} size="17" align="left" />
        ) : (
          <span />
        )}
        {settled.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowSettled((current) => !current)}
            className="text-13 font-medium text-muted hover:text-ink"
          >
            {showSettled ? "Ocultar acertadas" : `Mostrar acertadas (${settled.length})`}
          </button>
        ) : null}
      </div>

      {showSettled && settled.length > 0 ? (
        <Card className="flex flex-col p-1 opacity-70">
          {settled.map((parcela, index) => (
            <React.Fragment key={parcela.id}>
              {index > 0 ? <Rule inner /> : null}
              <RecebivelRow parcela={parcela} />
            </React.Fragment>
          ))}
        </Card>
      ) : null}
    </section>
  );
}

function RecebivelRow({
  parcela,
  onMarkPaid,
}: {
  parcela: ParcelaComVenda;
  onMarkPaid?: () => void;
}) {
  const dias = diasParaVencimento(parcela.venceEm);
  const late = (parcela.status === "pendente" || parcela.status === "atrasado") && dias < 0;

  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2 text-15 text-ink">
          <Link
            href={`/vendas/${parcela.venda.id}`}
            className="truncate font-medium hover:underline"
          >
            {parcela.venda.fornecedor ?? "Sem fornecedor"}
          </Link>
          <Badge tone={late ? "danger" : PARCELA_STATUS_TONE[parcela.status]} dot>
            {PARCELA_STATUS_LABEL[parcela.status]}
          </Badge>
        </span>
        <span className="text-13 text-muted">
          {formatVencimento(parcela.venceEm)} · {vencimentoLabel(dias)}
        </span>
      </div>

      <Money cents={parcela.valorCents} size="15" reserveFor={parcela.valorCents} />

      {onMarkPaid ? <CardAction onClick={onMarkPaid}>Marcar paga</CardAction> : null}
    </div>
  );
}

/* =============================================================================
   Comissão da operadora — o que já entrou, o que está prevista, o que atrasou
   ========================================================================== */

function ComissaoSection({
  vendas,
  onPatched,
}: {
  vendas: VendaResumo[];
  onPatched: (id: string, update: Partial<VendaResumo>) => void;
}) {
  const totals = COMISSAO_STATUS_OPTIONS.map((option) => ({
    status: option,
    vendas: vendas.filter((v) => v.comissaoStatus === option),
  }));

  const ordered = [...vendas].sort((a, b) => {
    // atrasada primeiro, depois prevista, depois recebida — a mesma ordem em
    // que a agente precisa AGIR, não a ordem alfabética do enum
    const order: Record<ComissaoStatus, number> = { atrasada: 0, prevista: 1, recebida: 2 };
    return order[a.comissaoStatus] - order[b.comissaoStatus];
  });

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading>Comissão da operadora</SectionHeading>

      {vendas.length === 0 ? (
        <EmptyState
          compact
          title="Nenhuma comissão para conferir"
          description="Assim que uma venda for gerada a partir de uma proposta aceita, a comissão prevista aparece aqui."
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {totals.map(({ status, vendas: group }) => (
              <Card key={status} tone={status === "atrasada" && group.length > 0 ? "warn" : "default"} className="p-3">
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-13 font-medium text-muted">
                    <Badge tone={COMISSAO_STATUS_TONE[status]} dot size="sm" />
                    {COMISSAO_STATUS_LABEL[status]}
                  </span>
                  <Money
                    cents={group.reduce((sum, v) => sum + v.comissaoPrevistaCents, 0)}
                    size="20"
                    align="left"
                    reserveFor={Math.max(1, ...vendas.map((v) => v.comissaoPrevistaCents))}
                  />
                  <span className="text-13 tabular-nums text-muted">
                    {group.length} {group.length === 1 ? "venda" : "vendas"}
                  </span>
                </span>
              </Card>
            ))}
          </div>

          <Card className="flex flex-col p-1">
            {ordered.map((venda, index) => (
              <React.Fragment key={venda.id}>
                {index > 0 ? <Rule inner /> : null}
                <ComissaoRow venda={venda} onPatched={onPatched} />
              </React.Fragment>
            ))}
          </Card>
        </>
      )}
    </section>
  );
}

function ComissaoRow({
  venda,
  onPatched,
}: {
  venda: VendaResumo;
  onPatched: (id: string, update: Partial<VendaResumo>) => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = React.useState(false);

  async function handleChange(status: ComissaoStatus) {
    setSaving(true);
    const result = await atualizarStatusComissao(venda.id, status);
    setSaving(false);
    if (!result.ok) {
      toast.show({ title: "Não consegui atualizar", description: result.mensagem, tone: "danger" });
      return;
    }
    onPatched(venda.id, { comissaoStatus: status });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          href={`/vendas/${venda.id}`}
          className="truncate text-15 font-medium text-ink hover:underline"
        >
          {venda.fornecedor ?? "Sem fornecedor"}
        </Link>
        <span className="text-13 text-muted">
          venda de <Money cents={venda.valorBrutoCents} size="13" tone="muted" still />
        </span>
      </div>

      <Money cents={venda.comissaoPrevistaCents} size="15" reserveFor={venda.comissaoPrevistaCents} />

      <Select
        value={venda.comissaoStatus}
        onValueChange={(value) => void handleChange(value as ComissaoStatus)}
      >
        <SelectTrigger size="sm" className={cn("w-36", saving && "opacity-70")}>
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
    </div>
  );
}
