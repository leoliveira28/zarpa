-- 0022_pj_e_centro_de_custo — a empresa que paga e o setor que paga por ela.
--
-- Fase 4a (`docs/FASE4_PJ.md`): a firma de 5–50 pessoas que o agente solo já atende na
-- planilha. A empresa é o PAGADOR, os funcionários viajam, às vezes um SETOR é quem paga
-- (diretoria, marketing). Duas peças que viajam juntas e não se tocam:
--
-- 1. PJ NO CONTATO — `contacts.person_type`
--    Empresa é UM `contacts` com `person_type = 'juridica'`: razão social no `name`,
--    CNPJ na MESMA coluna `document_encrypted` (AES-256-GCM) e no MESMO índice cego —
--    `blindIndexFor` normaliza por dígitos, então 14 dígitos deduplicam pela mesma
--    máquina que 11. Zero tabela nova, zero política nova: o contato-empresa é lido e
--    escrito pelas mesmas actions, atrás do MESMO RLS de `contacts`. Os FUNCIONÁRIOS
--    que viajam continuam sendo `travelers` do contato-empresa (`travelers.contact_id`
--    NOT NULL já aceita N viajantes), e uma viagem da empresa é um deal cujo titular é
--    ela. PJ NÃO é auth: a organization (0019) é a agência, nunca o cliente.
--
--    DEFAULT 'fisica' + CHECK: todo contato EXISTENTE nasce desta migration como pessoa
--    física — nenhum dado antigo muda de significado, e a coluna nunca fica fora do
--    domínio (mesma régua dos enums de texto da casa, `deals_stage_check` etc.).
--
-- 2. CENTRO DE CUSTO — tabela `cost_centers` + atributo em `deals` e `sales`
--    Molde `pipeline_stages` (0015): lista PLANA do tenant (`label`, `position`,
--    `archived_at`) — não é por empresa, não tem hierarquia, não tem rateio (§6 do
--    plano: fora de escopo de propósito). Centro de custo é atributo do deal
--    (`deals.cost_center_id`) e FOTOGRAFADO na venda na conversão
--    (`sales.cost_center_id`) — mesma mecânica do `agent_id` da 0019: o relatório soma
--    pela venda; renegociar o funil depois não reescreve o que já fechou.
--
--    Nullable nos DOIS lados, e não é tolerância: viagem PF não tem centro de custo e
--    NUNCA terá — `null` é o estado legítimo da maioria das linhas, não dado faltante.
--
--    FK RESTRICT nos dois lados, pelo mesmo motivo de `deals.contact_id`: apagar centro
--    de custo não pode sumir com a classificação de um histórico financeiro. Por isso a
--    tabela é SOFT-DELETE por natureza (só `archived_at`) — o DELETE nem tem caminho na
--    aplicação.
--
-- RLS — mesma migration que cria a tabela (regra 1 do CLAUDE.md), mesmo desenho da 0015:
-- ENABLE + FORCE (o role que conecta é dono da tabela e dono ignora RLS sem FORCE) e
-- policy simétrica USING/WITH CHECK contra `app.tenant_id`. Nenhuma policy de escape
-- hatch: centro de custo é dado interno da agência, não tem superfície pública.
--
-- Backfill: NENHUM. Linha nova sem histórico, coluna com default, atributo novo nulo
-- por padrão — não há verdade antiga a preservar aqui.

-- ---------------------------------------------------------------------------
-- 1. PJ no contato
-- ---------------------------------------------------------------------------

ALTER TABLE "contacts" ADD COLUMN "person_type" text NOT NULL DEFAULT 'fisica';
--> statement-breakpoint
ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_person_type_check" CHECK ("person_type" IN ('fisica', 'juridica'));
--> statement-breakpoint
-- A lista de empresas da agência ("meus clientes PJ") varre por aqui. Seletivo de
-- propósito: índice parcial — PF é a maioria absoluta das linhas e nunca é procurada
-- por ser PF.
CREATE INDEX "contacts_tenant_pj_idx" ON "contacts" ("tenant_id", "created_at" DESC)
  WHERE "person_type" = 'juridica';

-- ---------------------------------------------------------------------------
-- 2. Centros de custo
-- ---------------------------------------------------------------------------

CREATE TABLE "cost_centers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "cost_centers_label_check" CHECK (char_length(btrim("label")) BETWEEN 1 AND 80),
  CONSTRAINT "cost_centers_position_check" CHECK ("position" >= 0)
);
--> statement-breakpoint
CREATE INDEX "cost_centers_tenant_created_idx" ON "cost_centers" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "cost_centers_tenant_position_idx" ON "cost_centers" ("tenant_id", "position");
--> statement-breakpoint
-- Rótulo único entre os ATIVOS do tenant ("Diretoria" arquivada não bloqueia "diretoria"
-- de voltar) — mesma régua de `pipeline_stages_tenant_label_key` (0015).
CREATE UNIQUE INDEX "cost_centers_tenant_label_key" ON "cost_centers"
  ("tenant_id", lower("label")) WHERE "archived_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "cost_centers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cost_centers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "cost_centers_isolation" ON "cost_centers"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- 3. Atributo no deal + fotografia na venda
-- ---------------------------------------------------------------------------

ALTER TABLE "deals" ADD COLUMN "cost_center_id" uuid REFERENCES "cost_centers"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX "deals_cost_center_id_idx" ON "deals" ("cost_center_id");
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "cost_center_id" uuid REFERENCES "cost_centers"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX "sales_cost_center_id_idx" ON "sales" ("cost_center_id");

-- ---------------------------------------------------------------------------
-- Verificação — a migration FALLA ALTO se algo não está como ela promete
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- Todo contato existente é PF: nenhum dado antigo mudou de significado.
  IF EXISTS (SELECT 1 FROM "contacts" WHERE "person_type" <> 'fisica') THEN
    RAISE EXCEPTION '0022: contato existente nasceu juridica — backfill silencioso?';
  END IF;
END $$;
