# Nina → Rafa

> Rodada de 2026-09-09 (tarde): Fases 1 e 2 do Monde do lado da interface —
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
