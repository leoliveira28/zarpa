import * as React from "react";
import { cn } from "@/lib/ui/cn";
import { Rule } from "@/components/plates";

/* =============================================================================
   Card — base, fuste, capitel
   -----------------------------------------------------------------------------
   REESCRITO na direção Papel e Pedra. A versão anterior tinha borda nos quatro
   lados, e isso é o oposto do que a direção pede:

     "O fio horizontal é cornija: separa registros, não envolve caixas."

   O que define um card agora é PAPEL — uma superfície um degrau acima do fundo,
   com um raio de 14 e uma sombra curta que só o desgruda da página. O fio entra
   uma vez, na horizontal, entre uma faixa e outra. Nunca em volta.

   E a estrutura é a proporção emprestada da arquitetura antiga:

     cabeçalho  1 módulo   (base)     — quem é este registro
     corpo      4 módulos  (fuste)    — o conteúdo, que é o motivo do card
     rodapé     1 módulo   (capitel)  — UMA ação em destaque

   O módulo é `--card-band` (44px, a mesma altura do alvo de toque). As faixas
   curtas nascem com altura mínima de um módulo e o corpo com quatro, então um
   card não consegue nascer com cabeçalho gordo e corpo espremido — que é como
   todo painel de dashboard termina.

   Sobre a segunda ação: se o rodapé precisa de duas, a segunda VIRA TEXTO
   (`secondary`). Dois botões lado a lado no mesmo peso não são duas opções,
   são uma pergunta que a interface não soube responder.
   ========================================================================== */

type CardTone = "default" | "raised" | "inset" | "accent" | "warn";

/* A separação vem da superfície e do fio, não de um contorno. A tonalidade
   `accent`/`warn` é fundo, e o texto de status carrega a cor forte. */
const tones: Record<CardTone, string> = {
  default: "bg-surface shadow-1",
  raised: "bg-surface shadow-2",
  inset: "bg-inset",
  accent: "bg-accent-soft",
  warn: "bg-warn-soft",
};

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: CardTone;
  /** Card clicável: ganha realce de hover e resposta de pressão. */
  interactive?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, tone = "default", interactive, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-card=""
      className={cn(
        // flex-col para que <Rule /> entre como faixa entre as bandas
        "flex flex-col rounded-lg",
        tones[tone],
        interactive &&
          cn(
            "cursor-pointer [transition:transform_120ms_var(--curve-out),box-shadow_160ms_var(--curve-out)]",
            "hover:shadow-2",
            "active:scale-[0.995]",
          ),
        className,
      )}
      {...props}
    />
  );
});

/**
 * Base — faixa curta. Um módulo de altura, e o fio logo abaixo separando o
 * cabeçalho do corpo. `rule={false}` para o card de uma faixa só (tile de
 * número), onde não há dois registros para separar.
 */
export function CardHeader({
  className,
  rule = true,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { rule?: boolean }) {
  return (
    <>
      <div
        className={cn(
          "card-band flex shrink-0 items-center justify-between gap-4 px-4 py-3",
          className,
        )}
        {...props}
      >
        {children}
      </div>
      {rule ? <Rule /> : null}
    </>
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  // 17px, system-ui. Display (Libre Franklin) é só título de PÁGINA — um card
  // não é uma página, e display em título de card vira ruído nas quinze
  // aberturas por dia.
  return (
    <h3
      className={cn("truncate text-17 font-semibold text-ink", className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-13 text-muted", className)} {...props} />;
}

/** Fuste — quatro módulos. É onde o conteúdo mora e onde o card ganha altura. */
export function CardBody({
  className,
  /** Tile curto (um número, uma linha): dispensa os quatro módulos. */
  flush = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { flush?: boolean }) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-3 px-4 py-4",
        !flush && "card-shaft",
        className,
      )}
      {...props}
    />
  );
}

export interface CardFooterProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** A ÚNICA ação em destaque. Um botão, não uma barra de botões. */
  action?: React.ReactNode;
  /** A segunda ação, se existir. Vira texto — nunca um segundo botão. */
  secondary?: React.ReactNode;
  /** Contexto curto à esquerda: prazo, valor, "salvo às 14:20". */
  children?: React.ReactNode;
  rule?: boolean;
}

/**
 * Capitel — faixa curta, fio em cima. Uma ação em destaque à direita; o que
 * sobra à esquerda é contexto, não outro botão.
 */
export function CardFooter({
  className,
  action,
  secondary,
  children,
  rule = true,
  ...props
}: CardFooterProps) {
  return (
    <>
      {rule ? <Rule /> : null}
      <div
        className={cn(
          "card-band flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5",
          className,
        )}
        {...props}
      >
        {children ? (
          <div className="min-w-0 flex-1 text-13 text-muted">{children}</div>
        ) : (
          <div className="flex-1" />
        )}
        {secondary}
        {action}
      </div>
    </>
  );
}

/**
 * A segunda ação do rodapé. Texto sublinhado no hover, altura de alvo de toque,
 * sem fundo e sem contorno: ela precisa ser alcançável, não disputada.
 */
export const CardAction = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(function CardAction({ className, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "shrink-0 rounded-xs text-13 font-medium text-muted",
        "transition-colors duration-[120ms]",
        "hover:text-ink hover:underline hover:underline-offset-4",
        "disabled:pointer-events-none disabled:opacity-45",
        "[@media(pointer:coarse)]:min-h-11",
        className,
      )}
      {...props}
    />
  );
});

/**
 * Título de seção — o registro acima do card.
 *
 * Aqui é onde a cornija tem função de verdade: ela fecha o registro anterior e
 * abre este. Por isso o fio nasce ligado, e não em volta de nada.
 */
export function SectionHeading({
  className,
  children,
  action,
  rule = true,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  action?: React.ReactNode;
  rule?: boolean;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      <div
        className="flex items-baseline justify-between gap-4 pb-2"
        {...props}
      >
        <h2 className="text-13 font-semibold tracking-[0.04em] text-muted uppercase">
          {children}
        </h2>
        {action}
      </div>
      {rule ? <Rule className="mb-3" /> : null}
    </div>
  );
}
