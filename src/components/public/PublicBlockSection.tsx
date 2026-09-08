import { Badge } from "@/components/ui/Badge";
import { CONTENT_FIELDS, KIND_LABEL } from "@/lib/ui/blockContent";

/* =============================================================================
   PublicBlockSection — um bloco lido pelo cliente final, sem login
   -----------------------------------------------------------------------------
   Extraída da proposta pública (`/p/[slug]`) para o roteiro (`/r/[slug]`)
   renderizar os MESMOS blocos com o MESMO vocabulário — `CONTENT_FIELDS`/
   `KIND_LABEL` de `@/lib/ui/blockContent` garantem que "Check-in" se chame
   Check-in nas duas telas, porque quem escreve no construtor e quem lê na
   pública não podem divergir.

   O tipo aceita QUALQUER objeto com esta forma — o bloco ao vivo da proposta
   (`PropostaPublica["blocks"][number]`) e o snapshot do roteiro
   (`BlocoDoRoteiro`) têm campos a mais (id, position, linhagem interna) que
   simplesmente não interessam aqui.

   Server-compatible de propósito (sem `"use client"`, sem hook).
   ========================================================================== */

export type PublicBlockInput = {
  kind: string;
  title: string | null;
  body: string | null;
  images: string[];
  content: Record<string, unknown>;
};

export function PublicBlockSection({
  block,
  compact,
}: {
  block: PublicBlockInput;
  /** Dentro de um cartão de opção: títulos um passo menor. */
  compact?: boolean;
}) {
  const fields = CONTENT_FIELDS[block.kind as keyof typeof CONTENT_FIELDS] ?? [];
  const entries = fields
    .map((field) => ({ label: field.label, value: block.content[field.key] }))
    .filter((entry): entry is { label: string; value: string } => typeof entry.value === "string" && entry.value.trim() !== "");

  if (block.kind === "image" && block.images.length === 0 && !block.title && !block.body) return null;
  if (entries.length === 0 && !block.title && !block.body && block.images.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {block.kind !== "text" && block.kind !== "image" ? (
          <Badge tone="neutral">{KIND_LABEL[block.kind as keyof typeof KIND_LABEL] ?? block.kind}</Badge>
        ) : null}
        {block.title ? (
          <h4 className={compact ? "text-15 font-semibold text-ink" : "text-17 font-semibold text-ink"}>
            {block.title}
          </h4>
        ) : null}
      </div>

      {entries.length > 0 ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-13 sm:grid-cols-2">
          {entries.map((entry) => (
            <div key={entry.label} className="flex justify-between gap-3 sm:justify-start">
              <dt className="text-muted">{entry.label}</dt>
              <dd className="font-medium text-ink">{entry.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {block.body ? (
        <p className="text-15 leading-[1.5] whitespace-pre-line text-ink">{block.body}</p>
      ) : null}

      {block.images.length > 0 ? (
        <div className="mt-1 flex gap-2 overflow-x-auto">
          {block.images.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={url} src={url} alt="" className="h-32 shrink-0 rounded-md object-cover" />
          ))}
        </div>
      ) : null}
    </div>
  );
}
