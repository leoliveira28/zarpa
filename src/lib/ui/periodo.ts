import type { PeriodoInput } from "@/server";

/* =============================================================================
   Período — o estado de leitura que mora na URL
   -----------------------------------------------------------------------------
   §1 de PROPOSTAS_PRODUTO: as telas de leitura (/hoje, hub Dinheiro) mostravam
   "este mês" FIXO. O agente que fecha 12 em dezembro e nada em março não
   conseguia olhar para trás. O seletor escreve o recorte na URL
   (`?periodo=...`) — não em memória escondida — então um link compartilhado
   abre na MESMA janela e o botão Voltar restaura.

   Formas do parâmetro (uma só gramática, a que o servidor aceita):

     (ausente)                 mês corrente — o estado que as telas já tinham
     2026-09                   um mês civil (`PeriodoInput.mes`)
     2026-01-01..2026-03-31    faixa com as duas pontas inclusivas

   A validação AQUI é a mesma do servidor (`src/server/periodo.ts`) de
   propósito: um parâmetro malformado não viaja para a action só para voltar
   como erro — a tela mostra o aviso "link de período não é válido" com o
   caminho de correção junto, e lê o mês corrente por baixo (o rótulo que o
   backend devolve na resposta é o que a tela mostra, então o recorte visto
   nunca mente).

   FUSO: os meses "corrente" e "passado" dos atalhos são calculados em UTC —
   a MESMA convenção de `resolverPeriodo` (dashboard/deals desde o S10).
   Calcular no fuso do aparelho divergiria do servidor entre 00:00 e 03:00 do
   primeiro dia do mês, e o atalho marcado como ativo poderia mentir.
   ========================================================================== */

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
const FAIXA_RE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;

const MESES_CURTOS = [
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

/** `2026-09` → `"set 2026"`. Mesmo formato que a tela Hoje já usava. */
export function formatarMes(mes: string): string {
  const [ano, numero] = mes.split("-");
  return `${MESES_CURTOS[Number(numero) - 1]} ${ano}`;
}

function mesUTC(data: Date): string {
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Mês corrente no fuso que o servidor usa (UTC). */
export function mesCorrenteUTC(agora: Date = new Date()): string {
  return mesUTC(agora);
}

/** O mês anterior ao corrente, em UTC — o atalho "Mês passado". */
export function mesAnteriorUTC(agora: Date = new Date()): string {
  const anterior = new Date(
    Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - 1, 1),
  );
  return mesUTC(anterior);
}

/** Ano corrente em UTC — o atalho "Este ano" vira `AAAA-01-01..AAAA-12-31`. */
export function anoCorrenteUTC(agora: Date = new Date()): number {
  return agora.getUTCFullYear();
}

/** `2026-02-30` não existe — o `Date` normaliza para 03/03 e o mês deixa de bater. */
function diaExiste(iso: string): boolean {
  if (!DIA_RE.test(iso)) return false;
  const [ano, mes, dia] = iso.split("-").map(Number) as [number, number, number];
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return (
    data.getUTCFullYear() === ano &&
    data.getUTCMonth() === mes - 1 &&
    data.getUTCDate() === dia
  );
}

export type PeriodoParam =
  | { ok: true; input: PeriodoInput | undefined }
  | { ok: false };

/**
 * Lê o parâmetro da URL e devolve o `PeriodoInput` da action — ou `{ ok: false }`
 * quando ele não é válido (link editado à mão, compartilhado torto). Ausente e
 * vazio são o mês corrente (`input: undefined`), preservando o estado atual.
 */
export function parseParamPeriodo(param: string | undefined | null): PeriodoParam {
  const valor = param?.trim();
  if (!valor) return { ok: true, input: undefined };

  if (MES_RE.test(valor)) {
    return { ok: true, input: { mes: valor } };
  }

  const faixa = FAIXA_RE.exec(valor);
  if (faixa) {
    const [, de, ate] = faixa;
    if (!diaExiste(de) || !diaExiste(ate) || de > ate) return { ok: false };
    return { ok: true, input: { de, ate } };
  }

  return { ok: false };
}

/**
 * Codifica as duas pontas escolhidas de volta para o parâmetro. Um intervalo
 * que é exatamente um mês civil vira a forma curta (`2026-09`) — o link fica
 * limpo e o rótulo do backend ("set 2026") sai melhor que um par de datas.
 * `null` quando as pontas não formam um intervalo válido — quem chama mostra
 * o erro no painel, não navega.
 */
export function encodeParamPeriodo(de: string, ate: string): string | null {
  if (!diaExiste(de) || !diaExiste(ate) || de > ate) return null;

  const [anoDe, mesDe, diaDe] = de.split("-").map(Number) as [number, number, number];
  const [anoAte, mesAte, diaAte] = ate.split("-").map(Number) as [number, number, number];
  const ultimoDiaDoMes = new Date(Date.UTC(anoAte, mesAte, 0)).getUTCDate();

  if (anoDe === anoAte && mesDe === mesAte && diaDe === 1 && diaAte === ultimoDiaDoMes) {
    return `${anoDe}-${String(mesDe).padStart(2, "0")}`;
  }
  return `${de}..${ate}`;
}

export type PeriodoChave = "este-mes" | "mes-passado" | "este-ano" | "custom" | "invalido";

/** Qual atalho do seletor está ativo para o parâmetro atual. */
export function chaveDoParamPeriodo(
  param: string | undefined | null,
  agora: Date = new Date(),
): PeriodoChave {
  const parsed = parseParamPeriodo(param);
  if (!parsed.ok) return "invalido";
  const input = parsed.input;
  if (!input) return "este-mes";

  if (input.mes) {
    if (input.mes === mesCorrenteUTC(agora)) return "este-mes";
    if (input.mes === mesAnteriorUTC(agora)) return "mes-passado";
    return "custom";
  }

  const ano = anoCorrenteUTC(agora);
  if (input.de === `${ano}-01-01` && input.ate === `${ano}-12-31`) return "este-ano";
  return "custom";
}

/**
 * As duas pontas `AAAA-MM-DD` do recorte da URL — para quem não lê a forma
 * `mes` (o CSV de vendas do período, o ranking). Ausente ou inválido = mês
 * corrente, a MESMA convenção de `parseParamPeriodo` e do servidor: o arquivo
 * baixado nunca pode recortar uma janela diferente da que a tela mostra.
 */
export function limitesDoPeriodo(
  param: string | undefined | null,
  agora: Date = new Date(),
): { de: string; ate: string } {
  const parsed = parseParamPeriodo(param);
  const input = parsed.ok ? parsed.input : undefined;
  if (input?.de && input?.ate) return { de: input.de, ate: input.ate };
  // `mes`, ausente ou param torto: mês corrente — o mesmo fallback das telas.
  return limitesDoMes(input?.mes ?? mesCorrenteUTC(agora));
}

/** Primeiro e último dia de um mês civil `AAAA-MM`. */
function limitesDoMes(mes: string): { de: string; ate: string } {
  const [ano, numero] = mes.split("-").map(Number) as [number, number];
  const ultimoDia = new Date(Date.UTC(ano, numero, 0)).getUTCDate();
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimoDia).padStart(2, "0")}` };
}

/**
 * O rótulo do backend (`ResumoDoMes.periodo` / `ResumoDoPeriodo.periodo`),
 * humanizado para a subtítulo da tela: `2026-09` → "set 2026";
 * `2026-01-01..2026-03-31` → "1 jan – 31 mar 2026". É o MESMO recorte que o
 * servidor devolve — só a apresentação é da interface.
 */
export function formatarRotuloPeriodo(periodo: { de: string; ate: string; rotulo: string }): string {
  if (MES_RE.test(periodo.rotulo)) return formatarMes(periodo.rotulo);

  const de = new Date(`${periodo.de}T00:00:00Z`);
  const ate = new Date(`${periodo.ate}T00:00:00Z`);
  if (Number.isNaN(de.valueOf()) || Number.isNaN(ate.valueOf())) return periodo.rotulo;

  const diaMes = (data: Date, comAno: boolean) =>
    comAno
      ? `${data.getUTCDate()} ${MESES_CURTOS[data.getUTCMonth()]} ${data.getUTCFullYear()}`
      : `${data.getUTCDate()} ${MESES_CURTOS[data.getUTCMonth()]}`;

  const mesmoAno = de.getUTCFullYear() === ate.getUTCFullYear();
  const anoVem = !mesmoAno || de.getUTCFullYear() !== anoCorrenteUTC();
  if (!mesmoAno) return `${diaMes(de, true)} – ${diaMes(ate, true)}`;
  return `${diaMes(de, false)} – ${diaMes(ate, anoVem)}`;
}
