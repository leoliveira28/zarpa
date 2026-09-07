"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  concluirTarefa,
  listarAberturasRecentes,
  listarNegociosParados,
  listarTarefasDeHoje,
  obterResumoDoPipeline,
  type AberturaProposta,
  type ResumoDeParados,
  type ResumoDoPipeline,
  type TarefaDeHoje,
} from "@/server";
import { cn } from "@/lib/ui/cn";
import { useTransitionPreset } from "@/lib/ui/motion";
import { useDeferredDelete } from "@/lib/ui/useDeferredDelete";
import { formatRelativeShort, formatTime } from "@/lib/ui/format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeading } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { FieldError } from "@/components/ui/Field";
import { Money } from "@/components/ui/Money";
import { Skeleton, SkeletonRow } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import {
  CakeIcon,
  ChatIcon,
  ChevronRightIcon,
  ClockIcon,
  CopyIcon,
  OpenedIcon,
  PassportIcon,
} from "@/components/app/icons";

/* =============================================================================
   Hoje
   -----------------------------------------------------------------------------
   A tela que abre. Responde três perguntas, nessa ordem:

     1. o que eu preciso fazer agora
     2. quem mexeu na minha proposta (abriu o link) — é o sinal de compra
     3. o que está morrendo parado

   Desenhada para 390px primeiro. No desktop ela vira duas colunas, mas o
   conteúdo e a ordem são os mesmos: quem trabalha no celular não recebe uma
   versão pior.

   As quatro seções são dado real: "Tarefas de hoje" e "Abriram sua proposta"
   desde o S8 (`listarTarefasDeHoje` / `listarAberturasRecentes`); "Paradas há
   mais de 7 dias" e os dois números do topo desde o S4
   (`listarNegociosParados` / `obterResumoDoPipeline`, `src/server/deals.ts`).
   Nenhuma tela mais importa de `src/lib/ui/sample-data.ts`.

   O selo "· nunca aberta" que a v1 mostrava na linha de "Paradas" saiu: ele
   lia `proposal.opens === 0` de um dado de exemplo. `NegocioParado` (a forma
   real) não carrega esse número — abertura é sinal de PROPOSTA, e um negócio
   pode ter zero, uma ou várias propostas ao longo da vida; não haveria um
   "abriu"/"não abriu" único para o card mostrar sem escolher qual proposta
   ele representa. Documentado em docs/status/nina.md.
   ========================================================================== */

type Status = "loading" | "ready" | "error";

export function TodayScreen() {
  const toast = useToast();
  const transition = useTransitionPreset();

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
    void obterResumoDoPipeline().then((result) => {
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
  }, [pipelineReload]);

  const [parkedStatus, setParkedStatus] = React.useState<Status>("loading");
  const [parked, setParked] = React.useState<ResumoDeParados | null>(null);
  const [parkedError, setParkedError] = React.useState<{
    mensagem: string;
    correcao?: string;
  } | null>(null);
  const [parkedReload, setParkedReload] = React.useState(0);
  const retryParked = React.useCallback(
    () => setParkedReload((n) => n + 1),
    [],
  );

  React.useEffect(() => {
    let active = true;
    setParkedStatus((current) => (current === "ready" ? current : "loading"));
    void listarNegociosParados().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setParkedStatus("error");
        setParkedError({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setParked(result.data);
      setParkedStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [parkedReload]);

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
        pipeline={pipeline}
        status={pipelineStatus}
        error={pipelineError}
        onRetry={retryPipeline}
      />

      <section aria-labelledby="hoje-tarefas">
        <SectionHeading
          action={
            tasksStatus === "ready" ? (
              <span className="text-13 tabular-nums text-muted" data-numeric>
                {tasks.length} {tasks.length === 1 ? "pendente" : "pendentes"}
              </span>
            ) : null
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
            action={<Button variant="primary">Criar lembrete</Button>}
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
            action={<Button variant="primary">Enviar uma proposta</Button>}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {opened.map((abertura) => (
              <Card key={abertura.proposalId} interactive className="p-4">
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
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="hoje-paradas">
        <SectionHeading
          action={
            parkedStatus === "ready" ? (
              <span className="flex items-baseline gap-1 text-13 text-muted">
                <Money
                  cents={parked?.totalCents ?? 0}
                  size="13"
                  tone="muted"
                  reserveFor={30_000_000}
                />
                parados
              </span>
            ) : null
          }
        >
          <span id="hoje-paradas">Paradas há mais de 7 dias</span>
        </SectionHeading>

        {parkedStatus === "loading" ? (
          <Card className="flex flex-col gap-4 p-4">
            {[0, 1].map((row) => (
              <SkeletonRow key={row} />
            ))}
          </Card>
        ) : parkedStatus === "error" ? (
          <Card className="flex flex-col items-start gap-3 p-4">
            <FieldError>{parkedError?.mensagem}</FieldError>
            <Button variant="secondary" size="sm" onClick={retryParked}>
              {parkedError?.correcao ?? "Tentar de novo"}
            </Button>
          </Card>
        ) : !parked || parked.itens.length === 0 ? (
          <EmptyState
            compact
            title="Nenhum negócio esquecido"
            description="Todo negócio sem movimentação há 7 dias aparece aqui, com o botão de cobrar junto."
          />
        ) : (
          <Card tone="warn" className="overflow-hidden">
            <ul className="divide-y divide-warn/20">
              {parked.itens.map((deal) => (
                <li
                  key={deal.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-15 font-medium text-ink">
                      {deal.contactName}
                    </span>
                    <span className="flex items-center gap-1.5 text-13 text-warn-soft-ink">
                      <ClockIcon className="size-3.5 shrink-0" />
                      parada há {deal.diasParado} dias
                    </span>
                  </span>

                  <Money
                    cents={deal.valueCents}
                    size="15"
                    reserveFor={parked.totalCents}
                  />

                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      toast.show({
                        title: "Mensagem preparada",
                        description: `Follow-up de ${deal.contactName} pronto para enviar no WhatsApp.`,
                        tone: "ok",
                      })
                    }
                  >
                    Cobrar
                    <ChevronRightIcon className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
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
  pipeline,
  status,
  error,
  onRetry,
}: {
  pipeline: ResumoDoPipeline | null;
  status: Status;
  error: { mensagem: string; correcao?: string } | null;
  onRetry: () => void;
}) {
  const now = new Date();
  const hour = now.getHours();
  const salute =
    hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  return (
    <header className="flex flex-col gap-4">
      <div>
        <p className="text-13 text-muted">
          {salute}, Camila · {now.getDate()} de{" "}
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
          label="Fechado no mês"
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
