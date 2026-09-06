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

/**
 * Data da viagem, derivada de `travelIn` (dias a partir de hoje). Fica relativa
 * a agora de propósito: com data fixa, a tela de exemplo envelhece e em três
 * meses mostra viagem no passado. Formate com `formatDayMonthUTC` — a razão
 * está lá.
 */
export function travelDate(proposal: Proposal, now: number = Date.now()): Date {
  return new Date(now + proposal.travelIn * 86_400_000);
}

export function sumCents(list: Proposal[]): number {
  return list.reduce((total, proposal) => total + proposal.cents, 0);
}

/* =============================================================================
   Contatos e passageiros — em memória, na forma exata do serviço real
   -----------------------------------------------------------------------------
   FRONTEIRA DE DADOS: `src/server/contacts.ts` e `src/server/travelers.ts` (Rafa)
   já existem e já validam, cifram e auditam de verdade — mas exigem uma sessão
   autenticada (`requireAuthContext`), e ainda não existe tela de login
   (`docs/handoffs/rafa-para-nina.md`). Chamar os dois hoje devolveria
   `NAO_AUTENTICADO` em toda visita, então a tela de Clientes lê DAQUI por
   enquanto.

   Os tipos abaixo (`ContatoAmostra`, `ViajanteAmostra`) são a MESMA FORMA de
   `ContatoResumo`/`ContatoDetalhe`/`ViajanteResumo` do servidor — mesmo nome de
   campo, mesma unidade (centavos, `MM-DD`, ISO). Não é coincidência: é o que
   torna a troca um `import` só, no dia em que o login existir. Nenhum outro
   componente deveria importar daqui além de `clientes/**`.
   ========================================================================== */

export type ContatoAmostra = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  source: "whatsapp" | "instagram" | "indicacao" | "site" | "evento" | "outro" | null;
  tags: string[];
  temDocumento: boolean;
  arquivado: boolean;
  createdAt: Date;
  notes: string | null;
  /** `MM-DD`. Ano fica de fora — mesma regra do servidor. */
  aniversario: string | null;
  updatedAt: Date;
  totalViajantes: number;
  totalNegocios: number;
};

export type ViajanteAmostra = {
  id: string;
  contactId: string;
  fullName: string;
  kind: "adult" | "child" | "infant";
  nationality: string;
  temCpf: boolean;
  temPassaporte: boolean;
  /** ISO `YYYY-MM-DD`. Em claro no servidor também — não é dado sensível. */
  passportExpiresOn: string | null;
  aniversario: string | null;
  createdAt: Date;
};

/** `hoje + n dias`, em `MM-DD` — para o alerta de aniversário nunca ficar velho. */
function monthDayInDays(n: number, now: number = Date.now()): string {
  const d = new Date(now + n * 86_400_000);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** `hoje + n dias`, em ISO — para o passaporte vencer sempre daqui a pouco. */
function isoInDays(n: number, now: number = Date.now()): string {
  return new Date(now + n * 86_400_000).toISOString().slice(0, 10);
}

const DAY = 86_400_000;

export const CONTATOS: ContatoAmostra[] = [
  {
    id: "c-1",
    name: "Marina Albuquerque",
    email: "marina.albuquerque@gmail.com",
    phone: "(81) 99123-4567",
    whatsapp: "(81) 99123-4567",
    source: "indicacao",
    tags: ["lua de mel", "recorrente"],
    temDocumento: true,
    arquivado: false,
    createdAt: new Date(Date.now() - 220 * DAY),
    notes: "Prefere resort com tudo incluído. Já fechou duas vezes.",
    aniversario: monthDayInDays(9),
    updatedAt: new Date(Date.now() - 2 * DAY),
    totalViajantes: 2,
    totalNegocios: 3,
  },
  {
    id: "c-2",
    name: "Kenji Tanaka",
    email: "kenji.tanaka@outlook.com",
    phone: "(11) 98877-2211",
    whatsapp: "(11) 98877-2211",
    source: "site",
    tags: ["família"],
    temDocumento: true,
    arquivado: false,
    createdAt: new Date(Date.now() - 140 * DAY),
    notes: null,
    aniversario: "03-18",
    updatedAt: new Date(Date.now() - 9 * DAY),
    totalViajantes: 4,
    totalNegocios: 1,
  },
  {
    id: "c-3",
    name: "Rodrigo Sá",
    email: null,
    phone: "(41) 99654-8890",
    whatsapp: "(41) 99654-8890",
    source: "whatsapp",
    tags: [],
    temDocumento: false,
    arquivado: false,
    createdAt: new Date(Date.now() - 30 * DAY),
    notes: null,
    aniversario: null,
    updatedAt: new Date(Date.now() - 12 * DAY),
    totalViajantes: 1,
    totalNegocios: 1,
  },
  {
    id: "c-4",
    name: "Cláudia Nogueira",
    email: "claudia.wilson@gmail.com",
    phone: "(21) 98111-3344",
    whatsapp: "(21) 98111-3344",
    source: "instagram",
    tags: ["casal", "recorrente"],
    temDocumento: true,
    arquivado: false,
    createdAt: new Date(Date.now() - 400 * DAY),
    notes: "Wilson (marido) viaja junto sempre. Ele tem restrição alimentar.",
    aniversario: monthDayInDays(3),
    updatedAt: new Date(Date.now() - 1 * DAY),
    totalViajantes: 2,
    totalNegocios: 4,
  },
  {
    id: "c-5",
    name: "Ana Beatriz Nogueira",
    email: "ana.bia@gmail.com",
    phone: "(82) 99222-1010",
    whatsapp: "(82) 99222-1010",
    source: "evento",
    tags: [],
    temDocumento: false,
    arquivado: false,
    createdAt: new Date(Date.now() - 5 * DAY),
    notes: null,
    aniversario: null,
    updatedAt: new Date(Date.now() - 5 * DAY),
    totalViajantes: 0,
    totalNegocios: 1,
  },
  {
    id: "c-6",
    name: "Sérgio Muniz",
    email: "sergio.muniz@empresa.com.br",
    phone: "(85) 98765-4321",
    whatsapp: null,
    source: "outro",
    tags: ["corporativo"],
    temDocumento: true,
    arquivado: false,
    createdAt: new Date(Date.now() - 600 * DAY),
    notes: "Sempre viaja a trabalho, prefere voo cedo.",
    aniversario: "11-02",
    updatedAt: new Date(Date.now() - 40 * DAY),
    totalViajantes: 1,
    totalNegocios: 5,
  },
  {
    id: "c-7",
    name: "Letícia Moraes",
    email: "leticia.moraes@gmail.com",
    phone: "(31) 99456-7788",
    whatsapp: "(31) 99456-7788",
    source: "site",
    tags: ["família"],
    temDocumento: true,
    arquivado: true,
    createdAt: new Date(Date.now() - 500 * DAY),
    notes: "Arquivada — não viaja há mais de um ano.",
    aniversario: null,
    updatedAt: new Date(Date.now() - 200 * DAY),
    totalViajantes: 3,
    totalNegocios: 2,
  },
];

export const VIAJANTES: ViajanteAmostra[] = [
  {
    id: "v-1",
    contactId: "c-1",
    fullName: "Marina Albuquerque",
    kind: "adult",
    nationality: "BR",
    temCpf: true,
    temPassaporte: true,
    passportExpiresOn: isoInDays(48),
    aniversario: monthDayInDays(9),
    createdAt: new Date(Date.now() - 220 * DAY),
  },
  {
    id: "v-2",
    contactId: "c-1",
    fullName: "Felipe Andrade",
    kind: "adult",
    nationality: "BR",
    temCpf: true,
    temPassaporte: true,
    passportExpiresOn: isoInDays(400),
    aniversario: "07-22",
    createdAt: new Date(Date.now() - 220 * DAY),
  },
  {
    id: "v-3",
    contactId: "c-2",
    fullName: "Kenji Tanaka",
    kind: "adult",
    nationality: "BR",
    temCpf: true,
    temPassaporte: true,
    passportExpiresOn: isoInDays(720),
    aniversario: "03-18",
    createdAt: new Date(Date.now() - 140 * DAY),
  },
  {
    id: "v-4",
    contactId: "c-2",
    fullName: "Yuki Tanaka",
    kind: "adult",
    nationality: "BR",
    temCpf: true,
    temPassaporte: true,
    passportExpiresOn: isoInDays(15),
    aniversario: "05-30",
    createdAt: new Date(Date.now() - 140 * DAY),
  },
  {
    id: "v-5",
    contactId: "c-2",
    fullName: "Sofia Tanaka",
    kind: "child",
    nationality: "BR",
    temCpf: false,
    temPassaporte: true,
    passportExpiresOn: isoInDays(15),
    aniversario: "12-08",
    createdAt: new Date(Date.now() - 140 * DAY),
  },
  {
    id: "v-6",
    contactId: "c-2",
    fullName: "Haru Tanaka",
    kind: "child",
    nationality: "BR",
    temCpf: false,
    temPassaporte: false,
    passportExpiresOn: null,
    aniversario: "12-08",
    createdAt: new Date(Date.now() - 140 * DAY),
  },
  {
    id: "v-7",
    contactId: "c-3",
    fullName: "Rodrigo Sá",
    kind: "adult",
    nationality: "BR",
    temCpf: false,
    temPassaporte: false,
    passportExpiresOn: null,
    aniversario: null,
    createdAt: new Date(Date.now() - 30 * DAY),
  },
  {
    id: "v-8",
    contactId: "c-4",
    fullName: "Cláudia Nogueira",
    kind: "adult",
    nationality: "BR",
    temCpf: true,
    temPassaporte: true,
    passportExpiresOn: isoInDays(200),
    aniversario: monthDayInDays(3),
    createdAt: new Date(Date.now() - 400 * DAY),
  },
  {
    id: "v-9",
    contactId: "c-4",
    fullName: "Wilson Nogueira",
    kind: "adult",
    nationality: "BR",
    temCpf: true,
    temPassaporte: true,
    passportExpiresOn: isoInDays(80),
    aniversario: "09-30",
    createdAt: new Date(Date.now() - 400 * DAY),
  },
  {
    id: "v-10",
    contactId: "c-6",
    fullName: "Sérgio Muniz",
    kind: "adult",
    nationality: "BR",
    temCpf: true,
    temPassaporte: true,
    passportExpiresOn: isoInDays(600),
    aniversario: "11-02",
    createdAt: new Date(Date.now() - 600 * DAY),
  },
];

/** Contatos não arquivados que batem com nome, e-mail ou telefone. */
export function buscarContatos(
  termo: string,
  { incluirArquivados = false }: { incluirArquivados?: boolean } = {},
): ContatoAmostra[] {
  const base = incluirArquivados ? CONTATOS : CONTATOS.filter((c) => !c.arquivado);
  const alvo = termo.trim().toLocaleLowerCase("pt-BR");
  if (!alvo) return base;
  return base.filter((c) =>
    [c.name, c.email, c.phone, c.whatsapp]
      .filter(Boolean)
      .some((campo) => campo!.toLocaleLowerCase("pt-BR").includes(alvo)),
  );
}

export function viajantesDoContato(contactId: string): ViajanteAmostra[] {
  return VIAJANTES.filter((v) => v.contactId === contactId);
}

/** Passaportes vencendo em até `dias` (padrão 90) — mesma janela do servidor. */
export function passaportesVencendo(
  dias = 90,
): (ViajanteAmostra & { contatoNome: string; contactId: string })[] {
  const limite = isoInDays(dias);
  return VIAJANTES.filter((v) => v.passportExpiresOn && v.passportExpiresOn <= limite)
    .map((v) => ({
      ...v,
      contatoNome: CONTATOS.find((c) => c.id === v.contactId)?.name ?? "—",
    }))
    .sort((a, b) => (a.passportExpiresOn ?? "").localeCompare(b.passportExpiresOn ?? ""));
}

/** Aniversários (contato + passageiro) nos próximos `dias` (padrão 14). */
export function aniversariosProximos(
  dias = 14,
): { id: string; nome: string; aniversario: string; contactId: string }[] {
  const hoje = new Date();
  const alvo: { id: string; nome: string; aniversario: string; contactId: string }[] = [];

  function diasAteProximoAniversario(monthDay: string): number {
    const [month, day] = monthDay.split("-").map(Number);
    const ano = hoje.getFullYear();
    let proximo = new Date(ano, month - 1, day);
    if (
      Date.UTC(proximo.getFullYear(), proximo.getMonth(), proximo.getDate()) <
      Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
    ) {
      proximo = new Date(ano + 1, month - 1, day);
    }
    return Math.round((proximo.getTime() - hoje.getTime()) / DAY);
  }

  for (const contato of CONTATOS) {
    if (contato.arquivado || !contato.aniversario) continue;
    if (diasAteProximoAniversario(contato.aniversario) <= dias) {
      alvo.push({
        id: contato.id,
        nome: contato.name,
        aniversario: contato.aniversario,
        contactId: contato.id,
      });
    }
  }
  for (const viajante of VIAJANTES) {
    if (!viajante.aniversario) continue;
    if (diasAteProximoAniversario(viajante.aniversario) <= dias) {
      alvo.push({
        id: viajante.id,
        nome: viajante.fullName,
        aniversario: viajante.aniversario,
        contactId: viajante.contactId,
      });
    }
  }
  return alvo.sort(
    (a, b) => diasAteProximoAniversario(a.aniversario) - diasAteProximoAniversario(b.aniversario),
  );
}
