"use client";

import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
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
import { resumoDosGrupos, type GrupoStatus } from "@/server";

type LinhaDoResumo = {
  id: string;
  title: string;
  status: GrupoStatus;
  totalSeats: number;
  lugaresOcupados: number;
  pricePerSeatCents: number;
  margemPorLugarCents: number;
  receitaPrevistaCents: number;
  receitaRealizadaCents: number;
  totalMembros: number;
};

/* =============================================================================
   Grupos — a quarta sub-aba dos Relatórios (meta Grupos, rodada 6b)
   -----------------------------------------------------------------------------
   A leitura do PO: "lugar vendido × total, receita prevista × realizada, e a
   margem por lugar". O grupo é LENTE sobre o dinheiro de `sales` — a receita
   aqui é a SOMA das vendas dos negócios membros, nunca uma segunda
   contabilidade. Diferente das outras abas, não tem período: a saída é o
   recorte dela (grupo encerrado é histórico, montando é futuro).
   ========================================================================== */

type Status = "loading" | "ready" | "empty" | "error";

const STATUS_LABEL: Record<GrupoStatus, string> = {
  montando: "Montando",
  vendendo: "Vendendo",
  encerrado: "Encerrado",
};

const STATUS_TONE: Record<GrupoStatus, "neutral" | "ok" | "warn"> = {
  montando: "neutral",
  vendendo: "ok",
  encerrado: "warn",
};

export function GruposRelatorio() {
  const [status, setStatus] = React.useState<Status>("loading");
  const [linhas, setLinhas] = React.useState<LinhaDoResumo[]>([]);
  const [errorInfo, setErrorInfo] = React.useState<{ mensagem: string; correcao?: string } | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const retry = React.useCallback(() => setReloadToken((token) => token + 1), []);

  React.useEffect(() => {
    let active = true;
    void resumoDosGrupos().then((result) => {
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
  }, [reloadToken]);

  // Molde de largura: o maior entre prevista e realizada — nada pula de linha para linha.
  const maxReceita = Math.max(
    1,
    ...linhas.map((l) => Math.max(l.receitaPrevistaCents, l.receitaRealizadaCents)),
  );

  return (
    <section aria-labelledby="relatorio-grupos" className="flex flex-col gap-3">
      <SectionHeading>
        <span id="relatorio-grupos">Grupos</span>
      </SectionHeading>
      <p className="-mt-2 text-13 text-muted">
        Cada saída: lugares vendidos, o dinheiro das reservas (vendas dos negócios
        membros) e a margem por lugar do pacote.
      </p>

      {status === "loading" ? (
        <TableFrame>
          <Table>
            <TBody>
              <TableSkeletonRows rows={4} columns={5} />
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
          title="Nenhum grupo ainda"
          description="Monte um grupo em Grupos (no menu da lateral) — os lugares, o preço por lugar e as reservas aparecem aqui."
          preview={
            <div className="flex items-center gap-3 px-1 py-2 text-13 text-muted">
              <span className="flex-1">Fátima 2027</span>
              <span className="tabular-nums">3 de 10 lugares</span>
              <span className="tabular-nums">R$ 16.500 previstos</span>
            </div>
          }
        />
      ) : (
        <TableFrame>
          <Table>
            <THead>
              <TR>
                <TH>Grupo</TH>
                <TH numeric className="w-24">
                  Lugares
                </TH>
                <TH numeric>Prevista</TH>
                <TH numeric>Recebida</TH>
                <TH numeric className="w-28">
                  Margem/lugar
                </TH>
              </TR>
            </THead>
            <TBody>
              {linhas.map((linha) => (
                <TR key={linha.id}>
                  <TD>
                    <span className="flex items-center gap-2">
                      <Link
                        href={`/grupos/${linha.id}`}
                        className="truncate font-medium text-accent underline underline-offset-2"
                      >
                        {linha.title}
                      </Link>
                      <Badge tone={STATUS_TONE[linha.status]} dot size="sm">
                        {STATUS_LABEL[linha.status]}
                      </Badge>
                    </span>
                  </TD>
                  <TD numeric className="text-13 text-muted">
                    {linha.lugaresOcupados} de {linha.totalSeats}
                  </TD>
                  <TD numeric>
                    <Money cents={linha.receitaPrevistaCents} size="15" reserveFor={maxReceita} />
                  </TD>
                  <TD numeric>
                    <Money
                      cents={linha.receitaRealizadaCents}
                      size="15"
                      tone={linha.receitaRealizadaCents > 0 ? "ok" : "muted"}
                      reserveFor={maxReceita}
                    />
                  </TD>
                  <TD numeric>
                    <Money cents={linha.margemPorLugarCents} size="15" reserveFor={maxReceita} />
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
