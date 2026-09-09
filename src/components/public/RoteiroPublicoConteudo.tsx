import { Rule } from "@/components/plates";
import { Badge } from "@/components/ui/Badge";
import { CONTENT_FIELDS, KIND_LABEL } from "@/lib/ui/blockContent";
import {
  secaoDoBloco,
  usaCorpo,
  valorString,
} from "@/lib/ui/roteiroConteudo";
import { cn } from "@/lib/ui/cn";
import { formatDayMonth, formatWeekday } from "@/lib/ui/format";
import type { BlocoDoRoteiro } from "@/server";

/* =============================================================================
   RoteiroPublicoConteudo — o guia em si, no registro editorial pleno
   -----------------------------------------------------------------------------
   Renderiza o snapshot do roteiro para QUEM ESTÁ NA RUA: o turista, no celular,
   com sol na tela e sinal de terceira. Consequências de desenho:

     - A hierarquia de DIA é inconfundível e tipográfica: "DIA 01" em caixa alta
       com número tabular, título em display, data por extenso, fio. Um dia
       começa e acabam de saber — sem caixa, sem cor, sem ícone.
     - A PARADA tem calha de horário: o número tabular mora numa coluna própria
       e RESERVADA (com ou sem horário — a coluna não recolhe), então dez
       paradas formam uma tabela de horários de verdade. Número que não pula,
       aplicado ao eixo vertical da página.
     - FOTOS respiram: primeira imagem em 3:2 de coluna inteira, `loading`
       lazy — bloco com foto pesada em 4G é bloco que não abre.
     - O contato da AGENTE é a barra fixa no pé da página (página irmã,
       RoteiroPublicoScreen); aqui só há hierarquia de leitura — nada se toca,
       nada em azul.

   Server-compatible de propósito (sem `"use client"`, sem hook): a página
   pública é server component e a prévia do editor reusa ESTE componente — o
   que a agente vê no construtor é o que o turista vai ler, não uma
   aproximação.

   §4 como defesa de UI: bloco `price_note` NÃO renderiza aqui mesmo que chegue
   no snapshot — o scanner de vazamento é a rede; esta tela é a segunda trava.
   ========================================================================== */

type Bloco = Pick<BlocoDoRoteiro, "kind" | "position" | "title" | "body" | "images" | "content">;

export function RoteiroPublicoConteudo({ blocks }: { blocks: Bloco[] }) {
  const ordered = [...blocks].sort((a, b) => a.position - b.position);

  // Blocos antes do primeiro "Dia" (contatos, documentos, o que veio da
  // proposta) correm na abertura, sem cabeçalho — o guia começa onde começa.
  const grupos: { dia: Bloco | null; numero: number | null; blocos: Bloco[] }[] = [
    { dia: null, numero: null, blocos: [] },
  ];
  for (const bloco of ordered) {
    if (secaoDoBloco(bloco.content) === "dia") {
      grupos.push({
        dia: bloco,
        numero: grupos.filter((grupo) => grupo.dia !== null).length + 1,
        blocos: [],
      });
      continue;
    }
    grupos[grupos.length - 1]!.blocos.push(bloco);
  }

  return (
    <div className="flex flex-col gap-12">
      {grupos.map((grupo, index) => (
        <GrupoDoRoteiro key={grupo.dia ? `dia-${index}` : `abertura-${index}`} grupo={grupo} />
      ))}
    </div>
  );
}

function GrupoDoRoteiro({
  grupo,
}: {
  grupo: { dia: Bloco | null; numero: number | null; blocos: Bloco[] };
}) {
  // §4 na interface: nota de preço não vai ao ar no roteiro nem por descuido.
  const visiveis = grupo.blocos.filter((bloco) => bloco.kind !== "price_note");
  if (!grupo.dia && visiveis.length === 0) return null;

  return (
    <section className="flex flex-col gap-6">
      {grupo.dia && grupo.numero ? <CabecalhoDoDia bloco={grupo.dia} numero={grupo.numero} /> : null}
      {visiveis.map((bloco, index) => (
        <BlocoDoRoteiro key={index} bloco={bloco} />
      ))}
    </section>
  );
}

/* -----------------------------------------------------------------------------
   Dia — a unidade do guia. Tipografia como hierarquia, fio como cornija.
   -------------------------------------------------------------------------- */

function CabecalhoDoDia({ bloco, numero }: { bloco: Bloco; numero: number }) {
  const dataISO = valorString(bloco.content, "data");
  const data = dataISO ? new Date(`${dataISO}T00:00:00`) : null;
  const vazio = !bloco.title && !data;
  if (vazio) return null;

  return (
    <header className="flex flex-col gap-2.5">
      {/* O "DIA 01" é a régua do turista: número tabular, uma linha com a data
          quando existe — uma informação só, legível com o celular na mão. */}
      <p className="text-13 uppercase tracking-[0.08em] text-muted" data-numeric>
        Dia {String(numero).padStart(2, "0")}
        {data ? ` · ${formatWeekday(data)}, ${formatDayMonth(data)}` : ""}
      </p>
      {/* O título do dia é CAPÍTULO, não item: display 32, o mesmo corpo
          tipográfico da capa. Um dia começa e se lê de longe — é o que dá a
          hierarquia dia > parada sem caixa, sem cor, sem ícone. */}
      {bloco.title ? <h2 className="display text-32 text-ink">{bloco.title}</h2> : null}
      <Rule />
    </header>
  );
}

/* -----------------------------------------------------------------------------
   Bloco — despacho pela seção; genérico herda o vocabulário da proposta
   -------------------------------------------------------------------------- */

function BlocoDoRoteiro({ bloco }: { bloco: Bloco }) {
  switch (secaoDoBloco(bloco.content)) {
    case "parada":
      return <BlocoParada bloco={bloco} />;
    case "dica":
      return <BlocoDica bloco={bloco} />;
    case "emergencia":
      return <BlocoEmergencia bloco={bloco} />;
    default:
      return <BlocoGenerico bloco={bloco} />;
  }
}

/** Parada do dia — horário em calha própria, alinhada mesmo sem horário. */
function BlocoParada({ bloco }: { bloco: Bloco }) {
  const horario = valorString(bloco.content, "horario");
  const endereco = valorString(bloco.content, "endereco");
  const comoChegar = valorString(bloco.content, "comoChegar");
  const vazio =
    !bloco.title && !bloco.body && !endereco && !comoChegar && !horario && bloco.images.length === 0;
  if (vazio) return null;

  return (
    <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-4">
      <p className="pt-0.5 text-13 text-muted" data-numeric>
        {horario}
      </p>
      <div className="flex min-w-0 flex-col gap-1.5">
        {bloco.title ? <h3 className="text-17 font-semibold text-ink">{bloco.title}</h3> : null}
        {endereco ? <p className="text-13 text-muted">{endereco}</p> : null}
        {bloco.body ? (
          <p className="text-15 leading-[1.5] whitespace-pre-line text-ink">{bloco.body}</p>
        ) : null}
        {comoChegar ? (
          <p className="text-13 text-muted">
            Como chegar — <span className="font-medium text-ink">{comoChegar}</span>
          </p>
        ) : null}
        <Fotos imagens={bloco.images} proporcao="aspect-[16/10]" />
      </div>
    </div>
  );
}

/** Dica local — o bloco que vira print no grupo da família. */
function BlocoDica({ bloco }: { bloco: Bloco }) {
  if (!bloco.title && !bloco.body) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-13 uppercase tracking-[0.08em] text-muted">Dica local</p>
      {bloco.title ? <h3 className="text-17 font-semibold text-ink">{bloco.title}</h3> : null}
      {bloco.body ? (
        <p className="text-15 leading-[1.5] whitespace-pre-line text-ink">{bloco.body}</p>
      ) : null}
    </div>
  );
}

/** Emergência — os contatos do DESTINO em texto claro. O contato da agente
 * mesma é a barra fixa de WhatsApp no pé da página (marca congelada no
 * snapshot); este bloco lista hotel, guia local e emergência do lugar. */
function BlocoEmergencia({ bloco }: { bloco: Bloco }) {
  if (!bloco.title && !bloco.body) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-13 uppercase tracking-[0.08em] text-muted">Emergência</p>
      {bloco.title ? <h3 className="text-17 font-semibold text-ink">{bloco.title}</h3> : null}
      {bloco.body ? (
        <p className="text-15 leading-[1.5] whitespace-pre-line text-ink">{bloco.body}</p>
      ) : null}
    </div>
  );
}

/**
 * Genérico — hotel, voo, transfer, passeio, seguro, texto e imagem que vieram
 * da proposta (e tudo que o roteiro não marcou). MESMO vocabulário do
 * `PublicBlockSection` (`CONTENT_FIELDS`/`KIND_LABEL`): "Check-in" se chama
 * Check-in nas duas páginas públicas. O layout é deste registro: foto em
 * coluna inteira em vez de carrossel — na rua ninguém pina fino.
 */
function BlocoGenerico({ bloco }: { bloco: Bloco }) {
  const fields = CONTENT_FIELDS[bloco.kind as keyof typeof CONTENT_FIELDS] ?? [];
  const entries = fields
    .map((field) => ({ label: field.label, value: bloco.content[field.key] }))
    .filter(
      (entry): entry is { label: string; value: string } =>
        typeof entry.value === "string" && entry.value.trim() !== "",
    );
  const mostraEstrutura =
    bloco.kind !== "text" && bloco.kind !== "image" && (entries.length > 0 || bloco.title);
  if (!bloco.title && !bloco.body && entries.length === 0 && bloco.images.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {mostraEstrutura || bloco.title ? (
        <div className="flex flex-wrap items-center gap-2">
          {mostraEstrutura ? (
            <Badge tone="neutral">{KIND_LABEL[bloco.kind as keyof typeof KIND_LABEL] ?? bloco.kind}</Badge>
          ) : null}
          {bloco.title ? <h3 className="text-17 font-semibold text-ink">{bloco.title}</h3> : null}
        </div>
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

      {bloco.body && usaCorpo(bloco) ? (
        <p className="text-15 leading-[1.5] whitespace-pre-line text-ink">{bloco.body}</p>
      ) : null}

      <Fotos
        imagens={bloco.images}
        proporcao={bloco.kind === "image" ? "aspect-[3/2]" : "aspect-[16/10]"}
      />
    </div>
  );
}

/**
 * Fotos — a primeira respira em coluna inteira; as demais ficam em fiada baixa.
 * `loading="lazy"` + `decoding="async"` desde o primeiro componente: 4G na rua.
 */
function Fotos({ imagens, proporcao }: { imagens: string[]; proporcao: string }) {
  const primeira = imagens[0];
  if (!primeira) return null;
  const resto = imagens.slice(1);

  return (
    <div className="flex flex-col gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={primeira}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn("w-full rounded-sm object-cover", proporcao)}
      />
      {resto.length > 0 ? (
        <div className="flex gap-2">
          {resto.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={url}
              src={url}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-20 w-20 shrink-0 rounded-sm object-cover"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
