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

## Construtor de proposta (S5/S6) — contrato completo

Tudo em `src/server/proposals.ts` (proposta, opções, blocos) e `src/server/library.ts`
(acervo reutilizável). Exportado por `@/server`, mesmo padrão de sempre: `'use server'`,
`ServiceResult<T>`, `tenantId` nunca como argumento (sai da sessão).

### Proposta

| função | assinatura | devolve |
|---|---|---|
| `listarPropostas(filtro?)` | `{ busca?, incluirArquivadas?, limite? }` | `PropostaResumo[]` |
| `criarPropostaAPartirDoNegocio(input)` | `{ dealId: uuid, title?: string }` | `PropostaEdicao` (nasce `status: 'draft'`, `options: []`, `blocks: []`) |
| `obterPropostaParaEdicao(propostaId)` | `string` | `PropostaEdicao` — meta + `options[]` + `blocks[]`, tudo já ordenado por `position` |
| `atualizarProposta(propostaId, patch)` | `{ title?, summary?, terms?, coverImageUrl?, currency?, validUntil? }` | `PropostaMeta` — **autosave granular**: só os campos presentes no patch mudam, sem "salvar tudo" |
| `arquivarProposta(propostaId)` | `string` | `null` |
| `restaurarProposta(propostaId)` | `string` | `null` — o lado do toast com desfazer de 8s (regra do CLAUDE.md, sem modal "tem certeza?") |

`PropostaMeta` **nunca** inclui `cost_cents`/`commission_cents` (esses só existem em
`OpcaoEdicao`, ver abaixo). `PropostaEdicao = PropostaMeta & { options: OpcaoEdicao[];
blocks: BlocoEdicao[] }`.

`validUntil` é string `AAAA-MM-DD` (ou `''` para limpar); string vazia em `summary`,
`terms`, `coverImageUrl` também limpa o campo (grava `null`).

### Opções (até 3 por proposta, comparáveis)

| função | assinatura | devolve |
|---|---|---|
| `criarOpcao(propostaId, input)` | `{ name, description?, position?, priceCents?, costCents?, commissionCents?, installments?, installmentCents?, isRecommended? }` | `OpcaoEdicao` |
| `atualizarOpcao(opcaoId, patch)` | mesmo shape, tudo opcional (autosave por campo) | `OpcaoEdicao` |
| `excluirOpcao(opcaoId)` | `string` | `null` — apaga os blocos da opção junto (`ON DELETE CASCADE`); se era a opção aceita, `proposals.acceptedOptionId` volta a `null` sozinho |
| `reordenarOpcoes(propostaId, itens)` | `{ id: uuid, position: number }[]` (1 a 3 itens) | `null` — tudo ou nada: se um id não pertence a esta proposta, `CONFLITO` e nada muda |

`OpcaoEdicao` inclui `priceCents`, `costCents`, `commissionCents`, `installments`,
`installmentCents`, `isRecommended`. **Isto é intencional e autenticado** — quem edita a
proposta precisa ver a margem. Ver a seção "nunca sai" mais abaixo antes de reaproveitar
esse tipo em qualquer tela que não seja o construtor autenticado.

Regra de negócio embutida: marcar `isRecommended: true` numa opção desmarca as outras da
mesma proposta automaticamente — a interface não precisa fazer essa coordenação.

**Parcelamento**: `installments` (1–24) e `installmentCents` são digitados pelo agente e
gravados como vieram — o servidor NÃO recalcula a cada leitura (juros de cartão às vezes
fazem `installmentCents * installments` não bater com `priceCents`, e isso é legítimo).
Quando o agente ainda não digitou `installmentCents`, o servidor sugere um palpite:
`sugerirValorParcelaCents(priceCents, installments)` = `priceCents` dividido em N,
arredondado **para cima** no centavo (a diferença sobra para o agente, nunca falta para o
cliente). Mesma lógica para `commissionCents` quando ausente:
`sugerirComissaoCents(priceCents, costCents)` = `max(0, priceCents - costCents)`. Se você
quiser mostrar esse palpite na interface ANTES de o agente salvar (ex. atualizar um campo
"parcela sugerida" enquanto ele digita o preço, sem round-trip), as duas funções estão em
`src/server/pricing.ts` — mas são helpers síncronos de matemática pura, não Server Actions;
se precisar delas no client, me avise que decido o melhor jeito de expor (não são
`'use server'`).

A comparação das 3 opções lado a lado é responsabilidade da interface: `options[]` já vem
ordenado por `position`, com todos os campos necessários — não existe endpoint separado de
"comparação", é a mesma lista.

### Blocos (hotel, voo, transfer, passeio, seguro, texto livre, imagem, nota de preço)

`BlocoKind = 'text' | 'image' | 'flight' | 'hotel' | 'transfer' | 'tour' | 'cruise' |
'insurance' | 'price_note'`.

| função | assinatura | devolve |
|---|---|---|
| `criarBloco(propostaId, input)` | `{ optionId?: uuid \| null, kind: BlocoKind, position?, title?, body?, images?: string[] (máx 10), content?: Record<string, unknown> }` | `BlocoEdicao` |
| `atualizarBloco(blocoId, patch)` | mesmo shape, tudo opcional | `BlocoEdicao` |
| `excluirBloco(blocoId)` | `string` | `null` |
| `reordenarBlocos(propostaId, itens)` | `{ id: uuid, position: number }[]` (até 200) | `null` — tudo ou nada, mesmo desenho de `reordenarOpcoes` |

`optionId: null`/omitido = bloco da proposta inteira (aparece em todas as opções); um uuid
= bloco só daquela opção. Trocar `optionId` num patch é permitido e validado — o servidor
confere que a opção de destino pertence à mesma proposta antes de mover.

`content` é o campo livre por tipo (nº do voo, diárias, categoria do quarto — schema não
impõe forma interna, só que seja objeto JSON). `images` é sempre array de URL, nunca objeto
solto.

### Biblioteca (acervo reutilizável)

`ItemBibliotecaKind` é o mesmo enum de bloco, menos `price_note` (não faz sentido salvar
"nota de preço" como modelo reaproveitável).

| função | assinatura | devolve |
|---|---|---|
| `listarBiblioteca(filtro?)` | `{ kind?, origem?: 'tenant' \| 'global' \| 'todos', busca? }` | `ItemBibliotecaResumo[]` — ordenado global primeiro, depois mais recente |
| `obterItemDaBiblioteca(itemId)` | `string` | `ItemBibliotecaResumo` |
| `criarItemNaBiblioteca(input)` | `{ kind, title, body?, images?, details? }` | `ItemBibliotecaResumo` — sempre `isGlobal: false`, mesmo que o input tente mandar diferente (é ignorado) |
| `atualizarItemDaBiblioteca(itemId, patch)` | mesmo shape, opcional | `ItemBibliotecaResumo` |
| `excluirItemDaBiblioteca(itemId)` | `string` | `null` |
| `inserirItemDaBibliotecaComoBloco(propostaId, libraryItemId, optionId?)` | — | `BlocoEdicao` — **cópia**, não referência: editar o bloco depois não muda o item da biblioteca, e vice-versa |

`ItemBibliotecaResumo.tenantId` é `null` exatamente quando `isGlobal: true` (modelo da
plataforma, sem dono — ex. "política de cancelamento padrão"). `origem: 'todos'` (default)
mistura os dois: seu próprio acervo + o global, e a interface decide como separar
visualmente (ex. seção "Modelos" vs "Meu acervo"). Não existe hoje nenhuma tela nem
Server Action que crie item global — isso é escrita exclusiva da plataforma (ver
`docs/handoffs/rafa-para-teo.md` se você tiver curiosidade sobre o desenho; não afeta
nenhuma tela do agente).

Tentar editar/apagar um item que é global (ou de outro tenant) devolve `NAO_ENCONTRADO`
genérico — a mesma resposta de "não existe", de propósito: a interface não descobre que o
id existe em outro lugar.

### Upload de imagem

`enviarImagemDaProposta(arquivo: File)` → `ServiceResult<{ url: string }>`. Aceita
JPG/PNG/WEBP/GIF até 5 MB; erro vem com `mensagem` + `correcao` prontos
(`ARQUIVO_INVALIDO` / `ARQUIVO_GRANDE_DEMAIS` viram `DADOS_INVALIDOS` no `ServiceResult`).
Em dev (sem `BLOB_READ_WRITE_TOKEN`), a URL devolvida é uma `data:` URL inline — grande,
mas funcional para preview e para gravar em `images[]`; não é o formato de produção, mas o
schema não muda quando o Vercel Blob entrar (pedido em `docs/handoffs/rafa-para-po.md`).
Chame essa action, pegue `url`, e passe para `criarBloco`/`atualizarBloco`/
`criarItemNaBiblioteca` dentro do array `images`.

### O que **NUNCA** vai para a proposta pública

A leitura pública (`/p/[token]`, S7) ainda não existe — vai ser uma função própria,
`SECURITY DEFINER`, com sua própria lista de colunas. Mas já registro aqui porque afeta
qualquer decisão de reaproveitar tipo/componente entre o construtor (autenticado) e a
proposta pública (sem login):

- `proposalOptions.costCents` e `proposalOptions.commissionCents` — nunca, em hipótese
  nenhuma, saem por um caminho que o cliente final possa ver. `OpcaoEdicao` os inclui de
  propósito porque é autenticado; não reaproveite `OpcaoEdicao` (nem `COLUNAS_OPCAO` do
  lado do servidor) para renderizar a página pública.
- Documento de passageiro (CPF, passaporte, nascimento) — nem chega perto do construtor de
  proposta; mora em `travelers.ts`/`obterDocumentoDoViajante`, área separada, e não há
  nenhum link entre `proposals`/`proposal_options`/`proposal_blocks` e a tabela de
  viajantes no schema atual.
- Qualquer campo de auditoria (`archivedAt`, quem viu quando) — a página pública é para o
  cliente da viagem, não para o agente.

Se `/p/[token]` entrar no seu escopo antes do S7 estar pronto do meu lado, me avise antes
de montar a tela — ela depende de uma função de leitura que ainda não decidi como
implementar sob `FORCE ROW LEVEL SECURITY` (motivo em `docs/status/rafa.md`).

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

---

## S7 — `enviarProposta`, o botão que liga o link público

Nova action autenticada em `src/server/proposals.ts`:
`enviarProposta(propostaId: string): Promise<ServiceResult<PropostaMeta>>`. É o botão
"Enviar" do construtor (S5/S6) — sem ele, o link público nunca fica acessível (a policy
de leitura pública exige `status <> 'draft' AND sent_at IS NOT NULL`). Recusa com
`DADOS_INVALIDOS` se a proposta ainda não tem nenhuma opção. Reenviar é permitido e
idempotente no que importa (atualiza a marca congelada, não regride status/data de um
estado mais avançado). Devolve o mesmo shape de `PropostaMeta` que você já usa em
`atualizarProposta` — o link fica em `propostaMeta.publicToken` (monte a URL como
`${origem}/p/${publicToken}`, ou o padrão de rota que você decidir).

## S7 — a proposta pública (`/p/[slug]`, ou o caminho que você escolher) tem contrato agora

Duas Server Actions em `src/server/publicProposals.ts`, **sem sessão, sem `tenantId`,
chamáveis de uma página/Client Component que não passou por login**. Import de
`@/server` (o barril já reexporta as duas).

### `obterPropostaPublica(slug: string): Promise<ServiceResult<PropostaPublica | null>>`

Chame no Server Component da rota pública, com o `slug` que vier do segmento de URL. Três
resultados possíveis, e a página TEM que tratar os três sem distinguir "não existe" de
"existe mas não é pública" (mesmo motivo do resto do produto: não vazar pista sobre o que
existe em outro tenant):

- `{ ok: true, data: null }` — slug não existe, ainda é rascunho, ou foi arquivada. Renderize
  um estado "esta proposta não está disponível", não um 404 técnico.
- `{ ok: true, data: PropostaPublica }` — o conteúdo.
- `{ ok: false, ... }` — erro de validação (slug maltratado). Trate igual ao `null` na
  prática; a mensagem em `mensagem`/`correcao` existe mas não deveria aparecer com
  entrada de usuário normal (o slug vem da URL, não de formulário).

```ts
type PropostaPublica = {
  proposal: {
    id: string;
    title: string;
    summary: string | null;
    status: string; // 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired' — nunca 'draft'
    currency: string;
    coverImageUrl: string | null;
    terms: string | null;
    validUntil: string | null; // 'AAAA-MM-DD' ou null
    acceptedOptionId: string | null;
    sentAt: string | null; // ISO
  };
  brand: {
    name: string | null;
    logoUrl: string | null;
    primaryColor: string | null;   // já é a MARCA congelada no envio — não é o `--accent` do produto
    secondaryColor: string | null;
    whatsappLink: string | null;   // "https://wa.me/<dígitos>", pronto para <a href>. NUNCA "whatsapp" cru — ver docs/handoffs/rafa-para-teo.md se tiver curiosidade do porquê do nome
    instagram: string | null;      // handle ou URL, como o agente cadastrou — sem normalização
  };
  options: {
    id: string;
    name: string;
    description: string | null;
    position: number;
    priceCents: number;            // preço ao cliente — SEM cost/commission, esses nunca saem daqui
    installments: number | null;
    installmentCents: number | null;
    isRecommended: boolean;
  }[]; // já vem ordenado por position — não precisa reordenar na tela
  blocks: {
    id: string;
    optionId: string | null;       // null = bloco da proposta inteira; preenchido = só daquela opção
    kind: string;                  // 'text' | 'image' | 'flight' | 'hotel' | 'transfer' | 'tour' | 'cruise' | 'insurance' | 'price_note'
    position: number;
    title: string | null;
    body: string | null;
    images: string[];
    content: Record<string, unknown>; // forma livre por kind, igual ao construtor autenticado
  }[]; // já vem ordenado por position
};
```

`brand.primaryColor` é a cor DA MARCA DO AGENTE, congelada no envio — não confunda com o
`#12557F` do design system do PRODUTO. É provável que a página pública precise dos dois
tokens ao mesmo tempo (um para "isto é do Zarpa", outro para "isto é da agência de
viagem"); decisão de composição visual é sua.

### `registrarVisitaProposta(input): Promise<ServiceResult<null>>`

Chame no `useEffect`/montagem do Client Component da página pública (não dá para chamar
do Server Component — precisa rodar no navegador do cliente final, depois da página já
estar na tela, e de novo ao trocar de aba/desmontar se quiser mandar `durationSeconds`).

```ts
type RegistrarVisitaInput = {
  slug: string;
  durationSeconds?: number;   // segundos inteiros, 0–86400; mande de novo (com este preenchido) ao sair da página
  focusedOptionId?: string;   // qual opção estava em foco (ex.: scroll parou nela) — eu confiro no banco que pertence a esta proposta
  sessionKey?: string;        // gere no cliente (ex.: crypto.randomUUID()) e guarde em sessionStorage, para eu distinguir "voltou a olhar" de "sessão nova" sem cookie
};
```

Sempre devolve `{ ok: true, data: null }` mesmo para slug inválido — não dá pista. IP,
user-agent e referrer eu leio dos headers da própria requisição no servidor (não precisa
mandar nada disso do cliente). Chame uma vez ao montar (sem `durationSeconds`) e,
opcionalmente, de novo ao desmontar (com `durationSeconds` preenchido) — cada chamada
grava uma linha nova em `proposal_views`, não é upsert.

### O que fica de fora — de propósito, sem exceção

`cost_cents`/`commission_cents` de `proposal_options`, qualquer coluna de
`contacts`/`travelers` (CPF, passaporte, e-mail, telefone, nascimento), qualquer dado de
`tenants` que não seja marca (nada de `contactEmail`/`document_encrypted`/etc — a marca
pública vem só de `brand_snapshot`). Isso é reforçado em três camadas: a função SQL nunca
faz `select *`, a policy de RLS só abre linha em status publicável, e há um teste
(`tests/security/public-proposal.test.ts`) que planta canário em toda coluna sensível do
banco e varre a resposta inteira — se você um dia precisar de um campo novo aqui, peça a
mim, não tente puxar de `obterPropostaParaEdicao`/`OpcaoEdicao` (autenticado, tem
cost/commission de propósito).

---

## S8 — tela Hoje: `listarTarefasDeHoje()`, novo, em `src/server/followups.ts`

Contrato para a tela Hoje ler tarefa (manual, alerta de passaporte/aniversário, ou
follow-up de proposta) num lugar só, já com o texto pronto para colar no WhatsApp.

```ts
type TarefaDeHoje = {
  id: string;
  title: string;
  notes: string | null;
  suggestedMessage: string | null; // pronto para "copiar mensagem" — só em tarefa gerada, null em manual
  kind: string;      // 'followup' | 'ligar' | 'whatsapp' | 'email' | 'outro'
  source: string;    // 'manual' | 'alerta_passaporte' | 'alerta_aniversario' | 'importacao' | 'followup_proposta'
  contactId: string | null;
  contactName: string | null;   // já vem do JOIN — não precisa buscar o contato à parte
  dealId: string | null;
  dealTitle: string | null;
  destination: string | null;
  dueAt: Date;
  vencida: boolean;   // dueAt já passou (comparado a "agora", não à meia-noite)
  doneAt: Date | null; // sempre null aqui — a lista já vem fechada às concluídas
  createdAt: Date;
};

async function listarTarefasDeHoje(opcoes?: { limite?: number }): Promise<ServiceResult<TarefaDeHoje[]>>
```

- Devolve tarefa em aberto (`doneAt is null`) com `dueAt` até o fim do dia de hoje (23:59:59
  UTC) — ou seja, **hoje + tudo que já venceu antes**, ordenado por `dueAt` crescente (a mais
  atrasada primeiro). Não filtra por `source`: manual, alerta e follow-up de proposta
  aparecem juntos, é a mesma fila.
- `limite` (padrão 100, teto 300) — mesmo padrão de `limitarTarefas` de `alerts.ts`.
- Para concluir a tarefa, chame `concluirTarefa(tarefaId)` (já existe, já exportado no
  barril, veio do S7/`alerts.ts`) — não criei uma segunda action para isso, é a mesma.
- `suggestedMessage` é texto pronto (tom de agente de viagem, já com nome do cliente e
  destino quando disponíveis) — um botão "copiar" que joga isso na área de transferência
  resolve o produto sem precisar de nenhum editor de texto na tela Hoje.
- `source: 'followup_proposta'` é a régua D+2/D+5/D+10 depois do envio da proposta (S8,
  ver `docs/status/rafa.md`). Se quiser diferenciar visualmente ("follow-up de proposta"
  vs. "alerta de passaporte" vs. "tarefa manual"), o campo `source` já traz a distinção —
  não precisei inventar um segundo enum para isso.

## S9 — vendas, comissão e recebíveis (o dinheiro), contrato completo

Tudo em `src/server/sales.ts`, exportado no barril. Duas tabelas novas —
`sales` e `receivables` — ver `src/db/schema/sales.ts` e
`drizzle/0007_vendas_e_recebiveis.sql`. **Autenticado, sempre**: nenhuma dessas duas
tabelas tem (ou deve ter) equivalente público — diferente de `proposals`, aqui não existe
"link que o cliente vê".

```ts
type ComissaoStatus = 'prevista' | 'recebida' | 'atrasada';
type ParcelaStatus = 'pendente' | 'pago' | 'atrasado' | 'cancelado';

type VendaResumo = {
  id: string;
  dealId: string;
  proposalId: string;
  proposalOptionId: string | null;
  fornecedor: string | null;       // operadora/fornecedor — texto livre, não catálogo
  valorBrutoCents: number;         // preço cobrado do cliente (fotografia da opção aceita)
  custoCents: number;              // NUNCA público — margem do agente
  comissaoPrevistaCents: number;   // NUNCA público
  taxaServicoCents: number;        // honorário do agente, além do preço do produto
  comissaoStatus: ComissaoStatus;
  createdAt: Date;
  updatedAt: Date;
};

type ParcelaResumo = {
  id: string;
  saleId: string;
  venceEm: string;   // 'AAAA-MM-DD'
  valorCents: number;
  status: ParcelaStatus;
  pagoEm: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// Conversão — botão "gerar venda" na tela de proposta aceita
async function converterPropostaEmVenda(
  propostaId: string,
  input?: { fornecedor?: string; taxaServicoCents?: number },
): Promise<ServiceResult<VendaResumo>>

// CRUD de venda
async function listarVendas(filtro?: { comissaoStatus?: ComissaoStatus; limite?: number }): Promise<ServiceResult<VendaResumo[]>>
async function obterVenda(vendaId: string): Promise<ServiceResult<VendaResumo>>
async function atualizarVenda(vendaId: string, patch: {
  fornecedor?: string; valorBrutoCents?: number; custoCents?: number;
  comissaoPrevistaCents?: number; taxaServicoCents?: number;
}): Promise<ServiceResult<VendaResumo>>
async function atualizarStatusComissao(vendaId: string, status: ComissaoStatus): Promise<ServiceResult<VendaResumo>>
async function excluirVenda(vendaId: string): Promise<ServiceResult<null>>

// Parcelas do cliente
async function listarParcelas(vendaId: string): Promise<ServiceResult<ParcelaResumo[]>>
async function criarParcela(vendaId: string, input: { venceEm: string; valorCents: number }): Promise<ServiceResult<ParcelaResumo>>
async function gerarParcelasDaVenda(vendaId: string, input: { quantidade: number; primeiraVencimento: string }): Promise<ServiceResult<ParcelaResumo[]>>
async function atualizarParcela(parcelaId: string, patch: { venceEm?: string; valorCents?: number; status?: ParcelaStatus }): Promise<ServiceResult<ParcelaResumo>>
async function marcarParcelaPaga(parcelaId: string): Promise<ServiceResult<ParcelaResumo>>
async function excluirParcela(parcelaId: string): Promise<ServiceResult<null>>
```

Pontos que valem atenção na tela:

- **`converterPropostaEmVenda` é idempotente**: chamar duas vezes (duplo clique) devolve a
  MESMA venda, nunca cria duas — o índice único `sales_proposal_id_key` garante isso no
  banco. Não precisa desabilitar o botão no cliente para segurança (embora seja boa
  prática de UX desabilitar durante o request).
- Recusa a conversão (`CONFLITO`) se a proposta ainda não estiver `status: 'accepted'`
  com `acceptedOptionId` preenchido — mostre o botão "gerar venda" só depois do aceite.
- `atualizarVenda`/`atualizarParcela` seguem o mesmo padrão de autosave de
  `atualizarProposta`: só o que veio no patch muda, chame por campo perdendo foco.
- `atualizarStatusComissao` NÃO é uma máquina de estado travada — dá para voltar de
  `recebida` para `prevista` se o agente clicou errado. É conferência manual, não um fluxo
  de aprovação.
- `gerarParcelasDaVenda` divide `valorBrutoCents` em N parcelas mensais iguais (a última
  absorve o resto em centavos) a partir de `primeiraVencimento` — recusa
  (`CONFLITO`) se a venda já tiver parcela; para parcelamento manual/desigual (ex.: entrada
  maior), use `criarParcela` direto, quantas vezes precisar.
- `marcarParcelaPaga` é atalho de `atualizarParcela(id, { status: 'pago' })` — grava
  `pagoEm = agora`. Mudar para qualquer outro status limpa `pagoEm` sozinho.
- `excluirVenda` recusa (`CONFLITO`) se existir parcela `status: 'pago'` — peça para
  cancelar as parcelas em aberto antes, nunca para apagar uma venda com pagamento
  registrado.
- Nenhum campo de `sales`/`receivables` tem rota pública. Se um dia a proposta pública
  precisar mostrar "opções de parcelamento" ao cliente, isso já existe em
  `proposal_options.installments`/`installment_cents` (S5/S6) — não é isto aqui.

---

## S4 — o funil, contrato completo (`src/server/deals.ts`)

`FunnelScreen.tsx` e o topo/seção "Paradas" de `TodayScreen.tsx` hoje rodam 100% sobre
`src/lib/ui/sample-data.ts` (o comentário no próprio arquivo já dizia: "o serviço de
pipeline/deals ainda não existe do lado do servidor"). Agora existe — `src/server/deals.ts`,
exportado em `@/server`, mesmo padrão de sempre (`requireAuthContext` + `withTenant`,
`ServiceResult<T>`, `tenantId` nunca como argumento).

### O mapeamento de vocabulário que você precisa saber ANTES de ligar a tela

`deals.stage` no banco tem **6** valores; o board (`STAGES` em `sample-data.ts`) tem **5**
colunas. Não é bug, é porque `perdido` **não tem coluna** — é saída do funil, não lugar onde
o negócio fica. Mapeamento (também exportado como `COLUNAS_DO_FUNIL`, para você não manter
uma segunda lista que desalinha):

| `deals.stage` (banco) | coluna do board |
|---|---|
| `novo` | "Novo contato" |
| `cotando` | "Montando" |
| `proposta_enviada` | "Enviada" |
| `negociando` | "Negociando" |
| `ganho` | "Fechada" |
| `perdido` | **(sem coluna)** — `listarNegociosDoFunil()` já exclui do resultado |

```ts
import { COLUNAS_DO_FUNIL } from '@/server';
// [{ estagio: 'novo', label: 'Novo contato' }, ..., { estagio: 'ganho', label: 'Fechada' }]
```

Troque `STAGES`/`Stage` de `sample-data.ts` por isto (ou por algo derivado, se quiser manter
`hint` por coluna — eu não tenho essa string, é copy sua).

### As seis actions

```ts
type DealStage = 'novo' | 'cotando' | 'proposta_enviada' | 'negociando' | 'ganho' | 'perdido';
type EstagioDeFunil = Exclude<DealStage, 'perdido'>; // as 5 que têm coluna

type NegocioDoFunil = {
  id: string;
  title: string;
  destination: string | null;
  valueCents: number;
  stage: EstagioDeFunil;
  contactId: string;
  contactName: string;
  departureOn: string | null;   // 'AAAA-MM-DD' — data da viagem (deals.departureOn)
  diasParado: number;           // dias desde a última movimentação (ver definição abaixo)
};

async function listarNegociosDoFunil(): Promise<ServiceResult<NegocioDoFunil[]>>
```
Board pronto: todo negócio do tenant menos `perdido`, com o nome do contato já resolvido.
`diasParado` é o mesmo conceito de `idleDays` no `Proposal` de exemplo — o maior entre
`updatedAt` do negócio e o `occurredAt` da `activity` mais recente dele, em dias corridos,
nunca negativo. Sem limite artificial de paginação visível (teto interno de 500, não deveria
aparecer no produto tão cedo).

```ts
type NegocioMovido = {
  id: string;
  stage: DealStage;         // o valor NOVO, já persistido — pode ser 'perdido'
  lostReason: string | null;
  closedAt: Date | null;
  updatedAt: Date;
};

async function moverEstagioDoNegocio(
  dealId: string,
  novoEstagio: DealStage,   // os 6 valores — inclui 'perdido'
  motivoPerda?: string,
): Promise<ServiceResult<NegocioMovido>>
```
É o que o arrasto do kanban chama. **`motivoPerda` é OBRIGATÓRIO quando `novoEstagio ===
'perdido'`** (mínimo 3 caracteres depois de aparar espaço) — sem ele, `DADOS_INVALIDOS` com
`campo: 'motivoPerda'` e `correcao: 'Escrever o motivo da perda'`. Como `perdido` não tem
coluna no board, você precisa de uma UI própria para essa ação — sugestão: item no menu do
card ("Marcar como perdida...") que abre um campo de texto curto antes de chamar a action,
não um drop target. Decisão de onde/como é sua.

Chamar duas vezes seguidas com o MESMO `novoEstagio` (duplo clique, replay de rede) é seguro
— a segunda chamada não grava nada de novo e devolve o mesmo estado. Pode desabilitar o
botão/soltar durante o request por UX, mas não precisa disso por correção.

```ts
type CriarNegocioInput = {
  contactId: string;         // uuid — precisa ser contato existente do tenant
  title: string;
  destination?: string;
  currency?: string;         // 3 letras, default 'BRL'
  valueCents?: number;       // default 0
  paxAdults?: number;        // default 1
  paxChildren?: number;      // default 0
  departureOn?: string;      // aceita 'AAAA-MM-DD' ou 'DD/MM/AAAA'
  returnOn?: string;
  expectedCloseOn?: string;
};

async function criarNegocio(input: CriarNegocioInput): Promise<ServiceResult<NegocioDoFunil>>
```
Nasce sempre `stage: 'novo'` — devolve no MESMO shape de `listarNegociosDoFunil`, pronto
para inserir direto na coluna "Novo contato" sem recarregar o board inteiro.

```ts
type AtividadeDoNegocio = {
  id: string;
  type: string;   // 'note' | 'stage_changed' | 'proposal_sent' | 'proposal_viewed' | 'proposal_accepted' | 'task_done' | 'message' | 'contact_created'
  body: string | null;
  metadata: Record<string, unknown>;
  actorUserId: string | null;
  occurredAt: Date;
};

type NegocioDetalhe = {
  id: string; title: string; destination: string | null; stage: DealStage;
  currency: string; valueCents: number; costCents: number; commissionCents: number;
  paxAdults: number; paxChildren: number;
  departureOn: string | null; returnOn: string | null; expectedCloseOn: string | null;
  lostReason: string | null; closedAt: Date | null;
  contactId: string; contactName: string;
  createdAt: Date; updatedAt: Date;
  activities: AtividadeDoNegocio[]; // mais recente primeiro
};

async function obterNegocio(dealId: string): Promise<ServiceResult<NegocioDetalhe>>
```
Para a futura tela de detalhe do negócio (ainda não existe rota, pelo que vi). Inclui
`costCents`/`commissionCents` — é autenticado, mesma doutrina de `OpcaoEdicao` em
`proposals.ts` (a agente vê a própria margem). **Não é a mesma coisa que a proposta
pública** — não existe leitura pública de negócio, e não deveria existir.

```ts
type NegocioParado = {
  id: string; title: string; destination: string | null; valueCents: number;
  contactId: string; contactName: string; diasParado: number;
};
type ResumoDeParados = { itens: NegocioParado[]; totalCents: number };

async function listarNegociosParados(): Promise<ServiceResult<ResumoDeParados>>
```
Para a seção "Paradas há mais de 7 dias" do Hoje. `totalCents` já vem somado — não precisa
`sumCents(itens)` na tela. Exclui `ganho` e `perdido` (um negócio fechado não é "parado", é
fechado); `itens` já vem ordenado do mais parado para o menos parado.

```ts
type ResumoDoPipeline = { pipelineAbertoCents: number; fechadoNoMesCents: number };
async function obterResumoDoPipeline(): Promise<ServiceResult<ResumoDoPipeline>>
```
Os "dois números do topo" do Hoje. **Recorte que eu escolhi** (documentado, sua decisão de
copy/rótulo continua livre):
- `pipelineAbertoCents` = soma de `valueCents` de todo negócio que não é `ganho` nem
  `perdido`. **Sem recorte de tempo** — um negócio parado há 60 dias ainda é dinheiro em
  aberto, então ainda soma aqui. Combina com o rótulo atual "Em negociação" da tela.
- `fechadoNoMesCents` = soma de `valueCents` dos negócios `ganho` cujo `closedAt` cai no
  mês corrente (UTC, do dia 1 às 00:00 até o dia 1 do mês seguinte). Combina com "Fechado no
  mês".

### Trocar em `TodayScreen.tsx`

Hoje: `pipelineCents`/`closedCents` vêm de `sumCents(PROPOSALS.filter(...))` e `parked` vem
de `stalled()`, os três de `sample-data.ts`. Troque por:

```ts
const [pipeline, setPipeline] = React.useState<ResumoDoPipeline | null>(null);
const [parados, setParados] = React.useState<ResumoDeParados | null>(null);
// useEffect chamando obterResumoDoPipeline() / listarNegociosParados(), mesmo padrão
// de status loading/ready/error que tasks/opened já usam nesse arquivo.
```
`parados.itens` tem o mesmo formato que a seção "Paradas" já consome (`client`→
`contactName`, `cents`→`valueCents`, `idleDays`→`diasParado`, `opens` não existe mais — a
seção hoje mostra "nunca aberta" a partir de `proposal.opens === 0`; isso é sinal de
proposta, não de negócio, e `deals` não sabe de aberturas de proposta. Se quiser manter esse
sinal, precisaria juntar com `listarAberturasRecentes()` — que já existe — por `contactId`
ou por um `dealId` em `proposal_views`, que hoje não existe like isso; me avise se for
esse o caminho que você quer, decido a melhor forma de expor).

### Trocar em `FunnelScreen.tsx`

Troque `PROPOSALS`/`STAGES`/`Proposal`/`Stage` de `sample-data.ts` por
`listarNegociosDoFunil()`/`COLUNAS_DO_FUNIL`/`NegocioDoFunil`/`EstagioDeFunil`. Campos que
mudam de nome: `client`→`contactName`, `cents`→`valueCents`, `idleDays`→`diasParado`. Campos
que não existem mais em `NegocioDoFunil` (são sinal de PROPOSTA, não de negócio):
`opens`/`lastOpenHours` — o `Signal` do card hoje usa isso para "abriu o link"; sem esse
dado aqui, o card do funil perde esse selo, ou você decide buscar via
`listarAberturasRecentes()` numa segunda chamada e cruzar por `contactId` (não é 1:1 com
`dealId` hoje). `moveTo()` deve chamar `moverEstagioDoNegocio(id, novoEstagio)` — e quando o
alvo for a coluna "Fechada" com `stage: 'ganho'` está tudo igual; **não existe drop target
para "perdido"** (ver seção da action acima) — precisa de uma segunda entrada de UI fora do
arrasto.

---

## S9/S10 — `criarTarefa`, o "Criar lembrete" morto da tela Hoje agora tem back-end

Auditoria ao vivo no produto confirmou: o botão "Criar lembrete" na tela Hoje não tinha
`onClick`, e não existia nenhuma função de servidor para criar tarefa manual em lugar
nenhum do repositório. O schema `tasks` já suportava isso por inteiro (`source: 'manual'`
já era valor do enum, `dedupeKey` já era opcional) — não há migration nesta entrega, só a
Server Action que faltava. Vive no mesmo arquivo do runner de follow-up,
`src/server/followups.ts`, exportada em `@/server`.

```ts
type CriarTarefaInput = {
  title: string;                 // obrigatório, 2–200 caracteres depois de trim
  notes?: string;                // opcional, até 4000 caracteres; '' vira null
  kind?: 'followup' | 'ligar' | 'whatsapp' | 'email' | 'outro'; // default 'outro'
  dueAt: string | Date;          // OBRIGATÓRIO — é lembrete, precisa de quando.
                                  // aceita Date ou qualquer string que `new Date(...)`
                                  // entenda (ISO 'AAAA-MM-DD', datetime completo, etc.)
  dealId?: string;                // uuid, opcional — precisa ser negócio existente do tenant
  contactId?: string;             // uuid, opcional — precisa ser contato existente do tenant
};

async function criarTarefa(input: CriarTarefaInput): Promise<ServiceResult<TarefaResumo>>
```

`TarefaResumo` é o mesmo tipo que `listarTarefas` (`alerts.ts`) já devolve — já exportado
no barril:

```ts
type TarefaResumo = {
  id: string;
  title: string;
  notes: string | null;
  kind: string;
  source: string;      // sempre 'manual' aqui
  contactId: string | null;
  dealId: string | null;
  dueAt: Date;
  doneAt: Date | null;  // sempre null na criação
  createdAt: Date;
};
```

Pontos que valem atenção na tela:

- `title` e `dueAt` são os dois únicos campos realmente obrigatórios. `kind` sem valor
  vira `'outro'` — se o formulário quiser oferecer os cinco valores num select, ótimo; se
  quiser simplificar para um botão único "Criar lembrete" sem escolher tipo, também
  funciona sem mudar nada aqui.
- `dealId`/`contactId` são conferidos contra o banco DENTRO da mesma transação antes do
  INSERT — se você mandar um id de outro tenant (não deveria acontecer pela UI normal,
  mas por segurança o contrato já cobre), a resposta é `NAO_ENCONTRADO` com
  `campo: 'dealId'`/`'contactId'` e `correcao` pronta, igual ao padrão de `criarNegocio`.
  Não é preciso os dois — dá para criar um lembrete solto, sem negócio nem contato.
- Não existe `dedupeKey` aqui de propósito — isso é só para tarefa GERADA (régua de
  follow-up, alerta de passaporte/aniversário), que pode ser recriada pelo cron.
  Lembrete manual não deduplica: a agente pode querer duas tarefas com o mesmo título e a
  mesma data, e a Server Action não decide por ela que isso é engano.
- Depois de criar, chame `listarTarefasDeHoje()` de novo para atualizar a lista (o item
  só aparece nela se `dueAt` cair em hoje ou já tiver vencido — um lembrete para semana
  que vem é criado com sucesso mas não aparece na tela Hoje até o dia chegar, por
  desenho: é a mesma janela que `listarTarefasDeHoje` já usa para tudo). Se quiser inserir
  otimisticamente no state local antes do round-trip, o retorno de `criarTarefa` já tem
  todos os campos que `TarefaDeHoje` tem MENOS `suggestedMessage` (sempre `null` em
  manual — não invente mensagem que a agente não pediu), `contactName`/`dealTitle`/
  `destination` (não vêm no retorno; se precisar deles na hora sem esperar o refetch, use
  o próprio nome/negócio que já está selecionado no formulário) e `vencida` (calcule
  `dueAt < new Date()` no cliente, é a mesma regra que o servidor usa).
- Erros de validação (`title` vazio, `dueAt` numa string que `new Date()` não entende)
  voltam como `DADOS_INVALIDOS` com `campo` apontando o input errado — mesmo padrão de
  `criarContato`/`criarNegocio`.

Verificação: `npx tsc --noEmit` limpo e `npx tsx scripts/check/known-failures.ts` verde
(378 testes, allowlist vazio, sem regressão) com o Postgres de dev de pé.

---

## S10 — Dashboard do mês, contrato completo (`src/server/dashboard.ts`)

Duas Server Actions novas, exportadas no barril. **Nenhuma tabela nova, nenhuma
migration** — tudo lido de `sales`/`proposals`, que já existiam. Mesmo padrão de sempre:
`tenantId` vem da sessão, `ServiceResult<T>`, nunca lança.

```ts
async function obterResumoDoMes(): Promise<ServiceResult<ResumoDoMes>>
async function exportarResumoDoMesCsv(): Promise<ServiceResult<{ nomeArquivo: string; conteudo: string }>>
```

```ts
type ResumoDoMes = {
  mes: string;                    // 'AAAA-MM' do mês corrente (UTC)
  vendas: {
    totalVendas: number;          // quantidade de sales.createdAt no mês
    faturamentoBrutoCents: number;
    taxaServicoCents: number;
  };
  comissao: {
    previstaCents: number;
    recebidaCents: number;
    atrasadaCents: number;
    aReceberCents: number;        // previstaCents + atrasadaCents — já pronto para o rótulo "a receber"
    totalCents: number;
  };
  conversao: {
    enviadas: number;             // propostas com sentAt no mês (a coorte inteira)
    aceitas: number;              // da MESMA coorte, quantas estão accepted agora
    taxa: number;                 // aceitas/enviadas, 0 quando enviadas === 0
  };
  paradas: {
    itens: PropostaParada[];      // SEMPRE com os ids — ver abaixo
    totalCents: number;
  };
};

type PropostaParada = {
  id: string;
  title: string;
  status: 'sent' | 'viewed';
  dealId: string;
  contactId: string;
  contactName: string;
  destination: string | null;
  valueCents: number;             // do NEGÓCIO associado (proposta não tem valor próprio)
  diasParado: number;
};
```

### O card "propostas paradas" → `/propostas?ids=...`

Este é o card que o pedido desta rodada destacou por nome: nunca devolvo só a
CONTAGEM de propostas paradas, sempre os `id`s de cada uma (`paradas.itens[].id`).
Para linkar direto, adicionei um filtro novo em `listarPropostas` que você já usa:

```ts
listarPropostas({ ids: paradas.itens.map((p) => p.id) })
```

Sugestão de rota: `/propostas?ids=<id1>,<id2>,...` — a página lê `searchParams.ids`,
faz `.split(',')` e chama `listarPropostas({ ids })`. Não fiz a leitura de
`searchParams` porque `src/app/**` é sua fronteira; o que eu garanti do meu lado é que
`listarPropostas` aceita a lista e devolve só essas propostas (ignora arquivadas por
padrão, igual à listagem normal — se algum id estiver arquivado e você quiser mostrar
mesmo assim, passe `incluirArquivadas: true` junto). Se preferir outro padrão de
navegação (ex.: abrir uma Sheet com a lista em vez de navegar para `/propostas`), o dado
já está pronto para os dois: cada item de `paradas.itens` já tem `title`/`contactName`/
`destination`/`valueCents`/`diasParado` — o suficiente para renderizar uma linha sem
round-trip extra.

### Para onde cada card deve linkar (o pedido explícito desta rodada)

| Card | Número mostra | Ação ao clicar |
|---|---|---|
| Vendas e faturamento do mês | `vendas.totalVendas`, `vendas.faturamentoBrutoCents` | `/vendas` — lista completa, já existe |
| Comissão a receber vs. recebida | `comissao.aReceberCents`, `comissao.recebidaCents` | `/financeiro` — já agrupa por `comissaoStatus` (`FinanceiroScreen.tsx`) |
| Conversão de proposta | `conversao.taxa`, `conversao.enviadas`/`conversao.aceitas` | `/propostas` — lista completa; se quiser destacar só a coorte do mês, é o mesmo `ids` mostrado acima, mas eu não coletei os ids de TODA a coorte enviada (só das paradas) — me avise se quiser isso também, é a mesma query com `select id` a mais |
| Propostas paradas | `paradas.itens.length`, `paradas.totalCents` | `/propostas?ids=...` — ver seção acima, com os ids prontos |
| Exportar CSV | — | botão que baixa o arquivo, ver seção seguinte |

### Exportar CSV — sem rota nova

`exportarResumoDoMesCsv()` devolve `{ nomeArquivo, conteudo }` prontos — `conteudo` já
vem com BOM UTF-8 e `;` como delimitador (Excel/Sheets em pt-BR abrem direto, mesma
preocupação documentada em `src/server/csv.ts`, que é o espelho para LER planilha). Não
criei rota em `src/app/api/**` (fronteira do PO) porque não precisa: é só

```ts
const r = await exportarResumoDoMesCsv();
if (!r.ok) { /* toast com r.mensagem/r.correcao */ return; }
const blob = new Blob([r.data.conteudo], { type: 'text/csv;charset=utf-8' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = r.data.nomeArquivo;
a.click();
URL.revokeObjectURL(url);
```

Sem `<a href>` para uma rota, sem download de servidor — o texto já está no cliente
depois do `await`.

### Três decisões de recorte que valem ler antes de desenhar os cards

Documentadas com mais detalhe em comentário no topo de `src/server/dashboard.ts`, resumo
aqui:

1. **"Vendas do mês"** = `sales.createdAt` no mês corrente (não `deals.closedAt` — `sales`
   não tem coluna própria de "quando fechou"; a existência da linha já significa "virou
   venda", `createdAt` é o proxy mais direto).
2. **"Comissão a receber vs. recebida" é do MESMO mês que (1)**, não o saldo total em
   aberto de todos os tempos. Se você (ou o PO) quiser também "tudo que falta receber,
   não importa quando vendeu" — é uma métrica diferente, sem recorte de `createdAt`, me
   peça que eu escrevo uma segunda função.
3. **"Propostas paradas" NÃO tem recorte de mês** — uma proposta enviada há 40 dias e
   ainda sem resposta continua parada mesmo que tenha sido enviada no mês passado (mesmo
   raciocínio do "pipeline aberto" em `deals.ts`, que também ignora quando o negócio
   nasceu). Limiar: mais de 7 dias sem `sentAt`/`lastViewedAt` mais recente — o MESMO
   número que `listarNegociosParados` já usa, de propósito (um conceito de "parado" só,
   não dois números diferentes para a agente decorar).

Testado contra Postgres de verdade (não só `tsc`) com dois tenants — confirmei
isolamento, `.groupBy` + `count(*)::int` batendo, e que uma proposta "parada" de um mês
anterior aparece em `paradas.itens` mesmo fora do recorte de `conversao`. Detalhe
completo em `docs/status/rafa.md`.

## Propostas de um negócio — `listarPropostas({ dealId })` (destrava o provisório da ficha)

Você pediu em `docs/handoffs/nina-para-rafa.md` item 4.1: a ficha do negócio
(`/funil/[id]`) fazia `listarPropostas({ incluirArquivadas: true, limite: 200 })` e
filtrava `p.dealId === dealId` no cliente — no volume declarado funciona, mas é varrer o
tenant inteiro pra abrir a ficha de UM negócio.

Pronto: `FiltroPropostas` ganhou `dealId?: string`. A chamada que troca o provisório é

```ts
import { listarPropostas } from '@/server';

const r = await listarPropostas({ dealId, incluirArquivadas: true });
if (!r.ok) { /* r.mensagem / r.correcao */ return; }
const propostas: PropostaResumo[] = r.data;
```

- O retorno continua sendo `PropostaResumo[]` (mesmo shape de sempre — só adicionei o
  filtro no `WHERE`, não mudei coluna nenhuma). `proposals.deal_id` é FK com índice
  não-único, então pode haver mais de uma proposta por negócio — por isso é lista, não
  single.
- `incluirArquivadas` continua valendo: se a proposta vinculada estiver arquivada, some
  da lista a menos que você também peça `incluirArquivadas: true` (mesma regra de sempre).
- O corte de tenant vem do RLS (`withTenant` + `requireAuthContext`), como toda action de
  `proposals.ts`. Um `dealId` de outro tenant simplesmente devolve zero propostas — nem
  aparece que existia.
- `dealId` combina com os outros filtros: `listarPropostas({ dealId, busca, ids,
  incluirArquivadas })` faz `AND` de todos, como você esperaria.

É só trocar a chamada no `NegocioScreen.tsx` quando for conveniente — o provisório
(`listarPropostas({ limite: 200 })` + filtro no cliente) continua funcionando, só não
escala. Sem pressa, não bloqueia nada.

---

## S11 — UI de cobrança (assinatura Asaas)

O backend do S11 está pronto e commitado (`src/server/billing.ts` + `src/lib/asaas/`).
**Sem credencial Asaas ainda** — em dev (`ASAAS_API_KEY` ausente) `trocarPlano`/
`cancelarAssinatura` operam só no DB, então o fluxo inteiro é testável sem chamar a
API. Quando a chave entra, o mesmo código passa a criar/cancelar no Asaas de verdade.

### Actions (todas em `@/server`, `ServiceResult<T>`, `requireAuthContext` + `withTenant`)

```ts
import {
  obterAssinaturaAtual, listarPlanos, trocarPlano, cancelarAssinatura, listarFaturas,
  type AssinaturaAtual, type PlanoResumo, type FaturaResumo,
  type StatusAssinatura, type StatusFatura, type TrocarPlanoInput,
} from "@/server";
```

- **`obterAssinaturaAtual()`** → `ServiceResult<AssinaturaAtual | null>`. `null` = sem
  assinatura (não é erro — agente pode estar em trial sem registro).
- **`listarPlanos()`** → `ServiceResult<PlanoResumo[]>`. Os 3 planos ativos, por preço
  crescente: Solo 4900, Pro 9900, Studio 19900 (centavos, BRL).
- **`trocarPlano({ planId, billingType? })`** → `ServiceResult<AssinaturaAtual>`.
  Idempotente (já no plano pedido → devolve sem recriar). `billingType`:
  `'CREDIT_CARD' | 'PIX' | 'BOLETO'`, opcional. Em dev sem chave, grava só no DB.
- **`cancelarAssinatura()`** → `ServiceResult<AssinaturaAtual | null>`.
- **`listarFaturas()`** → `ServiceResult<FaturaResumo[]>`. Mais recente primeiro.

### Tipos

```ts
type PlanoResumo = { id, slug: 'solo'|'pro'|'studio', name, priceCents, currency, description, features: string[]|null, isActive };
type StatusAssinatura = 'trialing' | 'active' | 'past_due' | 'canceled';
type AssinaturaAtual = { id, tenantId, plano: PlanoResumo|null, status, asaasCustomerId, asaasSubscriptionId, currentPeriodStart, currentPeriodEnd, canceledAt, createdAt, updatedAt };
type StatusFatura = 'pending' | 'paid' | 'overdue' | 'refunded';
type FaturaResumo = { id, subscriptionId, asaasPaymentId, amountCents, status, method: 'pix'|'credit_card'|'boleto'|null, dueDate, paidAt, createdAt };
type TrocarPlanoInput = { planId: string; billingType?: 'CREDIT_CARD'|'PIX'|'BOLETO' };
```

### O fluxo de negócio ponta a ponta (o critério de "pronto")

A agente precisa ver e gerenciar sua assinatura. Sugestão de rota: `/cobranca` (ou
`/assinatura` — você decide o nome; não está na nav ainda, é tela nova). Fluxo:

1. Abrir a tela → `obterAssinaturaAtual()` mostra o plano atual + status. Se `null`,
   mostrar os 3 planos (`listarPlanos`) com a opção de assinar.
2. Escolher um plano (ou trocar) → `trocarPlano({ planId, billingType })`. Em dev sem
   chave, a assinatura é criada no DB e a tela reflete o novo plano. Com chave, o
   fluxo de pagamento real (cartão/Pix/boleto) entra no lugar — mas a UI consome o
   MESMO `trocarPlano`, o backend decide.
3. Cancelar → `cancelarAssinatura()` (destrutivo = toast com desfazer de 8s, não modal
   "tem certeza?" — regra do CLAUDE.md). Mas note: `cancelarAssinatura` não tem par de
   reabertura no servidor; o desfazer só reverte o estado local da tela e recria via
   `trocarPlano` se você quiser — confira se vale o padrão `useDeferredDelete` ou se o
   cancelamento é imediato. Decisão sua.
4. Faturas → `listarFaturas()` numa seção, mais recente primeiro, valor em
   `tabular-nums` + `Money`, status em `Badge`.

### Regras de design (Papel e Pedra — miolo silencioso)

- Registro silencioso: uma cor só, zero ilustração. `#12557F` (accent) = uma coisa só
  por tela (dizer onde clicar).
- Todo valor: `Money` + `tabular-nums` + largura reservada (número que não pula).
- `Rule` de `@/components/plates` como cornija entre seções, nunca card com 4 bordas.
- Skeleton (não spinner), erro diz o que aconteceu + botão de correção (`FieldError`).
- Reagir no `pointerdown`. `prefers-reduced-motion` desde o primeiro componente. 390px.
- Status da assinatura em `Badge` — `tone` por estado: `active`/`trialing` = ok,
  `past_due` = warn/danger, `canceled` = neutral.

### O que NÃO existe (não invente)

- **Sem enforcement/paywall**: S11 é só o motor. NÃO bloqueie nenhuma tela por status.
  Trial de quantos dias? Dunning (o que faz `past_due`)? São decisões de produto em
  aberto — o PO vai perguntar ao Leandro. Você só mostra e deixa o agente trocar/cancelar.
- **Sem rota de webhook na UI** — isso é fronteira do PO (`src/app/api/asaas/webhook`).
- O método de pagamento (cartão/Pix/boleto) em produção pede integração de checkout
  Asaas — fora do v1 atual; o `billingType` no `trocarPlano` é o gancho, mas a tela de
  pagamento real é pós-v1. Em dev, o seletor de `billingType` pode existir mas só grava
  a intenção (o backend não chama Asaas sem chave).

### Verificação (o que VOCÊ roda)

1. `npx tsc --noEmit` — limpo.
2. `npm run build` — limpo.
3. `npx vitest run tests/design/guards.test.ts` — Postgres `zarpa-db` de pé
   (`npm run db:up`).
4. **NÃO teste clicando** — o PO (Leandro) clica. Reporte o passo a passo em
   `docs/status/nina.md`.

---

## S12 — UI de integrações (Wooba + Infotravel, cotação só)

O agente cadastra a SUA conta de Wooba/Infotravel e, dentro do construtor de
proposta, **busca** hotéis/pacotes reais em vez de digitar o custo/preço à mão.
Cotação só — sem reserva real (booking é o "motor de reservas", fora do v1).

### Actions (assinaturas exatas, importáveis de `@/server`)

```ts
import {
  listarIntegracoes,
  criarIntegracao,
  removerIntegracao,
  buscarHoteis,
  obterCotacao,
  type Provider,
  type IntegracaoResumo,
  type HotelBusca,
  type Cotacao,
  type BuscarHoteisInput,
  type CotacaoInput,
  type ResultadoBuscaHoteis,
  type ResultadoCotacao,
  type CriarIntegracaoInput,
} from '@/server';
```

- `listarIntegracoes(): Promise<ServiceResult<IntegracaoResumo[]>>` — lista as
  contas do tenant (ativas + inativas), **sem ciphertext**.
- `criarIntegracao({ provider, label, credentials }): Promise<ServiceResult<IntegracaoResumo>>`
  — `provider: 'wooba' | 'infotravel'`, `label: string` (2–100),
  `credentials: Record<string, string>` (ex.: `{ apiKey: '...' }`). Encripta e
  grava. Devolve resumo sem credencial.
- `removerIntegracao(id: string): Promise<ServiceResult<null>>` — delete físico.
- `buscarHoteis({ integracaoId?, destino, checkIn, checkOut, paxAdults, paxChildren? }): Promise<ServiceResult<ResultadoBuscaHoteis>>`
- `obterCotacao({ integracaoId?, hotelId, checkIn, checkOut, paxAdults, paxChildren? }): Promise<ServiceResult<ResultadoCotacao>>`

### Shapes

```ts
type IntegracaoResumo = {
  id: string;
  provider: 'wooba' | 'infotravel';
  label: string;
  isActive: boolean;
  createdAt: Date;
};

type HotelBusca = {
  id: string;
  nome: string;
  destino: string;
  categoriaEstrelas?: number;
  thumbnailUrl?: string;
  precoCents: number;   // em centavos
  moeda: string;        // 'BRL'
  disponivel: boolean;
};

type Cotacao = {
  hotelId: string;
  nome: string;
  custoCents: number;   // em centavos — é o COST, não o price
  moeda: string;
  checkIn: string;
  checkOut: string;
  detalhes?: string;
};

// Wrapper do resultado — `exemplo: true` quando veio do modo dev:
type ResultadoBuscaHoteis = { hoteis: HotelBusca[]; exemplo: boolean };
type ResultadoCotacao = { cotacao: Cotacao; exemplo: boolean };
```

### Tela `/integracoes` (cadastrar contas)

- Listar as integrações do tenant com `listarIntegracoes()`.
- Formulário de cadastro: select de `provider` ('wooba' | 'infotravel'), campo
  `label` (2–100), campos de `credentials` (depende do provider — para Wooba:
  `apiKey`; para Infotravel: `apiKey` + `clientId`). Os campos de credencial
  são **password-type** e **nunca são devolvidos** na listagem
  (`IntegracaoResumo` não tem `credentials`).
- Remover com `removerIntegracao(id)` — delete físico, com toast de desfazer
  de 8s (padrão destrutivo do design system).
- Toggle `isActive` — **NÃO existe action de toggle** ainda. Se precisar, peça
  em handoff. Por ora, remover é o caminho.

### Fluxo "Buscar hotel" no construtor de proposta

Hoje a agente digita `costCents`/`priceCents`/`fornecedor` à mão em cada opção
(`OpcaoInput` em `src/server/proposals.ts`). O S12 adiciona um caminho de
**busca** que preenche esses campos:

1. Na opção do construtor, um botão "Buscar cotação" (ou similar — você decide
   a UI) abre um seletor de integração ativa + campos de destino/datas/pax.
2. Chama `buscarHoteis({ integracaoId, destino, checkIn, checkOut, paxAdults, paxChildren })`.
3. A lista de `HotelBusca[]` aparece; o agente escolhe um hotel.
4. Chama `obterCotacao({ integracaoId, hotelId, checkIn, checkOut, paxAdults, paxChildren })`.
5. A `Cotacao` devolvida tem `custoCents` (o custo) — preenche `costCents` da
   opção. O `priceCents` (preço de venda) continua sendo o agente quem define
   (margem dele). O `fornecedor` texto da opção pode ser preenchido com o
   `nome` do hotel ou o `provider` ('wooba'/'infotravel').

**Importante**: `Cotacao.custoCents` é o CUSTO, não o preço. `HotelBusca.precoCents`
é um preço de referência da busca, mas a cotação detalhada (`Cotacao`) é a
fonte de verdade para o custo. O `priceCents` que o agente cobra do cliente é
decisão dele — o backend não calcula margem.

### Modo dev (dados de exemplo)

Sem integração ativa cadastrada, `buscarHoteis`/`obterCotacao` devolvem dados
de **exemplo** com `exemplo: true` no wrapper (`ResultadoBuscaHoteis.exemplo` /
`ResultadoCotacao.exemplo`). A UI deve sinalizar "cotação de exemplo" quando
`exemplo === true` — um aviso discreto, não bloqueador. Com integração ativa,
chama a API real; se falhar (timeout/401), `ServiceError` com `correcao` e
`mensagem` pronta para mostrar (o `comoResultado` envelopa).

**Não misture**: se `exemplo: true`, os dados NÃO são reais — mostre isso. Se
`exemplo: false`, são da API do fornecedor.

### O que NÃO existe (não invente)

- **Sem reserva real** — cotação só. Nenhum botão de "reservar", "cancelar
  reserva", "pagar". O S12 é pull de preço/availability.
- **Sem toggle de `isActive`** — por ora, remover é o caminho. Se o agente
  precisar desativar sem remover, peça em handoff.
- **A credencial nunca volta** — `listarIntegracoes` não devolve `credentials`.
  Não tente ler `credentialsCiphertext` (não está no `IntegracaoResumo`).
- **`Cotacao.custoCents` é custo, não preço** — não preencha `priceCents` com
  ele. O preço é o agente quem define.

---

## Aceite manual + split do botão público — a peça que faltava no fluxo

### O buraco que esta entrega tapa

Hoje a proposta só chega em `status='accepted'` por UM caminho: o cliente clica
"Aceitar esta opção" no link público (`aceitarOpcaoPublica`). Mas o cliente também
aceita por telefone, WhatsApp fora do app, e-mail — e sem a action nova a agente
não tinha como registrar esse aceite. Sem `accepted`, o botão "Gerar venda" no
editor nunca aparece, e a venda nunca nasce. A cadeia aceite→venda só funcionava
se o cliente clicasse no link.

### `marcarPropostaComoAceita` — o botão "Marcar como aceita" no editor

Nova action autenticada, em `src/server/proposals.ts`, exportada em `@/server`:

```ts
import { marcarPropostaComoAceita, type PropostaMeta } from '@/server';

const r = await marcarPropostaComoAceita(propostaId, optionId);
if (!r.ok) {
  // r.mensagem  -> texto pronto em português
  // r.correcao  -> o que o botão junto do erro oferece
  // r.campo     -> 'propostaId' | 'optionId' quando aplicável
  return;
}
const propostaAceita: PropostaMeta = r.data;
```

Assinatura exata:

```ts
async function marcarPropostaComoAceita(
  propostaId: string,   // uuid
  optionId: string,     // uuid — qual opção foi aceita
): Promise<ServiceResult<PropostaMeta>>
```

O que ela faz:

1. `requireAuthContext()` + `withTenant(tenantId, ...)` — RLS corta o tenant, como
   toda action de `proposals.ts`. `tenantId` nunca vem de argumento.
2. Valida `propostaId` e `optionId` como uuid (zod).
3. Confere que a proposta existe (RLS já corta cross-tenant).
4. **Condições de status**:
   - `sent` ou `viewed` → grava `accepted`.
   - Já `accepted` → **idempotente**: devolve o estado atual sem reclamar (não
     briga com a agente sobre qual opção ela já tinha escolhido antes).
   - `draft`/`expired`/`declined` → `CONFLITO` com mensagem "Só dá para aceitar
     uma proposta enviada ou visualizada." e `correcao: 'Enviar a proposta antes
     de marcar como aceita'`.
5. Confere que `optionId` pertence àquela proposta (`exigirOpcaoDaProposta`).
6. Grava `status='accepted'`, `acceptedOptionId=optionId`, `acceptedAt=now()`.
7. Registra `audit_log` (`action: 'proposal.accepted'`) e `activities`
   (`type: 'proposal_accepted'`) com `actorUserId: userId` e
   `metadata: { origem: 'agente', optionId }` — o `origem: 'agente'` é o que
   distingue do aceite público (que vem sem sessão, `actorUserId: null`).
8. Devolve `PropostaMeta` — mesmo shape de `enviarProposta`/`atualizarProposta`,
   com `status`, `acceptedOptionId`, `acceptedAt` reconciliados.

`PropostaMeta` (já existe, não mudei):

```ts
type PropostaMeta = {
  id: string;
  dealId: string;
  publicToken: string;
  title: string;
  summary: string | null;
  status: string;            // agora: 'accepted'
  currency: string;
  coverImageUrl: string | null;
  terms: string | null;
  validUntil: string | null;
  archivedAt: Date | null;
  viewCount: number;
  sentAt: Date | null;
  firstViewedAt: Date | null;
  lastViewedAt: Date | null;
  acceptedAt: Date | null;   // agora: preenchido
  declinedAt: Date | null;
  acceptedOptionId: string | null; // agora: = optionId
  createdAt: Date;
  updatedAt: Date;
};
```

Use o retorno para atualizar a tela otimistamente — o `status` virou
`'accepted'`, `acceptedOptionId` e `acceptedAt` estão preenchidos. O botão
"Gerar venda" (`converterPropostaEmVenda`) agora aparece (ele exige
`status === 'accepted'` + `acceptedOptionId` preenchido — os dois já estão).

### Confirmação: `aceitarOpcaoPublica` NÃO depende de WhatsApp

O PO achou que o botão de aceite no `/p/[slug]` só aparece se o tenant tem
`whatsappLink`. Se for assim, é bug de UI (seu) — a camada de servidor está
limpa:

- `aceitarOpcaoPublica` (`src/server/publicProposals.ts`) só valida `slug` +
  `optionId` e chama a função `public.aceitar_opcao_proposta(slug, optionId)`.
  Não lê `whatsapp`/`whatsappLink` em momento nenhum.
- A função SQL `public.aceitar_opcao_proposta` (`drizzle/0005_aceitar_opcao.sql`)
  confere `public_token`, `status`, `sent_at`, `archived_at` e que a opção
  pertence à proposta. Não toca em `whatsapp` — nem no `tenants`, nem no
  `brand_snapshot`.

Ou seja: o aceite no banco é independente de WhatsApp. O `whatsappLink` é
confirmação secundária de UI (o cliente confirma no WhatsApp depois), não
pré-requisito para o botão de aceite. **Split o botão público sem medo** — se
quiser mostrar "Aceitar esta opção" sempre, e "Confirmar no WhatsApp" como ação
secundária só quando `brand.whatsappLink` existir, o servidor já suporta os dois
casos. O aceite grava sem WhatsApp; o WhatsApp é só um `wa.me` link extra.

### O que NÃO é desta entrega

- **UI do botão "Marcar como aceita" no editor** — é seu. A action está pronta e
  exportada; o botão que a chama é fronteira sua.
- **Split do botão público** — é seu. Confirmei que o servidor não tem
  dependência de WhatsApp; como separar visualmente "Aceitar" de "Confirmar no
  WhatsApp" é decisão sua.
- **Testes** — fronteira do Téo.
- **Não criei "Nova venda" manual** — continua proibido (você travou em S9;
  vendas só nascem de proposta `accepted` via `converterPropostaEmVenda`).

## S13a — Cadastro público + trial 14 dias + banner de conta bloqueada (dunning)

### 1. `/cadastrar` — a action `criarConta` está pronta

Import do barril de sempre:

```ts
import { criarConta, type CriarContaInput, type ContaCriada } from '@/server';
```

Input (zod do lado do servidor — erros voltam como `DADOS_INVALIDOS` com `campo` preenchido):

```ts
{
  nomeAgente: string;   // 2–120
  email: string;        // e-mail válido, max 200
  senha: string;        // min 8 (piso do Better Auth)
  nomeAgencia: string;  // 2–120
}
```

Retorno OK (`ContaCriada`) — a UI **não precisa** de nada disso além de saber que deu
certo, mas está lá para log/telemetria:

```ts
{ tenantId: string; userId: string | null; slug: string; nomeAgencia: string; email: string }
```

Erros possíveis:

- `DADOS_INVALIDOS` com `campo` (`nomeAgente`/`email`/`senha`/`nomeAgencia`) — mostre
  junto do campo.
- `CONFLITO` com `campo: 'email'` — "Já existe uma conta com esse e-mail." Correção
  sugerida: mandar para `/entrar`.
- `CONFLITO` com `campo: 'nomeAgencia'` — só quando não deu para derivar um endereço
  livre do nome (raríssimo; colisão normal é resolvida sozinha, ver abaixo).

O que a tela NÃO pede: slug. O endereço da conta (`tenants.slug`) é derivado do nome da
agência no servidor e, se já existir ("Agência Maré Norte" tomada → `agencia-mare-norte-2`,
`-3`, ... até `-10`), o sufixo é automático. Uma decisão a menos na tela de cadastro.

**Não faz login automático dentro da action — a UI chama o login logo depois:**

```ts
const result = await criarConta({ nomeAgente, email, senha, nomeAgencia });
if (!result.ok) { /* mostrar result.mensagem / result.campo */ return; }
await authClient.signIn.email({ email, password: senha, callbackURL: '/hoje' });
```

Decisão minha (rafa), justificada: transformar a resposta do Better Auth em cookie de
sessão dentro de uma Server Action exigiria parse manual de `Set-Cookie`
(Secure/HttpOnly/SameSite/prefixo `__Secure-`) — é o tipo de código onde um erro vira
falha de sessão. O caminho de login normal já existe, já está testado em `/entrar`, e
custa uma requisição a mais num fluxo que acontece uma vez na vida da conta. A senha já
está no formulário; nada de redigir de novo.

### 2. Gate de dunning — o que a UI faz com `ASSINATURA_INATIVA`

Toda Server Action de ESCRITA agora passa pelo gate (`exigirContaAtiva` em
`src/server/subscriptionGate.ts`): propostas, opções, blocos, negócios, contatos,
viajantes, vendas, parcelas, tarefas (criar e concluir), integrações, marca, biblioteca,
importação e o upload de imagem de proposta. Quando a conta está bloqueada, a action
responde:

```ts
{ ok: false, code: 'ASSINATURA_INATIVA', mensagem: string, correcao: 'Ir para Cobrança' }
```

Mensagens que a UI vai receber (prontas, não traduza nem reescreva):

- `'Sua assinatura está em atraso — o app está em modo somente leitura.'` (`past_due`)
- `'Seu teste gratuito acabou.'` (trial vencido ou `expired`)
- `'Sua assinatura está cancelada — o app está em modo somente leitura.'` (`canceled`)

**Padrão de banner**: `code === 'ASSINATURA_INATIVA'` → banner de bloqueio com
`mensagem` + botão com o rótulo de `correcao` linkando para `/cobranca` (a rota já
existe). Recomendação: um único helper/toast-handler central que reconheça esse código
(autosave espalhado por toda parte vai devolver isso de todos os lugares — tratar caso a
caso na tela vai deixar um escapar).

**Leituras NUNCA são bloqueadas.** `listar*`/`obter*`/dashboard/aberturas não passam pelo
gate e continuam devolvendo dados normalmente quando a conta está bloqueada. Não existe
estado "sem dados" em dunning — a agente vê tudo, só não consegue escrever.

**Como distinguir leitura liberada vs. bloqueada para o banner permanente**: use
`obterAssinaturaAtual()` (S11) no layout shell. Regra para renderizar o banner:

- `status === 'active'` → nada.
- `status === 'trialing'` com `trialEndsAt` no futuro → nada (ou badge de dias restantes).
- `status === 'trialing'` com `trialEndsAt` no passado → banner "Seu teste gratuito
  acabou." (na primeira escrita o servidor promove a linha para `expired` — o gate faz
  isso sozinho; a UI não precisa promover nada).
- `status === 'past_due'` / `'canceled'` / `'expired'` → banner com a mensagem
  correspondente.

### 3. O que NÃO é desta entrega

- A tela `/cadastrar` em si e o banner de bloqueio — seus.
- Nada muda no `/cobranca` do lado do servidor: `trocarPlano`/`cancelarAssinatura`/
  `listarFaturas` NÃO recebem o gate de propósito (é justamente a saída de quem está
  bloqueado).

---

## S13b — o checkbox de aceite: o contrato de `criarConta` mudou (campo NOVO e OBRIGATÓRIO)

O cadastro vai abrir para agente real, então agora existe consentimento de verdade:
páginas `/termos` e `/privacidade` (públicas, estáticas, sem sessão) e o registro do
aceite no servidor. Sua parte é o checkbox na `CadastroScreen`.

### 1. `aceitouTermos` entrou no input — obrigatório, sem default

```ts
type CriarContaInput = {
  nomeAgente: string;
  email: string;
  senha: string;
  nomeAgencia: string;
  aceitouTermos: boolean; // NOVO, OBRIGATÓRIO — o valor do checkbox, nada mais
};
```

- O backend **não assume true**. Campo ausente e campo `false` são a mesma recusa —
  ninguém cria conta sem aceite. É isso que o `tsc` está acusando no
  `CadastroScreen.tsx` (a chamada atual não manda o campo): **não é erro seu, é o
  contrato novo pedindo o checkbox**. Adicione `aceitouTermos: <valor do checkbox>` na
  chamada e inclua `'aceitouTermos'` na lista de `campoValido` para o erro destacar o
  checkbox em vez de cair no erro geral.
- O erro que a UI recebe nos dois casos (ausente ou `false`), pronto para mostrar:

```ts
{
  ok: false,
  code: 'DADOS_INVALIDOS',
  mensagem: 'Para criar a conta, é preciso ler e aceitar os Termos de uso e a Política de privacidade.',
  correcao: 'Aceitar os termos para continuar',
  campo: 'aceitouTermos',
}
```

  `correcao` é o rótulo do botão/ação junto do erro (regra do CLAUDE.md). Checkbox
  desabilitando o botão até marcar é decisão sua — mas mantenha o tratamento do erro
  do mesmo jeito, porque o servidor recusa de qualquer forma.

### 2. Texto exato sugerido para o checkbox (links inline)

> Li e aceito os **[Termos de uso](/termos)** e a **[Política de privacidade](/privacidade)**.

- Um único checkbox com esse texto; os dois links inline com `<Link target="_blank">`
  (nova aba — o cadastro não perde o estado do formulário). Link na expressão inteira
  ("Termos de uso", "Política de privacidade"), nunca em "clique aqui". Accent só nos
  links — é o "dizer onde clicar" do design system.
- O aceite é gravado no servidor com data + versão (`tenants.terms_accepted_at` +
  `terms_version` + linha de `audit_log` `consent.recorded`). Nada disso volta para a
  tela e nada precisa ser exibido — para a UI, é um checkbox e pronto.

### 3. Rotas novas: `/termos` e `/privacidade`

- Server Components estáticos, públicas, sem sessão, fora do grupo `(app)` — mesmo
  padrão do `/cadastrar` e do `/entrar`. Registro intermediário: papel, fio (`<Rule />`
  de `@/components/plates` como cornija), zero prancha, zero serifa.
- O rodapé de cada uma já aponta para a outra e para `/cadastrar`. Quando o rodapé do
  app/site ganhar links legais, os destinos são `/termos` e `/privacidade`.
- A versão do texto vive em `TERMS_VERSION` e o canal de contato em
  `CANAL_DE_PRIVACIDADE`, ambos em `src/lib/legal/termsVersion.ts` — se precisar deles
  em outra superfície, importe de lá; nunca hardcode (a versão gravada no consentimento
  sai dessa constante).

### 4. O que NÃO muda

- O resto do contrato segue igual: `ContaCriada`, login logo depois via
  `authClient.signIn.email({ email, password: senha, callbackURL: '/hoje' })`, slug
  derivado do nome da agência com sufixo automático.
- Gate de dunning e `ASSINATURA_INATIVA`: nada a ver com consentimento — uma coisa não
  toca na outra.
