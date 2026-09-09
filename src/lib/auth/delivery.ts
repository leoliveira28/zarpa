/**
 * Envio do magic link.
 *
 * Não há Resend provisionado (CLAUDE.md: "sem credenciais"). Então:
 *   - sem `RESEND_API_KEY`, fora de produção, o link vai para o console — é o que permite
 *     testar o fluxo hoje;
 *   - sem `RESEND_API_KEY`, EM produção, isso lança. Um magic link impresso no log de
 *     produção é uma credencial de acesso à conta do cliente guardada em texto puro num
 *     sistema que meio mundo consulta. Prefiro o login quebrar e alguém ser paginado.
 */

import { isProduction } from '@/db/env';

export type MagicLinkDelivery = { email: string; url: string };

export async function deliverMagicLink({ email, url }: MagicLinkDelivery): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    if (isProduction()) {
      throw new Error(
        'RESEND_API_KEY não configurado: não há como enviar o magic link. ' +
          'Recusando enviar por outro meio — link de login não vai para log.',
      );
    }
    console.info(
      `[auth] magic link para ${maskEmail(email)} (dev, não enviado por e-mail):\n  ${url}`,
    );
    return;
  }

  // Quando a credencial existir, é só isto. Deixado escrito para não virar descoberta
  // no dia do deploy.
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM ?? 'nao-responda@zarpa.app',
      to: email,
      subject: 'Seu link de acesso',
      text: `Entre pelo link abaixo. Ele vale por 10 minutos.\n\n${url}\n`,
    }),
  });

  if (!response.ok) {
    // Não logamos o corpo: pode ecoar o destinatário e o link.
    throw new Error(`Falha ao enviar magic link (HTTP ${response.status}).`);
  }
}

/** `joana@exemplo.com` -> `j****@exemplo.com`. E-mail é dado pessoal; log recebe máscara. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}${'*'.repeat(Math.max(1, at - 1))}${email.slice(at)}`;
}

export type ConviteDelivery = {
  email: string;
  organizationName: string;
  inviterName: string;
  /** Id do convite (`invitation.id`) — a tela de aceite resolve o link. */
  invitationId: string;
};

/**
 * E-mail de convite da Equipe (Fase 3). A mesma doutrina do magic link: sem Resend em
 * dev, vai para o console; em produção, REUSA a mesma chave e recusa se não houver —
 * convite impresso em log de produção é dado pessoal de terceiro (o convidado) exposto.
 * Sem link assinado aqui de propósito: o aceite é pela sessão do convidado na rota do
 * plugin (`authClient.organization.acceptInvitation`), não por link de um toque.
 */
export async function deliverInviteEmail({
  email,
  organizationName,
  inviterName,
  invitationId,
}: ConviteDelivery): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    if (isProduction()) {
      throw new Error(
        'RESEND_API_KEY não configurado: não há como enviar o convite. ' +
          'Recusando enviar por outro meio — e-mail de terceiro não vai para log.',
      );
    }
    console.info(
      `[auth] convite para ${maskEmail(email)} (dev, não enviado por e-mail): ` +
        `organization=${organizationName}, convidou=${maskEmail(inviterName)}, invitationId=${invitationId}`,
    );
    return;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM ?? 'nao-responda@zarpa.app',
      to: email,
      subject: `${inviterName} te convidou para a equipe "${organizationName}"`,
      text:
        `${inviterName} te convidou para fazer parte da equipe "${organizationName}".\n\n` +
        `Entre na sua conta para aceitar o convite (código ${invitationId}).\n`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Falha ao enviar convite (HTTP ${response.status}).`);
  }
}
