import { processarWebhookAsaas, verificarWebhookAsaas } from '@/server';

/**
 * Webhook do Asaas (S11). O Asaas notifica pagamentos e mudanças de assinatura
 * aqui — `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `SUBSCRIPTION_CANCELED`, etc.
 *
 * Sem sessão: o chamador é o Asaas, não um agente. A única proteção é o token de
 * máquina (`ASAAS_WEBHOOK_TOKEN`), checado por `verificarWebhookAsaas` — header
 * `asaas-access-token` ou query `access_token`, comparação em tempo constante.
 * Sem token configurado (dev/teste), `verificarWebhookAsaas` devolve `true` para
 * não travar o fluxo local; em produção o PO define `ASAAS_WEBHOOK_TOKEN`.
 *
 * `processarWebhookAsaas` é idempotente pelo `asaasPaymentId` (uniqueIndex parcial
 * em `payments`) — o Asaas pode reenviar o mesmo evento em retry, e a segunda
 * chamada atualiza a linha existente em vez de duplicar. Por isso devolvemos 200
 * mesmo para "assinatura não encontrada" / "evento não tratado": o Asaas não tem
 * como corrigir nada que reenviar resolvesse, e 200 o impede de entrar em loop de
 * retry. Só devolvemos 5xx numa exceção de verdade (banco caiu) — nesse caso o
 * retry do Asaas ajuda.
 */
export async function POST(request: Request): Promise<Response> {
  // `verificarWebhookAsaas` lê header + query; constrói o objeto no shape dele.
  const url = new URL(request.url);
  const ok = verificarWebhookAsaas({
    headers: Object.fromEntries(request.headers),
    searchParams: url.searchParams,
  });
  if (!ok) {
    return new Response('unauthorized', { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    // Corpo não-JSON: o Asaas sempre manda JSON; se chegar outra coisa, não há
    // nada a processar. 200 pra não reencaminhar um payload que não faz sentido.
    return Response.json({ processado: false, motivo: 'corpo não-JSON' });
  }

  try {
    // `PayloadWebhookAsaas` tem todos os campos opcionais — o processador já
    // trata payload incompleto devolvendo `{ processado: false, motivo }`. O
    // cast é só pra satisfazer o TS: `request.json()` volta `unknown`.
    const resultado = await processarWebhookAsaas(
      payload as Parameters<typeof processarWebhookAsaas>[0],
    );
    return Response.json(resultado);
  } catch (erro) {
    // Erro real (ex.: banco cair): 500 faz o Asaas tentar de novo mais tarde.
    console.error('[asaas/webhook] erro ao processar', erro);
    return new Response('internal error', { status: 500 });
  }
}

/** GET no webhook não faz sentido — o Asaas sempre POSTa. 405 explícito. */
export function GET(): Response {
  return new Response('method not allowed', { status: 405 });
}
