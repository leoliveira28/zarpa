# Rafa → Nina

O que já existe do lado do servidor para você chamar, e as três coisas que mudam como o
componente é escrito.

## Login: o `authClient` está pronto (`src/lib/auth/client.ts`)

Import **sempre** de `@/lib/auth/client`, nunca de `@/lib/auth` (sem sufixo). O barril
`@/lib/auth` reexporta `./auth` e `./db`, que puxam a conexão Postgres e o
`BETTER_AUTH_SECRET` — se um Client Component importar isso, arrasta segredo/driver de
banco para o bundle do browser. `@/lib/auth/client` é o único arquivo desta área que não
importa nada de servidor; pode importar à vontade de um `'use client'`.

```ts
import { authClient, signIn, signUp, signOut, useSession, getSession } from '@/lib/auth/client';
```

### E-mail + senha

```ts
const { data, error } = await authClient.signIn.email({
  email,
  password,
  callbackURL: '/hoje', // para onde o Better Auth redireciona depois — ver seção abaixo
});
```

- Sucesso: `data` = `{ redirect: boolean, token: string, url?: string, user: {...} }`.
  `user` inclui `id`, `email`, `name`, `emailVerified`, mais os campos extras do tenant
  (`tenantId`, `role`) — ver "Ler a sessão" abaixo, porque eles não vêm tipados por
  padrão no client.
- Erro (senha errada, usuário inexistente etc.): `data` é `null`, `error` vem preenchido —
  `error.message` já é o texto pronto do Better Auth (em inglês: "Invalid email or
  password"). Se quiser mensagem em pt-BR seguindo a regra do CLAUDE.md ("erro diz o que
  aconteceu e oferece a correção"), me avise que eu built um mapa de `error.code` → texto
  em `src/lib/auth/` em vez de você traduzir string solta no componente.
- Cadastro é o mesmo formato em `authClient.signUp.email({ name, email, password,
  callbackURL })` — **mas hoje não tem para onde essa chamada apontar de verdade**: o
  cadastro público precisa criar o tenant primeiro (`src/server/signup.ts`, que ainda não
  existe) antes de chamar `signUpEmail`, porque `tenantId` é obrigatório e nunca vem do
  corpo da requisição (ver `src/lib/auth/auth.ts` se quiser o porquê). Não é bug seu: se a
  tela de cadastro for entrar neste sprint, me avise que eu priorizo o `signup.ts`.

### Magic link

```ts
const { data, error } = await authClient.signIn.magicLink({
  email,
  callbackURL: '/hoje',
});
// data: { status: true } — não cria sessão aqui. A sessão nasce quando a pessoa clica
// no link recebido (10 min de validade) e o Better Auth resolve /magic-link/verify por
// trás, batendo no callbackURL. Não tem token para pegar nesta chamada.
```

Sem `RESEND_API_KEY` configurada (hoje, em dev), o link **não é enviado por e-mail** — ele
vai para o console do servidor Next (`[auth] magic link para d***@...: http://...`).
Terminal do `next dev`, não o do browser.

Só entra usuário **já existente**: `disableSignUp: true` no plugin, de propósito — magic
link não cria conta nova (evita nascer usuário sem tenant a partir de um e-mail
arbitrário).

### Ler a sessão

No client (componente, hook):

```ts
const { data: session, isPending, error } = useSession();
// session: { user: {...}, session: {...} } | null, enquanto isPending, use skeleton
```

`session.user.tenantId` e `session.user.role` existem em runtime (o Better Auth grava
esses campos), mas o tipo inferido pelo `useSession()` não os lista por padrão — o cast é
esperado, não gambiarra:

```ts
const user = session?.user as unknown as { id: string; email: string; tenantId?: string; role?: string } | undefined;
```

Se isso incomodar na tela, me avise que eu resolvo do lado do client (`$Infer` do Better
Auth aceita ser ensinado sobre os `additionalFields`) em vez de espalhar o cast pelos
componentes.

No servidor (Server Component, Server Action), **não use o `authClient`** — use
`getAuthContext()` / `requireAuthContext()` de `@/lib/auth` (o barril de servidor, esse
sim pode ser importado em código de servidor):

```ts
import { requireAuthContext } from '@/lib/auth';
const { userId, tenantId, email, role } = await requireAuthContext();
```

### Redirecionamento pós-login

`/hoje` — é a tela inicial (`src/app/(app)/hoje`). Passe `callbackURL: '/hoje'` nas
chamadas de `signIn.email` / `signIn.magicLink`. Sessão dura 30 dias
(`session.expiresIn`), renovando no máximo 1x por dia — não precisa relogar toda hora.

### Credenciais de desenvolvimento

Criadas pelo seed (`node --import ./src/db/_register.mjs --env-file=.env.local
src/db/seed.ts`), no tenant "Volta ao Mundo":

```
email: dev@zarpa.local
senha: dev12345
```

Rodar o seed de novo apaga e recria esse usuário (idempotente, preso ao ciclo de vida do
tenant demo). Confirmei login ponta a ponta chamando `auth.api.signInEmail` direto no
servidor: cria sessão de verdade na tabela `session`, com `tenantId` correto vindo junto
no `user`, e senha errada é rejeitada. Detalhes em `docs/status/rafa.md`.

## Como chamar

Tudo em `src/server/`. As funções são `'use server'` e devolvem **sempre** um
`ServiceResult`, nunca lançam:

```ts
import { listarContatos, criarContato } from '@/server';

const r = await listarContatos({ busca: 'marcos' });
if (!r.ok) {
  // r.mensagem  -> texto pronto, em português, para mostrar
  // r.correcao  -> o que oferecer no botão junto do erro ("Corrigir e salvar de novo")
  // r.campo     -> qual campo do formulário destacar, quando houver
  return;
}
r.data; // ContatoResumo[]
```

Isso é de propósito: uma Server Action que estoura vira *"An error occurred in the Server
Components render"* na tela, que não diz nada a ninguém. Aqui o erro é dado, e a mensagem
já vem escrita para caber na regra do CLAUDE.md ("erro diz o que aconteceu E oferece a
correção, com o botão junto").

Disponível hoje:

| função | devolve |
|---|---|
| `listarContatos({ busca?, limite? })` | `ContatoResumo[]` |
| `criarContato(input)` | `ContatoResumo` |
| `arquivarContato(id)` | `null` |
| `obterDocumentoDoViajante(id)` | `{ cpf, passaporte }` |
| `obterTenantAtual()` | `TenantAtual` (nome, plano, marca) |
| `atualizarMarca(input)` | `null` |

`obterTenantAtual()` é de onde saem `brandName`, `brandLogoUrl`, `brandPrimaryColor` e
`brandSecondaryColor` — a marca do agente, que manda na aparência da proposta pública.

## 1. Você nunca passa `tenantId`. Nenhuma função aceita.

O tenant sai da sessão, dentro do servidor. Se em algum momento parecer que você precisa
mandar o id do tenant como argumento, é bug meu — me chame em vez de contornar.

## 2. Dinheiro vem em centavos, como `number`

`valueCents: 4280000` é R$ 42.800,00. Nunca divida por 100 para guardar em estado; formate
só na hora de exibir. Combina com a regra de `tabular-nums` + largura reservada: o valor já
chega com precisão fixa, então a largura só depende do número de dígitos.

## 3. CPF e passaporte não vêm nas listagens. É intencional.

`ContatoResumo` tem `temDocumento: boolean`, não o documento. Para mostrar o documento de
verdade existe `obterDocumentoDoViajante(id)`, que é uma chamada separada **e grava em
`audit_log` quem viu o quê**. Então: só chame quando a pessoa pedir explicitamente (um
"mostrar documento"), não para preencher um card que talvez ninguém abra.

Se precisar exibir de forma parcial sem custo, tem `maskDocument` em `@/lib/crypto`
(`***8909`). Ela é síncrona e não toca no banco.

## Sobre estados vazios e skeleton

O seed cria dois tenants com dados de verdade (`npm run db:seed`, ver
`docs/handoffs/rafa-para-po.md` enquanto o script não existe): 2 contatos, 2 negócios e 1
proposta com 2–3 opções cada, e proposta já com 2 aberturas registradas. Serve para montar
lista, pipeline e o "seu cliente abriu a proposta" sem precisar inventar mock. Nomes são
reconhecíveis (`Volta ao Mundo` × `Maré Alta`) justamente para dar para ver, olhando a
tela, se algo de um tenant vazou no outro.

## O que **não** existe ainda e você vai sentir falta

- **Página pública da proposta.** Não implementei a leitura sem login no S1 (motivo em
  `docs/status/rafa.md`). Se `/p/[token]` estiver no seu escopo do S2, me avise que subo a
  função de leitura antes — ela precisa de um desenho específico por causa do RLS, não é só
  um `select`.
- **Serviços de deals / proposals / tasks.** Só contatos e tenant têm camada de serviço.
  O schema das outras está pronto; escrevo os serviços conforme a tela for chegando — me
  diga a ordem que ajuda mais.
- **Tela de login em si.** O client (`@/lib/auth/client`), a rota do handler
  (`src/app/api/auth/[...all]/route.ts`, já existe, escrita pelo PO) e o usuário dev estão
  prontos — ver seção "Login" no topo deste arquivo. O que falta é o componente/formulário,
  que é seu.
- **Cadastro público (`signUp.email`).** O client aceita a chamada, mas não tem
  `src/server/signup.ts` do lado de trás ainda (precisa criar o tenant antes do usuário).
  Não monte a tela de cadastro esperando que funcione hoje — me avise quando for a vez
  dela.
