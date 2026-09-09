"use client";

import * as React from "react";
import Link from "next/link";
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
import { rankingDeClientes, type LinhaDoRanking } from "@/lib/ui/fase12Api";
import { formatarRotuloPeriodo, limitesDoPeriodo } from "@/lib/ui/periodo";

/* =============================================================================
   Ranking de clientes — a tab "Clientes" dos Relatórios (fase 2 do Monde)
   -----------------------------------------------------------------------------
   A pergunta que o PO trouxe: "quem sustenta a agência?" — e a resposta é uma
   lista curta ordenada por dinheiro, não um gráfico. O recorte é o MESMO
   seletor de período da URL (§1): o ranking do trimestre usa as duas pontas
   (`de`/`ate`) que `limitesDoPeriodo` deriva do parâmetro — o mesmo par que a
   rota de CSV recebe, então ranking e arquivo contam a mesma coisa.

   Cada linha leva à ficha 360° do cliente (`/clientes/[id]`): o ranking é o
   mapa; a ficha é o território. O azul fica SÓ no nome — é o único lugar
   clicável da tabela (posição e números são leitura).
   ========================================================================== */

const LIMITE = 10;

type Status = "loading" | "ready" | "empty" | "error";

export function RankingClientes({ periodoParam }: { periodoParam?: string }) {
  const [status, setStatus] = React.useState<Status>("loading");
  const [linhas, setLinhas] = React.useState<LinhaDoRanking[]>([]);
  const [errorInfo, setErrorInfo] = React.useState<{ mensagem: string; correcao?: string } | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const retry = React.useCallback(() => setReloadToken((token) => token + 1), []);

  // As pontas derivam do parâmetro cru; param torto cai no mês corrente — o
  // mesmo fallback das telas (o PeriodoInvalidoCard já avisou acima).
  const { de, ate } = limitesDoPeriodo(periodoParam);
  const rotulo = React.useMemo(() => {
    const mes = periodoParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(periodoParam) ? periodoParam : `${de}..${ate}`;
    return formatarRotuloPeriodo({ de, ate, rotulo: mes });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `de`/`ate` derivam de `periodoParam`
  }, [periodoParam]);

  React.useEffect(() => {
    let active = true;
    // Sem `setStatus("loading")` síncrono: o ranking anterior permanece na
    // tela durante a recarga (stale-while-revalidate, como a lista de vendas)
    // — trocar o período não pisca um skeleton em cima de conteúdo que já
    // estava certo. O estado inicial cobre a primeira pintura.
    void rankingDeClientes({ de, ate, limite: LIMITE }).then((result) => {
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

  // Molde de largura da coluna "Total comprado": o maior da lista — a coluna
  // inteira compartilha a mesma reserva, nada pula de linha para linha.
  const maxTotal = Math.max(1, ...linhas.map((l) => l.totalCompradoCents));

  return (
    <section aria-labelledby="ranking-clientes" className="flex flex-col gap-3">
      <SectionHeading>
        <span id="ranking-clientes">Maiores clientes</span>
      </SectionHeading>
      <p data-numeric className="-mt-2 text-13 tabular-nums text-muted">
        {rotulo} · top {LIMITE} por total comprado
      </p>

      {status === "loading" ? (
        <TableFrame>
          <Table>
            <TBody>
              <TableSkeletonRows rows={5} columns={4} />
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
          title="Nenhum cliente comprou neste período"
          description="O ranking soma as vendas fechadas por cliente no recorte escolhido — troque o período acima para olhar outra janela."
          preview={
            <div className="flex items-center gap-3 px-1 py-2 text-13 text-muted">
              <span className="tabular-nums">01</span>
              <span className="flex-1">Maria Souza</span>
              <span className="tabular-nums">3 viagens</span>
              <span className="tabular-nums">R$ 12.400,00</span>
            </div>
          }
        />
      ) : (
        <TableFrame>
          <Table>
            <THead>
              <TR>
                <TH className="w-8">#</TH>
                <TH>Cliente</TH>
                <TH numeric className="w-16">
                  Viagens
                </TH>
                <TH numeric>Total comprado</TH>
              </TR>
            </THead>
            <TBody>
              {linhas.map((linha, index) => (
                <TR key={linha.contatoId}>
                  <TD numeric className="text-13 text-muted">
                    {String(index + 1).padStart(2, "0")}
                  </TD>
                  <TD>
                    <Link
                      href={`/clientes/${linha.contatoId}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {linha.nome}
                    </Link>
                  </TD>
                  <TD numeric className="text-13 text-muted">
                    {linha.viagens}
                    {linha.viagens === 1 ? " viagem" : " viagens"}
                  </TD>
                  <TD numeric>
                    <Money cents={linha.totalCompradoCents} size="15" reserveFor={maxTotal} />
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
