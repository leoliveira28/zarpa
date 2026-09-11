"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  adicionarMembroAoGrupo,
  criarNegocioParaMembro,
  listarContatos,
  obterGrupo,
  removerMembroDoGrupo,
  type GrupoDetalhe,
} from "@/server";
import { avisarRecusaDeEscrita } from "@/lib/ui/assinatura";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldError, Label } from "@/components/ui/Field";
import { Money, MoneyStat } from "@/components/ui/Money";
import { Rule } from "@/components/plates";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { Skeleton, SkeletonRow } from "@/components/ui/Skeleton";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { PlusIcon } from "@/components/app/icons";
import { formatarFaixaDeDatas } from "@/lib/ui/format";

/* =============================================================================
   Ficha do grupo — lugares, números por lugar e ocupação
   -----------------------------------------------------------------------------
   O card de cima é a CONTA DO PACOTE: margem por lugar grande (a Fase 2
   ensinou: a margem é a única voz grande) e os quatro números de apoio.
   O card de baixo é a OCUPAÇÃO — quem ocupa quantos lugares, com o link do
   negócio quando existe. "Sobram X" é o número do título do card de ocupação.
   ========================================================================== */

export function GrupoFichaScreen({ grupoId }: { grupoId: string }) {
  const router = useRouter();
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [grupo, setGrupo] = React.useState<GrupoDetalhe | null>(null);
  const [erro, setErro] = React.useState<{ mensagem: string; correcao?: string } | null>(null);
  const [reloadToken] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    void obterGrupo(grupoId).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setErro({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setGrupo(result.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [grupoId, reloadToken]);

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-2/3 rounded-sm" />
        <Card className="p-4">
          <SkeletonRow />
        </Card>
      </div>
    );
  }
  if (status === "error" || !grupo) {
    return (
      <Card className="flex flex-col items-start gap-3 p-5">
        <FieldError>{erro?.mensagem ?? "Não consegui carregar o grupo."}</FieldError>
        <Button variant="secondary" onClick={() => router.push("/grupos")}>
          Voltar para Grupos
        </Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/grupos"
        className="flex w-fit items-center gap-1 text-13 font-medium text-muted hover:text-ink"
      >
        <span aria-hidden>‹</span>
        Grupos
      </Link>

      <header className="flex flex-col gap-2">
        <h2 className="display text-32 text-ink">{grupo.title}</h2>
        <p className="text-15 text-muted">
          {grupo.destination ?? "Sem destino"}
          {grupo.departureOn || grupo.returnOn
            ? ` · ${formatarFaixaDeDatas(grupo.departureOn, grupo.returnOn) ?? ""}`
            : ""}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>A conta por lugar</CardTitle>
          <Badge tone={grupo.status === "encerrado" ? "warn" : grupo.status === "vendendo" ? "ok" : "neutral"} dot size="sm">
            {grupo.status === "montando" ? "Montando" : grupo.status === "vendendo" ? "Vendendo" : "Encerrado"}
          </Badge>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col gap-1">
            <span className="text-13 font-medium text-muted">Margem por lugar</span>
            <Money
              cents={grupo.margemPorLugarCents}
              size="32"
              tone={grupo.margemPorLugarCents >= 0 ? "accent" : "danger"}
              align="left"
              reserveFor={grupo.pricePerSeatCents}
            />
            <p className="text-13 text-muted">preço − custo − comissão − taxa, por lugar</p>
          </div>
          <Rule loose />
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <MoneyStat label="Preço/lugar" cents={grupo.pricePerSeatCents} align="left" reserveFor={grupo.pricePerSeatCents} />
            <MoneyStat label="Custo/lugar" cents={grupo.costPerSeatCents} align="left" reserveFor={grupo.pricePerSeatCents} />
            <MoneyStat label="Comissão/lugar" cents={grupo.commissionPerSeatCents} align="left" reserveFor={grupo.pricePerSeatCents} />
            <MoneyStat label="Taxa/lugar" cents={grupo.serviceFeePerSeatCents} align="left" reserveFor={grupo.pricePerSeatCents} />
          </div>
        </CardBody>
        <CardFooter>
          Números de fotografia — mudar aqui não reescreve as vendas já fechadas dos membros.
        </CardFooter>
      </Card>

      <MembrosCard grupo={grupo} onPatched={setGrupo} />
    </div>
  );
}

/* -----------------------------------------------------------------------------
   MembrosCard — a ocupação. "Sobram X" no título; adicionar escolhe cliente
   (+ negócio opcional) e a quantidade de lugares; reduzir o total abaixo da
   ocupação o servidor recusa.
   ------------------------------------------------------------------------- */

function MembrosCard({
  grupo,
  onPatched,
}: {
  grupo: GrupoDetalhe;
  onPatched: (grupo: GrupoDetalhe) => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const restam = Math.max(grupo.totalSeats - grupo.lugaresOcupados, 0);

  // Fit: o membro entra no FUNIL com um toque — o deal nasce com o título do
  // grupo e o chip no funil passa a apontar para cá. Idempotente no servidor.
  async function criarNegocio(contactId: string, nome: string) {
    const result = await criarNegocioParaMembro({ groupId: grupo.id, contactId });
    if (!result.ok) {
      toast.show({ title: `Não consegui criar o negócio de ${nome}`, description: result.mensagem, tone: "danger" });
      return;
    }
    router.push(`/funil/${result.data.dealId}`);
  }

  async function remover(contactId: string, nome: string) {
    const anterior = grupo;
    onPatched({
      ...grupo,
      members: grupo.members.filter((m) => m.contactId !== contactId),
      lugaresOcupados: grupo.lugaresOcupados - (grupo.members.find((m) => m.contactId === contactId)?.seats ?? 0),
    });
    const result = await removerMembroDoGrupo({ groupId: grupo.id, contactId });
    if (!result.ok) {
      onPatched(anterior);
      toast.show({ title: `Não consegui remover ${nome}`, description: result.mensagem, tone: "danger" });
      return;
    }
    onPatched(result.data);
    toast.show({ title: `${nome} liberou ${anterior.members.find((m) => m.contactId === contactId)?.seats ?? 1} lugar(es)`, tone: "ok" });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ocupação</CardTitle>
        <span className="text-13 tabular-nums text-muted">
          {grupo.lugaresOcupados} de {grupo.totalSeats} · sobram {restam}
        </span>
      </CardHeader>
      <CardBody flush={grupo.members.length === 0}>
        {grupo.members.length === 0 ? (
          <EmptyState
            compact
            title="Ninguém ocupando ainda"
            description="Relacione o cliente (e o negócio, se já houver) — cada reserva consome os lugares dela."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line-subtle">
            {grupo.members.map((membro) => (
              <li key={membro.contactId} className="flex items-center gap-3 px-4 py-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-15 text-ink">
                    {membro.contactName}
                    <span className="ml-2 text-13 tabular-nums text-muted">
                      {membro.seats} {membro.seats === 1 ? "lugar" : "lugares"}
                    </span>
                  </span>
                  {membro.dealId && membro.dealTitle ? (
                    <Link
                      href={`/funil/${membro.dealId}`}
                      className="truncate text-13 font-medium text-accent underline underline-offset-2"
                    >
                      {membro.dealTitle}
                    </Link>
                  ) : (
                    <span className="flex items-center gap-2 text-13 text-subtle">
                      sem negócio vinculado
                      <button
                        type="button"
                        className="font-medium text-accent underline underline-offset-2"
                        onClick={() => void criarNegocio(membro.contactId, membro.contactName)}
                      >
                        Criar negócio
                      </button>
                    </span>
                  )}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void remover(membro.contactId, membro.contactName)}
                >
                  Liberar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <CardFooter
        action={
          grupo.status !== "encerrado" ? (
            <Button variant="secondary" size="sm" onClick={() => setSheetOpen(true)}>
              <PlusIcon className="size-4" />
              Ocupar lugares
            </Button>
          ) : undefined
        }
      >
        Cada reserva consome lugares do total — a margem do grupo fecha com o que vender.
      </CardFooter>

      <OcuparSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        grupo={grupo}
        onAdded={(atualizado) => {
          onPatched(atualizado);
          setSheetOpen(false);
        }}
      />
    </Card>
  );
}

/* -----------------------------------------------------------------------------
   OcuparSheet — cliente (combobox da lista) + negócio opcional + lugares.
   ------------------------------------------------------------------------- */

function OcuparSheet({
  open,
  onOpenChange,
  grupo,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grupo: GrupoDetalhe;
  onAdded: (atualizado: GrupoDetalhe) => void;
}) {
  // Remontagem por key: a cada abertura o formulário nasce novo — sem efeito
  // de reset (a régua da casa: setState síncrono em efeito é bug de arquitetura).
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open ? (
        <OcuparForm key="aberto" grupo={grupo} onOpenChange={onOpenChange} onAdded={onAdded} />
      ) : null}
    </Sheet>
  );
}

function OcuparForm({
  grupo,
  onOpenChange,
  onAdded,
}: {
  grupo: GrupoDetalhe;
  onOpenChange: (open: boolean) => void;
  onAdded: (atualizado: GrupoDetalhe) => void;
}) {
  const [contatos, setContatos] = React.useState<Array<{ id: string; name: string }>>([]);
  const [contactId, setContactId] = React.useState("");
  const [dealId, setDealId] = React.useState("");
  const [seats, setSeats] = React.useState<number | null>(1);
  const [saving, setSaving] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<{ campo?: string; mensagem: string } | null>(null);

  React.useEffect(() => {
    let active = true;
    void listarContatos({ limite: 200 }).then((result) => {
      if (!active) return;
      if (result.ok) setContatos(result.data.map((c) => ({ id: c.id, name: c.name })));
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFieldError(null);
    const result = await adicionarMembroAoGrupo({
      groupId: grupo.id,
      contactId,
      dealId: dealId || null,
      seats: seats ?? 1,
    });
    setSaving(false);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      setFieldError({ campo: result.campo, mensagem: result.mensagem });
      return;
    }
    onAdded(result.data);
  }

  const jaMembro = new Set(grupo.members.map((m) => m.contactId));

  return (
    <>
      <SheetContent
        open
        onOpenChange={onOpenChange}
        title="Ocupar lugares"
        description="Escolha o cliente, o negócio dele (opcional) e quantos lugares a reserva consome."
        footer={
          <Button
            variant="primary"
            block
            type="submit"
            form="ocupar-form"
            loading={saving}
            disabled={!contactId}
          >
            Ocupar
          </Button>
        }
      >
        <form id="ocupar-form" onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <Field invalid={fieldError?.campo === "contactId"}>
            <Label>Cliente</Label>
            <select
              value={contactId}
              onChange={(event) => setContactId(event.target.value)}
              className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-15 text-ink"
            >
              <option value="">Escolher cliente</option>
              {contatos
                .filter((c) => !jaMembro.has(c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            {fieldError?.campo === "contactId" ? <FieldError>{fieldError.mensagem}</FieldError> : null}
          </Field>
          <Field>
            <Label optional>Negócio (opcional)</Label>
            <Input
              value={dealId}
              onChange={(event) => setDealId(event.target.value)}
              placeholder="ID do negócio no funil"
            />
          </Field>
          <Field invalid={fieldError?.campo === "seats"}>
            <Label>Lugares</Label>
            <Input
              type="number"
              min={1}
              max={50}
              inputMode="numeric"
              value={seats ?? ""}
              onChange={(event) =>
                setSeats(event.target.value === "" ? null : Number(event.target.value))
              }
            />
            {fieldError?.campo === "seats" ? <FieldError>{fieldError.mensagem}</FieldError> : null}
          </Field>
          {fieldError && !fieldError.campo ? <FieldError>{fieldError.mensagem}</FieldError> : null}
        </form>
      </SheetContent>
    </>
  );
}
