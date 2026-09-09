# Nina → PO

## Contexto
Construí o frontend do S3 (tela Clientes: lista, ficha, assistente de importação) ligado
às Server Actions de verdade (`contacts.ts`, `travelers.ts`, `imports.ts`, `alerts.ts`), como
pedido — sem sample-data, sem stub. `npx tsc --noEmit` e `npm run build` limpos, e testei
subindo `npm run dev` e batendo nas três rotas (`/clientes`, `/clientes/[id]`,
`/clientes/importar`): as três respondem 200 e renderizam o esqueleto certo.

## O que falta para eu conseguir ver a tela funcionando de verdade (não é só meu problema)
Toda função de `src/server/**` chama `requireAuthContext()` primeiro — sem sessão, ela
lança e vira `{ ok: false, code: 'NAO_AUTENTICADO', mensagem: 'Sua sessão expirou.',
correcao: 'Entrar de novo' }`. Isso é o comportamento CORRETO (é exatamente a regra "erro
diz o que aconteceu e oferece a correção"), mas hoje **não existe como ficar autenticado**:

- `docs/handoffs/rafa-para-nina.md` já registrava isso: Better Auth está configurado em
  `src/lib/auth/`, mas o handler HTTP (`src/app/api/auth/[...all]/route.ts`) não existe, e
  não existe tela de login em lugar nenhum.
- `src/app/api/**` está fora da minha fronteira (`docs/OWNERSHIP.md` me exclui
  explicitamente dali) e **também não está listado na fronteira do Rafa** — os caminhos
  dele são `src/db/**`, `src/lib/{auth,crypto,tenant}/**`, `src/server/**`, `drizzle/**`.
  Ninguém é dono declarado de `src/app/api/**` hoje.
- Resultado prático: **toda tela autenticada do produto** (não só Clientes — Hoje, Funil e
  Propostas vão sentir isso assim que pararem de ler `sample-data.ts`) só vai mostrar dado
  de verdade depois que existir uma sessão. Até lá, o caminho feliz de qualquer tela nova
  liga ao backend real só é visível pela leitura do código, não pela tela.

## Pedido
Duas coisas, podem vir juntas ou separadas:

1. **Decidir quem escreve `src/app/api/auth/[...all]/route.ts`.** O conteúdo é literalmente:
   ```ts
   import { auth } from '@/lib/auth';
   import { toNextJsHandler } from 'better-auth/next-js';
   export const { GET, POST } = toNextJsHandler(auth);
   ```
   (texto do próprio Rafa). Se for para mim, preciso que `src/app/api/**` entre na minha
   fronteira em `docs/OWNERSHIP.md` — hoje está explicitamente fora. Se for para o Rafa,
   ele só precisa que alguém abra a exceção do lado dele também (hoje não está listado).

2. **Uma tela de login.** Essa parte É minha (`src/app/**` fora de `api`), mas preciso saber
   pelo Rafa qual fluxo o Better Auth está configurado para aceitar (`rafa-para-nina.md`
   menciona "magic link + senha") para desenhar o formulário certo — não vou adivinhar o
   contrato do `authClient`.

## O que NÃO travou nesta entrega
A tela de Clientes está completa e correta no estado atual (sem sessão): lista, ficha,
importação de planilha, autosave, e o estado de erro "Sua sessão expirou" aparece do jeito
que a regra do CLAUDE.md pede. Quando a sessão existir, não deve ser necessário mudar nada
em `src/app/(app)/clientes/**` — as telas já chamam as Server Actions certas.
