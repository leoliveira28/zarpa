"use client";

import * as React from "react";
import { cn } from "@/lib/ui/cn";
import { brlWidthTemplate, formatBRL } from "@/lib/ui/format";
import { usePrefersReducedMotion } from "@/lib/ui/motion";

/* =============================================================================
   Money — o componente mais importante do produto.
   -----------------------------------------------------------------------------
   O agente confere valor de venda, custo e comissão dezenas de vezes por dia.
   Se o número muda de largura entre o skeleton e o valor, ou entre R$ 990,00 e
   R$ 1.100,00, a coluna inteira treme e a leitura vertical morre.

   Três garantias:

     1. `tabular-nums`: todo dígito ocupa a mesma largura.

     2. largura reservada: um molde invisível na mesma célula de grid segura o
        espaço. O valor real nunca é mais estreito que o molde, então o layout
        não pula quando o dado chega nem quando ele muda.

     3. o NÚMERO QUE ROLA (300ms). É o único movimento tipográfico expressivo
        do produto — o resto do sistema é subtração. Ele existe porque um valor
        que troca sozinho na tela (o cliente aceitou, a comissão recalculou)
        precisa dizer que trocou; trocar em silêncio faz a agente conferir duas
        vezes, e conferir duas vezes é desconfiança.

   Como o rolo é feito, e por que não é do jeito óbvio:
   cada dígito vira uma célula com um caractere invisível dentro. Esse caractere
   é quem define largura, altura e LINHA DE BASE da célula — exatamente as do
   texto normal. Por cima dele corre uma fita de 0-9 duas vezes, deslocada em
   `translateY` de -5% por dígito (5% de vinte células = uma célula cravada).
   Assim o dígito parado cai no mesmo pixel em que cairia sem componente nenhum:
   o número rola e NÃO PULA. Só `transform` anima.
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

/** 300ms, travado no CLAUDE.md. Não é um número para ajustar por tela. */
const ROLL_MS = 300;

/** A fita: 0-9 duas vezes, para o rolo sempre descer, inclusive no 9 → 0. */
const STRIP = "01234567890123456789".split("");

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
  /**
   * Desliga o rolo. Para lugares onde o valor muda a cada tecla digitada
   * (campo de edição), em que rolar viraria tremor.
   */
  still?: boolean;
  /**
   * De que lado o valor encosta dentro da largura reservada.
   *
   * `right` (padrão) é o certo em TABELA e em qualquer lugar onde valores
   * empilham um sobre o outro: alinhar pela unidade é o que deixa comparar
   * magnitude sem ler.
   *
   * `left` é o certo dentro de um CARD, onde o valor é um campo e não uma
   * coluna: ali ele tem que encostar na mesma margem do nome e do destino,
   * senão a reserva de largura aparece como recuo aleatório — três linhas
   * alinhadas à esquerda e uma flutuando.
   */
  align?: "left" | "right";
}

export function Money({
  cents,
  size = "15",
  tone = "default",
  withSymbol = true,
  signed = false,
  reserveFor,
  loading,
  still = false,
  align = "right",
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
        <span
          className={cn(
            "col-start-1 row-start-1",
            align === "right" ? "text-right" : "text-left",
          )}
        >
          {still ? text : <RollingText text={text as string} />}
        </span>
      )}
      {isLoading ? <span className="sr-only">Carregando valor</span> : null}
    </span>
  );
}

/* ------------------------------------------------------------------- o rolo */

/**
 * Rende o texto e, quando ele muda, rola os dígitos que mudaram.
 *
 * O texto vivo para leitor de tela é um só (`aria-live` fica por conta de quem
 * usa o Money; aqui o conteúdo é lido normalmente). A fita é `aria-hidden`.
 */
function RollingText({ text }: { text: string }) {
  const reducedMotion = usePrefersReducedMotion();

  // Estado derivado: `from` é o valor de onde estamos saindo. Entrar em cena
  // não conta como mudar — o primeiro valor não rola, ele simplesmente está lá.
  const [phase, setPhase] = React.useState<{
    shown: string;
    from: string | null;
    /** A fita já recebeu o dígito de destino? Ver o efeito abaixo. */
    armed: boolean;
  }>({ shown: text, from: null, armed: false });

  if (phase.shown !== text) {
    // desarmado de propósito: a fita tem que NASCER no dígito antigo
    setPhase({ shown: text, from: phase.shown, armed: false });
  }

  const { from, armed } = phase;

  // Arma no quadro seguinte. Se o destino já viesse no primeiro render, o
  // navegador não teria de onde animar e o dígito trocaria seco.
  React.useEffect(() => {
    if (from === null || armed) return;
    const frame = requestAnimationFrame(() =>
      setPhase((current) => ({ ...current, armed: true })),
    );
    return () => cancelAnimationFrame(frame);
  }, [from, armed]);

  // Terminado o percurso, volta a ser texto comum: a fita não fica de
  // lembrança no DOM de cada linha de uma tabela de cem propostas.
  React.useEffect(() => {
    if (from === null || !armed) return;
    const done = window.setTimeout(
      () => setPhase((current) => ({ ...current, from: null })),
      ROLL_MS + 60,
    );
    return () => window.clearTimeout(done);
  }, [from, armed]);

  if (from === null || reducedMotion) {
    return <>{text}</>;
  }

  // Alinha pela DIREITA: em número o que fica parado é a unidade, não a
  // centena. "R$ 990,00" -> "R$ 1.100,00" mantém os centavos no lugar.
  const width = Math.max(from.length, text.length);
  const before = from.padStart(width, " ");
  const after = text.padStart(width, " ");

  return (
    <>
      {/* o valor real, para seleção, cópia e leitor de tela */}
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {Array.from({ length: width }, (_, index) => {
          const from = before[index];
          const to = after[index];
          const rolls = isDigit(from) && isDigit(to) && from !== to;
          if (!rolls) {
            // caractere que não rola (R$, ponto, vírgula, sinal, ou dígito que
            // não mudou) já aparece no valor final
            return <React.Fragment key={index}>{to}</React.Fragment>;
          }
          return (
            <RollingDigit
              key={index}
              from={Number(from)}
              to={Number(to)}
              armed={armed}
            />
          );
        })}
      </span>
    </>
  );
}

function RollingDigit({
  from,
  to,
  armed,
}: {
  from: number;
  to: number;
  armed: boolean;
}) {
  // sempre desce: 7 -> 2 vira 7 -> 12 na fita de vinte, passando pelo zero.
  // Rolo que às vezes sobe e às vezes desce parece defeito, não mecanismo.
  const target = to >= from ? to : to + 10;
  const index = armed ? target : from;

  return (
    // sem overflow AQUI de propósito: uma caixa inline-block com overflow
    // recortado passa a ter a linha de base na borda de baixo, e o número
    // inteiro sobe um fio de nada. O recorte fica na camada absoluta.
    <span className="relative inline-block align-baseline">
      {/* Este dígito invisível é a régua da célula: largura tabular, altura de
          uma linha e, principalmente, a linha de base. */}
      <span className="invisible select-none">0</span>
      <span className="absolute inset-0 overflow-hidden">
        <span
          className="block"
          style={{
            // a fita tem vinte células; 5% dela é uma célula cravada
            transform: `translateY(${index * -5}%)`,
            transition: `transform ${ROLL_MS}ms var(--curve-out)`,
            willChange: "transform",
          }}
        >
          {STRIP.map((digit, position) => (
            <span key={position} className="block">
              {digit}
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

/**
 * Par rótulo + valor. É o bloco que aparece em card de proposta, resumo de
 * funil e rodapé de tabela.
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
