# Status — Nina (frontend / design system)

## Tarefa
Frontend do S3: tela Clientes por inteiro — lista, ficha do contato, assistente de
importação de planilha, tudo ligado às Server Actions reais (`src/server/contacts.ts`,
`travelers.ts`, `imports.ts`, `csv.ts`, `alerts.ts`), não a `sample-data.ts`. Critério de
aceite do sprint: importar uma planilha real sem perder nem duplicar registro, do celular.

## O que ficou pronto

### Rotas e telas
- **`/clientes`** (`ClientesScreen.tsx`) — busca com debounce de 300ms que não apaga a
  lista anterior enquanto a nova carrega (opacidade 60%, sem skeleton a cada tecla —
  skeleton é só do primeiro carregamento), lista em `Card` com fio interno, estado vazio
  com prancha + conteúdo de exemplo, "Novo cliente" em Sheet (nome, WhatsApp/telefone,
  e-mail, origem — só o nome é obrigatório), "Ver arquivados" com restauração inline.
- **`/clientes/[id]`** (`ContatoScreen.tsx`) — cinco cartas na proporção 1:4:1 de sempre:
  **Dados** (nome, WhatsApp, telefone, e-mail, origem, etiquetas, observações — cada campo
  salva sozinho no blur, textarea com debounce de 900ms), **Documento e nascimento** (CPF e
  data completa ficam ocultos por padrão; um botão "Ver" chama `obterDocumentoDoContato`,
  que audita a leitura no servidor — a tela não busca isso sem pedido explícito),
  **Passageiros** (lista de `listarViajantes`, cada linha edita nome/tipo/validade de
  passaporte direto — são campos não sensíveis, já vêm no resumo —, e um "Ver CPF,
  passaporte e nascimento" por passageiro que audita como o do contato), **Lembretes**
  (consome `alerts.ts`: `listarTarefas({contatoId})` + `concluirTarefa`) e **Encerramento**
  (arquivar/restaurar/excluir).
- **`/clientes/importar`** (`ImportWizard.tsx`) — três passos (Enviar → Conferir →
  Resultado) sobre duas chamadas de servidor, exatamente como `imports.ts` documenta: o
  mesmo `File` é mandado para `pravisualizarImportacao` e depois para
  `confirmarImportacao`, guardado em estado de componente entre os passos (nenhuma
  navegação de rota no meio do fluxo, porque um `File` não sobrevive a isso). Mapeamento de
  coluna editável com o valor sugerido pelo servidor pré-preenchido e um exemplo da
  primeira linha ao lado de cada select; pré-visualização em tabela, crua, sem mapeamento
  aplicado, só para conferir que a leitura bateu (o próprio comentário de `imports.ts`);
  aviso bloqueando o botão de importar se nenhuma coluna estiver mapeada para Nome;
  resultado com criados/atualizados/mesclados/ignorados e a lista linha a linha com aviso
  (nunca "27 ok" sem dizer quais). "Importações recentes" na tela de envio, lendo
  `listarImportacoes`/`obterRelatorioDeImportacao`, para reabrir um relatório antigo.

### Infraestrutura nova (`src/lib/ui/**`)
- **`useAutosave.ts`** — o mecanismo único de "salvar sozinho, sem botão Salvar": `commit`
  (imediato, uso em `onBlur`) ou `schedule` (com debounce, para texto longo), estado
  `idle/saving/saved/error` que alimenta `<SavedMark>` direto e volta a `idle` sozinho.
  Descarta resposta de commit que já foi substituído por um mais novo (evita que uma
  resposta atrasada da rede reverta o rótulo de "Salvo").
- **`useDeferredDelete.ts`** — resolve uma lacuna real: `excluirContato` e
  `excluirViajante` são exclusão de VERDADE, sem endpoint de restauração (ao contrário de
  `arquivarContato`/`restaurarContato`, que têm). Um toast "Desfazer" que promete voltar
  atrás e não consegue é uma mentira na interface — pior que o modal "tem certeza?" que o
  CLAUDE.md proíbe. A saída: a interface remove o item na hora (parece instantâneo) e só
  manda a exclusão de verdade para o servidor se os 8 segundos do toast passarem sem
  ninguém tocar em "Desfazer" — o timer roda fora do React, então sobrevive a navegar para
  outra rota no meio da janela de desfazer. Reusado também para "concluir lembrete"
  (`concluirTarefa` não tem "reabrir").

## Decisões tomadas sozinha

- **CPF, passaporte e data de nascimento nunca chegam à tela sem um clique explícito.**
  `ContatoDetalhe`/`ViajanteResumo` não trazem esses campos — só `temDocumento`/
  `temPassaporte` (booleano) e `aniversario` (`MM-DD`, que os comentários do servidor já
  tratam como não sensível). Um botão "Ver" chama `obterDocumentoDoContato`/
  `obterDocumentoDoViajante`, que grava em `audit_log` — a tela nunca busca isso de graça
  para "preencher um card que talvez ninguém abra" (aviso literal do Rafa em
  `rafa-para-nina.md`).
- **Passaporte e validade não sensíveis ficam editáveis direto na linha do passageiro,
  sem reveal.** `passportExpiresOn`, `fullName`, `kind`, `nationality` já vêm no resumo —
  só CPF, número do passaporte e data de nascimento completa exigem o clique de auditoria.
  Menos fricção para o dado que já é público de qualquer forma.
- **Accent (azul) nunca em badge de status.** O relatório de importação tem quatro
  situações por linha (criado/atualizado/mesclado/ignorado); usei `ok`/`neutral`/`neutral`/
  `warn`, nunca `accent` — a mesma correção que `docs/design/funil-v2.md` já tinha feito
  para o sinal de abertura do funil ("se o azul aparecer duas vezes na mesma tela, uma
  delas está errada", e aqui ele apareceria dezenas de vezes). Pela mesma razão, nenhum
  `CardFooter` da ficha do contato usa `variant="primary"`: a barra superior já carrega o
  único accent persistente da tela ("Nova proposta"), e dois accent permanentes na mesma
  tela é exatamente o que a regra proíbe — diferente do `EmptyState`, que é contextual (só
  aparece quando a lista está vazia) e por isso pode usar `primary` sem duplicar.
- **Exclusão de verdade sem "desfazer" que funciona é pior que modal — então ela não usa
  o toast padrão.** Ver `useDeferredDelete.ts` acima. Isso significa que, tecnicamente, o
  toast "Cliente excluído" mente por 8 segundos (o registro ainda está no banco) — decisão
  consciente: a alternativa (excluir e não conseguir desfazer de verdade) é pior.
- **Data em `<input type="date">`, não texto livre.** `parseDataFlexivel` (normalize.ts)
  aceita ISO (`AAAA-MM-DD`), que é exatamente o que o input nativo devolve — ganho de UX no
  celular (seletor nativo) sem custo de parsing extra, tanto para nascimento quanto para
  validade de passaporte.
- **Busca não limpa a lista a cada tecla.** Resultado anterior fica na tela, apagado a 60%,
  até o novo chegar — skeleton só no primeiro carregamento. Evitar que a lista pisque a
  cada letra digitada.
- **Reescrevi os efeitos de carregamento para não chamar `setState` direto no corpo do
  `useEffect`** (o padrão inicial — função `load` via `useCallback`, chamada com
  `void load()` dentro do efeito — dispara `react-hooks/set-state-in-effect` no ESLint
  novo do projeto). Troquei por `.then()` inline dentro do efeito, com uma flag `active`
  para descartar resposta de request cancelado, e um `reloadToken` de estado para o botão
  "Tentar de novo" disparar recarga sem chamar função de fora do efeito. Encontrei esse
  mesmo aviso já pré-existente em `Combobox.tsx`, `Toast.tsx` e `theme.ts` (não mexi
  nesses três — não é escopo desta entrega, mas registro aqui porque é sistêmico, não um
  erro pontual meu).

## Verificação
- `npx tsc --noEmit` — limpo.
- `npm run build` — limpo (Next 16 / Turbopack). `/clientes` e `/clientes/importar` saem
  estáticos; `/clientes/[id]` sai dinâmico (rota com parâmetro, sem `generateStaticParams`
  — esperado).
- `npx eslint` nos arquivos novos — limpo (corrigi os 7 avisos de `react-hooks/refs` e
  `react-hooks/set-state-in-effect` que apareceram na primeira passada).
- `npm run dev` + `curl` nas três rotas — 200 nas três, HTML de skeleton correto no
  primeiro paint, nenhum erro 500 no log do servidor. **Não fui além disso**: não existe
  sessão autenticada no ambiente (ver handoff abaixo), então não dá para ver a tela com
  dado de verdade sem um navegador de verdade logado — o que eu não tenho como dirigir
  daqui. Quem avalia a tela de olho é o cliente, como já registrado na entrega anterior.

## Preciso dos outros
Abri `docs/handoffs/nina-para-po.md`: não existe rota de login nem tela de login no
produto — toda Server Action (não só as de Clientes) devolve `NAO_AUTENTICADO` sem sessão,
e isso é correto, mas significa que ninguém vê o caminho feliz de nenhuma tela autenticada
sem resolver isso primeiro. Não é bloqueio desta entrega (a tela está certa no estado atual,
inclusive o erro "Sua sessão expirou" aparece do jeito que o CLAUDE.md pede), mas é
bloqueio do produto como um todo.

## Fora desta entrega
- **XLSX na importação** — `imports.ts` já recusa com mensagem clara e correção ("exportar
  como CSV"); não é meu escopo destravar isso, já está registrado como pedido do Rafa ao
  PO (`docs/handoffs/rafa-para-po.md`). A tela de importação mostra a mensagem do servidor
  sem inventar suporte que não existe.
- **Edição de notas do passageiro** (`ViajanteInput.notes`) — o formulário de criação e a
  linha da lista não expõem esse campo; dava para incluir, mas o formulário de "adicionar
  passageiro" já tinha sete campos e um oitavo opcional não paga o custo de mais uma tecla
  de rolagem no celular. Fica para quando alguém pedir.
- **Menu de contexto na lista** (arrastar para arquivar, editar rápido) — a lista de
  clientes ficou deliberadamente burra (busca + navegação), com toda ação de ciclo de vida
  morando na ficha. Documentado como o mesmo tipo de corte que o funil já fez com
  filtro/auto-scroll: não se paga com o volume de cliente de um agente independente.
