-- 0019_multiusuario — Fundação da Fase 3 (`docs/MULTIUSUARIO_AGENCIAS.md`).
--
-- Quatro coisas na mesma migration, porque a regra 1 do CLAUDE.md não abre exceção:
-- RLS nasce com a tabela, sempre.
--
--   1. Tabelas do plugin `organization` do Better Auth: `organization`, `member`,
--      `invitation`. São tabelas de AUTH (o plugin lê/escreve via `authDb`, o pool com
--      `app.auth_context=on`) e por isso seguem o padrão de `user`/`session` da 0000:
--      RLS ENABLE+FORCE com DUAS policies — `*_auth_service` (o canal do plugin) e
--      `*_isolation` (o canal da aplicação, via `app.tenant_id`).
--
--      A diferença para as tabelas de domínio: elas NÃO têm `tenant_id` — o vínculo com
--      o tenant é `organization_id` (FK para `organization`, que É o tenant: o id da
--      organization é o MESMO id de `tenants`, não existem dois conceitos de tenant). A
--      policy de isolamento compara pela junção com `organization`, nunca por coluna
--      própria. `organization` compara o próprio `id` (ela é a linha-raiz, como `tenants`).
--
--      TIPOS — o plugin define ids como `text`, mas `organization.id` e os
--      `organization_id` são `uuid` AQUI: o id da organization É o uuid de `tenants`, e
--      o Postgres não implementa FK entre `text` e `uuid` (medido: "foreign key
--      constraint cannot be implemented"). A identidade declarada na FK manda mais que
--      a convenção do plugin — e o adapter trata uuid como string do mesmo jeito (os
--      outros ids do plugin — member/invitation/user — continuam text, que é o que o
--      plugin gera).
--
--      A dúvida que motivou a Fase 3 ("tabela de plugin de auth escapa da migration e
--      nasce sem RLS") NÃO se materializa aqui de forma nenhuma: neste repositório não
--      existe gerador de schema — TODA migration é escrita à mão em `drizzle/*.sql`, e o
--      `src/db/migrate.ts` FALHA o comando se qualquer tabela de `public` terminar sem
--      RLS habilitado E forçado. Tabela de auth sem RLS aqui não é risco latente, é
--      comando vermelho. O teste `tests/security/auth-org-rls.test.ts` trava o mesmo
--      contrato no banco de teste.
--
--   2. Atribuição e comissão dividida (§5 do doc): `deals.agent_id`, `sales.agent_id` +
--      `sales.commission_split_pct`, tabela `agent_profiles`. Papéis nativos do plugin
--      (`owner`/`admin`/`member`) têm CHECK no banco — "agente" é rótulo de UI, o valor
--      no banco é `member`, ponto final.
--
--   3. Assentos (§6): `subscriptions.seats_paid` — alimenta o `membershipLimit`
--      dinâmico do plugin (gate de billing de graça) e o recálculo do valor no
--      cancelar+recriar do Asaas.
--
--   4. Sessão: `session.active_organization_id` — coluna que o plugin Better Auth grava
--      na sessão quando há organization ativa (v1.7.2, `session: { fields:
--      { activeOrganizationId } }`). Sem a coluna, o adapter recusa o UPDATE da sessão.
--      Nullable, sem FK: o plugin só guarda o id, e sessão morre sozinha de qualquer
--      forma (CASCADE de `user` já cobre o que importa).
--
-- Backfills (o banco já tem dados de tenant único): gêmeo `organization` para cada
-- tenant, `member` owner para cada usuário, `agent_id` dos deals pelo primeiro ator da
-- `activities`, `agent_id` das vendas herdado do deal, Studio com 3 assentos.
--
-- Nada aqui precisa de superuser: roda como o dono das tabelas (`zarpa`, NOBYPASSRLS —
-- migrations executam DDL, que não passa por RLS).

-- ---------------------------------------------------------------------------
-- 1. Plugin organization — sessão ganha a organization ativa
-- ---------------------------------------------------------------------------

ALTER TABLE "session" ADD COLUMN "active_organization_id" text;
--> statement-breakpoint

CREATE TABLE "organization" (
  -- É o id de `tenants` — uuid, não o text do plugin (a FK text→uuid não existe no
  -- Postgres; ver o comentário de topo). A FK declara a identidade: apagar o tenant
  -- apaga o gêmeo.
  "id" uuid PRIMARY KEY,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "logo" text,
  -- O adapter serializa metadata para string JSON antes de gravar (v1.7.2).
  "metadata" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY ("id") REFERENCES "tenants" ("id") ON DELETE CASCADE
);
--> statement-breakpoint

CREATE UNIQUE INDEX "organization_slug_key" ON "organization" ("slug");
--> statement-breakpoint

CREATE TABLE "member" (
  "id" text PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  -- Papéis NATIVOS do plugin. O CHECK é a metade do banco da decisão "três papéis
  -- chegam; 'agente' nunca vira valor no banco": se algum código tentar gravar
  -- 'agente', o banco recusa antes de qualquer revisão de código.
  "role" text NOT NULL DEFAULT 'member',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "member_role_check" CHECK ("role" IN ('owner', 'admin', 'member'))
);
--> statement-breakpoint

CREATE INDEX "member_organization_id_idx" ON "member" ("organization_id");
--> statement-breakpoint
CREATE INDEX "member_user_id_idx" ON "member" ("user_id");
--> statement-breakpoint
-- Uma pessoa é membro UMA VEZ de cada organization — o plugin confia na aplicação
-- nesta invariante; aqui ela vira banco, como toda invariante que importa.
CREATE UNIQUE INDEX "member_org_user_key" ON "member" ("organization_id", "user_id");
--> statement-breakpoint

CREATE TABLE "invitation" (
  "id" text PRIMARY KEY,
  "organization_id" uuid NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "role" text NOT NULL DEFAULT 'member',
  -- Enum do plugin: pending | accepted | rejected | canceled.
  "status" text NOT NULL DEFAULT 'pending',
  -- Coluna do modo `teams`, que NÃO está ligado (§3 do doc: fora de propósito). Existe
  -- para o adapter nunca tropeçar; nula para sempre enquanto teams estiver desligado.
  "team_id" text,
  "inviter_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "invitation_status_check"
    CHECK ("status" IN ('pending', 'accepted', 'rejected', 'canceled')),
  CONSTRAINT "invitation_role_check" CHECK ("role" IN ('owner', 'admin', 'member'))
);
--> statement-breakpoint

CREATE INDEX "invitation_organization_id_idx" ON "invitation" ("organization_id");
--> statement-breakpoint
-- A tela de convite e o signup consultam por e-mail — é a chave de busca do fluxo.
CREATE INDEX "invitation_email_idx" ON "invitation" ("email");
--> statement-breakpoint

ALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "organization" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "organization_isolation" ON "organization"
  USING ("id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "organization_auth_service" ON "organization"
  USING (current_setting('app.auth_context', true) = 'on')
  WITH CHECK (current_setting('app.auth_context', true) = 'on');
--> statement-breakpoint

ALTER TABLE "member" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "member" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Sem `tenant_id` na tabela, o isolamento passa pela junção com `organization` — que
-- por sua vez só mostra a organization do contexto. Subquery dentro da policy em vez de
-- coluna duplicada: duplicar `tenant_id` em tabela de plugin é abrir a porta para duas
-- fontes de verdade discordarem.
CREATE POLICY "member_isolation" ON "member"
  USING (
    EXISTS (
      SELECT 1 FROM "organization" o
      WHERE o."id" = "member"."organization_id"
        AND o."id" = nullif(current_setting('app.tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "organization" o
      WHERE o."id" = "member"."organization_id"
        AND o."id" = nullif(current_setting('app.tenant_id', true), '')::uuid
    )
  );
--> statement-breakpoint
CREATE POLICY "member_auth_service" ON "member"
  USING (current_setting('app.auth_context', true) = 'on')
  WITH CHECK (current_setting('app.auth_context', true) = 'on');
--> statement-breakpoint

ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invitation" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "invitation_isolation" ON "invitation"
  USING (
    EXISTS (
      SELECT 1 FROM "organization" o
      WHERE o."id" = "invitation"."organization_id"
        AND o."id" = nullif(current_setting('app.tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "organization" o
      WHERE o."id" = "invitation"."organization_id"
        AND o."id" = nullif(current_setting('app.tenant_id', true), '')::uuid
    )
  );
--> statement-breakpoint
CREATE POLICY "invitation_auth_service" ON "invitation"
  USING (current_setting('app.auth_context', true) = 'on')
  WITH CHECK (current_setting('app.auth_context', true) = 'on');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Atribuição — deals e sales apontam para quem vendeu
-- ---------------------------------------------------------------------------

-- Nullable de propósito: negócio sem vendedor definido é estado legítimo (importação,
-- dado antigo) e o default é "quem criou", decidido na aplicação, não no banco.
-- RESTRICT (e não CASCADE/SET NULL): apagar usuário não pode apagar nem desatribuir
-- histórico de venda — reatribuir é ação de dono, não efeito colateral de DELETE.
ALTER TABLE "deals" ADD COLUMN "agent_id" text REFERENCES "user" ("id") ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "sales" ADD COLUMN "agent_id" text REFERENCES "user" ("id") ON DELETE RESTRICT;
--> statement-breakpoint

-- Padrão 100 (§5): o agente fica com toda a comissão prevista; split diferente é
-- decisão MANUAL por venda, feita pelo dono. Nenhuma régua automática — a casa já é
-- remunerada pela assinatura do Zarpa.
ALTER TABLE "sales" ADD COLUMN "commission_split_pct" integer NOT NULL DEFAULT 100;
--> statement-breakpoint

ALTER TABLE "sales"
  ADD CONSTRAINT "sales_commission_split_check"
  CHECK ("commission_split_pct" BETWEEN 0 AND 100);
--> statement-breakpoint

-- Índice de FK (a checagem de RESTRICT varre por aqui) + índice de listagem por
-- vendedor (a quebra do §7 e o escopo `own` do §4 filtram por este par).
CREATE INDEX "deals_agent_id_idx" ON "deals" ("agent_id");
--> statement-breakpoint
CREATE INDEX "deals_tenant_agent_idx" ON "deals" ("tenant_id", "agent_id");
--> statement-breakpoint
CREATE INDEX "sales_agent_id_idx" ON "sales" ("agent_id");
--> statement-breakpoint
CREATE INDEX "sales_tenant_agent_idx" ON "sales" ("tenant_id", "agent_id");
--> statement-breakpoint

-- Backfill do deal: o primeiro ator registrado na linha do tempo é a melhor
-- aproximação disponível de "quem criou" — `deals` nunca teve `created_by`. `DISTINCT
-- ON` com ORDER BY pega a activity mais antiga de cada deal; deal sem activity nenhuma
-- fica NULL (nullable é o valor honesto).
UPDATE "deals" d
SET "agent_id" = primeira."actor_user_id"
FROM (
  SELECT DISTINCT ON (a."deal_id") a."deal_id", a."actor_user_id"
  FROM "activities" a
  WHERE a."actor_user_id" IS NOT NULL
  ORDER BY a."deal_id", a."occurred_at" ASC
) primeira
WHERE d."id" = primeira."deal_id";
--> statement-breakpoint

-- Backfill da venda: a atribuição É do deal (§5 — "herdado do deal na conversão").
UPDATE "sales" s
SET "agent_id" = d."agent_id"
FROM "deals" d
WHERE d."id" = s."deal_id" AND d."agent_id" IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Perfis comerciais — `agent_profiles` (§5)
-- ---------------------------------------------------------------------------

-- O que é do NEGÓCIO (comissão padrão), não do login — por isso não entra no schema do
-- Better Auth. Um perfil por usuário (`user_id` PK): usuário pertence a um tenant só
-- (`user.tenant_id` NOT NULL), então não há segundo vínculo a representar. Tabela
-- opcional: ausência de perfil = comissão padrão 100 (o DEFAULT da coluna cobre).
CREATE TABLE "agent_profiles" (
  "user_id" text PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "default_commission_pct" integer NOT NULL DEFAULT 100,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "agent_profiles_commission_check"
    CHECK ("default_commission_pct" BETWEEN 0 AND 100)
);
--> statement-breakpoint

CREATE INDEX "agent_profiles_tenant_idx" ON "agent_profiles" ("tenant_id");
--> statement-breakpoint

ALTER TABLE "agent_profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "agent_profiles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "agent_profiles_isolation" ON "agent_profiles"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Assentos — `subscriptions.seats_paid` (§6)
-- ---------------------------------------------------------------------------

-- Nunca zero: o owner sempre ocupa o assento de origem do plano. Solo não tem assento
-- extra (fica sozinho de propósito), mas o contador existe em todo tenant — 1 em Solo
-- e Pro (o próprio dono), 3 no Studio (§2: "Studio já inclui 3 assentos").
ALTER TABLE "subscriptions" ADD COLUMN "seats_paid" integer NOT NULL DEFAULT 1;
--> statement-breakpoint

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_seats_check" CHECK ("seats_paid" >= 1);
--> statement-breakpoint

-- Backfill: só o Studio carrega assentos inclusos no preço-base. Pro/Solo já nascem
-- com o DEFAULT 1.
UPDATE "subscriptions" SET "seats_paid" = 3 WHERE "plan" = 'studio';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Backfill do plugin — todo tenant existente ganha o gêmeo e o owner
-- ---------------------------------------------------------------------------

-- O gêmeo: MESMO id, MESMO slug (ambos únicos — um espelha o outro sem possibilidade
-- de divergência histórica).
INSERT INTO "organization" ("id", "name", "slug", "created_at")
SELECT t."id", t."name", t."slug", t."created_at"
FROM "tenants" t
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

-- O owner: cada usuário existente vira membro da organization do SEU tenant. Papel
-- mapeado do `user.role` legado: 'owner' continua 'owner'; 'agent' vira 'member' — o
-- valor nativo do plugin, porque "agente" é rótulo de UI (§3). Id determinístico
-- (`mem_` + id do usuário): rodar a migration duas vezes não duplica (e o índice único
-- de (organization_id, user_id) é a segunda trava).
INSERT INTO "member" ("id", "organization_id", "user_id", "role", "created_at")
SELECT
  'mem_' || u."id",
  u."tenant_id",
  u."id",
  CASE WHEN u."role" = 'owner' THEN 'owner' ELSE 'member' END,
  u."created_at"
FROM "user" u
ON CONFLICT ("id") DO NOTHING;
