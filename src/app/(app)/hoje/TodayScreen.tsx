"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  concluirTarefa,
  criarNegocioDoLead,
  leadsRecentesDaVitrine,
  criarTarefa,
  exportarResumoDoMesCsv,
  listarAberturasRecentes,
  listarContatos,
  listarEmViagem,
  listarNegocios,
  listarProximasTarefas,
  listarTarefasDeHoje,
  obterResumoDoMes,
  obterResumoDoPipeline,
  type AberturaProposta,
  type ContatoResumo,
  type EmViagemGrupos,
  type LeadRecenteDaVitrine,
  type PropostaParada,
  type ResumoDoMes,
  type ResumoDoPipeline,
  type TarefaDeHoje,
  type ViagemEmCurso,
} from "@/server";
import { avisarRecusaDeEscrita } from "@/lib/ui/assinatura";
import { cn } from "@/lib/ui/cn";
import { useTransitionPreset } from "@/lib/ui/motion";
import { useDeferredDelete } from "@/lib/ui/useDeferredDelete";
import {
  formatarFaixaDeDatas,
  formatDayMonth,
  formatRelativeShort,
  formatTime,
} from "@/lib/ui/format";
import { formatarRotuloPeriodo, parseParamPeriodo } from "@/lib/ui/periodo";
import { mensagemCobranca, mensagemDepoimento, waMeLink } from "@/lib/ui/whatsapp";
import { useSession } from "@/lib/auth/client";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, SectionHeading } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { Combobox } from "@/components/ui/Combobox";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldError, FieldHint, Label } from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/Input";
import { Money } from "@/components/ui/Money";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { Skeleton, SkeletonRow } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { NovoNegocioSheet } from "@/components/app/NovoNegocioSheet";
import {
  PeriodoInvalidoCard,
  PeriodoSeletor,
} from "@/components/app/PeriodoSeletor";
import {
  CakeIcon,
  ChatIcon,
  ChevronRightIcon,
  ClockIcon,
  CopyIcon,
  DownloadIcon,
  OpenedIcon,
  PassportIcon,
  PlusIcon,
  TodayIcon,
} from "@/components/app/icons";

/* =============================================================================
   Hoje
   -----------------------------------------------------------------------------
   A tela que abre. Responde cinco perguntas, nessa ordem (PO, 2026-09: o
   resumo do mês é a informação mais importante e abre a tela; o que exige
   ação vem depois, na ordem em que a oportunidade apodrece; contexto fecha):

     1. como está o mês (vendas, comissão, conversão — e o botão de exportar)
     2. o que eu preciso fazer hoje (tarefas vencendo hoje)
     3. quem mexeu na minha proposta (abriu o link) — é o sinal de compra
     4. o que está morrendo parado (propostas sem resposta há mais de 7 dias)
     5. quem está em viagem (presença) e o que vem a seguir (contexto)

   E, para a conta recém-criada (zero negócios), uma quinta antes de todas:
   por onde começa. O painel "Sua primeira proposta sai daqui" é o único CTA
   da tela nesse estado — a ordem cliente → negócio → proposta → WhatsApp é o
   elo que nenhum vazio isolado ensinava (docs/REGRAS_DE_NEGOCIO.md §5, o
   bater-o-molde).

   Desenhada para 390px primeiro. No desktop ela vira duas colunas, mas o
   conteúdo e a ordem são os mesmos: quem trabalha no celular não recebe uma
   versão pior.

   Cada seção é dado real: "Tarefas de hoje" e "Abriram sua proposta" desde o
   S8 (`listarTarefasDeHoje` / `listarAberturasRecentes`); os dois números do
   topo desde o S4 (`obterResumoDoPipeline`, `src/server/deals.ts`); "Propostas
   paradas" e "Este mês" desde o S10 (`obterResumoDoMes` /
   `exportarResumoDoMesCsv`, `src/server/dashboard.ts`). Nenhuma tela importa
   de `src/lib/ui/sample-data.ts`.

   A seção "Propostas paradas" substituiu "Paradas há mais de 7 dias" (S4,
   `listarNegociosParados`, dado de NEGÓCIOS) — mesma urgência (parado há mais
   de 7 dias), mas a PROPOSTA é a que tem o link e o valor, e é a que o
   follow-up atinge. Ver a decisão completa em docs/status/nina.md (S10).
   ========================================================================== */

type Status = "loading" | "ready" | "error";

export function TodayScreen({ periodoParam }: { periodoParam?: string }) {
  const router = useRouter();
  const toast = useToast();
  const transition = useTransitionPreset();

  // O recorte de leitura mora na URL (`?periodo=...`) — link compartilhável,
  // Voltar restaura. A página (server) lê o searchParams e passa para cá; o
  // parâmetro cru é a chave dos efeitos: trocou a URL, os dados do período
  // recarregam. Param inválido mostra o aviso com correção e lê o mês
  // corrente por baixo — o rótulo devolvido pelo backend diz qual é.
  const periodo = React.useMemo(() => parseParamPeriodo(periodoParam), [periodoParam]);
  const periodoInput = periodo.ok ? periodo.input : undefined;
  const periodoKey = periodoParam ?? "";
  const periodoAtivo = periodoInput !== undefined;

  // O nome vem da sessão — nunca de uma constante. Uma agente que acabou de
  // criar a conta e lê o nome de outra pessoa na primeira tela desconfia do
  // produto inteiro (e "Camila" era exatamente isso: resto de dado de exemplo).
  const { data: session } = useSession();
  const nomeAgente = session?.user?.name?.trim().split(/\s+/)[0] ?? null;

  const [tasksStatus, setTasksStatus] = React.useState<Status>("loading");
  const [tasks, setTasks] = React.useState<TarefaDeHoje[]>([]);
  const [tasksError, setTasksError] = React.useState<{
    mensagem: string;
    correcao?: string;
  } | null>(null);
  const [tasksReload, setTasksReload] = React.useState(0);
  const retryTasks = React.useCallback(
    () => setTasksReload((n) => n + 1),
    [],
  );

  // "Criar lembrete" — botão morto até aqui (sem `onClick`, sem função de
  // servidor). Ver docs/status/nina.md: `criarTarefa` (S9/S10) liga os dois.
  const [reminderSheetOpen, setReminderSheetOpen] = React.useState(false);

  // Meta Vitrine (Fit 7b) — "como o agente vai saber": leads da página pública
  // aparecem NO QUADRO que ele abre todo dia, não escondidos na /vitrine.
  const [leadsStatus, setLeadsStatus] = React.useState<Status>("ready");
  const [leads, setLeads] = React.useState<{ total: number; recentes: LeadRecenteDaVitrine[] }>({
    total: 0,
    recentes: [],
  });

  React.useEffect(() => {
    let active = true;
    void leadsRecentesDaVitrine({ dias: 7 }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setLeadsStatus("error");
        return;
      }
      setLeads(result.data);
      setLeadsStatus("ready");
    });
    return () => {
      active = false;
    };
  }, []);

  // Conta recém-criada — zero negócios. Uma sondagem `limite: 1` é o custo
  // todo: o que a tela precisa saber é só SE existe algum negócio (a ordem
  // cliente → negócio → proposta é o que a agente nova não tem como adivinhar;
  // ver docs/REGRAS_DE_NEGOCIO.md §5, o bater-o-molde). Enquanto contaNova,
  // o painel de primeira venda é o único CTA da tela — "Criar lembrete" some
  // (não há o que lembrar antes de existir a primeira viagem em negociação)
  // e volta sozinho no primeiro negócio criado.
  const [negociosStatus, setNegociosStatus] = React.useState<Status>("loading");
  const [totalNegocios, setTotalNegocios] = React.useState(0);
  const [negociosReload, setNegociosReload] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    void listarNegocios({ limite: 1 }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setNegociosStatus("error");
        return;
      }
      setTotalNegocios(result.data.length);
      setNegociosStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [negociosReload]);

  const contaNova = negociosStatus === "ready" && totalNegocios === 0;
  const [negocioSheetOpen, setNegocioSheetOpen] = React.useState(false);

  const [openedStatus, setOpenedStatus] = React.useState<Status>("loading");
  const [opened, setOpened] = React.useState<AberturaProposta[]>([]);
  const [openedError, setOpenedError] = React.useState<{
    mensagem: string;
    correcao?: string;
  } | null>(null);
  const [openedReload, setOpenedReload] = React.useState(0);
  const retryOpened = React.useCallback(
    () => setOpenedReload((n) => n + 1),
    [],
  );

  // "A seguir" — os lembretes futuros. Falha silenciosa de propósito: a seção é
  // complemento, não estrutura — sem ela a tela segue inteira, com as de hoje.
  const [proximas, setProximas] = React.useState<TarefaDeHoje[]>([]);

  React.useEffect(() => {
    let active = true;
    setTasksStatus((current) => (current === "ready" ? current : "loading"));
    void listarTarefasDeHoje().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setTasksStatus("error");
        setTasksError({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setTasks(result.data);
      setTasksStatus("ready");
    });
    void listarProximasTarefas().then((result) => {
      if (!active) return;
      if (result.ok) setProximas(result.data);
    });
    return () => {
      active = false;
    };
  }, [tasksReload]);

  React.useEffect(() => {
    let active = true;
    setOpenedStatus((current) => (current === "ready" ? current : "loading"));
    void listarAberturasRecentes().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setOpenedStatus("error");
        setOpenedError({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setOpened(result.data);
      setOpenedStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [openedReload]);

  const [pipelineStatus, setPipelineStatus] = React.useState<Status>("loading");
  const [pipeline, setPipeline] = React.useState<ResumoDoPipeline | null>(null);
  const [pipelineError, setPipelineError] = React.useState<{
    mensagem: string;
    correcao?: string;
  } | null>(null);
  const [pipelineReload, setPipelineReload] = React.useState(0);
  const retryPipeline = React.useCallback(
    () => setPipelineReload((n) => n + 1),
    [],
  );

  React.useEffect(() => {
    let active = true;
    setPipelineStatus((current) => (current === "ready" ? current : "loading"));
    void obterResumoDoPipeline(periodoInput).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setPipelineStatus("error");
        setPipelineError({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setPipeline(result.data);
      setPipelineStatus("ready");
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `periodoInput` é derivado de `periodoKey`
  }, [periodoKey, pipelineReload]);

  // O mês — uma chamada só (`obterResumoDoMes`) alimenta duas seções: a lista
  // inline de "Propostas paradas" (`month.paradas.itens`) e os 4 cards de
  // "Este mês" (vendas/comissão/conversão/paradas). Se a chamada falha, as duas
  // falham juntas (mesmo erro, mesmo botão de tentar de novo) — é uma só fonte.
  const [monthStatus, setMonthStatus] = React.useState<Status>("loading");
  const [month, setMonth] = React.useState<ResumoDoMes | null>(null);
  const [monthError, setMonthError] = React.useState<{
    mensagem: string;
    correcao?: string;
  } | null>(null);
  const [monthReload, setMonthReload] = React.useState(0);
  const retryMonth = React.useCallback(
    () => setMonthReload((n) => n + 1),
    [],
  );

  React.useEffect(() => {
    let active = true;
    setMonthStatus((current) => (current === "ready" ? current : "loading"));
    void obterResumoDoMes(periodoInput).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setMonthStatus("error");
        setMonthError({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setMonth(result.data);
      setMonthStatus("ready");
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `periodoInput` é derivado de `periodoKey`
  }, [periodoKey, monthReload]);

  // Exportar CSV — blob no cliente, sem rota de servidor. O `conteudo` já vem
  // com BOM UTF-8 e `;` como delimitador (Excel pt-BR abre direto); só montar o
  // Blob, disparar o download e revoke. Erro vira toast com a correção do
  // servidor no botão (re-tentar), não modal "tem certeza?".
  const [exporting, setExporting] = React.useState(false);

  async function handleExport() {
    setExporting(true);
    const result = await exportarResumoDoMesCsv(periodoInput);
    setExporting(false);
    if (!result.ok) {
      toast.show({
        title: "Não consegui exportar",
        description: result.mensagem,
        tone: "danger",
        action: result.correcao
          ? { label: result.correcao, onClick: () => void handleExport() }
          : undefined,
      });
      return;
    }
    const blob = new Blob([result.data.conteudo], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.data.nomeArquivo;
    a.click();
    URL.revokeObjectURL(url);
    toast.show({
      title: "Resumo exportado",
      description: result.data.nomeArquivo,
      tone: "ok",
    });
  }

  // `concluirTarefa` não tem par de reabertura no servidor — a tarefa some da
  // tela na hora (parece instantâneo) e só é marcada concluída de verdade se
  // os 8s do toast passarem sem ninguém tocar em "Desfazer". Mesmo desenho de
  // `useDeferredDelete` (arquivamento de cliente), reaproveitado aqui porque
  // "concluir" também é, no fim, uma remoção sem volta garantida no servidor.
  const scheduleConclude = useDeferredDelete<TarefaDeHoje>({
    label: (task) => `Concluída: ${task.title}`,
    commit: (task) => concluirTarefa(task.id),
    onFailure: (task, mensagem) => {
      // a chamada tardia falhou (ex.: tarefa já concluída por outra aba) —
      // devolve a tarefa para a lista em vez de fingir que deu certo.
      setTasks((current) =>
        current.some((item) => item.id === task.id)
          ? current
          : [...current, task].sort(
              (a, b) => a.dueAt.valueOf() - b.dueAt.valueOf(),
            ),
      );
      toast.show({
        title: "Não consegui concluir",
        description: mensagem,
        tone: "danger",
      });
    },
  });

  function concludeTask(task: TarefaDeHoje) {
    setTasks((current) => current.filter((item) => item.id !== task.id));
    scheduleConclude(task);
  }

  async function copyMessage(task: TarefaDeHoje) {
    if (!task.suggestedMessage) return;
    try {
      await navigator.clipboard.writeText(task.suggestedMessage);
      toast.show({ title: "Mensagem copiada", tone: "ok" });
    } catch {
      toast.show({
        title: "Não consegui copiar",
        description: "Selecione e copie o texto manualmente.",
        tone: "danger",
      });
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Greeting
        nome={nomeAgente}
        pipeline={pipeline}
        status={pipelineStatus}
        error={pipelineError}
        onRetry={retryPipeline}
        periodoAtivo={periodoAtivo}
      />

      {/* O recorte de leitura — §1. Um seletor por tela, no topo; o rótulo do
          que está sendo visto mora na seção de números (abaixo), que lê
          `periodo.rotulo` da resposta do backend. */}
      {periodo.ok ? (
        <PeriodoSeletor param={periodoParam} className="-mt-4" />
      ) : (
        <PeriodoInvalidoCard className="-mt-4" />
      )}

      {/* A primeira hora — o único elo que faltava guiar. Conta nova, a tela
          abre com UM caminho (cliente → negócio → proposta → WhatsApp) e o
          CTA do primeiro passo real; as seções abaixo continuam ali, mas sem
          concorrer por ação (regra do EmptyState: uma ação — duas viram
          indecisão). A criação do negócio acontece na NovoNegocioSheet, a
          mesma do funil e da ficha do contato. */}
      {contaNova ? (
        <EmptyState
          plate
          title="Sua primeira proposta sai daqui"
          description="O caminho é curto: um cliente, um negócio — a viagem que ele quer fazer —, a proposta com suas opções e o link no WhatsApp dele. Todo negócio nasce de um cliente já cadastrado."
          preview={<NegocioPreview />}
          action={
            <Button
              variant="primary"
              onPointerDown={() => setNegocioSheetOpen(true)}
            >
              <PlusIcon className="size-4" />
              Criar primeiro negócio
            </Button>
          }
          secondaryAction={
            <Link
              href="/clientes"
              className="text-13 font-medium text-muted hover:text-ink hover:underline hover:underline-offset-4"
            >
              Cadastrar cliente
            </Link>
          }
        />
      ) : null}

      {/* Resumo do mês — a informação mais importante da tela (PO, 2026-09):
          "como está o meu mês" é a pergunta que abre o app, antes de qualquer
          fila de ação. Mesma fonte de antes (`obterResumoDoMes`, uma chamada só
          que também alimenta "Propostas paradas" lá embaixo). */}
      <section aria-labelledby="hoje-mes">
        <SectionHeading
          action={
            <div className="flex items-center gap-3">
              {/* O rótulo do recorte vem do BACKEND (`periodo.rotulo`) — a tela
                  nunca duvida de qual janela está vendo, e o rótulo da tela
                  acompanha o seletor sem uma segunda fonte de verdade. */}
              {monthStatus === "ready" && month ? (
                <span data-numeric className="text-13 tabular-nums text-muted">
                  {formatarRotuloPeriodo(month.periodo)}
                </span>
              ) : null}
              <Button
                variant="quiet"
                size="sm"
                loading={exporting}
                disabled={monthStatus !== "ready"}
                onPointerDown={() => void handleExport()}
              >
                <DownloadIcon className="size-3.5" />
                Exportar
              </Button>
            </div>
          }
        >
          <span id="hoje-mes">{periodoAtivo ? "No período" : "Este mês"}</span>
        </SectionHeading>

        {monthStatus === "loading" ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[6.5rem] rounded-lg" />
            ))}
          </div>
        ) : monthStatus === "error" ? (
          <Card className="flex flex-col items-start gap-3 p-4">
            <FieldError>{monthError?.mensagem}</FieldError>
            <Button variant="secondary" size="sm" onClick={retryMonth}>
              {monthError?.correcao ?? "Tentar de novo"}
            </Button>
          </Card>
        ) : !month ? null : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MonthCard href="/vendas" ariaLabel="Ver vendas do mês">
              <p className="text-13 font-medium text-muted">Vendas</p>
              <Money
                cents={month.vendas.faturamentoBrutoCents}
                size="20"
                align="left"
                reserveFor={10_000_000}
                className="mt-1"
              />
              <p className="mt-1 text-13 text-muted">
                <span className="tabular-nums">
                  {month.vendas.totalVendas}
                </span>{" "}
                {month.vendas.totalVendas === 1 ? "venda" : "vendas"}
              </p>
            </MonthCard>

            <MonthCard href="/financeiro" ariaLabel="Ver comissão do mês">
              <p className="text-13 font-medium text-muted">Comissão</p>
              <Money
                cents={month.comissao.aReceberCents}
                size="20"
                align="left"
                reserveFor={2_000_000}
                className="mt-1"
              />
              <p className="mt-1 text-13 text-muted">
                <Money
                  cents={month.comissao.recebidaCents}
                  size="13"
                  tone="muted"
                  align="left"
                  reserveFor={2_000_000}
                />{" "}
                recebida
              </p>
            </MonthCard>

            <MonthCard href="/propostas" ariaLabel="Ver propostas do mês">
              <p className="text-13 font-medium text-muted">Conversão</p>
              {month.conversao.enviadas === 0 ? (
                <p className="mt-1 text-20 tabular-nums text-ink">—</p>
              ) : (
                <p className="mt-1 text-20 tabular-nums text-ink">
                  {(month.conversao.taxa * 100)
                    .toFixed(1)
                    .replace(".", ",")}
                  %
                </p>
              )}
              <p className="mt-1 text-13 text-muted">
                <span className="tabular-nums">
                  {month.conversao.enviadas}
                </span>{" "}
                enviadas ·{" "}
                <span className="tabular-nums">
                  {month.conversao.aceitas}
                </span>{" "}
                aceitas
              </p>
            </MonthCard>

            <MonthCard
              href={
                month.paradas.itens.length > 0
                  ? `/propostas?ids=${month.paradas.itens.map((p) => p.id).join(",")}`
                  : "/propostas"
              }
              ariaLabel="Ver propostas paradas"
            >
              <p className="text-13 font-medium text-muted">
                Propostas paradas
              </p>
              <p className="mt-1 text-20 tabular-nums text-ink">
                {month.paradas.itens.length}
              </p>
              <p className="mt-1 text-13 text-muted">
                <Money
                  cents={month.paradas.totalCents}
                  size="13"
                  tone="muted"
                  align="left"
                  reserveFor={5_000_000}
                />{" "}
                em aberto
              </p>
            </MonthCard>
          </div>
        )}
      </section>

      {/* Meta Vitrine (Fit 7b) — o lead capturado pela página pública aparece
          NO QUADRO DE TODO DIA. Só nasce quando EXISTE lead nos últimos 7
          dias: quadro vazio não anuncia ausência (a mesma regra das seções
          acima). O nome é o único clique (WhatsApp); "Ver vitrine" leva à
          ficha da oferta. */}
      {leadsStatus === "ready" && leads.total > 0 ? (
        <section aria-labelledby="hoje-vitrine">
          <SectionHeading
            action={
              <Link
                href="/vitrine"
                className="flex items-center gap-1 text-13 font-medium text-muted hover:text-ink"
              >
                Ver vitrine
                <ChevronRightIcon className="size-3.5 -scale-x-100" />
              </Link>
            }
          >
            <span id="hoje-vitrine">Sua vitrine gerou interesse</span>
          </SectionHeading>
          <Card>
            <CardBody flush>
              <ul className="flex flex-col divide-y divide-line-subtle">
                {leads.recentes.map((lead) => (
                  <li key={`${lead.offerId}-${lead.contactId}`} className="flex items-center gap-3 px-4 py-3">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-15 text-ink">
                        <span className="font-medium">{lead.contactName}</span> se interessou por{" "}
                        <span className="text-muted">{lead.ofertaTitulo}</span>
                      </span>
                      <span className="text-13 text-subtle">
                        {formatDayMonth(lead.createdAt)} · via página pública
                      </span>
                    </span>
                    {/* Fit 7c — o lead entra no FUNIL com um toque. Depois de
                        criado, vira link para o negócio. */}
                    {lead.dealId ? (
                      <Link
                        href={`/funil/${lead.dealId}`}
                        className="shrink-0 text-13 font-medium text-accent underline underline-offset-2"
                      >
                        No funil
                      </Link>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          void criarNegocioDoLead({ leadId: lead.leadId }).then((result) => {
                            if (result.ok) {
                              setLeads((atual) => ({
                                ...atual,
                                recentes: atual.recentes.map((l) =>
                                  l.leadId === lead.leadId ? { ...l, dealId: result.data.dealId } : l,
                                ),
                              }));
                            }
                          })
                        }
                      >
                        Criar negócio
                      </Button>
                    )}
                    {lead.whatsapp ? (
                      <a
                        href={`https://wa.me/${lead.whatsapp}`}
                        target="_blank"
                        rel="noopener"
                        className="shrink-0 text-13 font-medium text-accent underline underline-offset-2"
                      >
                        WhatsApp
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </section>
      ) : null}

      <section aria-labelledby="hoje-tarefas" data-tour="hoje-tarefas">
        <SectionHeading
          action={
            <div className="flex items-center gap-1">
              {tasksStatus === "ready" ? (
                <span className="text-13 tabular-nums text-muted" data-numeric>
                  {tasks.length} {tasks.length === 1 ? "pendente" : "pendentes"}
                </span>
              ) : null}
              {/* Conta nova: sem botão — o lembrete não é o primeiro passo e
                  o painel acima já carrega o único CTA da tela. */}
              {contaNova ? null : (
                <Button
                  variant="quiet"
                  size="sm"
                  iconOnly
                  aria-label="Criar lembrete"
                  className="-my-1"
                  onPointerDown={() => setReminderSheetOpen(true)}
                >
                  <PlusIcon className="size-3.5" />
                </Button>
              )}
            </div>
          }
        >
          <span id="hoje-tarefas">Tarefas de hoje</span>
        </SectionHeading>

        {tasksStatus === "loading" ? (
          <Card className="flex flex-col gap-4 p-4">
            {[0, 1, 2].map((row) => (
              <SkeletonRow key={row} />
            ))}
          </Card>
        ) : tasksStatus === "error" ? (
          <Card className="flex flex-col items-start gap-3 p-4">
            <FieldError>{tasksError?.mensagem}</FieldError>
            <Button variant="secondary" size="sm" onClick={retryTasks}>
              {tasksError?.correcao ?? "Tentar de novo"}
            </Button>
          </Card>
        ) : tasks.length === 0 ? (
          <EmptyState
            title="Nada marcado para hoje"
            description="Toda proposta enviada vira um lembrete de follow-up automático — passaporte perto de vencer e aniversário de cliente também aparecem aqui sozinhos."
            action={
              contaNova ? undefined : (
                <Button
                  variant="primary"
                  onPointerDown={() => setReminderSheetOpen(true)}
                >
                  <PlusIcon className="size-4" />
                  Criar lembrete
                </Button>
              )
            }
          />
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line-subtle">
              <AnimatePresence initial={false}>
                {tasks.map((task) => (
                  <motion.li
                    key={task.id}
                    layout
                    transition={transition}
                    initial={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col gap-2 px-4 py-3"
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        className="mt-0.5"
                        checked={false}
                        onCheckedChange={(checked) => {
                          if (checked === true) concludeTask(task);
                        }}
                        aria-label={`Concluir: ${task.title}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-15 font-medium text-ink">
                          <TaskSourceIcon
                            source={task.source}
                            className="size-3.5 shrink-0 text-muted"
                          />
                          <span className="min-w-0 truncate">{task.title}</span>
                        </p>
                        {taskDetail(task) ? (
                          <p className="mt-0.5 truncate text-13 text-muted">
                            {taskDetail(task)}
                          </p>
                        ) : null}
                      </div>
                      <span
                        data-numeric
                        className={cn(
                          "shrink-0 pt-0.5 text-13 tabular-nums",
                          task.vencida ? "text-danger" : "text-muted",
                        )}
                      >
                        {task.vencida
                          ? formatRelativeShort(new Date(task.dueAt))
                          : formatTime(new Date(task.dueAt))}
                      </span>
                    </div>

                    {task.suggestedMessage ? (
                      <div className="ml-8">
                        <Button
                          size="sm"
                          variant="quiet"
                          onClick={() => copyMessage(task)}
                        >
                          <CopyIcon className="size-3.5" />
                          Copiar mensagem
                        </Button>
                      </div>
                    ) : null}
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </Card>
        )}
      </section>

      <section aria-labelledby="hoje-abriram">
        <SectionHeading>
          <span id="hoje-abriram">Abriram sua proposta</span>
        </SectionHeading>

        {openedStatus === "loading" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-[6.5rem] rounded-lg" />
            <Skeleton className="h-[6.5rem] rounded-lg" />
          </div>
        ) : openedStatus === "error" ? (
          <Card className="flex flex-col items-start gap-3 p-4">
            <FieldError>{openedError?.mensagem}</FieldError>
            <Button variant="secondary" size="sm" onClick={retryOpened}>
              {openedError?.correcao ?? "Tentar de novo"}
            </Button>
          </Card>
        ) : opened.length === 0 ? (
          <EmptyState
            title="Ninguém abriu ainda"
            description="Assim que o cliente tocar no link, ele aparece aqui — com quantas vezes abriu e quando."
            preview={<OpenedPreview />}
            /* Este botão existia sem `onClick` — porta que não abre (regra
               §5 do negócio: elo sem porta visível é funcionalidade que não
               existe). O envio mora no editor: a lista é o caminho. Conta
               nova, sem ação — o painel de primeira venda manda. */
            action={
              contaNova ? undefined : (
                <Button variant="primary" asChild>
                  <Link href="/propostas">Enviar uma proposta</Link>
                </Button>
              )
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {opened.map((abertura) => (
              /* O card INTEIRO é o link para a proposta exata que foi aberta
                 (`abertura.proposalId` → editor, mesmo destino da lista de
                 propostas). Antes era `<Card interactive>` sem `href` nenhum:
                 feedback visual de clicável, porta nenhuma atrás — o achado do
                 PO ("o card precisa LEVAR para a proposta que a pessoa
                 clicou"). `<a>` de verdade, não `role="link"`: abre em nova
                 aba, middle-click e o anel de foco global de graça. */
              <Link
                key={abertura.proposalId}
                href={`/propostas/${abertura.proposalId}/editar`}
                aria-label={`Abrir a proposta de ${abertura.contactName}`}
                className="rounded-lg outline-none"
              >
                <Card interactive className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-15 font-semibold text-ink">
                        {abertura.contactName}
                      </p>
                      <p className="mt-0.5 truncate text-13 text-muted">
                        {abertura.destination ?? abertura.proposalTitle}
                      </p>
                    </div>
                    <Badge tone="accent" dot>
                      {abertura.openCount}
                      {abertura.openCount === 1 ? " abertura" : " aberturas"}
                    </Badge>
                  </div>

                  <div className="mt-3 flex items-center gap-1.5 text-13 text-muted">
                    <OpenedIcon className="size-3.5" />
                    {formatRelativeShort(new Date(abertura.firstViewedAt))}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="hoje-paradas">
        <SectionHeading
          action={
            monthStatus === "ready" && month ? (
              <span className="flex items-baseline gap-1 text-13 text-muted">
                <Money
                  cents={month.paradas.totalCents}
                  size="13"
                  tone="muted"
                  reserveFor={5_000_000}
                />
                parados
              </span>
            ) : null
          }
        >
          <span id="hoje-paradas">Propostas paradas</span>
        </SectionHeading>

        {monthStatus === "loading" ? (
          <Card className="flex flex-col gap-4 p-4">
            {[0, 1].map((row) => (
              <SkeletonRow key={row} />
            ))}
          </Card>
        ) : monthStatus === "error" ? (
          <Card className="flex flex-col items-start gap-3 p-4">
            <FieldError>{monthError?.mensagem}</FieldError>
            <Button variant="secondary" size="sm" onClick={retryMonth}>
              {monthError?.correcao ?? "Tentar de novo"}
            </Button>
          </Card>
        ) : !month || month.paradas.itens.length === 0 ? (
          <EmptyState
            compact
            title="Nenhuma proposta parada"
            description="Toda proposta enviada há mais de 7 dias sem resposta do cliente aparece aqui, com o botão de cobrar junto."
          />
        ) : (
          <Card tone="warn" className="overflow-hidden">
            <ul className="divide-y divide-warn/20">
              {month.paradas.itens.map((item) => (
                <ParkedProposalRow
                  key={item.id}
                  item={item}
                  // Teto da lista: sem ele, cada linha reservava a própria
                  // largura e o "Cobrar" escorregava de linha para linha.
                  reserveFor={Math.max(1, ...month.paradas.itens.map((i) => i.valueCents))}
                />
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* Em viagem — §3. O pós-venda que sustenta a recompra: a última chamada
          antes de embarcar, a viagem em curso (presença, com a ficha do
          negócio a um toque) e quem já voltou — o único botão é pedir
          depoimento. */}
      <EmViagemSection />

      {/* Lembretes futuros — o lembrete criado para amanhã tem onde aparecer;
          sem isto o app parecia engolir o que acabou de ser criado (achado do
          PO). Sem estado vazio: ausência é silêncio, a seção só existe quando
          há o que mostrar. Contexto, não ação — por isso fecha a tela. */}
      {proximas.length > 0 ? (
        <section aria-labelledby="hoje-a-seguir">
          <SectionHeading>
            <span id="hoje-a-seguir">A seguir</span>
          </SectionHeading>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line-subtle">
              {proximas.map((task) => (
                <li key={task.id} className="flex items-start gap-3 px-4 py-3">
                  <TaskSourceIcon
                    source={task.source}
                    className="mt-1 size-3.5 shrink-0 text-muted"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-15 text-ink">{task.title}</p>
                    {taskDetail(task) ? (
                      <p className="mt-0.5 truncate text-13 text-muted">
                        {taskDetail(task)}
                      </p>
                    ) : null}
                  </div>
                  <span
                    data-numeric
                    className="shrink-0 pt-0.5 text-13 tabular-nums text-muted"
                  >
                    {formatDayMonth(new Date(task.dueAt))} · {formatTime(new Date(task.dueAt))}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      <NovoLembreteSheet
        open={reminderSheetOpen}
        onOpenChange={setReminderSheetOpen}
        onCreated={(task) => {
          // Vence até o fim de hoje local → entra na lista de agora; depois de
          // hoje → a recarga traz a seção "A seguir" com o recém-criado.
          const fimDeHoje = new Date();
          fimDeHoje.setHours(23, 59, 59, 999);
          if (new Date(task.dueAt).valueOf() <= fimDeHoje.valueOf()) {
            setTasks((current) =>
              [...current, task].sort(
                (a, b) => new Date(a.dueAt).valueOf() - new Date(b.dueAt).valueOf(),
              ),
            );
          } else {
            retryTasks();
          }
        }}
      />

      {/* Primeira hora: o CTA do painel de conta nova abre a MESMA Sheet do
          funil e da ficha do contato — três entradas, um desenho. Criado o
          primeiro negócio, a sonda re-roda: o painel sai, os números do topo
          atualizam e a tela "cresce" com a agente. */}
      <NovoNegocioSheet
        open={negocioSheetOpen}
        onOpenChange={setNegocioSheetOpen}
        onCreated={() => {
          setNegocioSheetOpen(false);
          setNegociosReload((n) => n + 1);
          retryPipeline();
        }}
      />
    </div>
  );
}

/** Segunda linha do item: a anotação manual, ou — quando não há uma — o
 * contato e o destino que já vieram no JOIN, então nunca fica em branco à
 * toa quando a tarefa nasceu de um alerta em vez de texto digitado. */
function taskDetail(task: TarefaDeHoje): string | null {
  if (task.notes) return task.notes;
  const parts = [task.contactName, task.destination].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Um glifo por origem da tarefa — a mesma distinção que `source` já carrega,
 * só que legível num relance, sem precisar de um segundo rótulo de texto. */
function TaskSourceIcon({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  switch (source) {
    case "alerta_passaporte":
      return <PassportIcon className={className} />;
    case "alerta_aniversario":
      return <CakeIcon className={className} />;
    case "followup_proposta":
      return <ChatIcon className={className} />;
    default:
      return <ClockIcon className={className} />;
  }
}

function Greeting({
  nome,
  pipeline,
  status,
  error,
  onRetry,
  periodoAtivo,
}: {
  /** Primeiro nome da sessão. Sem sessão legível, sem nome — nunca um nome
   * inventado no lugar (era o "Camila" hardcoded). */
  nome: string | null;
  pipeline: ResumoDoPipeline | null;
  status: Status;
  error: { mensagem: string; correcao?: string } | null;
  onRetry: () => void;
  /** Um período explícito está na URL — "fechado no mês" vira "fechado no
   * período", porque o número passou a seguir o recorte escolhido. */
  periodoAtivo: boolean;
}) {
  const now = new Date();
  const hour = now.getHours();
  const salute =
    hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  return (
    <header className="flex flex-col gap-4">
      <div>
        <p className="text-13 text-muted">
          {salute}
          {nome ? `, ${nome}` : ""} · {now.getDate()} de{" "}
          {
            [
              "janeiro",
              "fevereiro",
              "março",
              "abril",
              "maio",
              "junho",
              "julho",
              "agosto",
              "setembro",
              "outubro",
              "novembro",
              "dezembro",
            ][now.getMonth()]
          }
        </p>
        <h2 className="display mt-1 text-32 text-ink">Hoje</h2>
      </div>

      {/* Dois números, não seis. Painel com muita métrica não informa, decora. */}
      <div className="grid grid-cols-2 gap-3">
        <PipelineStat
          label="Em negociação"
          cents={pipeline?.pipelineAbertoCents ?? null}
          status={status}
          error={error}
          onRetry={onRetry}
        />
        <PipelineStat
          label={periodoAtivo ? "Fechado no período" : "Fechado no mês"}
          cents={pipeline?.fechadoNoMesCents ?? null}
          tone="ok"
          status={status}
          error={error}
          onRetry={onRetry}
        />
      </div>
    </header>
  );
}

/**
 * Um dos "dois números do topo". Erro aqui não vira uma tela de erro à
 * parte — o valor deste cartão especificamente é substituído pela mensagem +
 * o botão de correção, sem derrubar o resto do Hoje (tarefas e aberturas têm
 * seu próprio ciclo de carregamento, independente deste).
 */
function PipelineStat({
  label,
  cents,
  tone = "default",
  status,
  error,
  onRetry,
}: {
  label: string;
  cents: number | null;
  tone?: "default" | "ok";
  status: Status;
  error: { mensagem: string; correcao?: string } | null;
  onRetry: () => void;
}) {
  return (
    <Card className="p-4">
      <p className="text-13 font-medium text-muted">{label}</p>
      {status === "error" ? (
        <div className="mt-1 flex flex-col items-start gap-1.5">
          <p className="text-13 text-danger">{error?.mensagem}</p>
          <Button variant="quiet" size="sm" onClick={onRetry} className="-ml-2.5">
            {error?.correcao ?? "Tentar de novo"}
          </Button>
        </div>
      ) : (
        <Money
          cents={status === "ready" ? cents : null}
          size="20"
          tone={tone}
          reserveFor={30_000_000}
          className="mt-1"
        />
      )}
    </Card>
  );
}

/**
 * Amostra de um negócio no estado vazio de conta nova — o MESMO exemplo que o
 * funil e a lista de propostas mostram (Marina · Fernando de Noronha ·
 * R$ 12.840,00): um só personagem recorrente ensina o objeto em todas as
 * telas. O desenho é o do card do funil (três linhas, valor na sua coluna de
 * dígitos com largura reservada). Só visual, `aria-hidden` pelo EmptyState.
 */
function NegocioPreview() {
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-surface p-3 shadow-1">
      <span className="truncate text-15 font-medium text-ink">
        Marina Albuquerque
      </span>
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-13 text-muted">
          Fernando de Noronha
        </span>
        <span data-numeric className="shrink-0 text-13 tabular-nums text-subtle">
          <span className="sr-only">viagem em </span>
          6 nov
        </span>
      </span>
      <span className="mt-1">
        <Money cents={1_284_000} size="15" reserveFor={5_940_000} align="left" />
      </span>
    </div>
  );
}

/** Amostra do que aparece quando alguém abre a proposta. Só visual. */
function OpenedPreview() {
  return (
    // Papel, não caixa: um preview é conteúdo que mora na página, e a regra do
    // fio proíbe contorno nos quatro lados aí (Rule > "onde o traço pode").
    <div className="flex items-center gap-3 rounded-md bg-surface p-3 shadow-1">
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-soft-ink">
        <OpenedIcon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-15 font-medium text-ink">Marina Albuquerque</span>
        <span className="text-13 text-muted">abriu 6 vezes · há 3h</span>
      </span>
    </div>
  );
}

/**
 * Linha de "Propostas paradas" — uma proposta `sent`/`viewed` sem resposta há
 * mais de 7 dias. O `valueCents` é do NEGÓCIO associado (a proposta não tem
 * valor próprio), o `diasParado` é medido do último evento entre `sentAt` e
 * `lastViewedAt` (o que o cliente fez por último), e o botão "Cobrar" prepara
 * o follow-up no WhatsApp — mesmo placeholder do S4, agora sobre a proposta
 * certa.
 */
function ParkedProposalRow({ item, reserveFor }: { item: PropostaParada; reserveFor: number }) {
  const toast = useToast();
  const [copiado, setCopiado] = React.useState(false);

  async function copiarCobranca() {
    const texto = mensagemCobranca(item.contactName, item.destination);
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
      toast.show({
        title: "Mensagem copiada",
        description: `Cole no WhatsApp de ${item.contactName}.`,
        tone: "ok",
      });
    } catch {
      toast.show({
        title: "Não consegui copiar",
        description: "Selecione e copie o texto manualmente.",
        tone: "danger",
      });
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-15 font-medium text-ink">
          {item.contactName}
          {item.destination ? (
            <span className="text-muted font-normal">
              {" · "}
              {item.destination}
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-1.5 text-13 text-warn-soft-ink">
          <ClockIcon className="size-3.5 shrink-0" />
          parada há {item.diasParado} dias
        </span>
      </span>

      <Money cents={item.valueCents} size="15" align="right" reserveFor={reserveFor} />

      {/*
       * O "Cobrar" era um placeholder do S4 que só mostrava um toast dizendo
       * que a mensagem estava "pronta para enviar" — e não havia mensagem
       * nenhuma. Botão que finge ter agido é pior que botão ausente: a agente
       * confia, não envia, e perde a venda achando que enviou. Agora ele copia
       * de verdade o texto do follow-up (mesmo caminho do "Copiar mensagem"
       * das tarefas de hoje, logo acima nesta tela) e o rótulo diz o que ele
       * faz. Vira link `wa.me` no dia em que `PropostaParada` trouxer o
       * WhatsApp do contato (pedido em docs/handoffs/nina-para-rafa.md).
       */}
      <Button size="sm" variant="secondary" onPointerDown={() => void copiarCobranca()}>
        {copiado ? "Copiada" : "Copiar cobrança"}
      </Button>
    </li>
  );
}

/**
 * Card de "Este mês" — um dos quatro (vendas/comissão/conversão/paradas). É
 * papel clicável: `interactive` dá hover/pressão, `role="link"` + `tabIndex`
 * + `onKeyDown` (Enter) garantem o caminho de teclado e leitor de tela, não
 * só o ponteiro. Navegação no `onClick` (não `pointerdown`): para abrir outra
 * página, o atraso de 100ms do `click` não é perceptível — a regra do
 * `pointerdown` é para feedback tátil de botões, não para navegação.
 */
function MonthCard({
  href,
  ariaLabel,
  children,
}: {
  href: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <Card
      interactive
      role="link"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={() => router.push(href)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          router.push(href);
        }
      }}
      className="min-h-[6.5rem] p-4"
    >
      {children}
    </Card>
  );
}

/* =============================================================================
   Em viagem — §3, o pós-venda do /hoje
   -----------------------------------------------------------------------------
   A venda fecha e o cliente some do produto; a viagem em curso é o momento
   de maior risco (emergência) e maior oportunidade (depoimento, recompra).
   Tudo alimentado por `listarEmViagem()` (S14), que já classifica cada
   negócio `ganho` com data de ida em um — e só um — de três estados:

     "Viaja em N dias"   última chamada discreta (documentos, check-in);
                         0 = viaja hoje. A LINHA leva à ficha do negócio
                         (`/funil/[id]`) — aviso com porta, não tarefa.
     "Em viagem até..."  UMA linha — presença, não ruído; a ficha fica a um
                         toque, o botão continua sendo só um.
     "Retornou há N"     o ÚNICO BOTÃO da seção: pedir depoimento, mensagem
                         pronta no WhatsApp do contato (`contactWhatsapp`,
                         viagem do próprio tenant — nunca em superfície
                         pública). A linha em si leva à ficha do negócio.

   Sem WhatsApp cadastrado, a linha "retornou" fica em silêncio: um link
   `wa.me` com número duvidoso abre conversa com estranho — pior que não
   abrir. Vazio = UMA linha discreta (`compact`): esta tela já tem quatro
   outras seções, não cabe um pranto de estado vazio grande aqui.
   ========================================================================== */

type ViagemLinha = ViagemEmCurso &
  (
    | { estado: "partindo"; diasRestantes: number }
    | { estado: "andamento" }
    | { estado: "retornou"; diasDesdeRetorno: number }
  );

function EmViagemSection() {
  const [status, setStatus] = React.useState<Status>("loading");
  const [linhas, setLinhas] = React.useState<ViagemLinha[]>([]);
  const [errorInfo, setErrorInfo] = React.useState<{
    mensagem: string;
    correcao?: string;
  } | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const retry = React.useCallback(() => setReloadToken((token) => token + 1), []);

  React.useEffect(() => {
    let active = true;
    setStatus((current) => (current === "ready" ? current : "loading"));
    void listarEmViagem().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setErrorInfo({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      const grupos: EmViagemGrupos = result.data;
      setLinhas([
        ...grupos.partindo.map((v) => ({ ...v, estado: "partindo" as const })),
        ...grupos.emViagem.map((v) => ({ ...v, estado: "andamento" as const })),
        ...grupos.retornou.map((v) => ({ ...v, estado: "retornou" as const })),
      ]);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  const maxValor = Math.max(1, ...linhas.map((linha) => linha.valueCents));

  return (
    <section aria-labelledby="hoje-viagem">
      <SectionHeading>
        <span id="hoje-viagem">Em viagem</span>
      </SectionHeading>

      {status === "loading" ? (
        <Card className="flex flex-col gap-4 p-4">
          {[0, 1].map((row) => (
            <SkeletonRow key={row} />
          ))}
        </Card>
      ) : status === "error" ? (
        <Card className="flex flex-col items-start gap-3 p-4">
          <FieldError>{errorInfo?.mensagem}</FieldError>
          <Button variant="secondary" size="sm" onClick={retry}>
            {errorInfo?.correcao ?? "Tentar de novo"}
          </Button>
        </Card>
      ) : linhas.length === 0 ? (
        <EmptyState
          compact
          title="Nenhuma viagem em curso"
          description="Negócios fechados com data de ida aparecem aqui — a última chamada antes de embarcar, a viagem em curso e quem já voltou."
        />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line-subtle">
            {linhas.map((linha) => (
              <ViagemRow key={linha.id} item={linha} reserveFor={maxValor} />
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function ViagemRow({
  item,
  reserveFor,
}: {
  item: ViagemLinha;
  reserveFor: number;
}) {
  const rotulo =
    item.estado === "partindo"
      ? item.diasRestantes === 0
        ? "Viaja hoje"
        : item.diasRestantes === 1
          ? "Viaja amanhã"
          : `Viaja em ${item.diasRestantes} dias`
      : item.estado === "andamento"
        ? item.returnOn
          ? `Em viagem até ${formatarFaixaDeDatas(item.returnOn, null)}`
          : "Em viagem"
        : item.diasDesdeRetorno === 1
          ? "Retornou ontem"
          : `Retornou há ${item.diasDesdeRetorno} dias`;

  const urgente = item.estado === "partindo" && item.diasRestantes <= 2;
  const Icone =
    item.estado === "partindo" ? PassportIcon : item.estado === "andamento" ? TodayIcon : ChatIcon;

  const linkDepoimento =
    item.estado === "retornou"
      ? waMeLink(item.contactWhatsapp, mensagemDepoimento(item.contactName, item.destination))
      : null;

  return (
    /* A linha inteira leva à ficha do NEGÓCIO (`/funil/${item.id}`) — mesma
       navegação do quadro do funil. Era `<li>` sem link nenhum: o PO abriu
       "Em viagem" e não tinha para onde ir. O botão de depoimento fica FORA do
       link (irmão, não filho) — ação dentro de ação é alvo que o leitor de
       tela não resolve. Mesmo desenho da lista de clientes (link flex-1 +
       ação à parte). */
    <li className="flex items-center gap-1 pr-2">
      <Link
        href={`/funil/${item.id}`}
        aria-label={`Abrir o negócio de ${item.contactName}`}
        className={cn(
          "flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3",
          "rounded-xs hover:bg-surface-2",
          "[@media(pointer:coarse)]:min-h-11",
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-15 font-medium text-ink">
            {item.contactName}
            {item.destination ? (
              <span className="font-normal text-muted"> · {item.destination}</span>
            ) : null}
          </span>
          <span
            className={cn(
              "flex items-center gap-1.5 text-13",
              urgente ? "text-warn" : "text-muted",
            )}
          >
            <Icone className="size-3.5 shrink-0" />
            {rotulo}
          </span>
        </span>

        <Money
          cents={item.valueCents}
          size="13"
          tone="muted"
          align="right"
          reserveFor={reserveFor}
        />
      </Link>

      {linkDepoimento ? (
        <Button size="sm" variant="secondary" asChild>
          <a href={linkDepoimento} target="_blank" rel="noopener noreferrer">
            Pedir depoimento
          </a>
        </Button>
      ) : null}
    </li>
  );
}

/* =============================================================================
   Novo lembrete — o "Criar lembrete" morto agora chama `criarTarefa`
   -----------------------------------------------------------------------------
   Sheet curta: título e vencimento são os dois campos que o servidor exige.
   Tipo e contato são opcionais — a doutrina do produto é "lembrete solto"
   funcionar tão bem quanto um vinculado.

   `dueAt` é `type="datetime-local"`, não `type="date"` (cuidado do Rafa em
   docs/handoffs/rafa-para-nina.md): um `<input type="date">` sozinho manda
   "AAAA-MM-DD" puro, que o construtor `Date` do JS interpreta como meia-noite
   UTC — em Brasília isso nasce com até 3h de atraso, "vencido" na hora de
   criar. `datetime-local` manda "AAAA-MM-DDTHH:mm" SEM fuso, e a mesma
   especificação do `Date` trata essa forma (sem "Z"/offset) como hora LOCAL
   do navegador — exatamente o comportamento certo, sem gambiarra nenhuma no
   componente. O valor default é "agora + 30min, arredondado para os 15min
   seguintes": fica quase sempre no mesmo dia (aparece em "Tarefas de hoje" na
   mesma hora) e quase nunca nasce como "vencida" — o oposto de sugerir 09:00
   fixo, que nasceria atrasado toda tarde.

   `dealId` ficou de fora do formulário: vincular a um negócio pede escolher
   PRIMEIRO o contato dono dele, e dois buscadores empilhados numa Sheet curta
   é exatamente a "cara de formulário genérico" que a direção proíbe. Quem
   quiser lembrete atrelado a um negócio específico ainda tem o atalho da
   ficha do contato (`LembretesCard`, que não pede tipo/contato porque já
   está dentro da ficha) — documentado em docs/status/nina.md.

   O retorno de `criarTarefa` não traz `contactName`/`vencida`/
   `suggestedMessage` (contrato documentado em rafa-para-nina.md). Em vez de
   um segundo round-trip só para preencher isso — o que atrasaria a tarefa
   aparecer na lista —, a Sheet já tem o nome do contato selecionado (mesma
   lista carregada para o Combobox) e computa `vencida` localmente: mesma
   regra que o servidor usa (`dueAt < agora`).
   ========================================================================== */

const REMINDER_KIND_LABELS: Record<string, string> = {
  followup: "Follow-up",
  ligar: "Ligar",
  whatsapp: "WhatsApp",
  email: "E-mail",
  outro: "Outro",
};

const REMINDER_KIND_OPTIONS = Object.entries(REMINDER_KIND_LABELS).map(
  ([value, label]) => ({ value, label }),
);

/** "Agora + 30min", arredondado para o próximo múltiplo de 15 — nasce no
 * futuro (não "vencida" ao salvar) e quase sempre ainda hoje. */
function defaultReminderDueAt(): string {
  const target = new Date(Date.now() + 30 * 60 * 1000);
  target.setSeconds(0, 0);
  target.setMinutes(Math.ceil(target.getMinutes() / 15) * 15);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(target.getHours())}:${pad(target.getMinutes())}`;
}

function NovoLembreteSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (task: TarefaDeHoje) => void;
}) {
  const [title, setTitle] = React.useState("");
  const [dueAt, setDueAt] = React.useState(defaultReminderDueAt);
  const [kind, setKind] = React.useState("outro");
  const [notes, setNotes] = React.useState("");
  const [contactId, setContactId] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<{
    campo?: string;
    mensagem: string;
  } | null>(null);
  const [contatos, setContatos] = React.useState<ContatoResumo[]>([]);
  const [loadingContatos, setLoadingContatos] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setTitle("");
      setDueAt(defaultReminderDueAt());
      setKind("outro");
      setNotes("");
      setContactId("");
      setFieldError(null);
      setContatos([]);
      return;
    }
    setLoadingContatos(true);
    void listarContatos({ limite: 200 }).then((result) => {
      setLoadingContatos(false);
      if (result.ok) setContatos(result.data);
    });
  }, [open]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setFieldError(null);
    const result = await criarTarefa({
      title: title.trim(),
      notes: notes.trim() || undefined,
      kind: kind as "followup" | "ligar" | "whatsapp" | "email" | "outro",
      // O `datetime-local` não carrega fuso; convertido AQUI, no aparelho, o
      // servidor (UTC, ex.: Vercel) deixava de interpretar "15:00" como 15:00
      // UTC e o lembrete acordava 3h mais cedo que o marcado.
      dueAt: new Date(dueAt).toISOString(),
      contactId: contactId || undefined,
    });
    setCreating(false);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      setFieldError({ campo: result.campo, mensagem: result.mensagem });
      return;
    }

    const created = result.data;
    const contactName = contatos.find((c) => c.id === contactId)?.name ?? null;
    onCreated({
      ...created,
      contactName,
      dealTitle: null,
      destination: null,
      suggestedMessage: null,
      vencida: new Date(created.dueAt).valueOf() < Date.now(),
    });
    onOpenChange(false);
  }

  const selectedContato = contatos.find((c) => c.id === contactId);
  const canSubmit = title.trim().length >= 2 && dueAt.length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        open={open}
        onOpenChange={onOpenChange}
        title="Novo lembrete"
        description="Título e vencimento são os únicos campos obrigatórios."
        footer={
          <Button
            variant="primary"
            block
            type="submit"
            form="novo-lembrete-form"
            loading={creating}
            disabled={!canSubmit}
          >
            Criar lembrete
          </Button>
        }
      >
        <form
          id="novo-lembrete-form"
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 py-2"
        >
          <Field invalid={fieldError?.campo === "title"}>
            <Label>Título</Label>
            <Input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex.: Ligar para confirmar hospedagem"
            />
            {fieldError?.campo === "title" ? (
              <FieldError>{fieldError.mensagem}</FieldError>
            ) : null}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field invalid={fieldError?.campo === "dueAt"}>
              <Label>Quando</Label>
              <Input
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
                className="tabular-nums"
              />
              {fieldError?.campo === "dueAt" ? (
                <FieldError>{fieldError.mensagem}</FieldError>
              ) : (
                <FieldHint>A hora do seu aparelho é a que vale.</FieldHint>
              )}
            </Field>

            <Field>
              <Label optional>Tipo</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger>
                  <SelectValue>{REMINDER_KIND_LABELS[kind]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {REMINDER_KIND_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field invalid={fieldError?.campo === "contactId"}>
            <Label optional>Contato</Label>
            <Combobox
              value={contactId}
              onValueChange={(value) => setContactId(value ?? "")}
              options={contatos.map((c) => ({
                value: c.id,
                label: c.name,
                hint: c.whatsapp ?? c.phone ?? undefined,
              }))}
              placeholder="Nenhum — lembrete solto"
              searchPlaceholder="Buscar por nome"
              loading={loadingContatos}
              emptyMessage="Nenhum contato encontrado"
              invalid={fieldError?.campo === "contactId"}
            />
            {fieldError?.campo === "contactId" ? (
              <FieldError>{fieldError.mensagem}</FieldError>
            ) : selectedContato ? (
              <FieldHint>Aparece na ficha de {selectedContato.name} também.</FieldHint>
            ) : null}
          </Field>

          <Field>
            <Label optional>Nota</Label>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="O que lembrar na hora de agir…"
              rows={2}
            />
          </Field>

          {fieldError && !fieldError.campo ? (
            <FieldError>{fieldError.mensagem}</FieldError>
          ) : null}
        </form>
      </SheetContent>
    </Sheet>
  );
}
