"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  arquivarContato,
  atualizarContato,
  atualizarViajante,
  concluirTarefa,
  criarViajante,
  excluirContato,
  excluirViajante,
  listarTarefas,
  listarViajantes,
  obterContato,
  obterDocumentoDoContato,
  obterDocumentoDoViajante,
  restaurarContato,
  type ContatoDetalhe,
  type ServiceResult,
  type TarefaResumo,
  type ViajanteInput,
  type ViajanteResumo,
} from "@/server";
import { avisarRecusaDeEscrita } from "@/lib/ui/assinatura";
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
import { Checkbox } from "@/components/ui/Checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldError, Label, SavedMark } from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/Input";
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
import { NovoNegocioSheet } from "@/components/app/NovoNegocioSheet";
import {
  CakeIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  PassportIcon,
  PlusIcon,
} from "@/components/app/icons";
import { formatDayMonth } from "@/lib/ui/format";
import { useAutosave } from "@/lib/ui/useAutosave";
import { useDeferredDelete } from "@/lib/ui/useDeferredDelete";
import {
  SOURCE_LABELS,
  SOURCE_OPTIONS,
  TRAVELER_KIND_LABELS,
  TRAVELER_KIND_OPTIONS,
  daysUntilIso,
  daysUntilMonthDay,
  formatMonthDay,
  passportLabel,
  passportTone,
} from "../shared";

/* =============================================================================
   Ficha do contato
   -----------------------------------------------------------------------------
   Registro silencioso, sem prancha (a regra reserva ilustração para vazio e
   entrada). Cinco cartas na razão base/fuste/capitel de sempre: Dados,
   Documento (PII com cuidado), Passageiros, Lembretes (consome alerts.ts) e
   Encerramento (arquivar/excluir).

   Cada campo se salva sozinho — não existe botão "Salvar" na tela inteira.
   ========================================================================== */

type Status = "loading" | "ready" | "error";

export function ContatoScreen({ contatoId }: { contatoId: string }) {
  const router = useRouter();
  const toast = useToast();

  const [status, setStatus] = React.useState<Status>("loading");
  const [contact, setContact] = React.useState<ContatoDetalhe | null>(null);
  const [errorInfo, setErrorInfo] = React.useState<{
    mensagem: string;
    correcao?: string;
  } | null>(null);

  const [reloadToken, setReloadToken] = React.useState(0);
  const retry = React.useCallback(() => setReloadToken((token) => token + 1), []);

  // Atalho "Novo negócio" a partir da ficha — o segundo ponto de entrada do
  // bloqueio nº1 (ver docs/status/nina.md e o cabeçalho de FunnelScreen.tsx).
  // O Funil não está montado aqui, então o card não "aparece" na hora — o
  // toast com o link resolve isso sem esperar a agente navegar às cegas.
  const [negocioSheetOpen, setNegocioSheetOpen] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    void obterContato(contatoId).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setErrorInfo({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setContact(result.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [contatoId, reloadToken]);

  function patch(update: Partial<ContatoDetalhe>) {
    setContact((current) => (current ? { ...current, ...update } : current));
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/clientes"
        className="flex w-fit items-center gap-1 text-13 font-medium text-muted hover:text-ink"
      >
        <ChevronRightIcon className="size-3.5 -scale-x-100" />
        Clientes
      </Link>

      {status === "loading" ? (
        <ContatoSkeleton />
      ) : status === "error" || !contact ? (
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
              <h2 className="display truncate text-32 text-ink">{contact.name}</h2>
              <p className="text-13 text-muted">
                Cliente desde {formatDayMonth(new Date(contact.createdAt))} ·{" "}
                {contact.totalViajantes}{" "}
                {contact.totalViajantes === 1 ? "passageiro" : "passageiros"} ·{" "}
                {contact.totalNegocios}{" "}
                {contact.totalNegocios === 1 ? "negócio" : "negócios"}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0"
              onPointerDown={() => setNegocioSheetOpen(true)}
            >
              <PlusIcon className="size-4" />
              <span className="hidden sm:inline">Novo negócio</span>
              <span className="sr-only sm:hidden">Novo negócio</span>
            </Button>
          </header>

          <DadosCard contact={contact} contatoId={contatoId} onPatched={patch} />
          <DocumentoCard contact={contact} contatoId={contatoId} onPatched={patch} />
          <PassageirosCard contatoId={contatoId} />
          <LembretesCard contatoId={contatoId} />
          <EncerramentoCard contact={contact} onPatched={patch} />

          <NovoNegocioSheet
            open={negocioSheetOpen}
            onOpenChange={setNegocioSheetOpen}
            contatoFixo={{ id: contact.id, nome: contact.name }}
            onCreated={(negocio) => {
              setNegocioSheetOpen(false);
              patch({ totalNegocios: contact.totalNegocios + 1 });
              toast.show({
                title: `Negócio criado: ${negocio.title}`,
                description: "Entrou no Funil, coluna Novo contato.",
                tone: "ok",
                action: { label: "Abrir Funil", onClick: () => router.push("/funil") },
              });
            }}
          />
        </>
      )}
    </div>
  );
}

function ContatoSkeleton() {
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
   Dados
   ========================================================================== */

function DadosCard({
  contact,
  contatoId,
  onPatched,
}: {
  contact: ContatoDetalhe;
  contatoId: string;
  onPatched: (patch: Partial<ContatoDetalhe>) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dados</CardTitle>
      </CardHeader>
      <CardBody>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextAutoField
            label="Nome"
            initialValue={contact.name}
            onSave={async (value) => {
              const result = await atualizarContato(contatoId, { name: value });
              if (result.ok) onPatched({ name: value });
              return result;
            }}
          />
          <TextAutoField
            label="WhatsApp"
            optional
            initialValue={contact.whatsapp ?? ""}
            inputMode="tel"
            onSave={async (value) => {
              const result = await atualizarContato(contatoId, { whatsapp: value });
              if (result.ok) onPatched({ whatsapp: value || null });
              return result;
            }}
          />
          <TextAutoField
            label="Telefone"
            optional
            initialValue={contact.phone ?? ""}
            inputMode="tel"
            onSave={async (value) => {
              const result = await atualizarContato(contatoId, { phone: value });
              if (result.ok) onPatched({ phone: value || null });
              return result;
            }}
          />
          <TextAutoField
            label="E-mail"
            optional
            type="email"
            initialValue={contact.email ?? ""}
            onSave={async (value) => {
              const result = await atualizarContato(contatoId, { email: value });
              if (result.ok) onPatched({ email: value || null });
              return result;
            }}
          />
        </div>

        <SourceAutoField contatoId={contatoId} contact={contact} onPatched={onPatched} />
        <TagsAutoField contatoId={contatoId} contact={contact} onPatched={onPatched} />

        <NotesAutoField contatoId={contatoId} contact={contact} onPatched={onPatched} />
      </CardBody>
    </Card>
  );
}

/** Campo de texto com salvamento automático no blur — usado por Dados e Documento. */
function TextAutoField({
  label,
  optional,
  initialValue,
  placeholder,
  type = "text",
  inputMode,
  onSave,
}: {
  label: string;
  optional?: boolean;
  initialValue: string;
  placeholder?: string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
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
        type={type}
        inputMode={inputMode}
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

function SourceAutoField({
  contatoId,
  contact,
  onPatched,
}: {
  contatoId: string;
  contact: ContatoDetalhe;
  onPatched: (patch: Partial<ContatoDetalhe>) => void;
}) {
  const { state, commit } = useAutosave(async (value: string) => {
    const source = value as
      | "whatsapp"
      | "instagram"
      | "indicacao"
      | "site"
      | "evento"
      | "outro";
    const result = await atualizarContato(contatoId, { source });
    if (result.ok) onPatched({ source });
    return result;
  });

  return (
    <Field className="mt-4">
      <div className="flex items-baseline justify-between gap-2">
        <Label optional>Como chegou até você</Label>
        <SavedMark state={state} />
      </div>
      <Select
        value={contact.source ?? undefined}
        onValueChange={(value) => void commit(value)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Não informado">
            {contact.source ? SOURCE_LABELS[contact.source] : undefined}
          </SelectValue>
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
  );
}

function TagsAutoField({
  contatoId,
  contact,
  onPatched,
}: {
  contatoId: string;
  contact: ContatoDetalhe;
  onPatched: (patch: Partial<ContatoDetalhe>) => void;
}) {
  const [draft, setDraft] = React.useState("");
  const { state, commit } = useAutosave(async (tags: string[]) => {
    const result = await atualizarContato(contatoId, { tags });
    if (result.ok) onPatched({ tags });
    return result;
  });

  function addTag() {
    const tag = draft.trim();
    if (!tag || contact.tags.includes(tag)) {
      setDraft("");
      return;
    }
    setDraft("");
    void commit([...contact.tags, tag]);
  }

  function removeTag(tag: string) {
    void commit(contact.tags.filter((t) => t !== tag));
  }

  return (
    <Field className="mt-4">
      <div className="flex items-baseline justify-between gap-2">
        <Label optional>Etiquetas</Label>
        <SavedMark state={state} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {contact.tags.map((tag) => (
          <Badge key={tag} tone="neutral" className="gap-1 pr-1">
            {tag}
            <button
              type="button"
              aria-label={`Remover etiqueta ${tag}`}
              onClick={() => removeTag(tag)}
              className="grid size-3.5 place-items-center rounded-pill text-muted hover:bg-surface-2 hover:text-ink"
            >
              <svg viewBox="0 0 16 16" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
              </svg>
            </button>
          </Badge>
        ))}
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addTag();
            }
          }}
          onBlur={addTag}
          placeholder="lua de mel, corporativo…"
          size="sm"
          className="w-40 flex-1"
        />
      </div>
    </Field>
  );
}

function NotesAutoField({
  contatoId,
  contact,
  onPatched,
}: {
  contatoId: string;
  contact: ContatoDetalhe;
  onPatched: (patch: Partial<ContatoDetalhe>) => void;
}) {
  const [value, setValue] = React.useState(contact.notes ?? "");
  const { state, commit, schedule } = useAutosave(
    async (notes: string) => {
      const result = await atualizarContato(contatoId, { notes });
      if (result.ok) onPatched({ notes: notes || null });
      return result;
    },
    { debounceMs: 900 },
  );

  return (
    <Field className="mt-4">
      <div className="flex items-baseline justify-between gap-2">
        <Label optional>Observações</Label>
        <SavedMark state={state} />
      </div>
      <Textarea
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          schedule(event.target.value);
        }}
        onBlur={() => void commit(value)}
        placeholder="Preferências, restrições, o que lembrar antes de ligar…"
      />
    </Field>
  );
}

/* =============================================================================
   Documento — PII com cuidado
   ========================================================================== */

function DocumentoCard({
  contact,
  contatoId,
  onPatched,
}: {
  contact: ContatoDetalhe;
  contatoId: string;
  onPatched: (patch: Partial<ContatoDetalhe>) => void;
}) {
  const [revealed, setRevealed] = React.useState<{ cpf: string; nascimento: string } | null>(null);
  const [revealing, setRevealing] = React.useState(false);
  const [revealError, setRevealError] = React.useState<string | null>(null);

  const hasSomething = contact.temDocumento || contact.aniversario !== null;

  async function reveal() {
    setRevealing(true);
    setRevealError(null);
    const result = await obterDocumentoDoContato(contatoId);
    setRevealing(false);
    if (!result.ok) {
      setRevealError(result.mensagem);
      return;
    }
    setRevealed({
      cpf: result.data.cpf ?? "",
      nascimento: result.data.nascimento ? result.data.nascimento.slice(0, 10) : "",
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documento e nascimento</CardTitle>
      </CardHeader>
      <CardBody>
        <p className="text-13 text-muted">
          CPF e data de nascimento ficam cifrados. Abrir aqui grava quem viu, no registro de
          auditoria — é por isso que a tela não mostra os dois de cara.
        </p>

        {revealError ? (
          <FieldError
            action={
              <button
                type="button"
                className="font-medium text-danger underline underline-offset-2"
                onClick={() => void reveal()}
              >
                Tentar de novo
              </button>
            }
          >
            {revealError}
          </FieldError>
        ) : null}

        {revealed ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextAutoField
              label="CPF"
              optional
              initialValue={revealed.cpf}
              inputMode="numeric"
              placeholder="000.000.000-00"
              onSave={async (value) => {
                const result = await atualizarContato(contatoId, { document: value });
                if (result.ok) onPatched({ temDocumento: value.trim().length > 0 });
                return result;
              }}
            />
            <BirthDateAutoField
              initialValue={revealed.nascimento}
              onSave={async (value) => {
                const result = await atualizarContato(contatoId, { birthDate: value });
                if (result.ok) {
                  onPatched({
                    aniversario: value ? isoToMonthDay(value) : null,
                  });
                }
                return result;
              }}
            />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="flex items-center gap-1.5 text-15 text-ink">
              {contact.temDocumento ? "CPF cadastrado" : "CPF não cadastrado"}
            </span>
            <span className="flex items-center gap-1.5 text-15 text-ink">
              {contact.aniversario ? (
                <>
                  <CakeIcon className="size-4 text-muted" />
                  Aniversário: {formatMonthDay(contact.aniversario)}
                </>
              ) : (
                "Nascimento não informado"
              )}
            </span>
            <Button
              variant="secondary"
              size="sm"
              loading={revealing}
              onClick={() => void reveal()}
            >
              <EyeIcon className="size-4" />
              {hasSomething ? "Ver e editar" : "Adicionar"}
            </Button>
          </div>
        )}

        {revealed ? (
          <button
            type="button"
            onClick={() => setRevealed(null)}
            className="flex w-fit items-center gap-1.5 text-13 font-medium text-muted hover:text-ink"
          >
            <EyeOffIcon className="size-3.5" />
            Ocultar
          </button>
        ) : null}
      </CardBody>
    </Card>
  );
}

function BirthDateAutoField({
  initialValue,
  onSave,
}: {
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
        <Label optional>Nascimento</Label>
        <SavedMark state={state} />
      </div>
      <Input
        type="date"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={handleBlur}
      />
      {state === "error" ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

function isoToMonthDay(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[2]}-${match[3]}` : null;
}

/* =============================================================================
   Passageiros
   ========================================================================== */

function PassageirosCard({ contatoId }: { contatoId: string }) {
  const toast = useToast();
  const [status, setStatus] = React.useState<Status>("loading");
  const [travelers, setTravelers] = React.useState<ViajanteResumo[]>([]);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  const [reloadToken, setReloadToken] = React.useState(0);
  const reload = React.useCallback(() => setReloadToken((token) => token + 1), []);

  React.useEffect(() => {
    let active = true;
    void listarViajantes({ contatoId }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        return;
      }
      setTravelers(result.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [contatoId, reloadToken]);

  const scheduleDelete = useDeferredDelete<ViajanteResumo>({
    label: (item) => `Passageiro removido: ${item.fullName}`,
    commit: (item) => excluirViajante(item.id),
    onFailure: (item, mensagem) => {
      toast.show({ title: `Não consegui remover ${item.fullName}`, description: mensagem, tone: "danger" });
      reload();
    },
  });

  function handleRemove(traveler: ViajanteResumo) {
    setTravelers((current) => current.filter((t) => t.id !== traveler.id));
    scheduleDelete(traveler);
  }

  function handleUpdated(updated: ViajanteResumo) {
    setTravelers((current) => current.map((t) => (t.id === updated.id ? updated : t)));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Passageiros</CardTitle>
      </CardHeader>
      <CardBody flush={status !== "ready" || travelers.length === 0}>
        {status === "loading" ? (
          <div className="flex flex-col gap-4 p-4">
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : status === "error" ? (
          <div className="flex flex-col items-start gap-3 p-4">
            <FieldError>Não consegui carregar os passageiros.</FieldError>
            <Button variant="secondary" size="sm" onClick={reload}>
              Tentar de novo
            </Button>
          </div>
        ) : travelers.length === 0 ? (
          <EmptyState
            compact
            title="Nenhum passageiro ainda"
            description="Quem viaja sozinho é passageiro de si mesmo — cadastre ao menos um, mesmo que seja o próprio cliente."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line-subtle">
            {travelers.map((traveler) => (
              <TravelerRow
                key={traveler.id}
                traveler={traveler}
                onUpdated={handleUpdated}
                onRemoved={() => handleRemove(traveler)}
              />
            ))}
          </ul>
        )}
      </CardBody>
      <CardFooter
        action={
          <Button variant="secondary" size="sm" onClick={() => setSheetOpen(true)}>
            <PlusIcon className="size-4" />
            Adicionar passageiro
          </Button>
        }
      />

      <NovoPassageiroForm
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        contatoId={contatoId}
        onCreated={(traveler) => {
          setTravelers((current) => [traveler, ...current]);
          setSheetOpen(false);
        }}
      />
    </Card>
  );
}

function TravelerRow({
  traveler,
  onUpdated,
  onRemoved,
}: {
  traveler: ViajanteResumo;
  onUpdated: (traveler: ViajanteResumo) => void;
  onRemoved: () => void;
}) {
  const [revealed, setRevealed] = React.useState<{
    cpf: string;
    passaporte: string;
    nascimento: string;
  } | null>(null);
  const [revealing, setRevealing] = React.useState(false);
  const [revealError, setRevealError] = React.useState<string | null>(null);

  async function reveal() {
    setRevealing(true);
    setRevealError(null);
    const result = await obterDocumentoDoViajante(traveler.id);
    setRevealing(false);
    if (!result.ok) {
      setRevealError(result.mensagem);
      return;
    }
    setRevealed({
      cpf: result.data.cpf ?? "",
      passaporte: result.data.passaporte ?? "",
      nascimento: result.data.nascimento ? result.data.nascimento.slice(0, 10) : "",
    });
  }

  const passportDays = traveler.passportExpiresOn
    ? daysUntilIso(traveler.passportExpiresOn)
    : null;
  const birthdayDays = traveler.aniversario
    ? daysUntilMonthDay(traveler.aniversario)
    : null;

  return (
    <li className="flex flex-col gap-3 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
          <TextAutoField
            label="Nome"
            initialValue={traveler.fullName}
            onSave={async (value) => {
              const result = await atualizarViajante(traveler.id, { fullName: value });
              if (result.ok) onUpdated({ ...traveler, fullName: value });
              return result;
            }}
          />
          <KindAutoField traveler={traveler} onUpdated={onUpdated} />
        </div>
        <CardAction className="text-danger hover:text-danger" onClick={onRemoved}>
          Remover
        </CardAction>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <PassportAutoField traveler={traveler} onUpdated={onUpdated} />
        <div className="flex flex-col justify-end gap-1.5 pb-1.5">
          {passportDays !== null ? (
            <Badge tone={passportTone(passportDays)} dot>
              <PassportIcon className="size-3" />
              Passaporte {passportLabel(passportDays)}
            </Badge>
          ) : null}
          {birthdayDays !== null && birthdayDays <= 30 ? (
            <Badge tone="neutral" dot>
              <CakeIcon className="size-3" />
              Aniversário {formatMonthDay(traveler.aniversario!)}
            </Badge>
          ) : null}
        </div>
      </div>

      {revealError ? <FieldError>{revealError}</FieldError> : null}

      {revealed ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <TextAutoField
            label="CPF"
            optional
            initialValue={revealed.cpf}
            inputMode="numeric"
            onSave={async (value) => {
              const result = await atualizarViajante(traveler.id, { cpf: value });
              if (result.ok) onUpdated({ ...traveler, temCpf: value.trim().length > 0 });
              return result;
            }}
          />
          <TextAutoField
            label="Nº do passaporte"
            optional
            initialValue={revealed.passaporte}
            onSave={async (value) => {
              const result = await atualizarViajante(traveler.id, { passportNumber: value });
              if (result.ok) onUpdated({ ...traveler, temPassaporte: value.trim().length > 0 });
              return result;
            }}
          />
          <BirthDateAutoField
            initialValue={revealed.nascimento}
            onSave={async (value) => {
              const result = await atualizarViajante(traveler.id, { birthDate: value });
              if (result.ok) {
                onUpdated({
                  ...traveler,
                  aniversario: value ? isoToMonthDay(value) : null,
                });
              }
              return result;
            }}
          />
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => (revealed ? setRevealed(null) : void reveal())}
        className="flex w-fit items-center gap-1.5 text-13 font-medium text-muted hover:text-ink"
      >
        {revealed ? (
          <>
            <EyeOffIcon className="size-3.5" />
            Ocultar CPF e passaporte
          </>
        ) : (
          <>
            {revealing ? null : <EyeIcon className="size-3.5" />}
            {revealing ? "Abrindo…" : "Ver CPF, passaporte e nascimento"}
          </>
        )}
      </button>
    </li>
  );
}

function KindAutoField({
  traveler,
  onUpdated,
}: {
  traveler: ViajanteResumo;
  onUpdated: (traveler: ViajanteResumo) => void;
}) {
  const { state, commit } = useAutosave(async (kind: string) => {
    const value = kind as "adult" | "child" | "infant";
    const result = await atualizarViajante(traveler.id, { kind: value });
    if (result.ok) onUpdated({ ...traveler, kind: value });
    return result;
  });

  return (
    <Field>
      <div className="flex items-baseline justify-between gap-2">
        <Label>Tipo</Label>
        <SavedMark state={state} />
      </div>
      <Select value={traveler.kind} onValueChange={(value) => void commit(value)}>
        <SelectTrigger size="sm">
          <SelectValue>{TRAVELER_KIND_LABELS[traveler.kind]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {TRAVELER_KIND_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function PassportAutoField({
  traveler,
  onUpdated,
}: {
  traveler: ViajanteResumo;
  onUpdated: (traveler: ViajanteResumo) => void;
}) {
  const [value, setValue] = React.useState(traveler.passportExpiresOn ?? "");
  const savedRef = React.useRef(traveler.passportExpiresOn ?? "");
  const { state, commit } = useAutosave(async (next: string) => {
    const result = await atualizarViajante(traveler.id, { passportExpiresOn: next });
    if (result.ok) onUpdated({ ...traveler, passportExpiresOn: next || null });
    return result;
  });

  return (
    <Field>
      <div className="flex items-baseline justify-between gap-2">
        <Label optional>Validade do passaporte</Label>
        <SavedMark state={state} />
      </div>
      <Input
        type="date"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (value === savedRef.current) return;
          savedRef.current = value;
          void commit(value);
        }}
      />
    </Field>
  );
}

function NovoPassageiroForm({
  open,
  onOpenChange,
  contatoId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contatoId: string;
  onCreated: (traveler: ViajanteResumo) => void;
}) {
  const [fullName, setFullName] = React.useState("");
  const [kind, setKind] = React.useState<ViajanteInput["kind"]>("adult");
  const [nationality, setNationality] = React.useState("BR");
  const [cpf, setCpf] = React.useState("");
  const [passportNumber, setPassportNumber] = React.useState("");
  const [passportExpiresOn, setPassportExpiresOn] = React.useState("");
  const [birthDate, setBirthDate] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<{ campo?: string; mensagem: string } | null>(null);

  function reset() {
    setFullName("");
    setKind("adult");
    setNationality("BR");
    setCpf("");
    setPassportNumber("");
    setPassportExpiresOn("");
    setBirthDate("");
    setFieldError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setFieldError(null);
    const result = await criarViajante({
      contactId: contatoId,
      fullName,
      kind,
      nationality,
      cpf,
      passportNumber,
      passportExpiresOn,
      birthDate,
    });
    setCreating(false);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      setFieldError({ campo: result.campo, mensagem: result.mensagem });
      return;
    }
    onCreated(result.data);
    reset();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        open={open}
        onOpenChange={onOpenChange}
        title="Novo passageiro"
        description="Só o nome é obrigatório."
        footer={
          <Button
            variant="primary"
            block
            type="submit"
            form="novo-passageiro-form"
            loading={creating}
            disabled={fullName.trim().length < 2}
          >
            Adicionar
          </Button>
        }
      >
        <form id="novo-passageiro-form" onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <Field invalid={fieldError?.campo === "fullName"}>
            <Label>Nome completo</Label>
            <Input
              autoFocus
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Como está no documento de viagem"
            />
            {fieldError?.campo === "fullName" ? <FieldError>{fieldError.mensagem}</FieldError> : null}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label>Tipo</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as ViajanteInput["kind"])}>
                <SelectTrigger>
                  <SelectValue>{TRAVELER_KIND_LABELS[kind ?? "adult"]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TRAVELER_KIND_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field invalid={fieldError?.campo === "nationality"}>
              <Label>Nacionalidade</Label>
              <Input
                value={nationality}
                onChange={(event) => setNationality(event.target.value.toUpperCase().slice(0, 2))}
                placeholder="BR"
                aria-invalid={fieldError?.campo === "nationality" || undefined}
              />
              {fieldError?.campo === "nationality" ? (
                <FieldError>{fieldError.mensagem}</FieldError>
              ) : null}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field invalid={fieldError?.campo === "cpf"}>
              <Label optional>CPF</Label>
              <Input
                value={cpf}
                onChange={(event) => setCpf(event.target.value)}
                inputMode="numeric"
                placeholder="000.000.000-00"
              />
              {fieldError?.campo === "cpf" ? <FieldError>{fieldError.mensagem}</FieldError> : null}
            </Field>
            <Field>
              <Label optional>Nascimento</Label>
              <Input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label optional>Nº do passaporte</Label>
              <Input
                value={passportNumber}
                onChange={(event) => setPassportNumber(event.target.value)}
              />
            </Field>
            <Field>
              <Label optional>Validade</Label>
              <Input
                type="date"
                value={passportExpiresOn}
                onChange={(event) => setPassportExpiresOn(event.target.value)}
              />
            </Field>
          </div>

          {fieldError && !fieldError.campo ? <FieldError>{fieldError.mensagem}</FieldError> : null}
        </form>
      </SheetContent>
    </Sheet>
  );
}

/* =============================================================================
   Lembretes — consome alerts.ts
   ========================================================================== */

function LembretesCard({ contatoId }: { contatoId: string }) {
  const toast = useToast();
  const [status, setStatus] = React.useState<Status>("loading");
  const [tasks, setTasks] = React.useState<TarefaResumo[]>([]);

  const [reloadToken, setReloadToken] = React.useState(0);
  const reload = React.useCallback(() => setReloadToken((token) => token + 1), []);

  React.useEffect(() => {
    let active = true;
    void listarTarefas({ contatoId }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        return;
      }
      setTasks(result.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [contatoId, reloadToken]);

  const scheduleComplete = useDeferredDelete<TarefaResumo>({
    label: (task) => `Concluído: ${task.title}`,
    commit: (task) => concluirTarefa(task.id),
    onFailure: (task, mensagem) => {
      toast.show({ title: "Não consegui concluir", description: mensagem, tone: "danger" });
      reload();
    },
  });

  function handleComplete(task: TarefaResumo) {
    setTasks((current) => current.filter((t) => t.id !== task.id));
    scheduleComplete(task);
  }

  if (status === "loading") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Lembretes</CardTitle>
        </CardHeader>
        <CardBody flush>
          <div className="flex flex-col gap-3 p-4">
            <SkeletonRow />
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lembretes</CardTitle>
      </CardHeader>
      <CardBody flush={status !== "ready" || tasks.length === 0}>
        {status === "error" ? (
          <div className="flex flex-col items-start gap-3 p-4">
            <FieldError>Não consegui carregar os lembretes.</FieldError>
            <Button variant="secondary" size="sm" onClick={reload}>
              Tentar de novo
            </Button>
          </div>
        ) : tasks.length === 0 ? (
          <EmptyState
            compact
            title="Nenhum lembrete pendente"
            description="Passaporte vencendo e aniversário viram lembrete aqui sozinhos, um dia antes de precisar agir."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line-subtle">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-start gap-3 px-4 py-3">
                <Checkbox
                  className="mt-0.5"
                  onCheckedChange={(checked) => {
                    if (checked === true) handleComplete(task);
                  }}
                  aria-label={`Concluir: ${task.title}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-15 font-medium text-ink">{task.title}</p>
                  {task.notes ? <p className="mt-0.5 text-13 text-muted">{task.notes}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/* =============================================================================
   Encerramento — arquivar/restaurar (com desfazer de verdade) e excluir
   (destrutivo, sem endpoint de restauração — ver useDeferredDelete)
   ========================================================================== */

function EncerramentoCard({
  contact,
  onPatched,
}: {
  contact: ContatoDetalhe;
  onPatched: (patch: Partial<ContatoDetalhe>) => void;
}) {
  const router = useRouter();
  const toast = useToast();

  async function handleArchive() {
    const result = await arquivarContato(contact.id);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      toast.show({ title: "Não consegui arquivar", description: result.mensagem, tone: "danger" });
      return;
    }
    onPatched({ arquivado: true });
    toast.undo(`Cliente arquivado: ${contact.name}`, () => {
      void restaurarContato(contact.id).then(() => onPatched({ arquivado: false }));
    });
  }

  async function handleRestore() {
    const result = await restaurarContato(contact.id);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      toast.show({ title: "Não consegui restaurar", description: result.mensagem, tone: "danger" });
      return;
    }
    onPatched({ arquivado: false });
    toast.show({ title: `Cliente restaurado: ${contact.name}`, tone: "ok" });
  }

  const scheduleDelete = useDeferredDelete<{ id: string; name: string }>({
    label: (item) => `Cliente excluído: ${item.name}`,
    commit: (item) => excluirContato(item.id),
    onFailure: (item, mensagem, correcao) => {
      toast.show({
        title: `Não consegui excluir ${item.name}`,
        description: mensagem,
        tone: "danger",
        action: correcao
          ? { label: correcao, onClick: () => void arquivarContato(item.id) }
          : undefined,
      });
    },
  });

  function handleDeleteForever() {
    scheduleDelete({ id: contact.id, name: contact.name });
    router.push("/clientes");
  }

  return (
    <Card tone="inset">
      <CardHeader>
        <CardTitle>Encerramento</CardTitle>
      </CardHeader>
      <CardBody flush>
        <p className="px-4 pt-4 text-13 text-muted">
          Arquivar tira o cliente das listas sem apagar nada — dá para restaurar a qualquer
          hora. Excluir apaga os dados de verdade; depois dos 8 segundos do aviso, não tem
          volta.
        </p>
      </CardBody>
      <CardFooter
        secondary={
          <CardAction className="text-danger hover:text-danger" onClick={handleDeleteForever}>
            Excluir definitivamente
          </CardAction>
        }
        action={
          contact.arquivado ? (
            <Button variant="secondary" onClick={() => void handleRestore()}>
              Restaurar cliente
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => void handleArchive()}>
              Arquivar cliente
            </Button>
          )
        }
      />
    </Card>
  );
}
