import { formatDayMonth } from "@/lib/ui/format";

/* =============================================================================
   Vocabulário compartilhado da área de Clientes
   -----------------------------------------------------------------------------
   Rótulos em português e contas de data que a lista, a ficha e o assistente de
   importação usam todos os três — um lugar só, para o rótulo de "instagram" não
   divergir entre a tela que cria e a tela que mostra.
   ========================================================================== */

export const SOURCE_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  indicacao: "Indicação",
  site: "Site",
  evento: "Evento",
  outro: "Outro",
};

export const SOURCE_OPTIONS = Object.entries(SOURCE_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export const TRAVELER_KIND_LABELS: Record<string, string> = {
  adult: "Adulto",
  child: "Criança",
  infant: "Bebê",
};

export const TRAVELER_KIND_OPTIONS = Object.entries(TRAVELER_KIND_LABELS).map(
  ([value, label]) => ({ value, label }),
);

/** ISO `YYYY-MM-DD` -> dias a partir de hoje (negativo se já passou). */
export function daysUntilIso(iso: string, now: number = Date.now()): number {
  const [year, month, day] = iso.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  const today = new Date(now);
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - todayUtc) / 86_400_000);
}

/** `MM-DD` -> dias até a próxima ocorrência (0 se é hoje, sempre >= 0). */
export function daysUntilMonthDay(monthDay: string, now: number = Date.now()): number {
  const [month, day] = monthDay.split("-").map(Number);
  const today = new Date(now);
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  let next = Date.UTC(today.getFullYear(), month - 1, day);
  if (next < todayUtc) next = Date.UTC(today.getFullYear() + 1, month - 1, day);
  return Math.round((next - todayUtc) / 86_400_000);
}

/** `MM-DD` -> "15 mar", sem ano (aniversário não carrega ano fora do dado cifrado). */
export function formatMonthDay(monthDay: string): string {
  const [month, day] = monthDay.split("-").map(Number);
  const reference = new Date(2024, 0, 1);
  return formatDayMonth(new Date(2024, month - 1, day), reference);
}

/** ISO `YYYY-MM-DD` -> "DD/MM/AAAA", o formato que os serviços aceitam de volta. */
export function isoToBR(iso: string | null | undefined): string {
  if (!iso) return "";
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

export type PassportTone = "danger" | "warn" | "neutral";

/** Cor do alerta de validade: vencido/urgente (30d), atenção (90d), tranquilo. */
export function passportTone(days: number): PassportTone {
  if (days <= 30) return "danger";
  if (days <= 90) return "warn";
  return "neutral";
}

export function passportLabel(days: number): string {
  if (days < 0) return `venceu há ${Math.abs(days)} dias`;
  if (days === 0) return "vence hoje";
  return `vence em ${days} dias`;
}
