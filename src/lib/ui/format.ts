/* =============================================================================
   Formatação
   -----------------------------------------------------------------------------
   Dinheiro é formatado à mão de propósito, não com Intl.NumberFormat.
   Dois motivos:
     1. Intl depende do ICU do runtime. Servidor e navegador podendo divergir,
        o React acusa hydration mismatch e o número PISCA. Número que pisca é
        exatamente o que a gente combinou de não ter.
     2. Valor monetário trafega em CENTAVOS (inteiro). Formatar float é como
        se perde meio centavo por linha de proposta.
   ========================================================================== */

/** Valor em centavos -> "R$ 12.345,67". Determinístico, sem Intl. */
export function formatBRL(
  cents: number,
  { withSymbol = true, signed = false }: { withSymbol?: boolean; signed?: boolean } = {},
): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toString();
  const frac = (abs % 100).toString().padStart(2, "0");

  let grouped = "";
  for (let i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 === 0) grouped += ".";
    grouped += whole[i];
  }

  // hyphen-minus de propósito: em fontes com tabular-nums ele tem a mesma
  // largura de um dígito. O sinal de menos tipográfico (−) não tem, e faz a
  // coluna pular quando um valor fica negativo.
  const sign = negative ? "-" : signed ? "+" : "";
  const body = `${grouped},${frac}`;
  return withSymbol ? `${sign}R$ ${body}` : `${sign}${body}`;
}

/**
 * O inverso de `formatBRL`, tolerante ao que o dedo digita: aceita
 * "1234,56", "1.234,56", "1234.56" ou só dígitos ("123456" -> R$ 1.234,56,
 * como uma calculadora de valor). `null` para campo vazio ou lixo.
 * Existe porque o campo de preço da proposta grava CENTAVOS (regra do
 * contrato do servidor), nunca float — quem converte na borda é a interface.
 */
export function parseBRLCents(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[^\d,.-]/g, "");
  if (!cleaned) return null;
  const negative = cleaned.startsWith("-");
  const body = cleaned.replace(/-/g, "");

  // separador decimal: a vírgula, se existir; senão o último ponto, se ele
  // tiver 1-2 dígitos depois (senão é separador de milhar, não decimal)
  let integerPart = body;
  let fracPart = "";
  const lastComma = body.lastIndexOf(",");
  const lastDot = body.lastIndexOf(".");
  const decimalAt = lastComma >= 0 ? lastComma : lastDot >= 0 && body.length - lastDot <= 3 ? lastDot : -1;

  if (decimalAt >= 0) {
    integerPart = body.slice(0, decimalAt);
    fracPart = body.slice(decimalAt + 1);
  }
  integerPart = integerPart.replace(/[.,]/g, "");
  fracPart = fracPart.replace(/[.,]/g, "").slice(0, 2).padEnd(2, "0");

  if (!integerPart && !fracPart) return null;
  const cents = Number(integerPart || "0") * 100 + Number(fracPart || "0");
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

/**
 * Molde de largura: o mesmo número com todo dígito trocado por zero. Mantém
 * separador de milhar e vírgula exatamente onde estarão, então a largura
 * reservada é a largura real — não um chute.
 */
export function brlWidthTemplate(cents: number | null | undefined): string {
  // sem pista, reserva o formato de R$ 10.000,00 — a faixa típica de uma
  // proposta de viagem. Melhor sobrar 1ch do que a coluna tremer.
  const reference = cents == null ? 1_000_000 : Math.abs(Math.round(cents));
  return formatBRL(reference).replace(/\d/g, "0");
}

const MONTHS_SHORT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

const WEEKDAYS_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "12 mar" / "12 mar 2027" quando o ano difere do de referência. */
export function formatDayMonth(date: Date, reference = new Date()): string {
  const base = `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
  return date.getFullYear() === reference.getFullYear()
    ? base
    : `${base} ${date.getFullYear()}`;
}

/**
 * A mesma coisa, lida em UTC.
 *
 * Existe por um motivo só, e é grave o bastante para ter função própria: uma
 * data derivada de `Date.now()` e formatada com `getDate()` **local** sai
 * diferente no servidor (UTC) e no navegador (America/Sao_Paulo) no mesmo
 * instante, durante três horas por dia. O React vê o texto divergir na
 * hidratação e o repinta — ou seja, a data PISCA na tela. Lida em UTC, a conta
 * é a mesma dos dois lados.
 *
 * Use esta quando a data vier de um deslocamento em dias (`hoje + n`). Para
 * data de calendário vinda do banco, `formatDayMonth` continua valendo.
 */
export function formatDayMonthUTC(date: Date, reference = new Date()): string {
  const base = `${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]}`;
  return date.getUTCFullYear() === reference.getUTCFullYear()
    ? base
    : `${base} ${date.getUTCFullYear()}`;
}

export function formatWeekday(date: Date): string {
  return WEEKDAYS_SHORT[date.getDay()];
}

export function formatTime(date: Date): string {
  return `${date.getHours().toString().padStart(2, "0")}:${date
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}

/** "hoje" / "ontem" / "há 3 dias" / "em 5 dias". */
export function formatRelativeDays(days: number): string {
  if (days === 0) return "hoje";
  if (days === 1) return "ontem";
  if (days === -1) return "amanhã";
  if (days > 1) return `há ${days} dias`;
  return `em ${Math.abs(days)} dias`;
}

/** Dias inteiros entre duas datas, ignorando horário. */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86_400_000);
}

/** Iniciais para avatar textual — no máximo duas letras. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
