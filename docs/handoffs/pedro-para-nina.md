# pedro → nina — 2026-09-09 — BRIEF: o editor de roteiro

> Ato de PO deste mesmo dia: isto não é mais registro de furo, é o briefing da sua
> próxima grande entrega. O caso que abriu a porta: "onde o agente configura o
> conteúdo do roteiro?" — resposta de hoje: em lugar nenhum. O que vem abaixo é a
> visão para fechar isso com uma entrega que dá orgulho. As decisões de design são
> SUAS; o que está travado aqui é só visão, restrição e ordem.

## A visão, em um parágrafo

O roteiro é o momento "uau" do pós-venda: é a página que o cliente abre **durante a
viagem, no celular, na rua** — no aeroporto, na fila do check-in, no ônibus do
passeio. A proposta vende a viagem; o roteiro **acompanha** a viagem. É o artefato
que sustenta a recompra (§3/§4 — a viagem em curso é o momento de maior risco e
maior oportunidade). Hoje ele nasce gerado, fotografia fria da proposta aceita, e o
agente não pode dar a cara dele. A entrega: **o agente monta e ajusta o roteiro como
monta a proposta — por blocos, com autosave, com fotos — e o cliente recebe uma
página de guia de viagem que parece página de livro.** Quando essa tela existir, a
resposta à pergunta do PO vira: "no editor de roteiro, dentro da ficha do negócio".

## O que existe hoje (mapa do fluxo, verificado no código em 2026-09-09)

| Peça | Onde | Estado |
|---|---|---|
| `RoteiroCard` | `src/app/(app)/funil/[id]/NegocioScreen.tsx:929` (render em `:473`, só quando `negocio.isWon`) | Mostra título, cliente, datas, link truncado. Botões: "Gerar roteiro" (antes) e "Copiar link"/"Abrir" (depois). **Nenhuma configuração de conteúdo.** |
| `gerarRoteiro(dealId)` | `src/server/itineraries.ts:154` | Fotografa blocos da proposta ACEITA (só os da opção aceita + os da proposta inteira) em `itineraries.blocks_snapshot`. Idempotente (índice único por `deal_id`). Exige `is_won` + proposta aceita com opção. |
| Tabela `itineraries` | `src/db/schema/itineraries.ts` | Snapshot jsonb de blocos (`kind`, `position`, `title`, `body`, `images`, `content`) + `brand_snapshot` + `clientName` + datas + `public_token`. **É jsonb: o snapshot aceita o que o §4 deixar passar, sem migration de coluna.** |
| Página pública `/r/[token]` | `src/app/r/[slug]/RoteiroPublicoScreen.tsx` via `roteiro_publica` (0013) + `obterRoteiroPublico` | Lê só o snapshot, sem login. Registro atual: funcional, não editorial. Scanner de vazamento varre a resposta inteira. |
| Upload de imagem | `src/server/storage.ts` | Já existe e já é usado pelo editor de proposta. Fallback dev: `data:` URL; em produção exige `BLOB_READ_WRITE_TOKEN` (recusa com erro claro quando falta — ver restrições). |
| `listarRoteiros()` | `src/server/itineraries.ts:347` | Sem filtro: o card carrega 200 e acha o do negócio no cliente. Contrato melhor no handoff do rafa. |

O único "configure antes" que existe hoje é texto corrido no estado vazio do
`RoteiroCard` ("acrescente ANTES, na proposta…"), sem botão, sem link.

## O que falta

**Tela (você):**
1. **Editor de roteiro, irmão do editor de proposta.** Mesma alma: blocos,
   reordenar arrastando, autosave com "Salvo" discreto, preview em tempo real.
   O agente JÁ SABE usar o editor de proposta — o de roteiro deve custar zero
   aprendizado. Onde entra: do `RoteiroCard` (negócio ganho), no lugar do texto
   que hoje só descreve. 
2. **Fotos ilustrando o roteiro** — por dia, por parada, por bloco. Reuse a
   infra de upload do editor de proposta (`storage.ts`) sem inventar segundo
   caminho.
3. **`/r/[slug]` no registro "editorial pleno"** — a mesma mão que a proposta
   pública: tipografia como imagem, prancha, margem de livro, arco como divisor.
   Um guia de viagem que parece página de livro, não PDF de agência. O LEITOR
   aqui é o turista na rua — mais leigo que a agente, com menos sinal de celular:
   hierarquia absoluta, alvos de toque generosos, nada que exija pinçar fino.

**Servidor (sinalizado ao rafa em `docs/handoffs/pedro-para-rafa.md`):** contrato
de escrita sobre o snapshot (`atualizarConteudoDoRoteiro`), leitura da proposta
aceita, `listarRoteiroDoNegocio(dealId)`, e — se você quiser tipos de bloco novos
— avaliação de migration no CHECK de `proposal_blocks.kind`.

## Restrições e doutrina (não negociável)

- **Duas superfícies, dois registros.** Editor = miolo do app, silencioso (grid,
  fios, uma cor; zero ilustração). `/r/[slug]` = editorial pleno. Nenhuma prancha
  no editor; a prancha é do lado do cliente.
- **O link é sagrado.** `public_token`, `client_name`, datas congeladas e
  `brand_snapshot` não mudam na edição. O link que já foi pelo WhatsApp continua
  válido e o cliente recarrega a MESMA URL e vê o conteúdo novo. **Sem
  regeneração** — a decisão do rafa em `itineraries.ts` permanece.
- **Nunca no roteiro:** preço, custo, comissão, documento de passageiro, contato
  do cliente além do nome. §4 na íntegra; o leak-scanner é a rede, não a exceção.
- **Fotografia do fechado só nos dados comerciais.** O CONTEÚDO passa a ser
  editável; o que o cliente aceitou (valores, opção) continua imutável.
- Mobile-first de verdade: o editor é usado pela agente no celular entre um
  atendimento e outro; a página pública é lida pelo turista no sol. Teste os dois
  em 390px, os dois temas, reduced-motion.
- Autocomplete do pasado: bloco com foto pesada na rua 4G é bloco que não abre —
  imagens com lazy loading e tamanho sensato.

## Sugestões de blocos (caminho, não cerca)

Além dos que a proposta já tem (voo, hotel, transfer, passeio, texto, seguro):
- **Dia** — "Dia 1 · Chegada em Lisboa": agrupa a data, vira o esqueleto do guia.
- **Parada/roteiro do dia** — sequência com horário sugerido, endereço, how-to-get.
- **Hospedagem** — endereço, check-in, telefone do hotel, wi-fi (o que o cliente
  procura EM CHEGANDO).
- **Dica local** — moeda, tomada, gorjeta, frase útil; é o que faz o cliente
  mandar print no grupo da família (recompra de graça).
- **Contato de emergência** — o telefone da agente em destaque no topo, sempre
  visível sem rolar.
- **Foto** — o bloco simples de imagem que sustenta tudo acima.

Escolha, nomeie e desenhe como quiser — o teste: a agente monta o roteiro de uma
viagem de 5 dias em menos tempo do que leva para escrever no WhatsApp.

## Ordem sugerida de entrega

1. **Contrato do rafa** (escrita no snapshot + leituras) — sem isso não há tela;
   vale checar com ele o formato dos blocos de foto.
2. **Editor de roteiro (miolo, silencioso)** — blocos de texto/título primeiro,
   autosave, reordenar. entra pelo `RoteiroCard`.
3. **Fotos** — upload reusado, lazy loading na pública.
4. **`/r/[slug]` editorial pleno** — o "uau" do turista; é a ponta que dá
   interview de lançamento.
5. **Pulir o fluxo todo**: estado vazio do `RoteiroCard` vira convite ("Montar o
   roteiro"), e o gerado abre o editor em vez de só mostrar o link.

O seed de cenário (2026-09-09, `src/db/seed.ts`) já tem roteiros gerados com
snapshot real de blocos — Marina em Portugal está EM VIAGEM AGORA com roteiro
pronto: é o seu dado de trabalho. Login `dev@zarpa.local` / `dev12345`.
