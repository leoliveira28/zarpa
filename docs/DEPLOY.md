# Deploy — Zarpa em produção

> Registro do provisionamento e guia de operação. O primeiro deploy foi feito via
> CLI (conta Vercel `leoliveira28`) com banco Neon na mesma conta do dono.

## Mapa provisionado

| Peça | Onde | Nota |
|---|---|---|
| Código | `github.com/leoliveira28/zarpa` | **Público** de propósito: o plano Vercel Hobby só aceita repo público para Git integration — trocar para privado quando for feito o upgrade de plano |
| Banco | Neon, projeto `meu_db` (`gentle-bread-99525731`) | Database dedicado `zarpa` no branch `br-old-poetry-ac4g99ub`; região `sa-east-1` (São Paulo) |
| App | Vercel, escopo `lp-development` (conta pessoal do dono), projeto `zarpa` | **URL de produção: `https://zarpa-wheat.vercel.app`** (alias único gerado — `zarpa.vercel.app` é de um terceiro) |

> ⚠️ **`zarpa.vercel.app` NÃO é nosso** — o nome global pertence a um site de terceiros
> ("chama o Zeca"). O alias de produção real é `zarpa-wheat.vercel.app`; quando
> houver domínio próprio, atualizar `BETTER_AUTH_URL` junto (senão: 403 `INVALID_ORIGIN`
> em todo login — o Better Auth valida a origem contra esta env).

> ⚠️ **Deployment Protection**: o escopo `lp-development` protege os URLs internos de
> deployment com SSO (302 → `vercel.com/sso-api`). Para o cliente final abrir a proposta,
> o projeto precisa de produção pública:
> `vercel.com/lp-development/zarpa/settings/deployment-protection` → **Production** → `Public`.
> Sem isto, o link do WhatsApp da proposta não abre para ninguém de fora.

## Decisões de infra registradas

- **Connection string POOLED (`-pooler`).** O `src/db/client.ts` já nasceu para isso:
  `prepare: false` (obrigatório atrás de PgBouncer em modo transaction) e pool
  pequeno por instância de serverless (`max: 10`, `DATABASE_POOL_MAX` sobrescreve).
- **`vercel.json`**: região `sae1` + cron diário da régua de follow-up em
  `0 12 * * *` (12:00 UTC = **09:00 em Brasília**). A Vercel injeta
  `Authorization: Bearer CRON_SECRET` automaticamente nos crons — o `CRON_SECRET`
  da env de produção é o que a rota `/api/cron/followups` espera.
- **Catálogo de planos não precisa de seed**: a migration `0009_planos_e_assinatura.sql`
  semeia Solo/Pro/Studio com `ON CONFLICT (slug) DO NOTHING`.
- **`db:seed` NUNCA roda em produção** — cria dois tenants de demonstração que são
  insumo de teste de isolamento, não dados de produto.

## Variáveis de ambiente de produção

Definidas no projeto Vercel via `vercel env add <NOME> production`.

| Var | Origem | Papel |
|---|---|---|
| `DATABASE_URL` | `neonctl connection-string <projeto> --database zarpa --pooled` | Único segredo de dado |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | Assinatura de sessão Better Auth |
| `BETTER_AUTH_URL` | `https://zarpa-wheat.vercel.app` | Base de links de auth e **origem confiável** — o Better Auth recusa login com `INVALID_ORIGIN` (403) se o domínio do acesso divergir deste valor; trocar junto com domínio próprio |
| `ENCRYPTION_KEY_V1` | `openssl rand -base64 32` | Chave AES-256-GCM de PII (CPF/passaporte/nascimento). **Perder esta chave = perder os dados cifrados**; guardar no cofre do dono |
| `CRON_SECRET` | `openssl rand -hex 24` | Token das rotas de cron |
| `APP_NAME` | token de marca | Nome na UI (`src/lib/ui/brand`), não é o nome comercial final |

## Envs ainda sem credencial (o app degrada de forma esperada)

| Var | O que trava enquanto falta |
|---|---|
| `RESEND_API_KEY` | Magic link e e-mail de "cliente abriu a proposta" caem em log em vez de chegar por e-mail — senha e link de proposta continuam funcionando |
| `ASAAS_API_KEY` / `ASAAS_WEBHOOK_TOKEN` / `ASAAS_ENV=production` | Assinatura recorrente real; webhook: `https://<url>/api/asaas/webhook` |
| `BLOB_READ_WRITE_TOKEN` | Upload de logo na marca da proposta |
| `NEXT_PUBLIC_POSTHOG_KEY`, `SENTRY_DSN` | Telemetria/erros |

## Rotina de banco

```bash
# migrations contra o Neon (nunca db:seed):
neonctl connection-string gentle-bread-99525731 --database zarpa --pooled \
  | head -1 > /tmp/zarpa-neon-url
DATABASE_URL="$(cat /tmp/zarpa-neon-url)" \
  node --import ./src/db/_register.mjs src/db/migrate.ts
```

## Checklist pós-deploy

1. `curl -sI https://<url>/entrar` → 200
2. Criar conta real pelo `/cadastrar` → cai no `/hoje` em trial de 14 dias
3. Montar e enviar a primeira proposta → abrir o link público no celular
4. Conferir Vercel Cron no dashboard (aba Cron Jobs) — primeira execução às 09:00 BRT
