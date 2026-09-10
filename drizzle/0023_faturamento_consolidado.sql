-- 0023_faturamento_consolidado — a fatura que vai pro boleto (Fase 4b).
--
-- Última peça do critério de aceite da Fase 4 (`docs/FASE4_PJ.md` §7): a empresa
-- PJ já é um contato (0022); agora o MÊS DELA se consolida numa FATURA, a fatura
-- vira um BOLETO no Asaas (cobrança avulsa — o client só sabia assinatura), e o
-- webhook dá a BAIXA AUTOMÁTICA nas parcelas quando o boleto paga.
--
-- `invoices` — a fatura do contato-empresa:
--   contato + período (de/até) + valor (a SOMA das parcelas consolidadas, gravada
--   na fatura — o relatório soma por aqui, nunca re-soma parcelas de uma linha que
--   pode ter mudado) + status + o vínculo Asaas (payment id + URL do boleto).
--   As PARCELAS (`receivables`) mantêm os vencimentos delas — a fatura é o documento
--   de cobrança consolidado, não a substituição do cronograma.
--
--   `asaas_payment_id` com uniqueIndex parcial GLOBAL (sem tenant no índice): o id
--   nasce no Asaas e é a chave de idempotência do webhook — o mesmo evento chegando
--   em retry reencontra a MESMA fatura. É a mesma mecânica do `payments` (S11),
--   com a diferença de que a fatura é por tenant e o discovery do tenant no webhook
--   é por ESTA coluna (não por subscription id, que a cobrança avulsa não tem).
--
-- `receivables.invoice_id` — o vínculo parcela → fatura, nullable (a maioria das
--   parcelas é PF avulsa e nunca terá fatura). SET NULL: apagar fatura não pode
--   apagar o cronograma financeiro da venda.
--
-- `contacts.asaas_customer_id` — o customer do Asaas do contato, criado UMA vez e
--   cacheado (emitir boleto duas vezes não cria dois customers). Nullable: PF sem
--   cobrança direta nunca terá. É dado de integração, não PII — fica em claro.
--
-- RLS: ENABLE + FORCE + policy de isolamento (regra 1) — e a policy de LEITURA do
-- webhook (`invoices_webhook_read`), espelho da `subscriptions_webhook_read` da 0010:
-- o webhook não tem sessão; o discovery do tenant por `asaas_payment_id` precisa do
-- GUC `app.webhook_context`. Uma policy só de SELECT — o webhook NUNCA escreve fora
-- do `withTenant` aberto depois do discovery.
--
-- Backfill: nenhum — tabela nova, colunas novas nulas por padrão.

-- ---------------------------------------------------------------------------
-- 1. A fatura
-- ---------------------------------------------------------------------------

CREATE TABLE "invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  -- RESTRICT: apagar o contato-empresa não pode sumir com a fatura (histórico de cobrança).
  "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE RESTRICT,
  "periodo_de" date NOT NULL,
  "periodo_ate" date NOT NULL,
  "valor_cents" bigint NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'aberta',
  -- O vínculo com a cobrança avulsa do Asaas (boleta). NULL enquanto não emitiu.
  "asaas_payment_id" text,
  "boleto_url" text,
  "pago_em" timestamp with time zone,
  "created_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "invoices_status_check" CHECK ("status" IN ('aberta', 'paga', 'cancelada')),
  CONSTRAINT "invoices_periodo_check" CHECK ("periodo_ate" >= "periodo_de"),
  CONSTRAINT "invoices_valor_check" CHECK ("valor_cents" >= 0),
  -- Fatura paga tem data de pagamento; as outras não (mesma régua do receivables).
  CONSTRAINT "invoices_pago_em_check" CHECK (("status" = 'paga') = ("pago_em" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "invoices_tenant_created_idx" ON "invoices" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "invoices_contact_id_idx" ON "invoices" ("contact_id");
--> statement-breakpoint
-- Idempotência do webhook e "já existe boleto desta fatura" — global por id Asaas.
CREATE UNIQUE INDEX "invoices_asaas_payment_id_key" ON "invoices" ("asaas_payment_id")
  WHERE "asaas_payment_id" IS NOT NULL;
--> statement-breakpoint
-- Uma fatura aberta por contato/mês: consolidar o mesmo período duas vezes é erro de
-- clique, e o índice recusa no banco (faturas pagas/canceladas não bloqueiam reabrir
-- o período com parcelas novas).
CREATE UNIQUE INDEX "invoices_tenant_contact_periodo_key" ON "invoices"
  ("contact_id", "periodo_de") WHERE "status" = 'aberta';

-- ---------------------------------------------------------------------------
-- 2. RLS — isolamento + leitura do webhook (espelho da 0010)
-- ---------------------------------------------------------------------------

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "invoices_isolation" ON "invoices"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- Discovery do tenant no webhook da cobrança avulsa (não há subscription no payload).
-- SELECT de colunas de discovery — o processador abre `withTenant` real na sequência.
CREATE POLICY "invoices_webhook_read" ON "invoices"
  FOR SELECT
  USING (
    "asaas_payment_id" IS NOT NULL
    AND current_setting('app.webhook_context', true) = 'on'
  );

-- ---------------------------------------------------------------------------
-- 3. Vínculo nas parcelas + customer cacheado no contato
-- ---------------------------------------------------------------------------

ALTER TABLE "receivables" ADD COLUMN "invoice_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "receivables_invoice_id_idx" ON "receivables" ("invoice_id");
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "asaas_customer_id" text;

-- ---------------------------------------------------------------------------
-- Verificação — falla alto
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_status_check'
  ) IS FALSE THEN
    RAISE EXCEPTION '0023: constraint da fatura não criada';
  END IF;
END $$;
