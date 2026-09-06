# Nina — status

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
