# Status — Nina (frontend / design system)

## Tarefa
Redesenho do funil (`src/app/(app)/funil/FunnelScreen.tsx`): sair do padrão de
celular (`overflow-x-auto` + `snap-x`) esticado no desktop, para um quadro de
cinco colunas de altura cheia na largura útil da janela. Proposta em
`docs/design/funil.md` — problema, três direções, a escolhida (B) e por quê.

## O que ficou pronto

- **Funil**: grade de 5 colunas na largura da janela a partir de `lg`, cada
  coluna com rolagem própria (a página não rola); celular continua scroller
  com `snap-x`. Cabeçalho de coluna com contagem e **soma em `tabular-nums`**,
  reserva de largura comum às cinco colunas. Card com 3 linhas (cliente,
  destino + data da viagem, valor + sinal de dias parado/abertura) e regra do
  fio (fio interno entre cards, nunca borda nos 4 lados). Arrasto mantém a
  transferência de velocidade do gesto (`projectThrow`); desfazer por toast
  8s — nada disso mudou.
- **`AppShell`**: rota `/funil` declarada em `WIDE_ROUTES` — escapa do
  `max-w-[64rem]` do miolo e trava a altura em viewport no desktop (quem rola
  passa a ser o conteúdo, não a página). Exceção nomeada num lugar só.
- **Sistema de fio, para o produto inteiro** (não só o funil — a violação era
  sistêmica): `Card`, `Table`, `Badge`, `EmptyState`, `Tabs` perderam a borda
  nos 4 lados; a separação passou a ser papel + fio horizontal (`Rule`, agora
  com variante `inner`). Doutrina de quando o traço PODE ter 4 lados
  (controle, camada flutuante) documentada no próprio `plates/index.tsx`.
  Token novo `--hairline` para o fio (mais fraco que `--border`, que continua
  para controle/camada flutuante).
- **`Card`**: reescrito na proporção base/fuste/capitel (1:4:1, módulo
  `--card-band` = 44px).
- **`Money`**: número que rola (300ms, `tabular-nums`, sem mudar largura) e
  `align` (`left` para card, `right` para tabela).
- **`cn()`**: bug real corrigido — `tailwind-merge` não conhecia a escala
  `text-13/15/17/20/32` nem `shadow-1/2/3/drag` como grupos próprios, e
  colapsava `text-13` com `text-ink` (cor sumindo) e `shadow-2` com `shadow-1`
  (mesmo grupo). Afetava todo componente que combina classe de cor com classe
  de tamanho — não só o funil. `extendTailwindMerge` com os dois grupos.
- **`/kitchen-sink`**: cobre os componentes atualizados; variantes
  `.force-hover` e `.force-focus` (via `@custom-variant hover`) para conferir
  hover e foco parados, nos dois temas, sem precisar segurar o mouse.

## Verificação
`npx tsc --noEmit` limpo. `npm run build` limpo (Next 16 / Turbopack, 9
páginas estáticas geradas). Sem Playwright nem captura visual — por regra do
processo, quem avalia a tela é o cliente.

## Decisões tomadas sozinha
- Estender a correção do fio a todos os componentes que a violavam (Card,
  Table, Badge, EmptyState, Tabs), não só ao funil: a regra é do sistema
  (CLAUDE.md), e um funil correto ao lado de cards com borda nos 4 lados em
  outra tela continuaria parecendo template.
- `align` em `Money` é aditivo (`right` continua padrão) — nenhuma tela
  existente muda de leitura.

## Fora desta entrega (registrado em `docs/design/funil.md`)
Filtro/busca no quadro, auto-scroll do quadro ao arrastar para a borda,
virtualização de coluna — nenhum se paga com 10–40 propostas por agente.

## Preciso do PO
Nada de dependência nova. Pedido de revisão visual em
`docs/handoffs/nina-para-po.md` não foi necessário — nenhuma dependência
nova, nada fora da fronteira de frontend.
