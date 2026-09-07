-- 0009_planos_e_assinatura — S11: catálogo de planos + vínculo de assinatura.
--
-- `subscriptions` e `payments` já nasceram em `0000_fundacao.sql` com RLS (policy
-- `subscriptions_isolation` e `payments_isolation` contra `app.tenant_id`). Esta
-- migration NÃO recria essas tabelas — apenas adiciona `plan_id` a `subscriptions`
-- (FK para o catálogo novo de `plans`) e cria a tabela `plans`.
--
-- `invoices` do contrato S11 é a tabela `payments` existente: mesma semântica
-- (cobrança da assinatura do SaaS via Asaas), já com RLS e índice único de
-- idempotência em `asaas_payment_id`. A camada de actions expõe `listarFaturas()`
-- lendo de `payments` e mapeando status (`confirmed`/`received` -> `paid`). Decisão
-- documentada em `docs/status/rafa.md` — criar `invoices` paralela a `payments`
-- seria duplicação com a mesma semântica.
--
-- `plans` é catálogo GLOBAL (sem `tenant_id`), como `user`/`session` do Better
-- Auth. Diferente dessas (que guardam credencial e têm policy restritiva
-- `app.auth_context = 'on'`), `plans` é dado público de preços: policy `USING(true)`
-- permite leitura a qualquer conexão. Sem `WITH CHECK`: escrita negada sob RLS para
-- o role da aplicação (NOBYPASSRLS) — o seed roda nesta migration como superuser,
-- que bypassa RLS mesmo com FORCE. Se no futuro o admin precisar editar planos,
-- cria-se policy separada.

CREATE TABLE "plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "price_cents" bigint NOT NULL,
  "currency" text NOT NULL DEFAULT 'BRL',
  "description" text,
  "features" jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "plans_slug_check" CHECK ("slug" IN ('solo', 'pro', 'studio')),
  CONSTRAINT "plans_currency_check" CHECK ("currency" IN ('BRL')),
  CONSTRAINT "plans_price_check" CHECK ("price_cents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "plans_slug_key" ON "plans" ("slug");
--> statement-breakpoint
CREATE INDEX "plans_active_idx" ON "plans" ("is_active") WHERE "is_active" = true;
--> statement-breakpoint

ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "plans" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "plans_read" ON "plans" USING (true);
--> statement-breakpoint

-- Seed dos 3 planos. `ON CONFLICT (slug) DO NOTHING` para ser re-entrante.
INSERT INTO "plans" ("slug", "name", "price_cents", "currency", "description", "is_active")
VALUES
  ('solo', 'Solo', 4900, 'BRL', 'Para o agente que trabalha sozinho', true),
  ('pro', 'Pro', 9900, 'BRL', 'O plano mais popular', true),
  ('studio', 'Studio', 19900, 'BRL', 'Para agências pequenas', true)
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint

-- `subscriptions` ganha `plan_id` FK -> `plans`. Nullable: rows já existentes (se
-- houver) não têm o vínculo ainda. `plan` (enum text) permanece como fallback — a
-- camada de actions prefere `plan_id` quando presente e cai para `plan` se não.
ALTER TABLE "subscriptions" ADD COLUMN "plan_id" uuid REFERENCES "plans" ("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "subscriptions_plan_id_idx" ON "subscriptions" ("plan_id");
--> statement-breakpoint
-- Backfill defensivo: casa `plan` (enum existente) com `plans.slug`. Hoje não há
-- rows em `subscriptions` neste banco, mas o UPDATE é inócuo se a tabela estiver
-- vazia e corrige qualquer row órfã se já existir.
UPDATE "subscriptions"
SET "plan_id" = "plans"."id"
FROM "plans"
WHERE "subscriptions"."plan_id" IS NULL
  AND "subscriptions"."plan" = "plans"."slug";
