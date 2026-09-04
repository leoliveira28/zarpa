-- 0000_fundacao — schema v1 do Zarpa + RLS por tenant.
--
-- Convenções desta migration (Rafa, S1):
--   * Todo timestamp é `timestamptz`. Nunca `timestamp`.
--   * Todo id de domínio é `uuid` gerado na aplicação (UUID v7, ordenável por tempo).
--     `gen_random_uuid()` fica como default de segurança para INSERT feito na mão via psql.
--   * Ids das tabelas do Better Auth são `text` — é o que a lib gera. Não brigamos com ela.
--   * Dinheiro é `bigint` em centavos. Nunca float.
--   * Toda FK tem índice. Toda tabela com listagem tem índice em (tenant_id, created_at desc).
--   * Toda tabela com `tenant_id` nasce com RLS ENABLE **e FORCE**.
--     FORCE é obrigatório: o role `zarpa` é DONO das tabelas, e dono ignora RLS sem FORCE.
--     Sem FORCE esta migration passaria e o isolamento seria uma ficção.
--   * A policy compara com `nullif(current_setting('app.tenant_id', true), '')::uuid`.
--     - `true` no segundo argumento => devolve NULL se o GUC nunca foi setado (não estoura).
--     - `nullif(...,'')` => devolve NULL se foi setado como string vazia (o cast de '' para
--       uuid estouraria e viraria erro 500 em vez de "zero linhas").
--     - `tenant_id = NULL` é NULL, que não é TRUE: a linha não passa. Falha fechado.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------

CREATE TABLE "tenants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "plan" text NOT NULL DEFAULT 'solo',
  "status" text NOT NULL DEFAULT 'trialing',
  "brand_name" text,
  "brand_logo_url" text,
  "brand_primary_color" text,
  "brand_secondary_color" text,
  "contact_email" text,
  "contact_phone" text,
  "whatsapp" text,
  "document_encrypted" text,
  "locale" text NOT NULL DEFAULT 'pt-BR',
  "currency" text NOT NULL DEFAULT 'BRL',
  "timezone" text NOT NULL DEFAULT 'America/Sao_Paulo',
  "trial_ends_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tenants_plan_check" CHECK ("plan" IN ('solo', 'pro', 'studio')),
  CONSTRAINT "tenants_status_check" CHECK ("status" IN ('trialing', 'active', 'past_due', 'canceled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants" ("slug");
--> statement-breakpoint
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A própria tenants é isolada por `id` (ela não tem tenant_id: ela É o tenant).
-- Criar um tenant exige set_config('app.tenant_id', <id novo>) ANTES do INSERT — é o que
-- `withTenant` faz. Efeito colateral desejado: não existe INSERT de tenant sem contexto.
CREATE POLICY "tenants_isolation" ON "tenants"
  USING ("id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- O serviço de auth precisa resolver o tenant do usuário antes de existir contexto de tenant.
CREATE POLICY "tenants_auth_service" ON "tenants"
  USING (current_setting('app.auth_context', true) = 'on')
  WITH CHECK (current_setting('app.auth_context', true) = 'on');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Better Auth: user / session / account / verification
--
-- Nomes de tabela no singular porque é o default do Better Auth — mapear é uma
-- fonte de bug a troco de nada.
--
-- `session`, `account` e `verification` NÃO têm tenant_id (o vínculo é via user), mas
-- guardam credencial (hash de senha, token de sessão, token de magic link). Elas ganham
-- RLS mesmo assim, com uma única policy: só o contexto do serviço de auth enxerga.
-- Uma conexão de tenant comum não lê hash de senha de ninguém — nem do próprio tenant.
-- ---------------------------------------------------------------------------

CREATE TABLE "user" (
  "id" text PRIMARY KEY,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "email_verified" boolean NOT NULL DEFAULT false,
  "image" text,
  "role" text NOT NULL DEFAULT 'owner',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_role_check" CHECK ("role" IN ('owner', 'agent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_key" ON "user" ("email");
--> statement-breakpoint
CREATE INDEX "user_tenant_id_idx" ON "user" ("tenant_id");
--> statement-breakpoint
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "user_isolation" ON "user"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "user_auth_service" ON "user"
  USING (current_setting('app.auth_context', true) = 'on')
  WITH CHECK (current_setting('app.auth_context', true) = 'on');
--> statement-breakpoint

CREATE TABLE "session" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "token" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_key" ON "session" ("token");
--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" ("user_id");
--> statement-breakpoint
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "session" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "session_auth_service" ON "session"
  USING (current_setting('app.auth_context', true) = 'on')
  WITH CHECK (current_setting('app.auth_context', true) = 'on');
--> statement-breakpoint

CREATE TABLE "account" (
  "id" text PRIMARY KEY,
  "account_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamptz,
  "refresh_token_expires_at" timestamptz,
  "scope" text,
  "password" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_key" ON "account" ("provider_id", "account_id");
--> statement-breakpoint
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "account" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "account_auth_service" ON "account"
  USING (current_setting('app.auth_context', true) = 'on')
  WITH CHECK (current_setting('app.auth_context', true) = 'on');
--> statement-breakpoint

CREATE TABLE "verification" (
  "id" text PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");
--> statement-breakpoint
ALTER TABLE "verification" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "verification" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "verification_auth_service" ON "verification"
  USING (current_setting('app.auth_context', true) = 'on')
  WITH CHECK (current_setting('app.auth_context', true) = 'on');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- people: contacts, travelers
-- CPF / passaporte / nascimento entram cifrados (AES-256-GCM na aplicação).
-- Por isso são `text`, não `date`: o que está gravado é ciphertext com key_id.
-- ---------------------------------------------------------------------------

CREATE TABLE "contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "email" text,
  "phone" text,
  "whatsapp" text,
  "document_encrypted" text,
  "birth_date_encrypted" text,
  "source" text,
  "tags" text[] NOT NULL DEFAULT '{}',
  "notes" text,
  "archived_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "contacts_source_check" CHECK ("source" IS NULL OR "source" IN ('whatsapp', 'instagram', 'indicacao', 'site', 'evento', 'outro'))
);
--> statement-breakpoint
CREATE INDEX "contacts_tenant_created_idx" ON "contacts" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "contacts_tenant_name_idx" ON "contacts" ("tenant_id", lower("name"));
--> statement-breakpoint
CREATE INDEX "contacts_tenant_phone_idx" ON "contacts" ("tenant_id", "phone");
--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_tenant_email_key" ON "contacts" ("tenant_id", lower("email")) WHERE "email" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "contacts_isolation" ON "contacts"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

CREATE TABLE "travelers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "contacts" ("id") ON DELETE CASCADE,
  "full_name" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'adult',
  "cpf_encrypted" text,
  "passport_number_encrypted" text,
  "passport_expires_on" date,
  "birth_date_encrypted" text,
  "nationality" text NOT NULL DEFAULT 'BR',
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "travelers_kind_check" CHECK ("kind" IN ('adult', 'child', 'infant'))
);
--> statement-breakpoint
CREATE INDEX "travelers_tenant_created_idx" ON "travelers" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "travelers_contact_id_idx" ON "travelers" ("contact_id");
--> statement-breakpoint
ALTER TABLE "travelers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "travelers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "travelers_isolation" ON "travelers"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- pipeline: deals, tasks, activities
-- ---------------------------------------------------------------------------

CREATE TABLE "deals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "contacts" ("id") ON DELETE RESTRICT,
  "title" text NOT NULL,
  "destination" text,
  "stage" text NOT NULL DEFAULT 'novo',
  "currency" text NOT NULL DEFAULT 'BRL',
  "value_cents" bigint NOT NULL DEFAULT 0,
  "cost_cents" bigint NOT NULL DEFAULT 0,
  "commission_cents" bigint NOT NULL DEFAULT 0,
  "pax_adults" integer NOT NULL DEFAULT 1,
  "pax_children" integer NOT NULL DEFAULT 0,
  "departure_on" date,
  "return_on" date,
  "expected_close_on" date,
  "lost_reason" text,
  "closed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "deals_stage_check" CHECK ("stage" IN ('novo', 'cotando', 'proposta_enviada', 'negociando', 'ganho', 'perdido')),
  CONSTRAINT "deals_dates_check" CHECK ("return_on" IS NULL OR "departure_on" IS NULL OR "return_on" >= "departure_on")
);
--> statement-breakpoint
CREATE INDEX "deals_tenant_created_idx" ON "deals" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "deals_tenant_stage_idx" ON "deals" ("tenant_id", "stage");
--> statement-breakpoint
CREATE INDEX "deals_contact_id_idx" ON "deals" ("contact_id");
--> statement-breakpoint
ALTER TABLE "deals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "deals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "deals_isolation" ON "deals"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

CREATE TABLE "tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "deal_id" uuid REFERENCES "deals" ("id") ON DELETE CASCADE,
  "contact_id" uuid REFERENCES "contacts" ("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "notes" text,
  "kind" text NOT NULL DEFAULT 'followup',
  "due_at" timestamptz NOT NULL,
  "done_at" timestamptz,
  "created_by" text REFERENCES "user" ("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tasks_kind_check" CHECK ("kind" IN ('followup', 'ligar', 'whatsapp', 'email', 'outro'))
);
--> statement-breakpoint
CREATE INDEX "tasks_tenant_created_idx" ON "tasks" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
-- Índice parcial: a tela que importa é "o que está aberto e vence quando".
CREATE INDEX "tasks_tenant_open_due_idx" ON "tasks" ("tenant_id", "due_at") WHERE "done_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "tasks_deal_id_idx" ON "tasks" ("deal_id");
--> statement-breakpoint
CREATE INDEX "tasks_contact_id_idx" ON "tasks" ("contact_id");
--> statement-breakpoint
CREATE INDEX "tasks_created_by_idx" ON "tasks" ("created_by");
--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tasks_isolation" ON "tasks"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- proposals: proposals, proposal_options, proposal_blocks, proposal_views
-- ---------------------------------------------------------------------------

CREATE TABLE "proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "deal_id" uuid NOT NULL REFERENCES "deals" ("id") ON DELETE CASCADE,
  "public_token" text NOT NULL,
  "title" text NOT NULL,
  "summary" text,
  "status" text NOT NULL DEFAULT 'draft',
  "currency" text NOT NULL DEFAULT 'BRL',
  "cover_image_url" text,
  "terms" text,
  "brand_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "valid_until" date,
  "accepted_option_id" uuid,
  "view_count" integer NOT NULL DEFAULT 0,
  "sent_at" timestamptz,
  "first_viewed_at" timestamptz,
  "last_viewed_at" timestamptz,
  "accepted_at" timestamptz,
  "declined_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "proposals_status_check" CHECK ("status" IN ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired'))
);
--> statement-breakpoint
-- O token público é a chave do link do WhatsApp. Único global, não por tenant.
CREATE UNIQUE INDEX "proposals_public_token_key" ON "proposals" ("public_token");
--> statement-breakpoint
CREATE INDEX "proposals_tenant_created_idx" ON "proposals" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "proposals_tenant_status_idx" ON "proposals" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX "proposals_deal_id_idx" ON "proposals" ("deal_id");
--> statement-breakpoint
ALTER TABLE "proposals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "proposals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "proposals_isolation" ON "proposals"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

CREATE TABLE "proposal_options" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "proposal_id" uuid NOT NULL REFERENCES "proposals" ("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "position" integer NOT NULL DEFAULT 0,
  "price_cents" bigint NOT NULL DEFAULT 0,
  "cost_cents" bigint NOT NULL DEFAULT 0,
  "commission_cents" bigint NOT NULL DEFAULT 0,
  "installments" integer,
  "installment_cents" bigint,
  "is_recommended" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "proposal_options_price_check" CHECK ("price_cents" >= 0 AND "cost_cents" >= 0)
);
--> statement-breakpoint
CREATE INDEX "proposal_options_tenant_created_idx" ON "proposal_options" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "proposal_options_proposal_position_idx" ON "proposal_options" ("proposal_id", "position");
--> statement-breakpoint
ALTER TABLE "proposal_options" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "proposal_options" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "proposal_options_isolation" ON "proposal_options"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "proposals"
  ADD CONSTRAINT "proposals_accepted_option_id_fk"
  FOREIGN KEY ("accepted_option_id") REFERENCES "proposal_options" ("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "proposals_accepted_option_id_idx" ON "proposals" ("accepted_option_id");
--> statement-breakpoint

CREATE TABLE "proposal_blocks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "proposal_id" uuid NOT NULL REFERENCES "proposals" ("id") ON DELETE CASCADE,
  "option_id" uuid REFERENCES "proposal_options" ("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  "title" text,
  "body" text,
  "content" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "proposal_blocks_kind_check" CHECK ("kind" IN ('text', 'image', 'flight', 'hotel', 'transfer', 'tour', 'cruise', 'insurance', 'price_note'))
);
--> statement-breakpoint
CREATE INDEX "proposal_blocks_tenant_created_idx" ON "proposal_blocks" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "proposal_blocks_proposal_position_idx" ON "proposal_blocks" ("proposal_id", "position");
--> statement-breakpoint
CREATE INDEX "proposal_blocks_option_id_idx" ON "proposal_blocks" ("option_id");
--> statement-breakpoint
ALTER TABLE "proposal_blocks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "proposal_blocks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "proposal_blocks_isolation" ON "proposal_blocks"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- "sabe quando o cliente abriu" — uma linha por abertura do link.
-- IP nunca é gravado em claro: `ip_hash` é HMAC do IP. LGPD.
CREATE TABLE "proposal_views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "proposal_id" uuid NOT NULL REFERENCES "proposals" ("id") ON DELETE CASCADE,
  "session_key" text,
  "ip_hash" text,
  "user_agent" text,
  "referrer" text,
  "country" text,
  "duration_ms" integer,
  "viewed_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "proposal_views_tenant_created_idx" ON "proposal_views" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "proposal_views_proposal_viewed_idx" ON "proposal_views" ("proposal_id", "viewed_at" DESC);
--> statement-breakpoint
ALTER TABLE "proposal_views" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "proposal_views" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "proposal_views_isolation" ON "proposal_views"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- pipeline (parte 2): activities — depende de deals E proposals
-- ---------------------------------------------------------------------------

CREATE TABLE "activities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "deal_id" uuid REFERENCES "deals" ("id") ON DELETE CASCADE,
  "contact_id" uuid REFERENCES "contacts" ("id") ON DELETE CASCADE,
  "proposal_id" uuid REFERENCES "proposals" ("id") ON DELETE CASCADE,
  "actor_user_id" text REFERENCES "user" ("id") ON DELETE SET NULL,
  "type" text NOT NULL,
  "body" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "activities_type_check" CHECK ("type" IN ('note', 'stage_changed', 'proposal_sent', 'proposal_viewed', 'proposal_accepted', 'task_done', 'message', 'contact_created'))
);
--> statement-breakpoint
CREATE INDEX "activities_tenant_created_idx" ON "activities" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "activities_tenant_deal_occurred_idx" ON "activities" ("tenant_id", "deal_id", "occurred_at" DESC);
--> statement-breakpoint
CREATE INDEX "activities_contact_id_idx" ON "activities" ("contact_id");
--> statement-breakpoint
CREATE INDEX "activities_proposal_id_idx" ON "activities" ("proposal_id");
--> statement-breakpoint
CREATE INDEX "activities_actor_user_id_idx" ON "activities" ("actor_user_id");
--> statement-breakpoint
ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "activities" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "activities_isolation" ON "activities"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- money: subscriptions, payments (Asaas)
-- ---------------------------------------------------------------------------

CREATE TABLE "subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "provider" text NOT NULL DEFAULT 'asaas',
  "asaas_customer_id" text,
  "asaas_subscription_id" text,
  "plan" text NOT NULL,
  "status" text NOT NULL DEFAULT 'trialing',
  "billing_cycle" text NOT NULL DEFAULT 'monthly',
  "amount_cents" bigint NOT NULL,
  "current_period_start" date,
  "current_period_end" date,
  "trial_ends_at" timestamptz,
  "canceled_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "subscriptions_plan_check" CHECK ("plan" IN ('solo', 'pro', 'studio')),
  CONSTRAINT "subscriptions_status_check" CHECK ("status" IN ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  CONSTRAINT "subscriptions_cycle_check" CHECK ("billing_cycle" IN ('monthly', 'yearly'))
);
--> statement-breakpoint
CREATE INDEX "subscriptions_tenant_created_idx" ON "subscriptions" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_asaas_subscription_key" ON "subscriptions" ("asaas_subscription_id") WHERE "asaas_subscription_id" IS NOT NULL;
--> statement-breakpoint
-- Um tenant tem no máximo UMA assinatura viva. Histórico de canceladas pode acumular.
CREATE UNIQUE INDEX "subscriptions_one_live_per_tenant" ON "subscriptions" ("tenant_id") WHERE "status" IN ('trialing', 'active', 'past_due');
--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "subscriptions_isolation" ON "subscriptions"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

CREATE TABLE "payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "subscription_id" uuid REFERENCES "subscriptions" ("id") ON DELETE SET NULL,
  "provider" text NOT NULL DEFAULT 'asaas',
  "asaas_payment_id" text,
  "amount_cents" bigint NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "method" text,
  "due_on" date,
  "paid_at" timestamptz,
  "invoice_url" text,
  "receipt_url" text,
  "pix_payload" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "payments_status_check" CHECK ("status" IN ('pending', 'confirmed', 'received', 'overdue', 'refunded', 'canceled')),
  CONSTRAINT "payments_method_check" CHECK ("method" IS NULL OR "method" IN ('pix', 'credit_card', 'boleto'))
);
--> statement-breakpoint
CREATE INDEX "payments_tenant_created_idx" ON "payments" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "payments_subscription_id_idx" ON "payments" ("subscription_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payments_asaas_payment_key" ON "payments" ("asaas_payment_id") WHERE "asaas_payment_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "payments_isolation" ON "payments"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- platform: audit_log
-- Append-only por policy: existe policy de SELECT e de INSERT, e NÃO existe de
-- UPDATE/DELETE. Sem policy permissiva, o comando é negado — inclusive para o dono
-- da tabela, porque RLS está em FORCE. Log que dá pra editar não é log.
-- ---------------------------------------------------------------------------

CREATE TABLE "audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "actor_user_id" text REFERENCES "user" ("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "entity" text NOT NULL,
  "entity_id" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "ip_hash" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "audit_log_tenant_created_idx" ON "audit_log" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "audit_log_tenant_entity_idx" ON "audit_log" ("tenant_id", "entity", "entity_id");
--> statement-breakpoint
CREATE INDEX "audit_log_actor_user_id_idx" ON "audit_log" ("actor_user_id");
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "audit_log_select" ON "audit_log" FOR SELECT
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "audit_log_insert" ON "audit_log" FOR INSERT
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
