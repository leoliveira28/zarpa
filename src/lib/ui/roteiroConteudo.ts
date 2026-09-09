import type { BlocoDoRoteiro, BlocoKind } from "@/server";
import { CONTENT_FIELDS, KIND_LABEL, type ContentField } from "@/lib/ui/blockContent";

/* =============================================================================
   Vocabulário do roteiro — a semântica de GUIA DE VIAGEM sobre os blocos
   -----------------------------------------------------------------------------
   O snapshot do roteiro é jsonb e já aceita o que a proposta tem (hotel, voo,
   transfer, passeio, seguro, texto, imagem). O que o guia pede E a proposta não
   tem — dia, parada do dia, dica local, contato de emergência — entra aqui como
   MARCADOR dentro de `content` (`content.secao = "dia"` e afins), sem `kind`
   novo: zero migration no CHECK de `proposal_blocks.kind` e zero trabalho novo
   para o servidor. O caminho era um dos dois desenhados em
   docs/handoffs/pedro-para-rafa.md §4; escolhi o primeiro de propósito — o
   editor não pode ficar refém de uma rodada de schema.

   Tudo que o editor e a página pública do roteiro precisam para CONCORDAR sobre
   o que um bloco significa mora neste arquivo: quem escreve (a agente, no
   editor) e quem lê (o turista, em /r/[slug]) não podem divergir — mesma razão
   de existir de `blockContent.ts`, que este módulo estende sem alterar.

   `secao` é marcador de LEITURA, não dado comercial: atravessa a função
   `public.roteiro_publica` porque ela repassa `content` inteiro
   (drizzle/0013, `b->'content'`) e nada aqui toca em preço/custo/comissão.
   ========================================================================== */

/** O marcador dentro de `content` que dá semântica editorial ao bloco. */
const CHAVE_SECAO = "secao";

export type SecaoDoRoteiro = "dia" | "parada" | "dica" | "emergencia";

const SECOES: SecaoDoRoteiro[] = ["dia", "parada", "dica", "emergencia"];

/** Lê o marcador de seção de um bloco; `null` = bloco genérico (veio da proposta). */
export function secaoDoBloco(content: Record<string, unknown>): SecaoDoRoteiro | null {
  const valor = content[CHAVE_SECAO];
  return typeof valor === "string" && (SECOES as string[]).includes(valor)
    ? (valor as SecaoDoRoteiro)
    : null;
}

/* -----------------------------------------------------------------------------
   Modelos — o cardápio do "Adicionar bloco" do roteiro
   -----------------------------------------------------------------------------
   Cada modelo é um bloco COMUM do snapshot (kind existente + conteúdo inicial),
   não um tipo novo de servidor. O `label` é o que a agente vê; a `descricao`
   diz o que o bloco resolve PARA O TURISTA — o editor ensina o resultado, não
   o mecanismo.
   -------------------------------------------------------------------------- */

export type ModeloDeBloco = {
  /** Identificador estável do modelo (key da grade do sheet). */
  id: string;
  kind: BlocoKind;
  secao?: SecaoDoRoteiro;
  label: string;
  descricao: string;
  /** Placeholder do campo título — ensina o tom sem preencher por você. */
  placeholderTitulo?: string;
  /** Campos de `content` do modelo; sem estes, valem os do `kind` (`CONTENT_FIELDS`). */
  fields?: ContentField[];
};

export const MODELOS_DO_ROTEIRO: ModeloDeBloco[] = [
  {
    id: "dia",
    kind: "text",
    secao: "dia",
    label: "Dia",
    descricao: "Abre um dia da viagem e agrupa o que vem depois dele.",
    placeholderTitulo: "Chegada em Lisboa",
    fields: [{ key: "data", label: "Data", type: "date" }],
  },
  {
    id: "parada",
    kind: "tour",
    secao: "parada",
    label: "Parada do dia",
    descricao: "Um lugar do dia, com horário sugerido e como chegar.",
    placeholderTitulo: "Miradouro de Santa Luzia",
    fields: [
      { key: "horario", label: "Horário sugerido", placeholder: "09:30" },
      { key: "endereco", label: "Endereço", placeholder: "Largo das Portas do Sol, Alfama" },
      { key: "comoChegar", label: "Como chegar", placeholder: "Bonde 28, descada na Sé" },
    ],
  },
  {
    id: "dica",
    kind: "text",
    secao: "dica",
    label: "Dica local",
    descricao: "Moeda, tomada, gorjeta, frase útil — o que vira print no grupo da família.",
    placeholderTitulo: "Dinheiro e gorjeta",
  },
  {
    id: "emergencia",
    kind: "text",
    secao: "emergencia",
    label: "Contato de emergência",
    // Seu próprio telefone nem precisa de bloco: a página pública fixa a barra
    // de WhatsApp da marca no pé, sempre visível (vem do brand_snapshot). O
    // bloco lista o que NÃO é seu: hotel, guia local, emergência do destino.
    descricao: "Hotel, guia local e emergência do destino — o que procurar em apuros.",
    placeholderTitulo: "Se precisar de ajuda",
  },
  {
    id: "texto",
    kind: "text",
    label: "Texto livre",
    descricao: "Qualquer informação em texto corrido — o resto do bloco de texto da proposta.",
  },
  {
    id: "foto",
    kind: "image",
    label: "Foto",
    descricao: "Uma imagem grande, com legenda opcional.",
  },
  {
    id: "hotel",
    kind: "hotel",
    label: "Hospedagem",
    descricao: "Endereço, check-in, regime — o que o cliente procura EM CHEGANDO.",
  },
  {
    id: "transfer",
    kind: "transfer",
    label: "Transfer",
    descricao: "Veículo, horário e ponto de encontro.",
  },
  {
    id: "tour",
    kind: "tour",
    label: "Passeio",
    descricao: "Passeio fechado, com data, duração e o que inclui.",
  },
];

/** Bloco novo a partir de um modelo — a forma EXATA de `BlocoDoRoteiro`. */
export function blocoNovoDeModelo(modelo: ModeloDeBloco, position: number): BlocoDoRoteiro {
  return {
    kind: modelo.kind,
    position,
    title: null,
    body: null,
    images: [],
    content: modelo.secao ? { [CHAVE_SECAO]: modelo.secao } : {},
  };
}

/** Campos de `content` que o editor mostra para o bloco: modelo primeiro, kind depois. */
export function fieldsDoBloco(bloco: { kind: string; content: Record<string, unknown> }): ContentField[] {
  const secao = secaoDoBloco(bloco.content);
  if (secao) {
    return MODELOS_DO_ROTEIRO.find((modelo) => modelo.secao === secao)?.fields ?? [];
  }
  return CONTENT_FIELDS[bloco.kind as BlocoKind] ?? [];
}

/** Rótulo do badge do bloco no editor: a semântica do guia cobre a do kind. */
export function rotuloDoBloco(bloco: { kind: string; content: Record<string, unknown> }): string {
  const secao = secaoDoBloco(bloco.content);
  if (secao) {
    return MODELOS_DO_ROTEIRO.find((modelo) => modelo.secao === secao)?.label ?? KIND_LABEL[bloco.kind as BlocoKind] ?? bloco.kind;
  }
  return KIND_LABEL[bloco.kind as BlocoKind] ?? bloco.kind;
}

/** O bloco precisa de campo de descrição? Um "Dia" é cabeçalho — corpo ali é ruído. */
export function usaCorpo(bloco: { kind: string; content: Record<string, unknown> }): boolean {
  return secaoDoBloco(bloco.content) !== "dia";
}

/** Lê uma chave string de `content`; vazio conta como ausente. */
export function valorString(content: Record<string, unknown>, chave: string): string | null {
  const valor = content[chave];
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo === "" ? null : limpo;
}

/** `""` vira `null` ao gravar — snapshot limpo, sem chave que é só espaço. */
export function textoOuNulo(valor: string | null): string | null {
  if (valor === null) return null;
  const limpo = valor.trim();
  return limpo === "" ? null : limpo;
}

/* -----------------------------------------------------------------------------
   Itens de edição — identidade local para o arrasto
   -----------------------------------------------------------------------------
   `BlocoDoRoteiro` não tem `id` de propósito (linhagem interna não sai para o
   cliente), mas `Reorder` precisa de identidade por referência. O editor
   carrega ITENS (`chave` local + bloco) e grava blocos com `position` reescrito
   pela ordem do array — o array é a verdade, como no editor de proposta.
   -------------------------------------------------------------------------- */

export type ItemBloco = { chave: string; bloco: BlocoDoRoteiro };

export function chaveNova(): string {
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A lista que vai para o servidor: ordem do array vira `position`. */
export function blocosDe(itens: ItemBloco[]): BlocoDoRoteiro[] {
  return itens.map((item, index) => ({ ...item.bloco, position: index }));
}
