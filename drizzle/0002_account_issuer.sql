-- 0002_account_issuer — acompanha o Better Auth 1.7: identidade de `account` passa a ser
-- escopada por `issuer` (não só `provider_id`). Ver
-- https://better-auth.com/docs/guides/1-7-upgrade-guide#account-identity-is-scoped-by-issuer
--
-- Descoberta rodando o seed contra `better-auth@^1.7.2`: o adapter recusa qualquer escrita
-- em `account` porque a coluna não existe no schema Drizzle (nem no banco). Sem isto, NENHUM
-- cadastro por e-mail/senha ou social funciona — não é um detalhe cosmético.
--
-- `account` já nasceu com RLS + FORCE + policy `account_auth_service` em 0000_fundacao;
-- esta migration só adiciona a coluna e troca a chave única, RLS não muda.
--
-- Backfill: hoje não há linha em `account` neste banco (nenhum cadastro chegou a
-- completar), mas o UPDATE cobre o caso de já existir alguma — usa `provider_id` como
-- valor de `issuer`, que é exatamente o que o Better Auth grava para contas locais
-- (`createLocalAccountIssuer("credential")` também deriva de provider/local).

ALTER TABLE "account" ADD COLUMN "issuer" text;
--> statement-breakpoint
UPDATE "account" SET "issuer" = "provider_id" WHERE "issuer" IS NULL;
--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;
--> statement-breakpoint
DROP INDEX "account_provider_account_key";
--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_account_key" ON "account" ("issuer", "account_id");
