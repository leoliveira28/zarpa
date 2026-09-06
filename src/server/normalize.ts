/**
 * Normalização de dado brasileiro.
 *
 * Isto não é utilitário decorativo: é o que decide se a deduplicação funciona. A planilha
 * do cliente traz "529.982.247-25", "52998224725" e " 529982247-25 " na mesma coluna, e as
 * três são a mesma pessoa. Se cada uma virar um hash diferente, o índice cego não dedupe
 * nada e a agente importa o mesmo cliente três vezes.
 *
 * Regra geral daqui: normalizar NUNCA joga informação fora do que será gravado — o CPF é
 * gravado como o usuário digitou (cifrado), e a forma normalizada serve só para comparar.
 */

export function apenasDigitos(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Validação de CPF pelos dígitos verificadores (módulo 11).
 *
 * Por que validar na importação: um CPF digitado errado entra no índice cego como se
 * fosse válido e passa a competir por unicidade com um CPF de verdade. Pior, o dono
 * legítimo daquele número não consegue mais ser importado ("já existe"). Melhor recusar a
 * linha com motivo explícito do que aceitar lixo silenciosamente.
 */
export function cpfValido(value: string): boolean {
  const digits = apenasDigitos(value);
  if (digits.length !== 11) return false;
  // 00000000000, 11111111111, ... passam no cálculo do módulo 11 e não são CPF de ninguém.
  if (/^(\d)\1{10}$/.test(digits)) return false;

  for (const [tamanho, posicao] of [
    [9, 10],
    [10, 11],
  ] as const) {
    let soma = 0;
    for (let i = 0; i < tamanho; i += 1) {
      soma += Number(digits[i]) * (posicao - i);
    }
    const resto = (soma * 10) % 11;
    const digitoEsperado = resto === 10 || resto === 11 ? 0 : resto;
    if (digitoEsperado !== Number(digits[tamanho])) return false;
  }
  return true;
}

export function formatarCpf(value: string): string {
  const d = apenasDigitos(value);
  if (d.length !== 11) return value;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/**
 * Telefone brasileiro em forma comparável: só dígitos, sem o `55` do país e sem o zero de
 * operadora. `(11) 98888-7777`, `+55 11 98888 7777` e `011988887777` viram `11988887777`.
 */
export function normalizarTelefone(value: string): string | null {
  let d = apenasDigitos(value);
  if (d === '') return null;
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 12 && d.startsWith('0')) d = d.slice(1);
  return d.length >= 8 ? d : null;
}

export function normalizarEmail(value: string): string | null {
  const limpo = value.trim().toLowerCase();
  if (limpo === '') return null;
  // Deliberadamente frouxo: quem valida de verdade é o zod no serviço. Aqui só serve para
  // comparar e para não deixar passar um "sem e-mail" ou um "-" que a planilha usa como
  // marcador de vazio.
  if (!limpo.includes('@') || limpo.length < 5) return null;
  return limpo;
}

export function normalizarTexto(value: string): string | null {
  const limpo = value.replace(/\s+/g, ' ').trim();
  return limpo === '' ? null : limpo;
}

const MARCADORES_DE_VAZIO = new Set(['-', '--', 'n/a', 'na', 'null', 'nulo', 'sem', 'nao possui', 'não possui', '#n/d', '#n/a']);

/** Planilha marca "vazio" de dez jeitos diferentes. Todos viram `null`. */
export function ehVazio(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  const limpo = value.trim().toLowerCase();
  return limpo === '' || MARCADORES_DE_VAZIO.has(limpo);
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const BR_RE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/;

/**
 * Converte para `AAAA-MM-DD`, aceitando o que planilha brasileira costuma trazer:
 *
 *   - `14/03/1979`, `14-03-1979`, `14.03.1979`  (dd/mm/aaaa — o formato daqui)
 *   - `1979-03-14`                              (ISO, o que o Excel exporta às vezes)
 *   - `14/03/79`                                (ano com 2 dígitos)
 *   - `28923`                                   (serial do Excel, quando a célula é data)
 *
 * Devolve `null` quando não dá para ter certeza. Data ambígua (`03/04/1990` — é 3 de abril
 * ou 4 de março?) é resolvida como DIA/MÊS, que é a convenção brasileira, e essa escolha
 * está anotada aqui porque ela erra em planilha exportada de sistema americano. Quando o
 * primeiro número for > 12 não há ambiguidade e o parser confirma sozinho.
 */
export function parseDataFlexivel(input: string | number | Date | null | undefined): string | null {
  if (input === null || input === undefined) return null;

  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : isoDeUTC(input);
  }

  if (typeof input === 'number') return serialExcelParaIso(input);

  const value = input.trim();
  if (ehVazio(value)) return null;

  const iso = ISO_RE.exec(value);
  if (iso) {
    return dataValida(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const br = BR_RE.exec(value);
  if (br) {
    const dia = Number(br[1]);
    const mes = Number(br[2]);
    let ano = Number(br[3]);
    if (br[3]!.length === 2) {
      // Ano de 2 dígitos: 00–30 é 2000+, 31–99 é 1900+. Em base de nascimento e de
      // validade de passaporte esse corte acerta praticamente sempre.
      ano = ano <= 30 ? 2000 + ano : 1900 + ano;
    }
    return dataValida(ano, mes, dia);
  }

  // Só dígitos e comprimento de serial do Excel (célula de data exportada como número).
  if (/^\d{5}$/.test(value)) return serialExcelParaIso(Number(value));

  return null;
}

function dataValida(ano: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  if (ano < 1900 || ano > 2200) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  // Rejeita 31/02: o Date normaliza para 03/03 e o mês deixa de bater.
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    return null;
  }
  return isoDeUTC(d);
}

function isoDeUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Serial de data do Excel: dias desde 1899-12-30 (e não 1900-01-01 — o Excel acredita que
 * 1900 foi bissexto, bug herdado do Lotus 1-2-3 e mantido por compatibilidade desde 1985).
 */
export function serialExcelParaIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const ms = Math.round(serial) * 86_400_000;
  const base = Date.UTC(1899, 11, 30);
  return isoDeUTC(new Date(base + ms));
}

/** `1979-03-14` → `03-14`. É o que vai para a coluna em claro do alerta de aniversário. */
export function mesEDiaDe(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = ISO_RE.exec(iso.trim());
  if (!m) return null;
  return `${m[2]}-${m[3]}`;
}
