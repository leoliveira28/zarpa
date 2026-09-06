#!/usr/bin/env bash
# Roda tudo, na ordem que faz sentido: rápido e estático primeiro, banco
# depois, integração por último. Não para no primeiro vermelho — cada passo
# roda, o resultado fica registrado, e o resumo do fim diz exatamente o que
# passou e o que faltou. É o que faz "rodei o all.sh" significar alguma
# coisa: sem isso, quem só olha o último comando da tela acha que passou.
#
#   scripts/check/all.sh              # tudo, inclusive build + Playwright
#   scripts/check/all.sh --fast       # pula build/Playwright (typecheck,
#                                      # lint, guardas de banco e de design,
#                                      # vitest) — o que roda em segundos
#
# Precisa de Postgres em pé (DATABASE_URL / TEST_DATABASE_URL em .env.local).
# Não instala nada — se faltar dependência, o passo falha e diz o quê.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

FAST=0
[[ "${1:-}" == "--fast" ]] && FAST=1

RESET=$'\033[0m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; DIM=$'\033[2m'

declare -a NAMES=()
declare -a RESULTS=()   # "ok" | "fail" | "skip"
declare -a DURATIONS=()

run_step() {
  local name="$1"; shift
  echo ""
  echo "${BOLD}── ${name} $(printf -- '─%.0s' $(seq 1 $((60 - ${#name}))))${RESET}"
  local start=$(date +%s)
  if "$@"; then
    RESULTS+=("ok")
  else
    RESULTS+=("fail")
  fi
  local end=$(date +%s)
  NAMES+=("$name")
  DURATIONS+=("$((end - start))s")
}

skip_step() {
  local name="$1" reason="$2"
  echo ""
  echo "${BOLD}── ${name} $(printf -- '─%.0s' $(seq 1 $((60 - ${#name}))))${RESET}"
  echo "  ${YELLOW}pulado${RESET} — ${reason}"
  NAMES+=("$name"); RESULTS+=("skip"); DURATIONS+=("—")
}

# --- 1. Estático, sem banco -------------------------------------------------
run_step "tsc --noEmit"              npx tsc --noEmit
run_step "eslint"                    npm run lint --silent

# --- 2. Guardas de direção visual (estrutural, sem banco) -------------------
run_step "guarda de contraste WCAG (tokens.css)"  npx tsx scripts/check/contrast.ts
run_step "guardas de direção 'Papel e Pedra' + relatório" bash -c '
  npx tsx scripts/check/design-report.ts
  # design-report.ts sempre sai 0 (é relatório) — o portão de verdade é o
  # teste do vitest (tests/design/guards.test.ts), rodado no passo "vitest".
  # Chamamos aqui só para ter o "o quê e onde" visível localmente.
'

# --- 3. Banco: precisa de Postgres em pé ------------------------------------
if command -v pg_isready >/dev/null 2>&1 && ! pg_isready -q 2>/dev/null; then
  echo ""
  echo "${YELLOW}${BOLD}Postgres não responde em localhost:5432 — os passos de banco vão falhar.${RESET}"
  echo "${DIM}npm run db:up (docker) ou 'service postgresql start' antes de continuar.${RESET}"
fi

run_step "migrations (dev)"          npm run db:migrate --silent
run_step "seed (dev)"                npm run db:seed --silent
run_step "probe de segurança (RLS + isolamento + PII, fora do vitest)" npx tsx scripts/check/security-probe.ts
run_step "mutação (a suíte de segurança sabe ficar vermelha?)" npx tsx scripts/check/mutation.ts
run_step "vitest (cobertura + portão com allowlist nomeada dos 4 vermelhos)" npx tsx scripts/check/known-failures.ts

# --- 4. Integração: build + Playwright --------------------------------------
if [[ "$FAST" == "1" ]]; then
  skip_step "next build"    "--fast"
  skip_step "playwright (a11y /kitchen-sink)" "--fast"
else
  run_step "next build"     npm run build --silent
  run_step "playwright (a11y /kitchen-sink)" npx playwright test
fi

# --- Resumo ------------------------------------------------------------------
echo ""
echo "${BOLD}════════════════════════════════════════════════════════════${RESET}"
echo "${BOLD}Resumo${RESET}"
FAILED=0
for i in "${!NAMES[@]}"; do
  case "${RESULTS[$i]}" in
    ok)   printf "  %sPASSOU%s  %-55s %s\n" "$GREEN" "$RESET" "${NAMES[$i]}" "${DURATIONS[$i]}" ;;
    fail) printf "  %sFALHOU%s  %-55s %s\n" "$RED" "$RESET" "${NAMES[$i]}" "${DURATIONS[$i]}"; FAILED=1 ;;
    skip) printf "  %sPULOU %s  %-55s %s\n" "$YELLOW" "$RESET" "${NAMES[$i]}" "${DURATIONS[$i]}" ;;
  esac
done
echo "${BOLD}════════════════════════════════════════════════════════════${RESET}"

if [[ "$FAILED" == "1" ]]; then
  echo "${RED}${BOLD}Há passo vermelho acima. Não é para ignorar.${RESET}"
  exit 1
fi
echo "${GREEN}${BOLD}Tudo verde (os 4 vermelhos esperados de S7/chave dev estão contabilizados pelo known-failures.ts).${RESET}"
exit 0
