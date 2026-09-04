import * as React from "react";

/* =============================================================================
   Ícones
   -----------------------------------------------------------------------------
   Desenhados aqui, em grade de 16, traço 1.5, pontas arredondadas — nenhuma
   biblioteca. Um pacote de ícones traz junto a personalidade dele, e é por aí
   que uma interface começa a parecer template.

   Todos herdam `currentColor` e `size-*` da classe que recebem.
   ========================================================================== */

type IconProps = React.SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

/** Hoje — um sol baixo sobre a linha do horizonte, não um calendário genérico. */
export function TodayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.75 11.5h12.5" />
      <path d="M5 11.5a3 3 0 0 1 6 0" />
      <path d="M8 2.5v1.4M3.4 4.4l1 1M12.6 4.4l-1 1" />
      <path d="M3.5 14h9" />
    </Icon>
  );
}

/** Funil — colunas de kanban de alturas diferentes. */
export function FunnelIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2" y="2.5" width="3.2" height="11" rx="1" />
      <rect x="6.4" y="2.5" width="3.2" height="7.5" rx="1" />
      <rect x="10.8" y="2.5" width="3.2" height="4.5" rx="1" />
    </Icon>
  );
}

/** Propostas — folha com uma dobra e duas linhas. */
export function ProposalIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.25 2.25h5.2L12.75 6.5v7.25H3.25z" />
      <path d="M8.35 2.4V6.5h4.2" />
      <path d="M5.75 9.25h4.5M5.75 11.5h3" />
    </Icon>
  );
}

/** Clientes — duas pessoas, a de trás só sugerida. */
export function ClientsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6.25" cy="5.75" r="2.35" />
      <path d="M1.9 13.4a4.45 4.45 0 0 1 8.7 0" />
      <path d="M10.6 3.9a2.3 2.3 0 0 1 .35 4.4" />
      <path d="M11.8 9.9a4.2 4.2 0 0 1 2.4 3.5" />
    </Icon>
  );
}

/** Mais — para a ação principal. */
export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 3.5v9M3.5 8h9" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="7.2" cy="7.2" r="4.45" />
      <path d="m10.5 10.5 3 3" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6.25 4 4 4-4 4" />
    </Icon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 4.75V8l2.25 1.4" />
    </Icon>
  );
}

/** Olho aberto — "o cliente abriu a proposta", o evento central do produto. */
export function OpenedIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.5 8s2.6-4.25 6.5-4.25S14.5 8 14.5 8s-2.6 4.25-6.5 4.25S1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.85" />
    </Icon>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.25 6.75a3.75 3.75 0 0 1 7.5 0c0 3 1.1 4 1.1 4H3.15s1.1-1 1.1-4Z" />
      <path d="M6.6 13a1.6 1.6 0 0 0 2.8 0" />
    </Icon>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2.25 9.3 6.2l3.95 1.3-3.95 1.3L8 12.75 6.7 8.8 2.75 7.5 6.7 6.2z" />
    </Icon>
  );
}
