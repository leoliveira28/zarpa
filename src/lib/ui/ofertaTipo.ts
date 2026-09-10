/**
 * Vocabulário do tipo de oferta — compartilhado entre a Vitrine (autenticada)
 * e a página pública `/a/[slug]`. Mesmo papel de `blockContent.ts`: um lugar só
 * para o rótulo, para quem escreve e quem lê não divergirem.
 */
export type OfertaTipo = "pacote" | "voo" | "hospedagem" | "transfer" | "servico";

export const TIPO_LABEL: Record<OfertaTipo, string> = {
  pacote: "Pacote",
  voo: "Voo",
  hospedagem: "Hospedagem",
  transfer: "Transfer",
  servico: "Serviço",
};
