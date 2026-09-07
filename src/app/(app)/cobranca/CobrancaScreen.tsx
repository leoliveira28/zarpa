"use client";

import * as React from "react";
import {
  cancelarAssinatura,
  listarFaturas,
  listarPlanos,
  obterAssinaturaAtual,
  trocarPlano,
  type AssinaturaAtual,
  type FaturaResumo,
  type PlanoResumo,
  type StatusAssinatura,
  type StatusFatura,
  type TrocarPlanoInput,
} from "@/server";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardAction, CardBody, CardFooter, CardHeader, CardTitle, SectionHeading } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { Rule } from "@/components/plates";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Skeleton, SkeletonRow } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { avisarAssinaturaRegularizada } from "@/lib/ui/assinatura";
import { useDeferredDelete } from "@/lib/ui/useDeferredDelete";
import { formatDayMonth } from "@/lib/ui/format";

/* =============================================================================
   Cobrança — assinatura e faturas
   -----------------------------------------------------------------------------
   Registro silencioso: papel, fio entre seções, uma cor de destaque. O azul do
   accent aparece uma vez por tela — no botão que diz onde clicar para trocar
   de plano. O restante é tinta sobre papel, status em Badge (cor de estado, não
   de marca) e valor em Money com tabular-nums e largura reservada.

   Sem enforcement/paywall: a tela mostra e deixa a agente trocar/cancelar.
   Trial de quantos dias, dunning — decisões de produto em aberto, não nossas.
   ========================================================================== */

type Status = "loading" | "ready" | "error";
type BillingType = "PIX" | "CREDIT_CARD" | "BOLETO";

const STATUS_ASSINATURA_LABEL: Record<StatusAssinatura, string> = {
  trialing: "Em trial",
  active: "Ativa",
  past_due: "Pagamento atrasado",
  canceled: "Cancelada",
};

const STATUS_ASSINATURA_TONE: Record<
  StatusAssinatura,
  "neutral" | "accent" | "ok" | "warn" | "danger"
> = {
  trialing: "accent",
  active: "ok",
  past_due: "danger",
  canceled: "neutral",
};

const STATUS_FATURA_LABEL: Record<StatusFatura, string> = {
  pending: "Pendente",
  paid: "Paga",
  overdue: "Atrasada",
  refunded: "Reembolsada",
};

const STATUS_FATURA_TONE: Record<
  StatusFatura,
  "neutral" | "accent" | "ok" | "warn" | "danger"
> = {
  pending: "neutral",
  paid: "ok",
  overdue: "danger",
  refunded: "neutral",
};

const METODO_LABEL: Record<NonNullable<FaturaResumo["method"]>, string> = {
  pix: "Pix",
  credit_card: "Cartão",
  boleto: "Boleto",
};

const BILLING_LABEL: Record<BillingType, string> = {
  PIX: "Pix",
  CREDIT_CARD: "Cartão",
  BOLETO: "Boleto",
};

export function CobrancaScreen() {
  const [status, setStatus] = React.useState<Status>("loading");
  const [assinatura, setAssinatura] = React.useState<AssinaturaAtual | null>(null);
  const [planos, setPlanos] = React.useState<PlanoResumo[]>([]);
  const [faturas, setFaturas] = React.useState<FaturaResumo[]>([]);
  const [errorInfo, setErrorInfo] = React.useState<{ mensagem: string; correcao?: string } | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const retry = React.useCallback(() => setReloadToken((token) => token + 1), []);
  const toast = useToast();

  const cancelar = useCancelarAssinatura(
    assinatura,
    (nova) => setAssinatura(nova),
    (mensagem) => {
      toast.show({
        title: "Não consegui cancelar a assinatura",
        description: mensagem,
        tone: "danger",
      });
      retry();
    },
  );

  React.useEffect(() => {
    let active = true;
    setStatus((current) => (current === "ready" ? current : "loading"));
    Promise.all([obterAssinaturaAtual(), listarPlanos(), listarFaturas()]).then(
      ([resAss, resPlanos, resFat]) => {
        if (!active) return;
        if (!resAss.ok) {
          setStatus("error");
          setErrorInfo({ mensagem: resAss.mensagem, correcao: resAss.correcao });
          return;
        }
        if (!resPlanos.ok) {
          setStatus("error");
          setErrorInfo({ mensagem: resPlanos.mensagem, correcao: resPlanos.correcao });
          return;
        }
        if (!resFat.ok) {
          setStatus("error");
          setErrorInfo({ mensagem: resFat.mensagem, correcao: resFat.correcao });
          return;
        }
        setAssinatura(resAss.data);
        setPlanos(resPlanos.data);
        setFaturas(resFat.data);
        setStatus("ready");
      },
    );
    return () => {
      active = false;
    };
  }, [reloadToken]);

  // Teto de largura para todas as faturas — número que não pula de largura.
  const maxFatura = Math.max(1, ...faturas.map((f) => f.amountCents));
  // Teto de largura para os preços dos planos.
  const maxPlano = Math.max(1, ...planos.map((p) => p.priceCents));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="display text-32 text-ink">Cobrança</h2>
        <p className="text-13 text-muted">
          Seu plano, faturas e cobrança mensal.
        </p>
      </header>

      {status === "loading" ? (
        <CobrancaSkeleton />
      ) : status === "error" ? (
        <Card className="flex flex-col items-start gap-3 p-5">
          <p className="text-15 text-ink">{errorInfo?.mensagem}</p>
          <Button variant="secondary" onClick={retry}>
            {errorInfo?.correcao ?? "Tentar de novo"}
          </Button>
        </Card>
      ) : (
        <>
          <PlanoAtualSection
            assinatura={assinatura}
            maxPlano={maxPlano}
            onCancelar={cancelar}
          />
          <TrocarPlanoSection
            assinatura={assinatura}
            planos={planos}
            maxPlano={maxPlano}
            onAssinaturaChange={(nova) => setAssinatura(nova)}
          />
          <FaturasSection faturas={faturas} reserveFor={maxFatura} />
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- plano atual */

function PlanoAtualSection({
  assinatura,
  maxPlano,
  onCancelar,
}: {
  assinatura: AssinaturaAtual | null;
  maxPlano: number;
  onCancelar: () => void;
}) {
  if (!assinatura || !assinatura.plano) {
    return (
      <section className="flex flex-col gap-3">
        <SectionHeading>Plano atual</SectionHeading>
        <Card>
          <CardBody className="gap-2">
            <p className="text-15 font-medium text-ink">Nenhum plano ativo</p>
            <p className="text-13 text-muted">
              Escolha um dos planos abaixo para começar. A cobrança entra em
              vigor quando o pagamento for confirmado.
            </p>
          </CardBody>
        </Card>
      </section>
    );
  }

  const plano = assinatura.plano;
  const periodoInicio = assinatura.currentPeriodStart
    ? formatDayMonth(new Date(assinatura.currentPeriodStart))
    : null;
  const periodoFim = assinatura.currentPeriodEnd
    ? formatDayMonth(new Date(assinatura.currentPeriodEnd))
    : null;

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading>Plano atual</SectionHeading>
      <Card>
        <CardHeader>
          <CardTitle>{plano.name}</CardTitle>
          <Badge tone={STATUS_ASSINATURA_TONE[assinatura.status]} dot>
            {STATUS_ASSINATURA_LABEL[assinatura.status]}
          </Badge>
        </CardHeader>
        <CardBody className="gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-13 font-medium text-muted">Valor mensal</span>
            <Money
              cents={plano.priceCents}
              size="20"
              reserveFor={maxPlano}
              align="left"
            />
          </div>
          {periodoInicio || periodoFim ? (
            <div className="flex flex-col gap-1">
              <span className="text-13 font-medium text-muted">
                Período atual
              </span>
              <span className="text-15 text-ink tabular-nums">
                {[periodoInicio, periodoFim]
                  .filter(Boolean)
                  .join(" → ")}
              </span>
            </div>
          ) : null}
          {assinatura.status === "canceled" && assinatura.canceledAt ? (
            <div className="flex flex-col gap-1">
              <span className="text-13 font-medium text-muted">Cancelada em</span>
              <span className="text-15 text-ink tabular-nums">
                {formatDayMonth(new Date(assinatura.canceledAt))}
              </span>
            </div>
          ) : null}
        </CardBody>
        {assinatura.status !== "canceled" ? (
          <CardFooter
            action={
              <CardAction
                onPointerDown={onCancelar}
                className="text-danger hover:text-danger"
              >
                Cancelar assinatura
              </CardAction>
            }
          >
            <span className="text-13 text-muted">
              O cancelamento entra em vigor no fim do período atual.
            </span>
          </CardFooter>
        ) : null}
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------- trocar plano */

function TrocarPlanoSection({
  assinatura,
  planos,
  maxPlano,
  onAssinaturaChange,
}: {
  assinatura: AssinaturaAtual | null;
  planos: PlanoResumo[];
  maxPlano: number;
  onAssinaturaChange: (nova: AssinaturaAtual | null) => void;
}) {
  const toast = useToast();
  const [billingType, setBillingType] = React.useState<BillingType>("PIX");
  const [pendingPlanId, setPendingPlanId] = React.useState<string | null>(null);

  const planoAtualId = assinatura?.plano?.id ?? null;

  async function handleTrocar(plano: PlanoResumo) {
    if (pendingPlanId) return;
    if (plano.id === planoAtualId) return;
    setPendingPlanId(plano.id);
    const input: TrocarPlanoInput = { planId: plano.id, billingType };
    const result = await trocarPlano(input);
    setPendingPlanId(null);
    if (!result.ok) {
      toast.show({
        title: "Não consegui trocar o plano",
        description: result.mensagem,
        tone: "danger",
        action: result.correcao
          ? { label: result.correcao, onClick: () => handleTrocar(plano) }
          : undefined,
      });
      return;
    }
    onAssinaturaChange(result.data);
    // Conta regularizada: o banner de bloqueio (S13a) sai na hora, em toda
    // tela — sem esperar navegação nem recarga.
    avisarAssinaturaRegularizada(result.data.status);
    toast.show({
      title: `Plano trocado para ${plano.name}`,
      tone: "ok",
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading>
        {assinatura ? "Trocar de plano" : "Escolher um plano"}
      </SectionHeading>

      <Card>
        <CardBody className="gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-13 font-medium text-muted">
              Forma de pagamento
            </span>
            <Select
              value={billingType}
              onValueChange={(v) => setBillingType(v as BillingType)}
            >
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PIX">{BILLING_LABEL.PIX}</SelectItem>
                <SelectItem value="CREDIT_CARD">
                  {BILLING_LABEL.CREDIT_CARD}
                </SelectItem>
                <SelectItem value="BOLETO">{BILLING_LABEL.BOLETO}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-13 text-muted">
              Em desenvolvimento, a forma de pagamento fica registrada como
              intenção — o checkout real entra quando a integração de pagamento
              estiver ativa.
            </p>
          </div>

          <Rule inner />

          <div className="flex flex-col gap-2">
            {planos.map((plano, index) => (
              <React.Fragment key={plano.id}>
                {index > 0 ? <Rule inner /> : null}
                <PlanoRow
                  plano={plano}
                  isAtual={plano.id === planoAtualId}
                  isPending={pendingPlanId === plano.id}
                  maxPlano={maxPlano}
                  onTrocar={() => handleTrocar(plano)}
                />
              </React.Fragment>
            ))}
          </div>
        </CardBody>
      </Card>
    </section>
  );
}

function PlanoRow({
  plano,
  isAtual,
  isPending,
  maxPlano,
  onTrocar,
}: {
  plano: PlanoResumo;
  isAtual: boolean;
  isPending: boolean;
  maxPlano: number;
  onTrocar: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 py-1">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-15 font-semibold text-ink">{plano.name}</span>
            {isAtual ? (
              <Badge tone="accent" dot>
                Plano atual
              </Badge>
            ) : null}
          </div>
          {plano.description ? (
            <p className="text-13 text-muted">{plano.description}</p>
          ) : null}
        </div>
        <Money
          cents={plano.priceCents}
          size="17"
          reserveFor={maxPlano}
          align="right"
        />
      </div>
      {plano.features && plano.features.length > 0 ? (
        <ul className="flex flex-col gap-0.5 pl-1">
          {plano.features.map((feature, i) => (
            <li key={i} className="text-13 text-muted">
              {feature}
            </li>
          ))}
        </ul>
      ) : null}
      {!isAtual ? (
        <Button
          variant="primary"
          size="sm"
          loading={isPending}
          onPointerDown={onTrocar}
          className="self-start"
        >
          {isPending ? "Trocando…" : "Assinar"}
        </Button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- cancelamento */

function useCancelarAssinatura(
  assinatura: AssinaturaAtual | null,
  onReverter: (anterior: AssinaturaAtual) => void,
  onCommitFalhou: (mensagem: string) => void,
) {
  const scheduleCancel = useDeferredDelete<AssinaturaAtual>({
    label: () => "Assinatura cancelada",
    commit: () => cancelarAssinatura(),
    onFailure: (_item, mensagem) => onCommitFalhou(mensagem),
  });

  return React.useCallback(() => {
    if (!assinatura) return;
    const anterior = assinatura;
    // Otimista: mostra como cancelada na hora.
    onReverter({ ...anterior, status: "canceled", canceledAt: new Date() });
    scheduleCancel(anterior);
  }, [assinatura, onReverter, scheduleCancel]);
}

/* ----------------------------------------------------------------- faturas */

function FaturasSection({
  faturas,
  reserveFor,
}: {
  faturas: FaturaResumo[];
  reserveFor: number;
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading>Faturas</SectionHeading>
      {faturas.length === 0 ? (
        <EmptyState
          title="Nenhuma fatura ainda"
          description="As faturas aparecem aqui assim que o primeiro pagamento for processado."
          preview={
            <Card className="flex items-center justify-between gap-3 p-3">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-15 font-medium text-ink">
                  12 set 2026
                </span>
                <span className="text-13 text-muted">Pix</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <Money cents={9900} size="15" reserveFor={reserveFor} />
                <Badge tone="ok">Paga</Badge>
              </span>
            </Card>
          }
        />
      ) : (
        <Card className="flex flex-col p-1">
          {faturas.map((fatura, index) => (
            <React.Fragment key={fatura.id}>
              {index > 0 ? <Rule inner /> : null}
              <FaturaRow fatura={fatura} reserveFor={reserveFor} />
            </React.Fragment>
          ))}
        </Card>
      )}
    </section>
  );
}

function FaturaRow({
  fatura,
  reserveFor,
}: {
  fatura: FaturaResumo;
  reserveFor: number;
}) {
  const data = fatura.dueDate
    ? formatDayMonth(new Date(fatura.dueDate))
    : formatDayMonth(new Date(fatura.createdAt));
  const metodo = fatura.method ? METODO_LABEL[fatura.method] : "—";

  return (
    <div className="flex min-h-14 items-center gap-3 rounded-md px-3 py-2.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate text-15 font-medium text-ink tabular-nums">
            {data}
          </span>
          <Badge tone={STATUS_FATURA_TONE[fatura.status]} dot>
            {STATUS_FATURA_LABEL[fatura.status]}
          </Badge>
        </span>
        <span className="text-13 text-muted">{metodo}</span>
      </span>
      <Money cents={fatura.amountCents} size="15" reserveFor={reserveFor} />
    </div>
  );
}

/* -------------------------------------------------------------- skeleton */

function CobrancaSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <SkeletonRow />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-24 rounded-xs" />
        <Card className="flex flex-col divide-y divide-line-subtle p-1">
          {[0, 1, 2].map((row) => (
            <div key={row} className="p-3">
              <SkeletonRow />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
