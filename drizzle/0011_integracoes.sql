-- 0011_integracoes — S12: contas de fornecedor (Wooba + Infotravel) por tenant, só cotação.
--
-- Cada tenant traz a SUA conta Wooba/Infotravel. As credenciais (API key, agency id,
-- o que o provider pedir) vivem encriptadas com AES-256-GCM (mesma infra de PII de
-- `src/lib/crypto/pii.ts`). O adapter recebe a credencial DECRYPTED dentro de
-- `withTenant` — nunca passa pela cliente, nunca vai para log.
--
-- COTAÇÃO SÓ. Esta tabela não reserva nada. `buscarHoteis`/`obterCotacao` são
-- pull de preço/availability; booking com pagamento/cancelamento é o "motor de
-- reservas", fora do v1. A coluna `provider` é enum text com CHECK — mesmo
-- padrão de `plans.slug` (`0009`) e `subscriptions.status` (`0000`): o Drizzle
-- modela como text com check, não como pgEnum, para manter o enum no SQL e
-- fora do gerador.
--
-- RLS nasce AQUI (regra 1 do CLAUDE.md — não abre exceção). Padrão idêntico ao de
-- toda tabela simples de tenant (`sales_isolation` em `0007`, `deals_isolation`
-- em `0000`): uma policy `USING`+`WITH CHECK` contra
-- `nullif(current_setting('app.tenant_id', true), '')::uuid`.
-- FORCE é obrigatório: o role `zarpa` é DONO da tabela, e dono ignora RLS sem FORCE.
--
-- `credentials_ciphertext` é o envelope `zp1.<key_id>.<iv>.<tag>.<ct>` que
-- `encryptPII` devolve. `key_id` é redundante com o `key_id` embutido no envelope
-- — está aqui para que um job de rotação consiga achar "quais linhas foram cifradas
-- com a chave X" sem parsear o envelope. Mesma decisão que `tenants.document_encrypted`
-- tomou em `0000` (cifrado na aplicação, key_id no envelope).

CREATE TABLE "integrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "label" text NOT NULL,
  "credentials_ciphertext" text NOT NULL,
  "key_id" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "integrations_provider_check" CHECK ("provider" IN ('wooba', 'infotravel'))
);
--> statement-breakpoint
-- O limite de tamanho de `label` (2–100) é barrado pela camada de actions com zod.
-- O banco garante NOT NULL; o zod garante o limite. Não há CHECK de length aqui porque
-- `length()` em CHECK depende da codificação e o Drizzle não modela de forma portável.
--> statement-breakpoint
CREATE INDEX "integrations_tenant_provider_idx" ON "integrations" ("tenant_id", "provider");
--> statement-breakpoint
CREATE INDEX "integrations_tenant_active_idx" ON "integrations" ("tenant_id", "is_active") WHERE "is_active" = true;
--> statement-breakpoint
CREATE INDEX "integrations_tenant_created_idx" ON "integrations" ("tenant_id", "created_at" DESC);
--> statement-breakpoint

ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integrations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "integrations_isolation" ON "integrations"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
