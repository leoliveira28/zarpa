"use client";

import * as React from "react";
import Link from "next/link";
import { grupoDoNegocio } from "@/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { SkeletonRow } from "@/components/ui/Skeleton";

/* =============================================================================
   GrupoChip — "esta viagem é do grupo Fátima 2027 (2 lugares)"
   -----------------------------------------------------------------------------
   Fase 6b: a ocupação do grupo (`group_members.deal_id`) ligada ao negócio.
   Uma leitura; sem grupo, o card nem nasce — a viagem de sempre não ganha
   ruído. O título é o link para a ficha do grupo (o azul só onde se clica).
   ========================================================================== */

export function GrupoChip({ dealId }: { dealId: string }) {
  const [status, setStatus] = React.useState<"loading" | "pronto">("loading");
  const [grupo, setGrupo] = React.useState<{ id: string; title: string; seats: number } | null>(null);

  React.useEffect(() => {
    let active = true;
    void grupoDoNegocio(dealId).then((result) => {
      if (!active) return;
      if (result.ok) setGrupo(result.data);
      setStatus("pronto");
    });
    return () => {
      active = false;
    };
  }, [dealId]);

  if (status === "loading") {
    return (
      <Card aria-busy="true">
        <CardBody>
          <SkeletonRow />
        </CardBody>
      </Card>
    );
  }
  if (!grupo) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Grupo</CardTitle>
      </CardHeader>
      <CardBody>
        <p className="text-15 text-ink">
          Parte do{" "}
          <Link
            href={`/grupos/${grupo.id}`}
            className="font-medium text-accent underline underline-offset-2"
          >
            {grupo.title}
          </Link>{" "}
          <span className="tabular-nums text-muted">
            · {grupo.seats} {grupo.seats === 1 ? "lugar" : "lugares"}
          </span>
        </p>
      </CardBody>
    </Card>
  );
}
