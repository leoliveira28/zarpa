'use server';

import { and, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { contacts, deals, proposals, sales } from '@/db/schema';
import { withTenant, type TenantDb } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { comoResultado, type ServiceResult } from './errors';
import { resolverPeriodo, type Periodo, type PeriodoInput } from './periodo';

/**
 * S10 — o resumo do mês que a agente abre para DECIDIR o que fazer, não só para olhar
 * número bonito. Cada campo deste arquivo existe porque alguma tela do produto já sabe
 * responder "e agora, o que eu faço com isso" — ver o mapeamento card→rota em
 * `docs/handoffs/rafa-para-nina.md`, seção "S10". O caso mais importante é
 * `paradas.itens`: nunca devolvo só a CONTAGEM de propostas paradas, sempre os `id`s — uma
 * contagem sem id não linka para lugar nenhum, e "3 propostas paradas" que não leva a
 * lugar é decoração, não dashboard.
 *
 * Mesmas quatro regras de `contacts.ts`/`deals.ts`: `tenantId` vem de
 * `requireAuthContext()` (nunca argumento), toda query dentro de `withTenant`, entrada
 * validada com zod antes de tocar no banco (aqui não há entrada — é só leitura), erro
 * volta como `ServiceResult`.
 *
 * NENHUMA tabela nova, NENHUMA migration nesta entrega — tudo lido de `sales` e
 * `proposals`, que já têm RLS desde `0007_vendas_e_recebiveis.sql`/
 * `0003_construtor_de_proposta.sql`. As três queries deste arquivo leem COLUNA DE VERDADE
 * (nunca `sql<Date>()`/`sql<>` livre usado como valor de `.select({...})`) — o bug de
 * qualificação de tabela documentado em `deals.ts` (`ultimaAtividadeSql`) e corrigido em
 * `contacts.ts` (`obterContato`) só acontece nesse padrão específico; como
 * `sentAt`/`lastViewedAt`/`createdAt` aqui são sempre a COLUNA do schema direto (nunca
 * embrulhada em `sql<>`), o Drizzle aplica o `mapFromDriverValue` normal e os valores já
 * chegam como `Date` de verdade — não precisei do `paraDataOuNula()` defensivo que
 * `deals.ts` precisou.
 */

// ---------------------------------------------------------------------------
// Decisões de recorte — documentadas aqui porque são a parte que mais importa revisar
// ---------------------------------------------------------------------------
//
// 0. PERÍODO (§1 de `docs/PROPOSTAS_PRODUTO.md`): `obterResumoDoMes` e
//    `exportarResumoDoMesCsv` aceitam um período opcional (`{ mes: 'AAAA-MM' }` ou
//    `{ de, ate }`) validado em `./periodo.ts`. AUSENTE = mês corrente — o comportamento
//    que a tela já tinha, preservado. As métricas 1, 2 e 3 abaixo passam a usar as
//    fronteiras do período recebido; a decisão de recorte é a mesma, só muda a janela.
//
// 1. "VENDAS DO MÊS" = soma de `sales.valorBrutoCents` das linhas cujo `sales.createdAt`
//    cai no período (mês corrente por padrão, UTC). `sales` não tem coluna própria de
//    "quando fechou" (ao
//    contrário de `deals.closedAt`) — mas a PRÓPRIA EXISTÊNCIA da linha já significa
//    "fechou": `converterPropostaEmVenda` só cria `sales` a partir de
//    `proposals.status = 'accepted'`. `createdAt` é o melhor proxy disponível para "quando
//    a venda fechou" sem inventar coluna nova. Se um dia o produto separar "quando o
//    cliente aceitou" de "quando o agente registrou a venda no sistema" (o agente pode
//    converter dias depois do aceite), isto precisa de uma coluna própria — não existe
//    hoje, e o roteiro desta rodada não pediu.
//
// 2. "COMISSÃO A RECEBER VS. RECEBIDA" É ESCOPADA AO MESMO MÊS DE (1), não a todo saldo em
//    aberto histórico. Ou seja: só comissão das vendas FECHADAS ESTE MÊS, agrupada por
//    `comissaoStatus`. Decisão consciente, não a única leitura possível do pedido — a
//    alternativa ("tudo que ainda falta receber, não importa quando vendeu") é uma métrica
//    diferente (mais parecida com um relatório de contas a receber do que com "resumo do
//    mês") e teria peso de query diferente (não filtra por `createdAt`, varre toda
//    `comissaoStatus <> 'recebida'` do tenant). Optei pela leitura "resumo do mês" porque é
//    o tema da sprint (S10 — "Dashboard do MÊS") e porque mantém as três primeiras métricas
//    no MESMO recorte de tempo, sem o usuário precisar decidir "essa comissão é de quando".
//    Se o produto quiser as duas visões (mês + acumulado), é uma segunda função — registrado
//    como pedido em aberto no status.
//
// 3. "CONVERSÃO DE PROPOSTA" usa uma coorte por `sentAt`: entre as propostas cujo
//    `sentAt` cai no mês corrente, qual fração está (agora, no momento da consulta) com
//    `status = 'accepted'`. Não é "aceitas neste mês dividido por enviadas neste mês" (que
//    exigiria dois filtros de data diferentes e criaria uma taxa que passa de 100% quando
//    proposta enviada num mês é aceita no mês seguinte) — é sempre a MESMA coorte (quem foi
//    enviado este mês), medida no presente. Uma proposta enviada dia 30 e aceita dia 3 do
//    mês seguinte ainda conta como conversão da coorte de envio.
//
// 4. "PROPOSTAS PARADAS" usa o MESMO limiar de dias que `listarNegociosParados`
//    (`deals.ts`, `DIAS_PARADO_LIMITE = 7`) — mesmo conceito de "parado" em todo o produto,
//    para a agente não precisar aprender dois números diferentes de "quanto tempo é
//    demais". `diasParado` é medido a partir do evento mais recente entre `sentAt` e
//    `lastViewedAt` (a última vez que algo aconteceu do lado do cliente), não de
//    `updatedAt` (que muda por qualquer edição do agente, inclusive uma que não tem nada a
//    ver com o cliente ter visto ou não). Escopo: `status in ('sent','viewed')` e
//    `archivedAt is null` — proposta arquivada saiu da lista de trabalho ativa (mesmo
//    filtro de `proposals_tenant_active_idx`), não é "parada", é descartada. SEM recorte de
//    mês: uma proposta enviada há 40 dias sem resposta continua parada mesmo que tenha sido
//    enviada no mês passado — "parado" é sobre agora, não sobre quando nasceu (mesma lógica
//    de `pipelineAbertoCents` em `deals.ts`, que também não tem recorte de tempo).

const DIAS_PARADA_LIMITE = 7;

// ---------------------------------------------------------------------------
// Helpers de data — mesma forma que `deals.ts`, duplicados aqui de propósito: cada
// serviço mantém seus próprios helpers pequenos (padrão já estabelecido no projeto —
// `sales.ts` também tem os seus), em vez de um utilitário de data compartilhado que
// arrastaria import cruzado entre arquivos de `'use server'`.
// ---------------------------------------------------------------------------

function maisRecente(a: Date, b: Date | null): Date {
  if (!b) return a;
  return b.getTime() > a.getTime() ? b : a;
}

/** Dias corridos desde `data`. Nunca negativo (relógio adiantado no cliente não gera "-1 dia"). */
function diasDesde(data: Date, agora: number): number {
  return Math.max(0, Math.floor((agora - data.getTime()) / 86_400_000));
}

// ---------------------------------------------------------------------------
// 1) Vendas e faturamento do mês
// ---------------------------------------------------------------------------

export type ResumoVendasDoMes = {
  /** Quantidade de vendas fechadas no mês (linhas de `sales`, ver decisão 1 acima). */
  totalVendas: number;
  /** Soma de `sales.valorBrutoCents` — o que o cliente pagou, não a margem do agente. */
  faturamentoBrutoCents: number;
  /** Soma de `sales.taxaServicoCents` — honorário cobrado além do preço do produto. */
  taxaServicoCents: number;
};

// ---------------------------------------------------------------------------
// 2) Comissão a receber vs. recebida (ver decisão 2 acima)
// ---------------------------------------------------------------------------

export type ResumoComissaoDoMes = {
  previstaCents: number;
  recebidaCents: number;
  atrasadaCents: number;
  /** `previstaCents + atrasadaCents` — o número pronto para o rótulo "a receber" da tela. */
  aReceberCents: number;
  /** Soma das três — comissão total das vendas do mês, recebida ou não. */
  totalCents: number;
};

// ---------------------------------------------------------------------------
// 3) Conversão de proposta (ver decisão 3 acima)
// ---------------------------------------------------------------------------

export type ConversaoDePropostas = {
  /** Propostas com `sentAt` no mês corrente — a coorte inteira, qualquer status atual. */
  enviadas: number;
  /** Quantas da coorte acima estão, agora, com `status = 'accepted'`. */
  aceitas: number;
  /** `aceitas / enviadas`, `0` quando `enviadas === 0` (nunca `NaN`/`Infinity`). */
  taxa: number;
};

// ---------------------------------------------------------------------------
// 4) Propostas paradas (ver decisão 4 acima) — SEMPRE com os ids, nunca só a contagem
// ---------------------------------------------------------------------------

export type PropostaParada = {
  id: string;
  title: string;
  /** Só os dois status que podem ficar "parados" — `draft`/`accepted`/`declined`/`expired` não entram aqui. */
  status: 'sent' | 'viewed';
  dealId: string;
  contactId: string;
  contactName: string;
  /**
   * WhatsApp do contato, CRU — exatamente como a agente digitou (`(11) 98888-7777`,
   * `11988887777`, `+55 11 98888-7777`) ou `null` se ela nunca preencheu. Mesma disciplina
   * de `listarEmViagem` (`viagens.ts`): o servidor NÃO normaliza e NÃO valida. Quem monta
   * o link usa `waMeLink` no cliente; sanitizar aqui criaria uma segunda regra de formato
   * competindo com aquela, e a agente veria um número "consertado" que não é o que ela
   * digitou.
   */
  contactWhatsapp: string | null;
  destination: string | null;
  /** Valor do NEGÓCIO associado (`deals.valueCents`) — proposta não tem valor próprio, é a opção que tem preço. */
  valueCents: number;
  diasParado: number;
};

export type ResumoDePropostasParadas = {
  /** Mais parada primeiro — é a que precisa de atenção antes. */
  itens: PropostaParada[];
  totalCents: number;
};

// ---------------------------------------------------------------------------
// O resumo inteiro, uma chamada só
// ---------------------------------------------------------------------------

export type ResumoDoMes = {
  /**
   * `'AAAA-MM'` do período (UTC), pronto para rótulo/nome de arquivo. Em período do tipo
   * mês é o próprio mês; em faixa de datas é o mês da ponta inicial — para o rótulo
   * completo use `periodo.rotulo`.
   */
  mes: string;
  /** O período efetivamente consultado — pontas inclusivas em `AAAA-MM-DD`. */
  periodo: { de: string; ate: string; rotulo: string };
  vendas: ResumoVendasDoMes;
  comissao: ResumoComissaoDoMes;
  conversao: ConversaoDePropostas;
  paradas: ResumoDePropostasParadas;
};

/**
 * O núcleo — três queries sequenciais dentro da MESMA transação (`withTenant` já abre
 * uma). Sequenciais, não `Promise.all`: no volume esperado (MEI, 10-15 vendas/mês, dezenas
 * de propostas por mês) cada query é um scan pequeno dentro da partição do próprio tenant
 * (RLS já restringe a `tenant_id = current_setting(...)`) — a soma das três fica bem
 * abaixo do orçamento de 800ms do critério de aceite sem precisar de pipelining, e
 * sequencial é o padrão que todo outro arquivo de `src/server/` já usa (mais simples de
 * ler, mais fácil de depurar um EXPLAIN se um dia precisar). Reavaliar `Promise.all` só se
 * um tenant real crescer muito além desse volume.
 */
async function calcularResumoDoMes(
  tx: TenantDb,
  agora: Date,
  periodo: Periodo,
): Promise<ResumoDoMes> {
  const inicioMes = periodo.inicio;
  const inicioProximoMes = periodo.fimExclusivo;
  const mes = periodo.rotulo;

  // --- 1 e 2: vendas + comissão do mês, mesma query (mesmo WHERE, mesmas linhas) ---
  const linhasVendas = await tx
    .select({
      valorBrutoCents: sales.valorBrutoCents,
      taxaServicoCents: sales.taxaServicoCents,
      comissaoPrevistaCents: sales.comissaoPrevistaCents,
      comissaoStatus: sales.comissaoStatus,
    })
    .from(sales)
    .where(and(gte(sales.createdAt, inicioMes), lt(sales.createdAt, inicioProximoMes)));

  let faturamentoBrutoCents = 0;
  let taxaServicoCents = 0;
  let previstaCents = 0;
  let recebidaCents = 0;
  let atrasadaCents = 0;

  for (const linha of linhasVendas) {
    faturamentoBrutoCents += linha.valorBrutoCents;
    taxaServicoCents += linha.taxaServicoCents;
    if (linha.comissaoStatus === 'recebida') recebidaCents += linha.comissaoPrevistaCents;
    else if (linha.comissaoStatus === 'atrasada') atrasadaCents += linha.comissaoPrevistaCents;
    else previstaCents += linha.comissaoPrevistaCents;
  }

  const vendas: ResumoVendasDoMes = {
    totalVendas: linhasVendas.length,
    faturamentoBrutoCents,
    taxaServicoCents,
  };

  const comissao: ResumoComissaoDoMes = {
    previstaCents,
    recebidaCents,
    atrasadaCents,
    aReceberCents: previstaCents + atrasadaCents,
    totalCents: previstaCents + recebidaCents + atrasadaCents,
  };

  // --- 3: conversão — coorte por sentAt, `count(*)::int` é seguro aqui (contagem simples,
  // sem correlação com coluna de fora — não é o padrão que quebrou em deals.ts/contacts.ts).
  const linhasConversao = await tx
    .select({
      status: proposals.status,
      total: sql<number>`count(*)::int`,
    })
    .from(proposals)
    .where(
      and(
        isNotNull(proposals.sentAt),
        gte(proposals.sentAt, inicioMes),
        lt(proposals.sentAt, inicioProximoMes),
      ),
    )
    .groupBy(proposals.status);

  const enviadas = linhasConversao.reduce((soma, linha) => soma + linha.total, 0);
  const aceitas = linhasConversao.find((linha) => linha.status === 'accepted')?.total ?? 0;

  const conversao: ConversaoDePropostas = {
    enviadas,
    aceitas,
    taxa: enviadas > 0 ? aceitas / enviadas : 0,
  };

  // --- 4: paradas — sent/viewed, não arquivada, sentAt sempre preenchido nesses status
  // (proposta em draft nunca chega em 'sent'/'viewed' sem passar por enviarProposta, que
  // grava sentAt) — o `!` abaixo é seguro por causa do isNotNull no WHERE, não gambiarra.
  const linhasParadas = await tx
    .select({
      id: proposals.id,
      title: proposals.title,
      status: proposals.status,
      sentAt: proposals.sentAt,
      lastViewedAt: proposals.lastViewedAt,
      dealId: proposals.dealId,
      valueCents: deals.valueCents,
      destination: deals.destination,
      contactId: contacts.id,
      contactName: contacts.name,
      contactWhatsapp: contacts.whatsapp,
    })
    .from(proposals)
    .innerJoin(deals, eq(deals.id, proposals.dealId))
    .innerJoin(contacts, eq(contacts.id, deals.contactId))
    .where(
      and(
        inArray(proposals.status, ['sent', 'viewed']),
        isNull(proposals.archivedAt),
        isNotNull(proposals.sentAt),
      ),
    );

  const agoraMs = agora.getTime();
  const itensParadas = linhasParadas
    .map((linha) => ({
      id: linha.id,
      title: linha.title,
      status: linha.status as 'sent' | 'viewed',
      dealId: linha.dealId,
      contactId: linha.contactId,
      contactName: linha.contactName,
      contactWhatsapp: linha.contactWhatsapp,
      destination: linha.destination,
      valueCents: linha.valueCents,
      diasParado: diasDesde(maisRecente(linha.sentAt!, linha.lastViewedAt), agoraMs),
    }))
    .filter((item) => item.diasParado > DIAS_PARADA_LIMITE)
    .sort((a, b) => b.diasParado - a.diasParado);

  const paradas: ResumoDePropostasParadas = {
    itens: itensParadas,
    totalCents: itensParadas.reduce((soma, item) => soma + item.valueCents, 0),
  };

  return {
    mes,
    periodo: { de: periodo.de, ate: periodo.ate, rotulo: periodo.rotulo },
    vendas,
    comissao,
    conversao,
    paradas,
  };
}

/**
 * O resumo para os cards do dashboard. Sem argumento = mês corrente (comportamento
 * anterior, preservado); com `{ mes: '2026-09' }` ou `{ de, ate }`, a janela inteira
 * (vendas, comissão e conversão — as decisões 1–3 acima) muda junto. `paradas` continua
 * sem recorte de tempo de propósito (decisão 4 — "parado" é sobre agora).
 */
export async function obterResumoDoMes(
  periodoInput?: PeriodoInput,
): Promise<ServiceResult<ResumoDoMes>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const agora = new Date();
    const periodo = resolverPeriodo(agora, periodoInput);
    return withTenant(tenantId, (tx) => calcularResumoDoMes(tx, agora, periodo));
  });
}

// ---------------------------------------------------------------------------
// 5) Exportar CSV do resumo do mês
// ---------------------------------------------------------------------------
//
// Server Action que devolve TEXTO pronto — não uma rota HTTP. `src/app/api/**` é
// fronteira do PO (ver `docs/OWNERSHIP.md`), então não criei endpoint de download aqui.
// A Nina chama `exportarResumoDoMesCsv()`, pega `conteudo` e dispara o download no
// navegador com um `Blob`/`URL.createObjectURL` — não precisa de rota nova para isso.
// Formato calibrado para abrir direto no Excel/Sheets em pt-BR (mesma preocupação
// documentada em `src/server/csv.ts`, que é sobre LER planilha — aqui é o espelho, sobre
// ESCREVER uma): delimitador `;` (não `,`, que é separador decimal em pt-BR) e BOM UTF-8 no
// início (sem ele, o Excel do Windows abre acento errado ao dar duplo clique no arquivo).

const BOM_UTF8 = '﻿';

function escaparCampoCsv(valor: string): string {
  if (/[;"\r\n]/.test(valor)) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

function linhaCsv(campos: string[]): string {
  return campos.map(escaparCampoCsv).join(';');
}

/** `423456` → `"4.234,56"` — só para exibição no CSV; a aplicação nunca guarda dinheiro assim. */
function centavosParaReaisCsv(cents: number): string {
  const negativo = cents < 0;
  const absCents = Math.abs(Math.round(cents));
  const inteiro = Math.floor(absCents / 100);
  const centavos = String(absCents % 100).padStart(2, '0');
  const comMilhar = inteiro.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '-' : ''}${comMilhar},${centavos}`;
}

export type ResumoDoMesCsv = {
  /** `resumo-2026-09.csv` — já pronto para o atributo `download` do link/blob. */
  nomeArquivo: string;
  /** Texto completo do arquivo, com BOM e `\r\n` — grave/baixe como veio, sem reprocessar. */
  conteudo: string;
};

/**
 * O mesmo resumo de `obterResumoDoMes`, formatado como arquivo CSV para baixar —
 * aceitando o mesmo período opcional (§1). Em faixa de datas o nome do arquivo usa
 * `_a_` no lugar do `..` do rótulo (`resumo-2026-01-01_a_2026-03-31.csv`) — ponto não é
 * separador seguro em nome de arquivo em toda plataforma.
 */
export async function exportarResumoDoMesCsv(
  periodoInput?: PeriodoInput,
): Promise<ServiceResult<ResumoDoMesCsv>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const agora = new Date();
    const periodo = resolverPeriodo(agora, periodoInput);
    const resumo = await withTenant(tenantId, (tx) => calcularResumoDoMes(tx, agora, periodo));

    const rotuloArquivo = periodo.rotulo.includes('..')
      ? `${periodo.de}_a_${periodo.ate}`
      : periodo.rotulo;

    const linhas = [
      linhaCsv(['Métrica', 'Valor']),
      linhaCsv(['Período', resumo.periodo.rotulo]),
      linhaCsv(['Vendas fechadas', String(resumo.vendas.totalVendas)]),
      linhaCsv(['Faturamento bruto (R$)', centavosParaReaisCsv(resumo.vendas.faturamentoBrutoCents)]),
      linhaCsv(['Taxa de serviço cobrada (R$)', centavosParaReaisCsv(resumo.vendas.taxaServicoCents)]),
      linhaCsv(['Comissão prevista (R$)', centavosParaReaisCsv(resumo.comissao.previstaCents)]),
      linhaCsv(['Comissão recebida (R$)', centavosParaReaisCsv(resumo.comissao.recebidaCents)]),
      linhaCsv(['Comissão atrasada (R$)', centavosParaReaisCsv(resumo.comissao.atrasadaCents)]),
      linhaCsv(['Comissão a receber — prevista + atrasada (R$)', centavosParaReaisCsv(resumo.comissao.aReceberCents)]),
      linhaCsv(['Propostas enviadas no mês', String(resumo.conversao.enviadas)]),
      linhaCsv(['Propostas aceitas (da coorte enviada no mês)', String(resumo.conversao.aceitas)]),
      linhaCsv(['Taxa de conversão', `${(resumo.conversao.taxa * 100).toFixed(1)}%`]),
      linhaCsv([
        `Propostas paradas (mais de ${DIAS_PARADA_LIMITE} dias sem resposta)`,
        String(resumo.paradas.itens.length),
      ]),
      linhaCsv(['Valor em propostas paradas (R$)', centavosParaReaisCsv(resumo.paradas.totalCents)]),
    ];

    return {
      nomeArquivo: `resumo-${rotuloArquivo}.csv`,
      conteudo: BOM_UTF8 + linhas.join('\r\n') + '\r\n',
    };
  });
}
