"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  listarVendas,
  type ComissaoStatus,
  type PeriodoInput,
  type VendaResumo,
} from "@/server";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { Rule } from "@/components/plates";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { MoneyHubTabs } from "@/components/app/MoneyHubTabs";
import {
  PeriodoInvalidoCard,
  PeriodoSeletor,
} from "@/components/app/PeriodoSeletor";
import { cn } from "@/lib/ui/cn";
import { formatDayMonth } from "@/lib/ui/format";
import { parseParamPeriodo } from "@/lib/ui/periodo";
import {
  COMISSAO_STATUS_LABEL,
  COMISSAO_STATUS_OPTIONS,
  COMISSAO_STATUS_TONE,
  margemCents,
} from "./shared";

/* =============================================================================
   Vendas — a lista
   -----------------------------------------------------------------------------
   Registro silencioso: papel, fio entre linhas, uma cor de destaque. A régua
   completa (custo, comissão prevista, taxa de serviço) mora no DETALHE —
   aqui na lista só os dois números que decidem alguma coisa de imediato:
   quanto o cliente pagou e quanto a agente embolsa (comissão + taxa). Seis
   colunas tabulares cabendo em 390px viraria tabela rolando de lado, e uma
   tabela financeira que precisa de scroll horizontal no celular é pior que
   duas linhas com hierarquia clara.

   "Gerar venda" não mora aqui — fica no editor da proposta aceita
   (`/propostas/[id]/editar`), porque é lá que a conversão faz sentido: uma
   venda nasce de UMA proposta específica, não de um formulário solto.
   ========================================================================== */

type Status = "loading" | "ready" | "error";
type Filtro = ComissaoStatus | "todas";

export function VendasScreen({ periodoParam }: { periodoParam?: string }) {
  const router = useRouter();
  const [filtro, setFiltro] = React.useState<Filtro>("todas");
  const [status, setStatus] = React.useState<Status>("loading");
  const [vendas, setVendas] = React.useState<VendaResumo[]>([]);
  const [errorInfo, setErrorInfo] = React.useState<{ mensagem: string; correcao?: string } | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const retry = React.useCallback(() => setReloadToken((token) => token + 1), []);

  // O recorte de leitura mora na URL (`?periodo=...`) — o §1. A lista segue
  // o período E o filtro de comissão juntos (`FiltroVendas` aceita os dois).
  const periodo = React.useMemo(() => parseParamPeriodo(periodoParam), [periodoParam]);
  const periodoInput: PeriodoInput | undefined = periodo.ok ? periodo.input : undefined;
  const periodoKey = periodoParam ?? "";

  React.useEffect(() => {
    let active = true;
    setStatus((current) => (current === "ready" ? current : "loading"));
    const filtroBase = filtro === "todas" ? {} : { comissaoStatus: filtro };
    void listarVendas({ ...filtroBase, periodo: periodoInput }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setErrorInfo({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setVendas(result.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `periodoInput` é derivado de `periodoKey`
  }, [filtro, periodoKey, reloadToken]);

  // Molde de largura comum às duas colunas numéricas: sem isto, cada linha
  // reserva a própria largura e a coluna perde o alinhamento vertical.
  const maxBruto = Math.max(1, ...vendas.map((v) => v.valorBrutoCents));
  const maxMargem = Math.max(1, ...vendas.map((v) => margemCents(v)));

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="display text-32 text-ink">Vendas</h2>
          <Link
            href="/cobranca"
            className="shrink-0 pb-1 text-13 font-medium text-muted hover:text-ink"
          >
            Plano e cobrança
          </Link>
        </div>
        <MoneyHubTabs periodoParam={periodoParam} />
      </header>

      {/* O recorte de leitura — §1, mesmo seletor do /hoje e das outras tabs
          do hub. Param inválido: aviso com correção, e a lista segue no mês
          corrente. */}
      {periodo.ok ? (
        <PeriodoSeletor param={periodoParam} className="-mt-3" />
      ) : (
        <PeriodoInvalidoCard />
      )}

      <div role="group" aria-label="Filtrar por status da comissão" className="flex flex-wrap gap-1.5">
        <FiltroChip active={filtro === "todas"} onClick={() => setFiltro("todas")}>
          Todas
        </FiltroChip>
        {COMISSAO_STATUS_OPTIONS.map((option) => (
          <FiltroChip key={option} active={filtro === option} onClick={() => setFiltro(option)}>
            {COMISSAO_STATUS_LABEL[option]}
          </FiltroChip>
        ))}
      </div>

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
      ) : vendas.length === 0 ? (
        <EmptyState
          plate
          title={
            periodoInput
              ? "Nenhuma venda neste período"
              : filtro === "todas"
                ? "Nenhuma venda ainda"
                : "Nenhuma venda com esse status"
          }
          description={
            periodoInput
              ? "Troque o período acima para olhar outra janela — ou gere uma venda a partir de uma proposta aceita."
              : filtro === "todas"
                ? "Uma venda nasce quando o cliente aceita uma proposta: abra a proposta aceita e gere a venda por lá — fornecedor, valor, custo e comissão vêm fotografados da opção aceita."
                : "Mude o filtro ou espere a conferência de comissão avançar."
          }
          preview={
            <Card className="flex items-center justify-between gap-3 p-3">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-15 font-medium text-ink">CVC Noronha</span>
                <span className="text-13 text-muted">fechada 12 mar</span>
              </span>
              <span className="flex flex-col items-end gap-0.5">
                <Money cents={594_000} size="15" reserveFor={594_000} />
                <Money cents={89_100} size="13" tone="accent" reserveFor={594_000} />
              </span>
            </Card>
          }
        />
      ) : (
        <Card className="flex flex-col p-1">
          {vendas.map((venda, index) => (
            <React.Fragment key={venda.id}>
              {index > 0 ? <Rule inner /> : null}
              <VendaRow
                venda={venda}
                reserveFor={maxBruto}
                reserveForMargem={maxMargem}
                onOpen={() => router.push(`/vendas/${venda.id}`)}
              />
            </React.Fragment>
          ))}
        </Card>
      )}
    </div>
  );
}

function VendaRow({
  venda,
  reserveFor,
  reserveForMargem,
  onOpen,
}: {
  venda: VendaResumo;
  reserveFor: number;
  reserveForMargem: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex min-h-14 w-full items-center gap-3 rounded-md px-3 py-2.5 text-left",
        "hover:bg-surface-2",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate text-15 font-medium text-ink">
            {venda.fornecedor ?? "Sem fornecedor"}
          </span>
          <Badge tone={COMISSAO_STATUS_TONE[venda.comissaoStatus]}>
            {COMISSAO_STATUS_LABEL[venda.comissaoStatus]}
          </Badge>
        </span>
        <span className="text-13 text-muted">
          fechada {formatDayMonth(new Date(venda.createdAt))}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <Money cents={venda.valorBrutoCents} size="15" reserveFor={reserveFor} />
        <Money
          cents={margemCents(venda)}
          size="13"
          tone="accent"
          reserveFor={reserveForMargem}
        />
      </span>
    </button>
  );
}

/** Chip de filtro — `aria-pressed`, não uma segunda hierarquia de "abas" fake
 * sem painel correspondente (por isso não é `<Tabs>`: aqui não existe um
 * `TabsContent` por status, é a MESMA lista filtrada). */
function FiltroChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onPointerDown={onClick}
      className={cn(
        "min-h-9 rounded-pill px-3 text-13 font-medium",
        active ? "bg-accent-soft text-accent-soft-ink" : "bg-surface-2 text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
