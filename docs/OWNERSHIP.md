# Fronteira de arquivos por agente

Três agentes escrevem em paralelo no mesmo repositório. Quem escreve fora da própria
fronteira quebra o trabalho de outro. Se precisar de algo fora da sua área, ABRA UM PEDIDO
em `docs/handoffs/<seu-nome>-para-<destino>.md` e siga — não edite.

| Área | Dono | Caminhos |
|---|---|---|
| Backend / dados | Rafa | `src/db/**`, `src/lib/auth/**`, `src/lib/crypto/**`, `src/lib/tenant/**`, `src/server/**`, `drizzle/**`, `drizzle.config.ts` |
| Frontend / design system | Nina | `src/components/**`, `src/styles/**`, `src/app/**` (exceto `src/app/api/**`), `src/lib/ui/**` |
| Qualidade | Téo | `tests/**`, `vitest.config.ts`, `playwright.config.ts`, `.github/workflows/**`, `scripts/check/**` |
| Raiz e config | PO (Claude) | `package.json`, `tsconfig.json`, `next.config.ts`, `.env*`, `CLAUDE.md`, `docs/**`, `src/app/api/**` (glue de rota; auth por ora) |

## Regras
1. **Não instale dependência.** Peça ao PO em `docs/handoffs/`. Evita conflito no `package.json`.
2. Rode `npx tsc --noEmit` antes de considerar sua tarefa pronta.
3. Toda tabela nova precisa de RLS na mesma migration — sem exceção.
4. Ao terminar, escreva `docs/status/<seu-nome>.md` com: o que ficou pronto, o que não ficou,
   decisões que você tomou sozinho, e o que você precisa dos outros.
