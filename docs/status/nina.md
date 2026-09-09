# Nina — status

## 2026-09-09 (noite) — Prévia do modelo na "Nova proposta" (`obterConteudoDoTemplate` ganhou chamador)

O pendente que eu mesma registrei: a função existia no servidor sem nenhum
consumidor, e escolher modelo era apostar no escuro — o nome da linha era toda
a informação. Agora tocar num modelo (e o default, ao abrir) mostra o SUMÁRIO
dos blocos logo abaixo da lista, no registro de sumário de livro: uma linha
por bloco, rótulo do tipo em 13 + título em 15 truncado. O corpo completo
mora no editor — prévia que quer ser lida inteira é editor disfarçado.

Arquivos: `src/components/app/PreviaDoModelo.tsx` (novo, 210 linhas) e
`src/components/app/NovaPropostaSheet.tsx` (chamada + `FieldHint` reescrita).

### Verificação estática (números)

- `npx tsc --noEmit`: **2 erros, ambos FORA da minha fronteira** —
  `src/app/api/recibos/[vendaId]/route.ts:31` e `src/lib/pdf/recibo.tsx:123`
  (rodada viva do recibo/PDF; o erro do route mudou de linha entre duas
  execuções minhas — tem gente editando esse arquivo agora). Nenhum erro nos
  meus dois arquivos.
- `eslint` no `PreviaDoModelo.tsx`: **0 problemas**. A
  `NovaPropostaSheet.tsx` mantém 2 erros pré-existentes da rodada de tarde
  (`react-hooks/set-state-in-effect` nos efeitos das linhas 104/125 — código
  que não é desta rodada; não mexi).
- `npm run build`: falha somente nos 2 erros acima.
- `npx vitest run tests/proposals/templates.test.ts`: **3/3** — incluindo o
  isolamento (modelo de outro tenant não lista, não copia). É o contrato que a
  prévia consome.
- `tests/design` (guards + rules + deviations): **172/172** sobre a árvore com
  o arquivo novo.
- 390px: sheet full-width, conteúdo 358px (px-4 de cada lado). Pior rótulo
  ("Contato de emergência", 13px) ≈ 134px → sobram ≈ 214px de título (~24–26
  caracteres) antes da elipse. Prévia cheia (6 linhas) ≈ 217px de altura;
  1 linha ≈ 75px; skeleton ≈ 132px (só existe no primeiro toque de cada
  modelo; depois, cache).
- Grep no componente novo: `accent` **0** (o único azul da seção é o ponto do
  rádio, que é seleção), `serif/italic` **0**, animação **0** (a única
  ocorrência de "motion" é em comentário). Skeleton é `still`.

### Decisões que tomei sozinha

1. **A prévia mora abaixo da lista inteira, não expande a linha escolhida.**
   Proximidade vs. estabilidade: expandir linha empurra o "Do zero" e as
   ações de remover/tornar padrão a cada toque — e só transform e opacity
   animam, então a abertura seria seca. Posição fixa, conteúdo troca; o
   cabeçalho do sumário diz o total, e a cauda diz onde o corte aconteceu.
2. **O default abre com prévia montada.** Ele já vem marcado; mostrar o
   sumário na abertura ensina o recurso sem um toque e o conteúdo está lá
   quando ela olha — latência percebida é isso.
3. **Uma linha por bloco, com fallback:** título → corpo inteiro truncado em
   CSS → "n fotos". Zero contagem de caractere em JS; o CSS corta. Bloco oco
   não entra nem na lista nem no total (a proposta também não o renderiza).
4. **`price_note` APARECE.** Aqui é a casa da agente (autenticado); a trava
   de vazamento é da página pública (§4), não desta tela. Ela precisa saber
   que o modelo carrega nota de preço antes de mandar.
5. **Modelo sem blocos = vazio sem exemplo de propósito.** Inventar blocos
   mentiria sobre ESTE modelo — a regra do exemplo vale para lista vazia de
   sistema. O que há: o que acontece se criar dele + UM caminho de volta
   ("Começar do zero", texto, não botão).
6. **Zero animação na troca.** Trocar de modelo é trocar de texto, e texto
   não voa. O teste da doutrina: sem animação, a tela comunica igual.
7. **Estado derivado de um Map de leituras**, sem `setState` síncrono em
   efeito: a primeira forma que escrevi foi reprovada pelo lint da casa e eu
   consertei a arquitetura (leituras por id, ausente = carregando, resposta
   atrasada morre no cleanup) em vez de calar a regra. Cache por id: voltar
   ao modelo de antes é instantâneo.
8. **`FieldHint` saiu do `radiogroup`** (parágrafo não é rádio) e foi
   reescrita para sobreviver ao modelo sem blocos: "o que o modelo tem —
   blocos e opções — vai junto" continua verdade quando o que ele tem é nada.

### Preciso dos outros

Nada desta rodada. O build quebrado é dos arquivos da rodada do recibo
(`src/app/api/recibos/…`, `src/lib/pdf/recibo.tsx`) — quem está lá fecha;
não toquei porque não é meu e estava mudando sob os meus pés.

---

## 2026-09-09 (tarde) — Fases 1 e 2 do Monde: modelos, recibo, resultado por viagem, ranking e CSV

Cinco entregas sobre os contratos que o rafa pôs no ar no meio da rodada
(§12 do handoff dele): **"Salvar como modelo"** no editor, **"Começar de um
modelo"** na `NovaPropostaSheet` (com "Tornar padrão"), **"Recibo"** na ficha
da venda, **Resultado da viagem** na ficha do negócio ganho + **agregado no
Resumo** do financeiro, **aba Clientes** nos Relatórios (ranking → ficha 360°)
e **"Exportar CSV"** em três pontos (vendas, passageiros, relatórios).

Verificação estática: `npx tsc --noEmit` **0 erros no repositório inteiro**
(rodei ao fechar cada tela), `npm run build` limpo,
`npx vitest run tests/design/guards.test.ts` **6/6** (pegou e eu consertei uma
transição de `border-color` que um rádio meu tinha herdado — só transform e
opacity animam, a régua vale para código meu de ontem também). Sem navegador —
o PO testa.

---

### Decisões de desenho que tomei sozinha

1. **"Tornar padrão" mora na linha escolhida, não em toda linha.** A sheet
   abre quinze vezes por dia; um comando por linha viraria painel de controle.
   A ação aparece só quando a agente acabou de preferir um modelo ao padrão —
   o momento exato em que "esse merece ser o de sempre" acontece. O Badge
   "Padrão" troca de linha no toque (otimista; recusa → reload honesto).
2. **Recibo é âncora, não fetch.** `<a target="_blank">` dentro de
   `Button asChild`: sai no toque, imune a popup blocker, e o PDF carrega no
   próprio aba — o progresso é o do navegador. Fingir carregamento na ficha
   seria um spinner, que a casa não tem.
3. **O agregado usa o MESMO card da ficha** (`ResultadoViagemCard`,
   `titulo="Resultado das viagens"`): os seis campos são somáveis, então a soma
   tem o shape do item — a agente aprende uma gramática e a lê em qualquer
   escala. Ficou depois de Comissão de propósito: margem = venda − custo −
   comissão, o card é a conclusão dos dois blocos anteriores.
4. **Soma falha fechada.** Uma recusa em `resultadoDaViagem` fecha o card
   inteiro com "Tentar de novo" — nunca metade de uma soma. E deals repetidos
   entram uma vez (`Set`), porque a action é por viagem, não por venda.
5. **CSV segue o recinte da URL e ignora o chip de status** (vendas): o
   arquivo é para o contador, que não conhece o filtro da tela. Em Relatórios,
   o CSV mora no rodapé do card de resultado — o mesmo gesto dos passageiros.
6. **Ranking: o azul só no nome.** Posição e números são leitura; o nome é o
   único clique (→ ficha 360°). Molde de largura da coluna "Total comprado" =
   o maior da lista — nada pula de linha para linha. Top 10; vazia, o estado
   vazio mostra uma linha de exemplo.
7. **Sub-abas Resumo/Clientes copiam a gramática do `MoneyHubTabs`**
   (segmented, `aria-current`, links de verdade): aba na URL (`?aba=`), o
   `?periodo=` viaja junto e a aba Resumo nem escreve o parâmetro — ausente É
   resumo. O h2 virou "Relatórios" (mesmo padrão de /vendas, que repete a tab).
8. **A ponte nasceu sonda e morreu no mesmo dia.** `fase12Api.ts` sondava o
   barril em runtime enquanto o backend era forno; os nomes saíram, vira
   re-export estático — nenhuma tela mudou na aposentadoria.

### Números das checagens estáticas (por tela)

`serif|italic|rounded-lg` = 0 e hex cru = 0 em TODOS os arquivos tocados;
accent sempre = cliques; valores sempre por `Money`/`MoneyStat`/`tabular-nums`.

| Arquivo | accent | Money/tabular | onClick/pointerdown | min-h-9/11 |
|---|---|---|---|---|
| `relatorios/RelatoriosScreen.tsx` | 0 | 10 | 1/0 | 2 |
| `relatorios/RankingClientes.tsx` | 1 (nome→ficha) | 5 | 1/0 | — |
| `relatorios/ResultadoDasViagens.tsx` | 0 | via card | 1/0 | — |
| `vendas/VendasScreen.tsx` | 1 (margem) | 5 | 7/1 | 1 |
| `vendas/[id]/VendaScreen.tsx` | 1 (link proposta) | 5 | 9/0 | — |
| `NovaPropostaSheet.tsx` | 2 (rádio+badge) | — | 4/2 (rádios no toque) | 4 |

(`onClick` aqui inclui os de componentes Button/Link da casa, que tratam o
gesto internamente; os rádios das linhas reagem no `onPointerDown`.)

### Arquivos tocados nesta rodada

`src/lib/ui/fase12Api.ts` (nova, aposentada no mesmo dia), `src/lib/ui/periodo.ts`
(`limitesDoPeriodo`), `src/components/app/ResultadoViagemCard.tsx` (novo),
`src/components/app/SalvarComoModeloSheet.tsx` (novo),
`src/components/app/NovaPropostaSheet.tsx` (modelos + tornar padrão + rádio sem
transição de cor), `src/app/(app)/propostas/[id]/editar/PropostaEditorScreen.tsx`,
`src/app/(app)/funil/[id]/NegocioScreen.tsx` (PassageirosCard + ResultadoCard),
`src/app/(app)/vendas/VendasScreen.tsx`, `src/app/(app)/vendas/[id]/VendaScreen.tsx`,
`src/app/(app)/relatorios/page.tsx`, `src/app/(app)/relatorios/RelatoriosScreen.tsx`,
`src/app/(app)/relatorios/RankingClientes.tsx` (novo),
`src/app/(app)/relatorios/ResultadoDasViagens.tsx` (novo). Nada commitado.

---

## 2026-09-09 — Roteiro fechado, `/r/` editorial, e a marca com tela e assinatura

Três entregas: o **editor de roteiro** terminado (a rodada interrompida deixou a
espinha; fechei autosave, portaria e teto), **`/r/[slug]`** com a hierarquia de
dia em capítulo, e a rodada nova — **`/configuracoes` ("Sua marca")** + o
**componente único de Assinatura** nas duas superfícies públicas e na mensagem
de WhatsApp. O §11 do rafa chegou no meio da rodada; a assinatura aterrisou
sobre o contrato vivo (`src/lib/assinatura.ts`), não sobre o meu rascunho.

Verificação estática: `npx tsc --noEmit` limpo (rodei ao fechar CADA tela, pela
régua nova), `npm run build` limpo (`/configuracoes` no mapa de rotas),
`npx vitest run tests/design/guards.test.ts` **6/6**. Sem teste de navegador —
o PO testa na máquina dele.

---

### 1. Editor de roteiro — o que fechou de verdade

Base encontrada no working tree (rodada morta): telas em
`src/app/(app)/funil/[id]/roteiro/`, fios corretos em `roteiroApi.ts`
(carrega por `obterConteudoDoRoteiro`, salva a lista COMPLETA), arrasto,
fotos, preview honesto (reusa o componente público). Fechei três furos:

1. **Autosave não perde mais a cauda.** `useAutosave` agora faz *flush* do
   valor pendente no desmonte: a agente digita e sai da tela no mesmo segundo,
   o debounce morre mas a gravação vai (crua, sem `setState` pós-vida — o
   contrato é idempotente de propósito para aguentar este martelo).
2. **A portaria aponta o culpado.** A recusa `DADOS_INVALIDOS` do servidor vem
   com `campo: 'blocos[2].content.preco'`; `useAutosave` agora expõe `failure`
   (`mensagem`/`campo`/`correcao`), o editor extrai o índice e o bloco culpado
   acende na lista (`ring-danger`) com "É o bloco nº 3 da lista" no erro. Erro
   que diz o que aconteceu E onde consertar — sem caçada.
3. **Teto de 100 visível antes do clique.** O botão desabilita no limite e o
   rodapé do card explica ("100 blocos é o teto do roteiro"), em vez de deixar
   a recusa do servidor chegar depois do toque.

Entrada pelo `RoteiroCard` ("Montar roteiro" / "Editar roteiro") já estava
ligada da rodada anterior. Link público, cliente, datas e marca sem campo de
edição — intocáveis por contrato e por desenho (o texto da ficha diz isso).

### 2. `/r/[slug]` — a hierarquia que o sol não apaga

- **Dia virou capítulo.** O cabeçalho antes era um rótulo de 13px + título em
  display 20 — parada e dia disputavam a mesma voz. Agora: "DIA 01 · SEXTA,
  12 MAR" numa linha só (tabular, espaçamento) e o título em **display 32** —
  o mesmo corpo tipográfico da capa. Um dia começa e se lê de braço estendido;
  é hierarquia por peso e escala, não por caixa nem cor (o azul continua só
  onde se clica).
- **Colofão** no pé: `<Assinatura />` no lugar do "Feito com Zarpa" genérico.

### 3. Assinatura — um componente, três aparições

`src/components/public/Assinatura.tsx`: colofão de livro — **agência em
destaque** (caixa alta, peso, espaçamento; a família tipográfica do cabeçalho
de dia), **"por [agente]"** em linha quieta, **linha fina `via {APP_NAME}`**
(+ `@instagram` linkado, quando cadastrado). Server component; sem prancha; o
único "toque" é o hover do link de instagram.

- **As regras NÃO são minhas**: quem decide o que entra quando falta nome é o
  helper do rafa (`linhaDeAssinatura`/`linhaViaApp` em `src/lib/assinatura.ts`,
  testado em `tests/brand`). O componente só REPARTE a linha canônica em duas
  para dar peso — e o texto via `textoComAssinatura`. Um formato só, testado
  num lugar só.
- Aparece em **`/p/[slug]`**, **`/r/[slug]`** (com a marca CONGELADA no
  snapshot — o nome do agente viaja com a proposta) e na **mensagem do
  "Mandar por WhatsApp"** do editor de roteiro (com a marca de AGORA, que é a
  que a agente escolheria ao mandar).
- **O envio**: `wa.me/?text=…` (share-picker documentado) abre o WhatsApp com
  "Aqui está o roteiro da viagem «X»: link + assinatura" e deixa a agente
  escolher a conversa — zero contrato novo (o número do cliente não existe no
  `NegocioDetalhe`; desejo registrado no handoff).

### 4. `/configuracoes` — "Sua marca"

A tela que faltava: `atualizarMarca` existia desde a S13a sem NENHUM caminho
na interface. Rota irmã de `/cobranca` e `/integracoes` (lateral no desktop);
no celular, ícone quieto no topo (a barra inferior já está no limite de cinco
alvos). Campos: **nome da agência, logo, assinatura do agente
(`agentDisplayName`, 0017), WhatsApp, Instagram** — patch de um campo por vez,
salva no blur, "Salvo" discreto, sem botão Salvar.

Decisões que tomei sozinha aqui:

- **Validação de formato é local, de propósito.** `marcaInput` do servidor
  devolveria mensagem crua de zod em inglês para nome curto; a guarda é no
  campo, em pt-BR, com a correção junto ("O nome da agência precisa de pelo
  menos 2 letras."). WhatsApp valida pela MESMA régua do `waMeLink`
  (10–15 dígitos): número que não abre conversa não passa — o vazio é o caminho
  de saída, não o lixo.
- **Preview ao vivo sem moldura.** O rodapé da página renderiza o MESMO
  `<Assinatura />` das páginas públicas, sobre o mesmo papel, sem caixa e sem
  sombra — lendo o ESTADO LOCAL, então a digitação vira colofão na hora (não
  "depois de salvar"). Preview que exige salvamento é fotografia, não preview.
- **Logo vazio = inicial da agência** no círculo pontilhado — o lugar onde o
  logo vai ficar, ocupado pelo que já se tem (nada de caixa tracejada vazia
  com interrogação, cara de template gerado).
- **Remover logo é destrutivo → toast com desfazer de 8s** (restaura a URL
  anterior), na regra da casa. Upload pelo MESMO caminho do editor
  (`enviarImagemDaProposta`): um caminho só de upload no produto.
- **Blur sem mudança não fala com o servidor** — comparação contra o último
  valor CONFIRMADO (não o digitado; o primeiro rascunho desse mecanismo tinha
  exatamente esse bug e nunca salvaria — peguei revisando antes do tsc).

### 5. O que ficou de fora (e por quê)

- **Cores da marca** (`brandPrimaryColor`/`SecondaryColor`): o contrato aceita,
  a tela não expõe — o pedido do PO listou cinco campos; cor de marca sem
  chroma-picker decente é convite a marca feia, e o botão de aceite da proposta
  já herda a cor quando existir. Volta como rodada própria se o produto pedir.
- **`contactEmail`**: existe no contrato, não entrou — não aparece em lugar
  nenhum do público hoje; campo sem superfície é lixo de formulário.
- **"Mandar por WhatsApp" no `RoteiroCard` da ficha**: ficou só no editor. O
  card é atalho; a conversa de envio mora onde o conteúdo é editado (e o
  rodapé do card já diz "mande por WhatsApp" apontando para lá).

### 6. Números

- `npx tsc --noEmit`: limpo (0 erros) — verificado após cada tela.
- `npm run build`: limpo; `/configuracoes` presente como rota dinâmica.
- `npx vitest run tests/design/guards.test.ts`: **6 passed (6)**.
- Arquivos meus tocados: listados abaixo; nenhum fora da fronteira exceto a
  linha declarada no handoff (`src/lib/assinatura.ts`, reexport de token).

**Arquivos:** `src/lib/ui/useAutosave.ts`, `src/lib/ui/whatsapp.ts`,
`src/lib/ui/brand.ts`, `src/lib/ui/assinaturaDaMarca.ts` (novo),
`src/components/public/Assinatura.tsx` (novo),
`src/components/public/RoteiroPublicoConteudo.tsx`,
`src/components/app/AppShell.tsx`,
`src/app/r/[slug]/RoteiroPublicoScreen.tsx`,
`src/app/p/[slug]/PublicProposalScreen.tsx`,
`src/app/(app)/configuracoes/` (novo: `page.tsx` + `ConfiguracoesScreen.tsx`),
`src/app/(app)/funil/[id]/roteiro/RoteiroEditorScreen.tsx`,
`src/app/(app)/funil/[id]/roteiro/RoteiroBlocos.tsx`,
`docs/handoffs/nina-para-rafa.md` (novo).
