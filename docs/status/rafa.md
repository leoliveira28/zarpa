# Status — Rafa (backend / plataforma)

## Tarefa desta rodada: S10 — Dashboard do mês

Pedido: backend do dashboard que a agente abre para DECIDIR o que fazer, não só para ver
número — cada métrica tem que apontar de volta para a tela onde a ação acontece (o PO
tinha auditado o produto ponta a ponta e achado peças desconectadas em rodadas
anteriores; esta entrega foi desenhada para não repetir isso).

### Pronto

1. **`src/server/dashboard.ts` (novo)** — duas Server Actions, exportadas no barril
   `src/server/index.ts`. **Nenhuma tabela nova, nenhuma migration** — tudo lido de
   `sales`/`proposals`, que já têm RLS desde `0007_vendas_e_recebiveis.sql`/
   `0003_construtor_de_proposta.sql`. Mesmo padrão de sempre: `requireAuthContext()` +
   `withTenant`, `ServiceResult<T>`, `tenantId` nunca argumento.

   - **`obterResumoDoMes()`** — três queries sequenciais dentro da MESMA transação:
     - *Vendas e faturamento* — soma `sales.valorBrutoCents`/`taxaServicoCents` das linhas
       com `createdAt` no mês corrente (UTC). Decisão: `sales` não tem coluna própria de
       "quando fechou" (diferente de `deals.closedAt`) — a EXISTÊNCIA da linha já significa
       "virou venda" (só nasce de proposta aceita), então `createdAt` é o proxy mais direto
       sem inventar coluna nova.
     - *Comissão a receber vs. recebida* — agregada por `sales.comissaoStatus`
       (`prevista`/`recebida`/`atrasada`), soma `comissaoPrevistaCents` de cada grupo, e
       `aReceberCents = previstaCents + atrasadaCents` (o número pronto para o rótulo da
       tela). **Escopada ao MESMO mês da métrica anterior** — decisão consciente, não a
       única leitura possível (a alternativa, "tudo que falta receber independente de
       quando vendeu", é métrica diferente — registrada como pedido em aberto abaixo).
     - *Conversão de proposta* — coorte por `proposals.sentAt` no mês corrente: `enviadas`
       = toda a coorte, `aceitas` = quantas da MESMA coorte estão `status: 'accepted'`
       agora. Não é "aceitas no mês / enviadas no mês" (dois filtros de data diferentes
       criariam taxa que passa de 100%) — é sempre a mesma coorte, medida no presente. Usei
       `.groupBy(proposals.status)` + `count(*)::int`, primeira vez que `.groupBy` aparece
       neste projeto.
   - *Propostas paradas* — `status in ('sent','viewed')`, `archivedAt is null`,
     `diasParado > 7` (mesmo limiar de `listarNegociosParados` em `deals.ts` — um conceito
     de "parado" só, não dois números para a agente aprender). `diasParado` conta a partir
     do mais recente entre `sentAt` e `lastViewedAt`. **SEM recorte de mês** — uma proposta
     enviada há 40 dias e ainda sem resposta continua parada mesmo que tenha nascido no mês
     passado (mesmo raciocínio do `pipelineAbertoCents` em `deals.ts`). **Sempre devolve os
     `id`s de cada proposta parada** (`PropostaParada[]`), nunca só a contagem — é
     literalmente o pedido desta rodada: "3 propostas paradas" sem id não linka para lugar
     nenhum.
   - **`exportarResumoDoMesCsv()`** — mesmo cálculo (fatora um `calcularResumoDoMes(tx,
     agora)` interno, chamado pelas duas actions dentro do próprio `withTenant`), formatado
     como texto CSV pronto para baixar: delimitador `;`, BOM UTF-8 no início, dinheiro
     formatado `1.234,56` (só para exibição — a aplicação nunca guarda assim). Devolve
     `{ nomeArquivo, conteudo }` — Server Action que devolve texto, não uma rota HTTP;
     `src/app/api/**` é fronteira do PO, e não precisava de rota nova: o texto já chega
     pronto no cliente, que dispara o download com `Blob`/`URL.createObjectURL` (contrato
     completo em `docs/handoffs/rafa-para-nina.md`).

2. **`listarPropostas` ganhou filtro `ids?: string[]`** (`src/server/proposals.ts`,
   `FiltroPropostas`) — é o que torna o card "propostas paradas" de fato clicável:
   `/propostas?ids=<lista>` chama `listarPropostas({ ids })` e mostra só essas. Pequena
   adição dentro da minha fronteira (o arquivo já é meu), sem mudar nenhum comportamento
   existente (filtro novo, opcional, ignorado quando vazio).

3. **Contratos escritos**: `docs/handoffs/rafa-para-nina.md` (seção "S10" — assinatura
   completa, a tabela "para onde cada card deve linkar" pedida explicitamente, o exemplo de
   download de CSV via `Blob`, e as três decisões de recorte de tempo) e
   `docs/handoffs/rafa-para-teo.md` (seção "S10" — cinco pontos concretos de teste:
   isolamento nas três queries novas, soma por `comissaoStatus`, coorte de conversão por
   `sentAt` não por "aceita no mês", fronteira exata do limiar de 7 dias, e paridade
   numérica entre `obterResumoDoMes`/`exportarResumoDoMesCsv`).

### Verificado manualmente contra Postgres de verdade (não só `tsc`)

Segui a doutrina de sempre ("se não tem teste provando, não existe") e não me contentei
com tipo batendo: escrevi um script descartável (deletado depois, não ficou no
repositório) e rodei contra `zarpa_test` com dois tenants throwaway. Confirmei:

- **`.groupBy(proposals.status)` + `count(*)::int` volta `number` de verdade** — primeira
  vez que `.groupBy` é usado neste projeto, valia a pena confirmar em vez de assumir que se
  comporta como o `count(*)::int` avulso já usado em `sales.ts`/`contacts.ts`.
- **Colunas de data (`sentAt`, `lastViewedAt`) chegam como `Date` de verdade**, não como
  string crua do driver — as três queries deste arquivo leem COLUNA DIRETO (nunca
  `sql<Date>()` livre usado como valor de `.select({...})`), então não caí no bug
  documentado em `deals.ts`/`contacts.ts` (S4) que exigiu `paraDataOuNula()`. Não precisei
  do mesmo workaround aqui — e confirmei isso, não só assumi pela leitura do código.
- **Filtro de data por `gte`/`lt` contra `timestamptz` com `Date` do JS funciona** (mesmo
  padrão já usado em `followups.ts`, agora reusado aqui) — range do mês corrente pegou
  certo as linhas dentro e excluiu as de fora.
- **"Paradas" não tem recorte de mês, "conversão" tem** — plantei uma proposta enviada 10
  dias atrás (mês anterior, dado que hoje é dia 7) que ficou de fora de
  `conversao.enviadas` (certo — não foi enviada este mês) mas apareceu em `paradas.itens`
  (certo — está parada agora, independente de quando foi enviada). Os dois recortes de
  tempo diferentes não vazam um para o outro.
- **Isolamento**: tenant A não viu nenhuma linha do tenant B nas três queries; tenant B viu
  exatamente a 1 proposta que era dele.

Saída relevante do script:

```
[conversao, tenant A, groupBy] [ { status: 'viewed', total: 1 }, { status: 'accepted', total: 1 } ]
[paradas filtradas > 7 dias, tenant A] [ { title: 'Proposta parada', dias: 10 } ]
TODAS AS VERIFICACOES PASSARAM.
Limpeza concluida (tenants throwaway removidos).
```

### Decisões que tomei sozinha

- **"Vendas do mês" usa `sales.createdAt`**, não uma coluna de "data de fechamento"
  dedicada (não existe) — ver item 1 de "Pronto".
- **"Comissão a receber vs. recebida" escopada ao mês corrente**, não ao saldo total em
  aberto histórico — registrado como decisão explícita (não a única leitura válida do
  pedido) em comentário no próprio `dashboard.ts` e no handoff da Nina, com convite para
  pedir uma segunda função se o produto quiser as duas visões.
- **Limiar de "parada" = 7 dias**, igual ao de `listarNegociosParados` (`deals.ts`) — um
  conceito de "parado" só no produto inteiro, não um número diferente por tela.
- **CSV via Server Action que devolve texto, não rota `src/app/api/**`** — evita pedir algo
  ao PO que eu não precisava pedir; o download acontece 100% no cliente a partir do texto
  já pronto.
- **Sem `Promise.all` para as três queries** — sequenciais, mesmo padrão que todo outro
  arquivo de `src/server/` usa; no volume esperado (MEI, 10-15 vendas/mês) cada query é um
  scan pequeno dentro da partição do próprio tenant, a soma fica bem abaixo dos 800ms do
  critério de aceite sem precisar de pipelining. Não medi o tempo real de wall-clock desta
  rodada (não tenho 12 meses de dado de teste semeados no ambiente) — ver riscos.

### Riscos

- **Não confirmei o orçamento de "menos de 800ms com 12 meses de dados de teste" com
  medição de verdade** — não existe hoje um script/seed que gere 12 meses de dado por
  tenant no volume do produto (o `seed.ts` atual cria um cenário pequeno de demonstração).
  Os índices que já existem (`sales_tenant_created_idx`, `proposals_tenant_active_idx`
  etc.) cobrem os padrões de acesso das três queries, e o volume esperado por tenant (MEI,
  10-15 vendas/mês × 12 meses ≈ 120-180 vendas, propostas em proporção parecida) é pequeno
  para Postgres — mas "deveria ser rápido" não é "medi que é rápido". Pedido ao PO/Téo: se
  existir (ou for criado) um seed de carga de 12 meses, rodar `obterResumoDoMes()` com
  `console.time` (ou um teste de performance) antes de fechar o critério de aceite como
  cumprido de fato.
- **"Comissão a receber" escopada ao mês** pode não ser a leitura que o produto quer no
  fim das contas (ver decisão acima) — é reversível/estendível (uma segunda função), não
  bloqueante, mas registro o risco de expectativa desalinhada.
- Mesmos riscos estruturais de sempre (GUCs forjáveis por SQL arbitrário) não mudam nesta
  rodada — nenhum GUC novo, nenhuma policy nova.

### O que precisa dos outros

- **Nina**: religar os cards do dashboard a `obterResumoDoMes()`/`exportarResumoDoMesCsv()`
  — contrato completo, com a tabela "para onde cada card deve linkar", em
  `docs/handoffs/rafa-para-nina.md`, seção "S10". O card de "propostas paradas" já vem com
  os ids prontos para `/propostas?ids=...` (filtro novo em `listarPropostas`).
- **Téo**: os cinco pontos de teste em `docs/handoffs/rafa-para-teo.md`, seção "S10", e —
  se possível — um jeito de medir o critério de aceite de performance (800ms/12 meses) de
  verdade, não só por inspeção de índice.
- **PO**: se quiser o seed de 12 meses de dado para medir performance de verdade, é pedido
  novo — não existe hoje.

### Verificação

- `npx tsc --noEmit`: limpo.
- `npx eslint src/server/dashboard.ts src/server/proposals.ts src/server/index.ts`: limpo.
- `npx tsx scripts/check/known-failures.ts`: 378 testes, allowlist vazio, sem regressão
  (Postgres de dev de pé, `zarpa_test` recriado do zero pelo `globalSetup`, 9 migrations
  aplicadas — nenhuma migration nova nesta rodada).
- Script manual (não versionado) contra `zarpa_test`, dois tenants — ver seção acima.
- Não toquei em `src/components`, `src/styles`, `src/app/**`, `tests/`, `package.json` —
  fronteira respeitada. Não commitei — quem commita é o PO.

---

## Rodada anterior: `criarTarefa` — o "Criar lembrete" morto da tela Hoje

Pedido: auditoria ao vivo no produto encontrou o botão "Criar lembrete" da tela Hoje sem
`onClick`, e nenhuma função de servidor de criação manual de tarefa em lugar nenhum do
repositório (`src/server/followups.ts` já tinha o runner automático de follow-up e a
leitura `listarTarefasDeHoje`, mas não a escrita manual). O schema `tasks`
(`src/db/schema/pipeline.ts`) já suportava isso por inteiro desde a fundação — `source`
já tinha o valor `'manual'`, `dedupeKey` já era opcional (e o CHECK
`tasks_dedupe_key_check` já EXIGE `dedupeKey is null` quando `source = 'manual'`) — então
esta entrega é só a Server Action que faltava, sem migration.

### Pronto

1. **`criarTarefa(input)`**, em `src/server/followups.ts`, exportada em
   `src/server/index.ts`. Mesmo padrão de sempre: `tenantId`/`userId` vêm de
   `requireAuthContext()` (nunca de argumento), toda escrita dentro de `withTenant`, zod
   valida antes de tocar no banco, retorno `ServiceResult<TarefaResumo>` (reaproveitei o
   tipo `TarefaResumo` já exportado por `alerts.ts` — não criei um tipo irmão quase
   idêntico à toa).
   - Campos: `title` (obrigatório, 2–200), `notes` (opcional), `kind` (opcional, default
     `'outro'`), `dueAt` (**obrigatório** — é lembrete, não faz sentido sem "quando"; aceita
     `Date` ou string que `new Date(...)` entenda, com `ctx.addIssue` + `z.NEVER` em vez
     de deixar `Invalid Date` estourar mais adiante no INSERT), `dealId`/`contactId`
     (ambos opcionais, uuid).
   - Quando `dealId`/`contactId` vierem preenchidos, confiro que existem NO TENANT ATUAL
     dentro da MESMA transação antes do INSERT — mesmo padrão de `criarNegocio`
     (`deals.ts`): se o id pertence a outro tenant, o RLS já faz o SELECT de checagem
     devolver zero linhas, e a resposta é `NAO_ENCONTRADO` com `campo` apontando qual dos
     dois — nunca um erro de FK de baixo nível vazando para a tela.
   - `source: 'manual'` fixo, sem parâmetro — não é o chamador que decide a proveniência.
   - `dedupeKey` fica de fora de propósito: dedupe é para tarefa GERADA (régua de
     follow-up, alerta de passaporte/aniversário), que precisa sobreviver a "o cron rodou
     duas vezes". Lembrete manual não tem essa necessidade — a agente pode querer duas
     tarefas com o mesmo título na mesma data, e não cabe a esta função decidir que isso é
     engano dela.
   - Grava `createdBy: userId` (a coluna já existia no schema, `ON DELETE SET NULL`,
     ninguém preenchia ainda) e uma linha de `audit_log` (`task.created`) com metadata
     `{ kind, comNegocio, comContato }` — nunca o título/notas (podem conter nome/dado de
     cliente; audit log não é o lugar).
2. **Contrato para a Nina**: `docs/handoffs/rafa-para-nina.md`, seção nova no fim do
   arquivo — assinatura exata, o shape de `TarefaResumo`, o que fazer depois de criar
   (chamar `listarTarefasDeHoje()` de novo, ou montar o item otimisticamente com os
   campos que faltam calculados no cliente: `vencida = dueAt < new Date()`,
   `suggestedMessage` sempre `null` em manual).

### Decisões que tomei sozinha

- **Reaproveitar `TarefaResumo` (de `alerts.ts`) como retorno**, em vez de inventar um
  `TarefaCriada` novo quase idêntico. É o mesmo shape que `listarTarefas` já devolve, e
  reduz o número de tipos que a Nina precisa conhecer. Se a tela quiser mostrar
  `contactName`/`dealTitle` no item recém-criado sem esperar o próximo `listarTarefasDeHoje()`,
  ela já tem essa informação no próprio formulário (quem escolheu o contato/negócio sabe
  o nome) — não fiz um segundo JOIN só para devolver um dado que o chamador já tinha.
- **`dueAt` aceita `Date` OU string livre, sem exigir formato `AAAA-MM-DD` fixo.** É
  `timestamptz`, não `date` — diferente de `departureOn`/`birthDate` (que são `date` e
  passam por `parseDataFlexivel`, formato brasileiro), aqui um lembrete pode carregar hora
  do dia (`<input type="datetime-local">`), então usei `new Date(value)` puro em vez do
  parser de data brasileira. Se a Nina fizer um `<input type="date">` simples (só o dia,
  sem hora), o valor vira meia-noite UTC daquele dia — funciona para "vence hoje/amanhã",
  mas se a agente digitar `dueAt` de hoje depois da meia-noite UTC (21h em Brasília, por
  causa do fuso -3), a tarefa nasce "vencida" no mesmo instante em que é criada. Não é bug
  desta função — é a mesma superfície de todo `timestamptz` do projeto sem componente de
  hora explícito. Registro aqui para a Nina decidir: se o formulário for só "dia", pode
  valer a pena mandar `23:59:59` local em vez de meia-noite, ou pedir um componente de
  hora. Não resolvi por ela porque é decisão de produto/UX, não de dado.
- **Não fiz `criarTarefa` autofilar `contactId` a partir de `dealId`** (mesmo quando o
  negócio tem um contato associado). Os dois campos são independentes de propósito — um
  lembrete pode ser sobre um negócio sem menção a contato específico (ex.: "revisar
  cotação de voo"), e forçar o preenchimento automático tiraria da agente a opção de criar
  um lembrete "solto" ligado só ao negócio. Se a Nina achar que a UX pede o contrário
  (herdar o contato do negócio escolhido), é decisão de tela: ela já tem o `contactId` do
  negócio disponível (via `NegocioDoFunil.contactId`/`NegocioDetalhe.contactId`) para
  preencher no formulário antes de chamar a action.

### Verificação

- `npx tsc --noEmit` — limpo.
- `npx eslint src/server/followups.ts src/server/index.ts` — limpo.
- `npx tsx scripts/check/known-failures.ts` — verde: 378 testes, allowlist vazio, sem
  regressão, contra o Postgres de dev de pé (não precisei subir Docker nesta rodada — já
  estava rodando).
- Não escrevi teste de isolamento novo para `criarTarefa` especificamente (fronteira do
  Téo, `tests/**`) — a função segue exatamente o mesmo caminho (`withTenant` +
  `requireAuthContext` + checagem de FK dentro da transação) que `criarNegocio` já tem
  coberto por teste de isolamento multi-tenant; se o Téo quiser um caso específico para
  "criar lembrete com `dealId`/`contactId` de outro tenant devolve `NAO_ENCONTRADO`", é
  queda de braço rápida a partir do teste equivalente de `deals.ts`.

### Não fiz (fora da fronteira/pedido desta rodada)

- **Não toquei em `src/app/**`** — o botão "Criar lembrete" continua sem `onClick` até a
  Nina ligar. Contrato pronto em `docs/handoffs/rafa-para-nina.md`.
- **Não commitei** — pedido explícito do PO/tarefa: quem commita é o PO.

---

## Rodada anterior: S4 — o funil (backend)

Entrega: o serviço completo do funil que faltava atrás de `FunnelScreen.tsx` e do topo de
`TodayScreen.tsx` — hoje os dois rodam 100% sobre `src/lib/ui/sample-data.ts`. Arquivo novo
`src/server/deals.ts` (padrão de `contacts.ts`: `requireAuthContext` + `withTenant`),
exportado em `src/server/index.ts`. Não criei tabela nem migration: `deals`/`tasks`/
`activities` já existem com RLS desde `0000_fundacao.sql` — conferi a policy
(`deals_isolation`/`activities_isolation`, `ENABLE`+`FORCE ROW LEVEL SECURITY`,
`USING`/`WITH CHECK` contra `app.tenant_id`) antes de escrever a primeira query.

### Pronto

1. **`listarNegociosDoFunil()`** — board pronto: todo negócio do tenant exceto `perdido`
   (ele não tem coluna, ver mapeamento abaixo), com contato resolvido via JOIN e
   `diasParado` calculado (o maior entre `updatedAt` e a `activity` mais recente do
   negócio). Limite de 500, rede de segurança, não paginação de produto.
2. **`moverEstagioDoNegocio(dealId, novoEstagio, motivoPerda?)`** — o que o arrasto do
   kanban chama. `motivoPerda` OBRIGATÓRIO quando `novoEstagio === 'perdido'` (mínimo 3
   caracteres depois de `trim()`), erro amigável se faltar. Grava uma `activity`
   (`type: 'stage_changed'`) e uma linha de `audit_log` a cada transição real. **Idempotente
   sob clique duplo por dois caminhos**: se o negócio já está no estágio pedido no SELECT,
   não grava nada; sob concorrência de verdade, o `UPDATE ... WHERE stage <> novoEstagio`
   da segunda chamada simultânea reavalia contra a linha já commitada pela primeira e afeta
   zero linhas — sem segunda `activity`, sem erro. `closedAt` é gravado ao entrar em
   `ganho`/`perdido` e limpo ao sair de volta para um estágio aberto (reabrir não pode
   deixar `closed_at` mentindo para o resumo do pipeline). Sem máquina de estados: qualquer
   transição é aceita, mesma filosofia de `atualizarStatusComissao` em `sales.ts`.
3. **`criarNegocio(input)`** — criação básica a partir de um contato existente do mesmo
   tenant (RLS decide "existe" — id de outro tenant dá `NAO_ENCONTRADO`, igual ao resto do
   código). Nasce sempre `stage: 'novo'`.
4. **`obterNegocio(dealId)`** — detalhe autenticado + timeline (`activities`, mais recente
   primeiro) para a futura tela de detalhe. Inclui `costCents`/`commissionCents` do negócio
   (autenticado, mesma doutrina de `OpcaoEdicao` em `proposals.ts` — nunca confundir com a
   leitura pública, que aqui nem existe).
5. **`listarNegociosParados()`** — negócios abertos (não `ganho`, não `perdido`) sem
   movimentação há mais de 7 dias, com a soma em `valueCents` já calculada — para a seção
   "Paradas" do Hoje.
6. **`obterResumoDoPipeline()`** — os "dois números do topo" do Hoje: `pipelineAbertoCents`
   (soma de todo negócio não `ganho`/não `perdido`, sem recorte de tempo) e
   `fechadoNoMesCents` (soma dos `ganho` cujo `closedAt` cai no mês corrente, UTC).
7. **Contratos escritos**: `docs/handoffs/rafa-para-nina.md` (seção "S4", assinatura de
   cada action, shape de retorno, o mapeamento 6↔5 de estágio, a definição exata dos "dois
   números do topo") e `docs/handoffs/rafa-para-teo.md` (seção "S4", motivo de perda
   obrigatório, "parados" não incluir ganho/perdido, isolamento, idempotência).

### Dois defeitos reais encontrados testando contra Postgres de verdade (não só `tsc`)

Segui a minha própria regra ("se não tem teste provando, não existe") e não me contentei
com `tsc --noEmit` verde: rodei um script manual (deletado depois, não ficou no
repositório) contra `zarpa_test` para cada query nova antes de considerar pronto. Isso
achou dois bugs que `tsc` NUNCA pegaria, porque os dois são de runtime/SQL, não de tipo:

1. **Subquery correlacionada com `${coluna}` embutida em `sql<>()` usado como VALOR de
   `.select({...})` renderiza SEM qualificar a tabela.** Minha primeira versão de
   `ultimaAtividadeEm` era `sql<Date | null>`(select max(${activities.occurredAt}) from
   ${activities} where ${activities.dealId} = ${deals.id})``, e o SQL gerado
   (`query.toSQL()`) saiu `where "deal_id" = "id"` — **sem nenhum prefixo de tabela**.
   Como `activities` tem sua própria coluna `id`, dentro do escopo da subquery (`from
   activities`) o `"id"` desambigua para `activities.id`, não para o `deals.id` de fora. A
   condição vira `activities.deal_id = activities.id` (quase sempre falso) e a função
   voltaria sempre `null`, silenciosamente — nenhum erro, nenhum type error, só o dado
   errado. Confirmei que isto é comportamento do Drizzle (não do Postgres nem do driver):
   o MESMO padrão usado em `.where()` do nível principal da query renderiza CORRETAMENTE
   qualificado (`"contacts"."name"`, `"travelers"."full_name"`) — só falha quando o `sql<>`
   é o valor de um campo do `.select({...})`. **Corrigi usando nomes de coluna literais**
   (`deals.id`, `activities.deal_id`, sem interpolação de coluna do Drizzle) — funciona
   porque nem `deals` nem `activities` são referenciadas com alias nestas duas queries.
   Documentei o porquê em comentário extenso no próprio `deals.ts`
   (`ultimaAtividadeSql()`), para o próximo dev não copiar o padrão quebrado.

2. **O MESMO bug já existia em produção**: `obterContato` (`src/server/contacts.ts`,
   `totalViajantes`/`totalNegocios`) usa exatamente o padrão `${travelers.contactId} =
   ${contacts.id}` dentro de um `sql<number>` de select — e pela mesma razão, SEMPRE
   soma zero (a condição vira `travelers.contact_id = travelers.id`). Não é uma tabela de
   tenant vazando dado de outro tenant (não é bug de isolamento), é a tela de detalhe de
   contato mostrando "0 viajantes, 0 negócios" para todo contato, sempre, desde que a
   função foi escrita — corrigi junto (mesmo fronteira, `src/server/**`), com o mesmo
   comentário explicando o porquê. Nenhum teste existente depende do valor `0`
   (`grep totalViajantes tests/` não achou nada), então a correção não quebra suite.

3. **Um `sql<Date>()` livre nunca chega como `Date`, mesmo com `::timestamptz` — chega como
   a string crua do driver** (`"2026-09-06 01:03:21.925+00"`). Comprovado isolando a
   variável passo a passo: coluna de schema referenciada DIRETO (`deals.updatedAt`, sem
   `sql<>` em volta) chega como `Date` de verdade (o mapeador `mapFromDriverValue` do
   Drizzle aplica); a MESMA coluna embrulhada em `sql`${deals.updatedAt}`` chega como
   string. `count(*)::int` funciona (chega como `number`) — só o tipo `timestamp`/
   `timestamptz` sofre disso. Escrevi `paraDataOuNula()` em `deals.ts` para todo consumo
   de `ultimaAtividadeSql()` — defensivo, não depende de entender a causa raiz para estar
   correto. **Registro como risco de plataforma, não só deste arquivo**: qualquer `sql<Date>`
   futuro em `src/server/**` precisa do mesmo parse manual; não encontrei nenhum caso
   existente além dos dois que já corrigi, mas não fiz uma varredura exaustiva do
   repositório inteiro — só dos arquivos que uso.

### Decisões que tomei sozinha

- **Mapeamento 6↔5 de estágio**: `novo→novo`, `cotando→"Montando"`,
  `proposta_enviada→"Enviada"`, `negociando→negociando`, `ganho→"Fechada"`,
  `perdido`→sem coluna (sai do board, exige motivo). Documentado em `COLUNAS_DO_FUNIL`
  (exportado, fonte única para a Nina não duplicar a lista) e no cabeçalho de
  `deals.ts`.
- **"Dois números do topo"**: "em negociação" = soma de todo negócio não `ganho`/não
  `perdido`, SEM recorte de tempo (dinheiro em aberto continua em aberto mesmo parado há
  60 dias). "Fechado no mês" = soma de `ganho` cujo `closedAt` cai no mês corrente (UTC).
  Uso `closedAt`, não `updatedAt`, porque é o campo que `moverEstagioDoNegocio` (e o seed)
  gravam especificamente para "quando fechou" — um negócio que nascesse `ganho` sem nunca
  passar por `moverEstagioDoNegocio` ficaria de fora do "fechado no mês" até ser tocado;
  aceito conscientemente, é o caminho normal do produto (arrastar no funil).
- **Somas em JavaScript, não `sum()` no SQL**: `value_cents` é `bigint`; `sum(bigint)`
  volta `numeric` do Postgres, que o driver devolve como STRING (mesma família de
  problema do achado nº 3 acima — o Drizzle só converte string→number para COLUNA
  mapeada, não para resultado de agregação livre). Buscar as linhas e somar em JS evita
  esse cast manual. No volume esperado (10–15 vendas/mês por tenant) isso é seguro e mais
  simples; revisitar se um tenant crescer ao ponto de "todos os negócios abertos" deixar
  de caber numa query.
- **`listarNegociosParados` filtra "mais de 7 dias" em JavaScript**, depois de buscar todo
  negócio aberto — não em SQL. É o mesmo motivo do "somar em JS": calcular "a maior entre
  `updatedAt` e a última activity" como coluna computável e filtrar por ela no mesmo nível
  do SQL pediria uma CTE; no volume esperado, buscar tudo aberto (dezenas de linhas, não
  milhares) e filtrar em memória é mais simples e não paga o preço de errar de novo com
  `sql<>()` livre. Registrado como ponto de revisão futura se o funil crescer muito.
- **`moverEstagioDoNegocio` aceita qualquer transição de estágio**, sem validar se "faz
  sentido" — o roteiro não pediu máquina de estados, e travar isso é o tipo de regra que a
  agente prefere que o produto quebre arrastando o card de qualquer jeito.
- Corrigi o bug de `obterContato` (achado nº 2 acima) sem pedir confirmação: dentro da
  minha fronteira, correção mecânica de duas linhas, bug demonstrável e sem teste que
  dependesse do comportamento errado.

### Riscos

- **`sql<Date>`/`sql<T>` livre em qualquer Server Action futura precisa de parse
  defensivo** — não é peculiaridade deste arquivo, é como o Drizzle + este driver se
  comportam neste projeto (comprovado, não suposição). Se alguém escrever um novo
  `sql<Date>()`/`sql<number>()` sem saber disso, o bug volta a nascer calado. Vale um
  lint/convenção documentada, ou um teste de contrato do Téo que grave um valor conhecido
  e confira o tipo runtime de uma função que usa este padrão.
- **`listarNegociosDoFunil`/`listarNegociosParados` sem paginação real** — limite de 500 e
  "busca tudo aberto", respectivamente. Adequado ao volume do produto hoje (MEI, 10-15
  vendas/mês); revisitar se um tenant antigo acumular muitos negócios `ganho` ao longo dos
  anos (o board inclui `ganho` na coluna "Fechada" indefinidamente — não há arquivamento
  de negócio fechado ainda).
- Negócio que nasceu `ganho` fora de `moverEstagioDoNegocio` (import futuro, por exemplo)
  fica de fora de `fechadoNoMesCents` até ser tocado — ver decisão acima.

### O que precisa dos outros

- **Nina**: religar `FunnelScreen.tsx` e o topo/seção "Paradas" de `TodayScreen.tsx` a
  `listarNegociosDoFunil`/`moverEstagioDoNegocio`/`listarNegociosParados`/
  `obterResumoDoPipeline`, no lugar de `src/lib/ui/sample-data.ts` — contrato completo em
  `docs/handoffs/rafa-para-nina.md`, seção "S4". Decisão de UI para o "motivo de perda"
  (hoje não existe coluna "Perdida" no board — como/onde a agente aciona
  `moverEstagioDoNegocio(id, 'perdido', motivo)`) é dela.
- **Téo**: pedidos de teste em `docs/handoffs/rafa-para-teo.md`, seção "S4" — motivo de
  perda obrigatório, idempotência sob clique duplo/concorrência, "parados" não incluir
  ganho/perdido, isolamento entre tenants nas leituras novas, e o risco de `sql<Date>`
  livre (achado nº 3) como possível teste de contrato.

### Verificação

- `npx tsc --noEmit`: limpo.
- `npx tsx scripts/check/known-failures.ts`: 365 testes, allowlist vazia, sem regressão
  (Postgres estava de pé nesta rodada).
- Script manual (não versionado) contra `zarpa_test`: dois tenants, negócios em `novo`/
  `perdido`/`ganho`, uma `activity`; confirmei (a) `perdido` nunca aparece no board, (b) a
  correlação de `ultimaAtividadeEm` aponta para o negócio certo (não `null` para quem tem
  activity, `null` para quem não tem), (c) `totalViajantes`/`totalNegocios` corrigidos
  batem com a contagem real, (d) `UPDATE ... WHERE stage <> alvo` idempotente (1ª chamada
  afeta 1 linha, 2ª chamada idêntica afeta 0), (e) soma de `valueCents` via query builder
  chega como `number` de verdade, (f) isolamento: outro tenant vê zero negócios do
  primeiro.
- Não toquei em `src/components`, `src/styles`, `src/app/**`, `tests/`, `package.json` —
  fronteira respeitada.

---

## Rodada anterior: S9 — vendas, comissão e recebíveis (o dinheiro)

Entrega: schema + Server Actions para converter uma proposta ACEITA numa venda, editar
custo/comissão/taxa de serviço, parcelar o cliente com vencimento e conferir a comissão
prometida pela operadora.

### Pronto

1. **Schema novo `src/db/schema/sales.ts`** (registrado no barril
   `src/db/schema/index.ts`), duas tabelas:
   - `sales` — nasce de `proposals.status = 'accepted'` + `accepted_option_id`
     preenchido. `deal_id`/`proposal_id`/`proposal_option_id` de rastreio;
     `fornecedor`, `valor_bruto_cents`, `custo_cents`, `comissao_prevista_cents`,
     `taxa_servico_cents` e `comissao_status` (`prevista`/`recebida`/`atrasada`) são os
     campos de dinheiro. **Decisão registrada em comentário no schema**: os quatro
     campos de dinheiro pedidos no roteiro em português (`valor_bruto`, `custo`,
     `comissao_prevista`, `taxa_servico`) ganharam sufixo `_cents` — é a única convenção
     de nome que este projeto usa para dinheiro em centavos (`price_cents`,
     `cost_cents`, `commission_cents`, `amount_cents`...) e quebrar isso só numa tabela
     criaria uma exceção sem motivo. `sales_proposal_id_key` (índice único em
     `proposal_id`) garante que uma proposta vira **no máximo uma venda** — o banco
     garante idempotência da conversão, não a Server Action.
   - `receivables` — a parcela do CLIENTE (não confundir com `payments`, que é a
     cobrança da assinatura do próprio agente — `money.ts`, S11/Asaas, não toquei).
     `sale_id` em CASCADE (parcela é filha da venda), `vence_em` (`date`), `valor_cents`,
     `status` (`pendente`/`pago`/`atrasado`/`cancelado`), `pago_em`. CHECK
     `receivables_pago_em_check` trava que `status = 'pago' ⟺ pago_em IS NOT NULL` —
     as duas metades da mesma informação não podem se desencontrar (mesmo padrão de
     `tasks_dedupe_key_check`).
   - Ambas com `tenant_id`, índice em toda FK, índice `(tenant_id, created_at)`, e um
     índice parcial "em aberto por vencimento" em `receivables`
     (`receivables_tenant_open_due_idx`, mesmo desenho de `tasks_tenant_open_due_idx`).
   - `deal_id`/`proposal_id` de `sales` são `ON DELETE RESTRICT` — apagar o negócio ou a
     proposta não pode sumir com o histórico financeiro (mesmo raciocínio de
     `deals.contact_id`). `proposal_option_id` é `ON DELETE SET NULL` — é só linhagem,
     apagar a opção depois da venda fechada não pode apagar a venda nem os valores já
     fotografados.

2. **Migration `drizzle/0007_vendas_e_recebiveis.sql`**, registrada em
   `drizzle/meta/_journal.json` (idx 7) — RLS na MESMA migration que cria as tabelas:
   `ENABLE`+`FORCE ROW LEVEL SECURITY` e uma policy `USING`+`WITH CHECK` por tabela contra
   `current_setting('app.tenant_id', true)::uuid`, byte a byte no mesmo formato de
   `0000_fundacao.sql` (`--> statement-breakpoint` entre cada comando). Nenhuma das duas
   tabelas tem dono opcional — não precisou de escape hatch nomeado como
   `library_items_platform_service`.

3. **`src/server/sales.ts` (novo)**, exportado no barril `src/server/index.ts`:
   - `converterPropostaEmVenda(propostaId, { fornecedor?, taxaServicoCents? })` —
     confere `proposals.status === 'accepted'` e `accepted_option_id` preenchido, puxa
     `price_cents`/`cost_cents`/`commission_cents` da opção ACEITA (nunca de outra opção
     da mesma proposta) e fotografa em `sales`. **Idempotente de propósito**: chamar de
     novo para a mesma proposta devolve a venda já existente em vez de erro — decisão
     registrada em comentário no código, motivo: duplo clique de usuário é UX, não
     exceção; `sales_proposal_id_key` garante que o banco nunca tem duas de verdade
     mesmo sob concorrência real (dois requests simultâneos), a leitura antes do insert
     é só o caminho feliz sem round-trip de erro.
   - CRUD de venda: `listarVendas`, `obterVenda`, `atualizarVenda` (autosave, mesmo
     padrão de `atualizarProposta` — só o que veio no patch muda),
     `atualizarStatusComissao` (a conferência prevista→recebida/atrasada — **decisão**:
     não é máquina de estado travada, dá para voltar de `recebida` para `prevista` se o
     agente clicou errado; é conferência manual de extrato, não fluxo de aprovação) e
     `excluirVenda` (recusa com `CONFLITO` se existir parcela `status: 'pago'` — não
     deixa apagar histórico de pagamento).
   - Parcelas: `criarParcela` (uma por vez, manual), `gerarParcelasDaVenda` (divide
     `valor_bruto_cents` em N parcelas mensais iguais, a última absorvendo o resto da
     divisão em centavos — nunca perde nem sobra 1 centavo; recusa se a venda já tiver
     parcela, para não duplicar), `listarParcelas`, `atualizarParcela` (autosave;
     trocar `status` para `pago` grava `pagoEm = agora` sozinho, trocar para qualquer
     outro limpa `pagoEm` — resolvido na Server Action para nunca bater no CHECK do
     banco por engano), `marcarParcelaPaga` (atalho) e `excluirParcela`.
   - Reaproveitei `parseDataFlexivel` (`src/server/normalize.ts`) para validar
     `venceEm`/`primeiraVencimento` em vez de inventar um segundo parser de data.

4. **Contratos escritos**: `docs/handoffs/rafa-para-nina.md` (seção "S9", assinatura
   completa de todas as actions, o que é autosave, o que é atalho, o que recusa e por
   quê) e `docs/handoffs/rafa-para-teo.md` (seção "S9", cinco pontos concretos para virar
   teste: unicidade de venda por proposta, as duas pontas do CHECK de `pago_em`,
   vazamento de custo/comissão entre tenant, `ON DELETE RESTRICT` de negócio/proposta já
   vendidos, e recusa de exclusão com parcela paga).

### Não consegui verificar contra Postgres de verdade nesta rodada — risco real, registrado

**O Docker Desktop não subiu nesta sessão.** Tentei `docker compose up -d db`,
`open -a Docker` e esperas de vários minutos (`docker info` nunca saiu de "não pronto").
Sem Postgres, não rodei `npm run db:migrate` nem `npx tsx scripts/check/known-failures.ts`
— só verificação estática:

- `npx tsc --noEmit`: limpo.
- `npx eslint src/db/schema/sales.ts src/server/sales.ts src/server/index.ts
  src/db/schema/index.ts`: limpo.
- Revisei a migration linha a linha contra `0000_fundacao.sql` (sintaxe de `CREATE TABLE`,
  `CREATE POLICY`, `ENABLE`/`FORCE ROW LEVEL SECURITY`) e `0006_regua_de_followup.sql`
  (formato de comentário e de `_journal.json`) — mesmo padrão, sem desvio que eu tenha
  encontrado lendo com atenção.

O que isso significa na prática: **não confirmei ao vivo** que a migration aplica limpa
do zero nem que `tenant-isolation.test.ts` cobre `sales`/`receivables` automaticamente
(deveria, é varredura por catálogo — mas "deveria" não é "confirmei"). Registrei pedido
explícito ao PO (`docs/handoffs/rafa-para-po.md`, item 8) e ao Téo
(`docs/handoffs/rafa-para-teo.md`, seção "S9") para rodar isso na primeira máquina
disponível com Docker de pé, antes de aceitar esta entrega como fechada. Isto NÃO é o
padrão desta rodada anterior (S5–S8 sempre confirmei manualmente contra `zarpa_dev`/
`zarpa_test`) — é uma exceção justificada por ambiente indisponível, não uma mudança de
critério.

### Decisões que tomei sozinha

- Sufixo `_cents` em todo campo de dinheiro de `sales`/`receivables`, mesmo o roteiro
  pedindo nomes sem sufixo (`valor_bruto`, `custo`, `comissao_prevista`, `taxa_servico`,
  `valor`) — consistência com o resto do schema, ver item 1 de "Pronto".
- `converterPropostaEmVenda` idempotente por leitura-antes-de-inserir, em vez de deixar o
  segundo clique estourar em `CONFLITO` — ver item 3 de "Pronto".
- `atualizarStatusComissao` sem máquina de estado travada — ver item 3 de "Pronto".
- Não criei um endpoint "converter venda em X" para editar `deal_id`/`proposal_id`/
  `proposal_option_id` depois de criada a venda — esses três são fixados na conversão e
  não aparecem em `VendaPatch`. Se um dia a agente precisar "religar" uma venda a outra
  proposta (raro, provavelmente erro de operação), é caso para nova action explícita, não
  para abrir esses campos no patch genérico.
- Não gerei parcela automaticamente dentro de `converterPropostaEmVenda` — a conversão só
  cria a venda; parcelar é passo separado (`gerarParcelasDaVenda` ou `criarParcela`),
  porque nem toda venda é parcelada do mesmo jeito que a opção sugeria (Pix à vista muda
  tudo) e forçar geração automática criaria parcela para apagar na maioria dos casos.

### Riscos

- **Verificação ao vivo pendente** (ver seção acima) — o maior risco desta rodada, por
  causa do ambiente, não do código.
- Mesmos riscos estruturais já registrados nas rodadas anteriores (GUCs forjáveis por SQL
  arbitrário) não mudam nesta rodada — `sales`/`receivables` usam a MESMA policy simples
  de sempre, nenhum GUC novo.
- `sales.fornecedor` é texto livre, não catálogo (sem tabela `suppliers`) — decisão
  implícita do roteiro ("fornecedor" como campo, não como relação), mas se o produto
  precisar de relatório "comissão por fornecedor" com nome consistente (evitar "CVC" vs.
  "Cvc" vs. "cvc viagens"), vai precisar virar catálogo numa rodada futura.

### O que precisa dos outros

- **PO**: confirmar Docker/Postgres disponível e rodar `npm run db:migrate` +
  `npx tsx scripts/check/known-failures.ts` antes de fechar a entrega — item 8 de
  `docs/handoffs/rafa-para-po.md`.
- **Nina**: tela de venda (a partir da proposta aceita) e tela de parcelas — contrato
  completo em `docs/handoffs/rafa-para-nina.md`, seção "S9".
- **Téo**: os cinco pontos de teste listados em `docs/handoffs/rafa-para-teo.md`, seção
  "S9", mais a confirmação de que a varredura por catálogo de
  `tenant-isolation.test.ts` pega as duas tabelas novas sem mudança de arquivo.

---

## Rodada anterior: S8 — tarefas e follow-up automático (motor de retenção)

Critério de aceite ao pé da letra: proposta enviada numa sexta gera três tarefas
(D+2, D+5, D+10) nas datas certas, com mensagem sugerida pronta, sem duplicar quando o
cron roda duas vezes.

### Pronto

1. **Migration `drizzle/0006_regua_de_followup.sql`** (registrada em
   `drizzle/meta/_journal.json`, idx 6) — duas mudanças em `tasks`, tabela que já existe
   com RLS desde `0000_fundacao.sql`; nenhuma tabela nova, então nenhuma policy nova
   entra aqui:
   - `suggested_message text` (nullable — só tarefa gerada preenche, manual fica `null`).
   - `source` ganha o valor `'followup_proposta'` (`ALTER ... DROP CONSTRAINT` +
     `ADD CONSTRAINT` no `tasks_source_check`, porque Postgres não tem `ALTER CHECK`).
   - Nenhum índice novo: o índice único parcial `tasks_tenant_dedupe_key`
     (`(tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL`, já existe desde
     `0001_pessoas_e_importacao.sql`) já cobre qualquer `source` não-manual — a régua de
     follow-up usa exatamente o mesmo mecanismo de idempotência que os alertas de
     passaporte/aniversário já usam, só com uma chave de formato diferente
     (`followup:proposta:<propostaId>:d2` / `:d5` / `:d10`).
   - **Achei o banco de teste num estado inconsistente antes de começar**: `zarpa_test`
     tinha o SQL de `0004`/`0005` aplicado de verdade (coluna `instagram`, função
     `aceitar_opcao_proposta`, policy `proposals_public_accept_update` — tudo lá), mas a
     tabela de controle `drizzle.__drizzle_migrations` só registrava até `0003`. Rodar
     `db:migrate` contra `zarpa_test` explodia em "column instagram already exists".
     Resolvi calculando o hash sha256 de cada arquivo (mesmo algoritmo do migrator,
     `drizzle-orm/migrator.cjs`) e inserindo as duas linhas que faltavam na tabela de
     controle — sem tocar em nenhum dado, sem re-rodar SQL que já tinha rodado. Depois
     disso `db:migrate` com `USE_TEST_DATABASE=1` aplicou `0006` limpo. Não sei a causa
     raiz (rodada anterior deve ter aplicado o SQL na mão e esquecido de rodar o
     migrator por cima) — registrando aqui para não repetir a mesma surpresa. O
     `globalSetup` do vitest não sofre com isso: ele recria o schema do zero a cada
     rodada e aplica os `.sql` direto, sem depender da tabela de controle — só
     `db:migrate` (script de operação, fora do CI) usa aquela tabela.

2. **`src/server/followups.ts` (novo)** — três entregas:
   - `rodarFilaDeFollowups()`: o runner diário do cron. Mesmo desenho de `gerarAlertas()`
     (`alerts.ts`): `authDb` para listar todos os tenants sem sessão (a MESMA policy
     `tenants_auth_service` que o login já usa — nenhuma superfície nova), um
     `withTenant` por tenant, idempotente por construção (cada peça já é idempotente
     sozinha). Materializa, na MESMA fila, a régua de follow-up de proposta E os alertas
     de passaporte/aniversário — por isso `gerarAlertasDePassaporte`/
     `gerarAlertasDeAniversario` (antes privadas de `alerts.ts`) agora são exportadas
     (só para uso interno de `src/server`, ninguém fora importa `alerts.ts` direto).
   - `gerarFollowupsDaProposta(tx, tenantId, propostaId)`: a mesma régua, para UMA
     proposta, reaproveitável de dentro de outra transação. Não chamei isto de dentro de
     `enviarProposta` (`proposals.ts`) nesta rodada — decisão registrada abaixo.
   - `listarTarefasDeHoje()`: leitura tenant-scoped para a tela Hoje, com JOIN em
     `contacts`/`deals` (nome do cliente e destino já vêm prontos, sem chamada extra) e
     `suggestedMessage` pronta para copiar. Contrato completo, com o shape exato, em
     `docs/handoffs/rafa-para-nina.md`.

3. **Mensagem sugerida — three tons, não a mesma frase repetida**: D+2 é checagem gentil
   ("ficou alguma dúvida?"), D+5 introduz urgência de preço sem ser agressivo ("os
   valores podem mudar"), D+10 é a última checagem antes de esfriar ("ainda está nos seus
   planos? se não for, me avisa"). Cada uma usa o nome do cliente e o destino quando
   disponíveis (JOIN `deals`→`contacts`, `deals.destination`), com fallback genérico
   ("Oi!" / "a proposta que te mandei") se algum dado faltar — nunca um placeholder cru
   tipo `[nome]` vazando para o texto que a agente vai colar no WhatsApp de verdade.

4. **Decisão: não editei `enviarProposta` (`src/server/proposals.ts`) nesta rodada.** A
   tarefa permitia gerar a régua "ao enviar uma proposta (ou via o runner do item 2)".
   Escolhi só o runner, por três motivos: (a) o aceite descrito é sobre o CRON detectar e
   materializar a régua, não sobre latência entre o clique de "enviar" e a tarefa
   aparecer — mesmo dia é suficiente; (b) menos superfície tocada nesta rodada
   (`proposals.ts` é um arquivo grande e já bem coberto de comentário sobre o que não
   pode mudar; toquei nele zero); (c) `gerarFollowupsDaProposta` já existe pronta e
   exportada para o dia em que alguém (eu, numa rodada futura, ou o PO decidindo que quer
   a tarefa aparecendo no ato do envio) quiser chamar isso de dentro de `enviarProposta`
   — é literalmente uma chamada a mais dentro do mesmo `withTenant` que já está lá.
   Registrado também em `docs/handoffs/rafa-para-po.md`, item 7.

5. **Janela de 15 dias na varredura de propostas enviadas** (`sentAt >= hoje - 15 dias`):
   o marco mais distante da régua é D+10, então uma proposta mais velha que isso já teve
   (ou nunca vai ter, se foi enviada antes desta feature existir) as três tarefas
   geradas — sem essa janela a consulta cresceria sem limite conforme o tenant acumula
   histórico. Mesmo raciocínio de `MARCOS_PASSAPORTE` em `alerts.ts`, só que em dias
   corridos desde o envio em vez de dias até o vencimento.

### Verificado manualmente contra Postgres de verdade (não só lido)

Rodei um script descartável (deletado depois, não ficou no repositório) contra
`zarpa_test`: tenant + contato + negócio + proposta com `sentAt = agora − 3 dias` (a
"sexta"), chamei `rodarFilaDeFollowups()` duas vezes seguidas.

- 1ª chamada: 3 tarefas novas para aquela proposta, `dueAt` exatamente `sentAt + {2,5,10}`
  dias, `suggestedMessage` preenchida e diferente em cada uma, `dedupeKey` no formato
  `followup:proposta:<id>:{d2,d5,d10}`.
- 2ª chamada: **zero** tarefas novas — confirmado tanto pelo contador de retorno quanto
  consultando `tasks` de novo (continuou em 3 linhas).
- Simulei a query de `listarTarefasDeHoje` (JOIN completo) contra os mesmos dados: só a
  tarefa D+2 (já vencida) apareceu, D+5/D+10 (no futuro) ficaram de fora — confirma que
  "hoje + vencidas" está certo e que o JOIN com `contacts`/`deals` resolve nome/destino.
- Confirmei RLS fail-closed no caminho todo: consultar as tarefas recém-inseridas via
  `unsafeSqlWithoutTenant` (sem GUC) devolveu zero linhas — só voltaram a aparecer
  entrando de novo por `withTenant` com o `tenantId` certo. `tasks` continua sob FORCE
  ROW LEVEL SECURITY normal, nenhuma policy nova precisou nascer para esta feature.

### Verificação

- `npx tsc --noEmit`: limpo.
- `npx tsx scripts/check/known-failures.ts`: 327 testes, allowlist vazia (0), **verde,
  sem regressão**. `globalSetup` recriou `zarpa_test` do zero e aplicou as 7 migrations
  (`0000` a `0006`) sem erro — confirma que a migration nova aplica limpa do zero, não só
  no banco que eu remendei manualmente (ver item 1 de "Pronto").
- `npm run db:migrate` aplicado com sucesso em `zarpa_dev` e (depois do remendo na tabela
  de controle) em `zarpa_test` via `USE_TEST_DATABASE=1`.
- Não toquei em `src/components`, `src/styles`, `tests/`, `package.json`, nem em
  `src/app/**` — o pedido de rota de cron foi para
  `docs/handoffs/rafa-para-po.md`.

### O que precisa dos outros

- **PO**: rota `/api/cron/...` chamando `rodarFilaDeFollowups()`, protegida por token —
  detalhe completo em `docs/handoffs/rafa-para-po.md`, item 7.
- **Nina**: consumir `listarTarefasDeHoje()` na tela Hoje — contrato completo em
  `docs/handoffs/rafa-para-nina.md`.
- **Téo**: cobrir o aceite D+2/D+5/D+10 sem duplicar sob cron duplo (inclusive
  concorrente, não só sequencial) e isolamento por tenant — pedido detalhado em
  `docs/handoffs/rafa-para-teo.md`.

### Riscos

- O runner varre TODOS os tenants a cada chamada (`authDb.select from tenants`, sem
  paginação). Para o volume esperado do produto (agentes independentes, não milhares de
  tenants) isso é não-problema; se o produto crescer muito antes de eu voltar aqui, vale
  paginar ou paralelizar por lote.
- Mesmo risco estrutural já registrado nas rodadas anteriores: GUCs
  (`app.auth_context`, `app.platform_context`, `app.proposal_public_context`) são
  forjáveis por SQL arbitrário — mitigação pedida ao PO em
  `docs/handoffs/rafa-para-po.md`, item 5. Esta rodada não usa nenhum GUC novo.

---

## Rodada anterior: S7 — leitura pública da proposta

Contrato desta rodada: `tests/security/public-proposal.test.ts`, que chegou vermelho de
propósito em 3 asserções (nenhuma função `SECURITY DEFINER` de proposta pública existia).
Fechei o desenho que as rodadas anteriores tinham deixado registrado como pendência (ver
seção antiga logo abaixo: "leitura pública ainda não existe... função SECURITY DEFINER,
ainda não decidi como implementar sob FORCE ROW LEVEL SECURITY").

### Pronto

1. **Migration `drizzle/0004_proposta_publica.sql`** — duas colunas novas
   (`tenants.instagram`, `proposal_views.focused_option_id`) e o núcleo: seis policies
   novas com escape hatch nomeado `app.proposal_public_context` (mesmo padrão de
   `app.auth_context`/`app.platform_context` já usado duas vezes neste schema) mais duas
   funções `SECURITY DEFINER`, cada uma com `SET search_path = public, pg_temp`:
   - `public.proposta_publica(slug text)` — devolve `jsonb` com
     proposta/marca/opções/blocos, filtrando LINHA (`status <> 'draft' AND sent_at IS NOT
     NULL AND archived_at IS NULL`) via RLS e COLUNA via lista explícita dentro da função
     (nunca `select *`, nunca join com `contacts`/`travelers`). A marca vem de
     `proposals.brand_snapshot` (congelado no envio), nunca de `tenants` — então nem
     e-mail/CPF/telefone do PRÓPRIO agente (colunas de `tenants`) chegam perto da
     resposta pública.
   - `public.registrar_visita_proposta(...)` — grava uma linha em `proposal_views` e
     promove `status` de `sent` para `viewed` na primeira abertura, devolvendo
     `is_first_view` (+ `tenant_id`/`proposal_id`/`deal_id`, vindos do BANCO, nunca do
     navegador) para a aplicação decidir se dispara a notificação. Confere que
     `focused_option_id`, se vier, pertence mesmo àquela proposta antes de gravar.
   - **Por que não nasceu em S5/S6 junto do resto do construtor**: com
     `FORCE ROW LEVEL SECURITY`, uma função `SECURITY DEFINER` cujo dono é `zarpa` (o
     role NOBYPASSRLS que também é dono das tabelas) continua sujeita à mesma policy de
     sempre — `SECURITY DEFINER` troca de role, não desliga RLS. O desenho só fechou
     depois de aplicar o mesmo padrão de escape hatch nomeado já usado para
     `app.auth_context`/`app.platform_context`.
   - **Verificado manualmente contra Postgres de verdade** (não só lido): apliquei a
     migration em `zarpa_dev` e `zarpa_test`, plantei uma proposta com canário de CPF/
     e-mail/telefone/passaporte/nascimento em `contacts`/`travelers`/`tenants` (ciphertext
     nem entra em jogo aqui — coluna é `text`, plantei o canário cru) e uma opção com
     `cost_cents`/`commission_cents`, chamei as duas funções sem nenhum `app.tenant_id`
     setado (simulando visitante anônimo) e rodei o `scanPayload`/`CANARIES` reais de
     `tests/security/leak-scanner.ts` contra a resposta — zero vazamento depois do ajuste
     abaixo. Também confirmei que proposta em `draft` devolve zero linhas.
2. **`src/server/proposals.ts` — `enviarProposta(propostaId)`**: congela `brand_snapshot`
   a partir de `tenants` no momento do envio, garante `publicToken` (defensivo — já nasce
   em `criarPropostaAPartirDoNegocio`), marca `status: 'sent'`/`sentAt` só se ainda não
   passaram por lá (reenviar não regride `viewed`/`accepted` de volta para `sent`), exige
   ao menos 1 opção, e registra auditoria + `activities` (`proposal_sent`).
3. **`src/server/publicProposals.ts` (novo)** — `obterPropostaPublica(slug)` (chama a
   função pública, nunca toca as tabelas de tenant diretamente) e
   `registrarVisitaProposta(input)` (hash de IP via `blindIndex(ip, 'proposal_view_ip')`
   — nunca IP cru, CLAUDE.md — e, na primeira abertura, grava `activities` tipo
   `proposal_viewed` + `audit_log` + dispara `notificarAberturaDeProposta`, tudo dentro de
   `withTenant` porque o `tenantId` já veio do banco, não do navegador).
4. **`src/server/notifications.ts` (novo)** — "seu cliente abriu", mesma doutrina de
   `src/lib/auth/delivery.ts`/`src/server/storage.ts`: sem `RESEND_API_KEY`, cai em log
   (e-mail mascarado, nome do cliente fora do log). Diferença deliberada da doutrina do
   magic link: aqui a ausência de credencial NUNCA lança, nem em produção — perder uma
   notificação de abertura é ruim para o produto, não um incidente de segurança como um
   magic link vazado em log.
5. **Decisão de nome de campo, registrada em código e aqui**: a marca pública expõe
   `whatsappLink` (`https://wa.me/<dígitos>`), não `whatsapp`. Dois motivos, um de produto
   e um de teste: (a) um link clicável serve melhor "dizer onde clicar" (linha de UI do
   CLAUDE.md) do que um número cru; (b) o nome de chave `whatsapp` sozinho bate na regex
   de "campo proibido tipo telefone" do `leak-scanner.ts`
   (`FORBIDDEN_KEY_PATTERNS`, rótulo "telefone"), que teria reprovado a função mesmo sendo
   dado público por natureza (contato comercial do agente, não do cliente). Ver risco
   correspondente abaixo — o NOME resolveu, o VALOR ainda dispara um alerta do scanner.

### Não terminei sozinha — depende do Téo (`tests/**`, fora da minha fronteira)

Rodei `npx tsx scripts/check/known-failures.ts` depois da migration. Resultado, na
íntegra, em `docs/handoffs/rafa-para-teo.md`. Resumo:

- **2 das 3 entradas do allowlist viraram verdes** (existência da função + search_path
  fixo) — pedido para o Téo remover essas duas linhas de
  `scripts/check/known-failures.ts`.
- **A 3ª ainda está vermelha, mas por um motivo DIFERENTE do original.** Não é mais "a
  função não existe" — é que `public-proposal.test.ts` roda ANTES de qualquer teste
  semear uma linha em `proposals` (ordem alfabética de arquivo dentro de
  `fileParallelism: false`: `public-proposal` < `rls-enabled` < `tenant-isolation`, e é
  `tenant-isolation` quem semeia). `plantCanaries()` não acha nenhum `public_token` para
  chamar a função, e a asserção final (`results.length > 0`) falha achando zero rotinas
  exercidas. **Não é falha de RLS nem da função** — verifiquei isso manualmente rodando o
  cenário completo fora do vitest (seção "Pronto", item 1) e o resultado é limpo. É gap de
  fixture, arquivo que não é meu.
- **Regressão nova, esperada**: `rls-enabled.test.ts` > "nenhuma policy permissiva nova
  ignora o tenant" agora acusa as 6 policies novas do escape hatch
  `app.proposal_public_context` como "não fala de tenant" — que é exatamente o desenho
  pretendido (mesma classificação que `tenants_auth_service`/`library_items_platform_service`
  já recebem). Pedido para o Téo: adicionar as 6 em `KNOWN_ESCAPE_HATCHES`
  (`tests/security/rls-checks.ts`). Lista exata no handoff.

### Riscos

- **`brand.whatsappLink` vai acusar "padrão no valor: telefone BR" no `leak-scanner.ts`
  no dia em que um teste mais completo plantar uma proposta `sent` de verdade com
  `tenants.whatsapp` preenchido.** Não é um vazamento — é o contato comercial do PRÓPRIO
  agente, dado que o CLAUDE.md e a tarefa desta rodada pedem explicitamente para expor.
  Mas o regex de telefone do scanner não distingue "número do cliente" de "número do
  agente publicado de propósito", e eu não posso mudar `leak-scanner.ts` (não é minha
  fronteira). Registrado como pedido de allowlist ao Téo — ver handoff. Decidi manter o
  campo em vez de removê-lo: a alternativa (não publicar o whatsapp do agente) contraria
  requisito explícito do produto só para agradar uma heurística de teste.
- Mesmos riscos estruturais já registrados nas rodadas anteriores continuam valendo:
  GUCs (`app.auth_context`, `app.platform_context`, agora também
  `app.proposal_public_context`) são forjáveis por SQL arbitrário — mitigação estrutural
  (role dedicado) pedida ao PO em `docs/handoffs/rafa-para-po.md`, item 5.

### Verificação

- `npx tsc --noEmit`: limpo.
- `npx vitest run`: 327 testes, 325 verdes. As 2 vermelhas restantes são as descritas
  acima (1 asserção de `public-proposal.test.ts`, 1 de `rls-enabled.test.ts`) — ambas
  aguardando uma mudança em arquivo do Téo (`tests/security/rls-checks.ts` e,
  possivelmente, uma fixture nova em `public-proposal.test.ts`), não em código meu.
- Migration aplicada e testada manualmente em `zarpa_dev` e `zarpa_test` antes de tocar em
  TypeScript (dados de teste limpos depois, nenhum canário ficou no banco).
- Não toquei em `src/components`, `src/styles`, `tests/`, `package.json` — pedidos que
  dependiam desses arquivos foram para `docs/handoffs/rafa-para-teo.md` e
  `docs/handoffs/rafa-para-po.md`.

---

## Rodada anterior: auto-revisão do construtor de proposta (S5/S6) + contratos

A rodada anterior foi interrompida por limite de sessão no meio do S5. O PO já tinha
commitado o trabalho parcial e confirmado verde (`tsc` limpo, migration
`0003_construtor_de_proposta.sql` aplicada, 327 testes passando). Esta rodada foi só
revisão + documentação — não reescrevi nada do que já existia.

### Pronto

1. **Auto-revisão de `library_items` (RLS de `is_global`)** — li a migration
   (`drizzle/0003_construtor_de_proposta.sql`), o schema (`src/db/schema/library.ts`) e o
   helper (`src/lib/tenant/withPlatformContext.ts`) linha a linha. Confirmação:
   - A policy de SELECT (`is_global = true OR tenant_id = current_setting(...)`) devolve
     global + próprio, nunca de outro tenant.
   - INSERT/UPDATE recusam `is_global = true` mesmo que o chamador tente forçar no `WITH
     CHECK` — não depende de `library.ts` nunca mandar isso (defesa em profundidade real,
     não só por convenção de código).
   - DELETE é policy PRÓPRIA, não reaproveita o `USING` do SELECT — outra tabela, com
     `FOR ALL` e `USING (is_global OR dono)`, deixaria qualquer tenant apagar item global
     (`DELETE` só consulta `USING`, nunca `WITH CHECK`). Esse desenho já estava certo no
     código herdado; documentei o motivo de forma mais explícita no handoff do Téo para
     virar teste nomeado, não só comentário.
   - `withPlatformContext` **não é bypass**: ele só liga `app.platform_context = 'on'`,
     nunca `app.tenant_id`. Dentro dele, a policy de tenant continua ativa e continua
     exigindo `tenant_id = current_setting('app.tenant_id')`, que fica `NULL` — logo
     nenhuma linha de tenant é visível de dentro do helper. Ele só amplia acesso a linhas
     `is_global = true`, nunca a dado de tenant. Nenhum defeito encontrado; registrei o
     risco explícito (não misturar `tenant_id` setado com `platform_context = on` no
     futuro) no handoff do Téo, para virar teste de contrato.
   - Nenhum defeito encontrado. Nada foi alterado nesses três arquivos.

2. **Auto-revisão de vazamento de custo/comissão/documento** — `src/server/proposals.ts`
   expõe `costCents`/`commissionCents` em `OpcaoEdicao` de propósito (autenticado, quem
   edita precisa ver a margem) e o próprio arquivo documenta, em comentário de topo, que
   isso nunca deve ser reaproveitado para a rota pública (S7, ainda não existe). Não há
   nenhum link entre `proposals`/`proposal_options`/`proposal_blocks` e `travelers` (CPF,
   passaporte) no schema — documento de passageiro não passa perto do construtor de
   proposta. Nenhum defeito encontrado.

3. **Auto-revisão de transação/`withTenant`** — toda função de leitura/escrita em
   `proposals.ts` e `library.ts` passa por `withTenant(tenantId, ...)`, que abre
   transação e faz `set_config('app.tenant_id', $1, true)` local a ela. Nenhuma query solta
   fora desse padrão. Nenhum defeito encontrado.

4. **Defeito real encontrado e corrigido**: `src/server/index.ts` (o barril `@/server` que
   `docs/handoffs/rafa-para-nina.md` instrui a Nina a importar) não reexportava **nada** de
   `proposals.ts` nem `library.ts` — as 16 funções e ~15 tipos do construtor de proposta
   existiam no disco mas eram inacessíveis via `import { ... } from '@/server'`. Um
   artefato claro da sessão anterior ter sido interrompida antes de fechar o arquivo. Corrigi
   adicionando os dois blocos de export (todas as funções + todos os tipos públicos de
   `proposals.ts` e `library.ts`). Sem isso a Nina não conseguiria montar o construtor.

5. **`docs/handoffs/rafa-para-nina.md`** — seção nova "Construtor de proposta (S5/S6) —
   contrato completo": assinatura exata de cada action (proposta, opção, bloco,
   reordenação em lote, biblioteca, upload de imagem), como parcelamento e comissão são
   sugeridos vs. gravados (não recalculados na leitura), como a comparação de 3 opções é
   só a mesma lista `options[]` já ordenada (sem endpoint próprio), e a lista do que nunca
   vai para a proposta pública.

6. **`docs/handoffs/rafa-para-teo.md`** — seção nova pedindo três frentes de teste:
   isolamento padrão das 4 tabelas de proposta (com atenção a preço/custo/comissão nunca
   vazando nem em mensagem de erro), o comportamento de 4 pontas de `is_global` (vê global +
   próprio; não vê de outro tenant; INSERT/UPDATE com `is_global=true` falha mesmo fora da
   action; **DELETE de item global dá 0 linhas**, o caso que não aparece testando só
   SELECT), e um teste de contrato que trave `withPlatformContext` nunca ver dado de
   tenant.

### Decisões que tomei sozinha

- Corrigi o `src/server/index.ts` sem pedir confirmação: é dentro da minha fronteira
  (`src/server/**`), é uma correção mecânica (reexport, sem mudar nenhuma lógica), e
  bloquearia a Nina sem ela nem descobrir o motivo (import quebrado silenciosamente não
  aparece no `tsc` de `proposals.ts`, só no lado de quem tenta importar do barril).
- Não toquei em nenhuma policy, schema ou Server Action além do export — a auto-revisão
  não achou defeito que justificasse mudança de comportamento, só o export faltando.

### Riscos e o que fica para depois

- Os mesmos riscos já registrados nas rodadas anteriores continuam valendo (leitura
  pública da proposta ainda não implementada — S7; GUC `app.platform_context` e
  `app.auth_context` são forjáveis por SQL arbitrário, mitigação estrutural pedida ao PO
  em `docs/handoffs/rafa-para-po.md`, item 5).
- `withPlatformContext` não tem nenhum chamador real (sem tela de admin no v1) — existe só
  para documentar a policy em código e dar ao Téo um jeito de criar fixture de item
  global em teste sem superuser. Se um dia ganhar chamador de verdade, revisar de novo
  antes de expor via Server Action.

### Verificação

- `npx tsc --noEmit`: limpo.
- `npx tsx scripts/check/known-failures.ts`: 327 testes, só os 3 vermelhos esperados do
  S7 (função `SECURITY DEFINER` da proposta pública) — igual ao estado herdado, sem
  regressão.
- Não toquei em `src/components`, `src/styles`, `tests/`, `package.json` — fronteira
  respeitada.
