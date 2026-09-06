import type { ComissaoStatus, ParcelaStatus } from "@/server";
import { formatDayMonth } from "@/lib/ui/format";

/* =============================================================================
   Vocabulário compartilhado de "Dinheiro" (Vendas + Financeiro, S9)
   -----------------------------------------------------------------------------
   Mesma razão do `clientes/shared.ts`: rótulo e cor de status vivem num
   lugar só para a lista, o detalhe e a conferência de comissão não
   divergirem entre si.
   ========================================================================== */

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";

export const COMISSAO_STATUS_LABEL: Record<ComissaoStatus, string> = {
  prevista: "Prevista",
  recebida: "Recebida",
  atrasada: "Atrasada",
};

/** `atrasada` é o único estado que pede alarme de verdade — o resto é fluxo normal. */
export const COMISSAO_STATUS_TONE: Record<ComissaoStatus, Tone> = {
  prevista: "accent",
  recebida: "ok",
  atrasada: "danger",
};

export const COMISSAO_STATUS_OPTIONS: ComissaoStatus[] = ["prevista", "recebida", "atrasada"];

export const PARCELA_STATUS_LABEL: Record<ParcelaStatus, string> = {
  pendente: "Pendente",
  pago: "Paga",
  atrasado: "Atrasada",
  cancelado: "Cancelada",
};

export const PARCELA_STATUS_TONE: Record<ParcelaStatus, Tone> = {
  pendente: "neutral",
  pago: "ok",
  atrasado: "danger",
  cancelado: "neutral",
};

/**
 * O que a agente efetivamente embolsa nesta venda: a comissão que a
 * operadora paga + o honorário que ela mesma cobrou por cima. `custoCents`
 * já é o que vai para o fornecedor — não entra aqui de novo (entraria em
 * dobro, já que a comissão é calculada sobre a diferença entre preço e
 * custo do lado do construtor de proposta).
 */
export function margemCents(venda: { comissaoPrevistaCents: number; taxaServicoCents: number }): number {
  return venda.comissaoPrevistaCents + venda.taxaServicoCents;
}

/** `AAAA-MM-DD` (sem hora — é como o contrato de `receivables.venceEm` chega). */
export function formatVencimento(iso: string): string {
  return formatDayMonth(new Date(`${iso}T00:00:00`));
}

/** Dias entre hoje e o vencimento, comparando por dia de calendário (negativo = já passou). */
export function diasParaVencimento(iso: string, now: number = Date.now()): number {
  const [year, month, day] = iso.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  const today = new Date(now);
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - todayUtc) / 86_400_000);
}

export function vencimentoLabel(days: number): string {
  if (days < 0) return `venceu há ${Math.abs(days)} ${Math.abs(days) === 1 ? "dia" : "dias"}`;
  if (days === 0) return "vence hoje";
  if (days === 1) return "vence amanhã";
  return `vence em ${days} dias`;
}
