/* =============================================================================
   Dados de exemplo — em memória
   -----------------------------------------------------------------------------
   O backend (Rafa) ainda não expõe leitura. Estes dados existem só para as
   telas de referência e para o /kitchen-sink. Regras que eu me impus:

     - valores em CENTAVOS, como vai chegar do banco
     - datas relativas a "hoje", calculadas em runtime, para a tela nunca
       parecer velha
     - nomes e destinos plausíveis do mercado brasileiro; nada de "Lorem ipsum"
       nem "John Doe". Conteúdo falso genérico esconde problema de layout real
       (nome comprido, valor de 6 dígitos, destino com acento)

   Quando o backend chegar, isto sai inteiro. Nenhum componente importa daqui.
   ========================================================================== */

export type Stage =
  | "novo"
  | "montando"
  | "enviada"
  | "negociando"
  | "fechada";

export const STAGES: { id: Stage; label: string; hint: string }[] = [
  { id: "novo", label: "Novo contato", hint: "chegou, ainda não virou proposta" },
  { id: "montando", label: "Montando", hint: "roteiro em construção" },
  { id: "enviada", label: "Enviada", hint: "link no WhatsApp do cliente" },
  { id: "negociando", label: "Negociando", hint: "ajuste de valor ou data" },
  { id: "fechada", label: "Fechada", hint: "venda confirmada" },
];

export interface Proposal {
  id: string;
  client: string;
  destination: string;
  /** Valor de venda em centavos. */
  cents: number;
  stage: Stage;
  /** Dias desde a última movimentação. */
  idleDays: number;
  /** Quantas vezes o cliente abriu o link. */
  opens: number;
  /** Horas desde a última abertura. `null` se nunca abriu. */
  lastOpenHours: number | null;
  travelIn: number;
}

export const PROPOSALS: Proposal[] = [
  {
    id: "p-1",
    client: "Marina Albuquerque",
    destination: "Fernando de Noronha",
    cents: 1_284_000,
    stage: "negociando",
    idleDays: 1,
    opens: 6,
    lastOpenHours: 3,
    travelIn: 62,
  },
  {
    id: "p-2",
    client: "Família Tanaka",
    destination: "Japão — Tóquio e Quioto",
    cents: 4_760_000,
    stage: "enviada",
    idleDays: 9,
    opens: 2,
    lastOpenHours: 51,
    travelIn: 210,
  },
  {
    id: "p-3",
    client: "Rodrigo Sá",
    destination: "Bariloche",
    cents: 989_000,
    stage: "enviada",
    idleDays: 12,
    opens: 0,
    lastOpenHours: null,
    travelIn: 95,
  },
  {
    id: "p-4",
    client: "Cláudia e Wilson",
    destination: "Cruzeiro pelo Mediterrâneo",
    cents: 3_215_000,
    stage: "montando",
    idleDays: 0,
    opens: 0,
    lastOpenHours: null,
    travelIn: 140,
  },
  {
    id: "p-5",
    client: "Ana Beatriz Nogueira",
    destination: "Maceió — Praia do Gunga",
    cents: 476_500,
    stage: "novo",
    idleDays: 0,
    opens: 0,
    lastOpenHours: null,
    travelIn: 41,
  },
  {
    id: "p-6",
    client: "Pedro Henrique Vasconcelos",
    destination: "Patagônia — El Calafate",
    cents: 2_140_000,
    stage: "negociando",
    idleDays: 8,
    opens: 4,
    lastOpenHours: 30,
    travelIn: 120,
  },
  {
    id: "p-7",
    client: "Juliana Prado",
    destination: "Lisboa e Porto",
    cents: 1_698_000,
    stage: "fechada",
    idleDays: 2,
    opens: 9,
    lastOpenHours: 20,
    travelIn: 33,
  },
  {
    id: "p-8",
    client: "Escritório Lemos Advogados",
    destination: "Gramado — viagem de equipe",
    cents: 5_940_000,
    stage: "montando",
    idleDays: 3,
    opens: 0,
    lastOpenHours: null,
    travelIn: 77,
  },
  {
    id: "p-9",
    client: "Sérgio Muniz",
    destination: "Cartagena",
    cents: 812_000,
    stage: "enviada",
    idleDays: 15,
    opens: 1,
    lastOpenHours: 300,
    travelIn: 58,
  },
  {
    id: "p-10",
    client: "Letícia Moraes",
    destination: "Orlando — parques",
    cents: 2_869_000,
    stage: "novo",
    idleDays: 0,
    opens: 0,
    lastOpenHours: null,
    travelIn: 180,
  },
];

export interface Task {
  id: string;
  title: string;
  detail: string;
  at: string;
  kind: "followup" | "prazo" | "pagamento";
  done: boolean;
}

export const TASKS: Task[] = [
  {
    id: "t-1",
    title: "Ligar para Marina Albuquerque",
    detail: "Ela abriu a proposta 6 vezes e não respondeu no WhatsApp",
    at: "09:30",
    kind: "followup",
    done: false,
  },
  {
    id: "t-2",
    title: "Confirmar bloqueio aéreo — Família Tanaka",
    detail: "Tarifa segura até amanhã às 18h",
    at: "11:00",
    kind: "prazo",
    done: false,
  },
  {
    id: "t-3",
    title: "Enviar link de pagamento — Juliana Prado",
    detail: "Entrada de R$ 5.000,00 combinada por telefone",
    at: "14:00",
    kind: "pagamento",
    done: false,
  },
  {
    id: "t-4",
    title: "Revisar roteiro de Gramado",
    detail: "Escritório Lemos pediu jantar de encerramento no sábado",
    at: "16:30",
    kind: "followup",
    done: true,
  },
];

/** Propostas que o cliente abriu recentemente — o sinal mais forte do produto. */
export function recentlyOpened(list: Proposal[] = PROPOSALS): Proposal[] {
  return list
    .filter((p) => p.lastOpenHours !== null && p.lastOpenHours <= 48)
    .sort((a, b) => (a.lastOpenHours ?? 0) - (b.lastOpenHours ?? 0));
}

/** Propostas paradas há mais de 7 dias — o dinheiro que escorre pelo ralo. */
export function stalled(list: Proposal[] = PROPOSALS): Proposal[] {
  return list
    .filter((p) => p.idleDays > 7 && p.stage !== "fechada")
    .sort((a, b) => b.idleDays - a.idleDays);
}

export function byStage(list: Proposal[] = PROPOSALS) {
  return STAGES.map((stage) => ({
    ...stage,
    items: list.filter((proposal) => proposal.stage === stage.id),
  }));
}

export function sumCents(list: Proposal[]): number {
  return list.reduce((total, proposal) => total + proposal.cents, 0);
}
