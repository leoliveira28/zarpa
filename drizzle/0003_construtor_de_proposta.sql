-- 0003_construtor_de_proposta — schema do construtor de proposta (S5/S6): acervo
-- reutilizável (com acervo global), arquivamento de proposta e imagens de bloco.
--
-- Três coisas nascem aqui:
--
--   1. `library_items` — o acervo reutilizável do agente (hotel, voo, transfer, passeio,
--      seguro ou texto que ele salva uma vez e reaproveita em várias propostas), MAIS um
--      acervo GLOBAL (`is_global = true`, `tenant_id` NULL) — modelos prontos, sem dono,
--      visíveis para todo tenant. RLS nasce aqui, na mesma migration que cria a tabela (a
--      regra 1 do CLAUDE.md não abre exceção para tabela com coluna de tenant opcional).
--
--      QUATRO policies em vez de uma `USING`/`WITH CHECK` simétrica, porque a tabela tem
--      um segundo "dono" possível (a plataforma, não um tenant):
--
--        - SELECT: item do PRÓPRIO tenant OU item global — qualquer um lê os dois;
--        - INSERT/UPDATE: só item do PRÓPRIO tenant, e nunca com `is_global = true` (o
--          `WITH CHECK` recusa mesmo que o chamador tente marcar `is_global` na mão);
--        - DELETE: mesma regra do INSERT/UPDATE, em policy PRÓPRIA — não dá para
--          reaproveitar o `USING` da leitura numa única policy `FOR ALL`, porque DELETE só
--          consulta `USING`, nunca `WITH CHECK`. Uma policy `FOR ALL` com
--          `USING (is_global OR dono)` deixaria QUALQUER tenant apagar item global: o
--          `WITH CHECK` bloquearia escrever um item novo como global, mas nunca seria
--          consultado para apagar um que já existe. Errar isso não aparece em teste de
--          SELECT nenhum — só quando alguém testar DELETE de item global de dentro de um
--          tenant comum. Medido e evitado aqui, não descoberto depois.
--
--      Uma QUINTA policy, `library_items_platform_service`, do mesmo desenho de
--      `tenants_auth_service` (`src/lib/auth/db.ts`): só concede quando
--      `app.platform_context = 'on'`, GUC que NENHUM caminho da aplicação liga hoje — é o
--      único jeito de escrever um item global sem rodar como superuser (o role `zarpa` é
--      NOBYPASSRLS de propósito), e ainda não está conectado a nenhuma tela (sem admin no
--      v1). Ver `src/lib/tenant/withPlatformContext.ts` para o helper, e
--      `docs/handoffs/rafa-para-teo.md` para o comportamento exato esperado em teste —
--      incluindo o aviso de que um GUC é forjável por qualquer SQL arbitrário, a mesma
--      ressalva já registrada para `app.auth_context`.
--
--   2. `proposals.archived_at` — arquivar oculta da lista sem mexer em `status` (que é o
--      estágio comercial: rascunho/enviada/vista/aceita/recusada/expirada, não "a agente
--      ainda quer ver isso na lista"). Mesmo padrão de `contacts.archived_at`. RLS da
--      tabela não muda: é coluna nova numa tabela que já tem ENABLE+FORCE+policy desde o
--      0000, e RLS é da TABELA, não da coluna.
--
--   3. `proposal_blocks.images` — imagens do bloco, separadas de `content` (que continua
--      sendo o campo específico do tipo: nº do voo, diárias, categoria do quarto). Array
--      jsonb validado por CHECK (`jsonb_typeof(images) = 'array'`), nunca objeto solto.
--      Mesma coluna, mesmo CHECK, nasce em `library_items` (tabela nova, direto no CREATE).

-- ---------------------------------------------------------------------------
-- proposals: arquivamento
-- ---------------------------------------------------------------------------

ALTER TABLE "proposals" ADD COLUMN "archived_at" timestamptz;
--> statement-breakpoint
CREATE INDEX "proposals_tenant_active_idx"
  ON "proposals" ("tenant_id", "created_at" DESC) WHERE "archived_at" IS NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- proposal_blocks: imagens
-- ---------------------------------------------------------------------------

ALTER TABLE "proposal_blocks" ADD COLUMN "images" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "proposal_blocks" ADD CONSTRAINT "proposal_blocks_images_is_array_check"
  CHECK (jsonb_typeof("images") = 'array');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- library_items — acervo reutilizável (tenant) + acervo global (is_global)
-- ---------------------------------------------------------------------------

CREATE TABLE "library_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "is_global" boolean NOT NULL DEFAULT false,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "images" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "library_items_kind_check"
    CHECK ("kind" IN ('text', 'image', 'flight', 'hotel', 'transfer', 'tour', 'cruise', 'insurance')),
  CONSTRAINT "library_items_images_is_array_check" CHECK (jsonb_typeof("images") = 'array'),
  -- Item global nunca tem dono, item de tenant sempre tem. As duas coisas são a MESMA
  -- coisa vista de dois lados; o CHECK impede que elas se desencontrem.
  CONSTRAINT "library_items_global_tenant_check" CHECK (("is_global" = true) = ("tenant_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "library_items_tenant_created_idx" ON "library_items" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "library_items_global_idx"
  ON "library_items" ("is_global", "created_at" DESC) WHERE "is_global" = true;
--> statement-breakpoint

ALTER TABLE "library_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "library_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "library_items_select" ON "library_items"
  FOR SELECT
  USING (
    "is_global" = true
    OR "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

CREATE POLICY "library_items_tenant_insert" ON "library_items"
  FOR INSERT
  WITH CHECK (
    "is_global" = false
    AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

CREATE POLICY "library_items_tenant_update" ON "library_items"
  FOR UPDATE
  USING (
    "is_global" = false
    AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    "is_global" = false
    AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

CREATE POLICY "library_items_tenant_delete" ON "library_items"
  FOR DELETE
  USING (
    "is_global" = false
    AND "tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid
  );
--> statement-breakpoint

-- Escape hatch nomeado, mesmo padrão de `tenants_auth_service`/`user_auth_service`: só
-- concede quando o GUC está ligado, e NENHUM caminho da aplicação liga esse GUC hoje (sem
-- tela de admin no v1, sem seed de catálogo global ainda). Existe para o dia em que
-- alguém precisar administrar o acervo global sem rodar como superuser.
CREATE POLICY "library_items_platform_service" ON "library_items"
  FOR ALL
  USING ("is_global" = true AND current_setting('app.platform_context', true) = 'on')
  WITH CHECK (
    "is_global" = true
    AND "tenant_id" IS NULL
    AND current_setting('app.platform_context', true) = 'on'
  );
