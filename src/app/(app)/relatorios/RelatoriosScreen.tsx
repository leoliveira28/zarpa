"use client";

import * as React from "react";
import Link from "next/link";
import {
  resumoDoPeriodo,
  type PeriodoInput,
  type QuebraPorVendedor,
  type ResumoDoPeriodo,
} from "@/server";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeading } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { Monogram } from "@/components/ui/Monogram";
import { SkeletonRow } from "@/components/ui/Skeleton";
import {
  Table,
  TableFrame,
  TableSkeletonRows,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui/Table";
import { MoneyHubTabs } from "@/components/app/MoneyHubTabs";
import { CentrosDeCusto } from "./CentrosDeCusto";
import { RankingClientes } from "./RankingClientes";
import { ResultadoDasViagens } from "./ResultadoDasViagens";
import {
  PeriodoInvalidoCard,
  PeriodoSeletor,
} from "@/components/app/PeriodoSeletor";
import { cn } from "@/lib/ui/cn";
import { chaveDoParamPeriodo } from "@/lib/ui/periodo";
import { parseParamPeriodo, formatarRotuloPeriodo } from "@/lib/ui/periodo";
import { COMISSAO_STATUS_LABEL, COMISSAO_STATUS_TONE } from "../vendas/shared";

/* =============================================================================
   Relatórios — a terceira tab do hub Dinheiro (§2), agora em duas sub-abas
   -----------------------------------------------------------------------------
   "Quanto entrou, quanto vem, de onde veio, onde se perdeu" num lugar só,
   recortado pelo MESMO seletor de período do /hoje e das outras tabs.

   Resumo (a sub-aba de sempre) responde "quanto"; Clientes (fase 2 do Monde)
   responde "de quem" — o ranking dos que sustentam a agência. A sub-aba mora
   na URL (`?aba=`) como o período mora: um link compartilhado abre o MESMO
   relatório na MESMA janela, e o Voltar restaura. As duas sub-abas carregam o
   `?periodo=` — são perguntas diferentes sobre a mesma janela de tempo.

   Registro silencioso do miolo, à risca: número tabular com largura
   reservada, tab simples, NENHUM gráfico. Um relatório que precisa de pizza
   para ser entendido é um relatório mal posto — quatro números de venda, três
   de comissão, o resultado das viagens e duas listas ordenadas por dinheiro
   respondem tudo que a agente leva para a reunião de fechar o mês.

   `porOrigem.origem: null` e `motivosDePerda.motivo: null` são linhas de
   verdade ("Sem origem" / "Sem motivo registrado"), não são filtradas fora —
   o que não foi classificado é a maior categoria de qualquer base nova, e
   escondê-la é maquiar o número que a agente precisa ver.
   ========================================================================== */

type Status = "loading" | "ready" | "error";
type Aba = "resumo" | "clientes" | "centros";

export function RelatoriosScreen({
  periodoParam,
  abaParam,
}: {
  periodoParam?: string;
  abaParam?: string;
}) {
  // Aba na URL; qualquer coisa que não seja uma aba conhecida é o resumo — link
  // sem `aba` e link torto caem no relatório de sempre.
  const aba: Aba =
    abaParam === "clientes" || abaParam === "centros" ? abaParam : "resumo";
  const parsed = React.useMemo(() => parseParamPeriodo(periodoParam), [periodoParam]);
  const periodoInput: PeriodoInput | undefined = parsed.ok ? parsed.input : undefined;
  // A chave de efeito é o parâmetro cru: trocou a URL, relê.
  const periodoKey = periodoParam ?? "";

  const [status, setStatus] = React.useState<Status>("loading");
  const [resumo, setResumo] = React.useState<ResumoDoPeriodo | null>(null);
  const [errorInfo, setErrorInfo] = React.useState<{
    mensagem: string;
    correcao?: string;
  } | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const retry = React.useCallback(() => setReloadToken((token) => token + 1), []);

  React.useEffect(() => {
    let active = true;
    // Sem setStatus síncrono aqui: trocar de período mantém o que já está em
    // tela até o número novo chegar (o painel não pisca skeleton), e num
    // retry o cartão de erro permanece até a resposta — some só quando há
    // o que mostrar no lugar.
    void resumoDoPeriodo(periodoInput).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setErrorInfo({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setResumo(result.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `periodoInput` é derivado de `periodoKey`
  }, [periodoKey, reloadToken]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        {/* h2 nomeia a tela (como "Vendas" em /vendas, que também repete o
            rótulo da tab ativa do hub) — o painel já se anuncia nas seções. */}
        <h2 className="display text-32 text-ink">Relatórios</h2>
        <MoneyHubTabs periodoParam={periodoParam} />
        <SubAbas aba={aba} periodoParam={periodoParam} />
      </header>

      {parsed.ok ? (
        <PeriodoSeletor param={periodoParam} className="-mt-3" />
      ) : (
        <PeriodoInvalidoCard />
      )}

      {aba === "clientes" ? (
        <RankingClientes periodoParam={periodoParam} />
      ) : aba === "centros" ? (
        <CentrosDeCusto periodoParam={periodoParam} />
      ) : (
        <PainelResumo
          status={status}
          resumo={resumo}
          errorInfo={errorInfo}
          onRetry={retry}
          periodoInput={periodoInput}
          periodoParam={periodoParam}
        />
      )}
    </div>
  );
}

/* -----------------------------------------------------------------------------
   PainelResumo — o relatório de sempre (vendas, comissão, resultado das
   viagens, origem, perdas). Extraído do corpo da tela quando os Relatórios
   ganharam a segunda aba: cada painel é um componente, a troca de aba é uma
   ternária de uma linha.
   ------------------------------------------------------------------------- */

function PainelResumo({
  status,
  resumo,
  errorInfo,
  onRetry,
  periodoInput,
  periodoParam,
}: {
  status: Status;
  resumo: ResumoDoPeriodo | null;
  errorInfo: { mensagem: string; correcao?: string } | null;
  onRetry: () => void;
  /** Recorte da URL, já validado — o agregado e o CSV seguem o mesmo par. */
  periodoInput?: PeriodoInput;
  periodoParam?: string;
}) {
  const maxReceitaPorOrigem = Math.max(
    1,
    ...(resumo?.porOrigem ?? []).map((o) => o.receitaBrutaCents),
  );
  const maxValorPerdido = Math.max(
    1,
    ...(resumo?.motivosDePerda ?? []).map((m) => m.valorCents),
  );

  return (
    <>
      {status === "ready" && resumo ? (
        <p data-numeric className="-mt-4 text-13 tabular-nums text-muted">
          {formatarRotuloPeriodo(resumo.periodo)}
          {/* De quem são estes números (Fase 3, §13.4): o rótulo vem do
              `resumo.escopo` que o SERVIDOR mandou — o dono não tem alternador
              (vê a agência inteira, sempre) e o membro não tem toggle (vê o
              dele). Número sem dizer de quem é, em time, é número que briga. */}
          <span className="text-subtle">
            {" · "}
            {resumo.escopo === "tenant" ? "Time" : "Meus"}
          </span>
        </p>
      ) : null}

      {status === "loading" ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Card key={i} className="min-h-[6.5rem] p-4">
                <SkeletonRow />
              </Card>
            ))}
          </div>
          <TableFrame>
            <Table>
              <TBody>
                <TableSkeletonRows rows={3} columns={3} />
              </TBody>
            </Table>
          </TableFrame>
        </>
      ) : status === "error" ? (
        <Card className="flex flex-col items-start gap-3 p-5">
          <p className="text-15 text-ink">{errorInfo?.mensagem}</p>
          <Button variant="secondary" onClick={onRetry}>
            {errorInfo?.correcao ?? "Tentar de novo"}
          </Button>
        </Card>
      ) : !resumo ? null : (
        <>
          {/* --- Vendas ------------------------------------------------- */}
          <section aria-labelledby="relatorio-vendas" className="flex flex-col gap-3">
            <SectionHeading>
              <span id="relatorio-vendas">Vendas</span>
            </SectionHeading>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label="Vendas fechadas">
                <p data-numeric className="mt-1 text-20 tabular-nums text-ink">
                  {resumo.vendas.total}
                </p>
              </Tile>
              <Tile label="Receita bruta">
                <Money
                  cents={resumo.vendas.receitaBrutaCents}
                  size="20"
                  align="left"
                  reserveFor={50_000_000}
                  className="mt-1"
                />
              </Tile>
              <Tile label="Taxa de serviço">
                <Money
                  cents={resumo.vendas.taxaServicoCents}
                  size="20"
                  align="left"
                  reserveFor={5_000_000}
                  className="mt-1"
                />
              </Tile>
              <Tile label="Ticket médio">
                <Money
                  cents={resumo.vendas.ticketMedioCents}
                  size="20"
                  align="left"
                  reserveFor={10_000_000}
                  className="mt-1"
                />
              </Tile>
            </div>
          </section>

          {/* --- Comissão ----------------------------------------------- */}
          <section aria-labelledby="relatorio-comissao" className="flex flex-col gap-3">
            <SectionHeading>
              <span id="relatorio-comissao">Comissão</span>
            </SectionHeading>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {(
                [
                  { key: "prevista", cents: resumo.comissao.previstaCents },
                  { key: "recebida", cents: resumo.comissao.recebidaCents },
                  { key: "atrasada", cents: resumo.comissao.atrasadaCents },
                ] as const
              ).map(({ key, cents }) => (
                <Tile
                  key={key}
                  label={COMISSAO_STATUS_LABEL[key]}
                  tone={key === "atrasada" && cents > 0 ? "warn" : "default"}
                  icon={<Badge tone={COMISSAO_STATUS_TONE[key]} dot size="sm" />}
                >
                  <Money
                    cents={cents}
                    size="20"
                    align="left"
                    reserveFor={20_000_000}
                    className="mt-1"
                  />
                </Tile>
              ))}
              <Tile label="Total da comissão">
                <Money
                  cents={resumo.comissao.totalCents}
                  size="20"
                  align="left"
                  reserveFor={20_000_000}
                  className="mt-1"
                />
              </Tile>
            </div>
          </section>

          {/* --- Resultado das viagens (o agregado da fase 2) ------------ */}
          {/* Depois de Comissão de propósito: margem = venda − custo −
              comissão, então o card é a CONCLUSÃO dos dois blocos anteriores —
              antes deles, seria um número sem a conta que o sustenta. */}
          <ResultadoDasViagens periodoInput={periodoInput} periodoParam={periodoParam} />

          {/* --- Vendas por vendedor (Fase 3, §13.5) -------------------- */}
          {/* Depois de Resultado das viagens: a quebra responde QUEM produziu
              o resultado que o bloco anterior acabou de mostrar. Quando o
              plano não abre a quebra, a frase é honesta e curta — nada de
              banner de upsell gritando numa tela de leitura. Membro sozinho
              (Pro de uma pessoa): a seção some INTEIRA — dizer "você é o
              único vendedor" seria narrar o óbvio todo mês. */}
          <VendasPorVendedor porVendedor={resumo.porVendedor} />

          {/* --- Receita por origem ------------------------------------- */}
          <section aria-labelledby="relatorio-origem" className="flex flex-col gap-3">
            <SectionHeading>
              <span id="relatorio-origem">Receita por origem do contato</span>
            </SectionHeading>
            {resumo.porOrigem.length === 0 ? (
              <EmptyState
                compact
                title="Nenhuma venda neste período"
                description="A origem do contato (WhatsApp, indicação, Instagram) vem do cadastro do cliente — as vendas do período aparecem aqui agrupadas por ela."
              />
            ) : (
              <TableFrame>
                <Table>
                  <THead>
                    <TR>
                      <TH>Origem</TH>
                      <TH numeric className="w-16">
                        Vendas
                      </TH>
                      <TH numeric>Receita bruta</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {resumo.porOrigem.map((linha) => (
                      <TR key={linha.origem ?? "sem-origem"}>
                        <TD>
                          {linha.origem ?? <span className="text-muted">Sem origem</span>}
                        </TD>
                        <TD numeric className="text-13 text-muted">
                          {linha.vendas}
                        </TD>
                        <TD numeric>
                          <Money
                            cents={linha.receitaBrutaCents}
                            size="15"
                            reserveFor={maxReceitaPorOrigem}
                          />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableFrame>
            )}
          </section>

          {/* --- Motivos de perda --------------------------------------- */}
          <section aria-labelledby="relatorio-perdas" className="flex flex-col gap-3">
            <SectionHeading>
              <span id="relatorio-perdas">Motivos de perda</span>
            </SectionHeading>
            {resumo.motivosDePerda.length === 0 ? (
              <EmptyState
                compact
                title="Nenhum negócio perdido neste período"
                description="Negócios marcados como perdidos no funil aparecem aqui pelo motivo registrado — o valor é o que deixou de entrar."
              />
            ) : (
              <TableFrame>
                <Table>
                  <THead>
                    <TR>
                      <TH>Motivo</TH>
                      <TH numeric className="w-20">
                        Negócios
                      </TH>
                      <TH numeric>Valor perdido</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {resumo.motivosDePerda.map((linha) => (
                      <TR key={linha.motivo ?? "sem-motivo"}>
                        <TD>
                          {linha.motivo ?? (
                            <span className="text-muted">Sem motivo registrado</span>
                          )}
                        </TD>
                        <TD numeric className="text-13 text-muted">
                          {linha.negocios}
                        </TD>
                        <TD numeric>
                          <Money cents={linha.valorCents} size="15" reserveFor={maxValorPerdido} />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableFrame>
            )}
          </section>
        </>
      )}
    </>
  );
}

/**
 * Vendas por vendedor — a quebra do §13.5. Cada linha é uma PESSOA, então
 * monograma (contorno, nunca cor por pessoa) junto do nome; "Sem vendedor" é
 * linha de verdade (`agentId: null` — dado de antes da fase, e venda não
 * classificada é categoria, não ruído). Dinheiro com largura reservada pelo
 * maior valor da tabela: número que não pula entre linhas.
 */
function VendasPorVendedor({ porVendedor }: { porVendedor: QuebraPorVendedor }) {
  if (!porVendedor.disponivel) {
    if (porVendedor.motivo === "membro_unico") return null;
    return (
      <section aria-labelledby="relatorio-vendedores" className="flex flex-col gap-3">
        <SectionHeading>
          <span id="relatorio-vendedores">Vendas por vendedor</span>
        </SectionHeading>
        <p className="text-13 text-subtle">A quebra por vendedor é do Studio.</p>
      </section>
    );
  }

  const maxReceita = Math.max(1, ...porVendedor.linhas.map((l) => l.receitaBrutaCents));

  return (
    <section aria-labelledby="relatorio-vendedores" className="flex flex-col gap-3">
      <SectionHeading>
        <span id="relatorio-vendedores">Vendas por vendedor</span>
      </SectionHeading>
      <TableFrame>
        <Table>
          <THead>
            <TR>
              <TH>Vendedor</TH>
              <TH numeric className="w-16">
                Vendas
              </TH>
              <TH numeric>Receita bruta</TH>
            </TR>
          </THead>
          <TBody>
            {porVendedor.linhas.map((linha) => (
              <TR key={linha.agentId ?? "sem-vendedor"}>
                <TD>
                  <span className="flex items-center gap-2.5">
                    {linha.nome ? (
                      <Monogram name={linha.nome} size="sm" className="text-muted" />
                    ) : null}
                    {linha.nome ?? <span className="text-muted">Sem vendedor</span>}
                  </span>
                </TD>
                <TD numeric className="text-13 text-muted">
                  {linha.vendas}
                </TD>
                <TD numeric>
                  <Money cents={linha.receitaBrutaCents} size="15" reserveFor={maxReceita} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableFrame>
    </section>
  );
}

/**
 * Tile de número — o mesmo papel do `MonthCard` do /hoje, sem navegação: um
 * relatório não clica, lê. Molde de largura fixo por métrica (os mesmos tetos
 * calibrados dos cards de mês do /hoje) — número que não pula ao carregar nem
 * ao trocar o período.
 */
function Tile({
  label,
  icon,
  tone = "default",
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  tone?: "default" | "warn";
  children: React.ReactNode;
}) {
  return (
    <Card tone={tone} className="min-h-[6.5rem] p-4">
      <span className="flex items-center gap-1.5 text-13 font-medium text-muted">
        {icon}
        {label}
      </span>
      {children}
    </Card>
  );
}

/* -----------------------------------------------------------------------------
   SubAbas — Resumo | Clientes, a MESMA gramática visual do MoneyHubTabs
   (segmented, `aria-current`, min-h-9). São links de verdade, não `<Tabs>`
   de Radix: cada aba é um estado da URL renderizado no servidor — recarregar
   abre na mesma aba e o histórico do navegador funciona. O `?periodo=` viaja
   junto (param torto não viaja, mesma regra do hub) e a aba Resumo nem
   escreve `aba=` — ausente É resumo, então o link padrão continua limpo.
   ------------------------------------------------------------------------- */

const ABAS = [
  { valor: "resumo", rotulo: "Resumo", href: "/relatorios" },
  { valor: "clientes", rotulo: "Clientes", href: "/relatorios?aba=clientes" },
  {
    valor: "centros",
    rotulo: "Centros de custo",
    href: "/relatorios?aba=centros",
  },
] as const;

function SubAbas({ aba, periodoParam }: { aba: Aba; periodoParam?: string }) {
  const carregavel =
    periodoParam && chaveDoParamPeriodo(periodoParam) !== "invalido" ? periodoParam : null;
  return (
    <nav aria-label="Tipo de relatório" className="flex">
      <div className="inline-flex w-fit gap-0.5 rounded-md bg-surface-2 p-0.5">
        {ABAS.map((item) => {
          const query = carregavel
            ? `${item.href.includes("?") ? "&" : "?"}periodo=${encodeURIComponent(carregavel)}`
            : "";
          return (
            <Link
              key={item.valor}
              href={`${item.href}${query}`}
              aria-current={aba === item.valor ? "page" : undefined}
              className={cn(
                "flex min-h-9 items-center rounded-sm px-3.5 text-13 font-medium",
                aba === item.valor ? "bg-surface text-ink shadow-1" : "text-muted",
              )}
            >
              {item.rotulo}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
