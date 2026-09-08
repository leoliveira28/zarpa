"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, FieldError, Label } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/ui/cn";
import {
  anoCorrenteUTC,
  chaveDoParamPeriodo,
  encodeParamPeriodo,
  mesAnteriorUTC,
  mesCorrenteUTC,
  type PeriodoChave,
} from "@/lib/ui/periodo";

/* =============================================================================
   PeriodoSeletor — o recorte de leitura, no topo das telas de leitura
   -----------------------------------------------------------------------------
   §1 de PROPOSTAS_PRODUTO. Quatro atalhos, um estado, e o estado mora na URL
   (`?periodo=...`): link compartilhável, Voltar restaura, nada de memória
   escondida. A rota sempre vem de `usePathname` e a navegação é um
   `router.push(..., { scroll: false })` — trocar de mês não pode jogar a
   agente de volta ao topo de uma tela longa.

   "Este mês" não escreve parâmetro nenhum: é o estado ausente, que o
   servidor já entende como mês corrente. Assim a URL da tela que a agente
   abre quinze vezes por dia continua limpa (`/hoje`), e o link que ela
   compartilha de um recorte antigo carrega o recorte dentro dele.

   "Escolher datas" abre um painel INLINE — não uma Sheet. É um ajuste de
   leitura, não uma tarefa: interromper a tela com camada flutuante para
   escolher duas datas é orçamento de modal gasto à toa. Um intervalo que
   corresponde exatamente a um mês civil é codificado na forma curta
   (`2026-09`, ver `encodeParamPeriodo`) — link curto, rótulo limpo.

   O rótulo que a tela mostra vem da RESPOSTA do backend
   (`periodo.rotulo`), não daqui — este componente só escreve a URL.
   ========================================================================== */

type Atalho = {
  chave: Exclude<PeriodoChave, "invalido" | "custom">;
  label: string;
  /** Valor de `?periodo=` do atalho; `null` = limpar o parâmetro. */
  valor: () => string | null;
};

const ATALHOS: Atalho[] = [
  { chave: "este-mes", label: "Este mês", valor: () => null },
  { chave: "mes-passado", label: "Mês passado", valor: () => mesAnteriorUTC() },
  {
    chave: "este-ano",
    label: "Este ano",
    valor: () => `${anoCorrenteUTC()}-01-01..${anoCorrenteUTC()}-12-31`,
  },
];

export function PeriodoSeletor({
  param,
  className,
}: {
  /** O parâmetro `periodo` cru, como a página leu de `searchParams`. */
  param?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const ativo = chaveDoParamPeriodo(param);

  const [painelAberto, setPainelAberto] = React.useState(false);
  const [de, setDe] = React.useState("");
  const [ate, setAte] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);

  function navegar(valor: string | null) {
    const url = valor ? `${pathname}?periodo=${encodeURIComponent(valor)}` : pathname;
    router.push(url, { scroll: false });
  }

  function abrirPainel() {
    setPainelAberto((aberto) => !aberto);
    setErro(null);
    // Prefill: o intervalo em vigor, ou o mês corrente por extenso — o painel
    // abre mostrando o que está sendo visto, nunca vazio.
    if (!de && !ate) {
      const atual = chaveDoParamPeriodo(param) === "custom" ? (param ?? "") : "";
      const faixa = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(atual);
      if (faixa) {
        setDe(faixa[1]);
        setAte(faixa[2]);
      } else {
        const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(atual)
          ? atual
          : mesCorrenteUTC();
        const [ano, numero] = mes.split("-").map(Number) as [number, number];
        setDe(`${mes}-01`);
        setAte(`${ano}-${String(numero).padStart(2, "0")}-${new Date(Date.UTC(ano, numero, 0)).getUTCDate()}`);
      }
    }
  }

  function aplicar() {
    if (!de || !ate) {
      setErro("Preencha as duas datas para aplicar.");
      return;
    }
    const valor = encodeParamPeriodo(de, ate);
    if (!valor) {
      setErro(
        de > ate
          ? "A data final é antes da inicial."
          : "Uma das datas não existe no calendário.",
      );
      return;
    }
    setErro(null);
    setPainelAberto(false);
    navegar(valor);
  }

  return (
    <div
      role="group"
      aria-label="Período"
      className={cn("flex flex-col gap-2", className)}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {ATALHOS.map((atalho) => (
          <Chip
            key={atalho.chave}
            active={ativo === atalho.chave}
            onClick={() => navegar(atalho.valor())}
          >
            {atalho.label}
          </Chip>
        ))}
        <Chip active={ativo === "custom"} onClick={abrirPainel} aria-expanded={painelAberto}>
          Escolher datas
        </Chip>
      </div>

      {painelAberto ? (
        <div className="flex flex-col gap-3 rounded-md bg-surface-2 p-3">
          <div className="grid grid-cols-2 gap-2">
            <Field>
              <Label>De</Label>
              <Input
                type="date"
                value={de}
                onChange={(event) => setDe(event.target.value)}
                className="tabular-nums"
              />
            </Field>
            <Field>
              <Label>Até</Label>
              <Input
                type="date"
                value={ate}
                onChange={(event) => setAte(event.target.value)}
                className="tabular-nums"
              />
            </Field>
          </div>
          {erro ? <FieldError>{erro}</FieldError> : null}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" onPointerDown={aplicar}>
              Aplicar
            </Button>
            <Button
              size="sm"
              variant="quiet"
              onPointerDown={() => setPainelAberto(false)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Link de período inválido (URL editada à mão, compartilhada torto). O erro
 * diz o que aconteceu E o botão ao lado é a correção — e por baixo a tela
 * segue lendo o mês corrente, com o rótulo do backend dizendo qual é.
 */
export function PeriodoInvalidoCard({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <div
      role="group"
      aria-label="Período"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-md bg-warn-soft px-4 py-3",
        className,
      )}
    >
      <p className="text-13 text-ink">
        O período deste link não é válido — mostrando o mês corrente.
      </p>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => router.push(pathname, { scroll: false })}
      >
        Limpar período
      </Button>
    </div>
  );
}

/** Chip de atalho — a mesma gramática do `FiltroChip` da lista de vendas:
 * `aria-pressed`, reagir no `pointerdown`, sem fundar uma segunda hierarquia
 * de "abas" (a navegação de verdade mora no `MoneyHubTabs`). */
function Chip({
  active,
  onClick,
  children,
  ...props
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onPointerDown={onClick}
      className={cn(
        "min-h-9 rounded-pill px-3 text-13 font-medium",
        active
          ? "bg-accent-soft text-accent-soft-ink"
          : "bg-surface-2 text-muted hover:text-ink",
      )}
      {...props}
    >
      {children}
    </button>
  );
}
