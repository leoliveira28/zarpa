-- 0015_estagios_do_funil — o funil configurável, SÓ O ALICERCE.
--
-- O PO quer que a agente possa renomear, reordenar e criar coluna do funil. Hoje nada
-- disso é por tenant: `deals.stage` é texto com CHECK fixo de 6 valores (0000) e
-- `COLUNAS_DO_FUNIL` (`src/server/dealStages.ts`) é lista hardcoded no servidor.
--
-- ESTA MIGRATION NÃO LIGA NADA. Ela cria a tabela de CONFIGURAÇÃO e semeia os estágios de
-- hoje para cada tenant existente. `deals.stage` continua EXATAMENTE como está, o CHECK
-- continua valendo, `/funil`, `deals.ts`, `dashboard.ts` e `money.ts` continuam lendo o
-- enum e nenhuma linha de `deals` é tocada. A UI é da Nina, em outra rodada.
--
-- POR QUE NÃO MIGREI `deals.stage` PARA FK NESTA RODADA
-- Trocar o enum por `stage_id` significa, de uma vez: coluna nova em `deals`, backfill por
-- tenant, derrubar o CHECK, reescrever todo `where stage = 'ganho'` espalhado por
-- `deals.ts`/`dashboard.ts`/`money.ts`/`sales.ts`/`viagens.ts`/`followups.ts`, mais o seed
-- e a suíte do Téo. Isso é risco de quebrar o produto inteiro para entregar ZERO valor
-- visível (não há UI ainda). A tabela em paralelo dá o mesmo alicerce sem tocar em nada
-- que já funciona, e o caminho de migração fica mecânico e documentado:
--
--   1. `ALTER TABLE deals ADD COLUMN stage_id uuid REFERENCES pipeline_stages(id)`;
--   2. backfill `deals.stage_id = ps.id` casando `ps.tenant_id = deals.tenant_id AND
--      ps.legacy_stage = deals.stage` — é exatamente para isso que `legacy_stage` existe;
--   3. as leituras passam a usar `stage_id`, com `stage` mantido em escrita dupla por uma
--      release (o CHECK só cai quando ninguém mais ler o texto);
--   4. estágio criado pelo agente (`legacy_stage IS NULL`) só é atribuível a negócio
--      DEPOIS do passo 1 — hoje nenhum negócio consegue apontar para ele, e é por isso que
--      `arquivarEstagio` conta negócio por `legacy_stage`.
--
-- INVARIANTE DE FIM DE FUNIL
-- Relatório e dashboard precisam saber qual estágio fecha como GANHO e qual como PERDIDO.
-- O banco garante NO MÁXIMO um de cada, ativo, por tenant (índices únicos parciais) e que
-- nenhuma linha é as duas coisas (CHECK). "PELO MENOS um de cada" não cabe em CHECK de
-- tabela (é agregado, e CHECK é por linha); a garantia vem da camada de serviço, que é a
-- única escritora: `arquivarEstagio` RECUSA arquivar estágio `is_won`/`is_lost`, e nenhuma
-- action apaga linha (arquivamento é soft). Sem DELETE e sem arquivar fim de funil, o par
-- semeado aqui não tem como desaparecer. Escolha registrada em `docs/status/rafa.md`.
--
-- ORDEM DAS INSTRUÇÕES (importante, leia antes de reordenar):
-- o backfill roda ANTES de `ENABLE ROW LEVEL SECURITY` de propósito. Com FORCE RLS ligado,
-- um INSERT que atravessa VÁRIOS tenants numa instrução só é impossível por construção (a
-- policy compara com UM `app.tenant_id`). A tabela nasce e é semeada dentro da MESMA
-- migration, antes de qualquer tráfego de aplicação, e sai dela com RLS habilitado,
-- forçado e com policy `USING` + `WITH CHECK` — a regra 1 do CLAUDE.md continua cumprida
-- (RLS na mesma migration que cria a tabela), só que na ordem que o backfill exige.

-- ---------------------------------------------------------------------------
-- Tabela
-- ---------------------------------------------------------------------------

CREATE TABLE "pipeline_stages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  -- Ponte com `deals.stage` (ver "caminho de migração" acima). Nulo = estágio do agente.
  "legacy_stage" text,
  "label" text NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  "is_won" boolean NOT NULL DEFAULT false,
  "is_lost" boolean NOT NULL DEFAULT false,
  -- Soft delete: estágio com negócio dentro nunca some, só sai do quadro. Negócio
  -- existente não pode ficar órfão.
  "archived_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "pipeline_stages_legacy_check" CHECK (
    "legacy_stage" IS NULL OR
    "legacy_stage" IN ('novo', 'cotando', 'proposta_enviada', 'negociando', 'ganho', 'perdido')
  ),
  -- Guarda contra lixo (vazio, texto absurdo), NÃO a regra de produto: o limite de 40
  -- caracteres que a agente vê é do zod em `criarEstagio`/`renomearEstagio`. O CHECK é
  -- mais frouxo de propósito — constraint de banco que espelha regra de tela vira
  -- migration a cada mudança de copy, e o seed sintético do scanner de isolamento
  -- (`tests/helpers/db.ts`, rótulo de ~51 caracteres com o uuid do tenant dentro) é
  -- exatamente o caso que prova que os dois limites não são a mesma coisa.
  CONSTRAINT "pipeline_stages_label_check" CHECK (char_length(btrim("label")) BETWEEN 1 AND 80),
  CONSTRAINT "pipeline_stages_position_check" CHECK ("position" >= 0),
  CONSTRAINT "pipeline_stages_outcome_check" CHECK (NOT ("is_won" AND "is_lost"))
);
--> statement-breakpoint

-- FK indexada + listagem por (tenant_id, created_at), como toda tabela do schema.
CREATE INDEX "pipeline_stages_tenant_created_idx" ON "pipeline_stages" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
-- A ordem do quadro é lida por aqui.
CREATE INDEX "pipeline_stages_tenant_position_idx" ON "pipeline_stages" ("tenant_id", "position");
--> statement-breakpoint
-- Um estágio por valor do enum, por tenant — o backfill não pode duplicar e a migração
-- futura de `deals.stage_id` precisa de um alvo único.
CREATE UNIQUE INDEX "pipeline_stages_tenant_legacy_key"
  ON "pipeline_stages" ("tenant_id", "legacy_stage")
  WHERE "legacy_stage" IS NOT NULL;
--> statement-breakpoint
-- Duas colunas ativas com o mesmo nome é erro de dedo, não configuração.
CREATE UNIQUE INDEX "pipeline_stages_tenant_label_key"
  ON "pipeline_stages" ("tenant_id", lower("label"))
  WHERE "archived_at" IS NULL;
--> statement-breakpoint
-- No máximo UM fim de funil de cada tipo, ativo, por tenant (ver "INVARIANTE" acima).
CREATE UNIQUE INDEX "pipeline_stages_tenant_won_key"
  ON "pipeline_stages" ("tenant_id")
  WHERE "is_won" AND "archived_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_stages_tenant_lost_key"
  ON "pipeline_stages" ("tenant_id")
  WHERE "is_lost" AND "archived_at" IS NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Backfill: cada tenant existente ganha os estágios de HOJE, na ordem de hoje.
--
-- Rótulos idênticos aos de `COLUNAS_DO_FUNIL` (`src/server/dealStages.ts`) — a lista
-- hardcoded continua sendo a fonte do quadro nesta rodada; o seed apenas espelha o que a
-- agente já vê, para que ligar a UI depois não mude nada na cara do produto.
-- `perdido` é valor real de `deals.stage` e ENTRA como estágio (é o `is_lost`), mesmo não
-- sendo coluna visível do quadro hoje — quem decide mostrar ou não é a UI, com `isLost` na
-- mão; o backend não pode fingir que "perdido" não existe.
--
-- Um DO block porque `tenants` também tem FORCE RLS: sem contexto, `SELECT ... FROM
-- tenants` devolve ZERO linhas e o backfill seria um no-op silencioso — o pior resultado
-- possível. `app.auth_context` é o MESMO canal que o serviço de auth usa para resolver o
-- tenant do usuário (policy `tenants_auth_service`, 0000); aqui é `set_config(..., true)`,
-- local à transação desta instrução, somente para LER a lista de ids, e some ao fim dela.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  PERFORM set_config('app.auth_context', 'on', true);

  INSERT INTO pipeline_stages (tenant_id, legacy_stage, label, position, is_won, is_lost)
  SELECT t.id, s.legacy_stage, s.label, s.position, s.is_won, s.is_lost
  FROM tenants t
  CROSS JOIN (VALUES
    ('novo',             'Novo contato', 0, false, false),
    ('cotando',          'Montando',     1, false, false),
    ('proposta_enviada', 'Enviada',      2, false, false),
    ('negociando',       'Negociando',   3, false, false),
    ('ganho',            'Fechada',      4, true,  false),
    ('perdido',          'Perdida',      5, false, true )
  ) AS s(legacy_stage, label, position, is_won, is_lost)
  ON CONFLICT DO NOTHING;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS — mesma migration que cria a tabela (regra 1 do CLAUDE.md).
-- ENABLE + FORCE: o role que conecta é DONO da tabela e dono ignora RLS sem FORCE.
-- Nenhuma policy de escape hatch: estágio do funil é dado interno da agente, não tem
-- superfície pública nenhuma.
-- ---------------------------------------------------------------------------

ALTER TABLE "pipeline_stages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pipeline_stages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "pipeline_stages_isolation" ON "pipeline_stages"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
