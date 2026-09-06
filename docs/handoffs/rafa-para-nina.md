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
