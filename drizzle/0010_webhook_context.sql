-- 0010_webhook_context — porta de fuga para o webhook do Asaas (S11).
--
-- PROBLEMA (encontrado pelo Téo, `docs/handoffs/teo-para-rafa.md`):
-- `processarWebhookAsaas` (`src/server/billing.ts`) chega sem sessão — é o Asaas
-- quem chama, não um agente. Ele precisa descobrir qual tenant é dono da
-- assinatura a partir do `asaasSubscriptionId` do payload, para SÓ ENTÃO abrir
-- `withTenant(tenantId, ...)` e processar o evento. Mas `subscriptions` tem
-- `FORCE ROW LEVEL SECURITY` desde `0000_fundacao.sql`, e a policy
-- `subscriptions_isolation` exige `tenant_id = current_setting('app.tenant_id')`.
-- Sem `app.tenant_id`, o SELECT devolve ZERO linhas. O role `zarpa` é
-- NOBYPASSRLS de propósito (ver CLAUDE.md), então `unsafeDbWithoutTenant` NÃO
-- bypassa a policy — o webhook sempre caía em "assinatura não encontrada" e
-- nunca processava pagamento nenhum.
--
-- SOLUÇÃO, mesmo padrão de `app.proposal_public_context` (`0004`) e
-- `app.platform_context` (`0003`): uma QUARTA policy em `subscriptions`, que
-- só concede SELECT quando o GUC `app.webhook_context` está ligado. Esse GUC é
-- ligado DENTRO de `withWebhookContext` (`src/lib/tenant/withWebhookContext.ts`),
-- local à transação, e em NENHUM outro lugar. Consequência:
--
--   - a policy `subscriptions_webhook_read` só abre quando alguém já está
--     DENTRO do helper do webhook; nunca por SQL arbitrário solto (quem executa
--     SQL arbitrário já forja `app.tenant_id`, não é regressão);
--   - é SELECT ONLY (`FOR SELECT`) — o webhook só PRECISA ler `id`/`tenant_id`/
--     `status` para abrir contexto; a escrita continua passando por
--     `withTenant` (com `app.tenant_id` real) dentro de `processarEventoPagamento`;
--   - o alcance é MÍNIMO — só `subscriptions`, só leitura, só a coluna que
--     resolve o tenant. `payments` (onde o webhook também escreve) continua sob
--     `payments_isolation` normal; a escrita em `payments` acontece DEPOIS de
--     `withTenant` aberto com o `tenantId` resolvido, então a policy de tenant
--     já está ativa.
--
-- Nenhuma tabela nova, nenhuma coluna nova — só uma policy. RLS continua
-- íntegro: fora do helper do webhook, `subscriptions` continua invisível sem
-- `app.tenant_id`.

CREATE POLICY "subscriptions_webhook_read" ON "subscriptions"
  FOR SELECT
  USING (current_setting('app.webhook_context', true) = 'on');
