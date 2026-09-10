-- 0025_grupos — o pacote com lugares (meta Grupos, `docs/GRUPOS_META.md`, rodada 6a).
--
-- A agente monta a saída ANTES de vender: "Fátima 2027, 10 lugares, voo +
-- hospedagem + transfer, custo R$ 4.000/lugar, vendo a R$ 5.500". O grupo é o
-- PRODUTO; os clientes/negócios vão ocupando lugares.
--
-- `groups` — a ficha do pacote:
--   `total_seats` (10) e os QUATRO NÚMEROS DA VENDA em escala de lugar
--   (`price_per_seat`, `cost_per_seat`, `commission_per_seat`,
--   `service_fee_per_seat` — custo/comissão/taxa FOTOGRAFADOS como a agente
--   digitou, mesma doutrina de `sales`/`proposal_options`: juros e renegociação
--   de fornecedor não reescrevem o que se fechou). `status` anda na régua
--   montando → vendendo → encerrado (a saída passou; lugar vago não se vende
--   retroativo).
--
-- `group_members` — a OCUPAÇÃO: um cliente (+ negócio opcional) consome N
--   lugares. PK composta (group_id, contact_id): um contato é membro uma vez
--   — mudou a quantidade, atualiza a linha (o lugar não é rastreável por
--   pessoa; a família do Sr. Antônio ocupa 3 como um bloco). `deal_id` é
--   SET NULL: apagar o negócio não pode apagar a ocupação do grupo.
--
-- O DINHEIRO continua morando em `sales` (regra da casa): grupo é lente sobre
-- as vendas, não segunda contabilidade — o relatório da 6b SOMA as vendas dos
-- negócios membros, nunca grava receita própria.
--
-- RLS: ENABLE + FORCE + policy de isolamento nas duas (regra 1 do CLAUDE.md).
-- Backfill: nenhum — entidades novas.

-- ---------------------------------------------------------------------------
-- 1. O pacote
-- ---------------------------------------------------------------------------

CREATE TABLE "groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "destination" text,
  "departure_on" date,
  "return_on" date,
  "total_seats" integer NOT NULL,
  "price_per_seat_cents" bigint NOT NULL DEFAULT 0,
  "cost_per_seat_cents" bigint NOT NULL DEFAULT 0,
  "commission_per_seat_cents" bigint NOT NULL DEFAULT 0,
  "service_fee_per_seat_cents" bigint NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'montando',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "groups_title_check" CHECK (char_length(btrim("title")) BETWEEN 1 AND 200),
  CONSTRAINT "groups_total_seats_check" CHECK ("total_seats" BETWEEN 1 AND 500),
  CONSTRAINT "groups_valores_check" CHECK (
    "price_per_seat_cents" >= 0 AND "cost_per_seat_cents" >= 0 AND
    "commission_per_seat_cents" >= 0 AND "service_fee_per_seat_cents" >= 0
  ),
  CONSTRAINT "groups_status_check" CHECK ("status" IN ('montando', 'vendendo', 'encerrado')),
  CONSTRAINT "groups_datas_check" CHECK (
    "return_on" IS NULL OR "departure_on" IS NULL OR "return_on" >= "departure_on"
  )
);
--> statement-breakpoint
CREATE INDEX "groups_tenant_created_idx" ON "groups" ("tenant_id", "created_at" DESC);

-- ---------------------------------------------------------------------------
-- 2. A ocupação
-- ---------------------------------------------------------------------------

CREATE TABLE "group_members" (
  "group_id" uuid NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE RESTRICT,
  -- O negócio é opcional (reserva antes de virar negociação) e SET NULL:
  -- apagar o negócio não pode apagar a ocupação.
  "deal_id" uuid REFERENCES "deals"("id") ON DELETE SET NULL,
  "seats" integer NOT NULL DEFAULT 1,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("group_id", "contact_id"),
  CONSTRAINT "group_members_seats_check" CHECK ("seats" BETWEEN 1 AND 50)
);
--> statement-breakpoint
CREATE INDEX "group_members_contact_id_idx" ON "group_members" ("contact_id");
--> statement-breakpoint
CREATE INDEX "group_members_deal_id_idx" ON "group_members" ("deal_id");

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------

ALTER TABLE "groups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "groups" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "groups_isolation" ON "groups"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "group_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "group_members" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "group_members_isolation" ON "group_members"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
