"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  atualizarOferta,
  criarOferta,
  listarInteressadosDaOferta,
  listarOfertas,
  obterOferta,
  publicarOferta,
  urlDaVitrine,
  type BlocoDeOferta,
  type InteressadoDaOferta,
  type OfertaResumo,
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
import { Input, Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { CopyIcon, DocumentIcon, PlusIcon } from "@/components/app/icons";
import { KIND_LABEL, CONTENT_FIELDS } from "@/lib/ui/blockContent";
import type { ContentField } from "@/lib/ui/blockContent";
import { TIPO_LABEL, type OfertaTipo } from "@/lib/ui/ofertaTipo";

/* =============================================================================
   Vitrine — a gestão do catálogo público (Fit 7)
   -----------------------------------------------------------------------------
   A oferta é o documento inteiro: ficha (título, tipo, preço, resumo, capa)
   e blocos (os MESMOS do construtor — `PublicBlockSection` renderiza os dois
   lados, então quem escreve aqui e quem lê na `/a/[slug]` não podem divergir).
   Publicar é o interruptor; o link público fica na cabeça da tela para copiar.
   ========================================================================== */

type Status = "loading" | "ready" | "error";

export function VitrineScreen() {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = React.useState<Status>("loading");
  const [ofertas, setOfertas] = React.useState<OfertaResumo[]>([]);
  const [vitrineUrl, setVitrineUrl] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<{ mensagem: string; correcao?: string } | null>(null);
  const [criarOpen, setCriarOpen] = React.useState(false);
  const [editando, setEditando] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    void listarOfertas().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setErro({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setOfertas(result.data);
      setStatus("ready");
    });
    void urlDaVitrine().then((result) => {
      if (!active) return;
      if (result.ok) setVitrineUrl(result.data);
    });
    return () => {
      active = false;
    };
  }, []);

  async function alternarPublicacao(oferta: OfertaResumo) {
    const anterior = ofertas;
    setOfertas((atual) =>
      atual.map((o) => (o.id === oferta.id ? { ...o, publicada: !oferta.publicada } : o)),
    );
    const result = await publicarOferta({ id: oferta.id, publicada: !oferta.publicada });
    if (!result.ok) {
      setOfertas(anterior);
      avisarRecusaDeEscrita(result);
      toast.show({ title: "Não consegui publicar", description: result.mensagem, tone: "danger" });
      return;
    }
    setOfertas((atual) => atual.map((o) => (o.id === oferta.id ? result.data : o)));
  }

  function copiarLink(token: string) {
    const url = `${window.location.origin}${vitrineUrl ?? "/a"}/o/${token}`;
    void navigator.clipboard?.writeText(url);
    toast.show({ title: "Link da oferta copiado", tone: "ok" });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h2 className="display text-32 text-ink">Vitrine</h2>
          <p className="max-w-[36rem] text-15 leading-[1.5] text-muted">
            Seu catálogo público: monte as ofertas com o que você já constrói na
            proposta, publique e divulgue o link.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setCriarOpen(true)}>
          <PlusIcon className="size-4" />
          Nova oferta
        </Button>
      </header>

      {vitrineUrl ? (
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <span className="min-w-0 flex-1 truncate text-13 text-muted">
            Sua página: <span className="text-ink">{vitrineUrl}</span>
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(`${window.location.origin}${vitrineUrl}`);
              toast.show({ title: "Link copiado", tone: "ok" });
            }}
          >
            <CopyIcon className="size-4" />
            Copiar
          </Button>
          <Button variant="secondary" size="sm" onClick={() => router.push(vitrineUrl)}>
            Abrir
          </Button>
        </Card>
      ) : null}

      {status === "loading" ? (
        <Card className="p-4">
          <SkeletonRow />
        </Card>
      ) : status === "error" ? (
        <Card className="flex flex-col items-start gap-3 p-5">
          <FieldError>{erro?.mensagem}</FieldError>
        </Card>
      ) : ofertas.length === 0 ? (
        <EmptyState
          plate
          title="Nenhuma oferta ainda"
          description="Monte a primeira oferta do seu catálogo — pacote, voo, hospedagem, transfer ou serviço — com preço e o que está incluso."
          preview={
            <div className="flex items-center gap-3 px-1 py-2 text-13 text-muted">
              <span className="flex-1">Férias em Portugal — pacote 7 noites</span>
              <span className="tabular-nums">R$ 5.500</span>
            </div>
          }
          action={
            <Button variant="primary" onPointerDown={() => setCriarOpen(true)}>
              <PlusIcon className="size-4" />
              Criar primeira oferta
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {ofertas.map((oferta) => (
            <li
              key={oferta.id}
              className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-1"
            >
              <button
                type="button"
                onClick={() => setEditando(oferta.id)}
                className="flex flex-1 cursor-pointer flex-col text-left"
              >
                {oferta.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- capa da oferta, mesma via da página pública
                  <img src={oferta.coverUrl} alt="" className="aspect-[16/9] w-full object-cover" />
                ) : (
                  <span className="grid aspect-[16/9] w-full place-items-center bg-surface-2">
                    <DocumentIcon className="size-6 text-subtle" />
                  </span>
                )}
                <span className="flex flex-1 flex-col gap-1.5 p-4">
                  <span className="flex items-center gap-2">
                    <span className="text-11 font-semibold uppercase tracking-wider text-subtle">
                      {TIPO_LABEL[oferta.type]}
                    </span>
                    <Badge tone={oferta.publicada ? "ok" : "neutral"} dot size="sm">
                      {oferta.publicada ? "Publicada" : "Rascunho"}
                    </Badge>
                  </span>
                  <span className="text-15 font-medium leading-snug text-ink">{oferta.title}</span>
                  {oferta.summary ? (
                    <span className="line-clamp-2 text-13 leading-[1.5] text-muted">{oferta.summary}</span>
                  ) : null}
                  <span className="mt-auto pt-2">
                    <Money cents={oferta.priceCents} size="20" reserveFor={50_000_000} />
                  </span>
                </span>
              </button>
              <span className="flex items-center gap-1 border-t border-hairline p-2">
                <Button variant="secondary" size="sm" onClick={() => void alternarPublicacao(oferta)}>
                  {oferta.publicada ? "Despublicar" : "Publicar"}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => copiarLink(oferta.publicToken)}>
                  Copiar link
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <OfertaSheet
        open={criarOpen}
        onOpenChange={setCriarOpen}
        onSaved={(oferta) => {
          setOfertas((atual) => [...atual, oferta]);
          setCriarOpen(false);
        }}
      />
      <EditarOfertaSheet
        ofertaId={editando}
        onOpenChange={(open) => {
          if (!open) setEditando(null);
        }}
        onSaved={(atualizada) => {
          setOfertas((atual) =>
            atual.map((o) => (o.id === atualizada.id ? { ...o, ...atualizada, blocks: undefined } : o)),
          );
        }}
      />
    </div>
  );
}

/* -----------------------------------------------------------------------------
   OfertaSheet — criar (ficha básica; blocos entram na edição)
   ------------------------------------------------------------------------- */

function OfertaSheet({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (oferta: OfertaResumo) => void;
}) {
  const [title, setTitle] = React.useState("");
  const [type, setType] = React.useState<OfertaTipo>("pacote");
  const [price, setPrice] = React.useState<number | null>(null);
  const [summary, setSummary] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<{ campo?: string; mensagem: string } | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFieldError(null);
    const result = await criarOferta({
      title,
      type,
      priceCents: price ?? 0,
      summary,
    });
    setSaving(false);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      setFieldError({ campo: result.campo, mensagem: result.mensagem });
      return;
    }
    onSaved(result.data);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        open={open}
        onOpenChange={onOpenChange}
        title="Nova oferta"
        description="A ficha básica agora; o conteúdo (blocos) você monta na edição."
        footer={
          <Button
            variant="primary"
            block
            type="submit"
            form="nova-oferta-form"
            loading={saving}
            disabled={!title.trim()}
          >
            Criar
          </Button>
        }
      >
        <form id="nova-oferta-form" onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <Field invalid={fieldError?.campo === "title"}>
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Férias em Portugal — 7 noites" />
            {fieldError?.campo === "title" ? <FieldError>{fieldError.mensagem}</FieldError> : null}
          </Field>
          <Field invalid={fieldError?.campo === "type"}>
            <Label>Tipo</Label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as OfertaTipo)}
              className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-15 text-ink"
            >
              {(Object.keys(TIPO_LABEL) as OfertaTipo[]).map((t) => (
                <option key={t} value={t}>
                  {TIPO_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field invalid={fieldError?.campo === "priceCents"}>
            <Label optional>Preço</Label>
            <CentsInput cents={price} onCommit={setPrice} invalid={fieldError?.campo === "priceCents"} />
          </Field>
          <Field invalid={fieldError?.campo === "summary"}>
            <Label optional>Resumo</Label>
            <FieldHint>A linha que aparece no catálogo — o que está incluso, para quem é.</FieldHint>
            <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} />
          </Field>
          {fieldError && !fieldError.campo ? <FieldError>{fieldError.mensagem}</FieldError> : null}
        </form>
      </SheetContent>
    </Sheet>
  );
}

/* -----------------------------------------------------------------------------
   EditarOfertaSheet — a ficha + os blocos (o documento inteiro grava junto).
   ------------------------------------------------------------------------- */

function EditarOfertaSheet({
  ofertaId,
  onOpenChange,
  onSaved,
}: {
  ofertaId: string | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (oferta: OfertaResumo) => void;
}) {
  return (
    <Sheet open={ofertaId !== null} onOpenChange={onOpenChange}>
      {ofertaId ? (
        <EditarOfertaForm key={ofertaId} ofertaId={ofertaId} onOpenChange={onOpenChange} onSaved={onSaved} />
      ) : null}
    </Sheet>
  );
}

function EditarOfertaForm({
  ofertaId,
  onOpenChange,
  onSaved,
}: {
  ofertaId: string;
  onOpenChange: (open: boolean) => void;
  onSaved: (oferta: OfertaResumo) => void;
}) {
  const [status, setStatus] = React.useState<"loading" | "ready">("loading");
  const [title, setTitle] = React.useState("");
  const [type, setType] = React.useState<OfertaTipo>("pacote");
  const [price, setPrice] = React.useState<number | null>(0);
  const [summary, setSummary] = React.useState("");
  const [blocks, setBlocks] = React.useState<BlocoDeOferta[]>([]);
  const [interessados, setInteressados] = React.useState<InteressadoDaOferta[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<{ campo?: string; mensagem: string } | null>(null);

  React.useEffect(() => {
    let active = true;
    void obterOferta(ofertaId).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("ready");
        return;
      }
      setTitle(result.data.title);
      setType(result.data.type);
      setPrice(result.data.priceCents);
      setSummary(result.data.summary ?? "");
      setBlocks(result.data.blocks);
      setStatus("ready");
    });
    // Fit 7b — os interessados que a página pública capturou.
    void listarInteressadosDaOferta(ofertaId).then((result) => {
      if (!active) return;
      if (result.ok) setInteressados(result.data);
    });
    return () => {
      active = false;
    };
  }, [ofertaId]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFieldError(null);
    const result = await atualizarOferta({
      id: ofertaId,
      title,
      type,
      priceCents: price ?? 0,
      summary,
      blocks,
    });
    setSaving(false);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      setFieldError({ campo: result.campo, mensagem: result.mensagem });
      return;
    }
    onSaved(result.data);
  }

  function mudarBloco(indice: number, patch: Partial<BlocoDeOferta>) {
    setBlocks((atual) => atual.map((b, i) => (i === indice ? { ...b, ...patch } : b)));
  }

  function mover(indice: number, delta: number) {
    setBlocks((atual) => {
      const proximo = [...atual];
      const destino = indice + delta;
      if (destino < 0 || destino >= proximo.length) return atual;
      [proximo[indice], proximo[destino]] = [proximo[destino]!, proximo[indice]!];
      return proximo;
    });
  }

  return (
    <SheetContent
      open
      onOpenChange={onOpenChange}
      title="Editar oferta"
      description="Os blocos são os mesmos do construtor de proposta — o que você escreve aqui é o que o cliente lê na página."
      footer={
        <Button
          variant="primary"
          block
          type="submit"
          form="editar-oferta-form"
          loading={saving}
        >
          Salvar
        </Button>
      }
    >
      {status === "loading" ? (
        <div className="py-6">
          <SkeletonRow />
        </div>
      ) : (
        <form id="editar-oferta-form" onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <Field invalid={fieldError?.campo === "title"}>
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            {fieldError?.campo === "title" ? <FieldError>{fieldError.mensagem}</FieldError> : null}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label>Tipo</Label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as OfertaTipo)}
                className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-15 text-ink"
              >
                {(Object.keys(TIPO_LABEL) as OfertaTipo[]).map((t) => (
                  <option key={t} value={t}>
                    {TIPO_LABEL[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field invalid={fieldError?.campo === "priceCents"}>
              <Label>Preço</Label>
              <CentsInput cents={price} onCommit={setPrice} invalid={fieldError?.campo === "priceCents"} />
            </Field>
          </div>
          <Field invalid={fieldError?.campo === "summary"}>
            <Label optional>Resumo</Label>
            <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} />
          </Field>

          <div className="flex flex-col gap-2">
            <Label>Blocos</Label>
            {blocks.map((bloco, indice) => {
              const campos = CONTENT_FIELDS[bloco.kind as keyof typeof CONTENT_FIELDS] ?? [];
              return (
                <div key={indice} className="flex flex-col gap-2 rounded-md border border-line p-3">
                  <div className="flex items-center gap-2">
                    <select
                      value={bloco.kind}
                      onChange={(e) => mudarBloco(indice, { kind: e.target.value as BlocoDeOferta["kind"] })}
                      className="h-9 flex-1 rounded-sm border border-line bg-surface px-2 text-13 text-ink"
                    >
                      {Object.entries(KIND_LABEL).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <Button variant="secondary" size="sm" onClick={() => mover(indice, -1)} aria-label="Subir bloco">
                      ↑
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => mover(indice, 1)} aria-label="Descer bloco">
                      ↓
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setBlocks((atual) => atual.filter((_, i) => i !== indice))}
                    >
                      Remover
                    </Button>
                  </div>
                  <Input
                    value={bloco.title ?? ""}
                    onChange={(e) => mudarBloco(indice, { title: e.target.value || null })}
                    placeholder="Título do bloco (opcional)"
                  />
                  {campos.map((campo: ContentField) => (
                    <Input
                      key={campo.key}
                      value={typeof bloco.content?.[campo.key] === "string" ? (bloco.content[campo.key] as string) : ""}
                      onChange={(e) =>
                        mudarBloco(indice, { content: { ...bloco.content, [campo.key]: e.target.value } })
                      }
                      placeholder={campo.placeholder ?? campo.label}
                    />
                  ))}
                  <Textarea
                    value={bloco.body ?? ""}
                    onChange={(e) => mudarBloco(indice, { body: e.target.value || null })}
                    placeholder="Texto do bloco (opcional)"
                    rows={2}
                  />
                </div>
              );
            })}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setBlocks((atual) => [
                  ...atual,
                  { kind: "text", title: null, body: null, images: [], content: {} },
                ])
              }
            >
              <PlusIcon className="size-4" />
              Adicionar bloco
            </Button>
          </div>

          {interessados.length > 0 ? (
            <div className="mt-2 flex flex-col gap-1 rounded-md border border-line p-3">
              <span className="text-13 font-semibold uppercase tracking-wider text-subtle">
                Interessados ({interessados.length})
              </span>
              <ul className="mt-1">
                {interessados.map((pessoa) => (
                  <li key={pessoa.contactId} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-15 text-ink">{pessoa.contactName}</span>
                    {pessoa.whatsapp ? (
                      <a
                        href={`https://wa.me/${pessoa.whatsapp}`}
                        target="_blank"
                        rel="noopener"
                        className="shrink-0 text-13 font-medium text-accent underline underline-offset-2"
                      >
                        WhatsApp
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-13 text-muted">
                Também estão na tela Clientes com a tag “vitrine” — transforme o interesse em negócio pelo funil.
              </p>
            </div>
          ) : null}

          {fieldError && !fieldError.campo ? <FieldError>{fieldError.mensagem}</FieldError> : null}
        </form>
      )}
    </SheetContent>
  );
}
