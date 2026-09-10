"use client";

import * as React from "react";
import Link from "next/link";
import {
  alterarAssentos,
  listarEquipe,
  obterTenantAtual,
  type EquipeResumo,
  type PapelDoMembro,
} from "@/server";
import {
  cancelarConvite,
  convidarMembro,
  mudarPapelDoMembro,
  removerMembro,
  type RecusaDeEquipe,
} from "@/lib/ui/equipeApi";
import { avisarRecusaDeEscrita } from "@/lib/ui/assinatura";
import { cn } from "@/lib/ui/cn";
import {
  daysBetween,
  formatDayMonth,
  formatRelativeDays,
} from "@/lib/ui/format";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardAction,
  CardBody,
  CardFooter,
  CardHeader,
  CardTitle,
  SectionHeading,
} from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldError, FieldHint, Label } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Monogram } from "@/components/ui/Monogram";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Skeleton, SkeletonRow, SkeletonText } from "@/components/ui/Skeleton";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";

/* =============================================================================
   Equipe — gente, papel e assento (Fase 3, §13 do handoff do Rafa)
   -----------------------------------------------------------------------------
   Registro silencioso do miolo, à risca: lista em papel, fio como cornija,
   UMA cor de destaque (o "Convidar" e o "Aplicar" de assentos). Nenhuma
   prancha — a Equipe abre quinze vezes por dia quando existe, e nunca quando
   não existe.

   Três leituras de contrato que moldaram a tela:

   1. Papel é o NATIVO do plugin ('owner'/'admin'/'member'); "Dono(a)" e
      "Agente" são RÓTULO daqui de dentro — o banco recusa 'agente' (§13.1).

   2. Escrita da equipe NÃO é ServiceResult: é o formato better-auth
      `{ error: { message, status } }`, traduzido em `src/lib/ui/equipeApi.ts`
      para o par mensagem + correção da casa (§13.2). `alterarAssentos` é a
      exceção — É ServiceResult, e passa pelo `avisarRecusaDeEscrita` como
      toda escrita.

   3. O servidor é a verdade em toda recusa: os controles somem pelo que
      `listarEquipe()` diz (dono = o membro cujo `userId` é o
      `solicitanteUserId` com papel 'owner'), nunca por um palpite de papel do
      cliente. Em si mesmo não há ação nenhuma — demitir-se não é tarefa de
      tela (§13.1).

   Monograma em vez de avatar colorido (§8 do doc): contorno em currentColor,
   nunca preenchido, nunca cor por pessoa. O usuário atual se distingue por
   PESO no nome ("você" em semibold), nunca por fundo.
   ========================================================================== */

const ROTULO_PAPEL: Record<PapelDoMembro, string> = {
  owner: "Dono(a)",
  admin: "Admin",
  member: "Agente",
};

/** Preço do assento extra — o mesmo do §13.3 (`alterarAssentos` cobra na troca). */
const PRECO_ASSENTO = "R$ 39,90/mês";

type Status = "loading" | "ready" | "error";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EquipeScreen() {
  const toast = useToast();

  const [status, setStatus] = React.useState<Status>("loading");
  const [equipe, setEquipe] = React.useState<EquipeResumo | null>(null);
  const [organizationId, setOrganizationId] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<{
    mensagem: string;
    correcao?: string;
  } | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const reload = React.useCallback(() => setReloadToken((token) => token + 1), []);

  const [conviteAberto, setConviteAberto] = React.useState(false);
  /** memberId com papel em trânsito — o Select do linha trava, não a tela. */
  const [papelEmTransito, setPapelEmTransito] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    // Sem "voltar a carregar" aqui: num reload, a tela que já está pronta
    // permanece em tela até o dado novo chegar — skeleton que pisca a cada
    // ação é a interface fingindo que esqueceu o que você acabou de fazer.
    void Promise.all([listarEquipe(), obterTenantAtual()]).then(
      ([resultado, tenant]) => {
        if (!active) return;
        if (!resultado.ok) {
          setStatus("error");
          setLoadError({
            mensagem: resultado.mensagem,
            correcao: resultado.correcao,
          });
          return;
        }
        setEquipe(resultado.data);
        // O createInvitation do plugin precisa do id da organization — que É o
        // id do tenant (0019). A leitura já existe (é a de "Sua marca"); não há
        // action nova aqui.
        setOrganizationId(tenant.ok ? tenant.data.id : null);
        setStatus("ready");
      },
    );
    return () => {
      active = false;
    };
  }, [reloadToken]);

  /** Eu, pela ÚNICA fonte honesta: o `solicitanteUserId` que o servidor mandou. */
  const eu = React.useMemo(
    () => equipe?.membros.find((m) => m.userId === equipe.solicitanteUserId) ?? null,
    [equipe],
  );
  const souDono = eu?.role === "owner";
  /** Convidar é do dono e do admin (o plugin recusa quem não pode — e a recusa
      dele é a verdade); assentos e demissão são do dono, por §13.7. */
  const podeConvidar = eu?.role === "owner" || eu?.role === "admin";

  /* ------------------------------------------------------------ convites */

  async function enviarConvite(input: {
    email: string;
    role: PapelDoMembro;
  }): Promise<RecusaDeEquipe | null> {
    if (!organizationId) {
      return {
        codigo: "outro",
        mensagem: "Não consegui identificar a agência deste convite.",
        correcao: "Tentar de novo",
      };
    }
    const resultado = await convidarMembro({
      email: input.email,
      role: input.role,
      organizationId,
    });
    if (!resultado.ok) return resultado.recusa;
    toast.show({ title: `Convite enviado para ${input.email}`, tone: "ok" });
    reload();
    return null;
  }

  /** Reconvida — é assim que "Desfazer" de cancelar/remover volta atrás. */
  async function reconvidar(email: string, role: PapelDoMembro) {
    const recusa = await enviarConvite({ email, role });
    if (recusa) {
      toast.show({
        title: `Não consegui reconvidar ${email}`,
        description: recusa.mensagem,
        tone: "danger",
      });
    }
  }

  function cancelar(convite: EquipeResumo["convitesPendentes"][number]) {
    setEquipe((current) =>
      current
        ? {
            ...current,
            convitesPendentes: current.convitesPendentes.filter(
              (c) => c.invitationId !== convite.invitationId,
            ),
          }
        : current,
    );
    void cancelarConvite(convite.invitationId).then((resultado) => {
      if (!resultado.ok) {
        reload();
        toast.show({
          title: `Não consegui cancelar o convite de ${convite.email}`,
          description: resultado.recusa.mensagem,
          tone: "danger",
        });
        return;
      }
      toast.undo(`Convite para ${convite.email} cancelado`, () => {
        void reconvidar(convite.email, convite.role);
      }, { tone: "warn" });
    });
  }

  /* ------------------------------------------------------------- membros */

  function mudarPapel(membro: EquipeResumo["membros"][number], papel: PapelDoMembro) {
    if (papel === membro.role) return;
    // O §14.1 manda o organizationId explicitamente (a sessão da casa não
    // mantém "organization ativa"). Sem ele na carga, não há para quem falar.
    if (!organizationId) {
      toast.show({
        title: "Não consegui identificar a agência.",
        tone: "danger",
      });
      reload();
      return;
    }
    const anterior = membro.role;
    setPapelEmTransito(membro.memberId);
    setEquipe((current) =>
      current
        ? {
            ...current,
            membros: current.membros.map((m) =>
              m.memberId === membro.memberId ? { ...m, role: papel } : m,
            ),
          }
        : current,
    );
    void mudarPapelDoMembro({ memberId: membro.memberId, role: papel, organizationId }).then(
      (resultado) => {
        setPapelEmTransito(null);
        if (!resultado.ok) {
          setEquipe((current) =>
            current
              ? {
                  ...current,
                  membros: current.membros.map((m) =>
                    m.memberId === membro.memberId ? { ...m, role: anterior } : m,
                  ),
                }
              : current,
          );
          toast.show({
            title: `Não consegui mudar o papel de ${membro.name ?? membro.email}`,
            description: resultado.recusa.mensagem,
            tone: "danger",
          });
          return;
        }
        toast.undo(
          `${membro.name ?? membro.email} agora é ${ROTULO_PAPEL[papel]}`,
          () => {
            void mudarPapelDoMembro({ memberId: membro.memberId, role: anterior, organizationId }).then(
              (volteiou) => {
                if (!volteiou.ok) reload();
                else
                  setEquipe((current) =>
                    current
                      ? {
                          ...current,
                          membros: current.membros.map((m) =>
                            m.memberId === membro.memberId ? { ...m, role: anterior } : m,
                          ),
                        }
                      : current,
                  );
              },
            );
          },
          { tone: "ok" },
        );
      },
    );
  }

  function remover(membro: EquipeResumo["membros"][number]) {
    const nome = membro.name ?? membro.email;
    // Mesma regra do §14.1 — ver a guarda em mudarPapel.
    if (!organizationId) {
      toast.show({
        title: "Não consegui identificar a agência.",
        tone: "danger",
      });
      reload();
      return;
    }
    setEquipe((current) =>
      current
        ? { ...current, membros: current.membros.filter((m) => m.memberId !== membro.memberId) }
        : current,
    );
    void removerMembro({ memberIdOrEmail: membro.memberId, organizationId }).then((resultado) => {
      if (!resultado.ok) {
        reload();
        toast.show({
          title: `Não consegui remover ${nome}`,
          description: resultado.recusa.mensagem,
          tone: "danger",
        });
        return;
      }
      // Destrutivo = toast com desfazer de 8s. O desfazer real é RECONVIDAR:
      // membership removida não se cola de volta, mas o convite sim.
      toast.undo(`${nome} saiu da equipe`, () => {
        void reconvidar(membro.email, membro.role);
      }, { tone: "warn", description: "O desfazer reconvida pelo e-mail." });
    });
  }

  /* ---------------------------------------------------------------- tela */

  if (status === "loading" || (!equipe && status !== "error")) {
    return <EquipeSkeleton />;
  }
  if (status === "error" || !equipe) {
    return (
      <Card className="flex flex-col items-start gap-3 p-5">
        <FieldError>{loadError?.mensagem ?? "Não consegui carregar a equipe."}</FieldError>
        <Button variant="secondary" onClick={reload}>
          {loadError?.correcao ?? "Tentar de novo"}
        </Button>
      </Card>
    );
  }

  const soVoce = equipe.membros.length === 1 && equipe.convitesPendentes.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="display text-32 text-ink">Equipe</h1>
        <p className="max-w-[36rem] text-15 leading-[1.5] text-muted">
          Quem vende com você, quem tem convite em aberto e quantos assentos a
          conta paga.
        </p>
      </header>

      {/* --- Assentos ------------------------------------------------- */}
      <section id="assentos" aria-labelledby="assentos-titulo" className="flex flex-col gap-3">
        <SectionHeading>
          <span id="assentos-titulo">Assentos</span>
        </SectionHeading>
        <AssentosCard
          equipe={equipe}
          souDono={souDono === true}
          onApplied={reload}
        />
      </section>

      {/* --- Membros --------------------------------------------------- */}
      <section aria-labelledby="membros-titulo" className="flex flex-col gap-3">
        <SectionHeading
          action={
            podeConvidar ? (
              <Button
                variant="quiet"
                size="sm"
                onPointerDown={() => setConviteAberto(true)}
              >
                Convidar
              </Button>
            ) : undefined
          }
        >
          <span id="membros-titulo">Membros</span>
        </SectionHeading>

        <Card>
          <ul className="flex flex-col divide-y divide-line-subtle">
            {equipe.membros.map((membro) => {
              const souEu = membro.userId === equipe.solicitanteUserId;
              return (
                <li key={membro.memberId} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Monogram
                      name={membro.name ?? membro.email}
                      size="md"
                      className="text-muted"
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "truncate text-15 text-ink",
                          souEu ? "font-semibold" : "font-medium",
                        )}
                      >
                        {membro.name ?? membro.email}
                        {souEu ? (
                          <span className="font-normal text-muted"> · você</span>
                        ) : null}
                      </p>
                      <p className="truncate text-13 text-muted">{membro.email}</p>
                    </div>
                    <span className="shrink-0 text-right text-13 text-muted">
                      {ROTULO_PAPEL[membro.role]}
                      <span
                        data-numeric
                        className="block tabular-nums text-subtle"
                      >
                        desde {formatDayMonth(new Date(membro.memberSince))}
                      </span>
                    </span>
                  </div>

                  {souDono && !souEu ? (
                    <div className="flex items-center justify-between gap-2 pl-12">
                      {membro.role === "owner" ? (
                        // O dono não sai por Select — a conta tem um dono só,
                        // e transferir não é papel desta tela (§9 do doc).
                        <span className="text-13 text-subtle">dono da conta</span>
                      ) : (
                        <Select
                          value={membro.role}
                          onValueChange={(valor) =>
                            mudarPapel(membro, valor as PapelDoMembro)
                          }
                        >
                          <SelectTrigger
                            size="sm"
                            className="w-32"
                            disabled={papelEmTransito === membro.memberId}
                            aria-label={`Papel de ${membro.name ?? membro.email}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="member">Agente</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                      <CardAction
                        className="text-danger hover:text-danger"
                        onClick={() => remover(membro)}
                      >
                        Remover
                      </CardAction>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>

        {soVoce ? (
          <EmptyState
            compact
            title="Só você na equipe"
            description="Quando alguém entrar, cada negócio passa a dizer de quem é — e o relatório passa a quebrar por vendedor."
            preview={
              <div className="flex items-center gap-3 px-1">
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-current text-13 leading-none text-muted">
                  ML
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-15 font-medium text-ink">Marina Lima</span>
                  <span className="truncate text-13 text-muted">marina@agencia.com.br</span>
                </span>
                <span className="ml-auto shrink-0 text-13 text-muted">Agente</span>
              </div>
            }
            action={
              podeConvidar ? (
                <Button variant="primary" size="sm" onPointerDown={() => setConviteAberto(true)}>
                  Convidar
                </Button>
              ) : undefined
            }
          />
        ) : null}
      </section>

      {/* --- Convites pendentes ---------------------------------------- */}
      {equipe.convitesPendentes.length > 0 ? (
        <section aria-labelledby="convites-titulo" className="flex flex-col gap-3">
          <SectionHeading>
            <span id="convites-titulo">Convites pendentes</span>
          </SectionHeading>
          <Card>
            <ul className="flex flex-col divide-y divide-line-subtle">
              {equipe.convitesPendentes.map((convite) => {
                const dias = daysBetween(new Date(), new Date(convite.expiresAt));
                return (
                  <li
                    key={convite.invitationId}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-15 font-medium text-ink">
                        {convite.email}
                      </p>
                      <p data-numeric className="text-13 text-muted">
                        {convite.inviterName
                          ? `Convidado por ${convite.inviterName} em ${formatDayMonth(new Date(convite.createdAt))}`
                          : `Convite de ${formatDayMonth(new Date(convite.createdAt))}`}
                        <span className="text-subtle">
                          {" · "}
                          vence {formatRelativeDays(-dias)}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge size="sm">{ROTULO_PAPEL[convite.role]}</Badge>
                      {podeConvidar ? (
                        <CardAction onClick={() => cancelar(convite)}>
                          Cancelar
                        </CardAction>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      ) : null}

      <ConviteSheet
        open={conviteAberto}
        onOpenChange={setConviteAberto}
        podeEnviar={organizationId !== null}
        planoSolo={equipe.plano === "solo"}
        onEnviar={enviarConvite}
        onAjustarAssentos={() => {
          setConviteAberto(false);
          document
            .getElementById("assentos")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- assentos */

/**
 * A ação de billing da tela (§13.3). O dono escolhe o TOTAL de assentos pagos
 * (ele incluso) e APLICA — sem autosave de propósito: cada mudança troca a
 * assinatura no Asaas (cancelar + recriar no servidor), o que não se faz a
 * cada toque de stepper. Os botões já chegam limitados pelo estado de
 * `listarEquipe()` (não reduzir abaixo dos membros; Solo não tem assento) —
 * e o erro do servidor continua sendo a verdade.
 */
function AssentosCard({
  equipe,
  souDono,
  onApplied,
}: {
  equipe: EquipeResumo;
  souDono: boolean;
  onApplied: () => void;
}) {
  const toast = useToast();
  const { assentos, plano } = equipe;
  const estourado = assentos.usados > assentos.pagos;

  // Ajuste durante a renderização (padrão do React para estado que segue
  // prop): o número que o servidor confirmou manda no desejado.
  const [ultimoPago, setUltimoPago] = React.useState(assentos.pagos);
  const [desejados, setDesejados] = React.useState(assentos.pagos);
  if (assentos.pagos !== ultimoPago) {
    setUltimoPago(assentos.pagos);
    setDesejados(assentos.pagos);
  }

  const [aplicando, setAplicando] = React.useState(false);
  const piso = Math.max(equipe.membros.length, 1);

  async function aplicar() {
    setAplicando(true);
    const resultado = await alterarAssentos({ assentos: desejados });
    setAplicando(false);
    if (!resultado.ok) {
      avisarRecusaDeEscrita(resultado);
      toast.show({
        title: "Não consegui mudar os assentos",
        description: resultado.mensagem,
        tone: "danger",
        action: resultado.correcao
          ? { label: resultado.correcao, onClick: () => void aplicar() }
          : undefined,
      });
      return;
    }
    toast.show({
      title: `Assentos: ${desejados}`,
      description: "A fatura passa a refletir o novo total.",
      tone: "ok",
    });
    onApplied();
  }

  if (estourado) {
    // usados > pagos não deveria acontecer (o gate recusa o convite N+1) —
    // quando acontece é corrida rara, e o estado amarelo HONESTO informa em
    // vez de esconder (§13.1). Esconder seria maquiar a conta que vai chegar.
    return (
      <Card tone="warn">
        <CardHeader>
          <CardTitle>Assentos a conferir</CardTitle>
          <Badge tone="warn" dot>
            {assentos.usados} para {assentos.pagos}
          </Badge>
        </CardHeader>
        <CardBody>
          <p className="text-15 text-ink">
            Há <span data-numeric className="font-semibold tabular-nums">{assentos.usados}</span>{" "}
            pessoas e convites para{" "}
            <span data-numeric className="font-semibold tabular-nums">{assentos.pagos}</span>{" "}
            assentos pagos — uma corrida rara do servidor deixou a conta por um
            fio.
          </p>
          <p className="text-13 text-muted">
            Aumente os assentos para acomodar todo mundo, ou cancele um convite
            pendente na lista de baixo.
          </p>
        </CardBody>
        {souDono && plano !== "solo" ? (
          <CardFooter
            action={
              <Button variant="primary" size="sm" loading={aplicando} onClick={aplicar}>
                Ajustar para {assentos.usados}
              </Button>
            }
          >
            O ajuste troca a assinatura no Asaas — vale na próxima fatura.
          </CardFooter>
        ) : null}
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assentos</CardTitle>
        {plano !== "solo" && assentos.usados >= assentos.pagos ? (
          <Badge tone={assentos.usados > assentos.pagos ? "warn" : "neutral"} dot>
            lotado
          </Badge>
        ) : null}
      </CardHeader>
      <CardBody>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-baseline gap-2">
            <span data-numeric className="text-32 leading-none tabular-nums text-ink">
              {assentos.usados}
            </span>
            <span className="text-15 text-muted">
              de <span data-numeric className="tabular-nums">{assentos.pagos}</span>{" "}
              assentos em uso
            </span>
          </div>

          {souDono && plano !== "solo" ? (
            <div className="flex items-center gap-2">
              <span className="sr-only">Assentos que quero pagar</span>
              <Button
                variant="secondary"
                size="sm"
                iconOnly
                aria-label="Um assento a menos"
                disabled={aplicando || desejados <= piso}
                onClick={() => setDesejados((n) => Math.max(piso, n - 1))}
              >
                <MinusGlyph />
              </Button>
              <span
                data-numeric
                className="min-w-8 text-center text-20 tabular-nums text-ink"
              >
                {desejados}
              </span>
              <Button
                variant="secondary"
                size="sm"
                iconOnly
                aria-label="Um assento a mais"
                disabled={aplicando || desejados >= 50}
                onClick={() => setDesejados((n) => Math.min(50, n + 1))}
              >
                <PlusGlyph />
              </Button>
            </div>
          ) : null}
        </div>

        <p className="text-13 text-muted">
          {plano === "solo" ? (
            "O Solo é para quem trabalha sozinho — não tem assento extra."
          ) : (
            <>
              {assentos.inclusos}{" "}
              {assentos.inclusos === 1 ? "assento incluso" : "assentos inclusos"} no
              plano; além deles, {PRECO_ASSENTO} por assento. Membros e convites
              pendentes ocupam assento.
            </>
          )}
        </p>
      </CardBody>
      {souDono ? (
        plano === "solo" ? (
          <CardFooter
            action={
              <Button variant="secondary" size="sm" asChild>
                <Link href="/cobranca">Migrar para o Pro</Link>
              </Button>
            }
          >
            Para convidar, o plano precisa de assento.
          </CardFooter>
        ) : (
          <CardFooter
            action={
              <Button
                variant="primary"
                size="sm"
                loading={aplicando}
                disabled={desejados === assentos.pagos}
                onClick={() => void aplicar()}
              >
                Aplicar
              </Button>
            }
          >
            {desejados === assentos.pagos
              ? "Sem mudança — mandar o mesmo número não cobra de novo."
              : `Vai passar a ${PRECO_ASSENTO} por assento além dos inclusos.`}
          </CardFooter>
        )
      ) : (
        <CardFooter rule>
          Assentos são escolhidos por quem é dono da conta.
        </CardFooter>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------- sheet convite */

/**
 * O convite é FORMULÁRIO, não linha nova na lista: e-mail e papel num sheet,
 * erro com correção DENTRO dele (formulário que fecha sozinho ao errar é
 * punição). Solo avisa ANTES — mas o botão não trava: a recusa do plugin é a
 * verdade, não meu palpite.
 */
function ConviteSheet({
  open,
  onOpenChange,
  podeEnviar,
  planoSolo,
  onEnviar,
  onAjustarAssentos,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  podeEnviar: boolean;
  planoSolo: boolean;
  onEnviar: (input: { email: string; role: PapelDoMembro }) => Promise<RecusaDeEquipe | null>;
  onAjustarAssentos: () => void;
}) {
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<PapelDoMembro>("member");
  const [erroLocal, setErroLocal] = React.useState<string | null>(null);
  const [recusa, setRecusa] = React.useState<RecusaDeEquipe | null>(null);
  const [enviando, setEnviando] = React.useState(false);

  function fechar(next: boolean) {
    if (!next) {
      setEmail("");
      setRole("member");
      setErroLocal(null);
      setRecusa(null);
    }
    onOpenChange(next);
  }

  async function enviar() {
    const limpo = email.trim();
    if (!EMAIL_RE.test(limpo)) {
      setErroLocal("Digite um e-mail válido — é para lá que o convite vai.");
      return;
    }
    setErroLocal(null);
    setRecusa(null);
    setEnviando(true);
    const falha = await onEnviar({ email: limpo, role });
    setEnviando(false);
    if (falha) {
      setRecusa(falha);
      return;
    }
    fechar(false);
  }

  return (
    <Sheet open={open} onOpenChange={fechar}>
      <SheetContent
        open={open}
        onOpenChange={fechar}
        title="Convidar para a equipe"
        description="O convite chega por e-mail. Quem aceita entra direto nesta agência, já como Agente ou Admin."
        draggable={false}
        footer={
          <Button
            variant="primary"
            block
            loading={enviando}
            disabled={!podeEnviar}
            onClick={() => void enviar()}
          >
            Enviar convite
          </Button>
        }
      >
        <Field invalid={erroLocal !== null}>
          <Label>E-mail</Label>
          <Input
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="nome@agencia.com.br"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setErroLocal(null);
            }}
          />
          {erroLocal !== null ? (
            <FieldError>{erroLocal}</FieldError>
          ) : planoSolo ? (
            <FieldHint>
              O plano atual não tem assento livre — o servidor pode recusar este
              convite.
            </FieldHint>
          ) : (
            <FieldHint>Cada convite ocupa um assento da equipe.</FieldHint>
          )}
        </Field>

        <Field className="mt-4">
          <Label>Papel</Label>
          <Select value={role} onValueChange={(valor) => setRole(valor as PapelDoMembro)}>
            <SelectTrigger aria-label="Papel do convite">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="member" hint="vende e cuida do próprio cliente">
                Agente
              </SelectItem>
              <SelectItem value="admin" hint="também convida">
                Admin
              </SelectItem>
            </SelectContent>
          </Select>
          <FieldHint>
            A conta tem um dono só — convite não transfere a conta.
          </FieldHint>
        </Field>

        {recusa ? (
          <div className="mt-4">
            <FieldError
              action={
                recusa.codigo === "limite_de_assentos" ? (
                  <button
                    type="button"
                    className="font-medium text-danger underline underline-offset-2"
                    onClick={onAjustarAssentos}
                  >
                    {recusa.correcao ?? "Ajustar assentos"}
                  </button>
                ) : recusa.correcao ? (
                  <button
                    type="button"
                    className="font-medium text-danger underline underline-offset-2"
                    onClick={() => void enviar()}
                  >
                    {recusa.correcao}
                  </button>
                ) : undefined
              }
            >
              {recusa.mensagem}
            </FieldError>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ esqueleto */

/** Skeleton, nunca spinner — a mesma armação de card + linhas da tela real. */
function EquipeSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando equipe</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-32 rounded-sm" />
        <Skeleton className="h-4 w-72 rounded-xs" />
      </div>
      <Card className="p-4">
        <SkeletonText lines={2} />
      </Card>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3.5 w-20 rounded-xs" />
        <Card className="flex flex-col gap-4 p-4">
          <SkeletonRow />
          <SkeletonRow />
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- glifos */

/** O "−" do stepper — mesmo traço do PlusIcon, um vivo aqui com o "+" porque
    o par só existe juntos (o icons.tsx não guarda glifos de um uso só). */
function MinusGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M3.5 8h9" />
    </svg>
  );
}

/** O "+" do stepper — o PlusIcon da casa, com traço do sistema. */
function PlusGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}
