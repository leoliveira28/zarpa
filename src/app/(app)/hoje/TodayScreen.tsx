"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/ui/cn";
import { formatBRL } from "@/lib/ui/format";
import { useTransitionPreset } from "@/lib/ui/motion";
import {
  PROPOSALS,
  TASKS,
  recentlyOpened,
  stalled,
  sumCents,
  type Task,
} from "@/lib/ui/sample-data";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeading } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { Skeleton, SkeletonRow } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { ClockIcon, OpenedIcon, ChevronRightIcon } from "@/components/app/icons";

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
   ========================================================================== */

export function TodayScreen() {
  const toast = useToast();
  const transition = useTransitionPreset();

  // simulação do primeiro carregamento — o backend não existe ainda.
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 700);
    return () => window.clearTimeout(timer);
  }, []);

  const [tasks, setTasks] = React.useState<Task[]>(TASKS);
  const opened = React.useMemo(() => recentlyOpened(), []);
  const parked = React.useMemo(() => stalled(), []);
  const pipelineCents = React.useMemo(
    () => sumCents(PROPOSALS.filter((p) => p.stage !== "fechada")),
    [],
  );
  const closedCents = React.useMemo(
    () => sumCents(PROPOSALS.filter((p) => p.stage === "fechada")),
    [],
  );

  const pending = tasks.filter((task) => !task.done);

  function toggleTask(id: string, done: boolean) {
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, done } : task)),
    );
    if (!done) return;
    const task = tasks.find((item) => item.id === id);
    toast.undo(
      "Tarefa concluída",
      () =>
        setTasks((current) =>
          current.map((item) =>
            item.id === id ? { ...item, done: false } : item,
          ),
        ),
      { description: task?.title, tone: "ok" },
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Greeting
        pipelineCents={pipelineCents}
        closedCents={closedCents}
        loading={loading}
      />

      <section aria-labelledby="hoje-tarefas">
        <SectionHeading
          action={
            <span className="text-13 tabular-nums text-muted" data-numeric>
              {pending.length} de {tasks.length}
            </span>
          }
        >
          <span id="hoje-tarefas">Tarefas de hoje</span>
        </SectionHeading>

        {loading ? (
          <Card className="flex flex-col gap-4 p-4">
            {[0, 1, 2].map((row) => (
              <SkeletonRow key={row} />
            ))}
          </Card>
        ) : tasks.length === 0 ? (
          <EmptyState
            title="Nada marcado para hoje"
            description="Toda proposta enviada vira um lembrete de follow-up automático em 3 dias. Você não precisa lembrar sozinho."
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
                    className="flex items-start gap-3 px-4 py-3"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={task.done}
                      onCheckedChange={(checked) =>
                        toggleTask(task.id, checked === true)
                      }
                      aria-label={`Concluir: ${task.title}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-15 font-medium",
                          task.done
                            ? "text-muted line-through decoration-line-strong"
                            : "text-ink",
                        )}
                      >
                        {task.title}
                      </p>
                      <p className="mt-0.5 text-13 text-muted">{task.detail}</p>
                    </div>
                    <span
                      data-numeric
                      className="shrink-0 pt-0.5 text-13 tabular-nums text-muted"
                    >
                      {task.at}
                    </span>
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

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-[6.5rem] rounded-lg" />
            <Skeleton className="h-[6.5rem] rounded-lg" />
          </div>
        ) : opened.length === 0 ? (
          <EmptyState
            title="Ninguém abriu ainda"
            description="Assim que o cliente tocar no link, ele aparece aqui — com quantas vezes abriu e quando."
            preview={<OpenedPreview />}
            action={<Button variant="primary">Enviar uma proposta</Button>}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {opened.map((proposal) => (
              <Card key={proposal.id} interactive className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-15 font-semibold text-ink">
                      {proposal.client}
                    </p>
                    <p className="mt-0.5 truncate text-13 text-muted">
                      {proposal.destination}
                    </p>
                  </div>
                  <Badge tone="accent" dot>
                    {proposal.opens}
                    {proposal.opens === 1 ? " abertura" : " aberturas"}
                  </Badge>
                </div>

                <div className="mt-3 flex items-end justify-between gap-3">
                  <Money
                    cents={proposal.cents}
                    size="20"
                    reserveFor={5_940_000}
                  />
                  <span className="flex items-center gap-1.5 pb-0.5 text-13 text-muted">
                    <OpenedIcon className="size-3.5" />
                    há {proposal.lastOpenHours}h
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="hoje-paradas">
        <SectionHeading
          action={
            <span className="text-13 text-muted">
              {formatBRL(sumCents(parked))} parados
            </span>
          }
        >
          <span id="hoje-paradas">Paradas há mais de 7 dias</span>
        </SectionHeading>

        {loading ? (
          <Card className="flex flex-col gap-4 p-4">
            {[0, 1].map((row) => (
              <SkeletonRow key={row} />
            ))}
          </Card>
        ) : parked.length === 0 ? (
          <EmptyState
            compact
            title="Nenhuma proposta esquecida"
            description="Toda proposta sem resposta há 7 dias aparece aqui, com o botão de cobrar junto."
          />
        ) : (
          <Card tone="warn" className="overflow-hidden">
            <ul className="divide-y divide-warn/20">
              {parked.map((proposal) => (
                <li
                  key={proposal.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-15 font-medium text-ink">
                      {proposal.client}
                    </span>
                    <span className="flex items-center gap-1.5 text-13 text-warn-soft-ink">
                      <ClockIcon className="size-3.5 shrink-0" />
                      parada há {proposal.idleDays} dias
                      {proposal.opens === 0 ? " · nunca aberta" : null}
                    </span>
                  </span>

                  <Money
                    cents={proposal.cents}
                    size="15"
                    reserveFor={5_940_000}
                  />

                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      toast.show({
                        title: "Mensagem preparada",
                        description: `Follow-up de ${proposal.client} pronto para enviar no WhatsApp.`,
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

function Greeting({
  pipelineCents,
  closedCents,
  loading,
}: {
  pipelineCents: number;
  closedCents: number;
  loading: boolean;
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
        <h2 className="mt-1 text-32 font-semibold text-ink">Hoje</h2>
      </div>

      {/* Dois números, não seis. Painel com muita métrica não informa, decora. */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <p className="text-13 font-medium text-muted">Em negociação</p>
          <Money
            cents={loading ? null : pipelineCents}
            size="20"
            reserveFor={30_000_000}
            className="mt-1"
          />
        </Card>
        <Card className="p-4">
          <p className="text-13 font-medium text-muted">Fechado no mês</p>
          <Money
            cents={loading ? null : closedCents}
            size="20"
            tone="ok"
            reserveFor={30_000_000}
            className="mt-1"
          />
        </Card>
      </div>
    </header>
  );
}

/** Amostra do que aparece quando alguém abre a proposta. Só visual. */
function OpenedPreview() {
  return (
    <div className="flex items-center gap-3 rounded-md border border-line bg-surface p-3">
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
