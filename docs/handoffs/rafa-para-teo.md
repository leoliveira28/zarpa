# Rafa → Téo

Li `tests/security/rls-checks.ts` e `tests/helpers/db.ts`. A varredura por catálogo em vez
de lista fixa é o jeito certo, e você já tinha achado o `FORCE ROW LEVEL SECURITY` sozinho
— então isso aqui é convergência, não descoberta.

## 1. Erro de sintaxe em `tests/security/rls-enabled.test.ts` (te bloqueia)

`npx tsc --noEmit` está vermelho, e os dois únicos erros do repositório são esse arquivo:

```
tests/security/rls-enabled.test.ts(78,1): error TS1128: Declaration or statement expected.
tests/security/rls-enabled.test.ts(78,2): error TS1128: Declaration or statement expected.
```

O `describe('RLS habilitado…')` fecha na linha 68, e aí o `it('nenhuma policy permissiva
nova ignora o tenant')` das linhas 70–77 fica fora de qualquer `describe`, com um `})`
órfão na 78. Pelo texto, esse `it` era para estar dentro do primeiro `describe` — mover o
`})` da linha 68 para depois da 77 resolve. Não toquei: `tests/**` é seu.

## 2. O que está pronto para você apontar o teste

`drizzle/0000_fundacao.sql` aplica limpo pelo seu `globalSetup` (mesmo formato:
`--> statement-breakpoint`, statement por statement). Resultado: **17 tabelas, todas com
`relrowsecurity` e `relforcerowsecurity`**.

Rodando do zero, hoje:

```
[migrate] ok — 17 tabelas em public
[migrate] todas as tabelas com RLS habilitado e forçado
[seed] tenant A … { contatos: 2, negocios: 2, propostas: 1, tenantsVisiveis: 1 }
[seed] tenant B … { contatos: 2, negocios: 2, propostas: 1, tenantsVisiveis: 1 }
```

Minha prova manual está versionada em `src/db/checks/isolation.sql` (15 passos, roda com
`psql -v tenant_a=… -v tenant_b=…`). Saída completa em `docs/status/rafa.md`. Ela não
substitui o seu teste — é o que eu conferi antes de dizer "pronto", e serve de checklist
do que vale automatizar.

## S9 — vendas, comissão e recebíveis (`sales`/`receivables`)

Duas tabelas novas em `drizzle/0007_vendas_e_recebiveis.sql` (registrada em
`drizzle/meta/_journal.json`, idx 7), RLS na mesma migration, mesmo padrão de
`sales_isolation`/`receivables_isolation` — uma policy `USING`+`WITH CHECK` cada, sem
escape hatch, sem coluna de dono opcional. `tests/security/tenant-isolation.test.ts`
(varredura por catálogo) deve pegar as duas automaticamente sem precisar de mudança no
arquivo — se não pegar, é sinal de que o catálogo está filtrando por lista fixa em vez de
`information_schema`, vale investigar.

**IMPORTANTE — não consegui rodar migration nem teste nesta rodada.** O Docker Desktop
não subiu no ambiente desta sessão (`docker info` nunca saiu de "não pronto" depois de
várias tentativas com espera), então não tive Postgres disponível nem para
`npm run db:migrate` nem para `npx tsx scripts/check/known-failures.ts`. Revisei a
migration byte a byte contra `0000_fundacao.sql`/`0003_construtor_de_proposta.sql` (mesmo
formato de `--> statement-breakpoint`, mesma sintaxe de policy, mesmos nomes de GUC) e
`npx tsc --noEmit` + `npx eslint` estão limpos, mas **isso não substitui aplicar a
migration de verdade** — só quem tiver Postgres de pé nesta rodada pode confirmar que ela
roda limpa do zero. Pedido: antes de aceitar esta entrega, rode
`npm run db:migrate` (ou deixe o `globalSetup` do vitest fazer isso) e me avise se algo
quebrar — não deveria, mas eu não presenciei.

Pontos para virar teste, além do isolamento padrão:

1. **`sales_proposal_id_key`** (índice único em `proposal_id`) — inserir duas vendas para
   a mesma proposta deve falhar na segunda no nível do BANCO, não só por convenção da
   Server Action (`converterPropostaEmVenda` checa antes de inserir, mas o índice é quem
   garante de verdade sob concorrência).
2. **`receivables_pago_em_check`** — `UPDATE receivables SET status = 'pago'` sem
   `pago_em` deve falhar; `status = 'pendente'` com `pago_em` preenchido também deve
   falhar. As duas pontas do CHECK, não só uma.
3. **Vazamento de custo/comissão entre tenant**: plantar uma venda no tenant A com
   `custo_cents`/`comissao_prevista_cents` como canário, tentar ler via
   `unsafeSqlWithoutTenant` sem GUC (deve dar zero linhas) e via `withTenant` do tenant B
   (também zero linhas) — mesmo roteiro que vocês já fazem para `proposal_options`.
4. **`ON DELETE RESTRICT`** de `sales.deal_id`/`sales.proposal_id`: tentar apagar um
   negócio ou proposta que já virou venda deve falhar no banco (nenhuma Server Action
   hoje expõe "excluir negócio"/"excluir proposta" definitivamente, mas o schema já
   recusa por garantia — vale um teste de contrato direto no SQL, não só via action).
5. **`excluirVenda` recusa venda com parcela paga**: chamar a action com uma parcela
   `status: 'pago'` já gravada deve devolver `CONFLITO`, não apagar nada — nem a venda,
   nem a parcela paga, nem as outras parcelas em aberto daquela venda.

Dois pontos dela que valem virar caso de teste seu, porque eu não conseguiria testar de
forma independente (é o meu próprio código):

- **passo 8**: `UPDATE contacts SET tenant_id = <B>` de dentro do contexto A. Falha por
  `WITH CHECK`. Sem `WITH CHECK`, o `USING` sozinho deixaria a linha *sair* do tenant.
- **passo 11**: `audit_log` não tem policy de UPDATE nem de DELETE — só SELECT e INSERT.
  `UPDATE 0` / `DELETE 0`, sem erro. É append-only pelo banco. Se alguém acrescentar uma
  policy `FOR ALL` nessa tabela, a garantia some sem quebrar nada — vale um teste.

## 3. Sobre `KNOWN_ESCAPE_HATCHES` — você está certo, e aqui está o contorno

Você fixou `tenants_auth_service` e `user_auth_service`, e escreveu: *"o risco real não é a
policy: é a GUC sobreviver ao fim da requisição numa conexão de pool"*. Correto. Duas
coisas a acrescentar:

**a) Existem mais duas policies desse tipo que você ainda não listou**, em tabelas SEM
`tenant_id` (por isso sua varredura não as pega): `session_auth_service`,
`account_auth_service` e `verification_auth_service`. Elas não afrouxam nada — pelo
contrário, essas três tabelas ganharam RLS *só* com essa policy, então uma conexão de
tenant comum lê **zero** hashes de senha em vez de todos. Sem RLS nelas, seria todos.
Vale incluir na sua lista como cobertura explícita.

**b) A GUC não sobrevive à requisição, porque não é setada por requisição.** Ela vai no
pacote de startup da conexão (`connection: { options: '-c app.auth_context=on' }`, em
`src/lib/auth/db.ts`), num pool separado usado só pelo Better Auth. O pool da aplicação
(`src/db/client.ts`) nunca a tem. Medido agora:

```
authDb ve usuarios (sem contexto de tenant): 2      <- login funciona
authDb ve contatos (dado de negocio):        0      <- nenhuma tabela de negócio tem policy auth_service
cliente comum ve usuarios (sem contexto):    0
cliente comum ve credenciais (account):      0
```

Sugestão de teste de contrato, que fecha o buraco de forma verificável e não depende de
ninguém lembrar da convenção: **falhar se qualquer tabela que NÃO seja
`tenants|user|session|account|verification` tiver uma policy cujo nome termine em
`_auth_service`, ou cuja expressão mencione `app.auth_context`.** Assim o dia em que
alguém colar essa policy em `contacts` para "resolver" um bug, o CI grita.

O que continua verdadeiro e não dá para testar de dentro do banco: `app.auth_context` é um
GUC comum e **qualquer SQL arbitrário liga ele**. Confirmei. A correção estrutural (role
dedicado em vez de GUC) está pedida em `docs/handoffs/rafa-para-po.md`, item 5.

## 4. Detalhes do schema que provavelmente afetam seu seed genérico

Li o `seedTenantRows`/`insertRow`. Pelo que percorri, o schema não tem armadilha para ele,
mas registro o que eu olharia se algo falhar:

- `tenants` é a raiz e a policy dela compara `id` (não `tenant_id`) com o contexto — seu
  `bootstrapTenantRoots` já trata isso, e o comentário lá está certo.
- `proposals.accepted_option_id` → `proposal_options` é o ciclo que você previu. É
  anulável, e sua ordenação topológica ignora FK anulável, então resolve sozinho.
- `subscriptions` tem índice único parcial `(tenant_id) WHERE status IN
  ('trialing','active','past_due')`: **uma assinatura viva por tenant**. Inserir duas para
  o mesmo tenant estoura — de propósito.
- `contacts` tem único parcial em `(tenant_id, lower(email)) WHERE email IS NOT NULL`.
  `email` é anulável, então seu seed deve passar batido.
- `payments.asaas_payment_id` e `subscriptions.asaas_subscription_id` são únicos globais
  (parciais, `WHERE ... IS NOT NULL`) — chave de idempotência de webhook. São anuláveis.
- Colunas `*_encrypted` (`contacts.document_encrypted`, `travelers.cpf_encrypted`, …) são
  `text` no banco e guardam `zp1.<key_id>.<iv>.<tag>.<ct>`. Texto arbitrário entra sem
  erro, mas quem ler pelo Drizzle vai tentar decifrar. O tipo tolera valor que não parece
  envelope e devolve como está — seu seed sintético não quebra por isso.

## 5bis. Pedido novo: testes de RLS/isolamento do construtor de proposta (S5/S6)

Schema novo desde a última rodada: `proposals`, `proposal_options`, `proposal_blocks`,
`proposal_views` (RLS desde `0000_fundacao.sql`/`0001`, sem novidade de policy) e
`library_items` (tabela nova, RLS na própria `0003_construtor_de_proposta.sql`). Peço três
frentes de teste:

**a) Isolamento padrão nas quatro tabelas de proposta.** Mesmo roteiro que você já usa
para `contacts`/`deals`: tenant A cria proposta + opção + bloco, tenant B lê pela mesma
varredura por catálogo — zero linhas. Novidade em relação às tabelas antigas:
`proposal_options.priceCents`/`costCents`/`commissionCents` são os primeiros valores
monetários "sensíveis por natureza de negócio" (não PII, mas o agente nunca quer que o
concorrente-tenant veja sua margem) — vale um teste que verifica explicitamente que esses
dois campos não vazam nem em erro (ex. mensagem de exceção que ecoe a linha inteira).

**b) `library_items.is_global` — o comportamento com quatro pontas, não duas.** Isto é
novo em relação a tudo que existia antes (primeira tabela com `tenant_id` anulável):

1. Tenant A vê itens do próprio tenant + todos os itens globais (`is_global = true`,
   `tenant_id null`) — nunca zero linhas quando existe pelo menos um item global.
2. Tenant A **não** vê item de tenant B (isolamento de sempre).
3. Tenant A tenta `INSERT`/`UPDATE` com `is_global = true` — falha (o `WITH CHECK` recusa
   mesmo que o valor venha setado na mão, sem passar pela Server Action). Teste direto em
   SQL contra a policy, não só via `criarItemNaBiblioteca` (que já nunca manda
   `isGlobal: true`, então testar só a action não prova que a policy barra sozinha).
4. Tenant A tenta `DELETE` de um item global pré-existente (inserido fora do contexto de
   tenant, ex. via `withPlatformContext`) — `DELETE 0`, sem erro, item continua lá. Este é
   o caso que o comentário da migration (`0003_construtor_de_proposta.sql`, parágrafo sobre
   por que são 4 policies e não uma `FOR ALL`) chama de "não aparece em teste de SELECT
   nenhum" — só aparece testando DELETE explicitamente. Peço que vire caso de teste
   nomeado, não só nota de código.
5. `withPlatformContext` (`src/lib/tenant/withPlatformContext.ts`) escreve item global sem
   rodar como superuser — teste que ele funciona (INSERT com `is_global=true,
   tenant_id=null` sucede dentro do helper) E que, fora dele (GUC `app.platform_context`
   desligado, que é o estado de qualquer conexão de tenant comum), a mesma tentativa de
   escrever `is_global=true` continua falhando.

**c) Verifique que a transação de `withPlatformContext` nunca vê dado de tenant.** Ela usa
`unsafeDbWithoutTenant` sem setar `app.tenant_id` — então, mesmo com
`app.platform_context = 'on'`, um `SELECT` contra `library_items` só deveria devolver
linhas globais (a policy de SELECT tenant continua exigindo `tenant_id = current_setting`,
que é `NULL` ali dentro, então `NULL = tenant_id` nunca é `true`). Vale um teste que prove
isso explicitamente, porque é o ponto onde um futuro reaproveitamento desse helper poderia
virar bypass sem ninguém perceber: se alguém um dia adicionar `set_config('app.tenant_id',
...)` dentro de `withPlatformContext` "para simplificar", essa combinação (`platform_context
= on` + `tenant_id setado`) passaria a enxergar dado de tenant através da policy de
serviço, que só olha `is_global`. Hoje isso não acontece porque o helper nunca seta
`tenant_id` — um teste de contrato trava essa garantia.

## 5. Para o `leak-scanner.ts` e o `public-proposal.test.ts`

Vi os arquivos. Aviso para você não escrever teste contra algo que não existe: **a leitura
pública da proposta não foi implementada no S1.** Não há função `SECURITY DEFINER`, não há
rota, não há policy de leitura por token. Motivo em `docs/status/rafa.md` — resumo: com
`FORCE ROW LEVEL SECURITY`, uma função `SECURITY DEFINER` de dono `zarpa` **continua**
sujeita ao RLS, então o desenho óbvio não funciona e o que funciona precisa de decisão de
risco que não cabia hoje.

O que já está pronto para quando isso chegar: `proposals.public_token` (único, 128 bits),
`brand_snapshot` congelado no envio, e a separação `price_cents` (público) × `cost_cents` /
`commission_cents` (nunca públicos). Se seu scanner de vazamento já procura `cost_cents` e
`commission_cents` em resposta pública, mantenha — é exatamente o que precisa quebrar o CI
no dia em que a rota nascer errada.

---

## S7 — a rota chegou. Três pedidos: dois OBSOLETOS, um novo, um allowlist de RLS

`drizzle/0004_proposta_publica.sql` criou `public.proposta_publica(slug)` e
`public.registrar_visita_proposta(...)`, as duas `SECURITY DEFINER` com
`SET search_path = public, pg_temp`. Rodei `npx tsx scripts/check/known-failures.ts` depois
da migration. Resultado:

```
Allowlist (3):
  vermelho esperado  resposta da proposta pública não carrega dado sensível ...

Vermelho FORA da allowlist — regressão real:
  FALHA  rls-enabled.test.ts > nenhuma policy permissiva nova ignora o tenant

Entrada da allowlist ficou verde — tire daqui:
  OBSOLETA  contrato da proposta pública existe uma função SECURITY DEFINER ...
  OBSOLETA  contrato da proposta pública a função SECURITY DEFINER tem search_path fixo
```

### 1. Duas entradas de `KNOWN_FAILURES` (`scripts/check/known-failures.ts`) ficaram obsoletas

Remova estas duas (a função existe e tem `search_path` fixo agora):

```
'contrato da proposta pública existe uma função SECURITY DEFINER para a proposta pública'
'contrato da proposta pública a função SECURITY DEFINER tem search_path fixo'
```

### 2. A 3ª entrada CONTINUA vermelha, mas por um motivo diferente — não é falha de RLS

Antes: "sem função `SECURITY DEFINER`, não dá para exercer a resposta pública" (o teste
lançava isso de propósito). Agora a função existe, então esse `throw` não dispara mais —
mas a asserção seguinte (`results.length > 0`, linha ~151 de
`public-proposal.test.ts`) falha porque **nenhuma rotina foi exercida de verdade**:
`plantCanaries()` faz `select public_token from proposals limit 1` e não acha NENHUMA
linha, porque `public-proposal.test.ts` roda ANTES de qualquer arquivo semear dado —
ordem alfabética dentro de `fileParallelism: false`:

```
public-proposal.test.ts   ← roda 1º, precisa de uma linha em `proposals`
rls-enabled.test.ts
tenant-isolation.test.ts  ← só aqui `seedTenantRows` semeia `proposals`
```

Confirmei que isto é gap de fixture, não de segurança: rodei o cenário completo (schema
resetado, migrations aplicadas, uma proposta `status='sent'` de verdade com
`public_token`, canário de CPF/e-mail/telefone/passaporte/nascimento plantado em
`contacts`/`travelers`/`tenants`, `cost_cents`/`commission_cents` preenchidos em
`proposal_options`) fora do vitest, chamando `scanPayload`/`CANARIES` reais de
`tests/security/leak-scanner.ts` contra a resposta das duas funções — **zero vazamento**
(depois do ajuste do item 4 abaixo). Script não ficou no repositório (era só verificação
manual, deletei depois).

Duas saídas possíveis, a escolha é sua:
- **Seed mínimo dentro do próprio `public-proposal.test.ts`**: um `insert` direto (dentro
  de `withTenant`/equivalente) de UMA linha em `tenants`+`contacts`+`deals`+`proposals`
  com `status: 'sent'`, `sent_at: now()` e um `public_token` conhecido, ANTES de
  `plantCanaries()` rodar. Isso também é o que eu recomendaria para exercer o caminho
  "com dado de verdade" (hoje, mesmo com uma linha `draft` gerada por qualquer seed
  genérico, a asserção passaria trivialmente com zero linhas devolvidas pela função — o
  que prova pouco. Uma linha `sent` de verdade, com opção de `cost_cents`/`commission_cents`
  preenchidos, é o que faz o scanner exercitar de verdade a lista de colunas da função).
- Ou reordenar/mover a seção de seed de `tenant-isolation.test.ts` para um
  `beforeAll`/fixture compartilhado que rode antes dos três arquivos de
  `tests/security/`.

### 3. Regressão nova esperada em `rls-enabled.test.ts` — 6 entradas para `KNOWN_ESCAPE_HATCHES`

`tests/security/rls-checks.ts`, mesmo padrão de `tenants_auth_service`/
`library_items_platform_service`. As seis policies novas do escape hatch
`app.proposal_public_context` (nascem só dentro das duas funções `SECURITY DEFINER`,
nunca ligadas por nenhum outro caminho do código — grep `proposal_public_context` mostra
a superfície inteira em `drizzle/0004_proposta_publica.sql`):

```ts
{ table: 'public.proposals', policy: 'proposals_public_read' },
{ table: 'public.proposals', policy: 'proposals_public_view_update' },
{ table: 'public.proposal_options', policy: 'proposal_options_public_read' },
{ table: 'public.proposal_blocks', policy: 'proposal_blocks_public_read' },
{ table: 'public.proposal_views', policy: 'proposal_views_public_insert' },
{ table: 'public.proposal_views', policy: 'proposal_views_public_select' },
```

Mesma ressalva já registrada para `app.auth_context`/`app.platform_context`: o GUC é
forjável por SQL arbitrário. O alcance foi mantido mínimo (só as 4 tabelas de proposta,
nunca `contacts`/`travelers`), e a policy de leitura ainda exige `status <> 'draft' AND
sent_at IS NOT NULL AND archived_at IS NULL` mesmo com o GUC ligado.

### 4. Pedido de allowlist no `leak-scanner.ts` — `brand.whatsappLink` é telefone DE PROPÓSITO

A marca pública devolve `brand.whatsappLink` (`https://wa.me/<dígitos>`), não
`brand.whatsapp` — troquei o NOME de propósito porque `whatsapp` sozinho bate em
`FORBIDDEN_KEY_PATTERNS` (rótulo "telefone") e reprovaria a função mesmo sendo dado
público por natureza (WhatsApp COMERCIAL do agente, frozen em `brand_snapshot`, nunca o
telefone do cliente). Troquei o nome da CHAVE e isso resolve o `nome-de-campo`.

O que eu **não** consigo resolver sem tocar no seu arquivo: o VALOR ainda dispara
`padrao-no-valor: telefone BR` (`PHONE_BR_RE`) sempre que `tenants.whatsapp` estiver
preenchido — o regex não distingue "número do cliente vazando" de "número do agente
publicado de propósito", e não tem formatação que escape dele (`+55`, com/sem `-`, com/sem
`()`, todos batem). Verifiquei isso na mão (item 2) — assim que você plantar uma proposta
`sent` com `tenants.whatsapp` preenchido, o teste vai acusar esse campo. Não é vazamento
real; é o produto fazendo o que o CLAUDE.md pede (mostrar o contato do agente na proposta
pública). Sugestão: excluir o subtree `brand.*` (ou especificamente a chave
`whatsappLink`) da checagem de `VALUE_PATTERNS` de telefone em `scanPayload`, mantendo
todo o resto do scanner (canários, outros campos, outras chaves) intacto. Decisão é sua;
registrei para não virar descoberta de susto quando a fixture do item 2 nascer.

---

## S8 — régua de follow-up automático: o pedido de teste do aceite

Critério de aceite do sprint, ao pé da letra: **"proposta enviada numa sexta gera três
tarefas (D+2, D+5, D+10) nas datas certas, com mensagem sugerida pronta, sem duplicar
quando o cron roda duas vezes."** Três peças novas, todas em `src/server/followups.ts`
(nenhuma em `src/server/proposals.ts` — decidi não mexer em `enviarProposta` nesta
rodada, ver `docs/handoffs/rafa-para-po.md`):

- `rodarFilaDeFollowups()` — o runner do cron. Sem sessão de usuário (`authDb`, mesma
  policy `tenants_auth_service` que `gerarAlertas()` já usa). Materializa, por tenant,
  1) a régua de follow-up de proposta e 2) os alertas de passaporte/aniversário — na
  MESMA fila, mesma chamada.
- `gerarFollowupsDaProposta(tx, tenantId, propostaId)` — gera a régua para UMA proposta,
  reaproveitável de dentro de outra transação (ex.: se o PO/eu decidir um dia chamar isto
  direto de `enviarProposta`).
- `listarTarefasDeHoje()` — leitura para a tela Hoje (contrato completo no handoff da
  Nina).

### O que eu verifiquei manualmente (fora do vitest, script deletado depois)

Rodei contra `zarpa_test` de verdade: criei tenant + contato + negócio + proposta com
`sentAt = agora - 3 dias` (a "sexta"), chamei `rodarFilaDeFollowups()` duas vezes
seguidas.

- 1ª rodada: 3 tarefas criadas para aquela proposta (`followupsCriados: 3` no total
  agregado, junto de outros tenants que já tinham dado do seed).
- 2ª rodada: **0** tarefas novas — confirmado por `dedupeKey` (`followup:proposta:<id>:d2`
  etc.) batendo no índice único parcial `tasks_tenant_dedupe_key` (mesmo mecanismo que já
  protege os alertas, migration `0001`).
- `dueAt` das três bateu exatamente com `sentAt + {2,5,10} dias` (comparei em UTC).
- `suggestedMessage` veio preenchido com nome do cliente e destino, um texto diferente
  por marco (não é a mesma mensagem repetida 3x).
- Confirmei RLS fail-closed no caminho: uma consulta com `unsafeSqlWithoutTenant` (sem
  GUC) contra as tarefas recém-criadas devolveu **zero linhas**, mesmo eu sendo quem
  acabou de inserir — só enxerguei de novo entrando por `withTenant` com o `tenantId`
  certo.

### O que pediria para você automatizar

1. **O teste do aceite ao pé da letra**: seed de proposta com `sentAt` fixo (não
   `Date.now()` — congele a data para o teste não ficar sensível ao dia em que roda),
   chame `rodarFilaDeFollowups()`, confira as 3 `dueAt` exatas e o `dedupeKey` de cada
   uma. Chame de novo e confira `followupsCriados: 0` (ou, melhor ainda, confira
   `count(*) from tasks where dedupe_key like 'followup:proposta:<id>:%'` continua em 3
   depois da segunda chamada — não depende do valor de retorno da função).
2. **Duplo cron em paralelo** (mais rigoroso que rodar em sequência): duas chamadas
   `Promise.all([rodarFilaDeFollowups(), rodarFilaDeFollowups()])`. O índice único
   parcial deveria proteger mesmo sob corrida — mas eu só testei sequencial, vale a pena
   confirmar concorrência de verdade.
3. **Isolamento entre tenants**: proposta enviada no tenant A não gera tarefa nenhuma
   pendurada no tenant B, mesmo que os dois tenham propostas "sexta passada" no mesmo
   dia. Mesmo padrão de `tenant-isolation.test.ts`, aplicado a `tasks` com
   `source = 'followup_proposta'`.
4. **`listarTarefasDeHoje` isolado por tenant** e respeitando `doneAt`/janela de data —
   mesma doutrina de mock de `requireAuthContext` que `import-planilha.test.ts` já usa
   (`vi.mock('@/lib/auth/session', ...)`).
5. **Migration nova, `drizzle/0006_regua_de_followup.sql`**: registrada no
   `drizzle/meta/_journal.json` (idx 6). Apliquei do zero em `zarpa_dev` e confirmei que
   `npx tsx scripts/check/known-failures.ts` recria `zarpa_test` do zero e aplica as 7
   migrations sem erro (327 testes, allowlist vazia, verde). Não criei tabela nova —
   só coluna (`tasks.suggested_message`) e um valor a mais no `CHECK` de
   `tasks.source` —, então não há policy de RLS nova para revisar aqui.

---

## S4 — o funil (`src/server/deals.ts`): pedido de teste

Nenhuma migration nova (`deals`/`tasks`/`activities` já tinham RLS desde
`0000_fundacao.sql` — conferi `deals_isolation`/`activities_isolation` antes de escrever a
primeira query). Seis actions novas, todas `requireAuthContext` + `withTenant`, mesmo padrão
de sempre. Pontos concretos para virar teste:

1. **Isolamento padrão, nas seis actions.** Tenant A cria negócio(s) com `activity`,
   tenant B chama cada uma das seis (`listarNegociosDoFunil`, `moverEstagioDoNegocio`,
   `criarNegocio`, `obterNegocio`, `listarNegociosParados`, `obterResumoDoPipeline`) — zero
   negócio do A aparece em nenhuma delas, e `moverEstagioDoNegocio`/`obterNegocio` chamado
   com o `dealId` do A a partir do contexto do B devolve `NAO_ENCONTRADO` (RLS transforma
   "existe em outro tenant" em "zero linhas", nunca erro de permissão — mesma resposta de
   "não existe mais").

2. **Motivo de perda obrigatório.** `moverEstagioDoNegocio(dealId, 'perdido')` sem
   `motivoPerda` (ou com string vazia/2 caracteres) → `DADOS_INVALIDOS`, `campo:
   'motivoPerda'`, e **o estágio do negócio não muda no banco** (confira lendo de volta,
   não só o retorno da action). Com motivo válido (≥3 caracteres depois de trim), o negócio
   vai para `perdido`, `lostReason` grava o texto, `closedAt` grava a hora, e uma `activity`
   `type: 'stage_changed'` nasce com `metadata.motivoPerda` preenchido.

3. **Idempotência sob clique duplo — os dois caminhos, não só o feliz.**
   - Sequencial: mover um negócio de `novo` para `cotando`, chamar de novo com o MESMO
     `novoEstagio` — segunda chamada não cria segunda `activity` nem segunda linha de
     `audit_log` (`select count(*) from activities where deal_id = ...` deve ficar em 1, não
     2), e o retorno reflete o estado já persistido.
   - Concorrente de verdade: `Promise.all([moverEstagioDoNegocio(id, 'ganho'),
     moverEstagioDoNegocio(id, 'ganho')])` — confira que só existe UMA `activity`
     `stage_changed` para essa transição, não duas. É o `UPDATE ... WHERE stage <>
     novoEstagio` que garante isso no banco (documentei o mecanismo em comentário no
     código) — vale confirmar que ele segura a corrida de verdade, não só na leitura do
     código.
   - Reabertura limpa o estado: mover um negócio `ganho`→`negociando` deve zerar `closedAt`
     (não pode sobrar um `closed_at` de uma venda "fechada" que na verdade reabriu — isso
     inflaria `obterResumoDoPipeline().fechadoNoMesCents` silenciosamente). Mesma checagem
     para `lostReason` ao sair de `perdido`.

4. **"Parados" não inclui `ganho`/`perdido`.** Seed: um negócio `novo` sem `activity` e
   `updatedAt` de 10 dias atrás (deve aparecer), um `ganho` também com `updatedAt` de 10
   dias atrás (não deve aparecer, mesmo estando "velho"), um `perdido` idem (não deve
   aparecer). `listarNegociosParados().itens` só deve conter o primeiro, e
   `totalCents` deve bater exatamente com `valueCents` dele (não a soma dos três).

5. **`listarNegociosDoFunil` exclui `perdido` e só ele.** Seed com um negócio em cada um
   dos 6 estágios; o retorno deve ter exatamente 5, nunca incluindo o `perdido`, e o
   `stage` de cada linha retornada precisa bater com o mapeamento documentado em
   `docs/handoffs/rafa-para-nina.md` (S4) — vale um teste que trave o enum inteiro, não só
   "perdido sumiu", porque é exatamente esse tipo de divergência (5 colunas de exemplo vs.
   6 valores do banco) que motivou a entrega.

6. **`diasParado`/"última movimentação" usa o maior entre `updatedAt` e a `activity` mais
   recente, não só um dos dois.** Caso que pega bug de regressão: negócio com `updatedAt`
   de HOJE mas nenhuma `activity` → `diasParado: 0`. Negócio com `updatedAt` de 30 dias
   atrás mas uma `activity` de ONTEM → `diasParado: 1` (a activity é mais recente e vence).
   Negócio sem nenhuma `activity` e `updatedAt` de 8 dias atrás → `diasParado: 8`, sem
   erro/null por falta de activity (é o caso mais comum: negócio nunca teve nenhuma nota).

7. **Achado que vale um teste de contrato de verdade, não só desta função**: `sql<Date>()`
   livre no Drizzle (não ligado a coluna de schema) chega na aplicação como STRING do
   driver, nunca como `Date`, mesmo com `::timestamptz` no SQL — comprovei isolando a
   variável passo a passo, documentado com detalhe em `docs/status/rafa.md` (seção S4,
   "Dois defeitos reais encontrados"). Escrevi `paraDataOuNula()` em `deals.ts` para
   proteger os dois lugares que uso isso, mas é uma característica da combinação
   Drizzle+driver deste projeto, não deste arquivo — um teste que grave uma `activity` com
   `occurredAt` conhecido, exercite `listarNegociosDoFunil`, e confira que `diasParado`
   bate com o valor esperado (não `NaN`, não `Infinity`, não um número absurdo por
   `new Date(undefined)`) serve como guarda de regressão para essa classe inteira de bug —
   se algum dia alguém tirar o `paraDataOuNula()` "porque parecia redundante", o teste
   pega.

8. **`obterContato` (`src/server/contacts.ts`) — corrigi um bug pré-existente sem pedido,
   descoberto testando o item 7.** `totalViajantes`/`totalNegocios` usavam o mesmo padrão
   quebrado de subquery correlacionada (`${travelers.contactId} = ${contacts.id}` sem
   qualificar tabela) e SEMPRE voltavam zero, para todo contato, desde que a função foi
   escrita — não é bug de isolamento entre tenants, é a tela de detalhe do contato mentindo
   "0 viajantes, 0 negócios" mesmo quando existem. Corrigido (nomes de coluna literais,
   mesmo padrão do item 7). Vale um teste que planta 1 viajante + 2 negócios num contato e
   confere que `obterContato(id).data.totalViajantes === 1` /
   `.totalNegocios === 2` — não encontrei teste existente que dependesse do valor errado
   (`grep totalViajantes tests/` veio vazio), então a correção não deveria quebrar nada
   seu, mas registrando aqui para você não achar essa mudança de diff estranha sem
   contexto.
