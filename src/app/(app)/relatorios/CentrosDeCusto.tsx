"use client";

import * as React from "react";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FieldError } from "@/components/ui/Field";
import { Money } from "@/components/ui/Money";
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
import { vendasPorCentroDeCusto, type LinhaPorCentroDeCusto } from "@/server";
import { formatarRotuloPeriodo, limitesDoPeriodo } from "@/lib/ui/periodo";

/* =============================================================================
   Vendas por centro de custo — a tab "Centros de custo" dos Relatórios (Fase 4a)
   -----------------------------------------------------------------------------
   A pergunta da empresa que paga por setor: "quanto entrou de diretoria, de
   marketing?". Mesma gramática do ranking de clientes — o Map de agregação
   com outra chave — e o MESMO seletor de período da URL: o relatório do
   trimestre usa as duas pontas que `limitesDoPeriodo` deriva, o mesmo par que
   a rota de CSV recebe.

   Diferente do ranking, NADA aqui é clicável: centro de custo não tem ficha —
   a linha é leitura, então nenhuma célula leva o azul. "Sem centro de custo"
   é linha de verdade (`centroId: null`) e mora por ÚLTIMO — é a residual, não
   uma categoria que se classifica.
   ========================================================================== */

type Status = "loading" | "ready" | "empty" | "error";

export function CentrosDeCusto({ periodoParam }: { periodoParam?: string }) {
  const [status, setStatus] = React.useState<Status>("loading");
  const [linhas, setLinhas] = React.useState<LinhaPorCentroDeCusto[]>([]);
  const [errorInfo, setErrorInfo] = React.useState<{ mensagem: string; correcao?: string } | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const retry = React.useCallback(() => setReloadToken((token) => token + 1), []);

  // As pontas derivam do parâmetro cru; param torto cai no mês corrente — o
  // mesmo fallback do ranking de clientes.
  const { de, ate } = limitesDoPeriodo(periodoParam);
  const rotulo = React.useMemo(() => {
    const mes = periodoParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(periodoParam) ? periodoParam : `${de}..${ate}`;
    return formatarRotuloPeriodo({ de, ate, rotulo: mes });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `de`/`ate` derivam de `periodoParam`
  }, [periodoParam]);

  React.useEffect(() => {
    let active = true;
    // Stale-while-revalidate como no ranking: o relatório anterior permanece
    // na tela durante a recarga — trocar o período não pisca skeleton.
    void vendasPorCentroDeCusto({ de, ate }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setErrorInfo({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setLinhas(result.data);
      setStatus(result.data.length === 0 ? "empty" : "ready");
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `de`/`ate` derivam de `periodoParam`
  }, [periodoParam, reloadToken]);

  // Molde de largura da coluna "Vendido": o maior da lista — a coluna inteira
  // compartilha a mesma reserva, nada pula de linha para linha.
  const maxTotal = Math.max(1, ...linhas.map((l) => l.totalVendidoCents));

  return (
    <section aria-labelledby="relatorio-centros" className="flex flex-col gap-3">
      <SectionHeading>
        <span id="relatorio-centros">Vendas por centro de custo</span>
      </SectionHeading>
      <p data-numeric className="-mt-2 text-13 tabular-nums text-muted">
        {rotulo} · vendas fechadas, pela classificação da viagem
      </p>

      {status === "loading" ? (
        <TableFrame>
          <Table>
            <TBody>
              <TableSkeletonRows rows={4} columns={3} />
            </TBody>
          </Table>
        </TableFrame>
      ) : status === "error" ? (
        <div className="flex flex-col items-start gap-3">
          <FieldError>{errorInfo?.mensagem}</FieldError>
          <Button variant="secondary" size="sm" onClick={retry}>
            {errorInfo?.correcao ?? "Tentar de novo"}
          </Button>
        </div>
      ) : status === "empty" ? (
        <EmptyState
          compact
          title="Nenhuma venda neste período"
          description="O relatório soma as vendas fechadas pelo centro de custo da viagem — classifique na ficha do negócio (campo “Centro de custo”)."
          preview={
            <div className="flex items-center gap-3 px-1 py-2 text-13 text-muted">
              <span className="flex-1">Diretoria</span>
              <span className="tabular-nums">2 viagens</span>
              <span className="tabular-nums">R$ 18.900,00</span>
            </div>
          }
        />
      ) : (
        <TableFrame>
          <Table>
            <THead>
              <TR>
                <TH>Centro de custo</TH>
                <TH numeric className="w-20">
                  Viagens
                </TH>
                <TH numeric>Vendido</TH>
              </TR>
            </THead>
            <TBody>
              {linhas.map((linha) => (
                <TR key={linha.centroId ?? "sem-centro"}>
                  <TD>
                    {linha.nome ?? <span className="text-muted">Sem centro de custo</span>}
                  </TD>
                  <TD numeric className="text-13 text-muted">
                    {linha.viagens}
                  </TD>
                  <TD numeric>
                    <Money cents={linha.totalVendidoCents} size="15" reserveFor={maxTotal} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableFrame>
      )}
    </section>
  );
}
