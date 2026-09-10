"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  arquivarContato,
  atualizarContato,
  criarFatura,
  emitirBoletoDaFatura,
  listarFaturasDoCliente,
  type FaturaDoCliente,
  atualizarViajante,
  concluirTarefa,
  criarViajante,
  excluirContato,
  excluirViajante,
  listarTarefas,
  listarViajantes,
  obterContato,
  obterDocumentoDoContato,
  obterDocumentoDoViajante,
  restaurarContato,
  type ContatoDetalhe,
  type ServiceResult,
  type TarefaResumo,
  type ViajanteInput,
  type ViajanteResumo,
} from "@/server";
import {
  obterHistoricoDoContato,
  type HistoricoDoContato,
  type NegocioDoContato,
  type PropostaDoContato,
  type RoteiroDoContato,
} from "@/server/contacts";
import { avisarRecusaDeEscrita } from "@/lib/ui/assinatura";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardAction,
  CardBody,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldError, Label, SavedMark } from "@/components/ui/Field";
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
import { Skeleton, SkeletonRow, SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { NovoNegocioSheet } from "@/components/app/NovoNegocioSheet";
import {
  CakeIcon,
  ChevronRightIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  OpenedIcon,
  PassportIcon,
  PlusIcon,
  TodayIcon,
} from "@/components/app/icons";
import {
  formatDayMonth,
  formatRelativeShort,
  formatarFaixaDeDatas,
} from "@/lib/ui/format";
import { useAutosave } from "@/lib/ui/useAutosave";
import { useDeferredDelete } from "@/lib/ui/useDeferredDelete";
import {
  SOURCE_LABELS,
  SOURCE_OPTIONS,
  TRAVELER_KIND_LABELS,
  TRAVELER_KIND_OPTIONS,
  daysUntilIso,
  daysUntilMonthDay,
  formatMonthDay,
  passportLabel,
  passportTone,
} from "../shared";

/* =============================================================================
   Ficha do contato — a ficha 360°
   -----------------------------------------------------------------------------
   Registro silencioso, sem prancha (a regra reserva ilustração para vazio e
   entrada). A ordem responde a pergunta do PO (2026-09) de cima para baixo:
   quem é o cliente, onde ele está AGORA (proposta aberta? em viagem?), quanto
   ele já comprou e o histórico (negócios, propostas, roteiros). O cadastro
   editável (Dados, Documento, Passageiros) e o Encerramento vêm depois — são
   referência e manutenção, não a resposta que se vem buscar aqui.

     1. Cabeçalho           — quem é (nome, cliente desde, contadores)
     2. Agora               — proposta com o cliente, viagem em curso, próxima
                              partida; cada linha leva à proposta/negócio
     3. Resumo              — quanto já comprou, comissão que rendeu, viagens
     4. Negócios            — todo o funil deste contato, valor e fase
     5. Propostas · Roteiros — o que foi enviado e o link que já virou página
     6. Lembretes           — o follow-up pendente deste cliente
     7. Dados · Documento · Passageiros — cadastro (PII com cuidado)
     8. Encerramento        — arquivar/excluir

   Cada campo se salva sozinho — não existe botão "Salvar" na tela inteira.
   Tudo da seção 2–5 vem de UMA chamada (`obterHistoricoDoContato`,
   src/server/contacts.ts).
   ========================================================================== */

type Status = "loading" | "ready" | "error";

export function ContatoScreen({ contatoId }: { contatoId: string }) {
  const router = useRouter();
  const toast = useToast();

  const [status, setStatus] = React.useState<Status>("loading");
  const [contact, setContact] = React.useState<ContatoDetalhe | null>(null);
  const [errorInfo, setErrorInfo] = React.useState<{
    mensagem: string;
    correcao?: string;
  } | null>(null);

  const [reloadToken, setReloadToken] = React.useState(0);
  const retry = React.useCallback(() => setReloadToken((token) => token + 1), []);

  // Histórico 360° — uma chamada alimenta Agora, Resumo, Negócios, Propostas
  // e Roteiros. Falha com retry no card de Negócios (o card que sempre
  // existe); Agora e Resumo falham em silêncio porque são complemento.
  const [historico, setHistorico] = React.useState<HistoricoDoContato | null>(null);
  const [historicoStatus, setHistoricoStatus] = React.useState<Status>("loading");
  const [historicoReload, setHistoricoReload] = React.useState(0);
  const retryHistorico = React.useCallback(
    () => setHistoricoReload((token) => token + 1),
    [],
  );

  React.useEffect(() => {
    let active = true;
    setHistoricoStatus("loading");
    void obterHistoricoDoContato(contatoId).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setHistorico(null);
        setHistoricoStatus("error");
        return;
      }
      setHistorico(result.data);
      setHistoricoStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [contatoId, historicoReload]);

  // Atalho "Novo negócio" a partir da ficha — o segundo ponto de entrada do
  // bloqueio nº1 (ver docs/status/nina.md e o cabeçalho de FunnelScreen.tsx).
  // O Funil não está montado aqui, então o card não "aparece" na hora — o
  // toast com o link resolve isso sem esperar a agente navegar às cegas.
  const [negocioSheetOpen, setNegocioSheetOpen] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    void obterContato(contatoId).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setErrorInfo({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setContact(result.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [contatoId, reloadToken]);

  function patch(update: Partial<ContatoDetalhe>) {
    setContact((current) => (current ? { ...current, ...update } : current));
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/clientes"
        className="flex w-fit items-center gap-1 text-13 font-medium text-muted hover:text-ink"
      >
        <ChevronRightIcon className="size-3.5 -scale-x-100" />
        Clientes
      </Link>

      {status === "loading" ? (
        <ContatoSkeleton />
      ) : status === "error" || !contact ? (
        <Card className="flex flex-col items-start gap-3 p-5">
          <p className="text-15 text-ink">{errorInfo?.mensagem}</p>
          <Button variant="secondary" onClick={retry}>
            {errorInfo?.correcao ?? "Tentar de novo"}
          </Button>
        </Card>
      ) : (
        <>
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="display truncate text-32 text-ink">{contact.name}</h2>
              <p className="text-13 text-muted">
                Cliente desde {formatDayMonth(new Date(contact.createdAt))} ·{" "}
                {contact.totalViajantes}{" "}
                {contact.totalViajantes === 1 ? "passageiro" : "passageiros"} ·{" "}
                {contact.totalNegocios}{" "}
                {contact.totalNegocios === 1 ? "negócio" : "negócios"}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0"
              onPointerDown={() => setNegocioSheetOpen(true)}
            >
              <PlusIcon className="size-4" />
              <span className="hidden sm:inline">Novo negócio</span>
              <span className="sr-only sm:hidden">Novo negócio</span>
            </Button>
          </header>

          <AgoraCard historico={historico} />
          <ResumoCard historico={historico} />
          <NegociosCard
            contactName={contact.name}
            historico={historico}
            status={historicoStatus}
            onRetry={retryHistorico}
          />
          <PropostasCard propostas={historico?.propostas ?? null} />
          <RoteirosCard roteiros={historico?.roteiros ?? null} />
          <LembretesCard contatoId={contatoId} />
          <DadosCard contact={contact} contatoId={contatoId} onPatched={patch} />
          <DocumentoCard contact={contact} contatoId={contatoId} onPatched={patch} />
          {contact.personType === "juridica" ? <FaturasCard contatoId={contatoId} /> : null}
          <PassageirosCard contatoId={contatoId} />
          <EncerramentoCard contact={contact} onPatched={patch} />

          <NovoNegocioSheet
            open={negocioSheetOpen}
            onOpenChange={setNegocioSheetOpen}
            contatoFixo={{ id: contact.id, nome: contact.name }}
            onCreated={(negocio) => {
              setNegocioSheetOpen(false);
              patch({ totalNegocios: contact.totalNegocios + 1 });
              toast.show({
                title: `Negócio criado: ${negocio.title}`,
                description: "Entrou no Funil, coluna Novo contato.",
                tone: "ok",
                action: { label: "Abrir Funil", onClick: () => router.push("/funil") },
              });
            }}
          />
        </>
      )}
    </div>
  );
}

function ContatoSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-2/3 rounded-sm" />
        <Skeleton className="h-3.5 w-1/2 rounded-xs" />
      </div>
      <Card className="p-4">
        <SkeletonText lines={4} />
      </Card>
      <Card className="flex flex-col gap-4 p-4">
        <SkeletonRow />
        <SkeletonRow />
      </Card>
    </div>
  );
}

/* =============================================================================
   Agora — onde o cliente está NESTE momento
   -----------------------------------------------------------------------------
   A resposta mais urgente da ficha: tem proposta com o link na mão dele? está
   em viagem agora? viaja em breve? Cada linha leva ao objeto certo — proposta
   → editor, viagem → ficha do negócio (mesmo destino do funil). Ausência é
   silêncio: cliente sem nada em aberto não ganha um card dizendo "nada".
   Erro de rede também: o card de Negócios, logo abaixo, carrega o retry —
   três cards repetindo "tentar de novo" é ruído.
   ========================================================================== */

function AgoraCard({ historico }: { historico: HistoricoDoContato | null }) {
  if (!historico) return null;
  const { propostaAberta, viagemEmCurso, proximaViagem } = historico;
  if (!propostaAberta && !viagemEmCurso && !proximaViagem) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agora</CardTitle>
      </CardHeader>
      <CardBody flush>
        <ul className="flex flex-col divide-y divide-line-subtle">
          {propostaAberta ? <AgoraPropostaRow item={propostaAberta} /> : null}
          {viagemEmCurso ? (
            <AgoraViagemRow
              item={viagemEmCurso}
              icone={<TodayIcon className="size-4" />}
              segundaLinha={
                viagemEmCurso.returnOn
                  ? `Em viagem até ${formatarFaixaDeDatas(viagemEmCurso.returnOn, null)}`
                  : "Em viagem"
              }
            />
          ) : null}
          {proximaViagem ? (
            <AgoraViagemRow
              item={proximaViagem}
              icone={<PassportIcon className="size-4" />}
              segundaLinha={rotuloDePartida(proximaViagem.departureOn)}
            />
          ) : null}
        </ul>
      </CardBody>
    </Card>
  );
}

/** "Viaja em N dias" — 0 = hoje, 1 = amanhã. Mesma régua do /hoje (viagens.ts). */
function rotuloDePartida(departureOn: string): string {
  const hoje = new Date().toISOString().slice(0, 10);
  const dias = Math.round(
    (Date.parse(`${departureOn}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) /
      86_400_000,
  );
  if (dias <= 0) return "Viaja hoje";
  if (dias === 1) return "Viaja amanhã";
  return `Viaja em ${dias} dias`;
}

function AgoraPropostaRow({ item }: { item: PropostaDoContato }) {
  return (
    <li>
      <Link
        href={`/propostas/${item.id}/editar`}
        className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2"
      >
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-soft-ink"
        >
          <OpenedIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-15 font-medium text-ink">
              {item.title}
            </span>
            <Badge tone="accent" dot>
              {PROPOSTA_STATUS_LABEL[item.status] ?? item.status}
            </Badge>
          </span>
          <span className="block truncate text-13 text-muted">
            {item.status === "viewed"
              ? `Abriu ${item.viewCount} ${
                  item.viewCount === 1 ? "vez" : "vezes"
                }${
                  item.lastViewedAt
                    ? ` · última ${formatRelativeShort(new Date(item.lastViewedAt))}`
                    : ""
                }`
              : item.sentAt
                ? `Enviada ${formatRelativeShort(new Date(item.sentAt))} · ainda não abriu`
                : "Com o cliente"}
          </span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-subtle" />
      </Link>
    </li>
  );
}

function AgoraViagemRow({
  item,
  icone,
  segundaLinha,
}: {
  item: { dealId: string; title: string; destination: string | null };
  icone: React.ReactNode;
  segundaLinha: string;
}) {
  return (
    <li>
      <Link
        href={`/funil/${item.dealId}`}
        className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2"
      >
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-3 text-muted"
        >
          {icone}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-15 font-medium text-ink">
            {item.destination ?? item.title}
          </span>
          <span className="block truncate text-13 text-muted">{segundaLinha}</span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-subtle" />
      </Link>
    </li>
  );
}

/* =============================================================================
   Resumo — "quanto ele já comprou"
   -----------------------------------------------------------------------------
   Faixa de três números, sem cabeçalho (mesma forma dos dois números do topo
   do /hoje): valor fechado com este cliente, comissão que ele já rendeu e
   quantas viagens isso foi — o cliente que recompra se revela aqui sem ler
   linha nenhuma de lista. Só existe quando há viagem fechada: zero-com-zero
   é informação que não ajuda ninguém a decidir nada.
   ========================================================================== */

function ResumoCard({ historico }: { historico: HistoricoDoContato | null }) {
  if (!historico || historico.totalViagens === 0) return null;

  // Linhas, não colunas: "R$ 575.000,00" não cabe num terço de 390px — valor que
  // quebra linha é bug. Rótulo à esquerda, valor à direita, fio entre linhas.
  const linhas: { rotulo: string; valor: React.ReactNode }[] = [
    {
      rotulo: "Já comprou",
      valor: (
        <Money
          cents={historico.totalCompradoCents}
          size="17"
          align="right"
          reserveFor={30_000_000}
        />
      ),
    },
    {
      rotulo: "Comissão",
      valor: (
        <Money
          cents={historico.comissaoGanhaCents}
          size="17"
          align="right"
          reserveFor={6_000_000}
        />
      ),
    },
    {
      rotulo: "Viagens",
      valor: (
        <span data-numeric className="text-17 tabular-nums text-ink">
          {historico.totalViagens}
        </span>
      ),
    },
  ];

  return (
    <Card>
      <CardBody flush>
        <ul className="flex flex-col divide-y divide-line-subtle">
          {linhas.map((linha) => (
            <li key={linha.rotulo} className="flex items-baseline justify-between gap-4 px-4 py-3">
              <span className="text-13 font-medium text-muted">{linha.rotulo}</span>
              {linha.valor}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/* =============================================================================
   Negócios · Propostas · Roteiros — o histórico
   -----------------------------------------------------------------------------
   Negócios é o card que SEMPRE existe (é ele que carrega o skeleton e o retry
   do histórico). Propostas e Roteiros só nascem quando há o que mostrar —
   ausência é silêncio, e "nada" repetido três vezes não é conteúdo.
   ========================================================================== */

const PROPOSTA_STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  sent: "Enviada",
  viewed: "Aberta",
  accepted: "Aceita",
  declined: "Recusada",
  expired: "Expirada",
};

const PROPOSTA_STATUS_TONE: Record<
  string,
  "neutral" | "accent" | "ok" | "warn" | "danger"
> = {
  draft: "neutral",
  sent: "accent",
  viewed: "accent",
  accepted: "ok",
  declined: "danger",
  expired: "warn",
};

function NegociosCard({
  contactName,
  historico,
  status,
  onRetry,
}: {
  contactName: string;
  historico: HistoricoDoContato | null;
  status: Status;
  onRetry: () => void;
}) {
  const negocios = historico?.negocios ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Negócios</CardTitle>
        {status === "ready" && negocios ? (
          <span data-numeric className="text-13 tabular-nums text-muted">
            {negocios.length}
          </span>
        ) : null}
      </CardHeader>
      <CardBody flush={status === "ready" && negocios !== null && negocios.length > 0}>
        {status === "loading" ? (
          <div className="flex flex-col gap-4 p-4">
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : negocios === null ? (
          <div className="flex flex-col items-start gap-3 p-4">
            <FieldError>Não consegui carregar o histórico de negócios.</FieldError>
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Tentar de novo
            </Button>
          </div>
        ) : negocios.length === 0 ? (
          <EmptyState
            compact
            title="Nenhum negócio ainda"
            description={`Toda cotação para ${contactName} nasce no funil e aparece aqui com valor e fase — inclusive as que viram viagem.`}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line-subtle">
            {negocios.map((negocio) => (
              <NegocioRow key={negocio.id} negocio={negocio} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function NegocioRow({ negocio }: { negocio: NegocioDoContato }) {
  const datas = negocio.departureOn
    ? formatarFaixaDeDatas(negocio.departureOn, negocio.returnOn)
    : null;

  return (
    <li>
      <Link
        href={`/funil/${negocio.id}`}
        className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-15 font-medium text-ink">
              {negocio.title}
            </span>
            <Badge tone={tonoDoNegocio(negocio)} dot>
              {negocio.stageLabel}
            </Badge>
          </span>
          <span className="block truncate text-13 text-muted">
            {negocio.isLost && negocio.lostReason
              ? negocio.lostReason
              : [negocio.destination, datas].filter(Boolean).join(" · ") ||
                `criado em ${formatDayMonth(new Date(negocio.createdAt))}`}
          </span>
        </span>
        <Money
          cents={negocio.valueCents}
          size="15"
          align="right"
          tone={negocio.isLost ? "muted" : "default"}
          reserveFor={30_000_000}
        />
      </Link>
    </li>
  );
}

function tonoDoNegocio(negocio: NegocioDoContato): "ok" | "danger" | "neutral" {
  if (negocio.isWon) return "ok";
  if (negocio.isLost) return "danger";
  return "neutral";
}

function PropostasCard({ propostas }: { propostas: PropostaDoContato[] | null }) {
  if (!propostas || propostas.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Propostas</CardTitle>
        <span data-numeric className="text-13 tabular-nums text-muted">
          {propostas.length}
        </span>
      </CardHeader>
      <CardBody flush>
        <ul className="flex flex-col divide-y divide-line-subtle">
          {propostas.map((proposta) => (
            <li key={proposta.id}>
              <Link
                href={`/propostas/${proposta.id}/editar`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-15 font-medium text-ink">
                      {proposta.title}
                    </span>
                    <Badge tone={PROPOSTA_STATUS_TONE[proposta.status] ?? "neutral"} dot>
                      {PROPOSTA_STATUS_LABEL[proposta.status] ?? proposta.status}
                    </Badge>
                  </span>
                  <span className="block truncate text-13 text-muted">
                    {proposta.viewCount > 0
                      ? `${proposta.viewCount} ${
                          proposta.viewCount === 1 ? "abertura" : "aberturas"
                        }${
                          proposta.lastViewedAt
                            ? ` · última ${formatRelativeShort(new Date(proposta.lastViewedAt))}`
                            : ""
                        }`
                      : proposta.sentAt
                        ? `Enviada ${formatDayMonth(new Date(proposta.sentAt))} · sem abertura`
                        : `de ${proposta.dealTitle}`}
                  </span>
                </span>
                <ChevronRightIcon className="size-4 shrink-0 text-subtle" />
              </Link>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function RoteirosCard({ roteiros }: { roteiros: RoteiroDoContato[] | null }) {
  if (!roteiros || roteiros.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roteiros</CardTitle>
        <span data-numeric className="text-13 tabular-nums text-muted">
          {roteiros.length}
        </span>
      </CardHeader>
      <CardBody flush>
        <ul className="flex flex-col divide-y divide-line-subtle">
          {roteiros.map((roteiro) => (
            <RoteiroRow key={roteiro.id} roteiro={roteiro} />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/** O roteiro é o link que o cliente já recebeu — abrir é conferir o que ele
 * vê; copiar é reenviar. Ação fora do link (irmã, não filha). */
function RoteiroRow({ roteiro }: { roteiro: RoteiroDoContato }) {
  const toast = useToast();
  const [copiado, setCopiado] = React.useState(false);

  async function copiarLink() {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/r/${roteiro.publicToken}`,
      );
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
      toast.show({ title: "Link copiado", tone: "ok" });
    } catch {
      toast.show({
        title: "Não consegui copiar",
        description: "Abra o roteiro e copie o link na mão.",
        tone: "danger",
      });
    }
  }

  const datas = roteiro.departureOn
    ? formatarFaixaDeDatas(roteiro.departureOn, roteiro.returnOn)
    : null;

  return (
    <li className="flex items-center gap-1 pr-2">
      <a
        href={`/r/${roteiro.publicToken}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-3 hover:bg-surface-2"
      >
        <span className="truncate text-15 font-medium text-ink">{roteiro.title}</span>
        <span className="truncate text-13 text-muted">
          {datas ?? "Roteiro público"} · o que o cliente vê
        </span>
      </a>
      <Button
        size="sm"
        variant="quiet"
        iconOnly
        aria-label={`Copiar link do roteiro ${roteiro.title}`}
        onPointerDown={() => void copiarLink()}
      >
        {copiado ? (
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m3.5 8.5 3 3 6-7" />
          </svg>
        ) : (
          <CopyIcon className="size-3.5" />
        )}
      </Button>
    </li>
  );
}

/* =============================================================================
   Dados
   ========================================================================== */

/* -----------------------------------------------------------------------------
   TipoDeClienteField — pessoa física ou empresa (Fase 4a)
   -------------------------------------------------------------------------
   O TIPO decide a régua do resto da ficha: rótulo do nome (Nome × Razão
   social), documento (CPF × CNPJ) e se nasce nascimento. Commit no change
   (select não tem blur útil), mesmo contrato do VendedorField da ficha de
   negócio: o erro do servidor devolve o select, o retorno reconcilia o pai.
   ------------------------------------------------------------------------- */

function TipoDeClienteField({
  contact,
  contatoId,
  onPatched,
}: {
  contact: ContatoDetalhe;
  contatoId: string;
  onPatched: (patch: Partial<ContatoDetalhe>) => void;
}) {
  const [valor, setValor] = React.useState(contact.personType);
  const [state, setState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [erro, setErro] = React.useState<{ mensagem: string; correcao?: string } | null>(null);

  async function salvar(proximo: "fisica" | "juridica") {
    const anterior = valor;
    setValor(proximo);
    setState("saving");
    setErro(null);
    const result = await atualizarContato(contatoId, { personType: proximo });
    if (!result.ok) {
      setValor(anterior);
      setState("error");
      setErro({ mensagem: result.mensagem, correcao: result.correcao });
      return;
    }
    setState("saved");
    onPatched({ personType: result.data.personType });
  }

  return (
    <Field invalid={state === "error"} className="mb-4">
      <div className="flex items-baseline justify-between gap-2">
        <Label>Tipo de cliente</Label>
        <SavedMark state={state} />
      </div>
      <Select
        value={valor}
        onValueChange={(proximo) => void salvar(proximo as "fisica" | "juridica")}
      >
        <SelectTrigger aria-invalid={state === "error" || undefined} aria-label="Tipo de cliente">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="fisica">Pessoa física</SelectItem>
          <SelectItem value="juridica">Empresa (PJ)</SelectItem>
        </SelectContent>
      </Select>
      {state === "error" && erro ? (
        <FieldError
          action={
            <button
              type="button"
              className="font-medium text-danger underline underline-offset-2"
              onClick={() => void salvar(valor)}
            >
              Tentar de novo
            </button>
          }
        >
          {erro.mensagem}
        </FieldError>
      ) : null}
    </Field>
  );
}

function DadosCard({
  contact,
  contatoId,
  onPatched,
}: {
  contact: ContatoDetalhe;
  contatoId: string;
  onPatched: (patch: Partial<ContatoDetalhe>) => void;
}) {
  const isPJ = contact.personType === "juridica";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dados</CardTitle>
      </CardHeader>
      <CardBody>
        <TipoDeClienteField
          contact={contact}
          contatoId={contatoId}
          onPatched={onPatched}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextAutoField
            label={isPJ ? "Razão social" : "Nome"}
            initialValue={contact.name}
            onSave={async (value) => {
              const result = await atualizarContato(contatoId, { name: value });
              if (result.ok) onPatched({ name: value });
              return result;
            }}
          />
          <TextAutoField
            label="WhatsApp"
            optional
            initialValue={contact.whatsapp ?? ""}
            inputMode="tel"
            onSave={async (value) => {
              const result = await atualizarContato(contatoId, { whatsapp: value });
              if (result.ok) onPatched({ whatsapp: value || null });
              return result;
            }}
          />
          <TextAutoField
            label="Telefone"
            optional
            initialValue={contact.phone ?? ""}
            inputMode="tel"
            onSave={async (value) => {
              const result = await atualizarContato(contatoId, { phone: value });
              if (result.ok) onPatched({ phone: value || null });
              return result;
            }}
          />
          <TextAutoField
            label="E-mail"
            optional
            type="email"
            initialValue={contact.email ?? ""}
            onSave={async (value) => {
              const result = await atualizarContato(contatoId, { email: value });
              if (result.ok) onPatched({ email: value || null });
              return result;
            }}
          />
        </div>

        <SourceAutoField contatoId={contatoId} contact={contact} onPatched={onPatched} />
        <TagsAutoField contatoId={contatoId} contact={contact} onPatched={onPatched} />

        <NotesAutoField contatoId={contatoId} contact={contact} onPatched={onPatched} />
      </CardBody>
    </Card>
  );
}

/** Campo de texto com salvamento automático no blur — usado por Dados e Documento. */
function TextAutoField({
  label,
  optional,
  initialValue,
  placeholder,
  type = "text",
  inputMode,
  onSave,
}: {
  label: string;
  optional?: boolean;
  initialValue: string;
  placeholder?: string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  onSave: (value: string) => Promise<ServiceResult<unknown>>;
}) {
  const [value, setValue] = React.useState(initialValue);
  const savedRef = React.useRef(initialValue);
  const { state, error, commit } = useAutosave(onSave);

  function handleBlur() {
    if (value === savedRef.current) return;
    savedRef.current = value;
    void commit(value);
  }

  return (
    <Field invalid={state === "error"}>
      <div className="flex items-baseline justify-between gap-2">
        <Label optional={optional}>{label}</Label>
        <SavedMark state={state} />
      </div>
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        type={type}
        inputMode={inputMode}
        aria-invalid={state === "error" || undefined}
      />
      {state === "error" ? (
        <FieldError
          action={
            <button
              type="button"
              className="font-medium text-danger underline underline-offset-2"
              onClick={() => void commit(value)}
            >
              Tentar de novo
            </button>
          }
        >
          {error}
        </FieldError>
      ) : null}
    </Field>
  );
}

function SourceAutoField({
  contatoId,
  contact,
  onPatched,
}: {
  contatoId: string;
  contact: ContatoDetalhe;
  onPatched: (patch: Partial<ContatoDetalhe>) => void;
}) {
  const { state, commit } = useAutosave(async (value: string) => {
    const source = value as
      | "whatsapp"
      | "instagram"
      | "indicacao"
      | "site"
      | "evento"
      | "outro";
    const result = await atualizarContato(contatoId, { source });
    if (result.ok) onPatched({ source });
    return result;
  });

  return (
    <Field className="mt-4">
      <div className="flex items-baseline justify-between gap-2">
        <Label optional>Como chegou até você</Label>
        <SavedMark state={state} />
      </div>
      <Select
        value={contact.source ?? undefined}
        onValueChange={(value) => void commit(value)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Não informado">
            {contact.source ? SOURCE_LABELS[contact.source] : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SOURCE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function TagsAutoField({
  contatoId,
  contact,
  onPatched,
}: {
  contatoId: string;
  contact: ContatoDetalhe;
  onPatched: (patch: Partial<ContatoDetalhe>) => void;
}) {
  const [draft, setDraft] = React.useState("");
  const { state, commit } = useAutosave(async (tags: string[]) => {
    const result = await atualizarContato(contatoId, { tags });
    if (result.ok) onPatched({ tags });
    return result;
  });

  function addTag() {
    const tag = draft.trim();
    if (!tag || contact.tags.includes(tag)) {
      setDraft("");
      return;
    }
    setDraft("");
    void commit([...contact.tags, tag]);
  }

  function removeTag(tag: string) {
    void commit(contact.tags.filter((t) => t !== tag));
  }

  return (
    <Field className="mt-4">
      <div className="flex items-baseline justify-between gap-2">
        <Label optional>Etiquetas</Label>
        <SavedMark state={state} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {contact.tags.map((tag) => (
          <Badge key={tag} tone="neutral" className="gap-1 pr-1">
            {tag}
            <button
              type="button"
              aria-label={`Remover etiqueta ${tag}`}
              onClick={() => removeTag(tag)}
              className="grid size-3.5 place-items-center rounded-pill text-muted hover:bg-surface-2 hover:text-ink"
            >
              <svg viewBox="0 0 16 16" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
              </svg>
            </button>
          </Badge>
        ))}
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addTag();
            }
          }}
          onBlur={addTag}
          placeholder="lua de mel, corporativo…"
          size="sm"
          className="w-40 flex-1"
        />
      </div>
    </Field>
  );
}

function NotesAutoField({
  contatoId,
  contact,
  onPatched,
}: {
  contatoId: string;
  contact: ContatoDetalhe;
  onPatched: (patch: Partial<ContatoDetalhe>) => void;
}) {
  const [value, setValue] = React.useState(contact.notes ?? "");
  const { state, commit, schedule } = useAutosave(
    async (notes: string) => {
      const result = await atualizarContato(contatoId, { notes });
      if (result.ok) onPatched({ notes: notes || null });
      return result;
    },
    { debounceMs: 900 },
  );

  return (
    <Field className="mt-4">
      <div className="flex items-baseline justify-between gap-2">
        <Label optional>Observações</Label>
        <SavedMark state={state} />
      </div>
      <Textarea
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          schedule(event.target.value);
        }}
        onBlur={() => void commit(value)}
        placeholder="Preferências, restrições, o que lembrar antes de ligar…"
      />
    </Field>
  );
}

/* =============================================================================
   Documento — PII com cuidado
   ========================================================================== */

function DocumentoCard({
  contact,
  contatoId,
  onPatched,
}: {
  contact: ContatoDetalhe;
  contatoId: string;
  onPatched: (patch: Partial<ContatoDetalhe>) => void;
}) {
  const [revealed, setRevealed] = React.useState<{ cpf: string; nascimento: string } | null>(null);
  const [revealing, setRevealing] = React.useState(false);
  const [revealError, setRevealError] = React.useState<string | null>(null);

  // Fase 4a — a empresa tem CNPJ e não tem nascimento: o campo nem nasce para PJ.
  const isPJ = contact.personType === "juridica";
  const documentoRotulo = isPJ ? "CNPJ" : "CPF";
  const documentoPlaceholder = isPJ ? "00.000.000/0000-00" : "000.000.000-00";

  const hasSomething = contact.temDocumento || (!isPJ && contact.aniversario !== null);

  async function reveal() {
    setRevealing(true);
    setRevealError(null);
    const result = await obterDocumentoDoContato(contatoId);
    setRevealing(false);
    if (!result.ok) {
      setRevealError(result.mensagem);
      return;
    }
    setRevealed({
      cpf: result.data.cpf ?? "",
      nascimento: result.data.nascimento ? result.data.nascimento.slice(0, 10) : "",
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isPJ ? "CNPJ" : "Documento e nascimento"}</CardTitle>
      </CardHeader>
      <CardBody>
        <p className="text-13 text-muted">
          {isPJ
            ? "O CNPJ fica cifrado. Abrir aqui grava quem viu, no registro de auditoria — é por isso que a tela não mostra de cara."
            : "CPF e data de nascimento ficam cifrados. Abrir aqui grava quem viu, no registro de auditoria — é por isso que a tela não mostra os dois de cara."}
        </p>

        {revealError ? (
          <FieldError
            action={
              <button
                type="button"
                className="font-medium text-danger underline underline-offset-2"
                onClick={() => void reveal()}
              >
                Tentar de novo
              </button>
            }
          >
            {revealError}
          </FieldError>
        ) : null}

        {revealed ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextAutoField
              label={documentoRotulo}
              optional
              initialValue={revealed.cpf}
              inputMode="numeric"
              placeholder={documentoPlaceholder}
              onSave={async (value) => {
                const result = await atualizarContato(contatoId, { document: value });
                if (result.ok) onPatched({ temDocumento: value.trim().length > 0 });
                return result;
              }}
            />
            {isPJ ? null : (
              <BirthDateAutoField
                initialValue={revealed.nascimento}
                onSave={async (value) => {
                  const result = await atualizarContato(contatoId, { birthDate: value });
                  if (result.ok) {
                    onPatched({
                      aniversario: value ? isoToMonthDay(value) : null,
                    });
                  }
                  return result;
                }}
              />
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="flex items-center gap-1.5 text-15 text-ink">
              {contact.temDocumento
                ? `${documentoRotulo} cadastrado`
                : `${documentoRotulo} não cadastrado`}
            </span>
            {isPJ ? null : (
              <span className="flex items-center gap-1.5 text-15 text-ink">
                {contact.aniversario ? (
                  <>
                    <CakeIcon className="size-4 text-muted" />
                    Aniversário: {formatMonthDay(contact.aniversario)}
                  </>
                ) : (
                  "Nascimento não informado"
                )}
              </span>
            )}
            <Button
              variant="secondary"
              size="sm"
              loading={revealing}
              onClick={() => void reveal()}
            >
              <EyeIcon className="size-4" />
              {hasSomething ? "Ver e editar" : "Adicionar"}
            </Button>
          </div>
        )}

        {revealed ? (
          <button
            type="button"
            onClick={() => setRevealed(null)}
            className="flex w-fit items-center gap-1.5 text-13 font-medium text-muted hover:text-ink"
          >
            <EyeOffIcon className="size-3.5" />
            Ocultar
          </button>
        ) : null}
      </CardBody>
    </Card>
  );
}

function BirthDateAutoField({
  initialValue,
  onSave,
}: {
  initialValue: string;
  onSave: (value: string) => Promise<ServiceResult<unknown>>;
}) {
  const [value, setValue] = React.useState(initialValue);
  const savedRef = React.useRef(initialValue);
  const { state, error, commit } = useAutosave(onSave);

  function handleBlur() {
    if (value === savedRef.current) return;
    savedRef.current = value;
    void commit(value);
  }

  return (
    <Field invalid={state === "error"}>
      <div className="flex items-baseline justify-between gap-2">
        <Label optional>Nascimento</Label>
        <SavedMark state={state} />
      </div>
      <Input
        type="date"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={handleBlur}
      />
      {state === "error" ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

function isoToMonthDay(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[2]}-${match[3]}` : null;
}

/* =============================================================================
   Passageiros
   ========================================================================== */

function PassageirosCard({ contatoId }: { contatoId: string }) {
  const toast = useToast();
  const [status, setStatus] = React.useState<Status>("loading");
  const [travelers, setTravelers] = React.useState<ViajanteResumo[]>([]);
  const [sheetOpen, setSheetOpen] = React.useState(false);

  const [reloadToken, setReloadToken] = React.useState(0);
  const reload = React.useCallback(() => setReloadToken((token) => token + 1), []);

  React.useEffect(() => {
    let active = true;
    void listarViajantes({ contatoId }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        return;
      }
      setTravelers(result.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [contatoId, reloadToken]);

  const scheduleDelete = useDeferredDelete<ViajanteResumo>({
    label: (item) => `Passageiro removido: ${item.fullName}`,
    commit: (item) => excluirViajante(item.id),
    onFailure: (item, mensagem) => {
      toast.show({ title: `Não consegui remover ${item.fullName}`, description: mensagem, tone: "danger" });
      reload();
    },
  });

  function handleRemove(traveler: ViajanteResumo) {
    setTravelers((current) => current.filter((t) => t.id !== traveler.id));
    scheduleDelete(traveler);
  }

  function handleUpdated(updated: ViajanteResumo) {
    setTravelers((current) => current.map((t) => (t.id === updated.id ? updated : t)));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Passageiros</CardTitle>
      </CardHeader>
      <CardBody flush={status !== "ready" || travelers.length === 0}>
        {status === "loading" ? (
          <div className="flex flex-col gap-4 p-4">
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : status === "error" ? (
          <div className="flex flex-col items-start gap-3 p-4">
            <FieldError>Não consegui carregar os passageiros.</FieldError>
            <Button variant="secondary" size="sm" onClick={reload}>
              Tentar de novo
            </Button>
          </div>
        ) : travelers.length === 0 ? (
          <EmptyState
            compact
            title="Nenhum passageiro ainda"
            description="Quem viaja sozinho é passageiro de si mesmo — cadastre ao menos um, mesmo que seja o próprio cliente."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line-subtle">
            {travelers.map((traveler) => (
              <TravelerRow
                key={traveler.id}
                traveler={traveler}
                onUpdated={handleUpdated}
                onRemoved={() => handleRemove(traveler)}
              />
            ))}
          </ul>
        )}
      </CardBody>
      <CardFooter
        action={
          <Button variant="secondary" size="sm" onClick={() => setSheetOpen(true)}>
            <PlusIcon className="size-4" />
            Adicionar passageiro
          </Button>
        }
      />

      <NovoPassageiroForm
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        contatoId={contatoId}
        onCreated={(traveler) => {
          setTravelers((current) => [traveler, ...current]);
          setSheetOpen(false);
        }}
      />
    </Card>
  );
}

function TravelerRow({
  traveler,
  onUpdated,
  onRemoved,
}: {
  traveler: ViajanteResumo;
  onUpdated: (traveler: ViajanteResumo) => void;
  onRemoved: () => void;
}) {
  const [revealed, setRevealed] = React.useState<{
    cpf: string;
    passaporte: string;
    nascimento: string;
  } | null>(null);
  const [revealing, setRevealing] = React.useState(false);
  const [revealError, setRevealError] = React.useState<string | null>(null);

  async function reveal() {
    setRevealing(true);
    setRevealError(null);
    const result = await obterDocumentoDoViajante(traveler.id);
    setRevealing(false);
    if (!result.ok) {
      setRevealError(result.mensagem);
      return;
    }
    setRevealed({
      cpf: result.data.cpf ?? "",
      passaporte: result.data.passaporte ?? "",
      nascimento: result.data.nascimento ? result.data.nascimento.slice(0, 10) : "",
    });
  }

  const passportDays = traveler.passportExpiresOn
    ? daysUntilIso(traveler.passportExpiresOn)
    : null;
  const birthdayDays = traveler.aniversario
    ? daysUntilMonthDay(traveler.aniversario)
    : null;

  return (
    <li className="flex flex-col gap-3 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
          <TextAutoField
            label="Nome"
            initialValue={traveler.fullName}
            onSave={async (value) => {
              const result = await atualizarViajante(traveler.id, { fullName: value });
              if (result.ok) onUpdated({ ...traveler, fullName: value });
              return result;
            }}
          />
          <KindAutoField traveler={traveler} onUpdated={onUpdated} />
        </div>
        <CardAction className="text-danger hover:text-danger" onClick={onRemoved}>
          Remover
        </CardAction>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <PassportAutoField traveler={traveler} onUpdated={onUpdated} />
        <div className="flex flex-col justify-end gap-1.5 pb-1.5">
          {passportDays !== null ? (
            <Badge tone={passportTone(passportDays)} dot>
              <PassportIcon className="size-3" />
              Passaporte {passportLabel(passportDays)}
            </Badge>
          ) : null}
          {birthdayDays !== null && birthdayDays <= 30 ? (
            <Badge tone="neutral" dot>
              <CakeIcon className="size-3" />
              Aniversário {formatMonthDay(traveler.aniversario!)}
            </Badge>
          ) : null}
        </div>
      </div>

      {revealError ? <FieldError>{revealError}</FieldError> : null}

      {revealed ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <TextAutoField
            label="CPF"
            optional
            initialValue={revealed.cpf}
            inputMode="numeric"
            onSave={async (value) => {
              const result = await atualizarViajante(traveler.id, { cpf: value });
              if (result.ok) onUpdated({ ...traveler, temCpf: value.trim().length > 0 });
              return result;
            }}
          />
          <TextAutoField
            label="Nº do passaporte"
            optional
            initialValue={revealed.passaporte}
            onSave={async (value) => {
              const result = await atualizarViajante(traveler.id, { passportNumber: value });
              if (result.ok) onUpdated({ ...traveler, temPassaporte: value.trim().length > 0 });
              return result;
            }}
          />
          <BirthDateAutoField
            initialValue={revealed.nascimento}
            onSave={async (value) => {
              const result = await atualizarViajante(traveler.id, { birthDate: value });
              if (result.ok) {
                onUpdated({
                  ...traveler,
                  aniversario: value ? isoToMonthDay(value) : null,
                });
              }
              return result;
            }}
          />
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => (revealed ? setRevealed(null) : void reveal())}
        className="flex w-fit items-center gap-1.5 text-13 font-medium text-muted hover:text-ink"
      >
        {revealed ? (
          <>
            <EyeOffIcon className="size-3.5" />
            Ocultar CPF e passaporte
          </>
        ) : (
          <>
            {revealing ? null : <EyeIcon className="size-3.5" />}
            {revealing ? "Abrindo…" : "Ver CPF, passaporte e nascimento"}
          </>
        )}
      </button>
    </li>
  );
}

function KindAutoField({
  traveler,
  onUpdated,
}: {
  traveler: ViajanteResumo;
  onUpdated: (traveler: ViajanteResumo) => void;
}) {
  const { state, commit } = useAutosave(async (kind: string) => {
    const value = kind as "adult" | "child" | "infant";
    const result = await atualizarViajante(traveler.id, { kind: value });
    if (result.ok) onUpdated({ ...traveler, kind: value });
    return result;
  });

  return (
    <Field>
      <div className="flex items-baseline justify-between gap-2">
        <Label>Tipo</Label>
        <SavedMark state={state} />
      </div>
      <Select value={traveler.kind} onValueChange={(value) => void commit(value)}>
        <SelectTrigger size="sm">
          <SelectValue>{TRAVELER_KIND_LABELS[traveler.kind]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {TRAVELER_KIND_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function PassportAutoField({
  traveler,
  onUpdated,
}: {
  traveler: ViajanteResumo;
  onUpdated: (traveler: ViajanteResumo) => void;
}) {
  const [value, setValue] = React.useState(traveler.passportExpiresOn ?? "");
  const savedRef = React.useRef(traveler.passportExpiresOn ?? "");
  const { state, commit } = useAutosave(async (next: string) => {
    const result = await atualizarViajante(traveler.id, { passportExpiresOn: next });
    if (result.ok) onUpdated({ ...traveler, passportExpiresOn: next || null });
    return result;
  });

  return (
    <Field>
      <div className="flex items-baseline justify-between gap-2">
        <Label optional>Validade do passaporte</Label>
        <SavedMark state={state} />
      </div>
      <Input
        type="date"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (value === savedRef.current) return;
          savedRef.current = value;
          void commit(value);
        }}
      />
    </Field>
  );
}

function NovoPassageiroForm({
  open,
  onOpenChange,
  contatoId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contatoId: string;
  onCreated: (traveler: ViajanteResumo) => void;
}) {
  const [fullName, setFullName] = React.useState("");
  const [kind, setKind] = React.useState<ViajanteInput["kind"]>("adult");
  const [nationality, setNationality] = React.useState("BR");
  const [cpf, setCpf] = React.useState("");
  const [passportNumber, setPassportNumber] = React.useState("");
  const [passportExpiresOn, setPassportExpiresOn] = React.useState("");
  const [birthDate, setBirthDate] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<{ campo?: string; mensagem: string } | null>(null);

  function reset() {
    setFullName("");
    setKind("adult");
    setNationality("BR");
    setCpf("");
    setPassportNumber("");
    setPassportExpiresOn("");
    setBirthDate("");
    setFieldError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setCreating(true);
    setFieldError(null);
    const result = await criarViajante({
      contactId: contatoId,
      fullName,
      kind,
      nationality,
      cpf,
      passportNumber,
      passportExpiresOn,
      birthDate,
    });
    setCreating(false);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      setFieldError({ campo: result.campo, mensagem: result.mensagem });
      return;
    }
    onCreated(result.data);
    reset();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        open={open}
        onOpenChange={onOpenChange}
        title="Novo passageiro"
        description="Só o nome é obrigatório."
        footer={
          <Button
            variant="primary"
            block
            type="submit"
            form="novo-passageiro-form"
            loading={creating}
            disabled={fullName.trim().length < 2}
          >
            Adicionar
          </Button>
        }
      >
        <form id="novo-passageiro-form" onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <Field invalid={fieldError?.campo === "fullName"}>
            <Label>Nome completo</Label>
            <Input
              autoFocus
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Como está no documento de viagem"
            />
            {fieldError?.campo === "fullName" ? <FieldError>{fieldError.mensagem}</FieldError> : null}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label>Tipo</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as ViajanteInput["kind"])}>
                <SelectTrigger>
                  <SelectValue>{TRAVELER_KIND_LABELS[kind ?? "adult"]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TRAVELER_KIND_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field invalid={fieldError?.campo === "nationality"}>
              <Label>Nacionalidade</Label>
              <Input
                value={nationality}
                onChange={(event) => setNationality(event.target.value.toUpperCase().slice(0, 2))}
                placeholder="BR"
                aria-invalid={fieldError?.campo === "nationality" || undefined}
              />
              {fieldError?.campo === "nationality" ? (
                <FieldError>{fieldError.mensagem}</FieldError>
              ) : null}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field invalid={fieldError?.campo === "cpf"}>
              <Label optional>CPF</Label>
              <Input
                value={cpf}
                onChange={(event) => setCpf(event.target.value)}
                inputMode="numeric"
                placeholder="000.000.000-00"
              />
              {fieldError?.campo === "cpf" ? <FieldError>{fieldError.mensagem}</FieldError> : null}
            </Field>
            <Field>
              <Label optional>Nascimento</Label>
              <Input type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label optional>Nº do passaporte</Label>
              <Input
                value={passportNumber}
                onChange={(event) => setPassportNumber(event.target.value)}
              />
            </Field>
            <Field>
              <Label optional>Validade</Label>
              <Input
                type="date"
                value={passportExpiresOn}
                onChange={(event) => setPassportExpiresOn(event.target.value)}
              />
            </Field>
          </div>

          {fieldError && !fieldError.campo ? <FieldError>{fieldError.mensagem}</FieldError> : null}
        </form>
      </SheetContent>
    </Sheet>
  );
}

/* =============================================================================
   Lembretes — consome alerts.ts
   ========================================================================== */

function LembretesCard({ contatoId }: { contatoId: string }) {
  const toast = useToast();
  const [status, setStatus] = React.useState<Status>("loading");
  const [tasks, setTasks] = React.useState<TarefaResumo[]>([]);

  const [reloadToken, setReloadToken] = React.useState(0);
  const reload = React.useCallback(() => setReloadToken((token) => token + 1), []);

  React.useEffect(() => {
    let active = true;
    void listarTarefas({ contatoId }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        return;
      }
      setTasks(result.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [contatoId, reloadToken]);

  const scheduleComplete = useDeferredDelete<TarefaResumo>({
    label: (task) => `Concluído: ${task.title}`,
    commit: (task) => concluirTarefa(task.id),
    onFailure: (task, mensagem) => {
      toast.show({ title: "Não consegui concluir", description: mensagem, tone: "danger" });
      reload();
    },
  });

  function handleComplete(task: TarefaResumo) {
    setTasks((current) => current.filter((t) => t.id !== task.id));
    scheduleComplete(task);
  }

  if (status === "loading") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Lembretes</CardTitle>
        </CardHeader>
        <CardBody flush>
          <div className="flex flex-col gap-3 p-4">
            <SkeletonRow />
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lembretes</CardTitle>
      </CardHeader>
      <CardBody flush={status !== "ready" || tasks.length === 0}>
        {status === "error" ? (
          <div className="flex flex-col items-start gap-3 p-4">
            <FieldError>Não consegui carregar os lembretes.</FieldError>
            <Button variant="secondary" size="sm" onClick={reload}>
              Tentar de novo
            </Button>
          </div>
        ) : tasks.length === 0 ? (
          <EmptyState
            compact
            title="Nenhum lembrete pendente"
            description="Passaporte vencendo e aniversário viram lembrete aqui sozinhos, um dia antes de precisar agir."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line-subtle">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-start gap-3 px-4 py-3">
                <Checkbox
                  className="mt-0.5"
                  onCheckedChange={(checked) => {
                    if (checked === true) handleComplete(task);
                  }}
                  aria-label={`Concluir: ${task.title}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-15 font-medium text-ink">{task.title}</p>
                  {task.notes ? <p className="mt-0.5 text-13 text-muted">{task.notes}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

/* =============================================================================
   Encerramento — arquivar/restaurar (com desfazer de verdade) e excluir
   (destrutivo, sem endpoint de restauração — ver useDeferredDelete)
   ========================================================================== */

function EncerramentoCard({
  contact,
  onPatched,
}: {
  contact: ContatoDetalhe;
  onPatched: (patch: Partial<ContatoDetalhe>) => void;
}) {
  const router = useRouter();
  const toast = useToast();

  async function handleArchive() {
    const result = await arquivarContato(contact.id);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      toast.show({ title: "Não consegui arquivar", description: result.mensagem, tone: "danger" });
      return;
    }
    onPatched({ arquivado: true });
    toast.undo(`Cliente arquivado: ${contact.name}`, () => {
      void restaurarContato(contact.id).then(() => onPatched({ arquivado: false }));
    });
  }

  async function handleRestore() {
    const result = await restaurarContato(contact.id);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      toast.show({ title: "Não consegui restaurar", description: result.mensagem, tone: "danger" });
      return;
    }
    onPatched({ arquivado: false });
    toast.show({ title: `Cliente restaurado: ${contact.name}`, tone: "ok" });
  }

  const scheduleDelete = useDeferredDelete<{ id: string; name: string }>({
    label: (item) => `Cliente excluído: ${item.name}`,
    commit: (item) => excluirContato(item.id),
    onFailure: (item, mensagem, correcao) => {
      toast.show({
        title: `Não consegui excluir ${item.name}`,
        description: mensagem,
        tone: "danger",
        action: correcao
          ? { label: correcao, onClick: () => void arquivarContato(item.id) }
          : undefined,
      });
    },
  });

  function handleDeleteForever() {
    scheduleDelete({ id: contact.id, name: contact.name });
    router.push("/clientes");
  }

  return (
    <Card tone="inset">
      <CardHeader>
        <CardTitle>Encerramento</CardTitle>
      </CardHeader>
      <CardBody flush>
        <p className="px-4 pt-4 text-13 text-muted">
          Arquivar tira o cliente das listas sem apagar nada — dá para restaurar a qualquer
          hora. Excluir apaga os dados de verdade; depois dos 8 segundos do aviso, não tem
          volta.
        </p>
      </CardBody>
      <CardFooter
        secondary={
          <CardAction className="text-danger hover:text-danger" onClick={handleDeleteForever}>
            Excluir definitivamente
          </CardAction>
        }
        action={
          contact.arquivado ? (
            <Button variant="secondary" onClick={() => void handleRestore()}>
              Restaurar cliente
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => void handleArchive()}>
              Arquivar cliente
            </Button>
          )
        }
      />
    </Card>
  );
}

/* -----------------------------------------------------------------------------
   FaturasCard — o faturamento consolidado da empresa (Fase 4b)
   -------------------------------------------------------------------------
   O fluxo do §7 do plano, na ficha da empresa: consolidar o mês (as parcelas
   PENDENTES do período viram UMA fatura), emitir o boleto (Asaas sandbox em
   dev) e ler a baixa automática — o webhook paga a fatura e as parcelas.
   Lista primeiro, consolidação no rodapé: o histórico é o que mais se lê.
   ------------------------------------------------------------------------- */

function FaturasCard({ contatoId }: { contatoId: string }) {
  const toast = useToast();
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [faturas, setFaturas] = React.useState<FaturaDoCliente[]>([]);
  const [erro, setErro] = React.useState<{ mensagem: string; correcao?: string } | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);

  // Consolidação — período default: o mês corrente UTC (o mês que a agente quer
  // é quase sempre "este").
  const hoje = new Date().toISOString().slice(0, 10);
  const [de, setDe] = React.useState(`${hoje.slice(0, 7)}-01`);
  const [ate, setAte] = React.useState(hoje);
  const [consolidando, setConsolidando] = React.useState(false);
  const [emitindoId, setEmitindoId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    void listarFaturasDoCliente({ contactId: contatoId }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setErro({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setFaturas(result.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [contatoId, reloadToken]);

  async function consolidar() {
    setConsolidando(true);
    setErro(null);
    const result = await criarFatura({ contactId: contatoId, de, ate });
    setConsolidando(false);
    if (!result.ok) {
      setErro({ mensagem: result.mensagem, correcao: result.correcao });
      return;
    }
    setFaturas((atual) => [result.data, ...atual]);
    toast.show({ title: `Fatura consolidada: ${result.data.totalParcelas} parcela(s)`, tone: "ok" });
  }

  async function emitirBoleto(fatura: FaturaDoCliente) {
    setEmitindoId(fatura.id);
    setErro(null);
    const result = await emitirBoletoDaFatura({ faturaId: fatura.id });
    setEmitindoId(null);
    if (!result.ok) {
      setErro({ mensagem: result.mensagem, correcao: result.correcao });
      return;
    }
    setFaturas((atual) => atual.map((f) => (f.id === fatura.id ? result.data : f)));
    if (result.data.boletoUrl) {
      window.open(result.data.boletoUrl, "_blank", "noopener");
    }
  }

  if (status === "loading") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Faturas</CardTitle>
        </CardHeader>
        <CardBody>
          <SkeletonRow />
        </CardBody>
      </Card>
    );
  }
  if (status === "error") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Faturas</CardTitle>
        </CardHeader>
        <CardBody>
          <FieldError>{erro?.mensagem ?? "Não consegui carregar as faturas."}</FieldError>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Faturas</CardTitle>
      </CardHeader>
      <CardBody>
        {faturas.length === 0 ? (
          <p className="text-15 text-muted">
            Nenhuma fatura ainda. Consolide as parcelas pendentes de um período abaixo —
            a fatura vira um boleto para mandar para a empresa.
          </p>
        ) : (
          <ul>
            {faturas.map((fatura) => (
              <li key={fatura.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
                <span className="min-w-0 flex-1 text-15 text-ink">
                  {fatura.periodoDe.slice(0, 7)} · {fatura.totalParcelas} parcela(s)
                </span>
                <Money cents={fatura.valorCents} size="15" />
                {fatura.status === "paga" ? (
                  <Badge tone="ok">Paga</Badge>
                ) : fatura.boletoEmitido ? (
                  <Badge tone="neutral">Boleto emitido</Badge>
                ) : null}
                {fatura.status === "aberta" && !fatura.boletoEmitido ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={emitindoId === fatura.id}
                    onClick={() => void emitirBoleto(fatura)}
                  >
                    Emitir boleto
                  </Button>
                ) : null}
                {fatura.boletoUrl ? (
                  <a
                    href={fatura.boletoUrl}
                    target="_blank"
                    rel="noopener"
                    className="min-h-9 text-13 font-medium text-accent underline underline-offset-2"
                  >
                    Ver boleto
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {erro ? (
          <div className="mt-2">
            <FieldError>{erro.mensagem}</FieldError>
            {erro.correcao ? <p className="text-13 text-muted">{erro.correcao}</p> : null}
          </div>
        ) : null}
      </CardBody>
      <CardFooter>
        <div className="flex w-full flex-wrap items-end gap-2">
          <Field className="flex-1">
            <Label>De</Label>
            <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          </Field>
          <Field className="flex-1">
            <Label>Até</Label>
            <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </Field>
          <Button variant="secondary" size="sm" loading={consolidando} onClick={() => void consolidar()}>
            Consolidar período
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
