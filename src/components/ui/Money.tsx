import * as React from "react";
import { cn } from "@/lib/ui/cn";
import { brlWidthTemplate, formatBRL } from "@/lib/ui/format";

/* =============================================================================
   Money — o componente mais importante do produto.
   -----------------------------------------------------------------------------
   O agente confere valor de venda, custo e comissão dezenas de vezes por dia.
   Se o número muda de largura entre o skeleton e o valor, ou entre R$ 990,00 e
   R$ 1.100,00, a coluna inteira treme e a leitura vertical morre.

   Duas garantias:
     - `tabular-nums`: todo dígito ocupa a mesma largura.
     - largura reservada: um molde invisível na mesma célula de grid segura o
       espaço. O valor real nunca é mais estreito que o molde, então o layout
       não pula quando o dado chega nem quando ele muda.

   Valor SEMPRE em centavos (inteiro). Ver src/lib/ui/format.ts.
   ========================================================================== */

type Tone = "default" | "muted" | "accent" | "ok" | "warn" | "danger";
type MoneySize = "13" | "15" | "17" | "20" | "32";

const tones: Record<Tone, string> = {
  default: "text-ink",
  muted: "text-muted",
  accent: "text-accent",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
};

const sizeClass: Record<MoneySize, string> = {
  "13": "text-13",
  "15": "text-15",
  "17": "text-17",
  "20": "text-20",
  "32": "text-32",
};

export interface MoneyProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Valor em centavos. `null` enquanto carrega. */
  cents: number | null | undefined;
  size?: MoneySize;
  tone?: Tone;
  /** Esconde o "R$" — para colunas de tabela que já têm o símbolo no cabeçalho. */
  withSymbol?: boolean;
  /** Mostra "+" em valores positivos (variação, comissão). */
  signed?: boolean;
  /**
   * Maior valor que essa posição vai exibir, em centavos. Define a largura
   * reservada. Passe o teto da coluna e a coluna inteira fica alinhada.
   */
  reserveFor?: number;
  loading?: boolean;
}

export function Money({
  cents,
  size = "15",
  tone = "default",
  withSymbol = true,
  signed = false,
  reserveFor,
  loading,
  className,
  ...props
}: MoneyProps) {
  const isLoading = loading ?? cents == null;
  const template = brlWidthTemplate(reserveFor ?? cents);
  const needsSignSlot = signed || (cents ?? 0) < 0;
  const reserve =
    (needsSignSlot ? "-" : "") +
    (withSymbol ? template : template.replace("R$ ", ""));
  const text = isLoading
    ? null
    : formatBRL(cents as number, { withSymbol, signed });

  return (
    <span
      data-numeric
      className={cn(
        "inline-grid shrink-0 align-baseline tabular-nums",
        sizeClass[size],
        tones[tone],
        className,
      )}
      {...props}
    >
      {/* molde invisível: segura a largura, não é lido, não recebe seleção */}
      <span aria-hidden className="invisible col-start-1 row-start-1 select-none">
        {reserve}
      </span>
      {isLoading ? (
        <span
          aria-hidden
          className="zk-skeleton col-start-1 row-start-1 my-[0.15em] rounded-xs"
        />
      ) : (
        <span className="col-start-1 row-start-1 text-right">{text}</span>
      )}
      {isLoading ? <span className="sr-only">Carregando valor</span> : null}
    </span>
  );
}

/**
 * Par rótulo + valor, alinhado pela direita. É o bloco que aparece em card de
 * proposta, resumo de funil e rodapé de tabela.
 */
export function MoneyStat({
  label,
  hint,
  className,
  ...money
}: MoneyProps & { label: string; hint?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-13 font-medium text-muted">{label}</span>
      <Money {...money} />
      {hint ? <span className="text-13 text-muted">{hint}</span> : null}
    </div>
  );
}
