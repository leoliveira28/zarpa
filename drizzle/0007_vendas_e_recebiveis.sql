-- 0007_vendas_e_recebiveis — S9: o dinheiro que já fechou.
--
-- Duas tabelas NOVAS, RLS nasce nesta MESMA migration (regra 1 do CLAUDE.md — não abre
-- exceção). Padrão idêntico ao de toda tabela simples de tenant (`proposals_isolation`,
-- `deals_isolation` em `0000_fundacao.sql`): uma única policy `USING`+`WITH CHECK` contra
-- `current_setting('app.tenant_id', true)::uuid`. Nenhuma das duas tabelas tem dono
-- opcional (nada como `library_items.is_global`) — não precisa de escape hatch nenhum.
--
-- `sales` nasce de uma proposta ACEITA (`proposals.status = 'accepted'`,
-- `accepted_option_id` preenchido — ver `0005_aceitar_opcao.sql`). Os valores de dinheiro
-- (`valor_bruto_cents`, `custo_cents`, `comissao_prevista_cents`) são uma FOTOGRAFIA da
-- opção aceita no momento da conversão, copiados pela Server Action
-- (`converterPropostaEmVenda`, `src/server/sales.ts`) — não um espelho ao vivo de
-- `proposal_options` nem `GENERATED`, porque o agente renegocia custo/comissão com o
-- fornecedor DEPOIS da venda fechada sem reescrever a proposta que o cliente já aceitou.
--
-- `receivables` é a parcela do CLIENTE, com vencimento — não confundir com `payments`
-- (`money.ts`), que é a cobrança da ASSINATURA do próprio agente ao Zarpa. `sale_id` em
-- CASCADE: a parcela é filha da venda, não sobrevive à venda excluída.
--
-- `custo_cents`/`comissao_prevista_cents`/`taxa_servico_cents` de `sales` são tão
-- sensíveis quanto `proposal_options.cost_cents`/`commission_cents`: margem do agente,
-- NUNCA pública. Não existe (e não deve nascer) rota `SECURITY DEFINER` para `sales`
-- nem `receivables` — ao contrário de `proposals`, essas duas tabelas não têm equivalente
-- público.

CREATE TABLE "sales" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "deal_id" uuid NOT NULL REFERENCES "deals" ("id") ON DELETE RESTRICT,
  "proposal_id" uuid NOT NULL REFERENCES "proposals" ("id") ON DELETE RESTRICT,
  "proposal_option_id" uuid REFERENCES "proposal_options" ("id") ON DELETE SET NULL,
  "fornecedor" text,
  "valor_bruto_cents" bigint NOT NULL DEFAULT 0,
  "custo_cents" bigint NOT NULL DEFAULT 0,
  "comissao_prevista_cents" bigint NOT NULL DEFAULT 0,
  "taxa_servico_cents" bigint NOT NULL DEFAULT 0,
  "comissao_status" text NOT NULL DEFAULT 'prevista',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "sales_comissao_status_check"
    CHECK ("comissao_status" IN ('prevista', 'recebida', 'atrasada')),
  CONSTRAINT "sales_valores_check" CHECK (
    "valor_bruto_cents" >= 0
    AND "custo_cents" >= 0
    AND "comissao_prevista_cents" >= 0
    AND "taxa_servico_cents" >= 0
  )
);
--> statement-breakpoint
CREATE INDEX "sales_tenant_created_idx" ON "sales" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "sales_deal_id_idx" ON "sales" ("deal_id");
--> statement-breakpoint
CREATE INDEX "sales_proposal_option_id_idx" ON "sales" ("proposal_option_id");
--> statement-breakpoint
-- Uma proposta aceita vira NO MÁXIMO uma venda — o banco garante idempotência da
-- conversão, não a sorte de `converterPropostaEmVenda` nunca ser chamada duas vezes.
CREATE UNIQUE INDEX "sales_proposal_id_key" ON "sales" ("proposal_id");
--> statement-breakpoint
CREATE INDEX "sales_tenant_comissao_status_idx" ON "sales" ("tenant_id", "comissao_status");
--> statement-breakpoint

ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sales" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "sales_isolation" ON "sales"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

CREATE TABLE "receivables" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "sale_id" uuid NOT NULL REFERENCES "sales" ("id") ON DELETE CASCADE,
  "vence_em" date NOT NULL,
  "valor_cents" bigint NOT NULL,
  "status" text NOT NULL DEFAULT 'pendente',
  "pago_em" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "receivables_status_check"
    CHECK ("status" IN ('pendente', 'pago', 'atrasado', 'cancelado')),
  CONSTRAINT "receivables_valor_check" CHECK ("valor_cents" >= 0),
  -- Parcela paga tem data de pagamento; parcela não paga não tem — mesmo padrão de
  -- `tasks_dedupe_key_check` (0000_fundacao.sql).
  CONSTRAINT "receivables_pago_em_check" CHECK (("status" = 'pago') = ("pago_em" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "receivables_tenant_created_idx" ON "receivables" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "receivables_sale_id_idx" ON "receivables" ("sale_id");
--> statement-breakpoint
-- A tela que importa é "o que está em aberto e vence quando" — mesmo desenho de
-- `tasks_tenant_open_due_idx`: índice parcial que não paga por parcela já paga/cancelada.
CREATE INDEX "receivables_tenant_open_due_idx"
  ON "receivables" ("tenant_id", "vence_em") WHERE "status" = 'pendente';
--> statement-breakpoint

ALTER TABLE "receivables" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "receivables" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "receivables_isolation" ON "receivables"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
