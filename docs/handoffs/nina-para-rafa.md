# Nina → Rafa

## Tela de login está no ar — um pedido pequeno, sem bloquear nada

`/entrar` (`src/app/entrar/`) e o guard de sessão em `src/app/(app)/layout.tsx`
estão prontos e testados de ponta a ponta com `dev@zarpa.local` / `dev12345`.
Usei exatamente o que você documentou em `rafa-para-nina.md` — `authClient` do
client, `getAuthContext()` do servidor no guard, `callbackURL: '/hoje'` nas
duas chamadas.

## O pedido: mapa de erro por `error.code`, não por `error.message`

Hoje `src/lib/ui/authErrors.ts` traduz erro do Better Auth casando substring
em `error.message.toLowerCase()` ("invalid email or password" → "E-mail ou
senha incorretos.", etc.). Funciona, mas é frágil: qualquer mudança de texto
do Better Auth (ou de locale deles) quebra a tradução sem avisar — o teste não
falha, a tela só volta a mostrar inglês cru.

Você tinha oferecido construir esse mapa a partir de `error.code` em vez de eu
traduzir string solta no componente. Se isso ainda fizer sentido no seu lado,
o que eu preciso é só: `error.code` (ou o texto exato de cada `code`) dos
casos que já mapeei —

- credencial errada (`INVALID_EMAIL_OR_PASSWORD` ou o nome real do code)
- usuário inexistente (login por magic link, que não cria conta —
  `disableSignUp: true`)
- e-mail não confirmado, se isso puder acontecer no fluxo de senha
- limite de tentativas

Com os `code`s eu troco a comparação em `mapAuthError()` sem mexer em mais
nada — a função já devolve `{ field, message, correction }`, então a tela de
login não muda uma linha.

Não é bloqueio: a tela funciona hoje, o pedido é só robustez.

## O que eu toquei fora de `src/app/entrar/`

- `src/app/(app)/layout.tsx` — virou `async`, chama `getAuthContext()` (seu
  barril de servidor) e `redirect('/entrar')` sem sessão. Dentro da minha
  fronteira (`src/app/**` exceto `api`), citando aqui só para constar que o
  guard mora lá, não em middleware.
- `src/components/app/AppShell.tsx` — adicionei um botão "Sair" na coluna
  lateral (`signOut()` do seu client + `router.push('/entrar')`). Sem ele não
  havia como encerrar sessão pela UI, só apagando cookie na mão.

## Quando `src/server/signup.ts` existir

A tela de login já está pronta para ganhar um link "Criar conta" — não
implementei porque `signUp.email` ainda não tem tenant para apontar (você
documentou isso). Me avise quando priorizar; é troca pequena no
`src/app/entrar/LoginScreen.tsx`.
