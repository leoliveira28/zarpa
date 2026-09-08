"use client";

import * as React from "react";
import { resumoDoPeriodo, type PeriodoInput, type ResumoDoPeriodo } from "@/server";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeading } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
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
import {
  PeriodoInvalidoCard,
  PeriodoSeletor,
} from "@/components/app/PeriodoSeletor";
import { parseParamPeriodo, formatarRotuloPeriodo } from "@/lib/ui/periodo";
import { COMISSAO_STATUS_LABEL, COMISSAO_STATUS_TONE } from "../vendas/shared";

/* =============================================================================
   Resumo do período — a terceira tab do hub Dinheiro (§2)
   -----------------------------------------------------------------------------
   "Quanto entrou, quanto vem, de onde veio, onde se perdeu" num lugar só,
   recortado pelo MESMO seletor de período do /hoje e das outras tabs.

   Registro silencioso do miolo, à risca: número tabular com largura
   reservada, tab simples de duas linhas, NENHUM gráfico. Um relatório que
   precisa de pizza para ser entendido é um relatório mal posto — quatro
   números de venda, três de comissão e duas listas ordenadas por dinheiro
   respondem tudo que a agente leva para a reunião de fechar o mês.

   `porOrigem.origem: null` e `motivosDePerda.motivo: null` são linhas de
   verdade ("Sem origem" / "Sem motivo registrado"), não são filtradas fora —
   o que não foi classificado é a maior categoria de qualquer base nova, e
   escondê-la é maquiar o número que a agente precisa ver.
   ========================================================================== */

type Status = "loading" | "ready" | "error";

export function RelatoriosScreen({ periodoParam }: { periodoParam?: string }) {
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
    setStatus((current) => (current === "ready" ? current : "loading"));
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

  const maxReceitaPorOrigem = Math.max(
    1,
    ...(resumo?.porOrigem ?? []).map((o) => o.receitaBrutaCents),
  );
  const maxValorPerdido = Math.max(
    1,
    ...(resumo?.motivosDePerda ?? []).map((m) => m.valorCents),
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h2 className="display text-32 text-ink">Resumo do período</h2>
        <MoneyHubTabs />
      </header>

      {parsed.ok ? (
        <PeriodoSeletor param={periodoParam} className="-mt-3" />
      ) : (
        <PeriodoInvalidoCard />
      )}

      {status === "ready" && resumo ? (
        <p data-numeric className="-mt-4 text-13 tabular-nums text-muted">
          {formatarRotuloPeriodo(resumo.periodo)}
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
          <Button variant="secondary" onClick={retry}>
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
    </div>
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
