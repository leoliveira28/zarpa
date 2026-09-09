-- 0018_modelos_de_proposta — o último 10% da página Orçamentos (fase 1 do roadmap).
--
-- O PRODUTO
-- A agente que monta "Japão econômico / conforto / premium" pela quinta vez não deve
-- remontar nada. Duas direções, a mesma tabela:
--
--   - "Salvar como modelo": fotografa os blocos ATUAIS de uma proposta (o que está na
--     tela agora, não o que a proposta vai virar a ser) e guarda com um nome.
--   - "Criar de modelo": nasce uma proposta draft com aqueles blocos como ponto de
--     partida, vinculada ao negócio escolhido.
--
-- `is_default` marca o modelo que a NovaPropostaSheet pré-seleciona. Regra de negócio:
-- UM (e só um) por tenant — garantida aqui pelo partial unique index, não por aplicação
-- (aplicação cai, índice não).
--
-- FOTOGRAFIA, NÃO REFERÊNCIA (decisão central do desenho)
-- `blocks` guarda uma CÓPIA dos blocos no instante da criação — sem FK para
-- `proposal_blocks`, sem `proposal_id`. Motivos: (1) a proposta de origem pode ser
-- apagada ou arquivada a qualquer momento e o modelo tem que sobreviver a ela;
-- (2) editar a proposta depois NÃO pode reescrever o modelo por trás da agente;
-- (3) o modelo é conteúdo interno do tenant — não participa de leitura pública, então
-- não precisa das garantias de forma do snapshot público (`0004`/`0013`). A forma de
-- cada bloco é a MESMA de `proposal_blocks` (kind/title/body/images/content), para o
-- editor consumir os dois sem saber de onde veio — mas SEM `option_id`: os blocos de uma
-- opção específica são achatados para o nível da proposta, porque uma opção de uma
-- proposta antiga não significa nada numa proposta nova. `content` entra inteiro de
-- propósito: é campo específico de tipo (nº do voo, diárias) e cortar chaves dele seria
-- corromper conteúdo deliberado; preço NUNCA esteve em bloco (é da opção) e continua fora.
--
-- POR QUE `blocks` TEM DEFAULT (e não é descuido)
-- `'[]'::jsonb`: um modelo sempre nasce com blocos (a ação de criação recusa proposta
-- vazia antes de tocar no banco). O DEFAULT existe para o seed sintético do scanner de
-- isolamento (`tests/helpers/db.ts` só insere `tenant_id`) conseguir criar linha e o
-- teste de isolamento poder provar o RLS desta tabela também. Sem DEFAULT, o seed falha
-- e o teste fica vermelho por razão errada. Quem grava por aqui valida quantidade no zod.
--
-- AUDITORIA: as escritas passam por `registrarAuditoria` (`src/server/proposalTemplates.ts`)
-- com `proposal_template.created` / `.deleted` / `.default_set` — metadata sem conteúdo
-- de bloco (o conteúdo é grande e não é fato de auditoria).
--
-- RLS: mesma migration, ENABLE + FORCE + policy padrão da casa contra
-- `current_setting('app.tenant_id', true)`. O role `zarpa` é NOBYPASSRLS — sem FORCE, o
-- dono da tabela burlaria; sem policy, ninguém leria nada. Nenhum GUC novo, nada em
-- `KNOWN_ESCAPE_HATCHES`. Índices: FK e `(tenant_id, created_at DESC)` — a listagem de
-- modelos é a consulta do dia a dia, e DESC é a ordem em que ela volta.

CREATE TABLE "proposal_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "proposal_templates_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  CONSTRAINT "proposal_templates_blocks_is_array_check" CHECK (jsonb_typeof("blocks") = 'array')
);
--> statement-breakpoint

CREATE INDEX "proposal_templates_tenant_created_idx" ON "proposal_templates" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
-- Um só modelo padrão por tenant. Parcial: só as linhas que SÃO default disputam a
-- vaga — `definirTemplatePadrao` desliga as outras e liga esta dentro da mesma
-- transação, e o índice é o cinto de segurança caso um caminho futuro esqueça.
CREATE UNIQUE INDEX "proposal_templates_tenant_default_key" ON "proposal_templates" ("tenant_id") WHERE "is_default";
--> statement-breakpoint

ALTER TABLE "proposal_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "proposal_templates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "proposal_templates_isolation" ON "proposal_templates"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
