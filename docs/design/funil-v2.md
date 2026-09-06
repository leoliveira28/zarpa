# Funil v2 — a raia precisa existir

Autor: liderança de design do funil · Direção: Papel e Pedra · Estado: especificado, aguardando implementação

Duas versões foram reprovadas. A v1 (`docs/design/funil.md`) tirou a borda dos
quatro lados corretamente, mas não colocou nada no lugar dela — o diagnóstico do
PO, abaixo, é o ponto de partida deste documento e não é revisitado no mérito.

## 0. Diagnóstico (dado, não deste documento)

1. A coluna perdeu identidade — sem raia visível, o arrasto não tem alvo.
2. Mais vazio, não menos — as colunas terminam onde o conteúdo acaba (~60% de
   tela branca).
3. O cabeçalho de página come altura do quadro (~120px de título + subtítulo de
   instrução de gesto).
4. Cabeçalho de coluna não lê como cabeçalho de raia, porque não existe raia.
5. O total "Em aberto" está solto no canto, desconectado do quadro.
6. "Fechada" não se distingue das demais.
7. O selo de visualização (accent) é a única cor da tela e rouba atenção.

## 1. Padrões consolidados (o que é convenção, o que é estética)

| Produto | O que observei | Convenção ou estética | Fonte |
|---|---|---|---|
| **Trello** | A lista é uma **forma preenchida do início ao fim da coluna**, não um bloco que termina onde o conteúdo termina; cabeçalho, pilha de cards com rolagem própria e uma ação de adicionar sempre visível no pé — mesmo lista vazia tem a forma inteira. O quadro rola na horizontal, a lista rola na vertical, independentes. | **Convenção cara de quebrar.** É o cânone: todo kanban depois dele herda "raia = campo visual preenchido", e é exatamente o que falta na v1 (diagnóstico #1 e #2). | [Trello — Adding lists to a board](https://support.atlassian.com/trello/docs/adding-lists-to-a-board/); conhecimento consolidado de produto para a forma preenchida e o rodapé de adicionar (não detalhado na doc de suporte, mas é o comportamento padrão do produto) |
| **Pipedrive** | O valor somado do estágio é dado de primeira classe: aparece junto ao nome do estágio, com contagem e quebra por moeda. | **Convenção.** O número que responde "quanto tem em cada etapa" mora no cabeçalho da coluna, não num rodapé de página. | [Pipedrive — total value by stage](https://support.pipedrive.com/en/article/how-can-i-see-the-total-value-of-my-deals-by-stage-or-pipeline) |
| **HubSpot Deals** | Existe uma propriedade calculada de "dias no estágio", separada da idade do negócio — a estagnação é medida contra o tempo esperado NAQUELE estágio, e vira um sinal por card. Won costuma fechar o funil com tratamento à parte. | **Convenção** (estagnação é sinal de card, medido por estágio) + **estética** (como esse sinal é desenhado — cor, ícone, texto — é escolha nossa). | [HubSpot — Days in Stage](https://community.hubspot.com/t5/HubSpot-Ideas/Days-in-Stage/idi-p/383731); [Stage calculated properties](https://knowledge.hubspot.com/properties/stage-calculated-properties) |
| **Linear / Height** | Raia com campo visual sob os cards (contêiner sombreado/rebaixado), cabeçalho fixo enquanto o corpo rola, rolagem por coluna, teclado como caminho de primeira classe (mover item entre colunas sem soltar o mouse). | **Convenção** (raia = campo visível, cabeçalho fixo, teclado obrigatório — já temos o menu de estágio, isso já está coberto). | [Linear — Board layout](https://linear.app/docs/board-layout) |
| **Notion (board view)** | Cabeçalho da coluna carrega o rótulo do grupo + um número (contagem, ou soma configurável) à direita; a cor da coluna é opcional e pode ser desligada — o board funciona sem tingir a área inteira. | **Estética.** Prova que dá para comunicar identidade de coluna só pelo cabeçalho + uma leve marcação, sem preencher o corpo inteiro de cor — é a opção mais "silenciosa" das quatro. | [Notion — Board view](https://www.notion.com/help/boards) |

**Convenções que custam caro quebrar** (usadas na direção escolhida):
1. A raia é um campo visual contínuo, do topo à base da coluna — não uma forma
   que nasce e morre com o conteúdo (Trello, Linear, Height).
2. A soma do estágio é conteúdo do cabeçalho da coluna, não de um rodapé de
   página (Pipedrive, Notion).
3. Estagnação é sinal de card, não de coluna; é medida, não decoração (HubSpot).

**Escolhas nossas, sem convenção única a seguir** (decididas abaixo, dentro de
Papel e Pedra): a cor do preenchimento da raia (nenhum dos quatro usa uma
paleta de uma-cor-só como restrição), como o estado "Fechada" se distingue sem
usar o accent, e como o sinal de estagnação é desenhado sem virar rótulo
colorido competindo com a ação.

## 2. Duas direções

### Direção 1 — Painel rebaixado (a lição de Trello/Linear/Height)

Cada raia ganha um preenchimento neutro, um tom abaixo do papel da página,
esticado por **toda a altura disponível da coluna** independente de quantos
cards ela tem. O cabeçalho mora dentro do mesmo painel; a cornija (`Rule`)
separa cabeçalho de corpo, como já era. Entre raias, só espaço — sem fio
vertical.

- **A favor:** resolve #1 e #2 com um mecanismo só — uma forma preenchida é
  inconfundivelmente um recipiente, o arrasto ganha alvo do topo à base da
  coluna, e a tela para de terminar em branco onde o card acaba. É a
  convenção mais estabelecida das quatro fontes (três das quatro concordam).
- **Contra:** cinco retângulos rebaixados lado a lado arriscam voltar a
  parecer caixa se o tom for escuro demais — exige um passo de cor contido,
  dentro da família "papel", testado nos dois temas.

### Direção 2 — Fio vertical + página ruled (a lição de Notion + a doutrina do próprio `plates/index.tsx`)

Nenhum preenchimento em lugar nenhum — o quadro continua um único plano de
papel. Um fio vertical (`--hairline`) no meio de cada goteira, esticado por
toda a altura do quadro, é o único separador; identidade de coluna vem do
cabeçalho (rótulo + contagem + soma) e do fio.

- **A favor:** é a expressão mais pura de "o fio separa, nunca envolve" — zero
  token novo, mais barato de construir, e é o registro mais "silencioso"
  possível, o que a direção Papel e Pedra pede do miolo do app.
- **Contra:** um fio de 1px é um sinal fraco à distância de uso real (a agente
  olha o celular ou o laptop rapidamente entre um atendimento e outro) e não
  ataca #2 — a página continua ~90% papel nu, só com linhas finas cortando o
  branco. E como alvo de solta durante um arrasto rápido, uma linha é pior
  pista que um campo preenchido: o problema #1 do PO foi exatamente a
  ausência de um campo legível, e um fio sozinho recria isso só fracamente.

### Escolhida: Direção 1, com o vocabulário de fio da Direção 2 como reforço

A Direção 1 ataca mais itens do diagnóstico de uma vez e é a convenção que as
três ferramentas mais próximas do nosso caso de uso (Trello, Linear, Height)
compartilham — não é gosto, é o que kanban maduro faz. A Direção 2 fica como
doutrina de reforço, não como substituta: o próprio enunciado desta tarefa
autoriza fio **e/ou** rebaixo, e um fio vertical fino no meio da goteira larga
(≥1280px) dá ao quadro uma segunda pista de grade sem introduzir uma segunda
cor — e é o mesmo fio que já engrossa no cabeçalho quando a coluna é alvo de
solta, generalizado.

## 3. Desenho detalhado

### 3.1 Token de cor da raia

`--surface-inset` já existe em `tokens.css` mas está inerte no tema claro
(`#F4F3F0`, idêntico a `--bg` — zero contraste). Corrigir o valor claro para um
meio-passo entre `--bg` (`#F4F3F0`) e `--surface-3` (`#EBE9E5`):

```
--surface-inset: #EFEEEA;   /* tema claro — hoje é #F4F3F0, igual a --bg */
```

O valor escuro (`#0A131A`, mais escuro que `--bg` `#0E1114`) já está correto —
não mexer. Esta é a única mudança de token pedida; nenhum token novo. Depois
da correção, confira contraste de `--muted`/`--subtle` sobre `--surface-inset`
nos dois temas (mesma tabela de contraste que já existe como comentário perto
de `--muted` em `tokens.css`) — a mudança é pequena o bastante para não
reprovar, mas precisa ser conferida, não presumida.

`--surface-inset` é o preenchimento das quatro raias "em aberto". A raia
"Fechada" **não** ganha um preenchimento verde — pintar uma coluna inteira de
`--ok-soft` transformaria estado em marca, e são vinte cards de fundo colorido
o dia inteiro. Ela usa o mesmo `--surface-inset` das outras; a diferença dela
é tipográfica (3.3).

### 3.2 Anatomia da raia

```
┌ sem borda nos 4 lados — o painel é --surface-inset, cantos retos ┐

  NOVO CONTATO                                    2
  R$ 33.455,00
  ───────────────────────────────────────────────── (cornija)

  Marina Albuquerque                                  ⋯
  Fernando de Noronha                             6 nov
  R$ 12.840,00                                    há 1 d
  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ (fio interno)
  ...

└──────────────────────────────────────────────────────┘  ← termina no rodapé
   da coluna, não no último card. Sem raio de canto: a raia é a base
   arquitetônica, reta; o card é o objeto que pousa nela.
```

- **Preenchimento:** `bg-surface-inset`, sempre presente (não só quando há um
  card no ar — isso é o que causava #1: o papel da coluna aparecia e
  desaparecia, e uma raia que só existe durante o arrasto não é uma raia).
- **Altura:** a section ocupa 100% da altura da célula do grid
  (`lg:min-h-0 lg:flex-1`, já existe) — o preenchimento vai até o rodapé da
  janela mesmo com zero ou um card. É a correção direta de #2.
- **Cantos:** retos, sem `border-radius`. `rounded-lg` já está em uso no card
  levantado (intencional: virou objeto na mão); repetir em mais uma camada
  começa a virar o hábito proibido em CLAUDE.md ("rounded-lg em tudo"). A raia
  fica reta de propósito — é estrutura, o card é o objeto que pousa nela.
- **Estado de alvo de solta:** enquanto um card está no ar, a raia sob a
  projeção do arremesso aprofunda um passo (`bg-surface-inset` →
  `bg-surface-3`) e a cornija do cabeçalho engrossa para `bg-plate` — os dois
  sinais que já existiam na v1, agora empilhados sobre um preenchimento que já
  estava lá, em vez de ser o preenchimento inteiro.
- **Fio vertical de reforço:** um `<Rule>` vertical (`w-px h-full bg-hairline`,
  não o mesmo componente horizontal — ver nota de implementação) no meio da
  goteira, visível só a partir de `2xl` (a goteira de 24px é a primeira larga o
  bastante pra o fio não tocar as duas raias). Some abaixo disso — na goteira
  de 16px o preenchimento sozinho já basta e um fio ali ficaria colado nas
  duas bordas.

### 3.3 A raia "Fechada"

Mesmo preenchimento (`--surface-inset`) das outras quatro — a grade continua
igual, é ela que diz "isto é um quadro de cinco estágios", não quatro mais um
diferente. A distinção é só onde CLAUDE.md já licencia verde como estado:

- A soma da coluna usa `<Money tone="ok" ...>` — o número fica verde, não a
  coluna.
- Ao lado do rótulo "FECHADA", um símbolo de checagem discreto (glifo inline,
  `currentColor`, 12px — não é uma prancha; pranchas são para vazio/divisor/
  marca, não para rótulo de coluna).
- Os cards dentro dela **não mostram o sinal de estagnação nem o de abertura**
  (venda fechada não está "parada", e quantas vezes o link foi aberto deixou
  de importar) — o terceiro slot do card fica em branco ou com um traço
  discreto. Menos informação nesta coluna é a informação: aqui não se
  monitora nada, só se confere o que já foi ganho.

### 3.4 O sinal de estagnação/abertura — tira o accent do card

Diagnóstico #7: o badge `tone="accent"` no sinal de abertura é a única cor da
tela e não é "onde clicar" — é status. Isso já é uma quebra da regra de uma
cor (CLAUDE.md: "se o azul aparecer duas vezes na mesma tela, uma das duas
está errada"; aqui ele aparece uma vez por card com abertura, ou seja, dezenas
de vezes).

- **Abriu o link** (`opens > 0`): badge `tone="neutral"` (cinza, já existe em
  `Badge`), não `accent`. O ícone de olho já carrega o significado; a cor
  reforçava um clique que não existe ali.
- **Parada crítica** (`idleDays > 7`): continua `tone="warn"` (âmbar) — âmbar
  já é estado licenciado, e "dinheiro escorrendo" é exatamente o caso de uso
  de âmbar em CLAUDE.md.
- **Accent passa a aparecer só em controles reais** do app (botões, links,
  campo em foco) — nunca em rótulo de card. Depois desta troca, a única cor
  na tela do funil deixa de competir com "onde clicar" porque não sobra
  nenhum accent nela — o que é o resultado correto para uma tela sem ação de
  clique própria (a ação aqui é arrastar ou usar o menu, nunca um botão azul).

### 3.5 Cabeçalho de página e o total "Em aberto"

Diagnóstico #3 (cabeçalho come altura) e #5 (total desconectado) têm a mesma
causa: um bloco de estatística de duas linhas empilhado ao lado de um título
grande MAIS uma frase de instrução — três elementos competindo pela mesma
faixa, e nenhum deles pertence realmente ao total do quadro.

- **Título da página:** volta a ser só `<h2 className="text-32 font-semibold
  text-ink">Funil</h2>` — do mesmo tamanho que Hoje, Propostas e Clientes.
  Sem subtítulo abaixo dele. Consistência entre telas é doutrina do miolo
  silencioso, e o funil não pode ser a única tela com um parágrafo de
  instrução permanente.
- **A instrução de gesto** ("Arraste o card — ele segue a velocidade...")
  deixa de ser subtítulo de página e vira **dica contextual de primeiro uso**:
  aparece uma vez, discreta (13px, `text-subtle`), grudada perto do primeiro
  card do quadro, e se apaga para sempre depois do primeiro arrasto OU do
  primeiro uso do menu de estágio (uma flag em `localStorage`,
  `zarpa.funil.hintSeen`). Instrução de gesto é dica, não título de página —
  é literalmente o que o PO pediu.
- **O total "Em aberto":** sai do cabeçalho de página e desce para dentro do
  próprio quadro — uma faixa fina, de uma linha só (não duas empilhadas como
  na v1), no topo da área larga, alinhada à direita, seguida por um `<Rule>`
  de largura total que corre por cima dos cinco cabeçalhos de coluna:

  ```
                                              Em aberto   R$ 84.230,00
  ─────────────────────────────────────────────────────────────────── (cornija)
  [ NOVO CONTATO ]   [ MONTANDO ]   [ ENVIADA ]  [ NEGOCIANDO ]  [ FECHADA ]
  ```

  Isso resolve #5 de verdade: o total não fica "conectado" por estar perto do
  título, fica conectado por estar dentro do mesmo contêiner do quadro, com o
  mesmo fio que sublinha os cinco cabeçalhos de coluna passando por baixo
  dele. `Money size="17"` (não mais 20 — a hierarquia agora é: soma de coluna
  é o número mais importante da tela, o total geral é o segundo), `reserveFor`
  mantém a mesma reserva de antes.

### 3.6 Estado vazio

CLAUDE.md permite prancha em estado vazio mesmo no miolo, mas no máximo uma
por tela. Duas leituras diferentes:

- **Uma raia vazia, as outras não** (caso comum: nenhuma proposta em
  "Fechada" ainda): só o texto de dica (`column.hint`) sobre o preenchimento
  `--surface-inset` — sem prancha. Cinco raias vazias ao mesmo tempo já
  romperiam o limite de uma prancha por tela se cada uma tivesse a sua.
- **O quadro inteiro vazio** (tenant novo, zero propostas): as cinco raias
  desaparecem como grade de trabalho e dão lugar a um `EmptyState` de tela
  cheia com `FernPlate`, convidando a criar a primeira proposta — é o estado
  que já existe como padrão em outras telas do produto (Propostas, Clientes),
  aplicado aqui pela primeira vez ao funil.

### 3.7 Coluna cheia

A rolagem já é por coluna (`lg:overflow-y-auto`), não por página — isso não
mudou e não estava no diagnóstico. Acréscimo pequeno: uma máscara de
gradiente (`mask-image`, CSS puro, sem JS, sem animação) no topo e na base do
corpo da coluna quando ela tem rolagem, para o "some uma linha de cards"
não ser silencioso demais. Opcional — não é bloqueio de entrega se a Nina
julgar que a raia preenchida já basta como pista.

### 3.8 O que muda no celular

- O scroller com encaixe (`snap-x`) continua — não fazia parte do
  diagnóstico e nenhuma das fontes de mercado desaconselha o padrão que já
  usamos para telas estreitas.
- Cada raia agora leva o preenchimento `--surface-inset` também no celular,
  esticado por toda a altura do cartão de coluna — a correção de #1/#2 vale
  nos dois registros, não só no desktop.
- Sem fio vertical de reforço no celular (só aparece a partir de `2xl`, e o
  celular nunca chega lá) — no scroller, a borda da viewport já faz esse
  papel.
- A dica de gesto de primeiro uso é a mesma dica, mesmo texto, mesma regra de
  "uma vez só" — não duplicar em uma versão para toque e outra para mouse.

### 3.9 Movimento

Nada muda no mecanismo (`projectThrow`, `springLayout`, desfazer por toast de
8s) — o diagnóstico não questionou o movimento, questionou a falta de campo
visual por baixo dele. O único acréscimo é o aprofundamento de tom da raia-alvo
descrito em 3.2, que já usa só `transform`/cor de fundo, sem novo tipo de
animação.

## 4. Fronteiras de implementação

Toda a mudança mora em arquivos que já existiam (nenhum arquivo novo previsto,
exceto o pequeno helper de `localStorage` da dica, se a Nina preferir isolar):

- `src/styles/tokens.css` — correção do valor claro de `--surface-inset`.
- `src/components/plates/index.tsx` — nenhuma mudança de doutrina; o fio
  vertical de reforço é um uso novo do mesmo `<Rule>` ou uma variante dele
  (decisão de implementação da Nina, documentada no doc de status dela).
- `src/components/ui/Badge.tsx` — nenhuma mudança de componente, só de uso
  (tone passado pelo funil).
- `src/app/(app)/funil/FunnelScreen.tsx` — o grosso: cabeçalho de página,
  faixa de total, raia preenchida, coluna "Fechada", sinal do card, dica de
  primeiro uso.

## 5. Fora desta entrega

- Filtro/busca no quadro, auto-scroll ao arrastar para a borda, virtualização
  de coluna — já descartados em `docs/design/funil.md` e a razão não mudou
  (10–40 propostas por agente não paga o custo).
- Botão de "+ adicionar" por raia (padrão Trello): o produto já tem um ponto
  de entrada global de "Nova proposta" na barra superior; duplicar por coluna
  seria um segundo caminho para a mesma ação sem necessidade.
- Máscara de gradiente de coluna cheia (3.7) é opcional, não bloqueante.
