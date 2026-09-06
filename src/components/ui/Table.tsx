import * as React from "react";
import { cn } from "@/lib/ui/cn";
import { Skeleton } from "./Skeleton";

/* =============================================================================
   Table
   -----------------------------------------------------------------------------
   Densa de propósito: 40px de linha. Tabela arejada demais obriga a rolar para
   comparar duas linhas, e comparar é a única razão de existir uma tabela.

   Sem zebra e SEM MOLDURA. A separação vem do fio horizontal — cornija entre
   registros, na regra da direção Papel e Pedra. Zebra compete com o realce de
   hover e com a cor de status; borda em volta transforma a tabela numa caixa,
   e uma tabela não é uma caixa: é uma pilha de registros.

   O cabeçalho gruda no topo ao rolar. Coluna numérica alinha à direita —
   sempre, sem exceção — e usa tabular-nums.
   ========================================================================== */

export function TableFrame({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // papel, raio de card, sem contorno: o que delimita a tabela é o fio
        // do cabeçalho em cima e o fim das linhas embaixo
        "overflow-x-auto rounded-lg bg-surface",
        className,
      )}
      {...props}
    />
  );
}

export function Table({
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn("w-full border-collapse text-left text-15", className)}
      {...props}
    />
  );
}

export function THead({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        // o fio do cabeçalho é a cornija da tabela: --hairline, não --border
        "sticky top-0 z-10 bg-surface-2 [box-shadow:inset_0_-1px_0_var(--hairline)]",
        className,
      )}
      {...props}
    />
  );
}

export function TBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("", className)} {...props} />;
}

export function TR({
  className,
  interactive,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return (
    <tr
      className={cn(
        "border-b border-line-subtle last:border-b-0",
        interactive && "cursor-pointer hover:bg-surface-2",
        className,
      )}
      {...props}
    />
  );
}

export function TH({
  className,
  numeric,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "h-9 px-3 text-13 font-semibold text-muted whitespace-nowrap",
        numeric ? "text-right" : "text-left",
        className,
      )}
      {...props}
    />
  );
}

export function TD({
  className,
  numeric,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        "h-10 px-3 align-middle text-15 text-ink",
        numeric && "text-right tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

/** Linhas fantasma no mesmo passo de 40px — a tabela não muda de altura. */
export function TableSkeletonRows({
  rows = 5,
  columns = 4,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <TR key={row}>
          {Array.from({ length: columns }, (_, column) => (
            <TD key={column}>
              <Skeleton
                className="h-3.5 rounded-xs"
                style={{ width: column === 0 ? "70%" : "45%" }}
              />
            </TD>
          ))}
        </TR>
      ))}
    </>
  );
}
