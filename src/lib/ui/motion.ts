import * as React from "react";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Transition } from "motion/react";

/* =============================================================================
   Presets de spring
   -----------------------------------------------------------------------------
   Travados no CLAUDE.md. Não invente número novo: se um movimento pede outra
   sensação, discuta o preset, não faça um one-off no componente.
   ========================================================================== */

/** Padrão da casa. Sem bounce — bounce em UI de produtividade vira brinquedo. */
export const springDefault: Transition = {
  type: "spring",
  bounce: 0,
  duration: 0.35,
};

/** Sheet/drawer. O único lugar com bounce, e pouco: dá peso ao painel. */
export const springSheet: Transition = {
  type: "spring",
  bounce: 0.15,
  duration: 0.3,
};

/** Micro-resposta: pressão de botão, checkbox, realce. Curto pra não atrasar. */
export const springSnap: Transition = {
  type: "spring",
  bounce: 0,
  duration: 0.22,
};

/** Reordenação de layout (kanban). Um pouco mais longo pra ler o caminho. */
export const springLayout: Transition = {
  type: "spring",
  bounce: 0,
  duration: 0.42,
};

export const springs = {
  default: springDefault,
  sheet: springSheet,
  snap: springSnap,
  layout: springLayout,
} as const;

export type SpringName = keyof typeof springs;

/** Transição instantânea: o estado muda, nada se move. */
export const noMotion: Transition = { duration: 0 };

/* =============================================================================
   Física de gesto
   ========================================================================== */

/**
 * Taxa de desaceleração de scroll "normal" do UIKit.
 * Usada para projetar onde um arremesso terminaria.
 */
export const DECELERATION_RATE = 0.998;

/**
 * Projeção de arremesso: dada a velocidade no fim do gesto (px/s), devolve
 * quanto ainda percorreria até parar. `(v / 1000) * d / (1 - d)`.
 *
 * É isso que faz um card arrastado "herdar a velocidade do gesto": a decisão
 * de para qual coluna ele vai não olha só onde o dedo soltou, olha onde o card
 * PARARIA.
 */
export function projectThrow(
  velocity: number,
  decelerationRate: number = DECELERATION_RATE,
): number {
  return (velocity / 1000) * (decelerationRate / (1 - decelerationRate));
}

/** Posição projetada do arremesso a partir do ponto onde o dedo soltou. */
export function projectPosition(
  position: number,
  velocity: number,
  decelerationRate: number = DECELERATION_RATE,
): number {
  return position + projectThrow(velocity, decelerationRate);
}

/**
 * Rubber-banding no estilo iOS. Quanto mais você puxa além do limite, menos
 * a superfície anda — a resistência conta pro dedo que ali acabou.
 *
 * `offset`    quanto passou do limite (px, com sinal)
 * `dimension` tamanho da superfície arrastada (px)
 * `constant`  0.55 é o valor do UIKit
 */
export function rubberBand(
  offset: number,
  dimension: number,
  constant = 0.55,
): number {
  if (dimension <= 0) return 0;
  const sign = offset < 0 ? -1 : 1;
  const distance = Math.abs(offset);
  return sign * (1 - 1 / ((distance * constant) / dimension + 1)) * dimension;
}

/**
 * Aplica rubber-banding só fora do intervalo [min, max]; dentro dele o
 * movimento é 1:1 com o dedo.
 */
export function rubberBandClamp(
  value: number,
  min: number,
  max: number,
  dimension: number,
  constant = 0.55,
): number {
  if (value < min) return min + rubberBand(value - min, dimension, constant);
  if (value > max) return max + rubberBand(value - max, dimension, constant);
  return value;
}

/** O ponto de encaixe mais próximo de `value`. */
export function nearestSnapPoint(value: number, points: readonly number[]): number {
  if (points.length === 0) return value;
  return points.reduce((best, point) =>
    Math.abs(point - value) < Math.abs(best - value) ? point : best,
  );
}

/**
 * Encaixe que respeita o arremesso: projeta a posição final e encaixa lá.
 * É a diferença entre um sheet que "cai onde o dedo largou" e um que
 * continua o gesto.
 */
export function snapWithVelocity(
  position: number,
  velocity: number,
  points: readonly number[],
  decelerationRate: number = DECELERATION_RATE,
): number {
  return nearestSnapPoint(
    projectPosition(position, velocity, decelerationRate),
    points,
  );
}

/**
 * Um gesto "conta" como dispensar quando andou o bastante OU quando foi rápido
 * o bastante. Distância sozinha castiga o flick curto, que é o gesto real no
 * celular.
 */
export function shouldDismiss(
  offset: number,
  velocity: number,
  { distance = 96, speed = 420 }: { distance?: number; speed?: number } = {},
): boolean {
  return offset > distance || velocity > speed;
}

/* =============================================================================
   Preferências do sistema
   ========================================================================== */

const noopSubscribe = () => () => {};

function subscribeToQuery(query: string) {
  return (onChange: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const list = window.matchMedia(query);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  };
}

/**
 * Media query reativa e segura no servidor. No SSR responde `false`, e o
 * primeiro paint no cliente já traz o valor certo — sem flash de layout.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useMemo(() => subscribeToQuery(query), [query]);
  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  }, [query]);
  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(
    typeof window === "undefined" ? noopSubscribe : subscribe,
    getSnapshot,
    getServerSnapshot,
  );
}

/**
 * Força reduced-motion (ligado ou desligado) numa sub-árvore, sem tocar na
 * preferência real do sistema.
 *
 * Existe por um motivo só: o critério de aceite do S2 pede o /kitchen-sink
 * "verificado com reduced-motion ligado", e verificar isso trocando a
 * preferência do SO no meio da conferência — e lembrando de voltar depois —
 * é o tipo de fricção que faz a conferência não acontecer de novo na próxima
 * mudança. Com o override, a página mostra as duas versões lado a lado, e
 * `usePrefersReducedMotion` abaixo simplesmente prefere o override quando
 * existe. Fora do kitchen-sink ninguém deveria usar isto — o normal é ler a
 * preferência real.
 */
const ReducedMotionOverrideContext = React.createContext<boolean | null>(null);

export function ReducedMotionOverride({
  value,
  children,
}: {
  value: boolean;
  children: React.ReactNode;
}) {
  return React.createElement(
    ReducedMotionOverrideContext.Provider,
    { value },
    children,
  );
}

/** `true` quando o usuário pediu menos movimento (ou quando o kitchen-sink forçou). */
export function usePrefersReducedMotion(): boolean {
  const override = React.useContext(ReducedMotionOverrideContext);
  const system = useMediaQuery("(prefers-reduced-motion: reduce)");
  return override ?? system;
}

/** `true` quando o usuário pediu menos transparência (some o blur). */
export function usePrefersReducedTransparency(): boolean {
  return useMediaQuery("(prefers-reduced-transparency: reduce)");
}

/** `true` em ponteiro grosso (dedo). Usado pra alvo de toque e hover. */
export function useCoarsePointer(): boolean {
  return useMediaQuery("(pointer: coarse)");
}

/**
 * O hook que todo componente animado usa.
 *
 * Devolve o preset pedido já filtrado por `prefers-reduced-motion`: com a
 * preferência ligada, a transição vira duração zero — o estado final continua
 * acontecendo, só não há percurso. Nunca desligue a mudança de estado junto
 * com o movimento; o usuário pediu menos animação, não menos informação.
 */
export function useTransitionPreset(name: SpringName = "default"): Transition {
  const reduced = usePrefersReducedMotion();
  return reduced ? noMotion : springs[name];
}

/**
 * Versão completa: dá o preset, o booleano, e um utilitário pra escolher
 * variantes (ex.: entrar deslizando vs. só aparecer).
 */
export function useMotionPreferences(name: SpringName = "default") {
  const reducedMotion = usePrefersReducedMotion();
  const reducedTransparency = usePrefersReducedTransparency();
  const transition = reducedMotion ? noMotion : springs[name];

  const pick = useCallback(
    <T,>(full: T, reduced: T): T => (reducedMotion ? reduced : full),
    [reducedMotion],
  );

  return { reducedMotion, reducedTransparency, transition, pick };
}
