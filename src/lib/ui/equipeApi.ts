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

   FURO REGISTRADO (docs/handoffs/nina-para-rafa.md): `src/lib/auth/client.ts`
   (dele) não tem `organizationClient()` no array de plugins — o `authClient`
   não conhece os métodos de organização em TEMPO DE TIPO. Em RUNTIME não há
   problema: o client do better-auth é um proxy dinâmico de rotas, então
   `authClient.organization.createInvitation(...)` resolve para
   POST /organization/create-invitation, que o server plugin atende. A interface
   local `AuthOrganization` abaixo tipa só os quatro métodos que a Equipe usa;
   no dia em que o `organizationClient()` entrar, ela pode se aposentar e os
   tipos passam a vir da lib. A guarda `organization == null` mantém a tela
   viva e honesta caso a rota não exista em alguma build.
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

/** Os quatro métodos de `authClient.organization` que a tela Equipe fala. */
type AuthOrganization = {
  createInvitation: (input: {
    email: string;
    role: PapelDoMembro;
    /** O id da organization É o id do tenant (0019). Explícito de propósito: a sessão desta casa não mantém "organization ativa" do plugin. */
    organizationId: string;
    resend?: boolean;
  }) => Promise<RespostaDoPlugin<unknown>>;
  cancelInvitation: (input: { invitationId: string }) => Promise<RespostaDoPlugin<unknown>>;
  updateMemberRole: (input: {
    memberId: string;
    role: PapelDoMembro;
  }) => Promise<RespostaDoPlugin<unknown>>;
  removeMember: (input: { memberIdOrEmail: string }) => Promise<RespostaDoPlugin<unknown>>;
};

function organizacao(): AuthOrganization | null {
  const candidate = authClient as unknown as {
    organization?: AuthOrganization | null;
  };
  return candidate.organization ?? null;
}

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

const SEM_ROTA: RecusaDeEquipe = {
  codigo: "outro",
  mensagem:
    "A parte da equipe que fala com o servidor não está disponível nesta build.",
  correcao: "Tentar de novo",
};

async function comoResultadoDeEscrita(
  call: (organization: AuthOrganization) => Promise<RespostaDoPlugin<unknown>>,
): Promise<ResultadoDeEscrita> {
  const organization = organizacao();
  if (!organization) return { ok: false, recusa: SEM_ROTA };
  try {
    const resposta = await call(organization);
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

/** Envia o convite. O gate de assentos do plugin recusa o N+1 aqui. */
export function convidarMembro(input: {
  email: string;
  role: PapelDoMembro;
  organizationId: string;
}): Promise<ResultadoDeEscrita> {
  return comoResultadoDeEscrita((organization) =>
    organization.createInvitation(input),
  );
}

/** Cancela um convite pendente. Quem desfazer precisa fazer é RECONVIDAR — a tela sabe. */
export function cancelarConvite(invitationId: string): Promise<ResultadoDeEscrita> {
  return comoResultadoDeEscrita((organization) =>
    organization.cancelInvitation({ invitationId }),
  );
}

/** Muda o papel de um membro (o rótulo é da tela; o valor é o nativo do plugin). */
export function mudarPapelDoMembro(input: {
  memberId: string;
  role: PapelDoMembro;
}): Promise<ResultadoDeEscrita> {
  return comoResultadoDeEscrita((organization) =>
    organization.updateMemberRole(input),
  );
}

/** Remove um membro. O desfazer da tela é reconvidar pelo e-mail e pelo papel antigos. */
export function removerMembro(memberId: string): Promise<ResultadoDeEscrita> {
  return comoResultadoDeEscrita((organization) =>
    organization.removeMember({ memberIdOrEmail: memberId }),
  );
}
