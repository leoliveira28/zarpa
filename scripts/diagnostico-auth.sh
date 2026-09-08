#!/usr/bin/env bash
# Diagnóstico do 500 no auth em produção: roda o app LOCAL contra o banco NEON
# (o mesmo de produção) e tenta sign-up/sign-in — o stack do erro aparece no
# log do servidor no fim. Sem segredo impresso: a connection string nunca ecoa.
set -uo pipefail
cd "$(dirname "$0")/.."

PORTA=3100
LOG=/tmp/zarpa-dev-neon.log

echo "— obtendo connection string do Neon (não exibida)…"
DATABASE_URL="$(neonctl connection-string br-old-poetry-ac4g99ub --project gentle-bread-99525731 --database-name zarpa --pooled | head -1)"
[ -n "$DATABASE_URL" ] || { echo "✗ sem connection string"; exit 1; }
export DATABASE_URL

echo "— subindo dev na porta $PORTA contra o NEON (aguardando ficar pronto)…"
npx next dev -p "$PORTA" > "$LOG" 2>&1 &
DEV_PID=$!
trap 'kill $DEV_PID 2>/dev/null' EXIT
for _ in $(seq 1 30); do
  curl -s -o /dev/null "localhost:$PORTA" && break
  sleep 1
done

echo "— POST /api/auth/sign-up/email:"
curl -s -w '\nHTTP %{http_code}\n' -X POST "localhost:$PORTA/api/auth/sign-up/email" \
  -H 'Content-Type: application/json' \
  -d '{"email":"qa-deploy@exemplo-zarpa.test","password":"senha-forte-123","name":"QA Diagnóstico"}'

echo "— POST /api/auth/sign-in/email:"
curl -s -w '\nHTTP %{http_code}\n' -X POST "localhost:$PORTA/api/auth/sign-in/email" \
  -H 'Content-Type: application/json' \
  -d '{"email":"qa-deploy@exemplo-zarpa.test","password":"senha-forte-123"}'

echo ""
echo "===== STACK DO SERVIDOR (últimas 60 linhas de $LOG) ====="
tail -60 "$LOG"
