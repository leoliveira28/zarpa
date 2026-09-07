"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  criarContato,
  listarContatos,
  restaurarContato,
  type ContatoResumo,
} from "@/server";
import { avisarRecusaDeEscrita } from "@/lib/ui/assinatura";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldError, Label } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { SkeletonRow } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { PlusIcon, SearchIcon, UploadIcon } from "@/components/app/icons";
import { initials } from "@/lib/ui/format";
import { cn } from "@/lib/ui/cn";
import { SOURCE_OPTIONS } from "./shared";

/* =============================================================================
   Clientes — a lista
   -----------------------------------------------------------------------------
   Registro silencioso: busca, uma lista de linhas de papel separadas por fio,
   e é isso. Nada de ilustração aqui fora do vazio — a regra do miolo do app.

   A busca não zera a lista a cada tecla: o resultado anterior fica na tela,
   um degrau mais apagado (`isPending`), até o novo chegar. Skeleton é só do
   primeiro carregamento — do contrário a lista pisca a cada letra digitada.
   ========================================================================== */

type Status = "loading" | "ready" | "error";

export function ClientesScreen() {
  const router = useRouter();
  const toast = useToast();

  const [status, setStatus] = React.useState<Status>("loading");
  const [contacts, setContacts] = React.useState<ContatoResumo[]>([]);
  const [errorInfo, setErrorInfo] = React.useState<{
    mensagem: string;
    correcao?: string;
  } | null>(null);
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

    void listarContatos({
      busca: debouncedQuery || undefined,
      incluirArquivados: includeArchived,
    }).then((result) => {
      if (!active) return;
      hasLoadedOnce.current = true;
      setIsPending(false);

      if (!result.ok) {
        setStatus("error");
        setErrorInfo({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setContacts(result.data);
      setStatus("ready");
    });

    return () => {
      active = false;
    };
  }, [debouncedQuery, includeArchived, reloadToken]);

  async function handleRestore(contact: ContatoResumo) {
    const result = await restaurarContato(contact.id);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      toast.show({
        title: "Não consegui restaurar",
        description: result.mensagem,
        tone: "danger",
      });
      return;
    }
    toast.show({ title: `Cliente restaurado: ${contact.name}`, tone: "ok" });
    retry();
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="display text-32 text-ink">Clientes</h2>
          <Button
            variant="primary"
            iconOnly
            aria-label="Novo cliente"
            onClick={() => setSheetOpen(true)}
          >
            <PlusIcon className="size-4" />
          </Button>
        </div>

        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nome, e-mail, telefone ou CPF"
          aria-label="Buscar cliente"
          prefix={<SearchIcon className="size-4" />}
        />
      </header>

      <div
        className={cn(
          "transition-opacity duration-150",
          isPending && "opacity-60",
        )}
      >
        {status === "loading" ? (
          <Card className="flex flex-col gap-4 p-4">
            {[0, 1, 2, 3].map((row) => (
              <SkeletonRow key={row} />
            ))}
          </Card>
        ) : status === "error" ? (
          <Card className="flex flex-col items-start gap-3 p-4">
            <FieldError>{errorInfo?.mensagem}</FieldError>
            <Button variant="secondary" size="sm" onClick={retry}>
              {errorInfo?.correcao ?? "Tentar de novo"}
            </Button>
          </Card>
        ) : contacts.length === 0 && !debouncedQuery ? (
          <EmptyState
            plate
            title="Nenhum cliente ainda"
            description="Cadastre um cliente na mão, ou importe a planilha que você já usa hoje — o assistente casa as colunas fora de ordem sozinho."
            preview={<SamplePreview />}
            action={
              <Button variant="primary" onClick={() => setSheetOpen(true)}>
                Adicionar cliente
              </Button>
            }
            secondaryAction={
              <Link
                href="/clientes/importar"
                className="text-13 font-medium text-muted hover:text-ink hover:underline"
              >
                Importar planilha
              </Link>
            }
          />
        ) : contacts.length === 0 ? (
          <Card className="p-4">
            <p className="text-15 text-muted">
              Nenhum cliente encontrado para &ldquo;{debouncedQuery}&rdquo;.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line-subtle">
              {contacts.map((contact) => (
                <li key={contact.id} className="flex items-center gap-2 pr-2">
                  <Link
                    href={`/clientes/${contact.id}`}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-3 px-4 py-3",
                      "hover:bg-surface-2",
                      "[@media(pointer:coarse)]:min-h-11",
                    )}
                  >
                    <span
                      aria-hidden
                      className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-3 text-13 font-semibold text-muted"
                    >
                      {initials(contact.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-15 font-medium text-ink">
                          {contact.name}
                        </span>
                        {contact.arquivado ? (
                          <Badge tone="neutral">Arquivado</Badge>
                        ) : null}
                      </span>
                      <span className="block truncate text-13 text-muted">
                        {contact.whatsapp || contact.phone || contact.email || "Sem contato salvo"}
                      </span>
                    </span>
                  </Link>
                  {contact.arquivado ? (
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => void handleRestore(contact)}
                    >
                      Restaurar
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {status !== "loading" ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link
            href="/clientes/importar"
            className="flex items-center gap-1.5 text-13 font-medium text-muted hover:text-ink hover:underline"
          >
            <UploadIcon className="size-3.5" />
            Importar planilha
          </Link>
          <button
            type="button"
            onClick={() => setIncludeArchived((v) => !v)}
            className="text-13 font-medium text-muted hover:text-ink hover:underline"
          >
            {includeArchived ? "Ocultar arquivados" : "Ver arquivados"}
          </button>
        </div>
      ) : null}

      <NovoClienteForm
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onCreated={(id) => {
          setSheetOpen(false);
          router.push(`/clientes/${id}`);
        }}
      />
    </div>
  );
}

/** Amostra do que uma linha de verdade parece — puramente visual, no vazio. */
function SamplePreview() {
  return (
    <div className="flex items-center gap-3 rounded-md bg-surface p-3 shadow-1">
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-3 text-13 font-semibold text-muted"
      >
        MA
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-15 font-medium text-ink">Marina Albuquerque</span>
        <span className="text-13 text-muted">(81) 99123-4567</span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ criação */

function NovoClienteForm({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [source, setSource] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<{
    campo?: string;
    mensagem: string;
  } | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setFieldError(null);

    const result = await criarContato({
      name,
      phone,
      email,
      source: (source ?? undefined) as
        | "whatsapp"
        | "instagram"
        | "indicacao"
        | "site"
        | "evento"
        | "outro"
        | undefined,
    });

    setCreating(false);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      setFieldError({ campo: result.campo, mensagem: result.mensagem });
      return;
    }
    onCreated(result.data.id);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        open={open}
        onOpenChange={onOpenChange}
        title="Novo cliente"
        description="Só o nome é obrigatório — o resto você completa quando quiser, na ficha dele."
        footer={
          <Button
            variant="primary"
            block
            type="submit"
            form="novo-cliente-form"
            loading={creating}
            disabled={name.trim().length < 2}
          >
            Adicionar
          </Button>
        }
      >
        <form
          id="novo-cliente-form"
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 py-2"
        >
          <Field invalid={fieldError?.campo === "name"}>
            <Label>Nome</Label>
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Marina Albuquerque"
              aria-invalid={fieldError?.campo === "name" || undefined}
            />
            {fieldError?.campo === "name" ? (
              <FieldError>{fieldError.mensagem}</FieldError>
            ) : null}
          </Field>

          <Field invalid={fieldError?.campo === "phone"}>
            <Label optional>WhatsApp ou telefone</Label>
            <Input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="(11) 98888-7777"
              inputMode="tel"
              aria-invalid={fieldError?.campo === "phone" || undefined}
            />
            {fieldError?.campo === "phone" ? (
              <FieldError>{fieldError.mensagem}</FieldError>
            ) : null}
          </Field>

          <Field invalid={fieldError?.campo === "email"}>
            <Label optional>E-mail</Label>
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="cliente@exemplo.com"
              aria-invalid={fieldError?.campo === "email" || undefined}
            />
            {fieldError?.campo === "email" ? (
              <FieldError>{fieldError.mensagem}</FieldError>
            ) : null}
          </Field>

          <Field>
            <Label optional>Como chegou até você</Label>
            <Select value={source ?? undefined} onValueChange={setSource}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {fieldError && !fieldError.campo ? (
            <FieldError>{fieldError.mensagem}</FieldError>
          ) : null}
        </form>
      </SheetContent>
    </Sheet>
  );
}
