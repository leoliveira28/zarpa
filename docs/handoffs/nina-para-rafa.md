# Nina → Rafa

## 1. `npm run build` quebra em `src/server/storage.ts` — Turbopack resolve o import dinâmico mesmo com especificador não literal

Bloqueante para o S5/S6: é a primeira vez que uma página de verdade importa de
`@/server` (`proposals.ts` → `storage.ts`), então é a primeira vez que o build
de produção passa por esse arquivo.

```
Error: Turbopack build failed with 1 error:
./src/server/storage.ts:68:26
Error: Module not found: Can't resolve '@vercel/blob'
```

O comentário em `storage.ts` explica que o especificador foi posto numa
variável (`const especificador = '@vercel/blob'; import(especificador)`)
exatamente para o `tsc --noEmit` não tentar resolver o pacote ausente — e
isso funciona, confirmei com `npx tsc --noEmit` limpo. O problema é outro
bundler: o Turbopack do `next build` (Next 16.3.4) ainda enxerga essa
variável como constante (é literalmente uma linha acima, sem nenhum desvio
de fluxo no meio) e tenta resolver o módulo estaticamente do mesmo jeito.
`npx tsc --noEmit` e `next build` são compiladores diferentes com heurísticas
diferentes — o truque que engana um não engana o outro.

Não é algo que eu possa consertar do meu lado: `src/server/**` é sua área, e
`package.json` (instalar `@vercel/blob` de verdade) é do PO. Três saídas que
enxerguei, para você e o PO decidirem:

1. **Instalar `@vercel/blob` como dependência de verdade** (mesmo sem
   `BLOB_READ_WRITE_TOKEN` em dev) — o pacote resolve, o código de fallback
   continua rodando quando a env var não existe, e o import deixa de ser
   dinâmico-por-necessidade (podia até virar `import` estático no topo).
   Peço isso também em `docs/handoffs/rafa-para-po.md`, se ainda não pedi.
2. Comentário de bundler para pular a análise estática —
   `/* webpackIgnore: true */` antes do `import()` funciona no webpack; não
   confirmei se o Turbopack tem o equivalente (`turbopackIgnore`, talvez).
   Vale um teste rápido antes de descartar.
3. Mover a chamada dinâmica para trás de `eval('import(' + JSON.stringify(especificador) + ')')`
   — funciona porque bundler nenhum analisa dentro de `eval`, mas é
   gambiarra de verdade e complica minificação/sourcemap. Última opção.

**Isto é mais grave do que parece à primeira vista — não é só `/propostas/**`.**
Testei com `npm run dev` (limpando `.next` antes, para afastar cache velho) e
até `GET /entrar` devolve 500 com o MESMO erro, mesmo essa rota não
importando nada de `proposals.ts`. A explicação: o Next precisa de um mapa
global de Server Actions (todo `'use server'` do app, para resolver a ação
pelo id que o client manda) — então `storage.ts`, alcançado a partir de
`enviarImagemDaProposta`, entra num chunk compartilhado por TODAS as rotas, e
o erro de bundling de um arquivo quebra o app inteiro, não só quem chama a
função.

Ou seja: com o código de vocês dois (proposals.ts + storage.ts) do jeito que
está hoje, o app não builda nem sobe em dev nenhuma rota — não é um problema
que eu possa isolar do lado da interface. `npx tsc --noEmit` e a suíte de
guarda visual (`tests/design/guards.test.ts`) continuam verdes porque nenhum
dos dois passa pelo bundler; não consegui completar a verificação manual
("logar e montar uma proposta") pedida para o fim do S5/S6 por causa disso —
ver `docs/status/nina.md`.

## 2. Falta um `listarNegocios()` (ou equivalente) para o seletor de "Nova proposta"

`criarPropostaAPartirDoNegocio({ dealId, title? })` pede um `dealId` que já
existe — mas não há hoje nenhum serviço que LISTE negócios do tenant para um
seletor por nome (`listarPropostas` só devolve negócio de proposta já
criada). Resolvi com um campo "Cole o ID do negócio" na Sheet de criação
(`src/app/(app)/propostas/PropostasScreen.tsx`, `NovaPropostaSheet`) — funciona
de ponta a ponta (testei colando o `id` de um negócio do seed direto no
Postgres), mas é claramente um provisório, documentado na tela com uma
`FieldHint`.

Pedido: um `listarNegocios()` (`NegocioResumo[]` com pelo menos `id`, `title`,
`destination`, `contactName`, `currency` — mesma forma que `PropostaResumo` já
usa para os campos de negócio) destrava trocar o campo de texto por um
`Combobox` de verdade. É uma troca de um componente só no meu lado, não uma
reforma da tela.
