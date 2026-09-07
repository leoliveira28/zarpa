#!/usr/bin/env bash
# Deploy Zarpa → Neon + Vercel. Executa uma vez; idempotente (re-rodar não estraga).
#
# O que faz:
#   0. cria o repo público no GitHub e dá push (idempotente);
#   1. obtém a connection string POOLED do Neon (nunca exibida);
#   2. roda as migrations no Neon (a 0009 semeia o catálogo de planos);
#   3. liga o projeto Vercel `zarpa`;
#   4. define as envs de produção — segredos gerados UMA vez e guardados em
#      ~/.zarpa-secrets/prod.env (chmod 600; copie para o seu cofre);
#   5. faz o deploy de produção.
#
# Sem segredo nenhum neste arquivo: tudo é gerado ou buscado na hora.
# Uso: bash scripts/deploy-prod.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PROJETO_NEON="gentle-bread-99525731"
URL_PROD="https://zarpa.vercel.app"

echo "── 0/5 Repo público no GitHub (idempotente)"
gh repo create zarpa --public --source=. --push \
  --description "SaaS de gestão para agentes de viagem independentes" 2>/dev/null \
  || echo "   (repo já existe ou push já feito — seguindo)"

echo "── 1/5 Connection string do Neon (não exibida)"
NEON_URL="$(neonctl connection-string "$PROJETO_NEON" --database zarpa --pooled | head -1)"
[ -n "$NEON_URL" ] || { echo "✗ Falha ao obter connection string"; exit 1; }

echo "── 2/5 Migrations no Neon (a 0009 semeia Solo/Pro/Studio)"
DATABASE_URL="$NEON_URL" node --import ./src/db/_register.mjs src/db/migrate.ts

echo "── 3/5 Vercel: link do projeto"
vercel link --yes --project zarpa

echo "── 4/5 Envs de produção"
SECRETS_DIR="$HOME/.zarpa-secrets"
SECRETS_FILE="$SECRETS_DIR/prod.env"
mkdir -p "$SECRETS_DIR" && chmod 700 "$SECRETS_DIR"
touch "$SECRETS_FILE" && chmod 600 "$SECRETS_FILE"

# Gera cada segredo UMA vez e guarda; rodadas seguintes reusam o mesmo valor —
# trocar ENCRYPTION_KEY_V1 depois que existir PII cifrada torna os dados ilegíveis.
if grep -q '^BETTER_AUTH_SECRET=' "$SECRETS_FILE"; then
  AUTH_SECRET="$(grep '^BETTER_AUTH_SECRET=' "$SECRETS_FILE" | cut -d= -f2-)"
else
  AUTH_SECRET="$(openssl rand -base64 32)"
  echo "BETTER_AUTH_SECRET=$AUTH_SECRET" >> "$SECRETS_FILE"
fi
if grep -q '^ENCRYPTION_KEY_V1=' "$SECRETS_FILE"; then
  ENC_KEY="$(grep '^ENCRYPTION_KEY_V1=' "$SECRETS_FILE" | cut -d= -f2-)"
else
  ENC_KEY="$(openssl rand -base64 32)"
  echo "ENCRYPTION_KEY_V1=$ENC_KEY" >> "$SECRETS_FILE"
fi
if grep -q '^CRON_SECRET=' "$SECRETS_FILE"; then
  CRON_SECRET="$(grep '^CRON_SECRET=' "$SECRETS_FILE" | cut -d= -f2-)"
else
  CRON_SECRET="$(openssl rand -hex 24)"
  echo "CRON_SECRET=$CRON_SECRET" >> "$SECRETS_FILE"
fi

add_env() {
  if vercel env ls production 2>/dev/null | grep -qw "$1"; then
    echo "   $1 já definida — pulando"
  else
    printf '%s' "$2" | vercel env add "$1" production >/dev/null
    echo "   $1 adicionada"
  fi
}
add_env DATABASE_URL "$NEON_URL"
add_env BETTER_AUTH_SECRET "$AUTH_SECRET"
add_env BETTER_AUTH_URL "$URL_PROD"
add_env ENCRYPTION_KEY_V1 "$ENC_KEY"
add_env CRON_SECRET "$CRON_SECRET"
add_env APP_NAME "Zarpa"

echo "── 5/5 Deploy de produção (build na nuvem — pode levar minutos)"
vercel deploy --prod

echo ""
echo "✓ Segredos guardados em $SECRETS_FILE (chmod 600) — copie para o seu cofre."
echo "⚠ ENCRYPTION_KEY_V1 cifra CPF/passaporte/nascimento: perder essa chave = perder os dados."
echo "→ Se a URL real do deploy não for $URL_PROD, ajuste BETTER_AUTH_URL e refaça o deploy."
