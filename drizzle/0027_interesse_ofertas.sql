-- 0027_interesse_ofertas — o interessado da Vitrine vira cliente (Fit 7b).
--
-- O CTA "Tenho interesse" da página pública captura NOME + WHATSAPP (início —
-- o Google entra depois, quando houver credencial OAuth). O que acontece no
-- servidor, em UMA transação:
--
--   1. a oferta é resolvida por (slug da agência, public_token) — publicada,
--      senão recusa sem pista de qual dos dois falhou;
--   2. o contato é REUSADO quando o WhatsApp já é cliente da casa (mesma
--      pessoa não vira dois contatos), criado com tag `vitrine` quando novo;
--   3. a linha em `offer_leads` é idempotente por (oferta, contato) — o duplo
--      toque não cria dois interesses.
--
-- `ip_hash` (blind index do IP) alimenta o throttle simples da action: mais de
-- N leads do mesmo IP na hora é abuso de robô, e a recusa é genérica (não dá
-- pista de limite a quem testa o endpoint).
--
-- RLS: ENABLE + FORCE + policy de isolamento — a escrita passa por
-- `withTenant` (a action descobre o tenant pela oferta publicada via GUC de
-- contexto público, MESMA porta da leitura da 0026). Nenhuma policy de escape
-- hatch nova: a descoberta usa a `offers_public_read` que já existe.
--
-- Backfill: nenhum — entidade nova.

CREATE TABLE "offer_leads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  -- CASCADE: sem contato o lead não tem significado (a ficha junta pelo join).
  "offer_id" uuid NOT NULL REFERENCES "offers"("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
  -- WhatsApp cru (a ficha liga o wa.me dele); o dedupe de contato é por ele.
  "whatsapp" text,
  -- Blind index do IP (mesma via de `proposal_views.ip_hash`) para o throttle.
  "ip_hash" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "offer_leads_whatsapp_check" CHECK ("whatsapp" IS NULL OR char_length("whatsapp") BETWEEN 8 AND 20)
);
--> statement-breakpoint
CREATE INDEX "offer_leads_tenant_created_idx" ON "offer_leads" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "offer_leads_offer_id_idx" ON "offer_leads" ("offer_id");
--> statement-breakpoint
-- O duplo toque NÃO cria dois interesses: o segundo lead atualiza o registro
-- (a action faz upsert pelo conflito).
CREATE UNIQUE INDEX "offer_leads_offer_contact_key" ON "offer_leads" ("offer_id", "contact_id");
--> statement-breakpoint

ALTER TABLE "offer_leads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "offer_leads" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "offer_leads_isolation" ON "offer_leads"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
