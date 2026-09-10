"use client";

import { authClient } from "@/lib/auth/client";
import type { PapelDoMembro } from "@/server";

/* =============================================================================
   equipeApi — as escritas da Equipe falam com o PLUGIN, não com @/server
   -----------------------------------------------------------------------------
   §13.2 do handoff: convite, cancelar convite, mudar papel e remover membro
   são endpoints NATIVOS do plugin `organization` do Better Auth. NÃO existe
   action própria em `@/server` para isso — e o erro NÃO vem como ServiceResult:
   vem no formato do better-auth, `{ error: { message, status } }`.

   Este módulo é a costura: traduz o formato do plugin para o PAR (mensagem em
   pt-BR + correção) que a interface da casa espera, e devolve um resultado
   fechado para a tela nunca ver JSON cru.

   O `organizationClient()` está no ar (e79b6f1, §14.1 do handoff): o
   `authClient.organization` existe em TIPO, então as chamadas são diretas — a
   interface local que tipava o cast se aposentou. Os tradutores de erro ficam:
   o shape do plugin client casa no `RespostaDoPlugin` daqui, e a recusa de
   limite ("membership limit") continua sendo o caso que mais importa.

   REGRA DO §14.1 (não esquecer nas próximas mutações): o plugin aceita
   `organizationId` OPCIONAL em `updateMemberRole`/`removeMember`, mas SEM ele
   a rota resolve a "organization ativa" da SESSÃO — e esta casa NÃO mantém
   `activeOrganizationId`. Todo método que o plugin deixa opcional aqui é
   OBRIGATÓRIO na assinatura: é o id do tenant (o id da organization É o id do
   tenant, 0019), o mesmo que o convite já manda.
   ========================================================================== */

/** Resposta crua do plugin — só o que a tradução lê. */
type RespostaDoPlugin<T> = {
  data?: T | null;
  error?: {
    message?: string | null;
    status?: number;
    code?: string | null;
  } | null;
};

/* ------------------------------------------------------------------ resultado */

export type RecusaDeEquipe = {
  codigo:
    | "limite_de_assentos"
    | "sessao_expirada"
    | "sem_permissao"
    | "ja_participa"
    | "outro";
  /** O que aconteceu, no vocabulário de quem vende viagem. */
  mensagem: string;
  /** Rótulo do botão de correção — o erro da casa nunca vem sem saída. */
  correcao?: string;
};

export type ResultadoDeEscrita =
  | { ok: true }
  | { ok: false; recusa: RecusaDeEquipe };

/** Traduz `{ error: { message, status } }` do plugin para mensagem + correção. */
function traduzir(error: NonNullable<RespostaDoPlugin<unknown>["error"]>): RecusaDeEquipe {
  const raw = (error.message ?? "").toLowerCase();

  // O gate de assentos mora no `membershipLimit` do plugin (aponta para
  // `subscriptions.seats_paid`) — recusa o convite N+1 na criação e no aceite.
  if (raw.includes("membership limit") || raw.includes("invitation limit")) {
    return {
      codigo: "limite_de_assentos",
      mensagem: "Não há assento livre — cada pessoa da equipe ocupa um assento.",
      correcao: "Ajustar assentos",
    };
  }
  if (raw.includes("already a member") || raw.includes("already invited") || raw.includes("already exists")) {
    return {
      codigo: "ja_participa",
      mensagem: "Essa pessoa já está na equipe ou já tem convite pendente.",
    };
  }
  if (raw.includes("forbidden") || error.status === 403) {
    return {
      codigo: "sem_permissao",
      mensagem: "Só o dono da conta faz isso.",
    };
  }
  if (error.status === 401 || raw.includes("unauthorized")) {
    return {
      codigo: "sessao_expirada",
      mensagem: "Sua sessão expirou.",
      correcao: "Entrar de novo",
    };
  }
  if (error.status === 0 || raw.includes("fetch failed") || raw.includes("network")) {
    return {
      codigo: "outro",
      mensagem: "Não conseguimos falar com o servidor agora.",
      correcao: "Tentar de novo",
    };
  }
  return {
    codigo: "outro",
    mensagem: "Não consegui completar essa ação agora.",
    correcao: "Tentar de novo",
  };
}

async function comoResultadoDeEscrita(
  call: () => Promise<RespostaDoPlugin<unknown>>,
): Promise<ResultadoDeEscrita> {
  try {
    const resposta = await call();
    if (resposta.error) return { ok: false, recusa: traduzir(resposta.error) };
    return { ok: true };
  } catch {
    return {
      ok: false,
      recusa: {
        codigo: "outro",
        mensagem: "Não conseguimos falar com o servidor agora.",
        correcao: "Tentar de novo",
      },
    };
  }
}

/* ------------------------------------------------------------------- as quatro */

/** Envia o convite. O gate de assentos do plugin recusa o N+1 aqui.
    NOTA DE NOMES: o método CLIENT é `inviteMember` (o nome vem do PATH
    `/organization/invite-member`), não `createInvitation` — que é o nome do
    endpoint NO SERVIDOR (`auth.api.createInvitation`). É a mesma rota, o
    mesmo input e o mesmo gate; só o rótulo do lado do browser difere. */
export function convidarMembro(input: {
  email: string;
  role: PapelDoMembro;
  /** O id da organization É o id do tenant (0019). Explícito de propósito. */
  organizationId: string;
}): Promise<ResultadoDeEscrita> {
  return comoResultadoDeEscrita(() =>
    authClient.organization.inviteMember(input),
  );
}

/** Cancela um convite pendente. Quem desfazer precisa fazer é RECONVIDAR — a tela sabe. */
export function cancelarConvite(invitationId: string): Promise<ResultadoDeEscrita> {
  return comoResultadoDeEscrita(() =>
    authClient.organization.cancelInvitation({ invitationId }),
  );
}

/** Muda o papel de um membro (o rótulo é da tela; o valor é o nativo do plugin). */
export function mudarPapelDoMembro(input: {
  memberId: string;
  role: PapelDoMembro;
  /** Opcional no schema do plugin, OBRIGATÓRIO aqui — ver a regra do §14.1 no cabeçalho. */
  organizationId: string;
}): Promise<ResultadoDeEscrita> {
  return comoResultadoDeEscrita(() =>
    authClient.organization.updateMemberRole(input),
  );
}

/** Remove um membro. O desfazer da tela é reconvidar pelo e-mail e pelo papel antigos. */
export function removerMembro(input: {
  memberIdOrEmail: string;
  /** Opcional no schema do plugin, OBRIGATÓRIO aqui — ver a regra do §14.1 no cabeçalho. */
  organizationId: string;
}): Promise<ResultadoDeEscrita> {
  return comoResultadoDeEscrita(() =>
    authClient.organization.removeMember(input),
  );
}
