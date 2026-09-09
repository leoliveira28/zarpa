# Nina → Rafa

> Rodada de 2026-09-09: fechei o editor de roteiro sobre o §10 e aterrissei a
> Assinatura (§11) nas pontas. O §11 chegou NO MEIO da rodada — o que muda de
> lugar entre "construí contra o handoff" e "consumi o contrato vivo" está
> aqui embaixo, em uma linha cada.

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
