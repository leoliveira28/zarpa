-- 0001_pessoas_e_importacao — busca em campo cifrado, alertas idempotentes e importação.
--
-- Três coisas nascem aqui, e todas com a mesma regra do 0000: nenhuma coluna e nenhuma
-- tabela entra sem o isolamento junto.
--
--   1. ÍNDICE CEGO (`*_hash` + `*_hash_key_id`). CPF é cifrado com IV aleatório, então
--      `WHERE document_encrypted = <cifra>` nunca casa. A coluna de hash determinístico é
--      o que torna busca e deduplicação por CPF possíveis. O raciocínio completo, com a
--      implicação de segurança, está em `src/lib/crypto/blindIndex.ts` e em
--      `docs/decisoes/busca-em-campo-cifrado.md`.
--
--   2. `birth_month_day` — dia e mês do aniversário, EM CLARO. Ver a nota logo abaixo:
--      é uma revelação parcial, deliberada, e está justificada.
--
--   3. `tasks.dedupe_key` — a chave que faz o cron de alertas rodar duas vezes sem
--      duplicar tarefa. Índice único parcial + `ON CONFLICT DO NOTHING`: a idempotência
--      é do BANCO, não da lógica da aplicação. Duas execuções simultâneas do cron não
--      criam duas tarefas nem em corrida.
--
-- Sobre RLS nesta migration: `contacts`, `travelers` e `tasks` já estão com RLS ENABLE +
-- FORCE e policy desde o 0000, e RLS é da TABELA, não da coluna — colunas novas já nascem
-- cobertas. A tabela nova (`import_batches`) recebe ENABLE + FORCE + policy aqui mesmo,
-- antes de qualquer INSERT.

-- ---------------------------------------------------------------------------
-- contacts: índice cego de CPF + aniversário consultável
-- ---------------------------------------------------------------------------

ALTER TABLE "contacts" ADD COLUMN "document_hash" text;
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "document_hash_key_id" text;
--> statement-breakpoint

-- POR QUE dia/mês ficam em claro, e por que o ANO não fica:
-- o alerta de aniversário precisa de "quem faz aniversário nos próximos 7 dias" para
-- TODOS os contatos. Com a data inteira cifrada, essa pergunta obriga a decifrar a base
-- inteira a cada execução do cron — o oposto do que `encryptedColumn.ts` manda fazer
-- ("select de PII é explícito, nunca efeito colateral"). Dia e mês sozinhos não
-- identificam ninguém (1/366 da população); a data COMPLETA de nascimento é que é
-- identificador, e ela continua só em `birth_date_encrypted`. Mesma lógica do
-- `passport_expires_on`, que já está em claro desde o 0000.
ALTER TABLE "contacts" ADD COLUMN "birth_month_day" text;
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_birth_month_day_check"
  CHECK ("birth_month_day" IS NULL OR "birth_month_day" ~ '^[0-1][0-9]-[0-3][0-9]$');
--> statement-breakpoint

-- Guarda-corpo: gravar CPF sem gravar o índice deixaria o registro invisível para a busca
-- e para a deduplicação — a linha entra e some, que é exatamente o defeito que este sprint
-- existe para não ter. O CHECK torna isso impossível de acontecer por esquecimento.
--
-- NOT VALID: as linhas que já existem foram gravadas antes desta coluna existir e o
-- backfill precisa da chave de criptografia, que vive no processo da aplicação e não no
-- Postgres. O constraint JÁ VALE para todo INSERT e UPDATE a partir de agora; o que fica
-- pendente é só a varredura do passado. Depois de
-- `node --import ./src/db/_register.mjs --env-file=.env.local src/db/backfill-blind-index.ts`
-- rode:  ALTER TABLE "contacts" VALIDATE CONSTRAINT "contacts_document_hash_check";
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_document_hash_check"
  CHECK (
    ("document_encrypted" IS NULL) = ("document_hash" IS NULL)
    AND ("document_hash" IS NULL) = ("document_hash_key_id" IS NULL)
  ) NOT VALID;
--> statement-breakpoint

-- Único POR TENANT: o mesmo CPF em dois agentes diferentes é a mesma pessoa comprando de
-- dois lugares, não um conflito. E, como o hash tem sal por tenant, os dois valores nem
-- sequer são iguais. É este índice que sustenta a deduplicação da importação: a segunda
-- linha com o mesmo CPF é recusada pelo BANCO, não pela boa vontade do laço.
CREATE UNIQUE INDEX "contacts_tenant_document_hash_key"
  ON "contacts" ("tenant_id", "document_hash") WHERE "document_hash" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "contacts_tenant_birthday_idx"
  ON "contacts" ("tenant_id", "birth_month_day") WHERE "birth_month_day" IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- travelers: mesmo tratamento, mais o índice que o alerta de passaporte usa
-- ---------------------------------------------------------------------------

ALTER TABLE "travelers" ADD COLUMN "cpf_hash" text;
--> statement-breakpoint
ALTER TABLE "travelers" ADD COLUMN "cpf_hash_key_id" text;
--> statement-breakpoint
ALTER TABLE "travelers" ADD COLUMN "birth_month_day" text;
--> statement-breakpoint
ALTER TABLE "travelers" ADD CONSTRAINT "travelers_birth_month_day_check"
  CHECK ("birth_month_day" IS NULL OR "birth_month_day" ~ '^[0-1][0-9]-[0-3][0-9]$');
--> statement-breakpoint
ALTER TABLE "travelers" ADD CONSTRAINT "travelers_cpf_hash_check"
  CHECK (
    ("cpf_encrypted" IS NULL) = ("cpf_hash" IS NULL)
    AND ("cpf_hash" IS NULL) = ("cpf_hash_key_id" IS NULL)
  ) NOT VALID;
--> statement-breakpoint
CREATE UNIQUE INDEX "travelers_tenant_cpf_hash_key"
  ON "travelers" ("tenant_id", "cpf_hash") WHERE "cpf_hash" IS NOT NULL;
--> statement-breakpoint
-- O cron de passaporte pergunta "vence entre hoje e hoje+90". Índice parcial: passageiro
-- sem passaporte não paga o custo.
CREATE INDEX "travelers_tenant_passport_expires_idx"
  ON "travelers" ("tenant_id", "passport_expires_on") WHERE "passport_expires_on" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "travelers_tenant_birthday_idx"
  ON "travelers" ("tenant_id", "birth_month_day") WHERE "birth_month_day" IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- tasks: origem e chave de deduplicação (idempotência do cron)
-- ---------------------------------------------------------------------------

ALTER TABLE "tasks" ADD COLUMN "source" text NOT NULL DEFAULT 'manual';
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_check"
  CHECK ("source" IN ('manual', 'alerta_passaporte', 'alerta_aniversario', 'importacao'));
--> statement-breakpoint

-- `dedupe_key` é NULL para tarefa criada à mão (o agente pode escrever "ligar para a Ana"
-- dez vezes se quiser — índice único parcial não conta NULL). Para tarefa gerada, a chave
-- é determinística e descreve exatamente o fato: 'passaporte:<traveler_id>:90'
-- ou 'aniversario:<contact_id>:2026'. Rodar o cron de novo tenta inserir a MESMA chave e
-- o banco recusa — `ON CONFLICT DO NOTHING` transforma isso em no-op.
ALTER TABLE "tasks" ADD COLUMN "dedupe_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_tenant_dedupe_key"
  ON "tasks" ("tenant_id", "dedupe_key") WHERE "dedupe_key" IS NOT NULL;
--> statement-breakpoint
-- Tarefa gerada por robô tem que ter chave; tarefa manual não pode ter. Sem isto, um
-- alerta futuro criado sem `dedupe_key` duplicaria a cada execução do cron, e ninguém
-- perceberia até a agente ter trinta tarefas iguais na tela.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_dedupe_key_check"
  CHECK (("source" = 'manual') = ("dedupe_key" IS NULL));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- import_batches — o relatório de cada importação, gravado
--
-- "Importação que perde linha em silêncio é pior que importação que falha." Esta tabela é
-- a prova documental: quantas linhas o arquivo tinha, quantas entraram, quantas foram
-- ignoradas e POR QUÊ, linha a linha, com o número da linha do arquivo original.
--
-- `report` é jsonb e NÃO recebe PII: guarda número da linha, motivo e o nome (que já está
-- em claro em `contacts.name`). CPF ignorado aparece mascarado (`***8901`), nunca inteiro
-- — é a mesma regra do `audit_log`.
-- ---------------------------------------------------------------------------

CREATE TABLE "import_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "filename" text NOT NULL,
  "format" text NOT NULL,
  "encoding" text NOT NULL,
  "delimiter" text,
  "entity" text NOT NULL DEFAULT 'contacts',
  "mapping" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "total_rows" integer NOT NULL DEFAULT 0,
  "created_rows" integer NOT NULL DEFAULT 0,
  "updated_rows" integer NOT NULL DEFAULT 0,
  "skipped_rows" integer NOT NULL DEFAULT 0,
  "report" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_by" text REFERENCES "user" ("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz,
  CONSTRAINT "import_batches_format_check" CHECK ("format" IN ('csv', 'xlsx')),
  CONSTRAINT "import_batches_entity_check" CHECK ("entity" IN ('contacts', 'travelers'))
);
--> statement-breakpoint
CREATE INDEX "import_batches_tenant_created_idx" ON "import_batches" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "import_batches_created_by_idx" ON "import_batches" ("created_by");
--> statement-breakpoint
ALTER TABLE "import_batches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "import_batches" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "import_batches_isolation" ON "import_batches"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
