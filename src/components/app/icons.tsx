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

/** Checagem — rótulo da coluna "Fechada": venda confirmada, não um estado a monitorar. */
export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 8.5 6.5 11.5 12.5 5" />
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

/** Passaporte — caderneta com o brasão simplificado, para o alerta de validade. */
export function PassportIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.25" y="1.75" width="9.5" height="12.5" rx="1.25" />
      <circle cx="8" cy="6.1" r="1.5" />
      <path d="M6 9.4h4M6.5 11.4h3" />
    </Icon>
  );
}

/** Bolo de aniversário — vela única, para o alerta de data de nascimento. */
export function CakeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2.75v1.4" />
      <path d="M7.3 2.1c0 .5.7.5.7 0s.7-.5.7 0" />
      <path d="M2.75 13.25v-4a1.5 1.5 0 0 1 1.5-1.5h7.5a1.5 1.5 0 0 1 1.5 1.5v4Z" />
      <path d="M2.75 10.75c.9.6 1.6.6 2.5 0s1.6-.6 2.5 0 1.6.6 2.5 0 1.6-.6 2.5 0" />
    </Icon>
  );
}

/** Documento — folha com dobra, para CPF/passaporte e itens de importação. */
export function DocumentIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 1.75h4.75L11.5 4.5v9.75h-7Z" />
      <path d="M9.25 1.75V4.5H11.5" />
      <path d="M6 8h3.5M6 10.25h3.5" />
    </Icon>
  );
}

/** Envio — seta subindo para dentro de uma bandeja, para o upload de planilha. */
export function UploadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 10.25v-7.5M5.25 5.25 8 2.5l2.75 2.75" />
      <path d="M2.75 10.75v1.5a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1v-1.5" />
    </Icon>
  );
}

/** Exportar — seta descendo para uma bandeja, para baixar CSV/relatório. */
export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2.25v7.25M5.25 6.75 8 9.5l2.75-2.75" />
      <path d="M2.75 10.75v1.5a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1v-1.5" />
    </Icon>
  );
}

/** Olho fechado — mostrar/esconder documento sensível (CPF, passaporte). */
export function EyeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.5 8s2.6-4.25 6.5-4.25S14.5 8 14.5 8s-2.6 4.25-6.5 4.25S1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.85" />
    </Icon>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.25 2.25l11.5 11.5" />
      <path d="M6.6 4.1A6.9 6.9 0 0 1 8 3.95c3.9 0 6.5 4.05 6.5 4.05a11.4 11.4 0 0 1-2.15 2.55M4.5 5.15C2.6 6.5 1.5 8 1.5 8s2.6 4.25 6.5 4.25c.85 0 1.63-.16 2.32-.43" />
      <path d="M6.6 9.4a1.85 1.85 0 0 0 2.6-2.6" />
    </Icon>
  );
}

/** Balão de conversa — atalho de WhatsApp. Genérico de propósito: nunca o
 * logotipo de terceiro, só a gramática de traço único do resto do sistema. */
export function ChatIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.25 8.1c0-3.1 2.6-5.35 5.75-5.35s5.75 2.25 5.75 5.35-2.6 5.35-5.75 5.35c-.7 0-1.37-.1-1.98-.3l-2.77 1 .75-2.55A5.1 5.1 0 0 1 2.25 8.1Z" />
      <path d="M5.5 7.4h5M5.5 9.4h3.2" />
    </Icon>
  );
}

/** Elo de corrente — copiar/abrir o link público da proposta. */
export function LinkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.6 9.4 9.4 6.6" />
      <path d="M7.3 4.55 8.1 3.75a2.45 2.45 0 0 1 3.47 3.46l-1.02 1.02M8.7 11.45l-.8.8a2.45 2.45 0 0 1-3.47-3.46l1.02-1.02" />
    </Icon>
  );
}

/** Duas folhas sobrepostas — copiar mensagem sugerida para a área de transferência. */
export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5.75" y="5.75" width="7.5" height="8.5" rx="1.1" />
      <path d="M3.75 10.25V3.85a1.1 1.1 0 0 1 1.1-1.1h6.1" />
    </Icon>
  );
}

/** Dinheiro — moeda com duas barras, sem cifrão de nenhuma moeda específica.
 * Nav de "Vendas"/"Financeiro" (S9): o mesmo círculo de sempre (TodayIcon,
 * ClientsIcon), não um cifrão nem uma cédula desenhada. */
export function MoneyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M5.6 6.35h4.8M5.6 9.65h4.8" />
    </Icon>
  );
}

/** Recibo — folha com borda serrilhada e linhas, para a conferência de comissão. */
export function ReceiptIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 1.75h8v12.5l-1.6-1.1-1.4 1.1-1.4-1.1-1.4 1.1-1.4-1.1L4 14.25Z" />
      <path d="M6 5.5h4M6 8h4M6 10.5h2.5" />
    </Icon>
  );
}
