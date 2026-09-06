import type { BlocoKind } from "@/server";

/* =============================================================================
   Vocabulário de bloco — compartilhado entre o construtor (autenticado) e a
   proposta pública (sem login).
   -----------------------------------------------------------------------------
   `content` é `Record<string, unknown>` livre no contrato (o schema não impõe
   forma interna) — mas a INTERFACE precisa de um vocabulário fixo para caber
   no critério "3 opções e 12 blocos em 4 minutos" no construtor, e para o
   cliente final ler "Check-in: 12 mar" em vez de um valor solto sem rótulo na
   proposta pública. Um só lugar para as duas telas: sem isto, o rótulo de um
   campo podia divergir entre quem escreve e quem lê.
   ========================================================================== */

export const KIND_LABEL: Record<BlocoKind, string> = {
  text: "Texto livre",
  image: "Imagem",
  flight: "Voo",
  hotel: "Hotel",
  transfer: "Transfer",
  tour: "Passeio",
  cruise: "Cruzeiro",
  insurance: "Seguro",
  price_note: "Nota de preço",
};

export type ContentField = {
  key: string;
  label: string;
  type?: "text" | "date";
  placeholder?: string;
};

export const CONTENT_FIELDS: Partial<Record<BlocoKind, ContentField[]>> = {
  flight: [
    { key: "airline", label: "Companhia aérea" },
    { key: "flightNumber", label: "Número do voo" },
    { key: "from", label: "Origem" },
    { key: "to", label: "Destino" },
    { key: "departure", label: "Embarque", placeholder: "12 mar, 08:40" },
    { key: "arrival", label: "Chegada", placeholder: "12 mar, 14:10" },
  ],
  hotel: [
    { key: "hotelName", label: "Hotel" },
    { key: "roomType", label: "Categoria do quarto" },
    { key: "checkIn", label: "Check-in", type: "date" },
    { key: "checkOut", label: "Check-out", type: "date" },
    { key: "mealPlan", label: "Regime de alimentação" },
  ],
  transfer: [
    { key: "transferType", label: "Tipo", placeholder: "Chegada, saída, entre cidades" },
    { key: "vehicle", label: "Veículo" },
    { key: "pickup", label: "Local e horário de saída" },
  ],
  tour: [
    { key: "location", label: "Local" },
    { key: "date", label: "Data", type: "date" },
    { key: "duration", label: "Duração" },
    { key: "includes", label: "O que inclui" },
  ],
  cruise: [
    { key: "shipName", label: "Navio" },
    { key: "cabinType", label: "Categoria da cabine" },
    { key: "embarkation", label: "Embarque" },
    { key: "disembarkation", label: "Desembarque" },
  ],
  insurance: [
    { key: "provider", label: "Seguradora" },
    { key: "coverage", label: "Cobertura" },
    { key: "validFrom", label: "Início da vigência", type: "date" },
    { key: "validTo", label: "Fim da vigência", type: "date" },
  ],
};

/** Rótulo de um campo de `content`, se o vocabulário conhecer a chave — senão a própria chave. */
export function contentFieldLabel(kind: string, key: string): string {
  const field = CONTENT_FIELDS[kind as BlocoKind]?.find((f) => f.key === key);
  return field?.label ?? key;
}
