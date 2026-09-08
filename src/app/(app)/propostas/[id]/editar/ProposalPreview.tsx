"use client";

import * as React from "react";
import type { BlocoEdicao, BlocoKind, OpcaoEdicao, PropostaEdicao } from "@/server";
import { Badge } from "@/components/ui/Badge";
import { Money } from "@/components/ui/Money";
import { ArchPlate, Rule } from "@/components/plates";
import { formatDayMonth } from "@/lib/ui/format";
import { CONTENT_FIELDS } from "@/lib/ui/blockContent";

/* =============================================================================
   Prévia — o registro editorial dentro do miolo silencioso
   -----------------------------------------------------------------------------
   "O link web é o produto": esta é uma aproximação HONESTA da proposta
   pública (S7, ainda não existe — docs/handoffs/rafa-para-nina.md), não a
   página de verdade. Por isso ela nunca importa `costCents`/`commissionCents`
   nem qualquer campo de auditoria — mesmo rodando dentro do construtor
   autenticado, ela é o rascunho do que o CLIENTE vai ver, e o cliente não vê
   margem. Tipografia como imagem (display, peso em vez de itálico), margem
   de livro, o arco como divisor de seção — o único lugar do app onde isso
   é permitido fora da proposta pública de verdade.
   ========================================================================== */

export function ProposalPreview({ proposta }: { proposta: PropostaEdicao }) {
  const sharedBlocks = proposta.blocks
    .filter((b) => b.optionId === null)
    .sort((a, b) => a.position - b.position);
  const options = [...proposta.options].sort((a, b) => a.position - b.position);

  return (
    <article className="mx-auto flex max-w-[36rem] flex-col gap-8 rounded-lg bg-surface px-6 py-8 shadow-1 sm:px-10 sm:py-12">
      <header className="flex flex-col gap-3">
        <p className="text-13 tracking-[0.08em] text-muted uppercase">Proposta de viagem</p>
        <h1 className="display text-32 text-ink">{proposta.title}</h1>
        {proposta.summary ? <p className="text-17 leading-[1.5] text-muted">{proposta.summary}</p> : null}
        {proposta.validUntil ? (
          <p className="text-13 text-muted">
            Válida até {formatDayMonth(new Date(`${proposta.validUntil}T00:00:00`))}
          </p>
        ) : null}
      </header>

      {sharedBlocks.length > 0 ? (
        <section className="flex flex-col gap-5">
          {sharedBlocks.map((block) => (
            <BlockPreview key={block.id} block={block} />
          ))}
        </section>
      ) : null}

      {options.length > 0 ? (
        <section className="flex flex-col gap-8">
          <div className="flex items-center gap-4">
            <ArchPlate size={40} className="shrink-0 text-muted" />
            <h2 className="display text-20 text-ink">
              {options.length > 1 ? "Escolha sua opção" : "Sua opção"}
            </h2>
          </div>

          <div
            className="grid gap-6"
            style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 2)}, minmax(0, 1fr))` }}
          >
            {options.map((option) => (
              <OptionPreview
                key={option.id}
                option={option}
                blocks={proposta.blocks.filter((b) => b.optionId === option.id).sort((a, b) => a.position - b.position)}
                currency={proposta.currency}
              />
            ))}
          </div>
        </section>
      ) : (
        <p className="text-15 text-muted">Nenhuma opção ainda — adicione uma para o cliente ver preço.</p>
      )}

      {proposta.terms ? (
        <section className="flex flex-col">
          <Rule loose />
          <p className="text-13 leading-[1.5] whitespace-pre-line text-muted">{proposta.terms}</p>
        </section>
      ) : null}
    </article>
  );
}

function OptionPreview({
  option,
  blocks,
  currency,
}: {
  option: OpcaoEdicao;
  blocks: BlocoEdicao[];
  currency: string;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-md bg-surface-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-17 font-semibold text-ink">{option.name}</h3>
        {option.isRecommended ? <Badge tone="accent">Recomendada</Badge> : null}
      </div>
      {option.description ? <p className="text-13 text-muted">{option.description}</p> : null}

      <div className="flex flex-col gap-0.5">
        <Money cents={option.priceCents} size="20" align="left" />
        <span className="text-13 text-muted">{currency}</span>
        {option.installments && option.installmentCents ? (
          <span className="text-13 tabular-nums text-muted">
            ou {option.installments}x de <Money cents={option.installmentCents} size="13" align="left" tone="muted" />
          </span>
        ) : null}
      </div>

      {blocks.length > 0 ? (
        <div className="flex flex-col gap-4">
          {blocks.map((block) => (
            <BlockPreview key={block.id} block={block} compact />
          ))}
        </div>
      ) : (
        <p className="text-13 text-muted">Sem itens ainda.</p>
      )}
    </div>
  );
}

function BlockPreview({ block, compact }: { block: BlocoEdicao; compact?: boolean }) {
  // Mesmo vocabulário, ordem e formato da proposta pública de verdade
  // (`CONTENT_FIELDS`, em blockContent.ts). Iterar o objeto cru era renderizar
  // a ordem de chaves do jsonb do Postgres (tamanho, depois alfabético) com
  // rótulo em inglês — o "to sdu / from sjp / airline gol" do achado do PO.
  const fields = CONTENT_FIELDS[block.kind as BlocoKind] ?? [];
  const entries = fields
    .map((field) => ({ label: field.label, value: block.content[field.key] }))
    .filter(
      (entry): entry is { label: string; value: string } =>
        typeof entry.value === "string" && entry.value.trim() !== "",
    );

  if (block.kind === "image" && block.images.length === 0 && !block.title && !block.body) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {block.title ? (
        <h4 className={compact ? "text-15 font-medium text-ink" : "text-17 font-medium text-ink"}>
          {block.title}
        </h4>
      ) : null}
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
      {block.body ? <p className="text-15 leading-[1.5] whitespace-pre-line text-ink">{block.body}</p> : null}
      {block.images.length > 0 ? (
        <div className="mt-1 flex gap-2 overflow-x-auto">
          {block.images.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={url} src={url} alt="" className="h-28 shrink-0 rounded-md object-cover" />
          ))}
        </div>
      ) : null}
    </div>
  );
}
