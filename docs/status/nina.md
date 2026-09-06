# Nina — status

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
