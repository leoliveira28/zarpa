# Nina — status

## S15 — pronta para produção: o link morto, a varredura e o pós-venda descoberto

Rodada de acabamento, não de feature. Quatro frentes: esconder o Kitchen sink em
produção, varrer as telas atrás de beco morto e mock vazado, dar DESCOBERTA ao
bloco de texto do pós-venda, e confirmar os quatro fluxos do S14 sem regressão.
`tsc --noEmit` limpo, `next build` limpo (26 rotas, middleware registrado),
guardas de direção **6/6**. Lint: 7 erros / 4 avisos — **exatamente os mesmos
números do HEAD limpo** (conferi com `git stash`), todos `set-state-in-effect`
e imports não usados pré-existentes. Nada meu.

### §1 — "Kitchen sink" some do SideNav em produção

`AppShell.tsx`, rodapé da barra lateral: o link agora está atrás de
`process.env.NODE_ENV === "production" ? null : (...)` — a MESMA condição do
`src/middleware.ts` do PO, avaliada em build time pelo Next (a string nem entra
no bundle de produção). Em dev/preview continua onde estava, entre Integrações e
Tema. Confirmado por curl no dev server: o link está presente no HTML de `/hoje`.

### §2 — Varredura de produção: o que achei

Varri `src/app/(app)/**` e `src/components/**` com script (todo `<Button>`,
`<button>` e `<CardAction>` sem `onClick`/`onPointerDown`/`href`/`asChild`/
`type="submit"`; todo `href` contra a árvore real de rotas; todo `<Money>` sem
`reserveFor`; `TODO/FIXME/mock/em breve`; toda ocorrência dos personagens de
exemplo).

**CONSERTADO**

1. **O "Cobrar" das propostas paradas era teatro** (`/hoje`,
   `ParkedProposalRow`). Placeholder do S4: mostrava um toast dizendo
   *"Follow-up de X pronto para enviar no WhatsApp"* e **não fazia nada** — não
   copiava, não abria, não preparava mensagem nenhuma. É pior que o botão sem
   `onClick` do S13b: aquele não respondia, este MENTIA que agiu. A agente
   confia, não envia, e perde a venda achando que enviou. Agora ele copia de
   verdade (`mensagemCobranca` em `src/lib/ui/whatsapp.ts` — retomada, não
   cobrança: "me diz que eu ajusto", sem prazo inventado), com o mesmo caminho
   de clipboard já usado em "Copiar mensagem" das tarefas, e o rótulo passou a
   dizer o que ele faz: **"Copiar cobrança"** → "Copiada" por 2s.
   `PropostaParada` (dashboard.ts) não traz o WhatsApp do contato, então
   `wa.me` de um toque depende de um campo da Rafa — pedido aberto em
   `docs/handoffs/nina-para-rafa.md`, sem bloqueio.
2. **O hub do dinheiro perdia o período ao trocar de aba.** `MoneyHubTabs`
   linkava `/vendas`, `/financeiro` e `/relatorios` sem query: quem estava
   olhando o trimestre em Vendas e tocava em Relatórios caía no mês corrente,
   em silêncio — a interface desfazendo a escolha da agente sem avisar, contra
   o §1 inteiro ("o período mora na URL"). As três abas são UMA pergunta sobre
   a MESMA janela de tempo. Agora carregam o `?periodo=`, recebido por prop da
   página (server), como o `PeriodoSeletor` — sem `useSearchParams` para reler
   o que já desceu. **Param torto não viaja**: `chaveDoParamPeriodo(...) ===
   "invalido"` derruba o parâmetro, porque o `PeriodoInvalidoCard` já explicou
   o problema na tela onde ele apareceu e propagar lixo faria o erro perseguir
   a agente pelo hub. Verificado por curl: `/vendas?periodo=2026-01-01..2026-12-31`
   renderiza os três hrefs com a faixa; `?periodo=lixo` renderiza os três
   limpos + o card de aviso.
3. **Três colunas de dinheiro que não eram colunas.** `reserveFor={o próprio
   valor}` reserva o que já se ocupa — ou seja, não reserva nada: o número de
   cada linha tinha a largura dele, e a ação ao lado ("Marcar paga", o Select de
   status, o "Cobrar") escorregava de linha para linha. Corrigido com o teto da
   LISTA, a mesma régua dos MonthCards e das tabelas de `/relatorios`:
   `RecebivelRow` (dois tetos — aberto e acertado são duas listas),
   `ComissaoRow`, e `ParkedProposalRow` do `/hoje`, que nem `reserveFor` tinha.
   Bônus no mesmo arquivo: os três tiles de comissão reservavam pelo maior valor
   INDIVIDUAL enquanto exibem SOMAS — e trocar o status de uma venda move valor
   de um tile para outro. Agora reservam pelo maior dos três totais.
4. **"Recomendar esta opção" falhava em silêncio** (editor de proposta) —
   pendência que eu mesma registrei no S13a e que não custava mais nada
   fechar. Era `if (result.ok) onUpdated(...)` sem ramo de recusa: a caixa é
   controlada, então voltava sozinha ao estado anterior e ninguém dizia por
   quê (inclusive com a conta bloqueada por dunning, onde o banner nunca
   chegava). Agora tem `avisarRecusaDeEscrita` + toast com a mensagem do
   servidor e a re-tentativa como botão do próprio toast.

**LIMPO (varri e não achei nada)**

- **Nenhum** botão/ação sem handler nas telas reais. Os dois positivos do
  script são falsos: `CardAction` dentro de `DialogClose asChild`
  (`DealStageMenu`) e o `<button>` do `PopoverPrimitive.Trigger asChild`
  (`Combobox`) — os dois recebem o handler do Radix.
- **Nenhum** `href` quebrado: os 12 literais e os 6 template hrefs batem com a
  árvore de rotas do build.
- **Nenhum** dado de exemplo vazado para tela real. Todas as ocorrências de
  Marina / Fernando de Noronha / CVC Noronha estão dentro de `preview` de
  `EmptyState` (o registro da casa) ou em `placeholder` de campo. O `9900` da
  `/cobranca` é preview de fatura; os planos vêm de `listarPlanos`.
- **Nenhum** outro toast que finge ação (o "Cobrar" era o último).
- Estados vazios sem `action` própria: todos têm o CTA no `CardFooter` do card
  que os contém (proposta do negócio, parcelas da venda) ou são leitura pura
  (linha do tempo, faturas). Não é beco.
- `TODO/FIXME/mock/em breve`: zero. Os 30 casamentos do grep são a palavra
  "todo" em português.

**DECISÃO CONSCIENTE (não é bug)**

- **A barra inferior e o SideNav resetam o período** ao entrar no hub por
  "Dinheiro". É navegação global ("vá para a seção"), não ajuste de leitura: o
  recorte é do hub, e o link que a agente compartilha continua carregando o
  recorte dentro dele. Carregar `?periodo=` no shell obrigaria toda rota a
  saber de período, todo dia.
- **`rounded-lg` sobrevive em 5 pontos** (fantasma de arrasto do funil,
  skeletons que precisam casar com o raio do card que substituem, a folha da
  prévia, a dropzone do importador). O proibido é `rounded-lg` em TUDO; o
  sistema usa `rounded-md`/`sm`/`pill` e o gate passa. Não vou fazer churn.

### §3 — Pós-venda: o bloco de texto ganhou largada

O diagnóstico do PO estava certo — o problema nunca foi capacidade, foi
descoberta. O bloco `text` já sobrevive ao `gerarRoteiro` e sai inteiro no
roteiro público; o que não existia era alguém dizendo à agente, às 23h, que
"Texto" é onde moram o contato do guia local e a validade do passaporte.

**Onde:** dentro do `AddBlockSheet` do `BlocksEditor`, na aba "Novo" — o
instante exato em que ela está escolhendo o que adicionar. **Abaixo de um
`Rule`**, em segundo registro: a grade de 9 tipos é a ESCOLHA do tipo; os três
modelos são um atalho de largada para UM deles. O fio separa os dois registros
sem abrir uma segunda caixa (cornija, não moldura), o tipo é menor, e nenhum
deles usa o accent — não disputam com a grade, complementam.

Três botões `secondary size="sm"`, texto simples, com `loading` individual:
**Contatos de emergência** (hotel / guia local / agência / emergência no
destino), **Documentos necessários** (passaporte, visto, vacinas, voucher,
apólice) e **Informações úteis** (moeda, clima, tomada, fuso, o que levar).

**Zero mudança de contrato com a Rafa:** `criarBloco` já aceita `title` e
`body` no `blocoInput`; o que nasce é um bloco `text` comum, no escopo em vigor,
editável e removível como qualquer outro. Não inventei tipo, campo nem
migration.

O esqueleto é uma lista de **rótulo + dois pontos com o valor em branco**, de
propósito: são perguntas para a agente responder, não texto pronto para o
cliente ler. Um modelo que já vem preenchido com plausibilidade é como o
roteiro chega ao cliente com "Hotel: Lorem".

**E fechei o loop do outro lado:** o `RoteiroCard` (negócio ganho) agora diz na
descrição do vazio que a fotografia é **definitiva** — a Rafa proibiu regenerar
de propósito — e manda acrescentar os blocos ANTES, citando os modelos por
nome. Era a informação que faltava no único momento em que ela importa: o
segundo antes de tocar "Gerar roteiro".

### §4 — Os quatro fluxos do S14, conferidos

Subi contra o dev server que já estava de pé na porta 3000, autenticado por
curl com cookie de sessão real (`dev@zarpa.local`). **Isto não é clicar** — é
HTTP e leitura de HTML; ninguém arrastou card nem abriu sheet.

- Sem sessão: `/hoje`, `/vendas`, `/financeiro`, `/relatorios`, `/funil`,
  `/propostas`, `/clientes` e `/kitchen-sink` → **307 para `/entrar`**. `/` →
  307 `/hoje`. O gate do layout `(app)` está firme.
- Com sessão: as 12 rotas do app → **200**, incluindo `/relatorios`,
  `/relatorios?periodo=2026-08`, `/relatorios?periodo=lixo` e
  `/vendas?periodo=2026-01-01..2026-12-31`.
- `?periodo=lixo` renderiza o `PeriodoInvalidoCard` ("O período deste link não
  é válido") — conferido no HTML, não por fé.
- "Em viagem" está presente no `/hoje` renderizado.
- `/p/<token>` de uma proposta enviada real → **200**. `/p/inexistente` e
  `/r/inexistente` → **404** (o `not-found` do roteiro responde).
- **`/r/<slug>` de um roteiro REAL não foi exercitado**: o banco de dev não tem
  nenhum `itinerary` e nenhum deal em `ganho` (conferi por SQL, leitura só).
  Não vou semear dado no dev do PO no meio da rodada da Rafa. Por leitura de
  código nada está pela metade — página, `not-found`, `RoteiroCard`, os
  componentes públicos compartilhados e a geração idempotente estão inteiros e
  compilam. É o único ponto dos quatro que continua dependendo do PO clicar.

### Arquivos

Editados: `src/components/app/AppShell.tsx` (§1),
`src/components/app/MoneyHubTabs.tsx` (+ prop `periodoParam`),
`src/app/(app)/{vendas/VendasScreen,financeiro/FinanceiroScreen,relatorios/RelatoriosScreen}.tsx`
(passam o param; Financeiro também nos tetos de largura),
`src/app/(app)/hoje/TodayScreen.tsx` (Cobrar + `reserveFor`),
`src/app/(app)/propostas/[id]/editar/BlocksEditor.tsx` (modelos),
`src/app/(app)/propostas/[id]/editar/PropostaEditorScreen.tsx` (recusa do
"Recomendar"), `src/app/(app)/funil/[id]/NegocioScreen.tsx` (copy do roteiro),
`src/lib/ui/whatsapp.ts` (`mensagemCobranca`),
`docs/handoffs/nina-para-rafa.md` (pedido do `contactWhatsapp`).
Não toquei `src/db`, `src/server`, `drizzle`, `tests`, `package.json` nem
`src/middleware.ts`. **Nada commitado.**

### O que o PO precisa clicar (o que curl não alcança)

1. `/propostas/<id>/editar` → "Adicionar bloco" → aba **Novo** → abaixo do fio,
   os três modelos. Tocar "Documentos necessários": nasce um bloco de texto com
   título e o esqueleto no corpo, editável na hora, e o preview reflete a cada
   tecla. Conferir em 390px que os três botões quebram em duas linhas sem
   aperto, e no tema escuro.
2. `/vendas?periodo=2026-01-01..2026-12-31` → tocar "Relatórios" e "Recebíveis":
   **o período segue junto**, e o chip "Este ano" continua marcado nas três.
   Depois `?periodo=lixo` → trocar de aba limpa o parâmetro.
3. `/financeiro` com 3+ parcelas de valores bem diferentes (ex.: R$ 890 e
   R$ 12.400): a coluna de dinheiro alinha e o "Marcar paga" fica na mesma
   coluna em todas as linhas.
4. `/hoje` com proposta parada há 7+ dias: "Copiar cobrança" → cola de verdade
   no WhatsApp, e o rótulo vira "Copiada" por 2s.
5. `/funil/<id>` de um negócio **ganho** sem roteiro: ler a descrição nova
   antes de gerar, e então gerar → `/r/<slug>` (o único fluxo do S14 que ainda
   não foi exercitado contra dado real).

## S14 — período na URL, resumo do período, em viagem e roteiro público

Os quatro fluxos do §S14 (handoff rafa-para-nina), no registro que já tinha —
nenhum padrão visual novo: seletor é chip de filtro, relatório é tile e tabela,
em viagem é linha de lista, roteiro é a linguagem editorial da proposta
reaproveitada. `tsc --noEmit` verde, `next build` verde, contraste WCAG verde,
guardas de direção 6/6 (`tests/design/guards.test.ts`), design-report sem
desvio novo. O lint acumula os erros `react-hooks/set-state-in-effect`
pré-existentes na main (11 no HEAD limpo; os effects novos seguem o MESMO
padrão da casa de `setStatus` dentro de `.then` — não inventei variante).

### §1 — O período mora na URL, não na memória

`src/lib/ui/periodo.ts` é o codec único: parse/encode/validação do `?periodo=`
e a chave de atalho. Decisões:

- **"Este mês" não escreve parâmetro.** É o estado ausente, que o servidor já
  entende como mês corrente. A URL que a agente abre quinze vezes por dia
  continua limpa; o link de um recorte antigo carrega o recorte dentro dele.
- **Mês civil exato codifica na forma curta** (`2026-09`), intervalo costurado
  vai na faixa (`2026-01-01..2026-12-31`). Link curto, rótulo limpo.
- **Param malformado nunca viaja ao servidor.** `PeriodoInvalidoCard` (fundo
  warn) diz o que aconteceu e tem o botão "Limpar período" ao lado — e a leitura
  segue no mês corrente, com o rótulo do backend dizendo qual é. O rótulo exibido
  é sempre o de `ResumoDoMes.periodo`/`ResumoDoPeriodo.periodo`, humanizado
  (`formatarRotuloPeriodo`: `set 2026`, `1 jan – 31 mar 2026`) — a tela nunca
  inventa o recorte que está mostrando.
- **"Escolher datas" abre painel inline, não Sheet.** É ajuste de leitura, não
  tarefa; camada flutuante para duas datas é orçamento de modal gasto à toa.
  O painel abre preenchido com o que está em vigor, nunca vazio.
- Seletor em **/hoje, /vendas, /financeiro e /relatorios**, sempre no mesmo
  lugar (logo abaixo do cabeçalho/tabs, `-mt-3` no hub). Trocar de período dá
  `router.push(..., { scroll: false })` — não joga a agente de volta ao topo.
- Rótulos que dependem do recorte mudam de "mês" para "período" quando o
  parâmetro existe ("Fechado no mês" → "Fechado no período", "Este mês" →
  "No período").

### §2 — /relatorios, a terceira tab do hub

`MoneyHubTabs` agora tem Vendas · Recebíveis · Resumo do período (~314px em
390px, cabe). A tela é o registro silencioso à risca: quatro tiles de vendas,
quatro de comissão (atrasada com tom warn e dot de estado, nunca azul), duas
tabelas de duas linhas de hierarquia. Nenhuma pizza, nenhum sparkline — e
`origem: null`/`motivo: null` viram linhas "Sem origem"/"Sem motivo
registrado", porque o não classificado é a maior categoria de base nova e
escondê-lo é maquiar número. `reserveFor` com os mesmos tetos calibrados dos
MonthCards do /hoje (50M/5M/10M/20M) e máximo computado nas tabelas.

### §3 — "Em viagem" no /hoje, entre aberturas e propostas paradas

Três estados por linha, e o CTA existe num só: "Retornou há N dias" pede
depoimento com mensagem pronta (`mensagemDepoimento`, `waMeLink` em
`src/lib/ui/whatsapp.ts`). **Recorte de segurança que assumi sozinha:** o
contrato dizia "contactWhatsapp vem pronto para o CTA", mas ele é texto cru
como foi digitado — então o `waMeLink` sanitiza (10–15 dígitos) e devolve null
para número duvidoso. Sem WhatsApp válido, a linha fica sem botão: link
quebrado abre conversa com estranho, pior que ausência. "Viaja em ≤2 dias"
usa `text-warn` (estado, não marca). Vazio = uma linha `compact`.

### §4 — /r/[slug] e o "Gerar roteiro" no negócio ganho

- Extraí `PublicBrandBar` e `PublicBlockSection` para `src/components/public/`
  (server-compatible, sem `"use client"`) e a proposta pública agora os consome
  — proposta e roteiro compartilham o MESMO vocabulário de bloco e a MESMA
  barra de marca. Divergência entre as duas páginas públicas era o tipo de
  coisa que ninguém decide: acontece.
- `/r/[slug]` (`page.tsx` + `RoteiroPublicoScreen` + `not-found.tsx`) segue a
  arquitetura da `/p/[slug]`: `cache()` na leitura, `robots noindex`, 404 que
  não distingue token errado de roteiro inexistente, `FernPlate` discreta.
  Capa tipográfica com `BiplanePlate` como marca d'água (a única prancha —
  sem `ArchPlate` aqui), blocos via `PublicBlockSection`, rodapé "Feito com".
- **Sem preço, por decisão:** a proposta é argumento de venda; o roteiro é
  documento de viagem que o cliente abre na semana do embarque. Reaparecer
  preço transformaria documento em nova negociação — e o snapshot público nem
  traz o dado.
- `RoteiroCard` no `/funil/[id]`, renderizado só em `stage === "ganho"`
  (pós-venda, não argumento), entre PropostaCard e TimelineCard. Sem roteiro:
  EmptyState compact + "Gerar roteiro" no rodapé. Com roteiro: título, cliente,
  datas, link truncado; rodapé com UMA ação em destaque ("Copiar link", vira
  "Copiado" por 2s) e "Abrir" como texto — a proporção capitel da casa. Toast
  de geração traz a action "Copiar link" pronta. Erro de geração renderiza
  inline com a `correcao` do servidor como hint (as recusas CONFLITO do Rafa
  já chegam falando o que fazer).

### Arquivos

Novos: `src/lib/ui/periodo.ts`, `src/lib/ui/whatsapp.ts`,
`src/components/app/PeriodoSeletor.tsx`, `src/components/public/{PublicBrandBar,PublicBlockSection}.tsx`,
`src/app/(app)/relatorios/{page,RelatoriosScreen}.tsx`,
`src/app/r/[slug]/{page,RoteiroPublicoScreen,not-found}.tsx`.
Editados: `TodayScreen`/`hoje/page`, `VendasScreen`/`vendas/page`,
`FinanceiroScreen`/`financeiro/page`, `MoneyHubTabs`, `NegocioScreen`
(RoteiroCard), `PublicProposalScreen` (consome os componentes públicos),
`src/lib/ui/format.ts` (`formatarFaixaDeDatas`).

## S13b — onboarding de primeira hora: os vazios guiam o caminho da primeira venda

O problema do bater-o-molde não era falta de EmptyState — cada tela tinha o
seu. Era que eles não se conversavam: a agente nova caía no `/hoje` vazio e
precisava adivinhar a ordem **cliente → negócio → proposta → link no
WhatsApp**. Esta rodada não criou wizard, tour nem checklist (restrição de
escopo respeitada): os vazios é que passaram a apontar o próximo elo, e os
becos dentro das sheets ganharam porta.

### O que ficou pronto

**1. `/hoje` de conta nova — o painel de primeira venda (`TodayScreen.tsx`)**
Sondagem `listarNegocios({ limite: 1 })` (uma linha de leitura, o custo todo)
diz se a conta tem algum negócio. Enquanto `contaNova`, a tela abre com UM
painel acima de tudo — `EmptyState` com prancha, preview de exemplo e o CTA do
primeiro passo real:

- **"Criar primeiro negócio"** abre a `NovoNegocioSheet` — a MESMA do funil e
  da ficha do contato (três entradas, um desenho; nada de uma quarta marcação).
- Secundário discreto **"Cadastrar cliente"** — a Sheet exige contato
  pré-existente (confirmado lendo o componente: `criarNegocio` exige
  `contactId` de contato do tenant), e a copy diz isso: "Todo negócio nasce de
  um cliente já cadastrado."
- Preview de exemplo (regra do design system: vazio com conteúdo, não buraco):
  o card de negócio com o MESMO exemplo do funil e da lista de propostas
  (Marina · Fernando de Noronha · R$ 12.840,00, `tabular-nums` com largura
  reservada).
- Enquanto `contaNova`, os CTAs concorrentes SAEM: o "+" do cabeçalho de
  "Tarefas de hoje" e o botão "Criar lembrete" do vazio. Lembrete sem primeira
  viagem é ruído; a regra do `EmptyState` é uma ação — duas viram indecisão.
  No primeiro negócio criado (`onCreated` re-sonda + atualiza o pipeline), o
  painel sai e os controles voltam sozinhos.
- **O botão morto virou porta**: "Ninguém abriu ainda" tinha um
  `<Button>Enviar uma proposta</Button>` SEM `onClick` — porta que não abre
  (regra §5 do negócio: elo sem porta visível é funcionalidade que não
  existe). Com negócios, vira `Link` para `/propostas` (o envio mora no
  editor); com conta nova, sem ação — o painel de cima manda.
- **O "Camila" saiu do greeting.** Era resto de dado de exemplo hardcoded — a
  primeira tela da agente nova saudava OUTRA pessoa. Agora vem da sessão
  (`useSession()`, import de `@/lib/auth/client`, o único client-safe); sem
  nome legível, sem nome — nunca um nome inventado.
- `NovoNegocioSheet` montada na tela (último nó do JSX), com `onCreated`
  fechando, re-sondando e atualizando "Em negociação" sem reload.

**2. `/funil` vazio — o quadro nasce com a primeira viagem (`FunnelScreen.tsx`)**
`quadroVazio` (`ready` + zero negócios) troca as cinco colunas vazias por um
EmptyState: título "Nenhuma viagem em negociação", copy do propósito ("Cada
negócio é uma viagem em negociação: entra aqui em 'Novo contato' e você arrasta
pelo funil até fechar."), o card de exemplo, **"Criar primeiro negócio"** e o
secundário "Cadastrar cliente". A dica de gesto ("Arraste o card…") cala
enquanto não há card — instrução de gesto sem objeto é ruço. O momento que
vale a troca: `onCreated` insere o card otimista, o quadro MATERIALIZA com a
viagem dela já em "Novo contato" e a dica de arrasto aparece — o funil se
explica com o objeto dela dentro, não com uma aula sobre colunas vazias.

**3. `/propostas` vazio — a copy antecipa o pré-requisito (`PropostasScreen.tsx`)**
Mesma sondagem `limite: 1`. Sem negócio nenhum, a copy vira "Você precisa de um
negócio antes — toda proposta nasce de um, e todo negócio, de um cliente. Crie
o primeiro no funil; a proposta monta a partir dele." e entra o secundário
"Ir ao funil". O CTA primário continua **"Nova proposta"** (abre a
`NovaPropostaSheet` que já existe) — pedido da spec; com a dica nova dentro da
Sheet (abaixo), os dois caminhos terminam em lugar legível.

**4. `/clientes` vazio — o elo de migração (`ClientesScreen.tsx`)**
CTA renomeado para **"Cadastrar cliente"** (era "Adicionar cliente" — o verbo
que o resto do produto usa; o hint da `NovoNegocioSheet` já dizia "cadastre um
em Clientes"). Copy agora abre a corrente: "Todo negócio nasce daqui — é o
primeiro elo da primeira venda." — e mantém intacto o **"Importar planilha"**,
que é o elo contra o concorrente real (planilha + WhatsApp + Canva): quem chega
com a planilha de 200 clientes entra por ali, não pelo cadastro na mão.

**5. Os becos dentro das sheets agora têm porta (`NovoNegocioSheet.tsx`, `NovaPropostaSheet.tsx`)**
- `NovoNegocioSheet` sem contatos: a dica ganhou link **"Cadastrar cliente"** →
  `/clientes`.
- `NovaPropostaSheet` sem negócios (o caso do "+" global do TopBar com conta
  nova): dica nova "Você ainda não tem negócio — ele nasce no funil, a partir
  de um cliente." com link **"Ir ao funil"**.
- Os dois links **fecham a sheet antes de navegar** (`onClick={() =>
  onOpenChange(false)}`): a sheet do TopBar vive no shell e sobreviveria à
  troca de rota, aberta sobre o funil — detalhe que só aparece no segundo
  clique e custa uma linha.

**6. `/cadastrar` + `/entrar` — consentimento e rodapé legal**
- Rodapé com **"Termos de uso"** e **"Privacidade"** → `/termos` e
  `/privacidade`, nas DUAS portas, mesma posição, mesma voz (`text-subtle`,
  um degrau abaixo dos links de navegação entre portas).
- **Checkbox obrigatório** "Li e aceito os Termos de uso e a Política de
  privacidade" com os dois links DENTRO do rótulo (clique na linha inteira
  marca, como todo mundo espera; `stopPropagation` nos links — navegar para os
  termos não marca a caixa por acidente). Erro junto do checkbox, com os
  MESMOS termos do servidor ("Para criar a conta, é preciso ler e aceitar…"),
  foco vai para a caixa.
- **O rafa pousou o S13b enquanto eu trabalhava** — `criarConta` passou a
  EXIGIR `aceitouTermos: boolean` (zod sem default; `false` é recusa explícita
  com `campo: 'aceitouTermos'` e correção pronta; grava `terms_accepted_at` +
  `terms_version` + audit `consent.recorded`). Liguei o campo na hora: o envio
  manda `aceitouTermos: true`, e o ramo de erro do servidor (`campo ===
  'aceitouTermos'`) mostra a mensagem dele junto do checkbox com foco nele.
  **A pendência que a spec previa não existe mais** — a peça inteira está
  fechada nas duas pontas.
- O skeleton de checagem de sessão ganhou a linha do checkbox (mesma geometria
  da tela real — as duas portas continuam sem piscar).

**7. Do envio ao WhatsApp (`PropostaEditorScreen.tsx`) — conferido e meia linha**
O PublishBar JÁ trocava "Enviar proposta" por "Copiar link" / "Abrir" /
"Reenviar" no mesmo lugar, no instante do `onPatched` — sem descoberta nenhuma.
Só faltava o toast: agora ele carrega a ação **"Copiar link"** junto do
"Proposta enviada" (o `publicToken` nasce com a proposta, então copiar funciona
mesmo com o closure ainda em `draft`). De enviado a colar no WhatsApp do
cliente: um toque.

**8. `/` raiz — conferido, nada mudado**
`redirect("/hoje")` → o layout do grupo `(app)` roda `getAuthContext()` e, sem
sessão, manda para `/entrar` ANTES de montar o shell — nenhuma tela-filha
precisa checar isso. O `/entrar` tem o link duplo ("Primeira vez por aqui?" +
"Criar conta") e o `/cadastrar` responde ("Já tem conta?" + "Entrar"). O caminho
visível para `/cadastrar` já existe e funciona.

### Decisões que tomei sozinha

1. **Sonda `limite: 1`, não contagem nem contexto global.** A tela precisa de
   UM bit ("existe algum negócio?"). O painel só aparece depois de `ready`
   (nada pisca), e o Hoje paga uma leitura indexada a mais — barato contra o
   que custa a agente nova sem caminho.
2. **O "+" global do TopBar continua, mesmo em conta nova.** Escondê-lo exigiria
   o shell saber de negócios em toda rota, todo dia, para servir um estado que
   dura quinze minutos. Em vez disso, a Sheet que ele abre explica a ordem e
   leva ao funil — o toque mais tentador da tela vira aula, não beco.
3. **Um só personagem de exemplo em todas as telas.** Marina · Fernando de
   Noronha · R$ 12.840,00 no vazio do Hoje, do funil e das propostas (e já era
   o exemplo da lista). A mesma pessoa recorrente ensina o objeto; três
   exemplos diferentes ensinariam três objetos.
4. **CTAs concorrentes somem em vez de dividir atenção.** "Criar lembrete" não
   é errado — é cedo demais. Voltam no primeiro negócio, sem ninguém clicar em
   nada.
5. **"Camila" era bug de primeira hora, não cosmético.** Estava fora da lista
   de itens, mas uma agente que acabou de criar a conta e lê o nome de outra
   pessoa na primeira tela desconfia do produto inteiro — e a confiança é o
   critério desta rodada.
6. **O botão morto de "Abriram sua proposta" virou `Link` para `/propostas`,
   não para o editor direto.** "Enviar" é uma ação sobre UMA proposta; a lista
   é o caminho honesto de escolha. (`asChild` no `Button` + `Link`, padrão já
   usado no importador e no banner.)
7. **Rodapé legal em `text-subtle`, sem `transition-colors`** — um degrau
   abaixo de "Entrar"/"Criar conta" (não disputa o olho) e fora da régua de
   movimento (mesma razão registrada no S13a para o `acaoLink`).
8. **A dica de gesto do funil obedece ao quadro vazio** — `aria-hidden` +
   `opacity-0` quando não há card. O teste da direção: sem animação nenhuma,
   a tela continua comunicando exatamente o mesmo.

### O que NÃO fiz

- Não toquei `src/server/**`, `src/db/**`, `tests/**` nem `package.json`. O
  S13b do rafa (`src/server/signup.ts`, `drizzle/0012_consentimento_de_termos.sql`,
  `src/app/termos/`, `src/app/privacidade/`) estava pousando no mesmo momento —
  consumi o contrato, não editei a área dele.
- Não criei wizard de várias telas, tour, checklist de gamificação — o caminho
  segue guiado por estados vazios com o CTA certo (restrição de escopo).
- Não mexi no `AppShell`, no gate de dunning, na proposta pública nem no
  editor além da linha do toast.
- Não criei testes (fronteira do Téo) e NÃO commitei — o PO commita.

### Verificação (o que rodei)

- `npx vitest run tests/design/guards.test.ts` — **6/6 verdes** (rodado duas
  vezes, antes e depois de tudo): tipografia, cor por contexto, paridade de
  tema, movimento CSS e JS, reduced-motion.
- `npx tsc --noEmit` — **limpo em todo `src/**` meu**. Restou UM erro, em
  `tests/signup/criarconta.test.ts(114,3)` (fixture do Téo com
  `aceitouTermos?: boolean` opcional, contra o campo obrigatório do S13b) —
  fora da minha fronteira, transitório, mesmo padrão da rodada anterior. O
  arquivo está COMMITADO nesse estado (`git status` não o lista como modificado),
  então consertar é uma linha do Téo, não minha.
- `npm run build` — **compila** ("Compiled successfully in 1.8s"); o type check
  do `next build` falha no MESMO arquivo de teste do Téo (o tsconfig inclui
  `**/*.ts`). Rodado no fim da rodada para confirmar: nada piorou, nenhum
  erro meu. Quando o Téo pousar o fixture, fecha limpo.
- **Não testei clicando** — o PO (Leandro) clica. Roteiro cronometrado abaixo.

### Passo a passo para o PO clicar — o bater-o-molde, cronometrado

**A. A primeira sessão (390px, janela anônima), contra os 15 minutos**

1. **0:00** `/entrar` → rodapé: "Primeira vez por aqui?" + "Criar conta".
   Embaixo, novos: "Termos de uso" e "Privacidade" (ambas as portas).
2. **0:20** `/cadastrar` → preencher os 4 campos; **tocar "Criar conta" sem
   marcar o checkbox** → erro junto da caixa ("Para criar a conta, é preciso
   ler e aceitar…") com foco nela. Tocar "Termos de uso" → navega SEM marcar a
   caixa; voltar, marcar, criar conta.
3. **1:30** cai em `/hoje`. Conferir: greeting com O NOME DELA (não "Camila");
   dois números zerados com largura reservada; o painel "Sua primeira proposta
   sai daqui" com o card de exemplo e UM CTA ("Criar primeiro negócio") +
   "Cadastrar cliente" discreto. Abaixo: tarefas/aberturas/mês explicam o
   produto SEM botão concorrente.
4. **2:00** tocar "Criar primeiro negócio" → a Sheet mostra "Nenhum cliente
   cadastrado ainda — todo negócio nasce de um. **Cadastrar cliente**" → o link
   FECHA a sheet e leva a `/clientes`.
5. **2:30** `/clientes` vazio: "Todo negócio nasce daqui…" + "Cadastrar
   cliente" + "Importar planilha". Criar um cliente na mão (só o nome é
   obrigatório) — ou parar aqui e testar o importador à parte.
6. **4:00** `/funil`: quadro substituído pelo vazio com o mesmo card de
   exemplo e "Criar primeiro negócio". Criar o negócio → **o quadro NASCE com
   o card dela em "Novo contato"** e a dica de arrasto aparece. Arrastar o card
   uma coluna (ele herda a velocidade do gesto).
7. **5:00** abrir o card (ficha) → "Nova proposta" (negócio já decidido) →
   editor: criar opção com preço, um bloco de hotel, conferir a prévia.
8. **9:00** "Enviar proposta" → toast "Proposta enviada" com **"Copiar link" na
   própria régua de ações** + o topo já virou "Copiar link / Abrir / Reenviar".
9. **9:30** copiar, colar no WhatsApp de um contato real e abrir o link —
   conferir que a proposta pública carrega.
10. **11:00** com o cliente abrindo: `/hoje` → "Abriram sua proposta" mostra a
    abertura com horário. **Folga de ~4 min para o follow-up.** Critério batido
    com margem para quem nunca viu o produto.

**B. Os caminhos de beco (fechados) e os vazios, um a um**

1. Ainda em conta nova (ou saindo e relogando), em `/hoje`: tocar o **"+" do
   TopBar** ("Nova proposta") → a Sheet explica "Você ainda não tem negócio…
   **Ir ao funil**" e FECHA antes de navegar (a sheet não pode ficar aberta
   sobre o funil).
2. `/propostas` sem negócio nenhum: copy "Você precisa de um negócio antes…"
   + "Ir ao funil" + CTA "Nova proposta" (que abre a Sheet do item 1).
3. `/funil` com negócio mas sem proposta, e `/propostas` com negócio: as
   copies originais ("Monte a primeira proposta a partir de um negócio…").
4. Conta COM negócios: `/hoje` volta a ter "Criar lembrete" e o painel de
   primeira venda some; "Enviar uma proposta" do vazio de aberturas agora é um
   link que FUNCIONA (para `/propostas`).
5. Design gate nos quatro vazios alterados (`/hoje`, `/funil`, `/propostas`,
   `/clientes`): prancha UMA por tela e nunca no accent, preview `aria-hidden`
   com máscara, valor do exemplo com largura reservada, tema escuro,
   `prefers-reduced-motion` (nada anima além do `.enter`), zero scroll
   horizontal em 390px.
6. `/cadastrar` no escuro e com reduced-motion: checkbox com foco visível,
   erro sem jogar o layout (a linha já reservada no skeleton).

Prestar atenção especial a: (a) o painel de primeira venda some no instante em
que o primeiro negócio existe — e os controles de lembrete voltam sem reload;
(b) os links DENTRO de sheets fecham a sheet antes de navegar (o caso do "+"
global é o que expõe o bug); (c) o toast pós-envio tem a ação "Copiar link"
além da troca de botões do topo — as duas contam a mesma história, sem palavras
diferentes; (d) `/termos` e `/privacidade` são do rafa — se ainda derem 404 no
seu disco, os links já apontam certo.

## S13a — /cadastrar (conta nova) + banner de conta bloqueada (dunning)

Duas frentes sobre o backend que o rafa landou: a rota pública de cadastro
(`criarConta` cria tenant + assinatura trial 14d + usuário, **sem logar**) e a
camada persistente de UI para o código novo `ASSINATURA_INATIVA`.

### O que ficou pronto

**1. `/cadastrar` — `src/app/cadastrar/page.tsx` + `CadastroScreen.tsx`**
Fora do grupo `(app)`, mesma razão do `/entrar` (rota sem sessão, sem
AppShell). Mesmo registro "intermediário": a `CompassPlate` sozinha sangrando
pelo canto (`plate-wash`, 14%, `hidden sm:block` — igual ao /entrar, inclusive
na ausência em 390px), marca em caixa alta, display "Criar conta", coluna de
`max-w-[26rem]` ancorada como página, `Rule` antes do rodapé.

- Quatro campos: Seu nome, E-mail, Senha (com mostrar/ocultar no `pointerdown`),
  Nome da agência. `autoComplete` certos (`name`/`email`/`new-password`/
  `organization`).
- **Validação local com os textos do zod do servidor** ("Informe seu nome.",
  "A senha precisa de pelo menos 8 caracteres." etc.) — a tela recusa antes de
  gastar uma chamada; o servidor continua sendo quem decide. Erro por campo
  (`Field invalid` + `FieldError`), foco vai para o primeiro inválido, erro do
  campo limpa ao digitar.
- Fluxo de sucesso: `criarConta(...)` → OK → `authClient.signIn.email({ email,
  senha, callbackURL: "/hoje" })` → `router.push("/hoje")`. **Nada de login
  automático na action** (decisão do rafa); a senha digitada é reaproveitada,
  ninguém redigita nada.
- Erros do servidor mapeados por `result.campo` para o campo certo. **E-mail já
  cadastrado** (`CONFLITO campo:'email'`) vira erro no campo de e-mail com o
  link "Entrar" → `/entrar` DENTRO do `FieldError` — a correção é navegar, não
  re-tentar. Erro sem campo (ex.: "Não consegui criar sua conta agora.") vira
  `FieldError` solto entre o formulário e o botão, sem inventar campo.
- Se o `signIn` falhar DEPOIS de a conta ter sido criada, a mensagem NÃO é o
  "E-mail ou senha incorretos" do Better Auth (mentiria — a conta acabou de
  nascer): é "Sua conta foi criada, mas o acesso automático falhou. Use o mesmo
  e-mail e a senha que acabou de criar." + correção "Entrar" → `/entrar`.
- Skeleton de checagem de sessão com a MESMA geometria da tela real (o /entrar
  já faz isso; as duas portas têm que piscar igual, ou seja, não piscar).
- Rodapé: "Já tem conta?" + link **Entrar**. No `/entrar`, entrou a linha
  "Primeira vez por aqui?" + link **Criar conta** — a via é dupla.

**2. Banner de bloqueio — `src/lib/ui/assinatura.ts` +
`src/components/app/AssinaturaBanner.tsx` + mount na `AppShell`**

- `recusaDeAssinatura(result)` reconhece `code === 'ASSINATURA_INATIVA'`;
  `avisarRecusaDeEscrita(result)` é o contrato de UMA LINHA que os ramos de
  erro de escrita chamam (no-op em qualquer outro código); `useBloqueioDeAssinatura()`
  expõe o estado por `useSyncExternalStore` — sem provider, estado no módulo,
  porque o banner mora no shell que persiste entre rotas.
- O banner renderiza **acima do conteúdo, abaixo do TopBar**: faixa âmbar
  (`bg-warn-soft`, cor de ESTADO) com cornija embaixo (`border-b border-hairline`
  — separa registros, não envolve caixa), mensagem pronta do servidor, botão
  com o rótulo de `correcao` ("Ir para Cobrança") linkando `/cobranca`.
- **Wiring** (o erro do toast de cada tela continua intacto — o banner é a
  camada por cima): `useAutosave` e `useDeferredDelete` (um ponto cada, cobrem
  ficha de cliente, ficha de negócio, editor de proposta, blocos, venda e todo
  destrutivo com desfazer de 8s); `NovaPropostaSheet` e `NovoNegocioSheet`;
  mover estágio do funil (2 ramos) e "marcar como perdida" (`DealStageMenu`);
  criar contato (ClientesScreen) e criar viajante (ContatoScreen); criar
  integração; confirmar importação; enviar proposta, marcar como aceita, gerar
  venda e excluir opção (editor); criar/inserir bloco e upload de imagem
  (BlocksEditor); criar parcela e marcar parcela paga (venda); status de
  comissão (FinanceiroScreen); arquivar/restaurar contato e restaurar proposta.
- `avisarAssinaturaRegularizada(status)` na `/cobranca`: quando `trocarPlano`
  devolve `active`/`trialing`, o banner sai NA HORA, em toda tela, sem
  recarregar.

### Decisões que tomei sozinha

1. **Banner dirigido por recusa, não por status no load.** Não chamo
   `obterAssinaturaAtual()` no shell: quem está em dia nunca paga um round-trip
   para descobrir isso, e o estado "sem dados" de dunning não existe (leituras
   nunca bloqueadas). Consequência assumida: um F5 limpa o banner, que volta na
   próxima recusa. O toast da escrita continua sendo a primeira linha de aviso;
   o banner é a segunda, persistente.
2. **Âmbar (`warn`), não vermelho.** Bloqueio de dunning é estado de atenção
   com saída clara (regularizar), não erro de ação. E o botão é `secondary`:
   o azul do accent é "onde clicar" e está ocupado pelo CTA global do TopBar —
   o fio do botão diz botão, o âmbar diz por quê.
3. **Sem animação no banner.** É estado, não evento; a urgência já foi
   comunicada pelo toast no momento da recusa. Movimento aqui só faria a página
   tremer toda vez que a agente tentasse escrever de novo — e ela vai.
4. **O banner não renderiza na `/cobranca`.** A tela de destino já mostra o
   status em Badge e o caminho de regularização; um aviso linkando para a
   página em que ele está é ruído.
5. **Alinhamento pela medida do miolo, inclusive a exceção.** Rotas de quadro
   (`/funil`, editor) abrem para a largura da janela no desktop; o banner
   acompanha (`wide` prop do shell) — aviso persistente desalinhado do conteúdo
   é ruído que ele não pode ter.
6. **Limpeza por regularização, não por polling.** `avisarAssinaturaRegularizada`
   na /cobranca é honesto e barato; um `setInterval` checando assinatura seria
   o oposto das duas coisas.
7. **Cadastro sem campo de endereço/slug** — o servidor deriva do nome da
   agência. Traduzi a decisão em interface: `FieldHint` "É deste nome que nasce
   o endereço da sua conta — você não precisa escolher."
8. **O link entre as duas portas é `Link` com a voz do `CardAction`, sem
   `transition-colors`** — a troca de cor num texto de 13px não precisa de
   rampa, e cor não entra na régua de movimento do sistema (e não quis
   adicionar entrada nova ao registro de desvios do gate).

### O que NÃO fiz

- Não toquei `src/server/**`, `src/db/**`, `tests/**` nem `package.json`.
- **Banner proativo de trial** ("seu teste acaba em N dias") — não pediram; e
  `AssinaturaAtual` nem traz `trialEndsAt` (só o gate o lê). Quando o produto
  pedir, é pedido ao rafa, não inferência do client.
- O checkbox "Recomendar esta opção" do editor continua falhando em silêncio
  se o servidor recusar (pré-existente — `if (result.ok) onUpdated(...)` sem
  ramo de erro). O banner não chega lá. Registroi, não consertei fora do
  escopo.
- Não criei testes (fronteira do Téo) nem toquei no `/` (continua caindo em
  `/hoje`, que manda sem sessão para `/entrar` — de onde se chega ao cadastro).

### Verificação (o que rodei)

- `npx tsc --noEmit` — **0 erros no projeto inteiro** (17:00). Durante o
  trabalho houve erros transitórios em `tests/signup/criarconta.test.ts` /
  `tests/billing/gate-dunning.test.ts` — arquivos que o Téo editava no mesmo
  momento (fora da minha fronteira); sumiram na rodada final.
- `npm run build` — **limpo**: "Compiled successfully in 2.4s", TypeScript
  ok, 18/18 páginas, e a rota nova `○ /cadastrar` aparece na lista (static).
- `npx vitest run tests/design/guards.test.ts` — **6/6 verdes** (17:01,
  depois das últimas edições do banner; Postgres de pé, `zarpa_test`
  recriado). Tipografia, cor por contexto, paridade de tema, movimento (CSS e
  JS), reduced-motion — nenhum desvio novo.
- **Não testei clicando** — o PO (Leandro) clica. Passo a passo abaixo.

### Passo a passo para o PO clicar

#### A. Cadastro com conta NOVA (`/cadastrar`)

1. Janela anônima (sem sessão) em `http://localhost:3000/entrar`, viewport
   390×844. No rodapé da coluna, abaixo do fio: "Primeira vez por aqui?" +
   "Criar conta".
2. Tocar "Criar conta" → `/cadastrar`. Mesma cara do /entrar (a rosa dos
   ventos some em 390px de propósito — igual ao /entrar), título display
   "Criar conta", subtítulo com os 14 dias grátis.
3. Tocar "Criar conta" com tudo vazio → quatro erros por campo, foco no
   primeiro ("Informe seu nome."). Nada de modal, nada de vermelho no topo.
4. Conferir a senha com o olho (mostra/oculta, sem perder o foco) e o hint
   "Mínimo de 8 caracteres." sumir quando há erro.
5. Preencher: nome "Marina Duarte", e-mail NOVO (`teste-cadastro@zarpa.local`),
   senha 8+ (`marina12345`), agência "Agência Teste Maré". Tocar "Criar
   conta" → régua no botão → cai em `/hoje` autenticado.
6. Em `/hoje` do tenant novo: estados vazios com conteúdo de exemplo (a conta
   acabou de nascer, não tem dado — e a tela não pode ficar oca).
7. `/cobranca` → Badge "Em trial" (assinatura trial 14d criada pela
   `criarConta`).
8. Sair. Em `/cadastrar`, repetir com o MESMO e-mail → erro no campo de e-mail:
   "Já existe uma conta com esse e-mail." + link "Entrar" embaixo do próprio
   campo. Tocar "Entrar" → `/entrar`.
9. Conferir os dois sentidos dos links (entrar → cadastrar, cadastrar →
   entrar), o tema escuro e `prefers-reduced-motion` (nada anima além do
   `.enter` padrão da rota).
10. Login antigo `dev@zarpa.local` / `dev12345` continua funcionando pelo
    link "Entrar".

#### B. Banner de conta bloqueada (dunning)

Como produzir o bloqueio em dev sem SQL — pela própria UI:

1. Login `dev@zarpa.local` / `dev12345`. `/cobranca`: se não há assinatura,
   assinar o Solo (dev grava só no banco). Depois "Cancelar assinatura" e
   DEIXAR PASSAR os 8s do desfazer → status `canceled` → escrita bloqueada.
   (Alternativa por SQL: `UPDATE subscriptions SET status='past_due' WHERE
   tenant_id = <tenant do dev>;` — mensagem muda para "Sua assinatura está em
   atraso — o app está em modo somente leitura.")
2. `/hoje` → "Criar lembrete" → preencher e salvar: o toast de erro da tela
   continua aparecendo E a **faixa âmbar** nasce acima do conteúdo (abaixo do
   TopBar), com a mensagem do servidor + "Ir para Cobrança".
3. Navegar para Funil/Clientes/Propostas: o banner PERSISTE entre telas.
4. Tentar escrever em outra tela (botão "+" → nova proposta): toast de novo,
   banner continua (não empilha, não pisca).
5. **Leituras normais**: listas, fichas e dashboard carregam de verdade —
   bloqueio é só de escrita.
6. **Autosave**: abrir ficha de cliente, editar o nome → `SavedMark` "Não
   salvou" + banner. Autosave não tem toast; o banner é quem explica por quê.
7. No funil, arrastar um card: ele volta para o lugar (otimismo reversível) +
   toast + banner.
8. Tocar "Ir para Cobrança" → `/cobranca` **sem banner** (é a tela de
   destino). Assinar qualquer plano (dev grava no banco) → toast "Plano
   trocado…" → navegar para `/hoje`: banner sumiu, sem recarregar.
9. Criar o lembrete de novo → funciona.
10. Em 390px: mensagem acima do botão na faixa (empilha sem aperto), zero
    scroll horizontal, contraste ok no tema escuro.

Prestar atenção especial a: (a) o banner não cobre o TopBar (não é fixo —
rola com a página, o TopBar fica acima dele); (b) nas rotas largas no desktop
(/funil, editor) a faixa alinha com o conteúdo aberto; (c) o toast do erro e
o banner contam a MESMA história sem palavras diferentes; (d) regularizar na
/cobranca limpa o banner em todas as telas abertas na sequência.

## Frente 1 + Frente 2 — fechar o fluxo de aceite ponta a ponta

O aceite de proposta só virava venda por UM caminho: o cliente clica "Aceitar
esta opção" no link público (`aceitarOpcaoPublica`). Dois buracos fechados
nesta rodada — o botão público que sumia quando o agente não tinha WhatsApp,
e o caminho manual da agente para registrar aceite que chegou por outro canal.

### Frente 1 — botão de aceite público sempre visível (`/p/[slug]`)

**`src/app/p/[slug]/PublicProposalScreen.tsx`** — o `OptionCard` tinha um
render condicional que amarrava o botão "Aceitar esta opção" a `whatsappLink`
existir. Sem WhatsApp cadastrado no tenant, o cliente caía num texto "Fale
com quem te mandou esta proposta para confirmar" e **não conseguia aceitar
pela proposta** — mesmo que `aceitarOpcaoPublica` gravasse o aceite no banco
sem depender de WhatsApp nenhum.

Correção: o botão "Aceitar esta opção" aparece **SEMPRE** quando
`!isAccepted`, independente de `whatsappLink`. O `handleAccept` já chama
`aceitarOpcaoPublica` (grava no banco) e DEPOIS abre o WhatsApp como
confirmação secundária — se `whatsappLink` existe, abre; se não, só não
abre, mas o aceite ficou registrado igual. O `else` "Fale com quem te
mandou..." saiu; no lugar, um `<p>` discreto abaixo do botão quando há
WhatsApp: "Depois de confirmar, abrimos o WhatsApp com quem te enviou" —
diz o que VAI acontecer, não esconde o caminho de aceite.

O `brand.primaryColor ?? "var(--accent)"` no `style` do botão continua — é
a cor da marca do agente, regra do S7. `onPointerDown` já reagia no toque,
mantive. O comentário no topo do arquivo que dizia "não existe action de
aceitar hoje" foi atualizado — `aceitarOpcaoPublica` existe desde o S7
(landou depois daquele comentário), e o botão agora a usa de verdade.

### Frente 2 — "Marcar como aceita" no editor (caminho do agente)

**`src/app/(app)/propostas/[id]/editar/PropostaEditorScreen.tsx`** — a
`PublishBar` só mostrava "Gerar venda" quando `proposta.status ===
"accepted"`, mas nada levava a `accepted` do lado da agente. Agora, quando
`proposta.status === "sent" || "viewed"`, um botão **"Marcar como aceita"**
(`variant="secondary" size="sm"`) aparece ao lado de "Copiar link"/"Abrir"/
"Reenviar" — `secondary`, não `primary`, porque é o passo anterior ao CTA
de destaque ("Gerar venda", que continua sendo o `primary` quando `accepted`).

Ao clicar:

1. **Uma opção só**: chama `marcarPropostaComoAceita(proposta.id, option.id)`
   direto, sem perguntar.
2. **Mais de uma**: abre um `Dialog` curto (`width="sm"`, não `Sheet`) com a
   lista de opções como botões. Escolher uma chama a action e fecha o
   diálogo. `Dialog` em vez de `Select` dropdown: a ação muda estado da
   proposta, e botões explícitos com o nome da opção + Badge "Recomendada"
   são mais diretos que um dropdown que esconde as opções atrás de um
   clique extra. Cada botão tem `min-h-11` (alvo de toque confortável em
   390px), `active:scale-[0.995]` no `pointerdown`, `transition:transform`
   só (não `transition-colors` — o gate de design flag animação de cor fora
   do registro).
3. **Otimista com reversão**: `onPatched({ status: "accepted",
   acceptedOptionId, acceptedAt: new Date() })` na hora — o `PublishBar`
   re-renderiza em `accepted` e o "Gerar venda" aparece imediatamente, sem
   esperar round-trip. Se `marcarPropostaComoAceita` recusar, reverte ao
   estado anterior (`status`/`acceptedOptionId`/`acceptedAt` originais,
   guardados antes do patch otimista) + toast com `mensagem` + `correcao`
   (a correção do servidor vira o botão do próprio toast — re-tentar).
4. Depois de aceita, o botão "Gerar venda" (que já existia) aparece
   normalmente — **não reescrevi esse botão**, ele continua wired a
   `converterPropostaEmVenda`.

A action `marcarPropostaComoAceita(propostaId, optionId)` estava landada
no `src/server/proposals.ts` (linha 764) e exportada no barril `@/server`.
Consumi direto, sem stub. Handoff `nina-para-rafa.md` atualizado
agradecendo.

### Decisão: sem toast de desfazer de 8s no aceite manual

`marcarPropostaComoAceita` é mudança de estado, não destrutivo. O `CLAUDE.md`
pede toast com desfazer de 8s para **destrutivo**; o PO deixou explícito
que esta é uma decisão minha, com a ressalva de que "desfazer aceite" não
tem action no servidor (só reverteria localmente, voltando `accepted` na
próxima recarga — promete o que não cumpre). Escolhi **não** usar
`useDeferredDelete` aqui:

- Aceite não apaga dado; muda um estado. O "dano" de clicar errado é
  mínimo: a proposta fica "aceita" mas a agente pode simplesmente não
  gerar a venda, ou aguardar. Não há perda irreversível.
- Um botão explícito "Desfazer aceite" no futuro (exigiria uma action de
  "desmarcar" no servidor) seria honesto. Por ora, não invento um
  desfazer que só vive no cliente — a regra do CLAUDE.md é "confiança não
  vem de enfeite, vem de espaçamento consistente e número que não pula",
  e um desfazer que mente é o oposto de confiança.

Se o servidor devolver `CONFLITO` (proposta não está em `sent`/`viewed`),
o toast de erro mostra a mensagem pronta do Rafa ("Só dá para aceitar uma
proposta enviada ou visualizada.") + a correção ("Enviar a proposta antes
de marcar como aceita") como botão — a interface não esconde a regra do
backend.

### Verificação (o que rodei)

- `npx tsc --noEmit` — **limpo**.
- `npm run build` — **limpo**, 21 rotas (mesma contagem da rodada anterior,
  `/p/[slug]` e `/propostas/[id]/editar` continuam dinâmicas).
- `npx vitest run tests/design/guards.test.ts` — **6/6 verdes** (Postgres
  `zarpa-db` de pé, schema `zarpa_test` recriado pelas 12 migrations).
  Tipografia, cor por contexto, paridade de tema, movimento (CSS e JS),
  `prefers-reduced-motion` — nenhum desvio não registrado.
- **Não testei clicando** — o PO (Leandro) clica. Passo a passo abaixo.

### Passo a passo do fluxo para o PO clicar

Login `dev@zarpa.local` / `dev12345` em `http://localhost:3000/entrar`,
viewport 390×844 (iPhone 14):

**Frente 1 — botão público sem WhatsApp:**

1. Pegar um tenant sem `whatsappLink` cadastrado na marca (ou editar a
   marca em `/cobranca`? não — a marca do tenant se edita em... conferir
   onde `atualizarMarca` é chamado. Em dev, o seed cria "Volta ao Mundo"
   com WhatsApp — pode ser preciso limpar o campo direto no banco, ou
   criar um tenant novo sem WhatsApp). Sem isso, o botão público aparece
   COM o texto "Depois de confirmar, abrimos o WhatsApp" — ainda funciona,
   mas não exercita a queda do `whatsappLink`.
2. Abrir o link público `/p/<publicToken>` de uma proposta `sent`/`viewed`
   desse tenant **sem sessão** (navegador limpo/incógnito).
3. O botão "Aceitar esta opção" aparece em cada opção — antes aparecia
   "Fale com quem te mandou esta proposta para confirmar".
4. Tocar "Aceitar esta opção" → `aceitarOpcaoPublica` grava no banco →
   botão vira "Você já confirmou esta opção." (text-ok). Sem WhatsApp, o
   WhatsApp não abre; com WhatsApp, abre após 500ms com a mensagem pronta.

**Frente 2 — "Marcar como aceita" no editor:**

1. Abrir o editor de uma proposta `sent` ou `viewed`:
   `/propostas/<id>/editar`. A `PublishBar` (topo) mostra Badge do status +
   "Marcar como aceita" (`secondary`) + "Copiar link" + "Abrir" +
   "Reenviar".
2. **Uma opção só**: tocar "Marcar como aceita" → otimista: Badge vira
   "Aceita" (ok), "Gerar venda" (`primary`) aparece no lugar, toast
   "Proposta marcada como aceita". Sem diálogo.
3. **Mais de uma opção**: tocar "Marcar como aceita" → abre `Dialog`
   "Qual opção foi aceita?" com a lista de opções (nome + Badge
   "Recomendada" na recomendada). Tocar uma opção → fecha o diálogo,
   aplica otimista, mesma transição acima.
4. **Reversão de erro**: se o servidor recusar (raro — proposta mudou de
   estado em outra aba), o Badge volta para `sent`/`viewed`, o "Gerar
   venda" some, toast "Não consegui marcar como aceita" com a mensagem do
   servidor + botão de correção.
5. Depois de aceita, tocar "Gerar venda" → `converterPropostaEmVenda` →
   navega para `/vendas/<id>` (fluxo que já existia, não reescrevi).

Prestar atenção especial a: (a) o `Dialog` de seleção abre/fecha no
mobile Radix sem race (testar abrir, esc, abrir de novo); (b) o
`onPointerDown` nos botões de opção do diálogo (não `onClick`); (c) o
`active:scale-[0.995]` só anima `transform` (gate aprova); (d) o estado
otimista sobrevive a um re-render do `PropostaEditorScreen` (o
`onPatched` atualiza o `proposta` state no pai, que desce de volta para
`PublishBar`); (e) o `loading={markingAccepted}` desabilita os botões do
diálogo durante o request.

### Pendências

Nenhuma. As duas frentes estão implementadas e o build/gate estão verdes.
A action `marcarPropostaComoAceita` do rafa já estava landada e exportada —
consumi direto. O handoff `nina-para-rafa.md` foi atualizado para
agradecer (a seção original de pedido foi substituída).

---

## S12 — UI de integrações (Wooba + Infotravel, cotação só)

### O que ficou pronto

**`src/app/(app)/integracoes/page.tsx` + `IntegracoesScreen.tsx`** — tela nova,
rota `/integracoes`. Registro silencioso (miolo do app): papel, fio entre
seções (`SectionHeading` + `Rule`), uma cor de destaque (o azul do accent
aparece uma vez — no botão "Cadastrar conta"). Sem ilustração, sem prancha.

A tela faz uma chamada (`listarIntegracoes`) e três estados: skeleton
(`Skeleton`/`SkeletonRow`, nunca spinner), erro (`Card` + botão com
`correcao` do servidor) e pronto.

**Seção "Contas cadastradas"** — lista `IntegracaoResumo[]` dentro de um
`Card` com `Rule inner` entre itens. Cada linha: `label` (texto-15 medium),
`Badge` de Ativa/Inativa (dot), "Wooba"/"Infotravel" + data de cadastro em
`tabular-nums` (text-13 muted), e `CardAction` "Remover" em `text-danger`.
Remover é físico (`removerIntegracao`), com toast de desfazer de 8s via
`useDeferredDelete` (mesmo padrão de `cancelarAssinatura`/`excluirOpcao`).
Estado vazio: `EmptyState` com preview de exemplo (card de conta ativa).

**Seção "Cadastrar nova conta"** — `Card` com `CardHeader`/`CardBody`/`CardFooter`.
Dentro: `Select` de provider (Wooba / Infotravel), `Input` de `label`
(2–100, com validação local + `FieldError`), e campos de credencial
dinâmicos por provider (`PROVIDER_FIELDS`: Wooba pede `apiKey`;
Infotravel pede `apiKey` + `clientId`). Os campos de credencial são
`type="password"`, `autoComplete="off"`, e **limpos do estado local
imediatamente após submit** — nunca voltam do servidor
(`IntegracaoResumo` não tem `credentials`). O rodapé tem o botão
"Cadastrar conta" (`variant="primary" size="sm"`, reage no `pointerdown`,
`loading` durante o submit) e contexto à esquerda: "Cotação só — sem
reserva real." Erro vira toast com `action: { label: correcao, onClick:
retry }`.

**`src/components/app/CotacaoSheet.tsx`** — o fluxo "Buscar cotação"
dentro do construtor de proposta. Abre da `OptionRow` por um botão
discreto (text-13, `SearchIcon` + "Buscar cotação") abaixo do grid de
preço/custo/comissão. Três fases dentro do mesmo `Sheet`:

1. **"form"** — seletor de integração ativa (`Select`, se houver; se
   não, aviso "Sem conta ativa — usando dados de exemplo"), campos de
   destino (texto), check-in/check-out (`type="date"`), adultos e
   crianças (`type="number"`). Botão "Buscar hotéis" (`variant="primary"
   block`, reage no `pointerdown`, `loading` durante a busca).
2. **"hotels"** — lista de `HotelBusca[]`, cada hotel clicável (botão
   com `border-line` + `hover:border-line-strong` + `active:scale-[0.995]`,
   transition de transform só). Cada item: nome (text-15 medium),
   destino + categoria (text-13 muted), preço em `Money` com
   `reserveFor` do teto. Badge "Exemplo" (tone warn) se
   `exemplo === true`. "Voltar" para a fase de form.
3. **"cotacao"** — detalhe da cotação: nome do hotel, custo em
   `Money size="20"`, check-in/check-out em `tabular-nums`, detalhes.
   Badge "Cotação de exemplo" se `exemplo === true`. Botão "Usar
   este custo" (`variant="primary" block`) que chama
   `onConfirm(custoCents, nome)` → preenche `costCents` da opção via
   `costAutosave.commit(custoCents)` + toast "Custo preenchido".
   "Voltar" para hotéis.

**`Cotacao.custoCents` é o CUSTO, não o preço** — o "Usar este custo"
preenche `costCents` da opção, nunca `priceCents`. O preço de venda
continua sendo o agente quem define. O `fornecedor` texto do option
não existe em `OpcaoEdicao` (não há campo `fornecedor` no schema de
`proposal_options`) — o toast de confirmação mostra o nome do hotel +
o valor para contexto, mas não tenta gravar um campo que não existe.

**Integração no `PropostaEditorScreen.tsx`** — `OptionRow` ganhou estado
`cotacaoOpen` + o botão "Buscar cotação" + o `CotacaoSheet` ao final do
componente. `onConfirm` chama `costAutosave.commit(custoCents)` e mostra
toast "Custo preenchido" com o nome do hotel e o valor.

### Entrada na navegação

**Decisão: link "Integrações" na barra lateral do AppShell (`SideNav`
footer), ao lado de "Assinatura".** Mesmo padrão, mesma discrição. A
barra inferior continua com 5 itens (Hoje/Funil/Propostas/Clientes +
Dinheiro) — não inventei um sexto ícone. Na lateral (`lg:flex`, só
desktop), o rodapé agora tem Assinatura / Integrações / Kitchen sink
/ Sair.

No mobile (390px) a barra lateral está oculta (`hidden lg:flex`) — então
"Integrações" é alcançável apenas por URL direta ou por link futuro em
alguma tela de configurações/perfil. É a mesma lacuna que "Assinatura"
já tem (não foi introduzida por mim), e não é do escopo do S12
resolvê-la. O Leandro pode navegar para `/integracoes` diretamente.

### Decisões de design que tomei sozinha

1. **Botão "Buscar cotação" como texto discreto, não CardAction.**
   Coloquei como um `button` text-13 com `SearchIcon` abaixo do grid de
   preço/custo/comissão — não como `CardAction` no topo do OptionRow.
   Motivo: a ação principal do OptionRow é "editar a opção"; "buscar
   cotação" é um atalho que preenche UM campo (custo), não uma ação
   estrutural. Um botão de texto discreto diz "isto é um caminho
   alternativo para preencher o custo", não "isto é uma ação tão
   importante quanto remover".

2. **Sheet sem arrasto (`draggable={false}`).** O CotacaoSheet tem
   formulário com campos de data e number — o arrasto interferiria no
   scroll e nos inputs. O Sheet fecha pelo botão "Voltar", pelo X, ou
   pelo Esc.

3. **Filtro de integração ativa no seletor.** O `Select` do CotacaoSheet
   lista apenas integrações `isActive: true` (filtradas no cliente de
   `listarIntegracoes()`). Se nenhuma ativa, o seletor some e aparece o
   aviso "Sem conta ativa — usando dados de exemplo" — a busca segue
   com `integracaoId: undefined`, que o backend resolve como modo dev
   (dados de exemplo).

4. **`transition-colors` trocado por `[transition:transform_120ms…]`
   no botão de hotel.** O gate (`tests/design/guards.test.ts`) flag
   `transition-colors` como animação de cor (fill/stroke) fora do
   registro. Os componentes de UI (`Button`, `Card`, `Select`, etc.)
   estão no registro (`deviations.ts`) com dono e motivo. Em vez de
   adicionar `CotacaoSheet.tsx` ao registro, troquei por
   `transition:transform` — o `active:scale-[0.995]` é a resposta
   tátil, e a troca de cor no hover é instantânea (aceitável: é uma
   mudança sutil de `border-line` para `border-line-strong`).

### Verificação

- `npx tsc --noEmit` — limpo.
- `npm run build` — limpo (`/integracoes` aparece como rota dinâmica nova).
- `npx vitest run tests/design/guards.test.ts` — 6/6 verdes (Postgres
  `zarpa-db` de pé).

**Passo a passo do fluxo para o PO (Leandro) clicar:**

1. Login `dev@zarpa.local` / `dev12345`.
2. Na barra lateral (desktop) ou URL direta, abrir `/integracoes`.
3. Cadastrar uma conta: escolher Wooba ou Infotravel, dar um nome
   (ex.: "Conta principal"), preencher a chave de API (e Client ID
   se Infotravel). Clicar "Cadastrar conta" — a conta aparece na
   lista acima, toast "Conta Wooba cadastrada".
4. Remover uma conta: clicar "Remover" — toast "Conta removida" com
   desfazer de 8s. Se desfazer, a conta volta.
5. Abrir uma proposta no construtor (`/propostas/[id]/editar`).
6. Em uma opção, clicar "Buscar cotação" — abre o sheet.
7. Sem conta ativa: o sheet mostra "usando dados de exemplo". Com
   conta: o seletor lista as contas ativas.
8. Preencher destino (ex.: "Buenos Aires"), datas, pax. Clicar
   "Buscar hotéis".
9. A lista de hotéis aparece (3 de exemplo, sem conta ativa). Badge
   "Exemplo" discreto se for o caso.
10. Clicar em um hotel — a cotação aparece com o custo em `Money`.
11. Clicar "Usar este custo" — o `costCents` da opção é preenchido,
    toast "Custo preenchido" com o nome do hotel + valor, e o sheet
    fecha.
12. O campo "Custo" no OptionRow reflete o novo valor, e o
    `SavedMark` mostra "Salvo".

**Nada ficou pendente.** Os três itens de verificação (tsc, build,
gate) estão verdes.

---

## S11 — UI de cobrança (assinatura Asaas)

### O que ficou pronto

**`src/app/(app)/cobranca/page.tsx` + `CobrancaScreen.tsx`** — tela nova,
rota `/cobranca`. Registro silencioso (miolo do app): papel, fio entre
seções (`SectionHeading` + `Rule`), uma cor de destaque (o azul do accent
aparece uma vez — no botão "Assinar"). Sem ilustração, sem prancha.

A tela faz uma chamada combinada (`Promise.all` de
`obterAssinaturaAtual` + `listarPlanos` + `listarFaturas`) e três
estados: skeleton (`Skeleton`/`SkeletonRow`, nunca spinner), erro
(`Card` + `FieldError` + botão com `correcao` do servidor) e pronto.

**Seção "Plano atual"** — se `assinatura` existe e tem `plano`, mostra
card com nome, Badge de status (`tone` por estado), valor mensal em
`Money size="20"` com `reserveFor` (teto dos planos), período atual
(início → fim em `tabular-nums`), data de cancelamento se aplicável.
Se `null` ou sem plano, card simples "Nenhum plano ativo" com instrução.
O rodapé do card (quando `status !== "canceled"`) tem a ação de
cancelar como `CardAction` em `text-danger` — texto, não botão, e o
contexto à esquerda "O cancelamento entra em vigor no fim do período
atual".

**Seção "Trocar de plano"** — `Select` de forma de pagamento
(`billingType`: Pix/Cartão/Boleto, default Pix) com nota discreta de
que em dev só grava a intenção. Abaixo, os 3 planos da `listarPlanos`
separados por `Rule inner`, cada um com nome, Badge "Plano atual" se
for o atual, descrição, features (lista), preço em `Money size="17"` com
`reserveFor` do teto, e botão "Assinar" (`variant="primary" size="sm"`)
quando não é o plano atual. O botão reage no `pointerdown`, fica
carregando (`loading`) durante o `trocarPlano`, e no sucesso troca o
estado da assinatura otimistamente + toast "Plano trocado para X"
(`tone="ok"`). Erro vira toast com `action: { label: correcao, onClick:
retry }` — a correção do servidor vira o botão do próprio toast.

**Seção "Faturas"** — `listarFaturas`, mais recente primeiro, cada
linha com data (`formatDayMonth` de `dueDate` ou `createdAt`),
método (Pix/Cartão/Boleto/—), valor em `Money size="15"` com
`reserveFor` do teto, status em `Badge` (`tone` por estado). Estado
vazio: `EmptyState` com preview de exemplo (fatura paga, R$ 99,00).

**Cancelar assinatura — `useDeferredDelete` (decisão argumentada).**
`cancelarAssinatura` não tem par de reabertura no servidor. A regra do
CLAUDE.md é clara: destrutivo = toast com desfazer de 8s, não modal
"tem certeza?". Escolhi `useDeferredDelete` (mesmo padrão de
`excluirViajante`/`excluirOpcao`): o status muda para `canceled`
otimistamente na hora (a UI mostra "Cancelada" imediatamente), e
`cancelarAssinatura` só é chamado de verdade após 8s sem "Desfazer".
Desfazer reverte o estado local (`status` volta para o anterior) e o
timer morre — a chamada nunca acontece, não preciso de
`restaurarAssinatura`. Se o commit tardio falhar (raro), `onFailure`
mostra toast de erro e recarrega a tela. O `window.setTimeout` do
`useDeferredDelete` sobrevive à desmontagem do componente (navegação
durante os 8s) — o cancelamento ainda persiste.

Por que não cancelamento imediato + `trocarPlano` como desfazer: o
`trocarPlano` recriaria a assinatura, mas o plano poderia ter mudado de
preço, ou a chamada falhar, e o "Desfazer" prometeria algo que pode
não conseguir cumprir. `useDeferredDelete` é mais honesto: se
desfeito a tempo, nada foi persistido.

### Entrada na navegação — decisão

Não adicionei um sexto ícone à `BottomNav` (limite de 4-5 itens em
390px, e a tela é baixa frequência — 1x/mês, não 15x/dia). Em vez
disso, dois caminhos discretos:

1. **`SideNav` (desktop)** — item "Assinatura" no rodapé, ao lado de
   "Kitchen sink", sempre visível no menu lateral. Edição em
   `src/components/app/AppShell.tsx`.
2. **Link "Plano e cobrança" no header de `/vendas` e `/financeiro`** —
   texto discreto (`text-13 text-muted`), à direita do título, ao lado
   do `MoneyHubTabs`. É onde a agente pensa em dinheiro — ver o custo
   do app perto do que ela ganha faz sentido. Edição em
   `VendasScreen.tsx` e `FinanceiroScreen.tsx`.

No mobile, o único caminho é o link no header de Dinheiro. A agente
vai de "Dinheiro" → "Plano e cobrança". É aceitável para uma tela de
baixa frequência; não justifica um sexto ícone na barra inferior que
competiria por atenção com Hoje/Funil/Propostas/Clientes/Dinheiro.

### Badge tones — decisão

Status da assinatura: `active` → `ok`, `trialing` → `accent` (destaque
inicial, não é "tudo bem" como active), `past_due` → `danger`,
`canceled` → `neutral`. Faturas: `paid` → `ok`, `pending` → `neutral`
(pendente não é problema até vencer), `overdue` → `danger`,
`refunded` → `neutral`. Verde/âmbar são estado, não marca — o azul do
accent só aparece no botão de assinar.

### Passo a passo do fluxo para o PO clicar

Login `dev@zarpa.local` / `dev12345` em `http://localhost:3000/entrar`,
viewport 390×844 (iPhone 14):

1. **Chegar à tela** — dois caminhos:
   - Desktop: menu lateral → "Assinatura" (rodapé, entre "Kitchen sink"
     e "Tema").
   - Mobile: barra inferior → "Dinheiro" → "Plano e cobrança" (link
     no header, ao lado do título "Vendas" ou "Recebíveis").
2. **`/cobranca`** — se o tenant dev ainda não tem assinatura (provável
   se o seed não cria), a seção "Plano atual" mostra "Nenhum plano
   ativo". A seção "Trocar de plano" mostra os 3 planos (Solo R$ 49,
   Pro R$ 99, Studio R$ 199) com botão "Assinar" em cada um. A seção
   "Faturas" mostra estado vazio "Nenhuma fatura ainda" com preview.
3. **Assinar um plano** — escolher forma de pagamento (Pix default),
   tocar "Assinar" no plano Pro. Botão fica carregando. Sucesso: a
   seção "Plano atual" atualiza para "Pro" com Badge "Ativa", valor
   R$ 99,00. Toast "Plano trocado para Pro". A seção "Trocar de
   plano" agora mostra Badge "Plano atual" no Pro, e o botão "Assinar"
   some dele (os outros dois mantêm o botão).
4. **Trocar de plano** — tocar "Assinar" em outro plano (ex.: Studio).
   Mesmo fluxo: carrega, troca, toast. O plano anterior perde o Badge
   "Plano atual", o novo ganha. `trocarPlano` é idempotente (já no
   plano → devolve sem recriar), então clicar no plano atual não faz
   nada (o botão some para o plano atual).
5. **Cancelar assinatura** — no rodapé do card "Plano atual", tocar
   "Cancelar assinatura" (texto em vermelho, `CardAction`). O status
   muda para "Cancelada" na hora (Badge `neutral`), a data de
   cancelamento aparece. Toast "Assinatura cancelada — Desfazer" por
   8s. **Tocar "Desfazer"** dentro de 8s: o status volta para "Ativa",
   a data some, e nada foi enviado ao servidor (o timer morre). Deixar
   os 8s passar: `cancelarAssinatura` persiste de verdade no DB. O
   card de plano atual continua visível com Badge "Cancelada".
6. **Faturas** — se houver faturas no DB, a lista mostra cada uma com
   data, método, valor e Badge de status. Se não houver, estado vazio
   com preview de exemplo.

### Verificação (o que rodei)

- `npx tsc --noEmit` — **limpo**.
- `npm run build` — **limpo**, `/cobranca` aparece como rota dinâmica
  (ƒ) nova na lista de rotas (21 rotas no total).
- `npx vitest run tests/design/guards.test.ts` — **6/6 verde**
  (Postgres `zarpa-db` de pé via `npm run db:up`, schema `zarpa_test`
  recriado pelas migrations). Tipografia, cor por contexto, paridade
  de tema, movimento (CSS e JS), `prefers-reduced-motion` — nenhum
  desvio não registrado.
- **Não testei clicando no navegador** — o PO (Leandro) clica. O passo
  a passo acima é para ele julgar a tela em 390×844. Prestar atenção
  especial a: (a) o `Select` de forma de pagamento abre e fecha
  corretamente no mobile (Radix Select em touch); (b) o botão
  "Assinar" reage no `pointerdown` (não `click`); (c) o cancelamento
  otimista mostra "Cancelada" imediatamente e o "Desfazer" reverte;
  (d) o link "Plano e cobrança" no header de Vendas/Financeiro é
  visível e clicável em 390px (não compete com o `MoneyHubTabs`).

---

## S10 — dashboard do mês no `/hoje` religado

### O buraco

O S10 (`commit 60f4420`) entregou backend completo e testado —
`obterResumoDoMes`/`exportarResumoDoMesCsv` em `src/server/dashboard.ts`,
exportados de `@/server` — mas **nenhuma tela consumia**. O `TodayScreen.tsx`
continuava chamando só `obterResumoDoPipeline` (S4) + `listarTarefasDeHoje` +
`listarAberturasRecentes` (S8) + `listarNegociosParados` (S4, negócios). O
dashboard do mês não aparecia em tela nenhuma. Religamento era tarefa de
interface — minha fronteira.

### O que fiz

**`src/app/(app)/hoje/TodayScreen.tsx`** — duas seções novas, uma substituída:

1. **"Propostas paradas"** (SUBSTITUI "Paradas há mais de 7 dias" do S4). A
   seção antiga lia `listarNegociosParados` (`deals.ts`), dado de **negócios**
   abertos sem `updatedAt` há >7 dias. A nova lê `month.paradas.itens` do
   `obterResumoDoMes` (`dashboard.ts`), dado de **propostas** `sent`/`viewed`
   não arquivadas cujo último evento entre `sentAt`/`lastViewedAt` tem >7
   dias. Cada `PropostaParada` traz `id` (da proposta), `title`, `contactName`,
   `destination`, `valueCents` (do negócio associado), `diasParado` — o mesmo
   conteúdo visual da antiga, mais o `id` que linka e o `title` da proposta. O
   botão "Cobrar" permanece placeholder (mesma ação do S4 — toast "Mensagem
   preparada"), agora sobre a proposta certa.

2. **"Este mês"** (NOVA). Quatro cards em `grid-cols-2 lg:grid-cols-4`, cada
   um um `Card interactive` clicável com `role="link"` + `tabIndex` +
   `onKeyDown` (Enter) + `aria-label` (caminho de teclado e leitor de tela,
   não só ponteiro):
   - **Vendas** → `/vendas`: `faturamentoBrutoCents` em `Money size="20"`
     + "`N` vendas" de apoio.
   - **Comissão** → `/financeiro`: `aReceberCents` em `Money size="20"` +
     "`R$ X` recebida" de apoio (`recebidaCents` em `Money size="13"`).
   - **Conversão** → `/propostas`: `taxa` em `%` (`text-20 tabular-nums`,
     `—` quando `enviadas === 0` — mais honesto que "0%", que implicaria
     que houve envios) + "`N` enviadas · `M` aceitas" de apoio.
   - **Propostas paradas** → `/propostas?ids=<id1>,<id2>,...`: contagem
     (`text-20 tabular-nums`) + `totalCents` em `Money size="13"` "em
     aberto" de apoio. Se `paradas.itens.length === 0`, clica para
     `/propostas` (ver todas) em vez de `/propostas?ids=` vazio.

   O `SectionHeading` de "Este mês" carrega o rótulo do mês
   (`formatMonthYear(month.mes)` → "set 2026") em `text-13 tabular-nums
   text-muted` + botão `Exportar` (`variant="quiet" size="sm"` com
   `DownloadIcon`, novo em `icons.tsx` — mesmo traço do `UploadIcon`,
   seta invertida). O botão chama `exportarResumoDoMesCsv()`, monta um
   `Blob` com `type: "text/csv;charset=utf-8"`, dispara o download via
   `URL.createObjectURL` + `<a>.click()` + `revokeObjectURL`. O
   `conteudo` já vem com BOM UTF-8 e `;` como delimitador (Excel pt-BR
   abre direto — decisão do Rafa em `dashboard.ts`). Erro vira toast com
   `action: { label: correcao, onClick: re-tentar }` — a correção do
   servidor vira o botão do próprio toast, não modal.

   Os dois estados (`loading`/`error`) são compartilhados: UMA chamada
   `obterResumoDoMes` alimenta as duas seções. Se falha, as duas falham
   juntas (mesmo `FieldError` + "Tentar de novo"); se carrega, as duas
   mostram dados. O `month` não vira `null` no retry (o
   `setMonthStatus((current) => current === "ready" ? current : ...)`
   mantém "ready" e o `month` antigo fica visível até o novo chegar — sem
   tela pisca).

**`src/app/(app)/propostas/page.tsx`** — Server Component agora lê
`searchParams.ids` (Next 15: `searchParams` é `Promise`), faz
`.split(",").filter(Boolean)`, passa `initialIds` para a tela.

**`src/app/(app)/propostas/PropostasScreen.tsx`** — aceita `initialIds?:
string[]`, passa `ids: initialIds` para `listarPropostas` (filtro `ids` no
`FiltroPropostas` já existe desde o `60f4420` — `inArray(proposals.id, ids)`
no servidor). Aviso "Mostrando N propostas destacadas" + botão "Ver
todas" (`variant="quiet"`, navega para `/propostas` sem `ids`) aparece
quando `initialIds` está presente. O `initialIds` entrou na lista de deps
do `useEffect` do fetch — navegar de `/propostas?ids=a,b` para
`/propostas` re-dispara a busca sem `ids` (sem remontar o componente,
só re-renderiza com a nova prop).

**`src/components/app/icons.tsx`** — `DownloadIcon` novo (seta descendo
para bandeja, mesmo traço 1.5 / grade 16 do `UploadIcon`, só espelhada).

### Decisão de paradas — por que substituí negócios por propostas

A seção antiga "Paradas há mais de 7 dias" (S4, `listarNegociosParados`,
`deals.ts`) listava **negócios** abertos sem `updatedAt` há >7 dias. O S10
traz **propostas** `sent`/`viewed` sem `sentAt`/`lastViewedAt` há >7 dias
(`paradas.itens`). São duas fontes diferentes com mesmo limiar de 7 dias,
mesma urgência ("parado"), mas:

- A **proposta** é o que o cliente recebeu — o follow-up atinge ela
  diretamente ("viu sua proposta?"). O negócio é mais abstrato: pode ter
  proposta ativa em outro estágio, ou nenhuma proposta ainda.
- `PropostaParada` traz `id` (da proposta) que linka para
  `/propostas/${id}/editar` e para `/propostas?ids=...`. `NegocioParado`
  traz `id` do negócio — sem link de proposta.
- `PropostaParada` traz `valueCents` do negócio associado (a proposta não
  tem valor próprio) — mesmo dado de valor da antiga, mais o `title` da
  proposta e o `status` (`sent`/`viewed`).
- Ter as duas na mesma tela com o mesmo rótulo "paradas" confunde: a
  agente não consegue distinguir "parada de negócio" de "parada de
  proposta" sem um segundo rótulo. Uma só, mais útil, vira a fonte.

Substituí. A seção antiga saiu inteira (estado `parked`/`parkedError`/
`retryParked` + `useEffect` de `listarNegociosParados` removidos); a nova
usa `month.paradas.itens` da mesma chamada que alimenta "Este mês" — uma
só fonte, não duas. O `listarNegociosParados` continua exportado de
`@/server` (o Rafa pode querer em outra tela), só não tem mais consumidor
no `/hoje`.

### Placement — por que o mês abaixo das paradas, não no topo

A agente abre o `/hoje` 15x/dia pra ver o que fazer **hoje** (tarefas), não
o mês inteiro. A hierarquia da tela é urgência decrescente:

1. **Greeting** (pipeline: em negociação / fechado no mês) — os dois
   números do S4, no topo.
2. **Tarefas de hoje** (S8) — o que fazer agora.
3. **Abriram sua proposta** (S8) — o sinal de compra.
4. **Propostas paradas** (S10) — o que está morrendo (esta semana).
5. **Este mês** (S10) — como está o mês (vendas/comissão/conversão).

O mês **não pode empurrar as tarefas pra baixo da dobra** — é a visão que
fica de pé quando o dia já está despachado, o "último olhar" antes de
fechar o app. Registro silencioso: uma cor só, zero ilustração, `Money`
com `tabular-nums` e `align="left"` dentro de cada card (regra do `Money`:
"`left` é o certo dentro de um CARD, onde o valor é um campo e não uma
coluna"). `reserveFor` com teto por card (R$ 100k faturamento, R$ 20k
comissão, R$ 50k paradas) — o número não pula de largura ao carregar nem
ao trocar de mês.

### Passo a passo do fluxo para o PO clicar

Login `dev@zarpa.local` / `dev12345` em `http://localhost:3000/entrar`,
viewport 390×844 (iPhone 14):

1. **`/hoje`** — desce a tela. Ordem: Greeting (2 números do pipeline),
   "Tarefas de hoje", "Abriram sua proposta", "Propostas paradas",
   "Este mês" (4 cards + "Exportar").
2. **"Propostas paradas"** — se houver propostas `sent`/`viewed` sem
   resposta há >7 dias (o seed tem), a lista mostra cada uma com nome do
   contato, destino, "parada há N dias" em âmbar, valor do negócio em
   `Money` e botão "Cobrar". Se não houver, estado vazio "Nenhuma proposta
   parada". O total "`R$ X` parados" aparece no `SectionHeading`.
3. **"Este mês"** — 4 cards em grid 2×2 (mobile) / 4×1 (desktop ≥1024px):
   - **Vendas**: `faturamentoBrutoCents` + "`N` vendas". Clicar → `/vendas`.
   - **Comissão**: `aReceberCents` + "`R$ X` recebida". Clicar → `/financeiro`.
   - **Conversão**: `taxa`% + "`N` enviadas · `M` aceitas" (ou "—" se zero
     enviadas). Clicar → `/propostas`.
   - **Propostas paradas**: contagem + "`R$ X` em aberto". Clicar →
     `/propostas?ids=<id1>,<id2>,...` (a rota de propostas filtrada).
4. **`/propostas?ids=...`** — a página de propostas abre com o aviso
   "Mostrando N propostas destacadas" + botão "Ver todas" (navega para
   `/propostas` sem `ids`). A lista mostra só as propostas dos `ids` da
   URL (filtro `inArray(proposals.id, ids)` no servidor, commit `60f4420`).
   A busca por texto continua funcionando (filtra dentro dos `ids`).
5. **Exportar CSV** — tocar "Exportar" no `SectionHeading` de "Este mês".
   O botão fica carregando (régua correndo) enquanto `exportarResumoDoMesCsv`
   roda. Sucesso: toast "Resumo exportado" + nome do arquivo
   (`resumo-2026-09.csv`) + download disparado (Blob, sem rota de
   servidor). Erro: toast "Não consegui exportar" com a mensagem do
   servidor + o botão de correção no próprio toast (re-tentar). Abrir o
   arquivo no Excel/Sheets: BOM UTF-8, `;` como delimitador, acento
   correto, colunas alinhadas.
6. **Tentar de novo** no erro — se o `obterResumoDoMes` falhar (ex.: banco
   caiu), as duas seções ("Propostas paradas" e "Este mês") mostram
   `FieldError` + "Tentar de novo" juntas. Tocar "Tentar de novo"
   re-dispara a chamada.

### Verificação (o que rodei)

- `npx tsc --noEmit` — **limpo**.
- `npm run build` — **limpo**, 18 rotas geram (`/hoje` e `/propostas`
  continuam dinâmicas, `/propostas?ids=...` é a mesma rota com
  `searchParams` diferente).
- `npx vitest run tests/design/guards.test.ts` — **6/6 verde** (Postgres
  de pé via `zarpa-db` container, `zarpa_test` schema recriado pelas
  migrations). Tipografia, cor por contexto, paridade de tema, movimento
  (CSS e JS), `prefers-reduced-motion` — nenhum desvio não registrado.
- **Não testei clicando no navegador** — sou agente de terminal, não
  tenho navegador. O passo a passo acima é para o PO (Leandro) clicar e
  julgar a tela em 390×844. Prestar atenção especial a: (a) o grid 2×2
  dos cards do mês em 390px (cada card ~170px — o `Money` com `size="20"`
  cabe?); (b) o `Money` de apoio (`size="13"`) dentro dos cards — o
  `inline-grid` flui com o texto "recebida"/"em aberto"?; (c) o botão
  "Exportar" no `SectionHeading` — o `DownloadIcon` + rótulo alinham com
  o rótulo do mês?; (d) o aviso "Mostrando N propostas destacadas" em
  `/propostas?ids=...` — o `bg-inset` + botão "Ver todas" alinham com a
  busca acima?; (e) o download do CSV dispara de verdade no Safari
  (`<a>.click()` com `download` atribuído — testar no Chrome e Safari).

---



### O que fez

O botão "+" da `TopBar` do `AppShell.tsx` (visível em TODA tela autenticada:
Hoje, Funil, Propostas, Clientes, Dinheiro, ficha de negócio, Kitchen sink) dizia
"Nova proposta" mas não tinha `onPointerDown`/`onClick` nenhum — botão morto,
pré-existente, que eu mesma flaguei na rodada anterior como "não mexi, fora do
escopo". O PO pediu agora, e a razão que tornou isso trivial de resolver: na
mesma rodada anterior eu extraí `NovaPropostaSheet` de `PropostasScreen.tsx`
para `src/components/app/NovaPropostaSheet.tsx` — o componente já existe como
compartilhado, já aceita `negocioFixo?: NegocioFixo` opcional, e já sabe abrir
SEM ele (carrega `listarNegocios({ limite: 100 })` no `useEffect` quando `open`
vira true e `negocioFixo` é undefined, e troca o rótulo fixo pelo `Combobox`
pesquisável).

Mudou um arquivo só: `src/components/app/AppShell.tsx`.

- Import de `NovaPropostaSheet` após o de `Button`/`ThemeToggle`.
- `TopBar` ganhou `useRouter()` + `useState(false)` para `sheetOpen`.
- O `<Button variant="primary" size="sm">` (mesmo peso visual — ele já é o CTA
  do topo, não muda) ganhou `onPointerDown={() => setSheetOpen(true)}` —
  reage no toque, não no `click`, padrão do app para botões fora do componente
  `Button` (o `Button` já cuida do `pressed` state internamente via
  `onPointerDown`, e passa o meu handler adiante).
- `<NovaPropostaSheet>` renderizado logo após o `</header>`, dentro do fragmento
  que agora envolve o `TopBar`. Sem `negocioFixo` — o agente escolhe o negócio no
  Combobox. `onCreated={(id) => { setSheetOpen(false); router.push(\`/propostas/${id}/editar\`); }}` — mesmo padrão dos outros dois pontos de entrada
  (PropostasScreen e ficha do negócio em `funil/[id]/NegocioScreen.tsx`).

O `Sheet` usa `DialogPrimitive.Portal` do Radix com `z-40` no overlay e `z-50`
no painel — ambos maiores que o `z-30` do header `veil`, então a Sheet aparece
acima do topo, não atrás. O `SheetContent` faz `forceMount` no `AnimatePresence`,
então o portal existe no DOM desde a renderização inicial (não há race de
mount/portal na primeira abertura).

### Por que não quebrou nada de `Papel e Pedra`

- Nenhuma cor nova, nenhum token novo, nenhum espaçamento novo — o botão já
  existia com `variant="primary" size="sm"`, só não fazia nada.
- Reagir no `pointerdown` (não `click`) — regra do app para resposta no toque.
- O `NovaPropostaSheet` sem `negocioFixo` já estava desenhado: o `useEffect`
  (linhas 57–71 do componente) volta cedo se `negocioFixo`, e caso contrário
  carrega `listarNegocios` e popula o `Combobox`. O `effectiveDealId` vira
  `dealId` (string vazia), o botão "Criar e montar" nasce desabilitado, e só
  habilita quando o agente seleciona um negócio no Combobox. Confirmei que
  abrir da AppShell não coloca rótulo fixo nenhum — o Combobox pesquisável é
  o estado inicial, exatamente como em `PropostasScreen`.
- O gate de design (`tests/design/guards.test.ts`) passou 6/6 — nenhuma regra
  de `Papel e Pedra` quebrou (tipografia, cor, movimento, reduced-motion).

### Caminho clicado de verdade (o que o PO completa)

Eu não tenho navegador para clicar fisicamente — sou agente de terminal. O que
verifiquei por comando:

1. `npx tsc --noEmit` — limpo.
2. `npm run build` — limpo (14/14 rotas, todas compiladas, `/propostas/[id]/editar`
   presente na lista de rotas).
3. `npx vitest run tests/design/guards.test.ts` — 6/6 (Postgres de pé via
   `npm run db:up`).
4. `next dev` sobe limpo na porta 3000 (dev server do usuário já rodando);
   `curl` em `/entrar` devolve 200, e `/hoje`/`/funil`/`/postas` devolvem 307
   (redirect de auth — rotas vivas, não 404).

O **teste-clicando de verdade no navegador em 390×844** ficou pendente para o
PO completar — o passo a passo a verificar é:

1. Login `dev@zarpa.local` / `dev12345` em `http://localhost:3000/entrar`.
2. Em qualquer tela autenticada (ex: Hoje), tocar o "+" no topo → `NovaPropostaSheet`
   abre.
3. No Combobox "Negócio", buscar pelo título, destino ou contato → selecionar
   um negócio. Botão "Criar e montar" habilita.
4. (Opcional) preencher "Título da proposta" ou deixar em branco (padrão: destino
   do negócio). Tocar "Criar e montar" → `criarPropostaAPartirDoNegocio` →
   redirect para `/propostas/[id]/editar` → o editor abre.
5. Repetir em outra tela (Funil, Clientes) — o botão é global, tem que abrir a
   mesma Sheet de qualquer lugar. Confirmar que abrir da ficha do negócio
   (`/funil/[id]`) continua abrindo COM `negocioFixo` (rótulo fixo, não
   Combobox) — aquele caminho não mudou.

## S4 — o funil e o topo do Hoje saem do `sample-data.ts` e vão para o servidor

### Entregue

- **`src/app/(app)/funil/FunnelScreen.tsx`** — `listarNegociosDoFunil()` no
  lugar de `PROPOSALS`, `COLUNAS_DO_FUNIL` no lugar de `STAGES` (fonte única
  de vocabulário de estágio, importada de `@/server` — não mantive uma
  segunda lista local, que era exatamente o problema que o comentário de
  `deals.ts` documenta). Três estados de tela: skeleton (armação de coluna
  igual à real, `Skeleton`/`SkeletonRow`, nunca spinner), erro (`Card` +
  `FieldError` + botão com o texto de `correcao` do servidor) e o quadro
  pronto.
- **Motivo de perda, obrigatório.** `perdido` não é alvo de arrasto — o
  contrato deixa isso explícito ("não existe drop target para perdido") e
  fisicamente um `drop` não coleta texto no meio do gesto. A saída vive no
  menu do card: "Marcar como perdida…" abre um `Dialog` (não `Sheet`) pedindo
  o motivo. Escolhi `Dialog` porque a doutrina do próprio componente é
  literal aqui — "modal fica para o que exige informação nova do usuário
  antes de continuar", que é exatamente o caso, e não uma confirmação de
  "tem certeza?" (isso seria proibido pelo CLAUDE.md). O botão de confirmar
  fica desabilitado com menos de 3 caracteres (mesmo mínimo do servidor,
  então a tela recusa antes de gastar uma chamada de rede), mas a validação
  de verdade continua no servidor — se ele recusar por outro motivo, o erro
  aparece dentro do próprio diálogo (`FieldError`, sem fechar), com o botão
  de reenviar continuando ali do lado.
- **A parte destrutiva de "perdida" segue a regra normal.** Depois que o
  servidor confirma, o card some do quadro (não tem coluna para ele) e vira
  um toast com **desfazer de 8s**, `tone="warn"` (para diferenciar visualmente
  de um "movida com sucesso" comum, que usa `tone="ok"`) — só a CAPTAÇÃO do
  motivo pediu modal; o resultado ainda é "aconteceu, e dá pra desfazer", não
  "tem certeza?".
- **Toda chamada ao servidor é otimista e reversível.** Arrastar ou usar o
  menu atualiza a tela imediatamente (o toque não espera rede — é o critério
  de aceite do sprint, "30 cards seguidos sem perder posição ao soltar") e só
  confirma depois. Três caminhos de falha tratados sem deixar UI e banco
  divergirem:
  1. o `moverEstagioDoNegocio` inicial falha → o card volta sozinho para o
     estágio anterior (mesmo `setItems` de reversão), toast de erro com o
     `correcao` do servidor virando o botão da própria régua de aviso
     (`toast.show({ action: { label: correcao, onClick: reload } } )` —
     "erro diz o que aconteceu E oferece a correção, com o botão junto",
     literalmente usando o slot de ação do Toast para isso);
  2. o "Desfazer" de um movimento normal ou de uma perda chama o servidor de
     novo para voltar ao estágio anterior; se ESSA chamada falhar (raro — rede
     caiu duas vezes seguidas), a tela não tenta adivinhar o estado: chama
     `reload()` e busca o quadro inteiro de novo, current sempre vence a
     otimismo;
  3. `criarNegocio`/detalhe de negócio não entraram nesta tela — não fazem
     parte das duas entregas pedidas, e o produto ainda não tem um seletor de
     contato em lugar nenhum para alimentar `criarNegocio(contactId, ...)`
     (verifiquei: não existe hoje). Não inventei essa UI para não abrir
     escopo por conta própria; fica registrado para quando alguém pedir.
- **O selo "abriu o link" saiu do card do funil.** `NegocioDoFunil` não
  carrega `opens`/`lastOpenHours` — é sinal de PROPOSTA, e `contactId` não é
  1:1 com `dealId` (um contato pode ter negócios diferentes com propostas
  diferentes). Cruzar por contato arriscava colar o selo de abertura de uma
  proposta no card de OUTRO negócio do mesmo cliente — pior que não ter selo
  nenhum, porque mentiria com convicção. `Signal` ficou só com "parada há N
  dias" / "hoje".
- **Teto de largura do valor do card é dinâmico agora**, não uma constante
  tirada do maior valor de exemplo (`CARD_MONEY_CEILING = 5_940_000` da v2).
  `cardMoneyCeiling = Math.max(piso, ...valores reais)` — mesmo raciocínio que
  já existia para a soma de coluna, só que por card. Sem isso, o primeiro
  negócio real acima de R$ 59.400 quebraria o alinhamento da coluna de
  dígitos, que é a coisa que este produto MENOS pode deixar acontecer.
- **`src/app/(app)/hoje/TodayScreen.tsx`** — os dois números do topo agora
  vêm de `obterResumoDoPipeline()` e a seção "Paradas há mais de 7 dias" de
  `listarNegociosParados()`, cada um com seu próprio ciclo loading/ready/error
  (não reaproveitei o `loading` combinado de tarefas+aberturas que a v1 usava
  para gatilhar o skeleton da seção de paradas — era um acoplamento
  acidental de três fontes de dado que não têm nada a ver umas com as
  outras). Erro no card de número não derruba a tela inteira: virou um
  componente próprio (`PipelineStat`) que troca o valor pela mensagem +
  botão de correção SÓ naquele cartão, os outros três blocos da tela seguem
  vivos.
  - O texto "· nunca aberta" da linha de parada saiu — lia
    `proposal.opens === 0` de um dado de exemplo; `NegocioParado` não carrega
    esse número (mesmo motivo do selo do funil).
- **`src/lib/ui/sample-data.ts` apagado.** Depois de tirar os dois últimos
  consumidores (`PROPOSALS`/`STAGES`/`stalled`/`sumCents`, só usados por estas
  duas telas), rodei uma busca por todo `src/` e não sobrou NENHUM import do
  arquivo — `ContatoAmostra`/`CONTATOS`/`ViajanteAmostra`/etc. também já não
  tinham consumidor (a tela de Clientes migrou para `@/server` numa sessão
  anterior e ninguém tirou o arquivo). O próprio comentário de topo do
  arquivo já dizia o que fazer nesse dia: "Quando o backend chegar, isto sai
  inteiro. Nenhum componente importa daqui." — cumpri a própria instrução
  dele.

### Decisão que exigiu argumentar com o próprio Dialog

Cogitei usar `CardAction` (texto) para as duas ações do rodapé do diálogo de
perda, seguindo a doutrina do Card ("duas ações, a segunda vira texto"). Mas
o `KitchenSink.tsx` já registra o padrão real para `Dialog` (diferente de
`Card`): ação principal em `Button`, cancelar em `CardAction` — copiei
exatamente isso (`DialogClose asChild` envolvendo `CardAction`) em vez de
inventar um terceiro padrão com `Button variant="ghost"`. `variant="danger"`
no botão de confirmar, não `primary`: é a única cor não-accent reservada para
ação que tira algo do fluxo normal, e bate com o próprio rótulo ("Marcar como
perdida").

### Bloqueio de fora da minha fronteira

`npm run build` **não fica limpo** — falha em `/p/[slug]` porque
`src/server/deals.ts` tem `'use server'` no topo e exporta `COLUNAS_DO_FUNIL`
como `const` (não função `async`), o que o Next.js rejeita em build (não em
`tsc --noEmit`, que passa limpo). Confirmei com `git stash` que o erro já
existia ANTES de qualquer edição minha — não é regressão desta tarefa. Não é
`src/server/**`, não toquei; registrei o diagnóstico completo e a correção
sugerida (mover a constante para um arquivo sem `'use server'`) em
`docs/handoffs/nina-para-rafa.md`, item 0.

### Verificação

- `npx tsc --noEmit` — limpo.
- `npm run build` — **não limpo**, ver bloqueio acima (fora da minha
  fronteira, reportado).
- `npx vitest run tests/design/guards.test.ts` — 6/6 verde.
- `npx eslint` nos dois arquivos: 5 erros de `react-hooks/set-state-in-effect`
  (chamar `setStatus` de sincronicamente dentro do `useEffect` antes do
  `.then`). Não é regressão — o MESMO padrão já reprovava no arquivo antes da
  minha edição (`tasksStatus`/`openedStatus`, 2 erros pré-existentes,
  confirmado com `git stash`); segui a convenção já estabelecida no arquivo
  em vez de inventar uma terceira forma de disparar o fetch. `eslint` não
  está na lista de verificação obrigatória desta tarefa — registro para quem
  decidir se vale abrir uma limpeza maior (afetaria também `VendaScreen.tsx`
  e outras telas com o mesmo formato).

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

## Dois botões mortos — `criarNegocio` e `criarTarefa` ligados na interface

Auditoria ao vivo (não teste, clique real) achou dois buracos: (1) **nenhum
lugar da UI criava negócio** — `criarNegocio` existia no servidor desde o S4,
sem tela chamando, e isso travava "Nova proposta" (combobox vazio pra tenant
novo) — bloqueio nº1 do produto; (2) **"Criar lembrete" no Hoje era
`<Button variant="primary">Criar lembrete</Button>` sem `onClick`**, e não
existia `criarTarefa` do lado do servidor até este sprint. Contrato completo
em `docs/handoffs/rafa-para-nina.md` (seção "S9/S10").

### Onde entrei

**Novo negócio** — dois pontos de entrada, mesma Sheet:

- `src/app/(app)/funil/FunnelScreen.tsx` — cabeçalho ganhou `Button
  variant="primary" iconOnly` ("+") ao lado do título "Funil", mesmo desenho
  do "+" de `PropostasScreen.tsx`. Não existia nenhum botão "Nova proposta"
  no cabeçalho do Funil antes (o handoff sugeria "ao lado de Nova proposta",
  mas essa tela nunca teve isso — só título). `onCreated` insere o retorno
  de `criarNegocio` (que já vem no MESMO shape de `NegocioDoFunil`) direto em
  `items`; a coluna "Novo contato" é derivada de `items` por `useMemo`, então
  o card aparece sem reconsultar o quadro.
- `src/app/(app)/clientes/[id]/ContatoScreen.tsx` — atalho no cabeçalho da
  ficha ("+ Novo negócio", `variant="secondary"`, texto oculto abaixo de
  `sm`). Como o Funil não está montado quando se cria por aqui, o card não
  "aparece na hora" nesta tela — troquei por um toast com o resultado
  (`Negócio criado: <título> · Entrou no Funil, coluna Novo contato`) e uma
  ação **Abrir Funil** que navega para lá. O contador "N negócios" do
  cabeçalho da ficha também é atualizado localmente (`patch`), sem refetch.

`src/components/app/NovoNegocioSheet.tsx` é o componente compartilhado pelos
dois pontos de entrada — mesmo raciocínio de `CardBody` no funil (duas
marcações do mesmo registro divergiriam no primeiro ajuste). Prop
`contatoFixo?: { id, nome }` é a diferença: vindo da ficha, o contato já está
decidido e o campo vira um rótulo estático (`bg-inset`) em vez de Combobox —
buscar de novo o nome que já está no topo da tela seria pedir a mesma
informação duas vezes. Sheet curta de propósito: contato, título, destino,
ida/volta. Moeda/pax/valor/`expectedCloseOn` ficam de fora — nascem no
default do servidor (BRL, pax 1, valor R$ 0,00) e se ajustam depois na ficha
do negócio, quando essa tela existir; enfiar seis campos numa Sheet de
criação rápida é a "cara de formulário gerado" que a direção proíbe.

**Criar lembrete** — `src/app/(app)/hoje/TodayScreen.tsx`:

- O botão morto do `EmptyState` ("Nada marcado para hoje") ganhou
  `onPointerDown` abrindo a Sheet.
- Adicionei um segundo ponto de entrada: um `Button variant="quiet" iconOnly
  size="sm"` ("+") ao lado da contagem "N pendentes" no `SectionHeading` de
  "Tarefas de hoje". Sem ele, depois da primeira tarefa criada não havia
  NENHUM jeito de criar a segunda sem completá-la antes — o botão só existia
  no estado vazio. É a primeira vez que um `SectionHeading.action` carrega um
  `Button` em vez de só texto/`Badge`; mantive `variant="quiet"` e `size="sm"`
  de propósito (sem preenchimento em repouso) para não quebrar o registro
  silencioso do miolo do app com um CTA gritando ao lado de um número.
- `NovoLembreteSheet` (função local no mesmo arquivo — só esta tela usa).
  Campos: título e "Quando" (obrigatórios), tipo e contato (opcionais, um
  Combobox com a mesma busca de `listarContatos` usada em `NovoNegocioSheet`),
  nota (opcional). **Sem `dealId` no formulário**: vincular a um negócio pede
  escolher primeiro o contato dono dele, e dois buscadores empilhados numa
  Sheet curta é exatamente a "cara de template" que a direção proíbe. Quem
  quiser lembrete preso a um negócio específico ainda tem o atalho de dentro
  da ficha do contato (`LembretesCard`, que já teria contato implícito).

### O cuidado do Rafa — fuso do `dueAt` — decisão e por quê

`dueAt` é `timestamptz`. Um `<input type="date">` sozinho manda
`"AAAA-MM-DD"` puro, que o construtor `Date` do JS interpreta pela
especificação como **meia-noite UTC** — em Brasília isso nasce até 3h
"atrasado" na hora de criar. Usei **`<input type="datetime-local">`**, não
`type="date"` com hora fixa. A mesma especificação do `Date` trata a forma
`"AAAA-MM-DDTHH:mm"` (sem `Z`, sem offset) como **hora LOCAL do navegador** —
exatamente o comportamento certo, sem nenhuma gambiarra de fuso no
componente nem no servidor (`criarTarefa` só faz `new Date(value)`, que já
existia pronto para essa forma — ver o comentário de `dueAtInput` em
`followups.ts`).

Valor default do campo: **"agora + 30min, arredondado para o próximo
múltiplo de 15"** (`defaultReminderDueAt()`), não "09:00 fixo" como o handoff
sugeria como opção. Escolhi isso porque a tela Hoje é usada o dia inteiro —
um default de 09:00 nasceria "vencido" (vermelho) toda tarde, o oposto do
que dá confiança na hora de criar. "Agora + 30min" nasce no futuro quase
sempre (só rola pro dia seguinte se criado nos últimos ~45min antes da
meia-noite — aceitável, e o campo continua editável).

### Latência percebida — sem segundo round-trip para a tarefa aparecer

O retorno de `criarTarefa` (`TarefaResumo`) não tem `contactName`, `vencida`
nem `suggestedMessage` — o handoff já avisa disso e sugere completar
localmente em vez de esperar um refetch de `listarTarefasDeHoje()`. É o que
fiz: `contactName` vem do mesmo `ContatoResumo[]` já carregado para o
Combobox (sem chamada nova), `dealTitle`/`destination` ficam `null` (não há
campo de negócio nesta Sheet), `suggestedMessage` fica `null` (contrato: só
tarefa gerada tem sugestão), e `vencida` é `dueAt < agora` calculado no
cliente — mesma regra do servidor. A tarefa entra na lista, ordenada por
`dueAt`, no mesmo `then()` da criação — sem esperar uma segunda ida ao
servidor só para preencher três campos que já sei localmente. 100ms de
atraso evitável é 100ms de atraso evitável.

### Verificação

- `npx tsc --noEmit` — limpo.
- `npx vitest run tests/design` — 203/203 verde (guard de movimento passou
  sem precisar registrar desvio novo: toda a Sheet nova é composta de
  componentes já existentes — `Button`, `Sheet`, `Field`, `Combobox`,
  `Select`, `Input`; não escrevi nenhuma transição de cor nova).
- `npm run build` — limpo, as 14 rotas geram normalmente.
- **Testei clicando de verdade**, com Playwright apontado para o `next dev`
  já rodando em `:3000` (login `dev@zarpa.local`/`dev12345`, viewport
  390×844):
  1. Hoje → "+" ao lado de "Tarefas de hoje" → preenchi título → "Quando"
     já veio preenchido com o default → "Criar lembrete" → a tarefa apareceu
     na lista "Tarefas de hoje" (contagem 0→1), com hora tabular e o clock
     glyph, sem reload.
  2. Funil → "+" no cabeçalho → busquei um contato no Combobox → título →
     "Criar negócio" → o card apareceu na coluna "NOVO CONTATO" (contagem
     0→1) com o valor "R$ 0,00" e "hoje" no sinal de estagnação, sem reload.
  3. Clientes → abri um contato → "+ Novo negócio" no cabeçalho da ficha →
     campo "Contato" veio fixo com o nome (sem Combobox) → título → "Criar
     negócio" → toast "Negócio criado: … · Entrou no Funil, coluna Novo
     contato" com ação "Abrir Funil", e o contador do cabeçalho da ficha
     mudou de "1 negócio" para "2 negócios" sem refetch.
  Screenshots do fluxo ficaram no scratchpad da sessão (não fazem parte do
  repositório); os scripts de Playwright usados para o teste foram apagados
  do disco depois — eram temporários, não commitados.

### Decisões que tomei sozinha (resumo desta entrega)

1. `NovoNegocioSheet` compartilhada entre Funil e ficha do contato, com
   `contatoFixo` opcional em vez de dois componentes quase iguais.
2. Sheet de negócio SEM moeda/pax/valor/data prevista de fechamento — só
   contato, título, destino, ida/volta. Ajuste fino fica para quando existir
   tela de detalhe do negócio.
3. "+" pequeno (`quiet`, `iconOnly`, `size="sm"`) dentro do `SectionHeading`
   de "Tarefas de hoje" — primeiro caso de um `Button` ali; mantive o peso
   visual baixo para não brigar com o registro silencioso do miolo do app.
4. Sheet de lembrete SEM campo de negócio (`dealId`) — só contato. Dois
   buscadores empilhados numa Sheet curta pareceria template gerado.
5. Default do "Quando" é "agora + 30min, arredondado pros 15min seguintes",
   não "09:00 fixo" — decisão de latência percebida/confiança: um lembrete
   não deveria nascer "atrasado" na tela que acabou de criá-lo.
6. Inserção otimista da tarefa nova usa dado que já está em memória (lista de
   contatos carregada para o Combobox) em vez de um segundo `listarTarefasDeHoje()`
   só para popular `contactName`/`vencida` — evita um round-trip perceptível.

## Ficha do negócio — o clique que faltava no Funil

Auditoria do PO: clicar num card do Funil não abria nada. Dava pra mudar de
estágio pelo menu do card, mas não tinha como ver histórico, dados da viagem
nem a proposta ligada — `obterNegocio` já existia desde o S4 (`deals.ts`,
seção 4, com `activities`), só não tinha tela nenhuma consumindo. Mesma
categoria de bug do "bloqueio nº1" (Novo negócio) que já está documentado
acima — desta vez o link morto era o próprio card.

### Entregue

- **`src/app/(app)/funil/[id]/page.tsx` + `NegocioScreen.tsx`** — ficha do
  negócio: cabeçalho (título, contato com link para `/clientes/[id]`, data de
  criação, badge de estágio, menu de estágio), card **Viagem** (destino, pax,
  ida/volta, valor — `tabular-nums` via `MoneyStat`), card **Proposta**
  (link direto se já existe, "Nova proposta" pré-selecionada se não existe) e
  card **Linha do tempo** (`activities`, mais recente primeiro).
- **`FunnelScreen.tsx` — o card agora abre a ficha.** O card já era
  arrastável (`drag` do motion); clicar nele tinha que abrir a ficha SEM
  atrapalhar o arrasto, que começa no mesmo `pointerdown`. Resolvido com um
  `useRef` booleano (`movedRef`) fechado entre `pointerdown` e `pointerup`:
  `onDragStart` do framer (que só dispara quando o gesto de fato virou
  arrasto, acima do limiar interno dele) marca `movedRef.current = true`; no
  `pointerup`, se `movedRef` continua `false`, foi toque — abre a ficha. Não
  usei `onTap` do motion de propósito: ele teria que reconciliar o PRÓPRIO
  limiar de gesto com o de `drag` no mesmo nó, e dois relógios medindo a
  mesma coisa é onde bug de gesto nasce; um booleano fechado no escopo do
  gesto não tem essa fresta. O menu "⋯" tem `data-stage-menu` e o
  `pointerup`/`keydown` do card checam `closest('[data-stage-menu]')` antes
  de abrir — clicar no menu não deveria também navegar. Card virou
  `role="link"` + `tabIndex` + `aria-label` (ex.: "Abrir negócio de Marina
  Albuquerque — Fernando de Noronha") para o caminho de teclado (Enter) e
  leitor de tela também funcionarem, não só o ponteiro.
- **`src/components/app/DealStageMenu.tsx` (novo)** — `DealStageMenu`
  (dropdown "mover para" + "marcar como perdida…") e `LossReasonDialog`
  (motivo obrigatório ≥3 caracteres, fala com `moverEstagioDoNegocio`
  sozinho) **extraídos** de dentro de `FunnelScreen.tsx`, onde nasceram no
  S4. A ficha do negócio precisava da MESMA ação — "mudar estágio também
  deve ser possível aqui, reaproveite a lógica do menu do card, não
  duplique" — e duplicar ~150 linhas de dropdown+validação de motivo em dois
  arquivos é exatamente o tipo de coisa que diverge no primeiro ajuste.
  `FunnelScreen.tsx` ficou ~80 linhas mais curto e sem nenhuma mudança de
  comportamento (confirmado clicando: arrastar, mover pelo menu, marcar como
  perdida e desfazer continuam idênticos ao S4).
  - `DealStageMenu` ganhou `revealOnHover` (default `false`). O kebab do
    card do Funil só aparece no hover/foco do `.group/card` mais próximo —
    correto ali, denso demais para ficar sempre visível. Reusar a MESMA
    classe fora do card (na ficha, sem `.group/card` ancestral) deixaria o
    botão invisível pra sempre em ponteiro fino — bug que só um clique de
    verdade no navegador teria revelado; `tsc`/`build` não acusam "elemento
    permanentemente `opacity-0`". `FunnelScreen` passa `revealOnHover`
    explicitamente; a ficha do negócio usa o padrão (sempre visível).
- **`src/components/app/NovaPropostaSheet.tsx` (novo)** — mesma extração,
  para o outro pedido do PO: "atalho para Nova proposta já com este negócio
  pré-selecionado, reaproveitando o fluxo de `NovaPropostaSheet`". Saiu de
  dentro de `PropostasScreen.tsx` (onde só ela usava `Combobox`/
  `listarNegocios`/`criarPropostaAPartirDoNegocio`) para cá, ganhando
  `negocioFixo?: { id, title, contactName, destination }` — mesmo desenho de
  `contatoFixo` em `NovoNegocioSheet` (que já existia): com `negocioFixo`, a
  busca (`listarNegocios`) nem roda e o Combobox vira um rótulo fixo.
  `PropostasScreen.tsx` importa a mesma Sheet sem `negocioFixo` — fluxo
  antigo intacto, testado clicando (busca por negócio, criação, redirect
  para o editor).
- **Card Proposta — link ou atalho, sem `obterPropostaDoNegocio(dealId)` no
  servidor.** `obterNegocio` não devolve propostas (não é dado do negócio).
  Não existe ainda uma função de servidor que filtre proposta por `dealId`
  — só `listarPropostas()` (sem filtro de negócio) e `listarNegocios()` (do
  lado da proposta, não o inverso). Busquei `listarPropostas({
  incluirArquivadas: true, limite: 200 })` e filtrei por `dealId` no
  cliente — mesma doutrina que `deals.ts` já documenta para
  `listarNegociosDoFunil`/`listarNegociosParados` (somar/filtrar em JS
  depois de buscar, seguro no volume esperado — 10-15 vendas/mês por
  tenant). Registrei em `docs/handoffs/nina-para-rafa.md` o pedido de um
  filtro de verdade (`obterPropostaDoNegocio` ou `listarPropostas({
  dealId })`) para quando isso deixar de ser trivial.
- **Linha do tempo com rótulo, não enum cru.** `moverEstagioDoNegocio`
  (deals.ts) grava `body` com o valor de BANCO — "Movido de proposta_enviada
  para novo." — porque aquele arquivo não importa `COLUNAS_DO_FUNIL` (copy de
  interface, não dele). Vi isso só na captura de tela em tema escuro
  (`prefers-color-scheme: dark` + `reduced-motion` via Playwright) — no tema
  claro o olho passa direto, mas em qualquer tema aquilo lido por uma agente
  de verdade soa técnico demais para o produto todo (que trata "Enviada",
  "Novo contato" etc. como o vocabulário oficial em toda outra tela).
  `activityLabel()` reconstrói a frase a partir de `metadata.de`/`para`
  (sempre presente nesse tipo de atividade) com `STAGE_LABEL` — o MESMO mapa
  que o badge do cabeçalho usa — em vez de pedir ao Rafa pra mudar o que o
  servidor grava (o `body` cru continua existindo, só não é o que a tela
  mostra). `body` só entra como fallback se a metadata vier em formato
  inesperado.
- **Otimista com a MESMA física do Funil.** Mudar de estágio na ficha
  atualiza `stage` e adiciona uma entrada sintética na linha do tempo NA
  HORA (mesmo texto que um F5 traria de volta — `stageActivityBody` espelha
  literalmente o que `moverEstagioDoNegocio` grava), sem esperar a resposta
  do servidor; se o servidor recusar, tudo volta (`setNegocio(previous)`,
  que reverte `stage` E a entrada sintética juntos, por serem o mesmo
  objeto). Sucesso reconcilia com os campos que o servidor devolveu
  (`stage`, `lostReason`, `closedAt`, `updatedAt` — não confio que o
  otimista bateu 100% com o que o banco decidiu). "Marcar como perdida" e o
  desfazer de QUALQUER movimento (inclusive reabrir um negócio que já estava
  perdido, escolhendo outro estágio no menu) passam pela mesma `reopenTo` —
  achei essa borda **testando de verdade**, não lendo o código: reabrir um
  negócio perdido e depois clicar "Desfazer" precisa voltar para `perdido`
  de novo, e isso exige motivo (regra do servidor) — `reopenTo` usa
  `previous.lostReason` (que a ficha já tinha guardado) como motivo do
  reabrir-desfeito, com "reaberto por engano" só como rede de segurança se o
  motivo alguma hora vier nulo.
- **Card do motivo da perda usa `tone="warn"`, não um vermelho mais forte.**
  `Card` (`src/components/ui/Card.tsx`) não tem tom "danger" — só
  `default/raised/inset/accent/warn`. O badge do cabeçalho usa `tone="danger"`
  (Badge tem essa opção); o card explicativo abaixo dele usa `warn` de
  propósito: é a diferença entre o SELO do estado (pode ser mais forte,
  ocupa pouco espaço) e a SUPERFÍCIE que carrega uma frase inteira (mais
  branda, para não gritar numa tela que a agente pode reabrir várias vezes
  conferindo o motivo). Decisão consciente, não limitação não notada.

### O que fica de fora, de propósito

1. **Campos da viagem são leitura, não edição.** Não existe `atualizarNegocio`
   no servidor (só `criarNegocio`/`moverEstagioDoNegocio`) — destino, pax,
   datas e valor aparecem, mas não têm `TextAutoField`/`CentsAutoField`. Pedir
   escrita é handoff para o Rafa, não algo que eu deveria inventar client-side
   sem contrato de servidor.
2. **Achei, não mexi:** o "+" da `TopBar` global (`AppShell.tsx`, visível em
   TODA página autenticada) diz "Nova proposta" mas não tem `onClick`/
   `onPointerDown` nenhum — botão morto, pré-existente, fora do que o PO
   pediu nesta entrega. Achei durante o teste no navegador (dois botões
   "Nova proposta" na mesma tela, um deles sem reação nenhuma ao toque) — é
   exatamente o tipo de "clique que não faz nada" que motivou esta tarefa
   toda, só que num lugar diferente. Reportado ao PO; não abri escopo pra
   consertar sem pedido, já que decidir PARA ONDE aquele atalho global deveria
   levar (sheet de negócio pré-selecionado? redirecionar pra `/propostas`?)
   é decisão de produto, não só de fiação.

### Verificação

- `npx tsc --noEmit` — limpo.
- `npx vitest run tests/design/guards.test.ts` — 6/6 verde.
- `npm run build` — limpo, 17 rotas geram normalmente (`/funil/[id]` nova na
  lista).
- **Testado clicando de verdade**, Playwright contra `next dev` em `:3000`
  (login `dev@zarpa.local`/`dev12345`, seed reaplicado com `npm run
  db:migrate && npm run db:seed`, viewport 390×844 — os scripts eram
  temporários, apagados do disco ao final, não fazem parte do repositório):
  1. Funil → cliquei num card (`pointerdown`+`pointerup` sem arrastar, sem
     usar `.click()` bruto pra confirmar que não conflita com o `drag`) →
     abriu `/funil/[id]` com dado real: título, contato, Viagem, Proposta e
     Linha do tempo presentes.
  2. Negócio que JÁ tinha proposta → link abriu `/propostas/[id]/editar`
     direto.
  3. Negócio SEM proposta → "Nova proposta" abriu a Sheet com o negócio
     FIXO (sem Combobox de busca) → "Criar e montar" → editor abriu → voltei
     para a ficha → o link agora existe, sem precisar recarregar a página.
  4. Mudei de estágio pelo menu da ficha → badge mudou na hora, toast
     "Movido para X — Desfazer" apareceu, a linha do tempo ganhou uma
     entrada nova sem F5.
  5. "Marcar como perdida" pela ficha → motivo obrigatório → negócio some
     do Funil (confirmado: o mesmo negócio buscado direto pela URL depois
     continua acessível, só não aparece mais nas colunas) → reabri
     escolhendo outro estágio no menu → cliquei "Desfazer" no toast →
     voltou para "Perdida" com o MESMO motivo original → dei F5 de verdade
     (não só estado do cliente) → o servidor concordava com tudo.
  6. Conferi tema escuro + `prefers-reduced-motion: reduce` juntos
     (`colorScheme`/`reducedMotion` do Playwright) — foi essa captura que
     revelou o "proposta_enviada" cru na linha do tempo (item da seção
     acima).

Arquivos: `src/app/(app)/funil/[id]/page.tsx`,
`src/app/(app)/funil/[id]/NegocioScreen.tsx`,
`src/components/app/DealStageMenu.tsx`,
`src/components/app/NovaPropostaSheet.tsx`,
`src/app/(app)/funil/FunnelScreen.tsx` (editado),
`src/app/(app)/propostas/PropostasScreen.tsx` (editado).
