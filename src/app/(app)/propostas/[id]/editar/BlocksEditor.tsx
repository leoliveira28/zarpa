"use client";

import * as React from "react";
import { Reorder, useDragControls } from "motion/react";
import {
  atualizarBloco,
  criarBloco,
  enviarImagemDaProposta,
  excluirBloco,
  inserirItemDaBibliotecaComoBloco,
  listarBiblioteca,
  reordenarBlocos,
  type BlocoEdicao,
  type BlocoKind,
  type ItemBibliotecaResumo,
  type PropostaEdicao,
} from "@/server";
import { avisarRecusaDeEscrita } from "@/lib/ui/assinatura";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardAction, CardFooter, CardHeader } from "@/components/ui/Card";
import { Field, FieldHint, Label, SavedMark } from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/Input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { Skeleton, SkeletonRow } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { PlusIcon, SearchIcon, UploadIcon } from "@/components/app/icons";
import { CONTENT_FIELDS, KIND_LABEL } from "@/lib/ui/blockContent";
import { cn } from "@/lib/ui/cn";
import { usePrefersReducedMotion } from "@/lib/ui/motion";
import { useAutosave } from "@/lib/ui/useAutosave";

/* =============================================================================
   Blocos — hotel, voo, transfer, passeio, seguro, texto, imagem, nota de preço
   -----------------------------------------------------------------------------
   Reordenação por arrasto com `Reorder.Group`/`Reorder.Item` (motion): a lista
   arrastada só anima `transform`/`opacity` por baixo do capô, e o drag some
   com `prefers-reduced-motion` — sobra a alça de teclado (mover para
   cima/baixo), que nunca depende de gesto. Herdar a velocidade do arremesso
   aqui é o próprio `Reorder`: ele já solta o item na posição projetada pela
   física do gesto, não onde o dedo largou.

   O escopo (proposta inteira × cada opção) é uma aba: `position` é uma
   sequência por escopo no servidor (`escopoDeBlocos`), então misturar blocos
   de escopos diferentes na mesma lista arrastável bagunçaria a posição de
   quem não devia ter mudado.
   ========================================================================== */

const NEW_BLOCK_KINDS: BlocoKind[] = [
  "hotel",
  "flight",
  "transfer",
  "tour",
  "cruise",
  "insurance",
  "text",
  "image",
  "price_note",
];

export function BlocksEditor({
  proposta,
  setBlocks,
}: {
  proposta: PropostaEdicao;
  setBlocks: (updater: (blocks: BlocoEdicao[]) => BlocoEdicao[]) => void;
}) {
  const toast = useToast();
  const reducedMotion = usePrefersReducedMotion();
  const [scope, setScope] = React.useState<string | null>(null); // null = todas as opções
  const [addOpen, setAddOpen] = React.useState(false);
  const [reordering, setReordering] = React.useState(false);

  // A ordem do ARRAY `proposta.blocks` é a verdade local: o servidor entrega
  // `orderBy(asc(position))` e nada aqui reordena por ela de novo. O sort por
  // `position` que existia aqui era o bug do arrasto (achado do PO): o update
  // otimista reordenava o array sem reescrever `position` nos objetos, e o
  // sort devolvia cada bloco ao lugar antigo já no render seguinte — arrastar
  // parecia não fazer nada. (O caminho das opções em PropostaEditorScreen não
  // tem esse problema porque o otimista de lá reescreve `position`.)
  const scoped = proposta.blocks.filter((b) => b.optionId === scope);

  // Trocas DURANTE o arrasto viram só estado local; a rede acontece uma vez,
  // no fim do gesto (onDragEnd). Persistir a cada troca disparava N requests
  // com posições intermediárias correndo em paralelo contra o servidor.
  const ordemPendenteRef = React.useRef<BlocoEdicao[] | null>(null);

  function handleUpdated(updated: BlocoEdicao) {
    setBlocks((current) => current.map((b) => (b.id === updated.id ? updated : b)));
  }

  function handleRemoved(id: string) {
    setBlocks((current) => current.filter((b) => b.id !== id));
  }

  function handleCreated(created: BlocoEdicao) {
    setBlocks((current) => [...current, created]);
    setAddOpen(false);
  }

  function aplicarOrdem(next: BlocoEdicao[]) {
    setBlocks((current) => {
      const others = current.filter((b) => b.optionId !== scope);
      return [...others, ...next];
    });
  }

  async function persistirOrdem(next: BlocoEdicao[]) {
    setReordering(true);
    const result = await reordenarBlocos(
      proposta.id,
      next.map((b, index) => ({ id: b.id, position: index })),
    );
    setReordering(false);
    if (!result.ok) {
      toast.show({ title: "Não consegui salvar a ordem", description: result.mensagem, tone: "danger" });
    }
  }

  return (
    <Card>
      <CardHeader className="flex-col items-stretch gap-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-17 font-semibold text-ink">Blocos</span>
          <span className="text-13 tabular-nums text-muted">{proposta.blocks.length} no total</span>
        </div>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ScopeChip active={scope === null} onClick={() => setScope(null)}>
            Todas as opções
          </ScopeChip>
          {proposta.options
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((option) => (
              <ScopeChip key={option.id} active={scope === option.id} onClick={() => setScope(option.id)}>
                {option.name}
              </ScopeChip>
            ))}
        </div>
      </CardHeader>

      <div className="flex flex-col gap-2 p-3">
        {scoped.length === 0 ? (
          <p className="px-1 py-4 text-13 text-muted">
            Nenhum bloco {scope === null ? "compartilhado" : "nesta opção"} ainda. Adicione hotel,
            voo, transfer, passeio, seguro, uma nota ou um texto livre.
          </p>
        ) : reducedMotion ? (
          <div className="flex flex-col gap-2">
            {scoped.map((block, index) => (
              <BlockCard
                key={block.id}
                block={block}
                proposta={proposta}
                index={index}
                total={scoped.length}
                onMove={(delta) => {
                  const next = [...scoped];
                  const target = index + delta;
                  if (target < 0 || target >= next.length) return;
                  const [item] = next.splice(index, 1);
                  next.splice(target, 0, item!);
                  aplicarOrdem(next);
                  void persistirOrdem(next);
                }}
                onUpdated={handleUpdated}
                onRemoved={() => handleRemoved(block.id)}
              />
            ))}
          </div>
        ) : (
          <Reorder.Group
            axis="y"
            values={scoped}
            onReorder={(next) => {
              aplicarOrdem(next);
              ordemPendenteRef.current = next;
            }}
            className="flex flex-col gap-2"
          >
            {scoped.map((block, index) => (
              <DraggableBlockCard
                key={block.id}
                block={block}
                proposta={proposta}
                index={index}
                total={scoped.length}
                onDragEnd={() => {
                  const pendente = ordemPendenteRef.current;
                  ordemPendenteRef.current = null;
                  if (pendente) void persistirOrdem(pendente);
                }}
                onUpdated={handleUpdated}
                onRemoved={() => handleRemoved(block.id)}
              />
            ))}
          </Reorder.Group>
        )}
        {reordering ? <p className="px-1 text-13 text-muted">Salvando ordem…</p> : null}
      </div>

      <CardFooter
        action={
          <Button variant="secondary" size="sm" onPointerDown={() => setAddOpen(true)}>
            <PlusIcon className="size-4" />
            Adicionar bloco
          </Button>
        }
      >
        {scope === null ? "Aparece em todas as opções" : "Só nesta opção"}
      </CardFooter>

      <AddBlockSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        proposta={proposta}
        scope={scope}
        onCreated={handleCreated}
      />
    </Card>
  );
}

function ScopeChip({
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
      onPointerDown={onClick}
      className={cn(
        "shrink-0 rounded-pill px-3 py-1.5 text-13 font-medium whitespace-nowrap",
        active ? "bg-accent text-on-accent" : "bg-surface-2 text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function DraggableBlockCard({
  block,
  proposta,
  index,
  total,
  onDragEnd,
  onUpdated,
  onRemoved,
}: {
  block: BlocoEdicao;
  proposta: PropostaEdicao;
  index: number;
  total: number;
  onDragEnd: () => void;
  onUpdated: (block: BlocoEdicao) => void;
  onRemoved: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={block}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      className="list-none"
    >
      <BlockCard
        block={block}
        proposta={proposta}
        index={index}
        total={total}
        dragHandle={
          <button
            type="button"
            aria-label="Arrastar para reordenar"
            onPointerDown={(event) => controls.start(event)}
            className="grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-md text-subtle hover:bg-surface-3 hover:text-muted active:cursor-grabbing"
          >
            <GripGlyph />
          </button>
        }
        onUpdated={onUpdated}
        onRemoved={onRemoved}
      />
    </Reorder.Item>
  );
}

function GripGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden>
      <circle cx="5" cy="4" r="1.15" />
      <circle cx="5" cy="8" r="1.15" />
      <circle cx="5" cy="12" r="1.15" />
      <circle cx="11" cy="4" r="1.15" />
      <circle cx="11" cy="8" r="1.15" />
      <circle cx="11" cy="12" r="1.15" />
    </svg>
  );
}

function BlockCard({
  block,
  proposta,
  index,
  total,
  dragHandle,
  onMove,
  onUpdated,
  onRemoved,
}: {
  block: BlocoEdicao;
  proposta: PropostaEdicao;
  index: number;
  total: number;
  dragHandle?: React.ReactNode;
  onMove?: (delta: number) => void;
  onUpdated: (block: BlocoEdicao) => void;
  onRemoved: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = React.useState(block.title ?? "");
  const [body, setBody] = React.useState(block.body ?? "");
  const [content, setContent] = React.useState<Record<string, unknown>>(block.content);
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const autosave = useAutosave(
    async (patch: { title: string; body: string; content: Record<string, unknown> }) => {
      const result = await atualizarBloco(block.id, patch);
      if (result.ok) onUpdated(result.data);
      return result;
    },
    { debounceMs: 700 },
  );

  function updateField(next: Partial<{ title: string; body: string; content: Record<string, unknown> }>) {
    const nextTitle = next.title ?? title;
    const nextBody = next.body ?? body;
    const nextContent = next.content ?? content;
    if (next.title !== undefined) setTitle(next.title);
    if (next.body !== undefined) setBody(next.body);
    if (next.content !== undefined) setContent(next.content);
    autosave.schedule({ title: nextTitle, body: nextBody, content: nextContent });
  }

  const scheduleDelete = React.useCallback(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      const result = await excluirBloco(block.id);
      if (!result.ok) {
        avisarRecusaDeEscrita(result);
        toast.show({ title: "Não consegui remover o bloco", description: result.mensagem, tone: "danger" });
      }
    }, 8000);
    toast.undo(`Bloco removido: ${block.title || KIND_LABEL[block.kind as BlocoKind]}`, () => {
      cancelled = true;
      window.clearTimeout(timer);
    }, { duration: 8000 });
  }, [block.id, block.kind, block.title, toast]);

  async function handleUpload(file: File) {
    setUploading(true);
    const result = await enviarImagemDaProposta(file);
    setUploading(false);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      toast.show({ title: "Não consegui enviar a imagem", description: result.mensagem, tone: "danger" });
      return;
    }
    const nextImages = [...block.images, result.data.url].slice(0, 10);
    const patch = await atualizarBloco(block.id, { images: nextImages });
    if (patch.ok) onUpdated(patch.data);
  }

  async function handleScopeChange(value: string) {
    const optionId = value === "all" ? null : value;
    const result = await atualizarBloco(block.id, { optionId });
    if (result.ok) onUpdated(result.data);
  }

  const fields = CONTENT_FIELDS[block.kind as BlocoKind] ?? [];

  return (
    <Card tone="inset" className="border-0">
      <div className="flex items-center gap-2 px-3 pt-3">
        {dragHandle ?? (
          <div className="flex shrink-0 flex-col">
            <button
              type="button"
              aria-label="Mover para cima"
              disabled={index === 0}
              onPointerDown={() => onMove?.(-1)}
              className="grid size-6 place-items-center rounded-sm text-subtle hover:text-ink disabled:opacity-30"
            >
              ▲
            </button>
            <button
              type="button"
              aria-label="Mover para baixo"
              disabled={index === total - 1}
              onPointerDown={() => onMove?.(1)}
              className="grid size-6 place-items-center rounded-sm text-subtle hover:text-ink disabled:opacity-30"
            >
              ▼
            </button>
          </div>
        )}
        <Badge tone="neutral">{KIND_LABEL[block.kind as BlocoKind]}</Badge>
        <div className="ml-auto flex items-center gap-2">
          <SavedMark state={autosave.state} />
          <CardAction
            className="text-danger hover:text-danger"
            onClick={() => {
              onRemoved();
              scheduleDelete();
            }}
          >
            Remover
          </CardAction>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-3">
        {proposta.options.length > 0 ? (
          <Field>
            <Label optional>Aparece em</Label>
            <Select value={block.optionId ?? "all"} onValueChange={(v) => void handleScopeChange(v)}>
              <SelectTrigger size="sm">
                <SelectValue>
                  {block.optionId
                    ? proposta.options.find((o) => o.id === block.optionId)?.name ?? "Opção removida"
                    : "Todas as opções"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as opções</SelectItem>
                {proposta.options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}

        <Field>
          <Label optional>Título</Label>
          <Input
            size="sm"
            value={title}
            onChange={(event) => updateField({ title: event.target.value })}
            placeholder={KIND_LABEL[block.kind as BlocoKind]}
          />
        </Field>

        {fields.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <Field key={field.key}>
                <Label optional>{field.label}</Label>
                <Input
                  size="sm"
                  type={field.type ?? "text"}
                  placeholder={field.placeholder}
                  value={typeof content[field.key] === "string" ? (content[field.key] as string) : ""}
                  onChange={(event) => updateField({ content: { ...content, [field.key]: event.target.value } })}
                />
              </Field>
            ))}
          </div>
        ) : null}

        <Field>
          <Label optional>{block.kind === "price_note" ? "Texto" : "Descrição"}</Label>
          <Textarea
            value={body}
            onChange={(event) => updateField({ body: event.target.value })}
            placeholder="Detalhes que ajudam o cliente a decidir…"
            rows={2}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          {block.images.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={url}
              src={url}
              alt=""
              className="size-14 shrink-0 rounded-md object-cover"
            />
          ))}
          <button
            type="button"
            onPointerDown={() => fileInputRef.current?.click()}
            disabled={uploading || block.images.length >= 10}
            className="flex h-14 w-14 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line text-subtle hover:border-line-strong hover:text-muted disabled:opacity-45"
          >
            <UploadIcon className="size-4" />
            <span className="text-13 leading-none">{uploading ? "…" : "Foto"}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void handleUpload(file);
            }}
          />
        </div>
      </div>
    </Card>
  );
}

/* =============================================================================
   Adicionar bloco — novo, ou copiado da biblioteca
   ========================================================================== */

function AddBlockSheet({
  open,
  onOpenChange,
  proposta,
  scope,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposta: PropostaEdicao;
  scope: string | null;
  onCreated: (block: BlocoEdicao) => void;
}) {
  const toast = useToast();
  const [tab, setTab] = React.useState<"novo" | "biblioteca">("novo");
  const [creating, setCreating] = React.useState<BlocoKind | null>(null);

  async function handleCreateKind(kind: BlocoKind) {
    setCreating(kind);
    const result = await criarBloco(proposta.id, { kind, optionId: scope });
    setCreating(null);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      toast.show({ title: "Não consegui adicionar o bloco", description: result.mensagem, tone: "danger" });
      return;
    }
    onCreated(result.data);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent open={open} onOpenChange={onOpenChange} title="Adicionar bloco" description={scope === null ? "Vai aparecer em todas as opções" : "Vai aparecer só nesta opção"}>
        <div className="flex gap-1 py-2">
          <TabButton active={tab === "novo"} onClick={() => setTab("novo")}>
            Novo
          </TabButton>
          <TabButton active={tab === "biblioteca"} onClick={() => setTab("biblioteca")}>
            Da biblioteca
          </TabButton>
        </div>

        {tab === "novo" ? (
          <div className="grid grid-cols-2 gap-2 py-2 sm:grid-cols-3">
            {NEW_BLOCK_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                disabled={creating !== null}
                onPointerDown={() => void handleCreateKind(kind)}
                className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-md border border-line px-2 py-3 text-center hover:border-line-strong hover:bg-surface-2 disabled:opacity-50"
              >
                <span className="text-15 font-medium text-ink">{KIND_LABEL[kind]}</span>
                {creating === kind ? <span className="text-13 text-muted">Criando…</span> : null}
              </button>
            ))}
          </div>
        ) : (
          <LibraryPicker
            proposta={proposta}
            scope={scope}
            onInserted={(block) => onCreated(block)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function TabButton({
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
      onPointerDown={onClick}
      className={cn(
        "min-h-9 rounded-md px-3 text-13 font-medium",
        active ? "bg-accent-soft text-accent-soft-ink" : "text-muted hover:bg-surface-3 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function LibraryPicker({
  proposta,
  scope,
  onInserted,
}: {
  proposta: PropostaEdicao;
  scope: string | null;
  onInserted: (block: BlocoEdicao) => void;
}) {
  const toast = useToast();
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [items, setItems] = React.useState<ItemBibliotecaResumo[]>([]);
  const [inserting, setInserting] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void listarBiblioteca({ busca: query || undefined }).then((result) => {
        if (!active) return;
        if (!result.ok) {
          setStatus("error");
          return;
        }
        setItems(result.data);
        setStatus("ready");
      });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  async function handleInsert(item: ItemBibliotecaResumo) {
    setInserting(item.id);
    const result = await inserirItemDaBibliotecaComoBloco(proposta.id, item.id, scope);
    setInserting(null);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      toast.show({ title: "Não consegui inserir", description: result.mensagem, tone: "danger" });
      return;
    }
    onInserted(result.data);
  }

  return (
    <div className="flex flex-col gap-3 py-2">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Buscar no acervo"
        prefix={<SearchIcon className="size-4" />}
      />
      {status === "loading" ? (
        <div className="flex flex-col gap-3">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : status === "error" ? (
        <p className="text-13 text-muted">Não consegui carregar o acervo.</p>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-13 text-muted">Nada no acervo ainda.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-subtle">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-15 text-ink">{item.title}</span>
                <span className="flex items-center gap-1.5 text-13 text-muted">
                  {KIND_LABEL[item.kind as BlocoKind] ?? item.kind}
                  {item.isGlobal ? <Badge tone="neutral">Modelo</Badge> : null}
                </span>
              </span>
              <Button
                variant="secondary"
                size="sm"
                loading={inserting === item.id}
                onPointerDown={() => void handleInsert(item)}
              >
                Inserir
              </Button>
            </li>
          ))}
        </ul>
      )}
      <FieldHint>Inserir copia o item para dentro da proposta — editar depois não muda o acervo.</FieldHint>
    </div>
  );
}
