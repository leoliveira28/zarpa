import { sql } from 'drizzle-orm';
import { unsafeDbWithoutTenant } from '../../db/client';
import type { TenantDb } from './withTenant';

/**
 * `withWebhookContext` — a porta de fuga controlada para o webhook do Asaas (S11).
 *
 * O webhook chega sem sessão: é o Asaas quem chama, não um agente. Ele precisa
 * descobrir qual tenant é dono da assinatura a partir do `asaasSubscriptionId`
 * do payload, para SÓ ENTÃO abrir `withTenant(tenantId, ...)` e processar o
 * evento. Mas `subscriptions` tem `FORCE ROW LEVEL SECURITY` e a policy
 * `subscriptions_isolation` exige `app.tenant_id` — sem ele, o SELECT devolve
 * zero linhas (o role `zarpa` é NOBYPASSRLS, então `unsafeDbWithoutTenant` não
 * bypassa).
 *
 * Esta função liga o GUC `app.webhook_context = 'on'`, local à transação, do
 * mesmo jeito que `withPlatformContext` liga `app.platform_context`. A policy
 * `subscriptions_webhook_read` (`drizzle/0010_webhook_context.sql`) concede
 * SELECT em `subscriptions` SÓ quando este GUC está ligado. A leitura acontece
 * aqui dentro; o `tenantId` resolvido é usado para abrir `withTenant` real na
 * sequência, e a escrita (em `payments`/`subscriptions`) passa pelo contexto
 * de tenant de verdade.
 *
 * Ressalva válida aqui igual à de `withPlatformContext`: um GUC é forjável por
 * SQL arbitrário. Não é regressão (quem executa SQL arbitrário já forja
 * `app.tenant_id`), mas por isso o alcance da policy foi mantido mínimo — só
 * SELECT em `subscriptions`, só para resolver o tenant, nunca escrita.
 */
export async function withWebhookContext<T>(
  callback: (tx: TenantDb) => Promise<T>,
): Promise<T> {
  return unsafeDbWithoutTenant.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.webhook_context', 'on', true)`);
    return callback(tx);
  });
}
