# Handoff para o Claude Code

## Estado atual
Scaffold pronto: Next.js 15 (App Router, TS strict), Tailwind v4, dependências instaladas
(drizzle, better-auth, motion, Radix, zod, vitest, playwright). Nada de produto foi escrito ainda.

## Subir o ambiente
```bash
npm install
npm run db:up          # Postgres 16 no Docker, cria role zarpa (NOBYPASSRLS) + zarpa_dev e zarpa_test
cp .env.example .env.local   # e preencha; para local o DATABASE_URL já está no formato do compose
npm run dev
```

## O time
Três subagentes em `.claude/agents/`. No Claude Code:
- `> use o agente rafa para criar o schema das 16 tabelas com RLS`
- `> use o agente nina para montar os tokens e o kitchen-sink`
- `> use o agente teo para escrever o teste de isolamento entre tenants`

Fronteira de arquivos em `docs/OWNERSHIP.md`. Handoffs entre eles em `docs/handoffs/`,
status em `docs/status/`.

## Próximo passo (sprint S1)
Critério de aceite: dois tenants no banco e um teste automatizado que, conectado como o role
`zarpa`, tenta ler dado do outro tenant e **retorna zero linhas** — rodando no CI.

Comece pela Rafa (schema + RLS + withTenant) e pelo Téo (teste vermelho) em paralelo.
A Nina não depende de nenhum dos dois para o design system.
