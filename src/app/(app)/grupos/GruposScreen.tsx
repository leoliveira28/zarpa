"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  criarGrupo,
  listarGrupos,
  type GrupoResumo,
} from "@/server";
import { avisarRecusaDeEscrita } from "@/lib/ui/assinatura";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldError, FieldHint, Label } from "@/components/ui/Field";
import { CentsInput, Money } from "@/components/ui/Money";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { Input } from "@/components/ui/Input";
import { PlusIcon } from "@/components/app/icons";
import { formatarFaixaDeDatas } from "@/lib/ui/format";

/* =============================================================================
   Grupos — a lista de pacotes com lugares
   -----------------------------------------------------------------------------
   O registro é o da lista de sempre: card de papel, fio entre linhas, o único
   azul onde se clica. O número que manda na linha é a OCUPAÇÃO — "3 de 10
   lugares" é o que a agente veio ver; a margem por lugar é o segundo número.
   ========================================================================== */

const STATUS_LABEL: Record<GrupoResumo["status"], string> = {
  montando: "Montando",
  vendendo: "Vendendo",
  encerrado: "Encerrado",
};

const STATUS_TONE: Record<GrupoResumo["status"], "neutral" | "ok" | "warn"> = {
  montando: "neutral",
  vendendo: "ok",
  encerrado: "warn",
};

export function GruposScreen() {
  const router = useRouter();
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [grupos, setGrupos] = React.useState<GrupoResumo[]>([]);
  const [erro, setErro] = React.useState<{ mensagem: string; correcao?: string } | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [reloadToken, setReloadToken] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    void listarGrupos().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setErro({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setGrupos(result.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h2 className="display text-32 text-ink">Grupos</h2>
          <p className="max-w-[36rem] text-15 leading-[1.5] text-muted">
            O pacote com lugares: você monta a saída, o preço por lugar e vai
            ocupando com os clientes.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setSheetOpen(true)}>
          <PlusIcon className="size-4" />
          Novo grupo
        </Button>
      </header>

      {status === "loading" ? (
        <Card className="p-4">
          <SkeletonRow />
          <div className="mt-3">
            <SkeletonRow />
          </div>
        </Card>
      ) : status === "error" ? (
        <Card className="flex flex-col items-start gap-3 p-5">
          <FieldError>{erro?.mensagem}</FieldError>
          <Button variant="secondary" onClick={() => setReloadToken((t) => t + 1)}>
            {erro?.correcao ?? "Tentar de novo"}
          </Button>
        </Card>
      ) : grupos.length === 0 ? (
        <EmptyState
          plate
          title="Nenhum grupo ainda"
          description="Monte a saída antes de vender: quantos lugares, quanto custa por lugar e por quanto você vende. Os clientes vão ocupando."
          preview={
            <div className="flex items-center gap-3 px-1 py-2 text-13 text-muted">
              <span className="flex-1">Fátima 2027</span>
              <span className="tabular-nums">3 de 10 lugares</span>
              <span className="tabular-nums">R$ 5.500/lugar</span>
            </div>
          }
          action={
            <Button variant="primary" onPointerDown={() => setSheetOpen(true)}>
              <PlusIcon className="size-4" />
              Criar primeiro grupo
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col" data-tour="grupos-lista">
          {grupos.map((grupo) => (
            <li key={grupo.id} className="border-b border-line-subtle last:border-b-0">
              <Link
                href={`/grupos/${grupo.id}`}
                className="flex min-h-11 items-center gap-3 px-1 py-3 hover:bg-surface-2"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-15 font-medium text-ink">{grupo.title}</span>
                  <span className="truncate text-13 text-muted">
                    {grupo.destination ?? "—"}
                    {grupo.departureOn || grupo.returnOn
                      ? ` · ${formatarFaixaDeDatas(grupo.departureOn, grupo.returnOn) ?? ""}`
                      : ""}
                  </span>
                </span>
                <span className="shrink-0 text-13 tabular-nums text-muted">
                  {grupo.lugaresOcupados} de {grupo.totalSeats} lugares
                </span>
                <Money cents={grupo.pricePerSeatCents} size="15" reserveFor={grupo.pricePerSeatCents} />
                <Badge tone={STATUS_TONE[grupo.status]} dot size="sm">
                  {STATUS_LABEL[grupo.status]}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <NovoGrupoSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onCreated={(grupo) => {
          router.push(`/grupos/${grupo.id}`);
        }}
      />
    </div>
  );
}

/* -----------------------------------------------------------------------------
   NovoGrupoSheet — a montagem do pacote: lugares + os quatro números por lugar.
   ------------------------------------------------------------------------- */

function NovoGrupoSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (grupo: GrupoResumo) => void;
}) {
  // Remontagem por key: a cada abertura o formulário nasce novo — sem efeito
  // de reset (a régua da casa: setState síncrono em efeito é bug de arquitetura).
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open ? (
        <NovoGrupoForm key="aberto" onOpenChange={onOpenChange} onCreated={onCreated} />
      ) : null}
    </Sheet>
  );
}

function NovoGrupoForm({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated: (grupo: GrupoResumo) => void;
}) {
  const [title, setTitle] = React.useState("");
  const [destination, setDestination] = React.useState("");
  const [totalSeats, setTotalSeats] = React.useState<number | null>(null);
  const [price, setPrice] = React.useState<number | null>(null);
  const [cost, setCost] = React.useState<number | null>(null);
  const [commission, setCommission] = React.useState<number | null>(null);
  const [fee, setFee] = React.useState<number | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<{ campo?: string; mensagem: string } | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFieldError(null);
    const result = await criarGrupo({
      title,
      destination,
      totalSeats: totalSeats ?? 0,
      pricePerSeatCents: price ?? 0,
      costPerSeatCents: cost ?? 0,
      commissionPerSeatCents: commission ?? 0,
      serviceFeePerSeatCents: fee ?? 0,
    });
    setSaving(false);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      setFieldError({ campo: result.campo, mensagem: result.mensagem });
      return;
    }
    onCreated(result.data);
  }

  return (
    <>
      <SheetContent
        open
        onOpenChange={onOpenChange}
        title="Novo grupo"
        description="Monte o pacote: lugares, custo e preço por lugar. Os clientes vão ocupar depois."
        footer={
          <Button
            variant="primary"
            block
            type="submit"
            form="novo-grupo-form"
            loading={saving}
            disabled={!title.trim() || !totalSeats}
          >
            Criar grupo
          </Button>
        }
      >
        <form id="novo-grupo-form" onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <Field invalid={fieldError?.campo === "title"}>
            <Label>Título</Label>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Fátima 2027"
            />
            {fieldError?.campo === "title" ? <FieldError>{fieldError.mensagem}</FieldError> : null}
          </Field>
          <Field invalid={fieldError?.campo === "destination"}>
            <Label optional>Destino</Label>
            <Input
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder="Portugal"
            />
          </Field>
          <Field invalid={fieldError?.campo === "totalSeats"}>
            <Label>Lugares</Label>
            <Input
              type="number"
              min={1}
              max={500}
              inputMode="numeric"
              value={totalSeats ?? ""}
              onChange={(event) =>
                setTotalSeats(event.target.value === "" ? null : Number(event.target.value))
              }
            />
            {fieldError?.campo === "totalSeats" ? (
              <FieldError>{fieldError.mensagem}</FieldError>
            ) : null}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field invalid={fieldError?.campo === "pricePerSeatCents"}>
              <Label>Preço por lugar</Label>
              <CentsInput cents={price} onCommit={setPrice} invalid={fieldError?.campo === "pricePerSeatCents"} />
            </Field>
            <Field invalid={fieldError?.campo === "costPerSeatCents"}>
              <Label optional>Custo por lugar</Label>
              <FieldHint>voo + hospedagem + transfer</FieldHint>
              <CentsInput cents={cost} onCommit={setCost} invalid={fieldError?.campo === "costPerSeatCents"} />
            </Field>
            <Field invalid={fieldError?.campo === "commissionPerSeatCents"}>
              <Label optional>Comissão por lugar</Label>
              <CentsInput cents={commission} onCommit={setCommission} />
            </Field>
            <Field invalid={fieldError?.campo === "serviceFeePerSeatCents"}>
              <Label optional>Taxa por lugar</Label>
              <CentsInput cents={fee} onCommit={setFee} />
            </Field>
          </div>
          {fieldError && !fieldError.campo ? <FieldError>{fieldError.mensagem}</FieldError> : null}
        </form>
      </SheetContent>
    </>
  );
}
