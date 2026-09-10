# Rafa → Nina

## 14. Micro-rodada de 2026-09-09 (noite) — os DOIS furos do seu handoff fechados

Ambos consertados; `tsc` zerado, suíte 606/606 (1 teste novo para o furo 2).

### 14.1 `organizationClient()` no ar — sua interface `AuthOrganization` pode se aposentar

`src/lib/auth/client.ts` agora monta `createAuthClient` com
`[magicLinkClient(), organizationClient()]` — o par client-side do plugin server.
`authClient.organization` existe em TIPO agora; o cast de `equipeApi.ts` vira chamada
direta (seus tradutores de erro ficam intocados — o shape de erro do plugin client é
`{ data, error: { message?, status?, code? } }`, que já é o seu `RespostaDoPlugin`).

**Detalhe que muda o seu código ao aposentar o cast** — conferi nos schemas do plugin
instalado (1.7.2):

- `createInvitation({ email, role, organizationId, resend? })` — você já manda
  `organizationId` (o id do tenant). Certo, continue.
- `updateMemberRole({ memberId, role, organizationId? })` e
  `removeMember({ memberIdOrEmail, organizationId? })` — o `organizationId` é OPCIONAL
  no schema, mas **manda**: sem ele a rota resolve a "organization ativa" da SESSÃO, e
  esta casa não mantém `activeOrganizationId` na sessão. Passe
  `{ organizationId: TenantAtual.id }` nos dois (o mesmo `organizationId` do convite).
- `cancelInvitation({ invitationId })` — resolve pelo id do convite, sem org. Como está.

### 14.2 `NegocioDetalhe` carrega `agentId`/`agentName` — sua segunda leitura sai

`obterNegocio` (e o retorno reconciliado do `atualizarNegocio`, que passa pelo MESMO
helper) agora traz os dois campos com o mesmo LEFT JOIN do quadro:

```ts
ficha.data.agentId;    // string | null
ficha.data.agentName;  // string | null — null/null = sem vendedor (dado antigo)
```

O valor atual existe **inclusive no negócio PERDIDO** — é exatamente o caso que o seu
contorno não conseguia (o quadro exclui `isLost`). O `VendedorField` lê só da ficha; o
hint "De quem era não aparece em negócio perdido" se aposenta junto com a leitura do
quadro. E depois de reatribuir, o retorno do `atualizarNegocio` já vem com o
`agentId`/`agentName` NOVOS — atualize o estado com o retorno, sem reler nada (é o
contrato de sempre do patch).

Teste que trava o furo: `tests/deals/escopo-own.test.ts` ("a FICHA carrega
agentId/agentName — inclusive no PERDIDO, que o quadro não devolve").

---

> O handoff antigo foi para `docs/handoffs/old_nao_abrir/`. Este arquivo substitui e traz
> o contrato COMPLETO para a rodada de UI do funil configurável (S15/S16). O backend está
> pronto e verificado: `tsc` limpo, migration 0016 aplicada (25 tabelas com RLS
> habilitado e forçado), suíte 544/544. Tudo aqui está exportado do barril `@/server`.

## O efeito colateral que some com a SUA rodada

Desde a 0016 (`drizzle/0016_negocio_aponta_para_estagio.sql`) o negócio aponta para uma
LINHA de `pipeline_stages` — inclusive para uma coluna que a agente CRIOU, que não tem
equivalente no enum `deals.stage`. Enquanto `/funil` monta as colunas pela lista fixa
`COLUNAS_DO_FUNIL` (`src/server/dealStages.ts`), **um negócio numa coluna customizada
aparece embaixo de "Negociando"** — é o espelho que o banco dá ao enum para coluna sem
`legacy_stage`. O card não sumiu, ele está emprestado para a coluna errada.

**No minuto em que a tela usar `stageId`/`stageLabel` de `listarNegociosDoFunil()`, esse
efeito some sozinho** — e `COLUNAS_DO_FUNIL` pode morar (é documentada como "dias
contados" no próprio arquivo). Nada no backend precisa mudar para isso.

---

## 1. As colunas — `listarEstagios`

```ts
import { listarEstagios, type EstagioDoFunil } from '@/server';

const r = await listarEstagios({ incluirArquivadas: false });
if (!r.ok) { /* r.mensagem / r.correcao */ return; }
const colunas: EstagioDoFunil[] = r.data;
```

Shape EXATO de cada linha:

```ts
type EstagioDoFunil = {
  id: string;             // a coluna de verdade — é por ela que deals.stage_id aponta
  legacyStage: string | null; // valor em deals.stage; NULL = coluna criada pela agente
  label: string;          // o rótulo que a agente vê e edita
  position: number;
  isWon: boolean;         // esta coluna fecha como GANHO
  isLost: boolean;        // esta coluna fecha como PERDIDO
  archivedAt: Date | null;
  totalNegocios: number;  // quantos negócios estão HOJE aqui (por deals.stage_id)
};
```

- **Ordem do quadro = ordem do array.** Vem ordenado por `position` asc, `createdAt` asc.
  Não reordene no cliente nem confie em `position` sozinho (empate desempata por
  `createdAt`).
- Arquivadas ficam de fora por padrão; `incluirArquivadas: true` traz todas (para uma
  tela de histórico, se um dia existir).
- `totalNegocios` vem junto porque é o número que decide se a coluna PODE ser arquivada —
  mostre "3 negócios aqui" antes de oferecer o botão, em vez de deixar a agente descobrir
  a recusa depois do clique.
- **Nunca devolve lista vazia por falta de semente**: tenant que nasceu fora do caminho do
  produto recebe o funil de fábrica aqui, na mesma transação. Um quadro vazio na tela é
  um produto quebrado, não "não configurado" — se `r.data.length === 0` depois de
  `ok: true`, é bug meu, não estado de tela.
- **ATENÇÃO ao nome dos tipos**: `EstagioDoFunil` (esta linha, de `pipelineStages.ts`) é
  DIFERENTE de `EstagioDeFunil` (o enum sem `'perdido'`, de `deals.ts` — campo `stage` de
  `NegocioDoFunil`). Parecidos de propósito ruim; confira qual está importando.

## 2. Escrita nas colunas — as quatro actions

Toda escrita passa pelo gate de dunning (`ASSINATURA_INATIVA` — `avisarRecusaDeEscrita`
lida, como nas outras). Recusa vem com `mensagem` em pt-BR pronta para a tela +
`correcao` (rótulo do botão junto do erro) + `campo` quando faz sentido.

### `criarEstagio(input: CriarEstagioInput)` → `ServiceResult<EstagioDoFunil>`

- Input: `{ label: string; position?: number }`. Label: 1–40 depois de trim. `position`
  0–100, **omitido = entra antes do primeiro fim de funil** ("Fechada"/"Perdida" continuam
  sendo as últimas do quadro, que é o que a agente espera).
- Recusas: rótulo já usado por coluna ativa → `CONFLITO`/`campo: 'label'` ("Já existe uma
  coluna com esse nome."); teto de **12 colunas** → `CONFLITO` ("O funil já tem 12 colunas
  — o máximo." / correcao "Arquivar uma coluna antes de criar outra").
- Nasce SEMPRE como estágio comum: **`is_won`/`is_lost` não são parâmetro** e não existe
  (ainda) action para trocar qual coluna fecha como ganho/perdido — relatórios dependem
  dessa invariante.

### `renomearEstagio(input: RenomearEstagioInput)` → `ServiceResult<EstagioDoFunil>`

- Input: `{ id: string; label: string }`.
- Recusa coluna arquivada (`CONFLITO`, correcao "Reativar a coluna antes de renomear") e
  rótulo duplicado entre ativas (`CONFLITO`/`campo: 'label'`).
- Só o rótulo muda — `legacyStage` e fim de funil intocáveis. Idempotente.

### `reordenarEstagios(input: ReordenarEstagiosInput)` → `ServiceResult<EstagioDoFunil[]>`

- Input: `{ ids: string[] }` — **TODOS os ids ATIVOS, na ordem desejada**. Lista parcial,
  com duplicata ou com id desconhecido é recusada de propósito (`DADOS_INVALIDOS`/
  `campo: 'ids'`, "A ordem enviada não bate com as colunas do funil." / correcao
  "Recarregar o funil e arrastar de novo") — reordenação parcial é a receita para o quadro
  "pular" na tela de quem não mandou a lista inteira.
- Devolve a lista ativa atualizada com contagens — substitua o estado local pelo retorno,
  não concatene. Depois de um drag, mande o array inteiro da ordem final do drag.

### `arquivarEstagio(input: ArquivarEstagioInput)` → `ServiceResult<EstagioDoFunil>`

- Input: `{ id: string }`. Soft — **nunca DELETE** (coluna com negócio dentro nunca some
  do histórico do banco). Idempotente: arquivar duas vezes devolve o estado atual sem
  reclamar.
- **RECUSAS** — os dois casos existem para que negócio nenhum fique órfão:
  1. **Fim de funil** (`isWon || isLost`): `CONFLITO` — "Essa é a coluna de fim de funil —
     o funil precisa dela para fechar negócio." (correcao "Renomear a coluna em vez de
     arquivar"). Arquivar o último deixaria o tenant sem fim de funil, e não há outra
     guarda no banco para isso.
  2. **Coluna com negócio dentro**: `CONFLITO` — "Ainda tem 1 negócio nessa coluna." /
     "Ainda tem N negócios nessa coluna." (correcao "Mover os negócios para outra coluna
     antes de arquivar"). A contagem é **por `deals.stage_id`** e protege também as
     colunas que a agente criou.
- `totalNegocios` de `listarEstagios` serve para a UI mostrar o número ANTES do clique —
  oculte/desabilite o botão quando > 0.
- Arquivada com sucesso, a action fecha o buraco na ordem das que sobraram — reabra o
  quadro com `listarEstagios()` depois do sucesso, não remonte no cliente.

### `reabrirEstagio(input: ReabrirEstagioInput)` → `ServiceResult<EstagioDoFunil>` — NOVO (2026-09-09)

O par do `arquivarEstagio`, que não existia até hoje. **Isto destrava a conversão que você
pediu: a faixa de confirmação do arquivar pode virar toast com desfazer de 8s** — desfazer
= chamar `reabrirEstagio({ id })` com o id que acabou de ser arquivado.

- Input: `{ id: string }`. Idempotente: reabrir coluna que já está no quadro devolve o
  estado atual sem reclamar e sem audit novo.
- **Onde ela volta: NO FIM DO ABERTO** — o mesmo lugar onde uma coluna NOVA entra
  (`criarEstagio` sem `position`): antes do primeiro fim de funil, "Fechada"/"Perdida"
  continuam sendo as últimas do quadro. Não tente restaurar a posição de meses atrás no
  cliente; a action decide e devolve o `EstagioDoFunil` na posição nova.
- **Rótulo em conflito com coluna ATIVA**: a coluna VOLTA com sufixo —
  `"Orçamento (arquivada)"`, `"(arquivada 2)"`… Determinístico e feio de propósito (é a
  MESMA regra da semente de fábrica; nunca derruba no índice único). Mostre o rótulo que
  veio no retorno, não o que o cliente tinha. Esgotados os 9 sufixos → `CONFLITO`/
  `campo: 'label'`, correcao "Renomear a coluna ativa antes de reabrir esta".
- **Teto de 12 colunas ATIVAS vale aqui também** (reabrir é ganhar uma coluna de volta):
  `CONFLITO` — "O funil já tem 12 colunas — o máximo." / correcao "Arquivar uma coluna
  ativa antes de reabrir outra". Nota: o teto do `criarEstagio` contava arquivada também —
  conserti nesta rodada (a própria correção dele só era verdadeira contando ativas).
- Coluna de outro tenant → `NAO_ENCONTRADO` ("Essa coluna não existe mais.") — mesmo
  desenho de sempre.
- Audit `pipeline_stage.reopened` com `{ de, para, position }` no metadata.

## 3. Os negócios no quadro — `listarNegociosDoFunil`

```ts
import { listarNegociosDoFunil, type NegocioDoFunil } from '@/server';

const r = await listarNegociosDoFunil();
if (!r.ok) { /* ... */ return; }
// agrupe por card.stageId no cliente
```

Shape EXATO:

```ts
type NegocioDoFunil = {
  id: string;
  title: string;
  destination: string | null;
  valueCents: number;         // centavos, bigint mode number
  stage: EstagioDeFunil;      // o enum de sempre — PROJEÇÃO; 'negociando' p/ coluna custom
  stageId: string;            // ← use ESTE para posicionar o card
  stageLabel: string;         // ← e ESTE para o cabeçalho da coluna
  stagePosition: number;
  contactId: string;
  contactName: string;
  departureOn: string | null; // 'AAAA-MM-DD'
  diasParado: number;         // maior entre updatedAt e a última activity do negócio
};
```

- Exclui `perdido` de propósito (perdido não tem coluna — é SAÍDA do funil, não um lugar
  onde o negócio fica). Limite de 500 é rede de segurança, não paginação.
- **Montagem do quadro configurável**: colunas = `listarEstagios()`; cards =
  `listarNegociosDoFunil()` agrupados por `stageId`. Coluna sem negócio continua no quadro
  (`totalNegocios: 0`).
- `diasParado` já vem calculado (inclusive no caso em que a `activity` é mais recente que
  `updatedAt`) — não refaça no cliente.

## 4. Mover de estágio — `moverEstagioDoNegocio`

```ts
import { moverEstagioDoNegocio, type DestinoDeEstagio, type NegocioMovido } from '@/server';

const r = await moverEstagioDoNegocio(dealId, { stageId }, motivoPerda?);
```

- **`DestinoDeEstagio = DealStage | { stageId: string }`** — aceita o enum de sempre
  (`'ganho'`, `'perdido'`…) OU a coluna do funil pelo id, inclusive uma criada pela
  agente. A união é no MESMO parâmetro de propósito: uma action só, um lugar para motivo
  de perda, `closedAt` e idempotência. Toda chamada existente (que manda enum) compila e
  se comporta igual.
- **Motivo de perda é OBRIGATÓRIO quando a COLUNA alvo tem `isLost`** — não quando o
  enum é `'perdido'`. Mínimo de 3 caracteres depois de trim; recusa
  `DADOS_INVALIDOS`/`campo: 'motivoPerda'` ("Diga por que essa venda foi perdida antes de
  arquivar."). É isso que mantém o motivo obrigatório MESMO SE a agente renomear
  "Perdida" para "Não rolou".
- Recusa coluna arquivada (`CONFLITO`, `campo: 'stageId'`, correcao "Escolher uma coluna
  ativa do funil") e stageId que não existe neste tenant (`NAO_ENCONTRADO` — id de outro
  tenant devolve o mesmo, de propósito).
- **Idempotente/seguro sob clique duplo e concorrência real**: mover para a coluna onde o
  negócio já está devolve o estado atual sem gravar nada; duas chamadas quase
  simultâneas para a MESMA coluna → a segunda afeta zero linhas, sem `activity`
  duplicada, sem erro. Pode otimizar na UI sem medo.
- `closedAt` = agora ao entrar em coluna `isWon`/`isLost`, e `null` ao sair de volta para
  coluna aberta (reabrir não pode deixar `closed_at` de venda que "fechou" no mês passado
  mentindo para o dashboard). `lostReason` só existe enquanto `isLost`.
- Retorno `NegocioMovido`: `{ id, stage, stageId, stageLabel, isWon, isLost, lostReason,
  closedAt, updatedAt }` — `isWon`/`isLost` direto da coluna alvo.
- **ATENÇÃO na activity `stage_changed`** (se a sua timeline lê): `body` e
  `metadata.de`/`metadata.para` seguem em VALOR DE ENUM de propósito —
  `NegocioScreen.tsx` reconstrói a frase com `STAGE_LABEL[de]` e monta a versão otimista
  no mesmo formato. Os ids vão junto como campo NOVO (`metadata.deStageId`,
  `paraStageId`, `paraLabel`, `motivoPerda?`) para você passar a usar rótulo quando
  quiser. Mudar o formato do `body`/`metadata.de` quebra a timeline existente sem avisar.

## 5. Criar negócio — `criarNegocio`

`CriarNegocioInput` ganhou `stageId?: string` — em qual coluna o negócio nasce. **Omitido
= "Novo contato"** (o comportamento de sempre). Com `stageId`, nasce na coluna escolhida
desde que ela esteja ATIVA e não seja fim de funil:

- Coluna arquivada → recusa; fim de funil (`isWon`/`isLost`) → `CONFLITO`
  ("Um negócio não nasce fechado.", `campo: 'stageId'`, correcao "Criar numa coluna
  aberta e mover depois"). Ganho exige a venda que ainda não existe; perdido exige motivo
  de perda, que `criarNegocio` não pede. Quem quiser negócio fechado: cria e move — as
  regras de fechamento moram em `moverEstagioDoNegocio`.

## 6. Editar negócio — `atualizarNegocio` (o item 4.2 do seu handoff antigo, pronto)

```ts
import { atualizarNegocio, type NegocioPatch, type NegocioDetalhe } from '@/server';

const r = await atualizarNegocio(dealId, { valueCents: 350_000 });
```

- **O que ela pode editar**: `title`, `destination`, `paxAdults`, `paxChildren`,
  `valueCents`, `departureOn`, `returnOn`, `expectedCloseOn`. Tudo opcional, um campo por
  vez — é patch de autosave (a tela salva no blur; não há botão Salvar grande).
- **Datas**: aceitam `AAAA-MM-DD` ou `DD/MM/AAAA`. `''` (string vazia) = **LIMPAR** (vira
  `null` no banco); `undefined` = **não toque nesta coluna**. A action distingue os dois —
  não transforme `''` em `undefined` no cliente, senão "limpar a data" para de funcionar.
- Valida `returnOn >= departureOn` contra o valor que vai FICAR no banco (o novo se veio
  no patch, o existente caso contrário). Recusa patch vazio (`DADOS_INVALIDOS`, "Nada
  para salvar.").
- **Devolve o `NegocioDetalhe` completo reconciliado** — mesmo shape de `obterNegocio`
  (dados + `activities`, mais recente primeiro). Atualize o estado local com o retorno,
  não reconsulte.
- NÃO aceita `stageId`: trocar a coluna é trabalho do `moverEstagioDoNegocio`, onde estão
  motivo de perda, `closedAt`, activity e auditoria.
- `isWon`/`isLost` vêm no `NegocioDetalhe` — é por eles que a ficha sabe que fechou, não
  pelo enum `stage` (que continua batendo, mas é espelho).

## 7. `listarPropostas({ dealId })` — o seu pedido antigo, entregue

Do handoff antigo, item 4.1: a ficha do negócio buscava
`listarPropostas({ incluirArquivadas: true, limite: 200 })` e filtrava
`p.dealId === dealId` no cliente. O filtro de verdade existe:

```ts
import { listarPropostas, type FiltroPropostas, type PropostaResumo } from '@/server';

const r = await listarPropostas({ dealId, incluirArquivadas: true });
if (!r.ok) { /* ... */ return; }
const propostas: PropostaResumo[] = r.data;
```

- `dealId?: string` em `FiltroPropostas` (exportado do barril). Combina com `busca`,
  `ids`, `incluirArquivadas` por AND.
- Retorno continua `PropostaResumo[]` — pode haver MAIS DE UMA proposta por negócio
  (`proposals_deal_id_idx` não é único), por isso é lista, não single.
- Isolamento: `dealId` de outro tenant devolve **lista vazia com `ok: true`** — o corte é
  do RLS, nem aparece que existia. `dealId` malformado → `DADOS_INVALIDOS`/`campo:
  'dealId'` (validação com zod antes de abrir transação, sem erro cru de driver).
- Coberto em `tests/proposals/filtro-deal.test.ts` (4 pontas: filtro, arquivadas,
  isolamento, uuid malformado).

## 8. O que NÃO existe (para não procurar)

- **Trocar QUAL coluna fecha como ganho/perdido** (`is_won`/`is_lost` não são editáveis
  por action): relatórios e dashboard dependem da invariante "um único de cada por
  tenant". Se o produto pedir, é rodada de backend com migration.
- **Reativar coluna arquivada**: EXISTE desde 2026-09-09 — `reabrirEstagio({ id })`, §2
  acima. `listarEstagios({ incluirArquivadas: true })` continua sendo a forma de VER o
  histórico.
- **Excluir coluna**: não existe e não vai existir — arquivamento é soft, negócio nunca
  fica órfão.
- **`COLUNAS_DO_FUNIL`**: continua exportada do barril para não quebrar o que existe
  hoje, mas é o caminho antigo. Quando o quadro usar `listarEstagios()`, me diga que eu
  a removo.

## 9. Notas de casa (iguais das rodadas anteriores)

- Toda action devolve `ServiceResult`; a recusa traz `mensagem` em pt-BR pronta para a
  tela e `correcao` como rótulo do botão — nunca traduza código de erro nem invente texto.
- Dinheiro em centavos `number`; datas saem `AAAA-MM-DD` ou `null`; `timestamptz` sai
  como `Date`.
- O gate `ASSINATURA_INATIVA` vale para TODA escrita desta rodada (criar/renomear/
  reordenar/arquivar estágio, mover/criar/atualizar negócio) — `avisarRecusaDeEscrita`
  cobre. Leituras NUNCA passam pelo gate.
- Erro de conflito de nome de coluna vem com `campo: 'label'` — liga no FieldError da
  sheet, como nas outras.

---

## 10. O editor de roteiro — contratos NO AR (2026-09-09, a rodada que você está fazendo agora)

As quatro actions do editor de conteúdo do roteiro (`src/server/itineraries.ts`), todas
exportadas do barril `@/server`. A premissa do produto continua de pé: o roteiro é a
FOTOGRAFIA da proposta aceita, e o editor reescreve SÓ O CONTEÚDO — **`publicToken` nunca
muda, o link que já foi pelo WhatsApp continua válido; o cliente recarrega a MESMA URL e
vê o conteúdo novo.** Título, cliente, moeda, datas e marca também são intocáveis (seguem
sendo os da proposta aceita). Sem regeneração.

```ts
type BlocoDoRoteiro = {
  kind: string;                     // o vocabulário do CHECK: text, image, flight, hotel,
                                    // transfer, tour, cruise, insurance, price_note
  position: number;                 // int 0..10000
  title: string | null;             // máx. 160 depois de trim
  body: string | null;              // máx. 8000 depois de trim
  images: string[];                 // máx. 10, cada uma 1..2000 chars
  content: Record<string, unknown>; // jsonb livre — MAS veja a portaria abaixo
};
```

Semântica nova ("dica local", "dia a dia") viaja DENTRO do `content` reusando um `kind`
existente. `kind` NOVO é migration alterando o CHECK — decisão de schema, não parâmetro de
tela (avaliado no §4 do pedido: caminho A).

### As quatro assinaturas

```ts
// 1. A que o editor ABRE: o conteúdo atual, na MESMA forma que a escrita aceita de volta.
//    load → edit → save sem reshape nenhum.
obterConteudoDoRoteiro(dealId): Promise<ServiceResult<BlocoDoRoteiro[] | null>>
//    null = o negócio ainda não tem roteiro gerado (estado "antes de gerar", não erro —
//    é o caso que o botão "Gerar roteiro" resolve). **O conteúdo vem daQUI** —
//    `listarRoteiroDoNegocio` NÃO traz blocos (é resumo, abaixo). Se o seu
//    `roteiroApi.ts` tipou blocos no retorno do listar, é este o ajuste.

// 2. O resumo (o que nunca muda + o token do link). Serve para o cabeçalho do editor e
//    para o link/copy.
listarRoteiroDoNegocio(dealId): Promise<ServiceResult<RoteiroResumo | null>>
//    RoteiroResumo = { id, dealId, proposalId, publicToken, title, clientName, currency,
//    departureOn, returnOn, createdAt }. null = sem roteiro (mesma resposta para deal
//    de outro tenant — nem aparece que existiu).

// 3. A que APONTA a proposta aceita (para o editor dizer "fotografando a proposta X" ou
//    explicar por que não dá para gerar).
obterPropostaAceitaDoNegocio(dealId): Promise<ServiceResult<PropostaAceitaDoNegocio | null>>
//    PropostaAceitaDoNegocio = { proposalId: string; title: string } | null.
//    É a MESMA proposta que o `gerarRoteiro` fotografaria (mesma query compartilhada);
//    null = sem aceite — o mesmo caso que a recusa do gerar aponta.

// 4. A que SALVA.
atualizarConteudoDoRoteiro(dealId, blocos: BlocoDoRoteiro[]): Promise<ServiceResult<RoteiroResumo>>
```

Nos quatro: `dealId` malformado → `DADOS_INVALIDOS`/`campo: 'dealId'`. Cross-tenant →
"não existe" (`null` na leitura, `NAO_ENCONTRADO` na escrita), de propósito
indistinguível de id inexistente.

### `atualizarConteudoDoRoteiro` em detalhe

- **Manda a lista COMPLETA de blocos** — ela reescreve o snapshot inteiro (é o mesmo
  contrato de `reordenarEstagios`: lista parcial não existe aqui). Máx. **100 blocos**.
- **Devolve o estado PERSISTIDO** (`RoteiroResumo` reconciliado), não o patch — atualize a
  tela com o retorno.
- **Idempotência barata para o autosave**: o MESMO conteúdo (comparação canônica, imune à
  reordenação de chaves do jsonb) é **no-op** — `updatedAt` fica parado e nenhum audit
  nasce. Pode martelar sem sujar o histórico. Mudou qualquer coisa → grava e audita
  `itinerary.updated`.
- **Lista vazia `[]` é aceita** = apagar todo o conteúdo do roteiro (é edição legítima; a
  página pública mostra o roteiro vazio). Se o produto não quer isso, a trava é sua.
- Recusas que a tela vai ver:
  - `NAO_ENCONTRADO` — "Este negócio ainda não tem roteiro gerado." / correcao "Gerar o
    roteiro antes de editar o conteúdo".
  - `CONFLITO` de teto não existe aqui; `ASSINATURA_INATIVA` do gate de dunning sim (é
    escrita).
  - **A PORTARIA** (abaixo) — `DADOS_INVALIDOS` com `campo` apontando o bloco e a chave
    exatos.

### A PORTARIA — o que o editor não pode deixar a agente salvar em `content`

Chave de `content`, em qualquer profundidade, que cheire a **preço, custo, comissão,
CPF/documento, passaporte, e-mail, telefone ou nascimento** é recusada com:

```
code: 'DADOS_INVALIDOS'
mensagem: 'O roteiro não pode guardar "preco" — preço não vai para a página do cliente.'
campo: 'blocos[2].content.preco'          ← abra o bloco e o campo certos
correcao: 'Remover esse campo do bloco e salvar de novo'
```

Três consequências práticas para o seu editor:

1. **Telefone de emergência vai no `body` (prosa), não como chave de `content`.** Chave
   `whatsapp`/`telefone`/`phone` é recusada; "Guia: +55 11 91234-5678" escrito no texto do
   bloco passa — é conteúdo para o cliente ler, não dado estruturado de contato.
2. **`preço` é família extra daqui** (a única além do espelho do leak-scanner): a proposta
   pública é cotação e mostra preço; a página do roteiro NÃO é cotação. `preco`, `valor`,
   `tarifa`, `diaria`, `amount`… como chave → recusada.
3. **camelCase não escapa**: `custoTransfer` é recusada como `custo` (a portaria reparte
   camelCase antes de testar). O vocabulário legítimo que existe hoje
   (`airline`, `hotelName`, `checkIn`, `noites`, `cobertura`…) passa limpo — conferi contra
   `CONTENT_FIELDS`, os `details` da biblioteca e o seed antes de endurecer.
4. (bônus) Re-salvar EXATAMENTE o que já está gravado é no-op mesmo que o snapshot legado
   contenha chave proibida — nada novo entra, então nada é recusado. Mudança REAL com
   chave proibida é recusada sempre.

Prova: `tests/itineraries/conteudo-do-roteiro.test.ts` (12 casos novos no total com os do
`reabrirEstagio` — só-conteúdo preserva link/dados comerciais, no-op do autosave, as três
recusas da portaria com `campo` exato, `kind` fora do vocabulário, teto de 100, isolamento
cross-tenant, e as leituras apontadas).

---

## 11. Assinatura — "Agência · por Agente" + "via {APP_NAME}" (2026-09-09, a rodada da tela "Sua marca")

Toda comunicação que chega na ponta assina em DUAS linhas:

```
Volta ao Mundo · por Carolina Vasques
via Zarpa
```

O backend está pronto e verificado (`tsc` limpo, migration 0017 aplicada, suíte 568/568).
Nomes de novo: `tenants.agent_display_name` (coluna nova, anulável — null/'' = assinatura
só com brand_name; é exibição, não dado sensível).

### O helper — UM só, importe dele

```ts
import {
  linhaDeAssinatura,   // "Volta ao Mundo · por Carolina" | "Volta ao Mundo" | null
  linhaViaApp,         // "via Zarpa" (sempre)
  assinaturaDaMarca,   // as linhas prontas: string[] (1 ou 2 linhas, nunca vazia)
  textoComAssinatura,  // mensagem + "\n\n" + assinatura → o corpo do ?text= do WhatsApp
} from '@/lib/assinatura';
```

- Aceita **os dois nomes que a marca tem**: `{ brandName, agentDisplayName }` (o
  `TenantAtual`) OU `{ name, agentDisplayName }` (o `brand` do payload público). Passe o
  objeto que já está na sua mão: `assinaturaDaMarca(tenant)` na tela,
  `assinaturaDaMarca(brand)` na página pública. `null`, `undefined` e `''` são a mesma
  coisa para o helper — não normalize nada antes.
- `textoComAssinatura(mensagem, marca)` é o que alimenta o `?text=` do WhatsApp
  (`encodeURIComponent(textoComAssinatura(...))`). Mensagem vazia → devolve só a
  assinatura; nunca string vazia.
- **Nunca monte as linhas na mão e NUNCA use a string do produto crua** — o nome sai do
  token `APP_NAME`, que agora mora onde o CLAUDE.md sempre mandou:
  **`src/lib/config.ts` existe** (novo, meu). O seu `src/lib/ui/brand.ts` pode passar a
  reexportar de lá (e sumir), como o comentário dele já planejava — arquivo seu, decisão
  sua, nenhuma tela muda.

### Shapes exatos

**Leitura (o que a tela "Sua marca" mostra)** — `obterTenantAtual()`:

```ts
type TenantAtual = {
  id, name, slug, plan, status,          // como antes
  brandName: string | null;
  brandLogoUrl: string | null;
  brandPrimaryColor: string | null;
  brandSecondaryColor: string | null;
  whatsapp: string | null;
  instagram: string | null;
  agentDisplayName: string | null;       // ← NOVO (0017)
  contactEmail: string | null;           // ← NOVO também (já era editável, não era lido)
};
```

**Escrita** — `atualizarMarca(input: MarcaInput)` segue `ServiceResult<null>`:

```ts
{
  brandName?, brandLogoUrl?, brandPrimaryColor?, brandSecondaryColor?,
  whatsapp?, instagram?, contactEmail?,
  agentDisplayName?,                     // ← NOVO: string (trim, máx. 80) ou ''
}
```

Semântica de autosave da casa: campo **ausente = não toque**; `''` = **LIMPAR** (vira
NULL no banco, nunca string em branco); mais de 80 caracteres → `DADOS_INVALIDOS` com
`campo: 'agentDisplayName'`. Passa pelo gate de dunning como toda escrita.

**Página pública (`/p/` e `/r/`)** — o `brand` ganhou UMA chave:

```ts
brand.agentDisplayName?: string | null   // opcional de propósito — leia abaixo
```

A função pública só emite a chave QUANDO o snapshot traz assinatura. Proposta enviada
antes de o agente configurar o nome **não tem a chave** (e o payload dela não mudou um
byte — fotografia, link que já foi pelo WhatsApp não muda de cara). Na prática: renderize
`assinaturaDaMarca(brand)` e pronto — com a chave sai "Agência · por Agente / via …", sem
a chave sai "Agência / via …". Para o nome APARECER numa proposta antiga: reenviar
(`enviarProposta` re-congela o snapshot). Roteiro congela na geração e não tem
regeneração — roteiro velho não ganha assinatura, e está certo assim.

### O que já assina sem você fazer nada

O seed de demonstração foi atualizado: `/p/` e `/r/` dos dois tenants demo saem com
"Volta ao Mundo · por Carolina Vasques" e "Maré Alta · por Rodrigo Sanhudo". Prova ao
vivo no `zarpa_dev` e teste em `tests/brand/assinatura.test.ts`.

### Não existe (para não procurar)

- Nenhuma action nova de marca — `atualizarMarca`/`obterTenantAtual` continuam sendo as
  duas portas.
- A assinatura NÃO entra no `brand_snapshot` de proposta em rascunho, não aparece em
  lista/ficha — só nas pontas (página pública, roteiro, texto de WhatsApp) e na tela de
  configuração.
- Não há "mostrar/ocultar a linha via {APP_NAME}" — a linha é sempre. Se o produto um
  dia quiser ocultar, é decisão do PO e muda no helper, num lugar só.

---

## 12. Fases 1 e 2 do Monde — contratos NO AR (2026-09-09, a rodada das telas de Relatórios e Orçamentos)

O barril `@/server` agora exporta os seis nomes que a sua ponte (`src/lib/ui/fase12Api.ts`)
sonda. As assinaturas são as que você tipou — pode aposentar a sonda com import estático.
Além das seis, existe UMA action extra (`definirTemplatePadrao`) e DUAS leituras de apoio,
todas no fim desta seção.

### Templates de proposta — `proposalTemplates.ts`

```ts
listarTemplates(): Promise<ServiceResult<TemplateResumo[]>>
// TemplateResumo = { id, name, isDefault, createdAt }  ← SEM blocos (a lista é barata)
// Ordem: isDefault DESC, createdAt DESC — o padrão vem primeiro.

obterConteudoDoTemplate(templateId): Promise<ServiceResult<BlocoDeTemplate[]>>
// BlocoDeTemplate = { kind, position, title, body, images, content }  — A MESMA forma
// de BlocoEdicao SEM optionId/ids. Posições renumeradas 0..n-1. NAO_ENCONTRADO se sumir.

criarTemplateDeProposta({ proposalId, name }): Promise<ServiceResult<TemplateResumo>>
// Fotografou os blocos ATUAIS da proposta. Devolve o resumo do modelo criado —
// coloque na lista na hora, sem reler tudo.
// CONFLITO se a proposta não tem bloco nenhum ("Montar a proposta antes de salvar").

removerTemplate(id): Promise<ServiceResult<null>>   // NAO_ENCONTRADO se já sumiu

criarPropostaDeTemplate({ templateId, dealId? }): Promise<ServiceResult<{ proposalId }>>
// Proposta DRAFT nova, título "Proposta — {destino ?? negócio}", blocos copiados sem
// optionId, mesma via do criarPropostaAPartirDoNegocio. Mande direto para o editor.
// ** DIVERGÊNCIA DO TRAVADO: ** dealId é opcional no TIPO (como travado), mas
// proposals.deal_id é NOT NULL — sem negócio não há proposta. A ausência volta como
// DADOS_INVALIDOS com campo: 'dealId' e correção "Escolher o negócio e tentar de
// novo". Sua NovaPropostaSheet já pede o negócio — nada muda para você; o opcional
// existe só para o chamador não quebrar.
```

`is_default` na UI: o default vem marcado em `listarTemplates()` e primeiro na lista —
pré-seleção é sua, como combinado. Para TROCAR o padrão existe a action extra:

```ts
definirTemplatePadrao(templateId): Promise<ServiceResult<TemplateResumo>>
// Transação única: desliga os outros e liga este. Sem ela, is_default é inalcançável.
```

Leituras de apoio (mesmo arquivo, para pré-visualização no sheet): as duas de cima
resolvem; nada além delas existe no servidor para template.

### Resultado por viagem — `resultado.ts`

```ts
resultadoDaViagem(dealId): Promise<ServiceResult<ResultadoDaViagem>>
// { dealId, saleId | null, currency,
//   valorVendaCents, custoPrevistoCents, comissaoPrevistaCents,
//   recebidoCents, aReceberCents,          ← REALIZADO (parcelas)
//   margemPrevistaCents, comissaoStatus }  ← margem = valorVenda − custoPrevisto
```

- Fonte do previsto: venda lançada → senão opção aceita → senão o que está no negócio.
  `saleId !== null` diz que a fonte é a venda.
- Sem venda lançada, `recebidoCents`/`aReceberCents` são 0 (não há parcelas).
- **Recusa negócio ABERTO** com CONFLITO e correção "Mover o negócio para Fechada antes".
  Sua ficha já só pede quando isWon — o erro é cinto de segurança, não fluxo.

### Ranking de clientes — `ranking.ts`

```ts
rankingDeClientes(filtro?: { de?, ate?, limite? }): Promise<ServiceResult<LinhaDoRanking[]>>
// LinhaDoRanking = { contatoId, nome, totalCompradoCents, viagens }
// viagens = negócios distintos comprados (não parcelas, não vendas).
// Ordena totalCompradoCents desc (empate: mais viagens, depois alfabético pt-BR).
// limite default 10, máximo 50. `mes` também aceita, como todo período da casa.
```

### As três rotas GET (link de verdade, sem fetch — `fase12Api.ts` já tem as URLs)

| Rota | Devolve | Headers que importam |
|---|---|---|
| `/api/recibos/[vendaId]` | PDF `inline` (abre em aba) | `application/pdf`, `no-store` |
| `/api/export/passageiros/[dealId]` | CSV `attachment`, nome datado com slug | `text/csv; charset=utf-8`, BOM no conteúdo |
| `/api/export/vendas?de=&ate=` | CSV `attachment`, `vendas-2026-09-01_a_2026-09-30.csv` | idem (faixa no nome quando período explícito) |

Use como `<a href>`/`window.open` — são links, não chamadas. Erro NÃO é CSV: volta JSON
com `{ ok: false, code, mensagem, correcao }` e status 401/404/400/409/402 (a legenda
fica em `src/server/respostas.ts`). Um `fetch` que só olha `res.ok` antes de baixar
cobre os dois mundos.

### Detalhes que poupam uma ida ao código

- `BlocoDeTemplate.kind` aceita os MESMOS nove kinds do editor; bloco com kind
  desconhecido vira `'text'` ao copiar (não falha).
- Template guarda a FOTOGRAFIA: editar a proposta de origem não muda o modelo — se a
  tela oferecer "atualizar modelo", é um criar+remover por cima, não existe action de update.
- Criar de modelo NÃO torna o modelo padrão; criar modelo NÃO desliga o padrão atual.
- O CSV de vendas usa `sales.created_at` como relógio do período — os números batem
  com o hub Dinheiro, que é o mesmo relógio.

---

## 13. Fase 3 — Equipe, assentos, alternador Meus/Time e a quebra por vendedor (2026-09-09)

A fundação multiusuário está no ar: plugin `organization` do Better Auth com as tabelas
`organization`/`member`/`invitation` na migration `0019_multiusuario.sql`, RLS
ENABLE+FORCE nas três (dual policy, igual `user`/`session`), **o id da organization É o
id de `tenants`** — não existem dois conceitos de tenant. Suíte 605/605, `tsc` limpo.

### 13.1 A tela Equipe — leitura: `listarEquipe()`

```ts
import { listarEquipe, type EquipeResumo } from '@/server';

const r = await listarEquipe();
if (!r.ok) { /* r.mensagem / r.correcao */ return; }
```

```ts
type EquipeResumo = {
  membros: {
    memberId: string;        // id da LINHA de membership (não é userId!)
    userId: string;
    name: string | null;
    email: string;
    role: 'owner' | 'admin' | 'member';  // papel NATIVO do plugin — o rótulo é seu
    memberSince: Date;
  }[];
  convitesPendentes: {       // SÓ pending e não vencidos — histórico não ocupa tela
    invitationId: string;    // o que o cancelar de convite manda
    email: string;
    role: 'owner' | 'admin' | 'member';
    status: 'pending' | 'accepted' | 'rejected' | 'canceled';
    expiresAt: Date;
    createdAt: Date;
    inviterName: string | null;   // "Convidado por Ana em 12/08"
  }[];
  assentos: {
    pagos: number;      // subscriptions.seats_paid — o que se paga
    usados: number;     // membros ativos + convites pendentes (ocupação de verdade)
    inclusos: number;   // 3 no Studio, 1 em Solo/Pro — além disso custa R$ 39,90/mês
  };
  plano: 'solo' | 'pro' | 'studio';
  solicitanteUserId: string;   // marque "você" na lista; esconde ação sobre si mesmo
};
```

- **"Agente" é rótulo de interface sobre `role: 'member'`** — o banco só conhece
  `owner`/`admin`/`member` (CHECK no banco; gravar 'agente' é recusado). Traduza na
  tela: owner → "Dono(a)", member → "Agente".
- `assentos.usados > assentos.pagos` não deve acontecer (o gate do plugin recusa o
  convite N+1), mas se aparecer, mostre o estado amarelo honesto em vez de esconder —
  é sinal de corrida rara, não de bug de tela.

### 13.2 Escrita da Equipe — o plugin responde, não eu

Convite, cancelar convite, mudar papel e remover membro são os endpoints NATIVOS do
plugin via `authClient.organization` (`createInvitation`, `cancelInvitation`,
`updateMemberRole`… , `removeMember`) — **não existe action própria para isso em
`@/server`**. Duas consequências:

1. O erro do plugin NÃO vem como `ServiceResult` — vem no formato do better-auth
   (`{ error: { message, status } }`). Envolva com o tratamento de erro de cliente que
   a casa já usa; mensagem de limite é "membership limit reached" do plugin.
2. O gate de assentos é o `membershipLimit` DINÂMICO que aponta para
   `subscriptions.seats_paid`: convite que estourar o limite é recusado no
   `createInvitation`; a contagem que decide é de MEMBROS ativos (convite pendente não
   reserva vaga no banco — ele "reserva" só na percepção da tela via `assentos.usados`).
   Quem paga mais assento convida mais gente, sem deploy nenhum.
3. O e-mail de convite sai por `deliverInviteEmail` (mesma doutrina do magic link: sem
   `RESEND_API_KEY` em dev, o link vai mascarado para o console — nunca um e-mail real
   em dev).
4. Quem é convidado SEM conta entra pelo signup normal: o signup detecta convite
   pendente para o e-mail e nasce DENTRO do tenant de quem convidou (não cria tenant
   novo), já como `member` com o papel do convite. Respeite isso no pós-signup: a
   pessoa não passa pela tela de "criar agência".

### 13.3 Assentos — a ação de billing da tela Equipe

```ts
import { alterarAssentos, obterAssinaturaAtual, type AssinaturaAtual } from '@/server';

// AssinaturaAtual ganhou seatsPaid — a Equipe lê por aqui também.
const { seatsPaid } = (await obterAssinaturaAtual()).data!;

const r = await alterarAssentos({ assentos: 3 });  // TOTAL pago, dono incluso
```

- Recusas com a correção certa: Solo → `DADOS_INVALIDOS`/`campo: 'assentos'` ("o Solo é
  para quem trabalha sozinho", correcao "Migrar para o Pro"); reduzir abaixo do número
  de membros → `CONFLITO` (correcao "Gerenciar membros na Equipe"). Desabilite os botões
  com `listarEquipe()` antes — mas deixe o erro do servidor ser a verdade.
- Idempotente: mandar o mesmo número de novo devolve o estado atual, sem cobrar nem
  auditar de novo.
- `AssinaturaAtual.amountCents` passa a refletir base + extras × R$ 39,90 — se a tela
  Cobrança mostra valor mensal, ele muda junto, de graça.

### 13.4 Alternador Meus/Time — o que existe e o que NÃO existe

O escopo é decidido no service layer a partir do PAPEL da sessão
(`src/server/escopo.ts`): dono vê o tenant inteiro, qualquer outro papel vê só o próprio
trabalho (`deals.agent_id = userId` / `sales.agent_id = userId`). **O membro não escolhe
escopo** — mostrar "Time" para quem não é dono seria prometer gestão sem dar poder de
gestão. Para a tela:

- `ResumoDoPeriodo` (tab Resumo do período) ganhou `escopo: 'tenant' | 'own'` — renderize
  o rótulo a partir DELE, nunca do papel que o cliente acha que tem: o backend é quem diz
  de quem são aqueles números.
- O board (`listarNegociosDoFunil`) já vem escopado: membro recebe só os próprios cards —
  não filtre de novo no cliente.
- Para o DONO, "Time" é o default e é tudo que existe hoje; um toggle "só os meus" para o
  dono é pedido novo de backend (parâmetro de escopo opcional), me diga se o PO pedir.

### 13.5 A quebra por vendedor — exclusiva do Studio (decisão do PO, 2026-09-09)

`ResumoDoPeriodo.porVendedor`:

```ts
type QuebraPorVendedor =
  | { disponivel: true; linhas: {
      agentId: string | null;   // null = venda sem vendedor (dado antigo): "sem vendedor"
      nome: string | null;      // null junto com agentId null
      vendas: number;
      receitaBrutaCents: number;   // tabular-nums, largura reservada
    }[] }                        // maior receita primeiro
  | { disponivel: false; motivo: 'plano' | 'membro_unico' };
```

- `motivo: 'plano'` → Pro/Solo: a tela esconde a seção com uma frase honesta ("A quebra
  por vendedor é do Studio"). `motivo: 'membro_unico'` → Studio com 1 pessoa: esconde
  sem upsell agressivo (a pessoa ainda não tem time).
- A quebra segue o ESCOPO: dono de Studio vê o time inteiro; membro de Studio vê a
  própria linha (que é exatamente o que o escopo `own` já dá — a quebra repete, e está
  certo).
- Dinheiro em centavos, `tabular-nums`, largura reservada — número que muda de largura
  ao carregar é bug da casa.

### 13.6 O board e a ficha — o que mudou para você

- `NegocioDoFunil` ganhou `agentId: string | null` e `agentName: string | null` — o card
  pode mostrar o monograma/nome de quem carrega. `criarNegocio` atribui ao criador.
- `atualizarNegocio` ganhou `agentId?: string | null` no patch — **só o dono manda**:
  membro que tentar reatribuir recebe `DADOS_INVALIDOS`/`campo: 'agentId'` ("Só o dono
  da conta reatribui negócios."). Esconda o controle para quem não é dono — mas o erro
  do servidor continua sendo a verdade.
- Dado antigo sem vendedor: `agentId: null` é estado legítimo (a 0019 fez backfill pelo
  primeiro ator da timeline; o que não tinha activity nenhum ficou null de propósito —
  nulo honesto vira inventado).

### 13.7 Não existe (para não procurar)

- Action de convite/cancelar/papel/remover em `@/server` — é tudo `authClient.organization` (§13.2).
- Alternador de escopo para membro (§13.4).
- `admin` com superpoderes de billing: dono segue sendo o único que troca plano/assentos.
- Papéis custom (`createAccessControl`): ficou fora de propósito — 2–4 pessoas não
  precisam de RBAC de ERP.
- **Pendência do PO (registrada, não resolvida)**: usuário que JÁ tem conta e tenant
  próprio, convidado para outra agência, ao aceitar continua com a sessão apontando para
  o tenant antigo. O caso dominante (convidado sem conta) está inteiro via signup. O PO
  precisa decidir entre bloquear convite a quem já tem conta ou trocar de tenant no
  aceite — está no meu handoff para ele.
