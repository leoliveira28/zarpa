"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/ui/cn";

/* =============================================================================
   Button
   -----------------------------------------------------------------------------
   Duas obsessões aqui:

   1. A pressão responde no `pointerdown`, não no `click`. No celular o `click`
      chega ~100ms depois do dedo encostar (e às vezes nem chega, se o gesto
      virou scroll). Esperar por ele é a diferença entre um app que parece
      colado no dedo e um que parece um site.

   2. Carregando não é spinner. O rótulo continua lá — sumir com o texto é
      apagar a informação de qual ação está em curso — e uma régua fina de
      acento corre embaixo, animada só em `transform: scaleX`.

   3. Todo variante tem CINCO estados desenhados, não três: repouso, hover,
      pressionado, foco e desabilitado. Quem quebrou antes foi o secondary e o
      ghost/quiet, e por dois motivos diferentes:

        - secondary: o contorno era `--border` a 1,41:1 sobre branco. Um botão
          cujo contorno o olho não encontra não é um botão, é um rótulo. A
          correção mora na camada de token (`--border` = 3,78:1); aqui em cima
          o que mudou é que o hover troca de PESO de fio (line -> line-strong),
          não de 5% de cinza.

        - ghost/quiet: o realce era `--surface-3` sobre `--bg`, que dá 1,06:1.
          Ou seja: existia no código e não existia na tela. Agora o realce é o
          FIO — no repouso o contorno é transparente, no hover ele aparece, no
          pressionado ele engrossa de cor. A geometria não muda em estado
          nenhum (a borda transparente já ocupa o lugar dela), então nada pula.

      Nada disso é resolvido com sombra: a direção é de fio, não de elevação —
      e por isso o `shadow-1` que os variantes preenchidos carregavam saiu.
      Ele não estava separando nada que o papel e o contorno já não separem.

   Desabilitado não é `opacity`. Rebaixar a caixa inteira em 45% leva o rótulo
   junto para 3:1, e um controle desabilitado ainda precisa ser LIDO — é ele
   que explica por que a ação não está disponível. Aqui o estado desabilitado
   tem cor própria (superfície rebaixada + `--text-subtle`, 4,7:1 ou mais) e
   mora em `data-disabled`, e não em `:disabled`, para não pintar de cinza o
   botão que está apenas carregando.
   ========================================================================== */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "quiet";
type Size = "sm" | "md" | "lg";

const base = cn(
  "relative inline-flex select-none items-center justify-center gap-2",
  "whitespace-nowrap font-medium",
  // o percurso da pressão: só transform e opacity, 120ms, interrompível
  "[transition:transform_120ms_var(--curve-out),background-color_120ms_var(--curve-out),border-color_120ms_var(--curve-out),opacity_120ms_var(--curve-out)]",
  "data-[pressed]:scale-[0.97]",
  // a borda existe em todo variante, mesmo transparente: é ela que reserva o
  // lugar para o fio aparecer no hover sem mover um pixel do rótulo
  "border",
  "disabled:pointer-events-none data-[disabled]:pointer-events-none",
  "data-[busy]:cursor-progress",
  // toque nunca pinta o retângulo cinza do Android/iOS
  "touch-manipulation",
);

/* Estado desabilitado: rótulo em `--text-subtle` (4,72:1 sobre --surface-3,
   5,15 sobre o papel) e o fio no peso mais fraco. Some a affordance, fica a
   legibilidade. Quem é preenchido cai para uma superfície morta; quem é
   transparente continua transparente — um ghost desabilitado que ganha caixa
   cinza vira outro componente. */
const deadFilled = cn(
  "data-[disabled]:border-line-subtle data-[disabled]:bg-surface-3",
  "data-[disabled]:text-subtle",
);

const deadBare = cn(
  "data-[disabled]:border-transparent data-[disabled]:bg-transparent",
  "data-[disabled]:text-subtle",
);

const variants: Record<Variant, string> = {
  primary: cn(
    "border-transparent bg-accent text-on-accent",
    "hover:bg-accent-hover",
    "data-[pressed]:bg-accent-active",
    deadFilled,
  ),
  secondary: cn(
    "border-line bg-surface text-ink",
    // o hover troca o PESO do fio: 3,78:1 -> 5,30:1. É mudança que se vê.
    "hover:border-line-strong hover:bg-surface-2",
    "data-[pressed]:border-line-strong data-[pressed]:bg-surface-3",
    deadFilled,
  ),
  ghost: cn(
    // repouso: só o rótulo (17,85:1). O fio está reservado e transparente.
    "border-transparent bg-transparent text-ink",
    "hover:border-line hover:bg-surface-3",
    "data-[pressed]:border-line-strong data-[pressed]:bg-surface-3",
    deadBare,
  ),
  quiet: cn(
    // igual ao ghost, um degrau abaixo no repouso: rótulo em --text-muted.
    "border-transparent bg-transparent text-muted",
    "hover:border-line hover:bg-surface-3 hover:text-ink",
    "data-[pressed]:border-line-strong data-[pressed]:bg-surface-3 data-[pressed]:text-ink",
    deadBare,
  ),
  danger: cn(
    "border-transparent bg-danger text-on-accent",
    "hover:bg-danger-hover",
    "data-[pressed]:bg-danger-hover",
    deadFilled,
  ),
};

/* Altura em múltiplos de 4. `md` fica em 40px no desktop e cresce pro alvo de
   toque de 44px em ponteiro grosso — o agente vive no celular. */
const sizes: Record<Size, string> = {
  sm: "h-8 rounded-md px-3 text-13 [@media(pointer:coarse)]:h-9",
  md: "h-10 rounded-md px-4 text-15 [@media(pointer:coarse)]:h-11",
  lg: "h-12 rounded-lg px-5 text-17 [@media(pointer:coarse)]:h-12",
};

const iconOnlySizes: Record<Size, string> = {
  sm: "w-8 px-0 [@media(pointer:coarse)]:w-9",
  md: "w-10 px-0 [@media(pointer:coarse)]:w-11",
  lg: "w-12 px-0",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Ação em curso: mantém o rótulo, marca `aria-busy`, corre a régua. */
  loading?: boolean;
  /** Botão só de ícone — exige `aria-label`. */
  iconOnly?: boolean;
  /** Ocupa a largura toda (padrão nas ações principais do mobile). */
  block?: boolean;
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant = "secondary",
      size = "md",
      loading = false,
      iconOnly = false,
      block = false,
      asChild = false,
      disabled,
      children,
      onPointerDown,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
      ...props
    },
    ref,
  ) {
    const [pressed, setPressed] = React.useState(false);
    const Comp = asChild ? Slot : "button";

    const release = React.useCallback(() => setPressed(false), []);

    return (
      <Comp
        ref={ref}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        aria-disabled={asChild && disabled ? true : undefined}
        // desabilitado E parado. Carregando também chega ao DOM como
        // `disabled` (para não aceitar um segundo clique), mas ele não é um
        // estado morto: mantém a cor do variante e a régua correndo.
        data-disabled={disabled && !loading ? "" : undefined}
        data-pressed={pressed && !disabled && !loading ? "" : undefined}
        data-busy={loading ? "" : undefined}
        data-variant={variant}
        className={cn(
          base,
          variants[variant],
          sizes[size],
          iconOnly && iconOnlySizes[size],
          block && "w-full",
          className,
        )}
        onPointerDown={(event: React.PointerEvent<HTMLButtonElement>) => {
          // resposta no toque, antes de qualquer click
          if (!disabled && !loading) setPressed(true);
          onPointerDown?.(event);
        }}
        onPointerUp={(event: React.PointerEvent<HTMLButtonElement>) => {
          release();
          onPointerUp?.(event);
        }}
        onPointerCancel={(event: React.PointerEvent<HTMLButtonElement>) => {
          release();
          onPointerCancel?.(event);
        }}
        onPointerLeave={(event: React.PointerEvent<HTMLButtonElement>) => {
          release();
          onPointerLeave?.(event);
        }}
        {...props}
      >
        {/* O Slot (asChild) exige UM filho elemento — children + régua dá
            "Slot failed to slot onto its children" em toda tela que usa
            Button asChild (achado do PO ao clicar: banner de assinatura e
            CTAs de estado vazio). Sem asChild, button próprio: children +
            régua. Nenhum uso atual combina asChild com loading. */}
        {asChild ? children : (
          <>
            {children}
            {loading ? <BusyRule /> : null}
          </>
        )}
      </Comp>
    );
  },
);

/** Régua indeterminada. Anima `transform` e nada mais. Keyframes em globals.css. */
function BusyRule() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-1 bottom-[3px] h-[2px] overflow-hidden rounded-pill"
    >
      <span className="absolute inset-0 rounded-pill bg-current opacity-25" />
      <span className="zk-busy-bar absolute inset-y-0 left-0 w-1/3 rounded-pill bg-current" />
    </span>
  );
}
