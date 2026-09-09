"use client";

import * as React from "react";
import {
  listarVendas,
  type PeriodoInput,
  type VendaResumo,
} from "@/server";
import { Button } from "@/components/ui/Button";
import { Card, CardFooter } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FieldError } from "@/components/ui/Field";
import { SkeletonText } from "@/components/ui/Skeleton";
import { DownloadIcon } from "@/components/app/icons";
import { ResultadoViagemCard } from "@/components/app/ResultadoViagemCard";
import {
  resultadoDaViagem,
  urlDoCsvDeVendas,
  type ValoresDaViagem,
} from "@/lib/ui/fase12Api";
import { limitesDoPeriodo } from "@/lib/ui/periodo";

/* =============================================================================
   Resultado das viagens — o agregado do período na MESMA forma da ficha
   -----------------------------------------------------------------------------
   Fase 2 do Monde, lado relatório: a ficha do negócio ganho mostra o resultado
   de UMA viagem; aqui a soma de TODAS as do recorte, no MESMO card (todos os
   seis campos são somáveis, então a soma tem o shape do item — a agente lê uma
   gramática só e a entende em qualquer escala).

   A soma vem das actions `resultadoDaViagem` de cada negócio com venda — um
   deal é uma viagem, então deals repetidos entram UMA vez. Se QUALQUER chamada
   recusar, o número NÃO é exibido parcial: dinheiro que some em silêncio é
   pior que um erro assumido — a tela oferece "Tentar de novo" no lugar.
   ========================================================================== */

type Status = "loading" | "ready" | "empty" | "error";

const ZERO: ValoresDaViagem = {
  valorVendaCents: 0,
  custoPrevistoCents: 0,
  comissaoPrevistaCents: 0,
  recebidoCents: 0,
  aReceberCents: 0,
  margemPrevistaCents: 0,
};

function somar(a: ValoresDaViagem, b: ValoresDaViagem): ValoresDaViagem {
  return {
    valorVendaCents: a.valorVendaCents + b.valorVendaCents,
    custoPrevistoCents: a.custoPrevistoCents + b.custoPrevistoCents,
    comissaoPrevistaCents: a.comissaoPrevistaCents + b.comissaoPrevistaCents,
    recebidoCents: a.recebidoCents + b.recebidoCents,
    aReceberCents: a.aReceberCents + b.aReceberCents,
    margemPrevistaCents: a.margemPrevistaCents + b.margemPrevistaCents,
  };
}

export function ResultadoDasViagens({
  periodoInput,
  periodoParam,
}: {
  periodoInput?: PeriodoInput;
  periodoParam?: string;
}) {
  const [status, setStatus] = React.useState<Status>("loading");
  const [soma, setSoma] = React.useState<ValoresDaViagem>(ZERO);
  const [viagens, setViagens] = React.useState(0);
  const [errorInfo, setErrorInfo] = React.useState<{ mensagem: string; correcao?: string } | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const retry = React.useCallback(() => setReloadToken((token) => token + 1), []);

  React.useEffect(() => {
    let active = true;
    // Sem `setStatus("loading")` síncrono (regra nova do lint + regra da casa):
    // trocar de período mantém o card anterior na tela até a soma recém-chegada
    // o substituir — número que desaparece para voltar igual é redundância.
    void (async () => {
      const vendas = await listarVendas({ periodo: periodoInput, limite: 200 });
      if (!active) return;
      if (!vendas.ok) {
        setStatus("error");
        setErrorInfo({ mensagem: vendas.mensagem, correcao: vendas.correcao });
        return;
      }
      if (vendas.data.length === 0) {
        setStatus("empty");
        return;
      }
      // Um deal = uma viagem: a action é por negócio, não por venda.
      const dealIds = Array.from(new Set(vendas.data.map((v: VendaResumo) => v.dealId)));
      const resultados = await Promise.all(dealIds.map((id) => resultadoDaViagem(id)));
      if (!active) return;
      let total = ZERO;
      for (const resultado of resultados) {
        if (!resultado.ok) {
          // Recusa (negócio reaberto depois da venda, instabilidade) fecha o
          // card inteiro — nunca uma soma pela metade.
          setStatus("error");
          setErrorInfo({ mensagem: resultado.mensagem, correcao: resultado.correcao });
          return;
        }
        total = somar(total, resultado.data);
      }
      setSoma(total);
      setViagens(dealIds.length);
      setStatus("ready");
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `periodoInput` é derivado de `periodoParam`
  }, [periodoParam, reloadToken]);

  const csvHref = urlDoCsvDeVendas(limitesDoPeriodo(periodoParam));

  if (status === "loading") {
    /* O lugar do card fica reservado (altura próxima da pronta) — o período
       trocado não empurra a página inteira. */
    return (
      <Card className="min-h-64 p-4">
        <SkeletonText lines={4} />
      </Card>
    );
  }
  if (status === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <FieldError>{errorInfo?.mensagem}</FieldError>
        <Button variant="secondary" size="sm" onClick={retry}>
          {errorInfo?.correcao ?? "Tentar de novo"}
        </Button>
      </div>
    );
  }
  if (status === "empty") {
    return (
      <EmptyState
        compact
        title="Nenhuma venda neste período"
        description="Quando houver vendas no recorte, a margem do período aparece aqui na mesma forma do resultado de cada viagem."
      />
    );
  }

  return (
    <ResultadoViagemCard
      dados={soma}
      titulo="Resultado das viagens"
      nota={`soma de ${viagens} ${viagens === 1 ? "viagem" : "viagens"} no período`}
      rodape={
        <CardFooter
          action={
            <Button variant="secondary" size="sm" asChild>
              <a href={csvHref} download>
                <DownloadIcon className="size-4" />
                Exportar CSV
              </a>
            </Button>
          }
        >
          <span className="text-13 text-muted">
            As vendas do período, uma linha por venda — o mesmo recorte do ranking.
          </span>
        </CardFooter>
      }
    />
  );
}
