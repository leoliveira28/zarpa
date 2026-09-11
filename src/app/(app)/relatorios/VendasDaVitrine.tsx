"use client";

import * as React from "react";
import { SectionHeading } from "@/components/ui/Card";
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
import { vendasVindasDaVitrine } from "@/server";
import { formatarRotuloPeriodo, limitesDoPeriodo } from "@/lib/ui/periodo";

/* =============================================================================
   Vendas vindas da Vitrine — a origem no Resumo (Fit 7c, o fecho)
   -----------------------------------------------------------------------------
   "Quanto a página pública trouxe?" — vendas do período cujo negócio nasceu
   de um lead da vitrine (offer_leads.deal_id). LENTE sobre `sales`: o dinheiro
   continua no Financeiro; aqui é a pergunta, não uma segunda contabilidade.
   Só nasce quando EXISTE venda vinda de lá — quadro vazio não anuncia ausência.
   ========================================================================== */

type Status = "loading" | "ready" | "hidden" | "error";

type DadosDaVitrine = {
  totalVendas: number;
  receitaCents: number;
  porOferta: Array<{ ofertaTitulo: string; vendas: number; receitaCents: number }>;
};

export function VendasDaVitrine({ periodoParam }: { periodoParam?: string }) {
  const [status, setStatus] = React.useState<Status>("loading");
  const [dados, setDados] = React.useState<DadosDaVitrine | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [reloadToken] = React.useState(0);

  const { de, ate } = limitesDoPeriodo(periodoParam);
  const rotulo = React.useMemo(() => {
    const mes =
      periodoParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(periodoParam) ? periodoParam : `${de}..${ate}`;
    return formatarRotuloPeriodo({ de, ate, rotulo: mes });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `de`/`ate` derivam de `periodoParam`
  }, [periodoParam]);

  React.useEffect(() => {
    let active = true;
    void vendasVindasDaVitrine({ de, ate }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setErro(result.mensagem);
        return;
      }
      setDados(result.data);
      setStatus(result.data.totalVendas === 0 ? "hidden" : "ready");
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `de`/`ate` derivam de `periodoParam`
  }, [periodoParam, reloadToken]);

  if (status === "loading") {
    return (
      <section aria-labelledby="relatorio-vitrine" className="flex flex-col gap-3">
        <SectionHeading>
          <span id="relatorio-vitrine">Vendas vindas da Vitrine</span>
        </SectionHeading>
        <TableFrame>
          <Table>
            <TBody>
              <TableSkeletonRows rows={2} columns={3} />
            </TBody>
          </Table>
        </TableFrame>
      </section>
    );
  }

  if (status === "error") {
    return (
      <section aria-labelledby="relatorio-vitrine" className="flex flex-col gap-2">
        <SectionHeading>
          <span id="relatorio-vitrine">Vendas vindas da Vitrine</span>
        </SectionHeading>
        <p className="text-13 text-muted">{erro ?? "Não consegui carregar."}</p>
      </section>
    );
  }

  if (status === "hidden" || !dados) return null;

  return (
    <section aria-labelledby="relatorio-vitrine" className="flex flex-col gap-3">
      <SectionHeading>
        <span id="relatorio-vitrine">Vendas vindas da Vitrine</span>
      </SectionHeading>
      <p data-numeric className="-mt-2 text-13 tabular-nums text-muted">
        {rotulo} · negócios que nasceram de um interesse na sua página pública
      </p>
      <TableFrame>
        <Table>
          <THead>
            <TR>
              <TH>Oferta de origem</TH>
              <TH numeric className="w-16">
                Vendas
              </TH>
              <TH numeric>Receita</TH>
            </TR>
          </THead>
          <TBody>
            {dados.porOferta.map((linha) => (
              <TR key={linha.ofertaTitulo}>
                <TD>{linha.ofertaTitulo}</TD>
                <TD numeric className="text-13 text-muted">
                  {linha.vendas}
                </TD>
                <TD numeric>
                  <Money
                    cents={linha.receitaCents}
                    size="15"
                    reserveFor={Math.max(1, dados.receitaCents)}
                  />
                </TD>
              </TR>
            ))}
            <TR>
              <TD className="font-medium text-ink">Total</TD>
              <TD numeric className="text-13 font-medium tabular-nums text-ink">
                {dados.totalVendas}
              </TD>
              <TD numeric>
                <Money cents={dados.receitaCents} size="15" reserveFor={dados.receitaCents} />
              </TD>
            </TR>
          </TBody>
        </Table>
      </TableFrame>
    </section>
  );
}
