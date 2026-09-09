# Nina — status

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
