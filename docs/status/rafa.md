# Status — Rafa (backend / plataforma)

## Tarefa desta rodada: client de auth para o browser, usuário dev, contrato para a Nina

### Pronto

1. **`src/lib/auth/client.ts`** — `createAuthClient` de `better-auth/react` com
   `magicLinkClient()` de `better-auth/client/plugins`. Exporta `authClient`, `signIn`,
   `signUp`, `signOut`, `useSession`, `getSession`. Não importa nada de `./auth`, `./db`
   nem `./session` — conferido lendo o arquivo inteiro, não só rodando `tsc`.

2. **Usuário dev semeado de verdade** — `dev@zarpa.local` / `dev12345`, tenant "Volta ao
   Mundo", criado por `auth.api.signUpEmail` dentro de `src/db/seed.ts` (nunca INSERT à
   mão nas tabelas do Better Auth: a senha nasce com o hash de scrypt de verdade). Rodei o
   seed duas vezes seguidas para confirmar idempotência (apaga e recria o tenant + o
   usuário junto, via `ON DELETE CASCADE`).

   Provei login ponta a ponta chamando `auth.api.signInEmail` direto (fora de HTTP, mesmo
   caminho de código que a rota usa): sessão real gravada na tabela `session`, com
   `expiresAt` 30 dias à frente, `tenantId` correto no `user` da resposta, e senha errada
   corretamente rejeitada com "Invalid email or password". Script de verificação foi
   temporário (`src/db/_devTestLogin.ts`) e já foi apagado — não sobrou no repo.

3. **`docs/handoffs/rafa-para-nina.md`** atualizado com uma seção nova de login: como
   chamar `signIn.email`, `signIn.magicLink`, `signUp.email`, como ler sessão no client
   (`useSession`) e no server (`requireAuthContext`), credenciais dev, e o redirecionamento
   (`/hoje`). Removi o bullet antigo "login com tela" (a rota já existe, escrita pelo PO) e
   deixei claro o que ainda falta: o formulário em si (dela) e `src/server/signup.ts` para
   cadastro público (meu, ainda não escrito).

### Decisões que tomei sozinha (e por quê)

- **Não reexportei `authClient`/`useSession` do barril `src/lib/auth/index.ts`.** A tarefa
  pedia isso, mas esse barril já reexporta `./auth` e `./db` — que importam a conexão
  Postgres e leem `BETTER_AUTH_SECRET`. Se um Client Component importasse `useSession` de
  `@/lib/auth`, o bundler arrastaria essa cadeia inteira (webpack tentaria resolver
  `postgres`, que usa módulos Node como `net`/`tls`, inexistentes no browser) — na melhor
  hipótese quebra o build, na pior vaza referência a segredo de conexão para o bundle
  client. Isso contraria diretamente o "cuidado" que a própria tarefa pede ("esse arquivo
  roda no browser — não pode importar nada de servidor"). Documentei a regra no topo de
  `index.ts` e no handoff: Nina importa de `@/lib/auth/client`, ponto.

- **`tenantId` do usuário: troquei `databaseHooks` por `defaultValue` na additionalField**
  (`src/lib/auth/auth.ts`). O código que encontrei tinha `tenantId: { required: true,
  input: false }` sem `defaultValue` — isso é inconsistente por construção no Better Auth
  1.7: um campo `input:false` nunca pode vir do corpo da requisição, mas `required:true`
  sem `defaultValue` faz o parser rejeitar TODA criação de usuário com "tenantId is
  required", antes mesmo de qualquer hook rodar. Ou seja: `signUpEmail` estava
  inutilizável como estava, para qualquer chamador, seed incluso. Corrigi trocando por um
  `defaultValue` (função), que é o mecanismo do próprio Better Auth para "campo que não
  vem do cliente mas precisa existir" — só é consultado quando o campo NÃO está no corpo
  (o caso normal, já que é `input:false`).

  Criei `src/lib/auth/signupContext.ts`: um `AsyncLocalStorage` (`withPendingTenant` /
  `pendingTenantId`) por onde o `tenantId` chega no `defaultValue`. É seguro porque só
  código rodando no mesmo processo Node pode preencher esse valor — não existe header,
  cookie ou campo de JSON que um cliente HTTP consiga usar para isso. Se
  `signUpEmail` rodar fora de um `withPendingTenant`, a função lança um erro claro em vez
  de deixar `tenant_id` chegar `NULL` no INSERT. Mantive também um `databaseHooks.user.create.before`
  como defesa em profundidade (cobre um eventual caminho de criação de usuário que não
  passe pelo parser de additionalFields, ex. um plugin futuro).

  Isto é infraestrutura que `src/server/signup.ts` (cadastro público, ainda não escrito)
  vai reusar: cria o tenant primeiro, depois chama `signUpEmail` dentro de
  `withPendingTenant(tenantId, ...)`.

- **Migration nova: `drizzle/0002_account_issuer.sql`.** Rodando o seed contra
  `better-auth@^1.7.2` (a versão instalada), o adapter Drizzle recusou qualquer escrita em
  `account` com `BetterAuthError: The field "issuer" does not exist in the "account"
  Drizzle schema`. É uma mudança de schema do próprio Better Auth 1.7 (["account identity
  is scoped by issuer"](https://better-auth.com/docs/guides/1-7-upgrade-guide#account-identity-is-scoped-by-issuer)),
  não uma escolha minha — a tabela `account` como estava em `0000_fundacao` datava de uma
  versão anterior da lib. Sem isso, **nenhum** cadastro por e-mail/senha (nem, no futuro,
  social login) teria funcionado — não é cosmético.

  Adicionei a coluna `issuer text NOT NULL` (com backfill de `provider_id` para linhas
  pré-existentes, embora não houvesse nenhuma neste banco), troquei o índice único de
  `(provider_id, account_id)` para `(issuer, account_id)` — exatamente o que
  `getAuthTables()` do Better Auth espera — e apliquei a migration nos dois bancos
  (`zarpa_dev` e `zarpa_test`). Atualizei `src/db/schema/auth.ts` (`account.issuer` +
  `account_issuer_account_key`) para bater com o SQL. RLS da tabela não mudou (já tinha
  `ENABLE`+`FORCE`+`account_auth_service`, isso não é alteração de tabela nova).

- **Corrigi um bug de idempotência em `src/db/seed.ts` (`limparDemo`).** A função usava
  `unsafeDbWithoutTenant.select(...)` para achar os tenants demo a apagar antes de
  recriar. `tenants` nasce com `FORCE ROW LEVEL SECURITY` e só tem duas policies:
  `tenants_isolation` (exige `app.tenant_id` == id, que ainda não se sabe nesse ponto) e
  `tenants_auth_service` (exige `app.auth_context = 'on'`). Sem nenhum dos dois GUCs
  setados — que é exatamente o estado de `unsafeDbWithoutTenant` — a query sempre
  devolvia zero linhas, silenciosamente. Rodar o seed pela segunda vez nunca limpava
  nada, e o INSERT seguinte estourava `tenants_slug_key`. Troquei para `authDb` (a
  conexão de `src/lib/auth/db.ts`, que liga `app.auth_context=on` — o único cliente com
  policy pra isso), que é literalmente o cenário para o qual `tenants_auth_service`
  existe. Confirmado rodando o seed duas vezes seguidas.

### Verificação

- `npx tsc --noEmit` limpo.
- `npx tsx scripts/check/known-failures.ts`: 321 testes, só os 3 vermelhos esperados do
  S7 (função `SECURITY DEFINER` da proposta pública, que ainda não existe — não mexi
  nisso agora).
- Seed rodado duas vezes seguidas contra `zarpa_dev`, idempotente.
- Migration `0002_account_issuer` aplicada em `zarpa_dev` e `zarpa_test`
  (`node --import ./src/db/_register.mjs --env-file=.env.local src/db/migrate.ts`, com e
  sem `USE_TEST_DATABASE=1`); `src/db/migrate.ts` confirma RLS habilitado e forçado em
  todas as 18 tabelas depois.
- Login ponta a ponta confirmado via `auth.api.signInEmail`/`signInEmail` errado, ver
  acima.

### Riscos e o que fica para depois

- **`src/server/signup.ts` (cadastro público) não existe ainda.** `authClient.signUp.email`
  do lado do client já funciona tecnicamente, mas sem esse arquivo do lado do servidor
  qualquer chamada real vai bater no erro "tenantId is required" (`pendingTenantId()`
  vazio fora de `withPendingTenant`). Avisei a Nina para não montar a tela de cadastro
  esperando que funcione hoje.
- **Mensagens de erro do Better Auth vêm em inglês** ("Invalid email or password"). Se
  a regra do CLAUDE.md de erro-com-correção for para valer já na tela de login, preciso
  escrever um mapa `error.code -> mensagem pt-BR` — ofereci isso no handoff, esperando
  sinal da Nina/PO sobre prioridade.
- **`useSession()` não tipa `tenantId`/`role`** (`additionalFields` não propaga para o tipo
  do client automaticamente nesta versão). Documentei o cast necessário; dá para resolver
  do lado do client se incomodar na prática.
- A migration `0002` foi descoberta rodando o seed, não por auditoria prévia de todas as
  tabelas do Better Auth contra a versão instalada — se houver mais alguma coluna nova
  faltando que só aparece em outro fluxo (ex. troca de senha, verificação de e-mail),
  ainda não testei esses caminhos.
- Não toquei em `src/app/**`, `tests/**`, `package.json` — fronteira respeitada.
