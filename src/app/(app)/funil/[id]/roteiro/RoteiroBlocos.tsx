"use client";

import * as React from "react";
import { Reorder, useDragControls } from "motion/react";
import { enviarImagemDaProposta, type BlocoDoRoteiro } from "@/server";
import { avisarRecusaDeEscrita } from "@/lib/ui/assinatura";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardAction, CardFooter, CardHeader } from "@/components/ui/Card";
import { Field, Label } from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/Input";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { PlusIcon, UploadIcon } from "@/components/app/icons";
import { cn } from "@/lib/ui/cn";
import { usePrefersReducedMotion } from "@/lib/ui/motion";
import {
  MODELOS_DO_ROTEIRO,
  blocoNovoDeModelo,
  fieldsDoBloco,
  rotuloDoBloco,
  secaoDoBloco,
  textoOuNulo,
  usaCorpo,
  type ItemBloco,
  type ModeloDeBloco,
} from "@/lib/ui/roteiroConteudo";

/* =============================================================================
   Blocos do roteiro — a lista arrastável, irmã da lista do editor de proposta
   -----------------------------------------------------------------------------
   Mesma gramática de `BlocksEditor.tsx`: `Reorder.Group`/`Reorder.Item` para o
   arrasto (anima transform, herda a velocidade do gesto, some com
   prefers-reduced-motion — sobra a alça de teclado), patch local IMEDIATO a
   cada tecla e a rede por conta do autosave do pai.

   A diferença é a GRANULARIDADE DA REDE: aqui não existe action por bloco — o
   snapshot do roteiro é gravado inteiro por um contrato só. Então "Remover"
   vira estado local + autosave, e o desfazer de 8s restaura o array anterior
   (que volta a ir inteiro no próximo salvamento — idempotente do lado de lá).
   ========================================================================== */

const LIMITE_DE_FOTOS = 10;
/** O teto do servidor (`atualizarConteudoDoRoteiro`, rafa §10) — a UI mostra
 * ANTES do clique que ele existe, em vez de deixar a recusa chegar depois. */
const TETO_DE_BLOCOS = 100;

export function RoteiroBlocos({
  itens,
  erroNoBloco,
  onSegurar,
  onAplicar,
  onConfirmar,
}: {
  itens: ItemBloco[];
  /** Índice (0-based) do bloco apontado pela portaria do servidor — fica aceso. */
  erroNoBloco: number | null;
  /** Trocas DURANTE o arrasto: só estado local. */
  onSegurar: (update: (current: ItemBloco[]) => ItemBloco[]) => void;
  /** Mudanças de conteúdo: estado local + autosave com debounce. */
  onAplicar: (update: (current: ItemBloco[]) => ItemBloco[]) => void;
  /** Ordem FINAL (fim do arrasto, teclado): estado local + salvamento imediato. */
  onConfirmar: (update: (current: ItemBloco[]) => ItemBloco[]) => void;
}) {
  const toast = useToast();
  const reducedMotion = usePrefersReducedMotion();
  const [addOpen, setAddOpen] = React.useState(false);
  const noTeto = itens.length >= TETO_DE_BLOCOS;

  const ordemPendenteRef = React.useRef<ItemBloco[] | null>(null);

  function handleCriar(modelo: ModeloDeBloco) {
    if (noTeto) return;
    onAplicar((current) => [...current, { chave: chaveLocal(), bloco: blocoNovoDeModelo(modelo, current.length) }]);
    setAddOpen(false);
  }

  function handleRemover(item: ItemBloco) {
    const anterior = itens;
    onAplicar((current) => current.filter((candidato) => candidato.chave !== item.chave));
    toast.undo(
      `Bloco removido: ${rotuloDoBloco(item.bloco)}`,
      () => onConfirmar(() => anterior),
      { duration: 8000 },
    );
  }

  function mover(item: ItemBloco, delta: -1 | 1) {
    const index = itens.findIndex((candidato) => candidato.chave === item.chave);
    const alvo = index + delta;
    if (index < 0 || alvo < 0 || alvo >= itens.length) return;
    const next = [...itens];
    const [retirado] = next.splice(index, 1);
    next.splice(alvo, 0, retirado!);
    onConfirmar(() => next);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <span className="text-17 font-semibold text-ink">Blocos</span>
          <span className="text-13 tabular-nums text-muted">{itens.length} no total</span>
        </div>
      </CardHeader>

      <div className="flex flex-col gap-2 p-3">
        {itens.length === 0 ? (
          <p className="px-1 py-4 text-13 text-muted">
            Comece por um <span className="font-medium text-ink">Dia</span> — depois entram as
            paradas, a hospedagem, as dicas e o contato de emergência.
          </p>
        ) : reducedMotion ? (
          <div className="flex flex-col gap-2">
            {itens.map((item, index) => (
              <BlocoCard
                key={item.chave}
                item={item}
                index={index}
                total={itens.length}
                comErro={erroNoBloco === index}
                onMove={(delta) => mover(item, delta)}
                onAtualizar={(bloco) =>
                  onAplicar((current) =>
                    current.map((candidato) => (candidato.chave === item.chave ? { ...candidato, bloco } : candidato)),
                  )
                }
                onRemover={() => handleRemover(item)}
              />
            ))}
          </div>
        ) : (
          <Reorder.Group
            axis="y"
            values={itens}
            onReorder={(next) => {
              onSegurar(() => next);
              ordemPendenteRef.current = next;
            }}
            className="flex flex-col gap-2"
          >
            {itens.map((item, index) => (
              <BlocoArrastavel
                key={item.chave}
                item={item}
                index={index}
                total={itens.length}
                comErro={erroNoBloco === index}
                onDragEnd={() => {
                  const pendente = ordemPendenteRef.current;
                  ordemPendenteRef.current = null;
                  if (pendente) onConfirmar(() => pendente);
                }}
                onAtualizar={(bloco) =>
                  onAplicar((current) =>
                    current.map((candidato) => (candidato.chave === item.chave ? { ...candidato, bloco } : candidato)),
                  )
                }
                onRemover={() => handleRemover(item)}
              />
            ))}
          </Reorder.Group>
        )}
      </div>

      <CardFooter
        action={
          <Button
            variant="secondary"
            size="sm"
            onPointerDown={() => setAddOpen(true)}
            disabled={noTeto}
          >
            <PlusIcon className="size-4" />
            Adicionar bloco
          </Button>
        }
      >
        {noTeto
          ? `${TETO_DE_BLOCOS} blocos é o teto do roteiro.`
          : "De cima a baixo é a ordem da página."}
      </CardFooter>

      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent
          open={addOpen}
          onOpenChange={setAddOpen}
          title="Adicionar bloco"
          description="O que o cliente precisa ter em mãos nesta parte da viagem."
        >
          <div className="flex flex-col gap-2 py-2">
            {MODELOS_DO_ROTEIRO.map((modelo) => (
              <button
                key={modelo.id}
                type="button"
                onPointerDown={() => handleCriar(modelo)}
                className="flex min-h-14 items-center justify-between gap-3 rounded-md border border-line px-4 py-3 text-left [transition:transform_120ms_var(--curve-out)] hover:border-line-strong active:scale-[0.995]"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-15 font-medium text-ink">{modelo.label}</span>
                  <span className="text-13 text-muted">{modelo.descricao}</span>
                </span>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </Card>
  );
}

function chaveLocal(): string {
  return `novo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function BlocoArrastavel({
  item,
  index,
  total,
  comErro,
  onDragEnd,
  onAtualizar,
  onRemover,
}: {
  item: ItemBloco;
  index: number;
  total: number;
  comErro: boolean;
  onDragEnd: () => void;
  onAtualizar: (bloco: BlocoDoRoteiro) => void;
  onRemover: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      className="list-none"
    >
      <BlocoCard
        item={item}
        index={index}
        total={total}
        comErro={comErro}
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
        onAtualizar={onAtualizar}
        onRemover={onRemover}
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

/* -----------------------------------------------------------------------------
   O card de um bloco — título, campos do modelo, corpo e fotos. Tudo
   controlado pelo estado do pai: a prévia reflete a cada tecla.
   -------------------------------------------------------------------------- */

function BlocoCard({
  item,
  index,
  total,
  comErro = false,
  dragHandle,
  onMove,
  onAtualizar,
  onRemover,
}: {
  item: ItemBloco;
  index: number;
  total: number;
  /** A portaria do servidor apontou este bloco (chave proibida no `content`). */
  comErro?: boolean;
  dragHandle?: React.ReactNode;
  onMove?: (delta: -1 | 1) => void;
  onAtualizar: (bloco: BlocoDoRoteiro) => void;
  onRemover: () => void;
}) {
  const toast = useToast();
  const { bloco } = item;
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const secao = secaoDoBloco(bloco.content);
  const modelo = MODELOS_DO_ROTEIRO.find((candidato) => candidato.secao === secao);
  const fields = fieldsDoBloco(bloco);
  const comCorpo = usaCorpo(bloco);

  /** Nota de preço: §4 — existe no snapshot, não vai ao ar, não se edita aqui. */
  if (bloco.kind === "price_note") {
    return (
      <div className="flex flex-col gap-0.5 rounded-md bg-surface-3 px-4 py-3">
        <p className="text-13 text-ink">
          <span className="font-medium">Nota de preço</span> — não vai ao ar no roteiro: preço é
          da proposta, nunca do guia.
        </p>
        <p className="text-13 text-muted">Ela continua na proposta; o cliente não lê este bloco aqui.</p>
      </div>
    );
  }

  function atualizar(patch: Partial<Pick<BlocoDoRoteiro, "title" | "body" | "content" | "images">>) {
    onAtualizar({
      kind: bloco.kind,
      position: bloco.position,
      title: patch.title !== undefined ? textoOuNulo(patch.title) : bloco.title,
      body: patch.body !== undefined ? textoOuNulo(patch.body) : bloco.body,
      images: patch.images ?? bloco.images,
      content: patch.content ?? bloco.content,
    });
  }

  async function handleUpload(file: File) {
    setUploading(true);
    // Mesma infra do editor de proposta — um caminho só de upload no produto.
    const result = await enviarImagemDaProposta(file);
    setUploading(false);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      toast.show({ title: "Não consegui enviar a imagem", description: result.mensagem, tone: "danger" });
      return;
    }
    atualizar({ images: [...bloco.images, result.data.url].slice(0, LIMITE_DE_FOTOS) });
  }

  return (
    <Card
      tone="inset"
      className={cn("border-0", comErro && "ring-1 ring-danger")}
    >
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
              <ChevronGlyph up />
            </button>
            <button
              type="button"
              aria-label="Mover para baixo"
              disabled={index === total - 1}
              onPointerDown={() => onMove?.(1)}
              className="grid size-6 place-items-center rounded-sm text-subtle hover:text-ink disabled:opacity-30"
            >
              <ChevronGlyph />
            </button>
          </div>
        )}
        <Badge tone="neutral">{rotuloDoBloco(bloco)}</Badge>
        <div className="ml-auto flex items-center gap-2">
          <CardAction className="text-danger hover:text-danger" onClick={onRemover}>
            Remover
          </CardAction>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-3">
        <Field>
          <Label optional>Título</Label>
          <Input
            size="sm"
            value={bloco.title ?? ""}
            onChange={(event) => atualizar({ title: event.target.value })}
            placeholder={modelo?.placeholderTitulo ?? "Título"}
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
                  value={typeof bloco.content[field.key] === "string" ? (bloco.content[field.key] as string) : ""}
                  onChange={(event) =>
                    atualizar({ content: { ...bloco.content, [field.key]: event.target.value } })
                  }
                />
              </Field>
            ))}
          </div>
        ) : null}

        {comCorpo ? (
          <Field>
            <Label optional>Descrição</Label>
            <Textarea
              value={bloco.body ?? ""}
              onChange={(event) => atualizar({ body: event.target.value })}
              placeholder="O que o cliente precisa saber aqui…"
              rows={3}
            />
          </Field>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {bloco.images.map((url) => (
            <div key={url} className="relative size-14 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="size-14 rounded-md object-cover" />
              <button
                type="button"
                aria-label="Remover imagem"
                onPointerDown={() => atualizar({ images: bloco.images.filter((candidata) => candidata !== url) })}
                className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border border-line bg-surface text-subtle hover:text-ink"
              >
                <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
                  <path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
          <button
            type="button"
            onPointerDown={() => fileInputRef.current?.click()}
            disabled={uploading || bloco.images.length >= LIMITE_DE_FOTOS}
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

function ChevronGlyph({ up = false }: { up?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={up ? "size-3.5" : "size-3.5 rotate-180"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 10 L8 5 L13 10" />
    </svg>
  );
}
