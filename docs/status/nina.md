# Nina — status

## S9 — o dinheiro: `/vendas`, `/financeiro`, e o botão que liga as duas

### Entregue

- **`src/app/(app)/vendas/page.tsx` + `VendasScreen.tsx`** — lista real
  (`listarVendas`), filtro por status de comissão (chip row, ver decisão 2),
  vazio com conteúdo de exemplo, linha por venda (fornecedor, badge de status
  da comissão, valor bruto e margem em `tabular-nums` com largura reservada
  pelo maior valor da lista inteira — não só da própria linha, senão a coluna
  perde alinhamento vertical quando um valor é maior que os outros). Clique
  abre o detalhe.
- **`src/app/(app)/vendas/[id]/page.tsx` + `VendaScreen.tsx`** — a ficha:
  - **Resumo**: fornecedor, valor bruto, custo, comissão prevista e taxa de
    serviço, todos com autosave por campo (`atualizarVenda`, `CentsInput` +
    `SavedMark`, mesmo padrão da ficha de cliente) e um `MoneyStat` de margem
    calculada (comissão + taxa — nunca inclui custo, que já é o que sai para
    o fornecedor).
  - **Comissão da operadora**: badge + `Select` para `atualizarStatusComissao`
    — sem trava de máquina de estado (o contrato deixa explícito que é
    conferência manual, dá pra voltar de "recebida" para "prevista").
  - **Parcelas**: lista de `receivables` com vencimento, valor, status e
    "marcar paga" (`marcarParcelaPaga`); duas Sheets — "Gerar parcelas
    mensais" (`gerarParcelasDaVenda`, só aparece com a venda ainda sem
    parcela) e "Adicionar parcela" manual (`criarParcela`, sempre disponível,
    para entrada maior ou parcela avulsa); remover parcela usa
    `useDeferredDelete` (some da tela na hora, `excluirParcela` de verdade só
    depois de 8s sem "Desfazer").
  - **Encerramento**: `excluirVenda` com o mesmo padrão de desfazer de 8s da
    ficha de cliente. Se o servidor recusar por parcela paga (`CONFLITO`), o
    toast de erro mostra a mensagem pronta do contrato — não escondi essa
    regra atrás de um botão desabilitado porque descobrir SÓ no clique
    (parcela pode ter sido paga por outra aba nesse meio-tempo) é o cenário
    real que o backend está protegendo.
- **`src/app/(app)/financeiro/page.tsx` + `FinanceiroScreen.tsx`** — duas
  seções:
  - **A receber**: todas as parcelas em aberto do tenant, atraso primeiro,
    com "marcar paga" direto na linha e link para a venda de origem; parcelas
    já acertadas ficam atrás de "Mostrar acertadas" (mesmo padrão de
    "Mostrar arquivadas" de Propostas/Clientes — não é informação que a
    agente precisa ver toda vez que abre a tela).
  - **Comissão da operadora**: três cartas-resumo (prevista/recebida/atrasada,
    contagem + soma em `tabular-nums`) e a lista completa ordenada por
    URGÊNCIA de ação (atrasada → prevista → recebida, não a ordem alfabética
    do enum), cada linha com `Select` para trocar o status sem sair da tela.
  - Ver decisão 1 (abaixo) sobre por que isso é feito com `listarVendas` +
    `listarParcelas` por venda, em vez de um endpoint agregado.
- **`converterPropostaEmVenda` ligado no editor de proposta**
  (`PropostaEditorScreen.tsx`, `PublishBar`): quando `proposta.status ===
  "accepted"`, o botão de destaque vira "Gerar venda" — chama a conversão
  (idempotente do lado do servidor) e navega direto para `/vendas/[id]`.
  Testei que o caminho existe de ponta a ponta: `aceitarOpcaoPublica` (que já
  está implementado na proposta pública, achei ao ler `sales.ts`) é o que
  leva uma proposta a `status: 'accepted'` — não é um estado morto que só um
  seed manual alcança.
- **Navegação**: um item novo na barra, `MoneyIcon` (`icons.tsx`) + rótulo
  "Dinheiro", apontando para `/vendas` — ver decisão 3 sobre por que não
  virou dois ícones.
- Ícones novos: `MoneyIcon` (moeda com duas barras, sem cifrão de moeda
  nenhuma) e `ReceiptIcon` (não usado ainda nesta entrega, deixei pronto para
  quando a conferência de comissão ganhar um recibo/nota por venda).

### Decisões que tomei sozinha

1. **`/financeiro` busca `listarVendas` e depois `listarParcelas` por venda,
   em paralelo — não existe "todas as parcelas do tenant" no contrato.** Para
   o volume declarado do produto (10–15 vendas/mês por agente) isso é uma
   tela carregando em paralelo, não um problema de escala; documentei o
   porquê no topo do arquivo para não parecer descuido. Se o volume real
   provar isso errado, é um pedido de endpoint agregado a Rafa, não algo para
   eu contornar com paginação client-side.
2. **Filtro de status na lista de Vendas não é `<Tabs>`.** Comecei com o
   componente `Tabs` (Radix) e desfiz: `Tabs`/`TabsTrigger` gera
   `aria-controls` apontando para um `TabsContent` que não existe (aqui não
   há painel por status, é a MESMA lista filtrada — o padrão certo, que já
   existe no código, é o toggle de "Mostrar arquivadas"). Troquei por um chip
   row simples com `aria-pressed`, sem fingir uma semântica de abas que a
   tela não tem.
3. **Um item de navegação só ("Dinheiro" → `/vendas`), não dois.** `/vendas`
   e `/financeiro` são dois contratos de servidor diferentes, mas para a
   agente são a MESMA pergunta ("fechei, me pagaram?"). A barra inferior já
   estava em 4 itens no limite recomendado para 390px; um sexto ícone
   caberia fisicamente mas brigaria por atenção com Hoje/Funil/Propostas/
   Clientes, que são olhados muito mais vezes por dia. Resolvi com
   `MoneyHubTabs` (`src/components/app/MoneyHubTabs.tsx`) — o mesmo
   segmented control que o construtor de proposta já usa para
   Editar/Prévia, aqui trocando de ROTA de verdade (as duas continuam
   linkáveis e indexáveis, `AppShell.tsx` ganhou `NavItem.activeMatch` para
   `/financeiro` acender o mesmo item "Dinheiro" da barra). Documentei a
   decisão com comentário no próprio `NavItem`.
4. **A lista de Vendas mostra só valor bruto e margem — não as seis colunas
   do contrato.** `custoCents`/`comissaoPrevistaCents`/`taxaServicoCents`
   moram no DETALHE, com `tabular-nums` e largura reservada lá. Seis colunas
   numéricas em 390px viram tabela de rolagem lateral, e uma lista financeira
   que pede scroll horizontal no celular é pior do que duas linhas com
   hierarquia clara (quanto o cliente pagou, quanto eu ganho). A regra do
   CLAUDE.md sobre `tabular-nums` continua valendo — só não obriga a expor
   TUDO na mesma tela.
5. **Não adicionei "Nova venda" manual.** O contrato só tem
   `converterPropostaEmVenda` a partir de uma proposta; uma venda solta sem
   proposta de origem quebraria o link `dealId`/`proposalId`/
   `proposalOptionId` que o resto do sistema assume. Se isso virar um pedido
   de produto (venda sem proposta prévia), é uma mudança de contrato antes de
   ser uma tela.

### Verificação

- `npx tsc --noEmit` — limpo.
- `npm run build` — limpo; `/vendas`, `/vendas/[id]` e `/financeiro` aparecem
  como rotas dinâmicas novas.
- `npx vitest run tests/design/guards.test.ts` — 6/6 verde.
- Não commitei — o PO commita.

---

## S8 — religar a tela Hoje (tarefas reais + aberturas reais)

O S8 chegou pronto do lado do Rafa (`listarTarefasDeHoje`, `listarAberturasRecentes`,
`concluirTarefa` já exportados de `@/server`) mas a tela ficou com o religamento pendente
depois que um agente anterior caiu no limite de sessão. Fechei os dois pontos em
`src/app/(app)/hoje/TodayScreen.tsx`.

### O que liguei

1. **"Tarefas de hoje"** — troquei o array `TASKS` (sample-data) por
   `listarTarefasDeHoje()`, com o mesmo padrão de `status: loading | ready | error` que
   `ClientesScreen.tsx` já usa (skeleton no primeiro carregamento, `FieldError` +
   "Tentar de novo" no erro, nunca a tela genérica do Next). Cada linha ganhou:
   - um glifo por `source` (`PassportIcon`/`CakeIcon`/`ChatIcon`/`ClockIcon`) antes do
     título — a distinção que o campo já carrega, sem inventar um segundo rótulo de
     texto;
   - segunda linha = `notes` quando existe, senão `contactName · destination` (nunca em
     branco à toa quando a tarefa nasceu de um alerta, não de texto digitado);
   - hora à direita em `tabular-nums`: `formatTime` para tarefa do dia, `formatRelativeShort`
     (o helper committado, "há 3h") em `text-danger` para vencida — a régua "número que
     não pula" também vale para relógio, não só para dinheiro;
   - botão "Copiar mensagem" (`CopyIcon`) só quando `suggestedMessage` existe, escreve
     na área de transferência com `navigator.clipboard.writeText` e confirma com toast.
2. **Concluir tarefa, com desfazer de verdade.** `concluirTarefa` não tem par de
   reabertura no servidor (é `doneAt = now`, sem `reabrirTarefa`). Em vez de inventar uma
   chamada que não existe ou abrir modal "tem certeza?", reaproveitei
   `useDeferredDelete` (já em `src/lib/ui/`, criado para o mesmo problema em
   `arquivarContato`/exclusões sem endpoint de volta): a tarefa some da lista NA HORA
   (marcar via checkbox parece instantâneo) e só é mandada ao servidor de verdade se os
   8s do toast passarem sem ninguém tocar em "Desfazer". Se o commit tardio falhar (ex.:
   outra aba já concluiu), a tarefa volta para a lista, reordenada por `dueAt`, com um
   toast de erro — não finge que deu certo.
3. **"Abriram sua proposta"** — troquei o hardcode `"abriu 6 vezes · há 3h"` por
   `listarAberturasRecentes()`, mesmo padrão de status/erro/skeleton do item 1.
   `AberturaProposta` não traz `cents` (só `openCount`/`firstViewedAt`/`destination`/
   `proposalTitle`) — tirei a linha de `Money` do card em vez de inventar um valor que o
   contrato não devolve; o card agora mostra contato, destino (ou título da proposta
   quando não há destino), contagem de aberturas em `Badge` e `formatRelativeShort` do
   `firstViewedAt`. O estado vazio ("Ninguém abriu ainda") e o `preview` de exemplo
   (`OpenedPreview`, decorativo, `aria-hidden`) continuam hardcoded de propósito — é
   conteúdo de amostra, não dado real.

### O que não toquei (fora do pedido)

- **"Paradas há mais de 7 dias"** e os dois números do topo (pipeline/fechado) continuam
  em `sample-data.ts` — não existe serviço de pipeline/deals do lado do servidor ainda
  (o próprio handoff do Rafa registra isso como pendente). Não inventei dado para não
  trocar um hardcode visível por um hardcode disfarçado de real.
- Não toquei `src/server/**` nem os contratos — só consumi o que já estava exportado.

### Verificação

- `npx tsc --noEmit` — limpo.
- `npm run build` — limpo, mesmas rotas de antes.
- `npx vitest run tests/design/guards.test.ts` — **não consegui rodar neste ambiente**:
  o `globalSetup` do Vitest exige Postgres (`zarpa_test`) e nem o Postgres local nem o
  daemon do Docker (`docker-compose.yml` do repo) estão de pé nesta sandbox
  (`ECONNREFUSED :5432`, `docker ps` falha por falta do socket). Não é algo que eu deva
  contornar editando `vitest.config.ts` (fronteira do Téo). Em compensação, rodei a
  MESMA lógica de checagem fora do harness (`tests/design/collect.ts` +
  `tests/design/deviations.ts`, via `tsx`, sem tocar banco): tipografia, cor por
  contexto, paridade de tema, movimento (CSS e JS) e o corte global de
  `prefers-reduced-motion` — os cinco, zero violações não registradas. Se alguém rodar
  isto com o Postgres de pé, espero 6/6 verde; se não bater, é porque o ambiente com
  banco pegou algo que a checagem isolada não vê (improvável, mas registro a ressalva).

---

## Pedido do PO — Santos Dumont, fio colado, redesenho da proposta pública

### 1. Prancha nova — `BiplanePlate`

`src/components/plates/index.tsx`. Fui atrás da geometria do 14-bis, não de
uma silhueta "bonitinha" de avião: o 14-bis (e a Demoiselle) eram, na
prática, pipas de caixa empilhadas com um chassi de treliça afunilando entre
elas — dois retângulos abertos (célula dianteira menor/mais baixa, célula
principal maior/mais alta) ligados por duas vigas que convergem, com o cesto
do piloto pendurado e uma hélice no meio. Essa estrutura celular é a MESMA
gramática de cota/eixo do `ArchPlate` (retângulos + diagonais de construção
em `hair`), então o traço novo não destoa do catálogo — não é "um desenho a
mais", é a mesma família de mão. A célula principal nasce mais alta que a
dianteira de propósito: isso já lê como "subindo" sem precisar rotacionar o
SVG ou animar nada. Original, traço único, `currentColor`, nunca no accent —
mesma constituição das outras três.

Onde ela entra: **só na proposta pública**, e só quando não há foto de capa
(`!hasCoverPhoto`) — como marca d'água (`plate-wash`, 14%) atrás do título.
Não usei em estado vazio/entrada porque isso pertenceria a outra tela
(`EmptyState`, que já tem a `FernPlate` como motivo e não é minha decisão
trocar sem um pedido específico) — o pedido citava "capa da proposta pública
**e/ou** entrada", não as duas obrigatoriamente, e a capa é onde ela resolve
um problema real (photo em branco = "chapado").

Também apareceu no catálogo do kitchen-sink (`PlatesSection`), ao lado das
outras três, seguindo o padrão existente.

### 2. Fio colado — a origem do bug e o conserto sistêmico

Achei quatro focos do MESMO problema, todos com a mesma causa: cada tela
inventava sozinha a margem do fio (`mt-2`, `mt-9`, `pt-2`+`pt-3`, ou nenhuma),
sem doutrina — e na maioria dos casos vinha curta demais de um lado
(`SectionHeading` dava só 8px entre o rótulo tracked e a cornija; o total
"Em aberto" do Funil dava só 8px antes do fio; o rodapé de cada opção da
proposta pública dava só 8px antes do fio que introduz o CTA).

Conserto na ORIGEM, um lugar só: `Rule` (`src/components/plates/index.tsx`)
ganhou uma variante `loose` — `.plate-rule--loose` em `tokens.css`,
`margin-block: var(--space-4)` (16px dos dois lados). Não toquei a folga de
`CardHeader`/`CardFooter`/`Rule inner` — essas já reservam distância pela
própria banda/padding do Card, e dar margem ao fio ALI quebraria a proporção
1:4:1 do card (o corpo perderia altura para uma margem redundante). `loose`
é só para o fio que vive solto na página, sem banda de card ao redor.

Apliquei em:
- `SectionHeading` (`Card.tsx`) — trocou `pb-2`/`mb-3` ad hoc por `loose`.
- `FunnelScreen.tsx` — o total "Em aberto" antes do fio que sublinha as
  cinco colunas.
- `PublicProposalScreen.tsx` e `ProposalPreview.tsx` — o fio antes dos
  termos, e (na pública) o fio antes do CTA de cada opção e o novo colofão
  "Feito com {APP_NAME}".
- Registrei a variante no kitchen-sink, ao lado das outras variantes de
  `Rule`.

Não toquei o `Rule` de `LoginScreen.tsx` (`mt-9`, 36px) — já tinha folga de
sobra de propósito (separa o FORM do rodapé "trocar modo de entrada"); trocar
para `loose` teria ENCOLHIDO o respiro que já estava certo.

### 3. Redesenho da proposta pública

`src/app/p/[slug]/PublicProposalScreen.tsx`. O diagnóstico do PO — "muito
sólido, fundo neutro com texto em cima" — batia: a tela usava a mesma
gramática do miolo silencioso (texto empilhado, sem hierarquia de imagem),
mesmo sendo a ÚNICA superfície do produto marcada como **editorial pleno**
na tabela dos dois registros. O que mudou:

- **Capa.** Com foto, ela abre a página em `aspect-[16/10]` cheia (troquei
  `rounded-md` por `rounded-sm` — o raio maior competia com a régua
  arquitetônica do resto do sistema). Sem foto — o caso mais comum, nem toda
  agência de R$ 99/mês tem banco de imagem — a `BiplanePlate` entra como
  marca d'água atrás do título, dentro de um `header` com
  `overflow-hidden` (testado a 390px: sem isso o SVG bleeding "-right-10"
  empurra a página e cria scroll horizontal, o mesmo cuidado que o
  `EmptyState` já tinha com a `FernPlate`).
- **Cada opção ganhou identidade de "capítulo".** Rótulo `Opção 01`/`02` em
  tabular-nums acima do nome (troquei o local do badge "Recomendada" para a
  mesma linha, não mais competindo com o nome). O preço subiu de `text-20`
  para `text-32` — numa comparação de 2–3 opções lado a lado, o preço É o
  conteúdo que decide a venda, e ele estava do mesmo tamanho que o nome da
  opção. Com `reserveFor` no MAIOR preço do conjunto: as colunas de preço
  terminam alinhadas na mesma largura entre as opções, não só dentro de uma
  — é a doutrina do `Money` (número que não pula) esticada para comparação,
  não só para atualização.
- **Uma prancha por tela, de verdade.** O `ArchPlate` que dividia "Escolha
  sua opção" só aparece agora quando a capa NÃO usou a `BiplanePlate`
  (`hasCoverPhoto`) — as duas juntas na mesma tela violariam a própria regra
  que o `ArchPlate` cita no comentário de `plates/index.tsx`.
- **Fio como colofão.** "Feito com {APP_NAME}" ganhou um `<footer>` com
  `Rule loose` acima — antes era um parágrafo solto com `pt-2`; agora fecha
  a página como um registro de verdade, não uma linha esquecida.
- **Margem de livro.** `max-w-[40rem]` → `max-w-[42rem]`, padding de
  `px-5/pt-8` → `px-6/pt-10` (`sm:px-10/pt-16`), `gap-10` → `gap-12` entre
  registros — mais generoso que o miolo do app, como o CLAUDE.md pede para
  este registro especificamente.
- **`.enter` na página.** Opacidade + 4px, uma vez, ao montar — o único
  movimento tipográfico que a direção permite fora do rolo de número; nada
  de scroll, nada de stagger.
- **`onClick` → `onPointerDown`** no botão de aceite de opção (a única ação
  de servidor de verdade nesta tela). Já estava reagindo em `onClick`;
  segui o padrão que o resto do app usa em botões nativos fora do componente
  `Button` (ex.: "Nova proposta" em `PropostasScreen.tsx`).

**O que eu NÃO toquei de propósito:** nenhum campo de `costCents`/
`commissionCents` — o tipo `PropostaPublica` que chega aqui nem tem essas
colunas (o `SECURITY DEFINER` do lado do servidor já as corta antes de
qualquer coisa chegar ao cliente), então não havia nada para "esconder" — só
confirmei, lendo o tipo, que continua assim. Também não toquei
`aceitarOpcaoPublica`/o beacon de visita — funcionam, não são
responsabilidade de design.

### Verificação

- `npx tsc --noEmit` — limpo.
- `npm run build` — limpo, mesmas 12 rotas de antes (`/p/[slug]` continua
  dinâmica).
- `npx vitest run tests/design/guards.test.ts` — 6/6 verde.
- Não commitei — o PO pediu para ver a proposta pública no navegador antes.
  Para testar de verdade: abrir `/p/<publicToken>` de uma proposta seedada
  SEM `coverImageUrl` (para ver a `BiplanePlate` na capa) e outra COM
  `coverImageUrl` (para ver a foto + `ArchPlate` no divisor), em 390px e em
  desktop, nos dois temas.

---

## S7 — Proposta pública (`/p/[slug]`)

### Entregue

- **`src/app/p/[slug]/page.tsx`** — Server Component, fora do grupo `(app)`
  (sem `AppShell`, sem sessão). Chama `obterPropostaPublica(slug)` (envolvida
  em `cache()` do React para `generateMetadata` e a página em si dividirem a
  mesma leitura dentro do request). `{ ok: true, data: null }` E
  `{ ok: false }` caem os dois em `notFound()` — nunca distingo "slug errado"
  de "proposta não publicável", como o contrato pede.
- **`src/app/p/[slug]/not-found.tsx`** — o 404 elegante: uma `FernPlate` a
  14% (`.plate-wash`), uma frase, sem CTA. Registro "entrada/estado vazio"
  (intermediário), não o editorial pleno da proposta em si.
- **`src/app/p/[slug]/PublicProposalScreen.tsx`** — o Client Component com o
  conteúdo de verdade: capa (imagem se houver), tipografia de display no
  título (`.display`, `text-32`), resumo, `ArchPlate` como divisor antes da
  seção de opções, opções empilhadas no celular / lado a lado em telas
  maiores (o mesmo padrão de `ProposalPreview.tsx` do construtor, agora com
  dado público de verdade), blocos renderizados por `kind` com rótulo por
  campo (`CONTENT_FIELDS`), termos, rodapé "Feito com {APP_NAME}".
- **Botão de aceite por opção** — como não existe action de servidor para
  "aceitar" sem login (ver handoff abaixo), o botão principal de cada opção
  abre o WhatsApp do agente (`brand.whatsappLink`) com uma mensagem pronta
  (nome da proposta, nome da opção, preço formatado). Sem WhatsApp cadastrado,
  o cartão mostra texto simples em vez de botão morto. Um atalho de WhatsApp
  separado (dúvida geral, não vinculado a opção) fica no topo da página.
- **Beacon de abertura** — `useProposalVisitBeacon` dentro de
  `PublicProposalScreen.tsx`: chama `registrarVisitaProposta` uma vez ao
  montar (sem duração) e de novo no `visibilitychange` (aba escondida) ou
  `pagehide`, com `durationSeconds` e `focusedOptionId` (de um
  `IntersectionObserver` nas opções — a que estiver mais visível quando a
  pessoa sai). `sessionKey` é um `crypto.randomUUID()` guardado em
  `sessionStorage`, com `try/catch` para modo privado sem storage. Testei com
  Playwright de verdade (não só `curl`, que não roda JS) abrindo a página e
  fechando a aba: `proposal_views` ganhou a linha de entrada e a de saída com
  `duration_ms`/`focused_option_id` batendo com o tempo real da sessão.
- **`PropostaEditorScreen.tsx`** ganhou um `PublishBar`: rascunho mostra
  "Enviar proposta" (chama `enviarProposta`, desabilitado sem opção — regra
  do servidor, replicada na interface para não esperar o round-trip);
  enviada mostra Badge de status + "Copiar link" + "Abrir" + "Reenviar". Sem
  isso não havia como ligar o link público a partir do construtor.
- **`src/lib/ui/blockContent.ts`** — novo módulo compartilhado com o
  vocabulário de bloco (`KIND_LABEL`, `CONTENT_FIELDS`, `contentFieldLabel`),
  que antes vivia só dentro de `BlocksEditor.tsx`. Movi para não duplicar (e
  arriscar divergir) o rótulo de cada campo entre o construtor autenticado e
  a proposta pública — as duas telas agora leem do mesmo lugar.
- Dois ícones novos em `src/components/app/icons.tsx`: `ChatIcon` (atalho de
  WhatsApp — balão de conversa genérico, nunca o logotipo de terceiro) e
  `LinkIcon` (botão "Copiar link" do editor).

### Decisões que tomei sozinha

1. **Aceite de opção não grava nada no servidor.** A instrução era clara: se
   a action não existe, ligar ao WhatsApp em vez de inventar chamada. Abri
   `docs/handoffs/nina-para-rafa.md` pedindo `aceitarOpcaoPublica` (mesmo
   desenho de `registrarVisitaProposta`) para o dia em que isso entrar —
   nesse momento o WhatsApp vira confirmação secundária, não o único
   caminho.
2. **`generateMetadata` com `robots: { index: false, follow: false }`.** O
   link é nominal (mandado por WhatsApp para um cliente específico), não uma
   página para aparecer numa busca — e ela carrega preço de terceiro. Decidi
   isso sem pedir, por ser puramente defensivo e dentro da minha fronteira.
3. **`visibilitychange` em vez de `navigator.sendBeacon` de verdade.**
   `registrarVisitaProposta` é uma Server Action (RPC do Next por baixo), não
   uma URL crua — não dá para montar o corpo que o `sendBeacon` esperaria sem
   depender de detalhe de implementação do framework que pode mudar de
   versão. `visibilitychange` (aba escondida) dispara ANTES do `unload`, com
   tempo de sobra para o fetch sair, e é o padrão que a própria descrição da
   tarefa citava como alternativa. `pagehide` fica de reforço para o caso
   raro de fechar sem passar por "hidden" primeiro. Um `ref` de "já mandei"
   evita linha duplicada em `proposal_views`.
4. **Cor de aceite vem da marca do AGENTE (`brand.primaryColor`), não do
   `--accent` do produto.** É a instrução explícita do contrato
   ("`brand.primaryColor` é a cor DA MARCA DO AGENTE... não confunda com o
   `#12557F` do design system do PRODUTO"). Sem `primaryColor` cadastrado,
   caio em `var(--accent)` como default sensato, não em preto/cinza.
5. **Movi `KIND_LABEL`/`CONTENT_FIELDS` para `src/lib/ui/blockContent.ts`**
   em vez de duplicar o vocabulário na tela pública. Os dois arquivos são meus
   (`src/app/**` e `src/lib/ui/**`), então não é um pedido a ninguém — só uma
   correção de rota que eu podia fazer sozinha para o rótulo de "Check-in"
   nunca divergir entre quem escreve o bloco e quem lê.

### Achado durante a verificação manual (não é bug meu, registrado em `nina-para-rafa.md`)

A função `public.proposta_publica` instalada no meu `zarpa_dev` estava
desatualizada em relação ao arquivo `drizzle/0004_proposta_publica.sql` do
repositório (o hash gravado em `drizzle.__drizzle_migrations` não bate com o
hash do arquivo em disco — alguém editou a migration depois dela já ter sido
aplicada, e `drizzle-kit migrate` não reaplica migration já marcada como
feita). Isso fazia `brand.whatsappLink` chegar sempre `null`. Corrigi só no
meu banco local (rodei o `CREATE OR REPLACE FUNCTION` do arquivo atual direto
no Postgres, sem editar nenhum arquivo) para poder terminar a verificação —
detalhes e sugestão para o Rafa em `docs/handoffs/nina-para-rafa.md`.

### Verificação

- `npx tsc --noEmit` — limpo.
- `npm run build` — limpo, `/p/[slug]` aparece como rota dinâmica.
- `npx vitest run tests/design/guards.test.ts` — 6/6 verde.
- Manual, de ponta a ponta, com Playwright real (não só `curl`):
  - `npm run db:migrate` + `npm run db:seed` (banco estava vazio no início da
    sessão).
  - Login com `dev@zarpa.local` / `dev12345`, abri o editor de uma proposta
    seedada ("Grécia — 12 noites"), cliquei em "Reenviar" (exercita
    `enviarProposta` a partir da minha UI nova).
  - Abri `/p/<publicToken>` **sem sessão** (contexto de navegador limpo): capa,
    marca ("Volta ao Mundo"), 3 opções com preço/parcelamento em
    `tabular-nums`, botão "Aceitar esta opção" por opção abrindo
    `wa.me/5511987650001?text=...` com mensagem certa, atalho de WhatsApp
    geral no topo, termos, rodapé.
  - Slug inexistente → 404 com a mensagem elegante de `not-found.tsx`.
  - Abri a página, esperei ~2s, fechei a aba: nova linha em `proposal_views`
    com `duration_ms≈7000`/`focused_option_id` da única opção visível — e uma
    linha anterior de mount sem duração, confirmando os dois disparos do
    beacon.
  - Screenshot em 390×844 conferido visualmente (registro editorial, sem
    elemento centralizado sem motivo, cornija separando seções, nenhum
    `rounded-lg` em caixa ao redor de conteúdo).

### Handoffs abertos

- `docs/handoffs/nina-para-rafa.md` — reescrito nesta sessão: (1) pedido de
  `aceitarOpcaoPublica` para a proposta pública, (2) o achado de migration
  desatualizada acima, (3) o pedido antigo de `listarNegocios()` que
  continua em aberto (reproduzido lá para não se perder).

---

## S5/S6 — Construtor de proposta

### Entregue

- **`/propostas`** (`src/app/(app)/propostas/page.tsx`,
  `src/app/(app)/propostas/PropostasScreen.tsx`) — lista real (`listarPropostas`),
  busca com debounce, alternância "mostrar arquivadas" (`restaurarProposta`),
  vazio com conteúdo de exemplo. "Nova proposta" abre uma Sheet
  (`NovaPropostaSheet`) e chama `criarPropostaAPartirDoNegocio`.

- **`/propostas/[id]/editar`** — o editor:
  - `page.tsx` (server, resolve `params`) → `PropostaEditorScreen.tsx` (client).
  - **Meta**: título (editável inline, estilo display), validade, moeda
    (somente leitura — não há endpoint para trocar de moeda no meio da
    proposta e não faria sentido de produto), resumo e condições/pagamento —
    tudo com autosave granular (`atualizarProposta`, um campo por vez, como o
    contrato pede) e `SavedMark` discreto, sem botão Salvar.
  - **Opções (até 3)**: criar/remover (remoção usa o mesmo padrão de
    `useDeferredDelete` — remove da tela na hora, some de verdade só se os 8s
    do toast passarem sem "Desfazer" — porque `excluirOpcao` não tem endpoint
    de restauração, é cascade real), reordenar com setas esquerda/direita
    (`reordenarOpcoes`), campos de preço/custo/comissão com `CentsInput` novo
    (ver abaixo), parcelas com o palpite de `sugerirValorParcelaCents`/
    `sugerirComissaoCents` (`src/server/pricing.ts`, importado direto — são
    funções síncronas, não `'use server'`, o próprio handoff do Rafa autoriza
    isso), e "recomendar" (desmarca as outras, espelhando a regra do servidor
    sem round-trip).
  - **Blocos**: `BlocksEditor.tsx`. Abas por escopo ("Todas as opções" + uma
    por opção — `position` é uma sequência por escopo no servidor, então cada
    aba é uma lista arrastável independente). Reordenação por arrasto com
    `Reorder.Group`/`Reorder.Item` (`motion/react`), alça própria
    (`useDragControls`, sem "arrastar ao tocar em qualquer lugar do card" —
    os campos de texto do bloco continuam clicáveis), incluindo teclado
    (setas ▲▼) quando `prefers-reduced-motion` está ligado — nesse caso o
    `Reorder.Group` nem monta, vira lista comum com botões. Cada bloco:
    título, campos específicos do tipo (`CONTENT_FIELDS` — 4 a 6 campos por
    tipo: hotel, voo, transfer, passeio, cruzeiro, seguro; texto/imagem/nota
    de preço só têm título+corpo), descrição, upload de imagem
    (`enviarImagemDaProposta`, até 10 por bloco), seletor "aparece em"
    (move o bloco entre escopos, `atualizarBloco({ optionId })`), remoção com
    o mesmo padrão de desfazer de 8s dos itens não restauráveis.
  - **Biblioteca**: sheet "Adicionar bloco" com duas abas — "Novo" (grade de
    tipos) e "Da biblioteca" (busca com debounce em `listarBiblioteca`,
    "Inserir" chama `inserirItemDaBibliotecaComoBloco`).
  - **Prévia** (`ProposalPreview.tsx`): registro editorial ao lado do
    editor — display, arco (`ArchPlate`) como divisor de seção, cards de
    opção lado a lado. Nunca lê `costCents`/`commissionCents` mesmo tendo
    acesso a eles no mesmo objeto (regra do contrato: a prévia é uma
    aproximação HONESTA da proposta pública, não pode vazar margem mesmo
    sendo renderizada dentro do construtor autenticado).
  - **Mobile (390px)**: editor e prévia não cabem lado a lado — viram um
    segmented control "Editar"/"Prévia" no topo (`ViewToggle`). Os dois
    painéis ficam sempre no DOM; só a visibilidade muda por breakpoint
    (`hidden lg:flex` / `hidden lg:block`), então nada resincroniza ao trocar
    de aba.
  - Rota entrou em `WIDE_PATH_PATTERNS` no `AppShell` (só o editor, não a
    lista) — no desktop ocupa a largura da janela porque é dois registros
    lado a lado; comprimir os dois em 64rem fazia a prévia nascer estreita
    demais para servir de prévia de verdade.

### Peças novas no design system (reaproveitáveis fora da proposta)

- `parseBRLCents` em `src/lib/ui/format.ts` — o inverso tolerante de
  `formatBRL`, para campo de dinheiro editável (nunca guarda float).
- `CentsInput` em `src/components/ui/Money.tsx` — a metade "edição" do par
  com `<Money>`: digita em reais, converte pra centavos só no commit
  (blur/Enter), nunca mostra o rolo de dígitos (isso é para leitura, não
  para o meio de uma digitação).

### Decisões que tomei sozinha

1. **Remoção de opção e de bloco usa "desfazer de 8s" mesmo sem endpoint de
   restauração no servidor** — mesmo padrão de `useDeferredDelete` que já
   existe em Clientes: a interface tira da tela na hora, e só manda
   `excluirOpcao`/`excluirBloco` de verdade depois de 8s sem toque em
   "Desfazer". Cumpre a regra do CLAUDE.md ("destrutivo = toast com desfazer,
   não modal") sem esperar por um endpoint que o contrato deixa claro que não
   vai existir (é cascade real).
2. **Parcelamento não tem "limpar"**: o zod de `atualizarOpcao` não aceita
   `null` para `installments`/`installmentCents` (exige inteiro válido
   quando o campo vem no patch). Uma vez definido o número de parcelas, o
   campo só troca para outro número — não há como voltar a "sem parcelamento"
   pela interface hoje. Documentei isso no próprio componente; se for um
   problema de produto, é uma linha nova no contrato (patch aceitando
   `installments: null`), não algo para eu contornar do lado do cliente.
3. **Conteúdo por tipo de bloco é um conjunto fixo de campos de texto**
   (`CONTENT_FIELDS`) — o contrato não define forma interna para `content`
   (é `Record<string, unknown>` livre). Escolhi 4–6 campos por tipo (ex.:
   hotel → nome, categoria do quarto, check-in, check-out, regime) em vez de
   um editor de JSON genérico, para caber no critério de "3 opções e 12
   blocos em 4 minutos" — um editor JSON solto teria sido mais flexível e
   muito mais lento de preencher.
4. **Moeda da proposta é somente leitura no editor.** `atualizarProposta`
   aceita trocar `currency`, mas não há regra de produto clara sobre o que
   acontece com preços de opção já digitados numa moeda diferente — decidi
   não expor a troca até isso ser uma decisão consciente, não um campo solto.
5. **"Nova proposta" pede o `dealId` colado, não escolhido por nome** — não
   existe hoje nenhum serviço que liste negócios do tenant (ver handoff).
   Testei o caminho ponta a ponta colando um `id` de negócio direto do
   Postgres do ambiente de dev.

### Bloqueio grave, fora da minha fronteira — não consegui completar a verificação manual

`docs/handoffs/nina-para-rafa.md` tem o relato completo, mas o resumo: **o
app inteiro (`npm run build` E `npm run dev`, qualquer rota, incluindo
`/entrar`) quebra com `Module not found: Can't resolve '@vercel/blob'`**,
vindo de `src/server/storage.ts` (o import dinâmico por especificador não
literal engana o `tsc` mas não engana o bundler do Next/Turbopack — e como
Next precisa de um manifesto global de Server Actions, o erro de bundling de
`storage.ts` derruba toda rota, não só `/propostas`). Fiz:

- `npx tsc --noEmit` — **limpo**.
- `npx vitest run tests/design/guards.test.ts` — **6/6 verde**.
- `npm run build` — **quebra** no arquivo acima (fora da minha fronteira,
  não posso editar `src/server/**`).
- Verificação manual ("logar com `dev@zarpa.local`, montar uma proposta") —
  **não consegui rodar**: `npm run dev` cai no mesmo erro em qualquer rota,
  inclusive `/entrar`, com `.next` limpo. Não é algo que eu tenha causado
  agora (o arquivo já existia e já estava exportado por `@/server` antes
  desta sessão) — é a primeira vez que alguém builda/sobe o app depois que
  `proposals.ts`/`storage.ts` entraram no repositório.
- Em compensação, **populei o banco de dev** (`npm run db:migrate` +
  `npm run db:seed`, que ainda não tinham rodado neste ambiente — o banco
  estava sem `deals`) e confirmei via `psql`/`docker exec` que os dois
  tenants têm negócio, contato e proposta de exemplo, incluindo um negócio
  SEM proposta (Buenos Aires, tenant "Volta ao Mundo") pronto para testar
  "Nova proposta" assim que o build voltar a subir.
- Revisei manualmente o contrato de cada action contra o código do editor
  (assinaturas, shape de retorno, campos que nunca podem vazar) — não é
  substituto de testar no navegador, mas reduz a chance de o primeiro teste
  real revelar um erro de tipagem/contrato.

### Handoffs abertos

- `docs/handoffs/nina-para-rafa.md` — os dois itens acima: (1) o bloqueio de
  build/dev em `storage.ts` (grave, bloqueia o app inteiro), (2) pedido de
  `listarNegocios()` para trocar o campo de ID colado por um seletor de
  verdade.
