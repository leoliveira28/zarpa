"use client";

import * as React from "react";
import { registrarVisitaProposta, aceitarOpcaoPublica, type PropostaPublica } from "@/server";
import { Badge } from "@/components/ui/Badge";
import { Money } from "@/components/ui/Money";
import { ArchPlate, BiplanePlate, Rule } from "@/components/plates";
import { ChatIcon } from "@/components/app/icons";
import { CONTENT_FIELDS, KIND_LABEL } from "@/lib/ui/blockContent";
import { cn } from "@/lib/ui/cn";
import { formatBRL, formatDayMonth } from "@/lib/ui/format";
import { APP_NAME } from "@/lib/ui/brand";

/* =============================================================================
   A proposta pública — registro editorial pleno (CLAUDE.md > Regras de
   interface > "Os dois registros")
   -----------------------------------------------------------------------------
   Esta é a ÚNICA tela que o cliente final do agente vê: sem login, sem
   AppShell, sem nenhuma navegação nossa. Tipografia como imagem na capa,
   margem de livro, o arco (`ArchPlate`) como divisor de seção — o oposto do
   miolo silencioso do resto do app.

   Nunca importa nada de `OpcaoEdicao`/`obterPropostaParaEdicao`: o tipo que
   chega aqui (`PropostaPublica`, de `@/server`) já veio filtrado por coluna
   pela função `SECURITY DEFINER` do lado do servidor — não existe
   `costCents`/`commissionCents` para vazar por engano porque o campo nem
   chega até o cliente.

   Aceite de opção: NÃO existe action de servidor para "aceitar" hoje (ver
   docs/handoffs/nina-para-rafa.md). O botão principal de cada opção abre o
   WhatsApp do agente com uma mensagem pronta — é a saída honesta dentro do
   contrato atual, não uma chamada de servidor inventada.

   Redesenho (pedido do PO — "muito sólido, fundo neutro com texto em cima"):
   esta é a única tela do produto marcada como EDITORIAL PLENO na tabela dos
   dois registros, e o layout anterior não usava esse orçamento — era o
   mesmo miolo silencioso do resto do app, só que sem `AppShell`. Agora:

     - CAPA: se o agente subiu uma foto, ela abre a página cheia. Se não
       subiu (o caso mais comum — nem toda venda de R$ 99/mês tem banco de
       imagem), a `BiplanePlate` entra como marca d'água atrás do título —
       o "vazio" da capa vira uma decisão de design, não uma ausência.
     - Cada opção ganha um número (`Opção 01`, `02`...) e o preço sobe para
       `text-32`, com `reserveFor` no maior preço do conjunto: numa proposta
       de duas ou três opções lado a lado, os números terminam na mesma
       coluna vertical — é a mesma doutrina do `Money` (número que não pula)
       aplicada à comparação entre opções, não só à leitura de uma sozinha.
     - `ArchPlate` como divisor de "Escolha sua opção" só aparece quando a
       capa NÃO tem foto (senão a `BiplanePlate` da capa e o arco disputariam
       o orçamento de "no máximo uma prancha por tela").
   ========================================================================== */

export function PublicProposalScreen({
  data,
  slug,
}: {
  data: PropostaPublica;
  slug: string;
}) {
  const { proposal, brand, blocks } = data;

  const options = React.useMemo(
    () => [...data.options].sort((a, b) => a.position - b.position),
    [data.options],
  );
  const sharedBlocks = React.useMemo(
    () => blocks.filter((b) => b.optionId === null).sort((a, b) => a.position - b.position),
    [blocks],
  );
  const blocksByOption = React.useMemo(() => {
    const map = new Map<string, PropostaPublica["blocks"]>();
    for (const block of blocks) {
      if (!block.optionId) continue;
      const list = map.get(block.optionId) ?? [];
      list.push(block);
      map.set(block.optionId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [blocks]);

  const { registerOption } = useProposalVisitBeacon(slug, options);

  const generalWhatsapp = brand.whatsappLink
    ? `${brand.whatsappLink}?text=${encodeURIComponent(
        `Olá! Tenho uma dúvida sobre a proposta "${proposal.title}".`,
      )}`
    : null;

  const hasCoverPhoto = Boolean(proposal.coverImageUrl);
  // Maior preço do conjunto: toda opção reserva a mesma largura numérica, e a
  // coluna de preços nasce alinhada em vez de dentar conforme o valor muda de
  // dígito — a mesma doutrina do `Money` (número que não pula), agora
  // aplicada à COMPARAÇÃO entre opções.
  const maxOptionPriceCents =
    options.length > 0 ? Math.max(...options.map((option) => option.priceCents)) : undefined;

  return (
    <main className="enter mx-auto flex max-w-[42rem] flex-col gap-12 px-6 pt-10 pb-20 sm:px-10 sm:pt-16">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logoUrl}
              alt=""
              className="size-8 shrink-0 rounded-full object-cover"
            />
          ) : null}
          <span className="truncate text-13 font-medium text-muted">
            {brand.name ?? "Proposta de viagem"}
          </span>
        </div>
        {generalWhatsapp ? (
          <a
            href={generalWhatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 text-13 font-medium text-muted hover:text-ink"
          >
            <ChatIcon className="size-4" />
            WhatsApp
          </a>
        ) : null}
      </div>

      {hasCoverPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={proposal.coverImageUrl ?? undefined}
          alt=""
          className="aspect-[16/10] w-full rounded-sm object-cover"
        />
      ) : null}

      {/* Capa tipográfica. Sem foto, a BiplanePlate faz o trabalho que a foto
          faria — uma marca d'água que sangra pelo canto, nunca uma caixa
          vazia com contorno tracejado. `overflow-hidden` é o que evita o
          desenho empurrar a página para o lado em 390px. */}
      <header className="relative isolate flex flex-col gap-4 overflow-hidden">
        {!hasCoverPhoto ? (
          <BiplanePlate
            size={224}
            className="plate-wash pointer-events-none absolute -top-10 -right-10 -z-10 select-none sm:-top-12 sm:-right-6"
          />
        ) : null}
        <p className="text-13 tracking-[0.08em] text-muted uppercase">Proposta de viagem</p>
        <h1 className="display text-32 text-ink">{proposal.title}</h1>
        {proposal.summary ? (
          <p className="max-w-[34rem] text-17 leading-[1.5] text-muted">{proposal.summary}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 text-13 text-muted">
          {proposal.validUntil ? (
            <span>Válida até {formatDayMonth(new Date(`${proposal.validUntil}T00:00:00`))}</span>
          ) : null}
          <StatusNote status={proposal.status} />
        </div>
      </header>

      {sharedBlocks.length > 0 ? (
        <section className="flex flex-col gap-6">
          {sharedBlocks.map((block) => (
            <BlockSection key={block.id} block={block} />
          ))}
        </section>
      ) : null}

      {options.length > 0 ? (
        <section className="flex flex-col gap-8">
          <div className="flex items-center gap-3">
            {/* O arco só entra quando a capa NÃO usou a BiplanePlate — o
                orçamento do sistema é uma prancha por tela. */}
            {hasCoverPhoto ? (
              <ArchPlate size={36} className="shrink-0 text-muted" />
            ) : null}
            <h2 className="display text-20 text-ink">
              {options.length > 1 ? "Escolha sua opção" : "Sua opção"}
            </h2>
          </div>

          <div
            className={cn("flex flex-col gap-6", options.length > 1 && "sm:grid sm:items-stretch")}
            style={
              options.length > 1
                ? { gridTemplateColumns: `repeat(${Math.min(options.length, 3)}, minmax(0, 1fr))` }
                : undefined
            }
          >
            {options.map((option, index) => (
              <OptionCard
                key={option.id}
                index={index + 1}
                option={option}
                blocks={blocksByOption.get(option.id) ?? []}
                brand={brand}
                proposalTitle={proposal.title}
                accepted={proposal.acceptedOptionId === option.id}
                registerRef={(el) => registerOption(option.id, el)}
                slug={slug}
                reserveFor={maxOptionPriceCents}
              />
            ))}
          </div>
        </section>
      ) : (
        <p className="text-15 text-muted">Ainda não há opções nesta proposta.</p>
      )}

      {proposal.terms ? (
        <section className="flex flex-col">
          <Rule loose />
          <p className="text-13 leading-[1.5] whitespace-pre-line text-muted">{proposal.terms}</p>
        </section>
      ) : null}

      <footer className="flex flex-col">
        <Rule loose />
        <p className="text-center text-13 text-subtle">Feito com {APP_NAME}</p>
      </footer>
    </main>
  );
}

function StatusNote({ status }: { status: string }) {
  if (status === "accepted") return <Badge tone="ok">Aceita</Badge>;
  if (status === "declined") return <Badge tone="danger">Recusada</Badge>;
  if (status === "expired") return <Badge tone="warn">Expirada</Badge>;
  return null;
}

/* =============================================================================
   Opção — o cartão comparável
   ========================================================================== */

function OptionCard({
  index,
  option,
  blocks,
  brand,
  proposalTitle,
  accepted,
  registerRef,
  slug,
  reserveFor,
}: {
  index: number;
  option: PropostaPublica["options"][number];
  blocks: PropostaPublica["blocks"];
  brand: PropostaPublica["brand"];
  proposalTitle: string;
  accepted: boolean;
  registerRef: (el: HTMLDivElement | null) => void;
  slug: string;
  reserveFor?: number;
}) {
  const [accepting, setAccepting] = React.useState(false);
  const [acceptedNow, setAcceptedNow] = React.useState(false);

  const whatsappLink = brand.whatsappLink
    ? `${brand.whatsappLink}?text=${encodeURIComponent(
        `Olá! Quero confirmar a opção "${option.name}" da proposta "${proposalTitle}" — ${formatBRL(
          option.priceCents,
        )}.`,
      )}`
    : null;

  async function handleAccept() {
    setAccepting(true);
    const result = await aceitarOpcaoPublica({
      slug,
      optionId: option.id,
    });
    setAccepting(false);

    if (result.ok) {
      setAcceptedNow(true);
      // Abre WhatsApp como confirmação secundária após aceitar
      if (whatsappLink) {
        // Pequeno delay para o feedback visual do aceite
        await new Promise((resolve) => setTimeout(resolve, 500));
        window.open(whatsappLink, "_blank", "noopener,noreferrer");
      }
    }
  }

  const isAccepted = accepted || acceptedNow;

  return (
    <div
      ref={registerRef}
      data-option-id={option.id}
      className="flex flex-col gap-5 rounded-sm bg-surface-2 p-6"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-13 tabular-nums tracking-[0.06em] text-muted uppercase">
            Opção {String(index).padStart(2, "0")}
          </p>
          {option.isRecommended ? <Badge tone="accent">Recomendada</Badge> : null}
        </div>
        <h3 className="text-17 font-semibold text-ink">{option.name}</h3>
        {option.description ? <p className="text-13 text-muted">{option.description}</p> : null}
      </div>

      <div className="flex flex-col gap-0.5">
        <Money cents={option.priceCents} size="32" align="left" reserveFor={reserveFor} />
        {option.installments && option.installmentCents ? (
          <span className="text-13 tabular-nums text-muted">
            ou {option.installments}x de{" "}
            <Money cents={option.installmentCents} size="13" align="left" tone="muted" />
          </span>
        ) : null}
      </div>

      {blocks.length > 0 ? (
        <div className="flex flex-col gap-4">
          {blocks.map((block) => (
            <BlockSection key={block.id} block={block} compact />
          ))}
        </div>
      ) : null}

      <div className="mt-auto flex flex-col">
        <Rule loose />
        {isAccepted ? (
          <p className="text-13 font-medium text-ok">Você já confirmou esta opção.</p>
        ) : whatsappLink ? (
          <button
            type="button"
            onPointerDown={handleAccept}
            disabled={accepting}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-sm px-4 text-15 font-medium text-white disabled:opacity-60 [transition:transform_120ms_var(--curve-out)] active:scale-[0.98]"
            style={{ backgroundColor: brand.primaryColor ?? "var(--accent)" }}
          >
            {accepting ? "Confirmando..." : "Aceitar esta opção"}
          </button>
        ) : (
          <p className="text-13 text-muted">
            Fale com quem te mandou esta proposta para confirmar.
          </p>
        )}
      </div>
    </div>
  );
}

/* =============================================================================
   Bloco — hotel, voo, transfer, passeio, cruzeiro, seguro, texto, imagem
   ========================================================================== */

function BlockSection({
  block,
  compact,
}: {
  block: PropostaPublica["blocks"][number];
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

/* =============================================================================
   Beacon de abertura
   -----------------------------------------------------------------------------
   `registrarVisitaProposta` é uma Server Action, não um endpoint cru — não dá
   para usar `navigator.sendBeacon` de verdade nela (ele exige uma URL e um
   corpo que o browser manda sozinho, mesmo com a aba fechando; uma Server
   Action do Next é uma chamada RPC por baixo, e "codificar essa chamada à
   mão para o sendBeacon" seria depender de um detalhe de implementação do
   Next que pode mudar de versão para versão). A alternativa real e descrita
   no próprio pedido ("sendBeacon/visibilitychange") é o `visibilitychange`:
   ele dispara de forma confiável quando a aba perde foco/fecha, ANTES do
   `pagehide`, com tempo de sobra para o fetch sair — diferente do `unload`,
   que muitos navegadores já não garantem mais. `pagehide` fica como reforço
   para o caso de fechar sem passar por "hidden" primeiro (raro, mas existe
   em alguns fluxos de PWA/iOS). Um `ref` de "já mandei" evita duplicar a
   linha em `proposal_views` se os dois dispararem.
   ========================================================================== */

function useProposalVisitBeacon(
  slug: string,
  options: { id: string }[],
): { registerOption: (id: string, el: HTMLDivElement | null) => void } {
  const startedAtRef = React.useRef(Date.now());
  const sessionKeyRef = React.useRef<string>("");
  const focusedOptionIdRef = React.useRef<string | undefined>(undefined);
  const exitSentRef = React.useRef(false);
  const elementsRef = React.useRef(new Map<string, HTMLDivElement>());

  React.useEffect(() => {
    const storageKey = `zarpa:proposal-visit:${slug}`;
    let sessionKey: string | null = null;
    try {
      sessionKey = sessionStorage.getItem(storageKey);
      if (!sessionKey) {
        sessionKey = crypto.randomUUID();
        sessionStorage.setItem(storageKey, sessionKey);
      }
    } catch {
      // Modo privado sem sessionStorage: segue sem sessionKey — o registro
      // ainda acontece, só perde a distinção "voltou a olhar" vs. "sessão nova".
      sessionKey = null;
    }
    sessionKeyRef.current = sessionKey ?? "";

    // Nenhum dado de identificação sai daqui — só slug e a chave de sessão
    // opaca. IP/user-agent/referrer são lidos pelo SERVIDOR, dos headers da
    // própria requisição (ver publicProposals.ts), nunca mandados pelo cliente.
    void registrarVisitaProposta({
      slug,
      sessionKey: sessionKeyRef.current || undefined,
    });

    function sendExit() {
      if (exitSentRef.current) return;
      exitSentRef.current = true;
      const durationSeconds = Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000));
      void registrarVisitaProposta({
        slug,
        sessionKey: sessionKeyRef.current || undefined,
        durationSeconds,
        focusedOptionId: focusedOptionIdRef.current,
      });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") sendExit();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", sendExit);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", sendExit);
    };
  }, [slug]);

  // Qual opção está mais visível agora — o "scroll parou nela" do contrato.
  React.useEffect(() => {
    if (options.length === 0 || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        let best: { id: string; ratio: number } | null = null;
        for (const entry of entries) {
          const id = entry.target.getAttribute("data-option-id");
          if (!id || !entry.isIntersecting) continue;
          if (!best || entry.intersectionRatio > best.ratio) {
            best = { id, ratio: entry.intersectionRatio };
          }
        }
        if (best) focusedOptionIdRef.current = best.id;
      },
      { threshold: [0.3, 0.6, 0.9] },
    );
    for (const el of elementsRef.current.values()) observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- os elementos vêm de registerOption, não de `options`
  }, [options.length]);

  const registerOption = React.useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) elementsRef.current.set(id, el);
    else elementsRef.current.delete(id);
  }, []);

  return { registerOption };
}
