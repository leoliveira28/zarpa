-- 0028_lead_no_funil — o interessado vira negócio com um toque (Fit 7c).
--
-- O lead da Vitrine não pode morar só na lista de interessados: a agente
-- transforma interesse em negociação, e negociação é FUNIL. `deal_id`
-- (nullable, SET NULL) registra essa passagem:
--
--   - `null` = interesse ainda não trabalhado (o botão "Criar negócio" fica);
--   - preenchido = o negócio existe no funil, já vinculado ao contato do lead
--     (e o chip do grupo/oferta segue pela cadeia normal).
--
-- SET NULL: apagar o negócio não apaga o interesse — ele volta a "não
-- trabalhado", o que é a leitura honesta.
--
-- Unique parcial: um lead vira negócio UMA vez (a criação é pela action
-- `criarNegocioDoLead`, que também é idempotente por leitura).
--
-- Backfill: nenhum.

ALTER TABLE "offer_leads" ADD COLUMN "deal_id" uuid REFERENCES "deals"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "offer_leads_deal_id_idx" ON "offer_leads" ("deal_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "offer_leads_deal_key" ON "offer_leads" ("deal_id") WHERE "deal_id" IS NOT NULL;
