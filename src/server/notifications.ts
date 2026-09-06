/**
 * "Seu cliente abriu" — notificação de primeira abertura da proposta pública.
 *
 * Mesma doutrina de `src/lib/auth/delivery.ts` (magic link) e `src/server/storage.ts`
 * (upload de imagem): sem `RESEND_API_KEY`, cai em log estruturado — aqui SEMPRE, não só
 * fora de produção, porque isto não é credencial de acesso (diferente do magic link, cuja
 * ausência de e-mail em produção é erro fatal por design). Perder um "seu cliente abriu"
 * é ruim para o produto; vazar um link de login é incidente de segurança. Os dois merecem
 * tratamento diferente.
 *
 * Não é `'use server'`: é chamado de dentro de `src/server/publicProposals.ts` (que é),
 * não é uma Server Action em si — mesmo desenho de `enviarImagem`/`storage.ts`.
 *
 * `contactName`/`toEmail` NUNCA vão para o `console.info` de dev por inteiro — e-mail é
 * dado pessoal do AGENTE (não do cliente final, mas ainda assim mascarado, mesmo padrão
 * de `maskEmail` em `delivery.ts`) e o nome do cliente fica de fora do log por padrão:
 * o log de desenvolvedor não precisa saber quem é o passageiro para provar que o
 * mecanismo disparou.
 */

import { maskEmail } from '@/lib/auth/delivery';

export type NotificacaoAberturaProposta = {
  /** E-mail do AGENTE (dono do tenant) — nunca do cliente final. `null` = tenant sem e-mail cadastrado. */
  toEmail: string | null;
  proposalTitle: string;
  contactName: string;
  /** URL de onde a agente pode ver a proposta / o negócio, dentro do próprio app. */
  appUrl: string;
};

const RESULTADOS = {
  ENVIADO: 'enviado',
  SEM_DESTINATARIO: 'sem_destinatario',
  DEV_LOGADO: 'dev_logado',
  FALHOU: 'falhou',
} as const;

export type ResultadoNotificacao = (typeof RESULTADOS)[keyof typeof RESULTADOS];

export async function notificarAberturaDeProposta(
  input: NotificacaoAberturaProposta,
): Promise<ResultadoNotificacao> {
  if (!input.toEmail) {
    console.info(
      `[notifications] proposta "${input.proposalTitle}" foi aberta pela primeira vez, ` +
        'mas este tenant não tem e-mail de contato cadastrado — nada para notificar.',
    );
    return RESULTADOS.SEM_DESTINATARIO;
  }

  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.info(
      `[notifications] (dev, não enviado por e-mail) ${maskEmail(input.toEmail)}: ` +
        `"${input.proposalTitle}" foi aberta pela primeira vez. ${input.appUrl}`,
    );
    return RESULTADOS.DEV_LOGADO;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM ?? 'nao-responda@zarpa.app',
      to: input.toEmail,
      subject: `${input.contactName} abriu sua proposta`,
      text:
        `Boas notícias! ${input.contactName} acabou de abrir "${input.proposalTitle}".\n\n` +
        `Veja o negócio: ${input.appUrl}\n`,
    }),
  });

  if (!response.ok) {
    // Não logamos o corpo da resposta: pode ecoar o destinatário.
    console.error(`[notifications] falha ao notificar abertura (HTTP ${response.status}).`);
    return RESULTADOS.FALHOU;
  }
  return RESULTADOS.ENVIADO;
}
