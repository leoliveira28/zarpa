# Nina → Rafa

> Rodada de 2026-09-09 (noite): TELAS DA FASE 3 — `/equipe` completa (membros,
> convites, assentos), monograma (§8), rótulo de escopo no Resumo (§13.4),
> quebra por vendedor (§13.5) e reatribuição de negócio na ficha (§13.6).
> Dois furos de contrato, ambos contornados com honestidade e NÃO consertados
> por mim (fronteira): os itens 1 e 2 abaixo.

## 1. FURO — `organizationClient()` não existe no client (o mais importante)

`src/lib/auth/client.ts` monta o `createAuthClient` com só `magicLinkClient()`
no array de plugins. SEM o `organizationClient()`, `authClient.organization`
funciona em RUNTIME (o client da better-auth é proxy dinâmico — o POST
`/organization/create-invitation` sai e volta), mas não EXISTE em tipo, então
`tsc` recusa o acesso natural.

**Meu contorno:** `src/lib/ui/equipeApi.ts` declara uma interface local
`AuthOrganization` (as quatro mutações: `createInvitation`, `cancelInvitation`,
`updateMemberRole`, `removeMember`) e chega lá por cast tipado. Os tradutores
de erro do formato better-auth (`{ error: { message, status } }` → par
mensagem + correção da casa) moram no mesmo arquivo e são independentes disso.

**Seu conserto:** colar `organizationClient()` (better-auth/client) no array de
plugins de `src/lib/auth/client.ts` e me avisar. Aí a interface se aposenta e
o arquivo passa a chamar `authClient.organization.*` direto — os tradutores
ficam. De olho: com o plugin client, o shape de erro pode ganhar campos
(`code`); meus tradutores já olham `message`/`status`, teste a recusa de
limite ("Organization membership limit reached") que é a que mais importa.

## 2. FURO — `NegocioDetalhe` não carrega `agentId`/`agentName`

A ficha do negócio não sabe de quem é. O select de reatribuição (dono only,
§13.6) precisa do valor ATUAL para mostrar "onde está" antes de mudar.

**Meu contorno** (precedente: a `PropostaCard` já filtra `listarPropostas` por
`dealId` no cliente): ler `listarNegociosDoFunil()` e achar pelo id — o quadro
tem os dois campos. Consequência honesta que o desenho assume: negócio
PERDIDO não volta no quadro (`isLost = false` na query), então ali o valor
atual é DESCONHECIDO — o campo mostra placeholder "Escolher vendedor" com o
hint "De quem era não aparece em negócio perdido — escolher aqui reatribui.",
em vez de fingir que sabe.

**Seu conserto:** espelhar `agentId`/`agentName` (o mesmo LEFT JOIN `user` que
o quadro já faz) em `obterNegocio`/`NegocioDetalhe`. Aí a segunda leitura
sai do `VendedorField` e o hint condicional se aposenta.

## 3. Consumido e de pé (nada a fazer)

- `listarEquipe`/`EquipeResumo`: papel NATIVO no rótulo ("Dono(a)"/"Agente" é
  tradução de tela, o banco fala owner/member); "você" pelo
  `solicitanteUserId`; `assentos.usados` = membros + convites pendentes (o
  estado amarelo `usados > pagos` tem tela própria e honesta).
- `alterarAssentos` com as recusas exatas do §13.3 — Solo e "equipe tem N
  pessoas" chegam com mensagem + correção e a tela só repassa (os controles já
  nascem limitados pelo estado de `listarEquipe`; o erro do servidor segue
  sendo a verdade).
- `atualizarNegocio` com `agentId` — o guard de dono do servidor é real: o
  cliente ESCONDE o campo para não-dono, e a recusa `DADOS_INVALIDOS`/campo
  `agentId` ("Só o dono da conta reatribui negócios.") aparece com "Tentar de
  novo" junto, na régua da casa.
- `resumoDoPeriodo`: `escopo` vira rótulo na linha do período ("set 2026 ·
  Time" / "· Meus" — §13.4: dono sem alternador, membro sem toggle) e
  `porVendedor` alimenta a seção nova, depois de Resultado das viagens.
- `organizationId` do convite = `TenantAtual.id` (0019 — id da organization É
  o id do tenant), via `obterTenantAtual` no mesmo `Promise.all` da carga.

## 4. Decisões minhas (podem te poupar dúvida)

1. **Assentos não é autosave de propósito** — stepper + botão "Aplicar": cada
   mudança troca a assinatura no Asaas (cancelar + recriar), o que não se faz
   a cada toque de "+". O rodapé diz o que vai acontecer ANTES ("Vai passar a
   R$ 39,90/mês por assento além dos inclusos."), e "mandar o mesmo número"
   nem habilita.
2. **Undo de remover membro = RECONVIDAR.** Membership removida não se cola de
   volta; convite sim. O toast avisa "O desfazer reconvida pelo e-mail." — e
   se o reconvite recusar (assento lotado enquanto isso), toast de erro, sem
   mentir que voltou.
3. **Atribuição no card do funil só quando o quadro tem 2+ `agentId`
   distintos** — membro (escopo `own`) não vê etiqueta redundante em cada
   card, e dono de conta de um vendedor também não. `agentId: null` vira
   "sem vendedor" em texto quieto, sem monograma.
4. **`porVendedor.motivo`**: `'membro_unico'` esconde a seção INTEIRA (Pro de
   uma pessoa narrando "você é o único" todo mês seria upsell sem graça);
   `'plano'` vira UMA linha quieta ("A quebra por vendedor é do Studio.") —
   sem banner de upsell numa tela de leitura.

## 5. Lint — declarei antes que você ouve de outro

A dívida `react-hooks/set-state-in-effect` que você herdou: consertei DUAS
instâncias em arquivos que esta rodada mexeu de qualquer forma
(`RelatoriosScreen.tsx`, `FunnelScreen.tsx` — a linha `setStatus` síncrona no
efeito; recarga mantém o conteúdo em tela até o dado chegar, mesmo critério da
minha rodada de tarde). `NegocioScreen.tsx` segue com as 5 instâncias
pré-existentes + 3 warnings de unused pré-existentes — NÃO toquei, são de
outra rodada. Zero instância nova minha.

## 6. Pendências (nenhuma bloqueia tela no ar)

1. **Convite a quem já tem conta** (§13.7, pendência do PO): hoje a recusa
   "already a member/invited" vira `ja_participa` ("Esta pessoa já tem convite
   em aberto ou já faz parte da equipe."). Quando o PO decidir o
   "aceitar convite logado", o lugar é o `ConviteSheet` + um hint no
   recusado — me chame.
2. `NegocioDetalhe.agentId` — item 2 acima, o único com custo de verdade.

---

## Rodada de 2026-09-09 (tarde) — arquivada abaixo, ainda vale o que diz

> Fases 1 e 2 do Monde do lado da interface —
> modelos de proposta, recibo, resultado por viagem + agregado, ranking de
> clientes e os dois CSV. O seu §12 chegou NO MEIO da rodada: construí metade
> contra a ponte sondando o barril e aposentei a sonda com import estático
> assim que os oito nomes saíram. O que consumi, o que decidi sozinha e o que
> fica de pedida está aqui embaixo.
> modelos de proposta, recibo, resultado por viagem + agregado, ranking de
> clientes e os dois CSV. O seu §12 chegou NO MEIO da rodada: construí metade
> contra a ponte sondando o barril e aposentei a sonda com import estático
> assim que os oito nomes saíram. O que consumi, o que decidi sozinha e o que
> fica de pedida está aqui embaixo.

## 1. Consumido e de pé (nada a fazer)

- Os oito nomes no barril + os três rotas: `tsc` ZERADO no repositório inteiro,
  `npm run build` limpo, `tests/design/guards.test.ts` **6/6**. A ponte
  (`src/lib/ui/fase12Api.ts`) virou re-export estático + os três montadores de
  URL — nenhuma tela mudou uma linha na aposentadoria.
- `listarTemplates`/`removerTemplate`/`criarPropostaDeTemplate` na
  `NovaPropostaSheet`; `criarTemplateDeProposta` no editor ("Salvar como
  modelo"); `resultadoDaViagem` na ficha do negócio ganho E no agregado do
  Resumo; `rankingDeClientes` na aba Clientes dos Relatórios.
- Rotas como `<a href>` de verdade: recibo com `target="_blank"`
  (`rel="noopener noreferrer"`), CSVs com `download`. Sem `fetch`, como mandou
  o §12 — e sem popup blocker, porque é link, não `window.open`.
- `ValoresDaViagem` (meu, `Pick` dos seis números somáveis do seu
  `ResultadoDaViagem`): é o tipo do card da ficha E da soma do período — o
  agregado passa no MESMO componente (`ResultadoViagemCard`), como a nota dele
  já planejava.

## 2. Decisões minhas que você deve saber (podem te poupar uma dúvida)

1. **"Tornar padrão" só aparece na linha ESCOLHIDA e ainda não-padrão** da
   `NovaPropostaSheet` — não em toda linha. Ação rara em sheet de quinze
   usos/dia; o momento dela é exatamente "prefiro este ao padrão". Otimista
   (o Badge "Padrão" troca de linha no toque) e, recusando, `retryTemplates()`
   traz o estado real. Ela cobre o "sem ela, is_default é inalcançável".
2. **O CSV do hub ignora o chip de status de comissão de propósito** — sai com
   o recinte da URL (`?periodo=`), sempre. O arquivo é para o contador, que não
   conhece o filtro da tela; recortar em silêncio produzia CSV menor do que a
   agente acha que baixou. Se o produto discordar, é conversa de PO.
3. **A soma do período falha FECHADA**: se UMA `resultadoDaViagem` recusar
   (negócio reaberto depois da venda, por exemplo), o card inteiro vira erro
   com "Tentar de novo" — nunca uma soma pela metade. Dinheiro que some em
   silêncio é pior que erro assumido. Se você preferir degradar (pular o deal
   recusado e marcar a nota "N de M viagens"), muda em
   `src/app/(app)/relatorios/ResultadoDasViagens.tsx` num lugar só.
4. **Deals repetidos entram uma vez na soma** (`Set` de `dealId` — a action é
   por negócio, não por venda).

## 3. Premissa que o desenho tomou (confere?)

**"Lista de passageiros da viagem" = viajantes do CONTATO do negócio.**
Viajante liga a `contactId`, não a deal — então a ficha do negócio lista os
viajantes do contato (`PassageirosCard` em `funil/[id]/NegocioScreen.tsx`) e o
botão aponta para `/api/export/passageiros/[dealId]`. Presumo que sua rota
resolva o MESMO recorte no servidor (viajantes do contato do negócio da
venda/deal). Se a sua lista usar outro critério (ex.: pax do deal), a ficha e o
CSV divergem na frente do usuário — me avise que eu alinho a lista ao seu
critério.

## 4. Pendências / desejos (nenhum bloqueia tela no ar)

1. **Prévia de modelo** (`obterConteudoDoTemplate`): a ponte reexporta e
   nenhuma tela chama — a prévia "o que este modelo traz?" não entrou nesta
   rodada. O contrato está pronto do seu lado; quando o produto pedir, nasce
   colado.
2. **"Atualizar modelo" não existe** (você anotou: seria criar+remover por
   cima) — a UI hoje não oferece; se oferecer um dia, é rodada de desenho
   própria (destrutivo com desfazer + criação em um gesto).
3. **`erro tsc` seu em `proposalTemplates.ts:431`** que vi no meio da rodada:
   sumiu (você consertou), e `tests/proposals/templates.test.ts` também fechou
   verde. Nada pendente.
4. **Lint `react-hooks/set-state-in-effect`**: dívida da casa em 19 arquivos
   (padrão fetch-no-efeito + `setState`), não é desta rodada — deixei como está
   para não tocar arquivo alheio; meus arquivos novos não somaram instâncias
   (skeleton só na primeira pintura; recarga mantém o conteúdo anterior).

---

## Rodada da manhã (2026-09-09) — arquivado abaixo, ainda vale o que diz

## 1. Consumido e de pé (nada a fazer)

- `obterConteudoDoRoteiro` / `listarRoteiroDoNegocio` / `atualizarConteudoDoRoteiro`:
  o editor carrega pelo conteúdo (não pelo listar), salva a lista COMPLETA e o
  autosave martela sem medo (no-op idempotente). Portaria: os modelos de bloco
  do editor só escrevem chaves seguras (`secao`, `horario`, `endereco`,
  `comoChegar`, `data`); telefone/emergência é PROSA no `body` por desenho.
- `agentDisplayName` em `MarcaInput`/`TenantAtual` e no payload público
  (chave condicional): `/configuracoes` edita e as duas páginas públicas
  assinam com o `brand` que já têm na mão.

## 2. Uma linha sua que eu toquei (declarando)

`src/lib/assinatura.ts` — adicionei `export { APP_NAME };` (reexport do import
que já existia no arquivo). Sem ela, `tests/brand/assinatura.test.ts` não
compila: o teste importa `APP_NAME` de `@/lib/assinatura` e o módulo só
importava, não reexportava. É aditivo e não muda comportamento nenhum. Se
quiser resolver de outro jeito (tirar o `APP_NAME` do import do teste), reverte
aqui sem cerimônia.

## 3. Pendências / desejos (nenhum bloqueia tela no ar)

1. **WhatsApp do contato em `NegocioDetalhe`** (espelho do pedido antigo do
   `PropostaParada`): hoje o "Mandar por WhatsApp" do editor de roteiro abre o
   share-picker (`wa.me/?text=…`) e a agente escolhe a conversa. Funciona — mas
   o caminho DE PRODUTO é abrir direto a conversa do cliente:
   `waMeLink(contactWhatsapp, mensagemDoRoteiro(...))`. No dia em que o campo
   chegar, é trocar UMA linha em `RoteiroEditorScreen.tsx` (a montagem do href).
2. **Assinatura na mensagem do share da proposta** (`/p/`): a proposta pública
   ainda não tem botão de envio no app (o roteiro tem). Quando existir, o
   helper é o mesmo (`textoComAssinatura`, `src/lib/assinatura.ts`) — só não
   deixar nascer um segundo formato de mensagem.
3. **`src/lib/config.ts` nasceu** (obrigado) — `src/lib/ui/brand.ts` já
   reexporta o `APP_NAME` de lá, como o comentário do config pedia. Nenhuma
   tela importa a string crua.
