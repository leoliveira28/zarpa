# Nina — status

## 2026-09-11 (manhã) — Fit 7 FECHADO: origem da oferta nos Relatórios + revisões do PO

A última peça do Fit 7 + as revisões da primeira hora:

**Origem da oferta nos Relatórios (7c, o fecho):** seção **"Vendas vindas da
Vitrine"** no Resumo — vendas do período cujo negócio nasceu de um lead da
página pública (join `offer_leads.deal_id` → `sales.deal_id`, sem migration:
o vínculo da 0028 já é a origem). Por oferta de origem + total, com rótulo de
período igual ao resto da tela. Some sozinha quando não há venda vinda de lá.
LENTES sobre `sales` — o dinheiro continua no Financeiro. Teste prova: a venda
do negócio convertido conta; negócio sem lead não.

**Revisões do PO na primeira hora, todas resolvidas:**
1. **Interesse não aparecia no /hoje** — `leadsRecentesDaVitrine` interpolava
   `Date` em template `sql` cru: o driver rejeitava (ERR_INVALID_ARG_TYPE) e a
   seção sumia silenciosamente. `toISOString()` resolveu. Provado E2E no
   navegador: interesse pela página pública → quadro no /hoje com 5 linhas.
2. **Dedupe do lead com `+55`** (a pergunta "como o mesmo cadastro 2x?") — o
   compare não tirava o código do país. Corrigido com `normalizarTelefone` dos
   dois lados (whatsapp E phone) + teste de regressão com o cenário exato.
3. **Servidor dev reiniciado** — rodava desde ontem com cache de schema.

**Do agente (redesign estilo Decolar, disparado como pedido):** hero grande
com imagem, cartão de filtros flutuante, cards vendáveis com ribbon
"Restam N", "A partir de" + preço grande, linha de confiança; página da
oferta com capa 21:9 e cartão de preço com âncora para o formulário. Regra
da casa intacta (só transform/opacity animam — o guarda pegou meu
transition-shadow e foi removido, não registrado como desvio).

**Números:** 711/711; build limpo; lint zerado nos meus.

**O circuito completo do Fit 7 no ar:** agente monta oferta (blocos do
construtor) → publica → `/a/[slug]` com hero, filtros e cards → visitante se
interessa com nome+WhatsApp → contato com tag + lead → quadro no /hoje →
"Criar negócio" com um toque → funil → venda → seção "Vendas vindas da
Vitrine" fecha o ciclo.

## 2026-09-11 (madrugada) — Rodada 7b: o interesse da Vitrine vira cliente

PO decidiu: 7b sai com **nome + WhatsApp** (Google fica para quando houver
credencial OAuth). O circuito do lead fechado:

**Migration 0027** (`drizzle/0027_interesse_ofertas.sql`, no dev e no teste —
37 tabelas): `offer_leads` (oferta × contato, WhatsApp cru, `ip_hash` para o
throttle) com unique (offer_id, contact_id) — **o duplo toque não duplica**.
Isolamento padrão; a descoberta do tenant na action usa a `offers_public_read`
da 0026 + a porta `auth_context` para o join com `tenants` (FORCE RLS
alcançou a action também — segunda vez que essa porta aparece, agora escrito
no comentário do código).

**`registrarInteresseOferta`** (action pública, sem sessão): valida nome e
WhatsApp pela régua do `waMeLink` (10–15 dígitos), **REUSA o contato quando o
WhatsApp já é cliente da casa** (mesma pessoa não vira dois clientes) e só
então cria com tag `vitrine`; throttle por IP (8/hora, recusa genérica);
auditada. Fora de request scope (testes), o throttle não conta — try/catch em
`headers()`.

**UI:** a página da oferta troca o CTA de WhatsApp pelo **formulário de
interesse** (nome + WhatsApp, contexto da oferta visível, sucesso diz "responde
em até 1 dia"; WhatsApp vira caminho B em texto). Na ficha da oferta
(autenticada), seção **"Interessados (N)"** com link direto para o WhatsApp de
cada um — e a nota de que também estão na tela Clientes com a tag "vitrine".

**Números:** 3 testes novos (`tests/offers/leads.test.ts` — caminho feliz com
idempotência, reuso de contato, recusas sem gravação e token cruzado entre
agências); **708/708**; build limpo; lint zerado nos meus.

**7c (última da Vitrine):** "criar negócio" no interessado/membro sem deal +
origem da oferta nos Relatórios.

## 2026-09-11 (2ª) — Rodada 6b dos Grupos: a lente sobre o dinheiro (fechando a 6b que ficou na fila)

O PO lembrou: a 6b tinha ficado para trás quando a Vitrine entrou. Fechada.

**Chip do grupo no funil e na ficha** — `grupoDoNegocio` (leitura por
`group_members.deal_id`); a listagem do funil ganhou leftJoin em
`group_members`→`groups` e o card mostra o título do grupo numa linha quieta
(mesma gramática da linha do vendedor — texto, nunca cor, nada ali se clica).
Na ficha, o card "Grupo" com link para a ficha do grupo. Negócio fora de
grupo não ganha linha nenhuma.

**Parcelas da reserva** — `parcelasDoGrupo` LÊ as vendas/parcelas dos negócios
membros (pago/a pagar; sem cronograma, o compromisso é o valor bruto menos o
que entrou). O parcelamento continua sendo o de sempre na venda (5a: juros
editáveis + etiqueta de comprador) — o grupo não grava dinheiro nenhum, é
lente.

**Sub-aba Grupos em Relatórios** (a quarta) — por grupo: lugares ocupados ×
total, receita PREVISTA (soma das vendas dos membros) × RECEBIDA (parcelas
pagas), margem por lugar. Sem período de propósito: a saída é o recorte dela.
O nome do grupo é o único clique (→ ficha do grupo).

**Números:** 3 testes novos (chip + null fora de grupo; lente acompanhando o
cronograma com juros; resumo com margem 600−400−250−250=1.500/lugar);
**699/699**; build limpo; lint zerado nos meus.

**Fila:** 7b (interesse com Google — aguarda credencial OAuth do PO ou ok no
fallback nome+WhatsApp) e 7c (origem da oferta nos Relatórios).

## 2026-09-11 — Rodada 7a da Vitrine: o catálogo público do agente

Ok do PO no Fit 7 (`docs/FIT7_VITRINE.md`) virou rodada. O agente solo agora
tem a página pública dele: monta as ofertas com os MESMOS blocos do construtor
de proposta, publica, e divulga UM link.

**Migration 0026** (`drizzle/0026_ofertas.sql`, aplicada no dev e no teste —
36 tabelas): `offers` (título, tipo pacote/voo/hospedagem/transfer/serviço,
preço fotografia, `blocks` snapshot do documento INTEIRO — mesma forma de
`proposal_templates.blocks` —, `public_token` opaco global, ordem manual,
`group_id` nullable SET NULL: **a oferta pode SER um grupo com lugares**).
`published_at`/`unpublished_at` são o interruptor, semântica no serviço.

**LEITURA PÚBLICA — as três lições da função SQL (todas de teste):**
1. **FORCE RLS alcança a função DEFINER**: `tenants` é FORCE RLS e a vitrine
   resolve o tenant POR SLUG sem sessão — a função liga o MESMO GUC
   `app.auth_context` da porta `tenants_auth_service` (0000), alcance mínimo.
2. **`groups`/`group_members` idem**: o "restam N" da oferta-grupo precisa ler
   a ocupação — policies `groups_public_read`/`group_members_public_read`
   sob o GUC de contexto público, e o payload leva a CONTAGEM, nunca linha
   nem nome. Todas registradas em `KNOWN_ESCAPE_HATCHES` com o porquê — o
   guarda de RLS pegou as três (offers, groups, group_members).
3. **drizzle-kit não reaplica função**: migration que muda função precisa de
   OR REPLACE (a 0026 já foi escrita assim) — no dev, reapliquei à mão.

**Serviço (`src/server/offers.ts`):** CRUD do documento inteiro (autosave
idempotente), publicar/despublicar, reordenar, token público de 128 bits.
Leitura pública SÓ pelas funções DEFINER — nenhuma action lê sem tenant.

**UI:** `/vitrine` (lista com o link da página na cabeça para copiar,
publicar/despublicar de um toque) + editor em sheet com os blocos
(kind/título/campos de conteúdo via `CONTENT_FIELDS` — o MESMO vocabulário do
construtor). Públicas: `/a/[slug]` (catálogo em cards com preço — o layout
dos players verificado no plano) e `/a/[slug]/o/[token]` (hero, preço com UMA
régua, blocos via `PublicBlockSection`, CTA "Tenho interesse" via WhatsApp da
agência — o interesse com Google é a 7b; despublicada responde "não
disponível" + link do catálogo, nunca 404 seco).

**Números:** 4 testes novos (`tests/offers/vitrine.test.ts` — cria/atualiza o
documento, publicar↔despublicar muda a leitura na hora, oferta-grupo com
"restam N" da ocupação, isolamento: catálogo por slug, token cruzado
invisível, e a varredura crua SEM GUC vendo ZERO linhas); **696/696**; build
limpo; lint zerado nos meus.

**7b (próxima):** interesse com Google SEM sessão (identidade verificada →
contato + tag → Interessados → funil); depende da credencial OAuth do PO —
sem ela, sai com fallback nome+WhatsApp.

## 2026-09-10 (fim da noite) — Rodada 6a dos Grupos: o pacote com lugares

Ok do PO na meta (`docs/GRUPOS_META.md`) virou rodada. O grupo é agora o
PRODUTO que a agente monta antes de vender.

**Migration 0025** (`drizzle/0025_grupos.sql`, aplicada no dev e no teste —
35 tabelas): `groups` (total_seats + os QUATRO números da venda em escala de
lugar, FOTOGRAFADOS como a agente digitou — mesma doutrina de `sales`;
status montando→vendendo→encerrado) + `group_members` (contato + negócio
opcional + N lugares; PK composta (group_id, contact_id) — um contato é
membro uma vez, mudou a quantidade é outra ação; deal_id SET NULL — apagar o
negócio não apaga a ocupação). RLS de isolamento nas duas.

**Serviço (`src/server/groups.ts`):** CRUD + ocupação; a conta de "sobram X"
é SEMPRE do servidor (`lugaresOcupados` = soma dos membros). Duas cercas que
protegem a verdade: ocupar além do total recusa dizendo quanto resta, e
reduzir o total abaixo da ocupação recusa (maquiar o que já foi vendido não).
Encerrado não recebe ocupação. Margem por lugar = preço − custo − comissão −
taxa, calculada no servidor, nunca na tela.

**UI:** `/grupos` (lista: título · destino/datas · "3 de 10 lugares" · preço ·
status) e `/grupos/[id]` (ficha: a CONTA por lugar com a margem na voz grande —
Fase 2 — e o card Ocupação com link para o negócio de cada membro). Sheets
novas com remontagem por `key` — o lint da casa reprovou o efeito de reset
(setState síncrono em efeito) e a arquitetura que consertou foi a remontagem,
não o silêncio da regra. Entrada no shell junto de Equipe/Sua marca.

**Números:** 5 testes novos (`tests/groups/grupos.test.ts` — quatro números +
margem, ocupação/excesso/repetido/liberar, cercas de limite e encerrado, deal
SET NULL, isolamento); **686/686** (uma corrida flaky de signup na primeira
rodada, passou na registrada); build limpo; lint zerado nos meus.

**6b (próxima):** parcelamento por reserva lendo as parcelas da 5a, sub-aba
Grupos nos Relatórios, chips do grupo no funil/ficha.

## 2026-09-10 (noite, 2ª) — Fase 5a: excursão/grupo leve — os três gaps fechados

Ok do PO no plano (`docs/FASE5_EXCURSAO.md`) virou rodada única. O fluxo do
critério de aceite fecha: grupo de compradores (0020, já existia) → lista de
passageiros do grupo → parcelas etiquetadas por comprador → resultado da
saída com quebra "quem já pagou".

**Gap 1 — passageiros do grupo.** `listarViajantesDoNegocio` (novo em
`travelers.ts`) varre `deal_contacts` na MESMA ordem dos nomes da 0021
(titular primeiro, entrada do comprador, cadastro do viajante); o card
Passageiros da ficha e o `csvPassageirosDoNegocio` (coluna "Comprador" nova)
consumem a mesma leitura. A lista presa ao titular sumia os viajantes da
excursão — dois testes antigos do CSV atualizados porque a fixture não
plantava o espelho da 0020 (a invariant que o join novo agora cobra).

**Gap 2 — etiqueta de comprador (0024, aplicada no dev/teste).**
`receivables.contact_id` (nullable, SET NULL): venda de um comprador só não
tem etiqueta e nunca precisará. O serviço valida o comprador contra
`deal_contacts` (etiquetar com estranho recusa com a correção) — o banco não
impõe (atravessaria duas FKs por tenant; RLS + serviço cobrem). UI: o select
"Comprador" nas sheets de parcela SÓ nasce com 2+ clientes no negócio
(a ficha da venda lê `listarClientesDoNegocio`); a row mostra " · nome" no
vencimento.

**Gap 3 — resultado por comprador.** `resultadoDaViagem` devolve
`porComprador` (pago/a pagar, Map na gramática do ranking, maior pendência
primeiro); `ResultadoViagemCard` ganha a seção "Por comprador" — que a FICHA
manda e o agregado do Relatório não (não é somável por nome). Sem etiqueta
nenhuma a seção nem nasce, e o agregado continua fechando (provado no teste:
zerar as etiquetas não muda `recebidoCents`).

**Juros (pedido do PO no meio da rodada):** editar parcela — valor e
vencimento — entrou antes (`17b57b0`): o servidor já tinha
`atualizarParcela`, a UI nunca expôs; sheet de edição na ParcelaRow, só
parcela não paga.

**Números:** 3 testes novos (`tests/invoices/excursao.test.ts` — o fluxo do
critério de aceite inteiro); **669/669**; build limpo; lint zerado nos meus
(baseline da casa mantido nos pré-existentes); 25 migrations no teste, 0024
no dev.

## 2026-09-10 (noite) — Fase 4b: faturamento consolidado — fatura, boleto sandbox e baixa automática

A última peça do critério de aceite da Fase 4 (`docs/FASE4_PJ.md` §7), backend
completo + UI mínima na ficha da empresa. O fluxo inteiro agora fecha:
**consolidar → boleto → webhook → baixa**.

**Migration 0023** (`drizzle/0023_faturamento_consolidado.sql`, aplicada no dev
e no teste — 33 tabelas): `invoices` (contato-empresa + período + soma
FOTOGRAFADA + status + `asaas_payment_id` + `boleto_url`), `receivables.
invoice_id` (nullable, SET NULL — a parcela mantém o vencimento dela),
`contacts.asaas_customer_id` (customer criado UMA vez e cacheado). Dois
índices únicos parciais carregam as invariantes: `asaas_payment_id` GLOBAL
(idempotência do webhook) e fatura ABERTA única por contato/período-de
(consolidar duas vezes é erro de clique). RLS de isolamento + policy
`invoices_webhook_read` — espelho da 0010, MESMO GUC `'on'` (o guarda de RLS
pegou a policy nova e ela entrou em `KNOWN_ESCAPE_HATCHES` com o porquê).

**Serviço (`src/server/invoices.ts`):** `criarFatura` consolida só as parcelas
PENDENTES do período (por VENCIMENTO, titular = o contato — mesma gramática do
ranking; paga e fora do período ficam de fora), soma em transação e marca o
vínculo — soma e conjunto de parcelas não se desencontram. `emitirBoletoDaFatura`
decifra o documento COM auditoria (mesma action da ficha), recusa sem e-mail
(ahead of time, em vez do erro do Asaas), cria/cacha o customer e chama a
cobrança avulsa `criarCobrancaAsaas` (POST `/payments`, BOLETO — nova no
client `src/lib/asaas/client.ts`). Idempotente: fatura com boleto emitido
devolve o estado, não recobra — clique duplo não gera duas cobranças.

**Webhook (`processarWebhookAsaas` estendido):** cobrança avulsa NÃO traz
subscription no payload — o discovery do tenant agora passa pela fatura por
`asaas_payment_id` sob o `withWebhookContext`. PAYMENT_RECEIVED/CONFIRMED →
fatura 'paga' + parcelas consolidadas → 'pago'. OVERDUE/REFUNDED/DELETED de
fatura ficam inertes de propósito: reabrir parcelas pagas por estorno é
decisão de produto explícita (§6), não default de webhook. Um teste antigo
(`cobranca.test.ts`) atualizado — o motivo mudou de "subscription ausente"
para "fatura não encontrada", a mesma cortesia de 200.

**UI (`FaturasCard` na ficha, só PJ):** lista (período · N parcelas · valor ·
status · link do boleto) + rodapé de consolidação (De/Até default = mês
corrente) + "Emitir boleto" por fatura aberta. Sandbox: `ASAAS_API_URL` já
aponta para `https://sandbox.asaas.com/api/v3` por default — sem
`ASAAS_API_KEY` no .env, a emissão devolve ASAAS_NAO_CONFIGURADO com a
correção.

**Números:** 3 testes novos (`tests/invoices/faturamento.test.ts` — Asaas
mockado, banco/actions/webhook REAIS: consolidação seletiva, cache de
customer, baixa idempotente); **666/666**; build limpo; zero problemas de
lint meus (os 2 do ContatoScreen e os 2 de billing.ts são pré-existentes no
HEAD, comprovado por stash).

**Resta da 4b (para o rafa, anotado no handoff):** os placeholders do
`trocarPlano` (§4.1 do plano — customer da ASSINATURA da agência em modo
prod); e a baixa por estorno (REFUNDED reabrindo parcelas) se o produto pedir.

## 2026-09-10 (fim de tarde) — Importação aceita .xlsx (pedido antigo, fechado)

O PO tentou importar planilha e "não funcionava": reproduzi no navegador com o
usuário dev e o CSV ia de ponta a ponta (2 criados) — o bloqueio era a recusa
de propósito do `.xlsx`, registrada desde o cabeçalho de `imports.ts` como
"falta biblioteca de parsing". Fechado assim:

**Leitor mínimo próprio (`src/server/xlsx.ts`), SEM SheetJS.** A distribuição
`xlsx` do npm parou na 0.18.5 (CVEs de prototype pollution consertadas só na
0.20.x, que a SheetJS não publica no npm) — dependência por URL avulsa não é
caminho nesta casa. Um `.xlsx` é um ZIP de XML (ECMA-376): `fflate` deszipa
(dependência agora DIRETA; já vivia na árvore como transitiva) e ~150 linhas
de parse leem as quatro partes que a importação precisa — workbook (primeira
aba), rels (qual arquivo é ela), sharedStrings e a sheet. Célula pulada vira
`''` sem desalinhar cabeçalho (o índice vem do atributo `r`); texto rico
(`<si><r>`) concatena os `<t>`; entidades decodificadas. **Data chega como o
serial cru do Excel (`29126`) — e `parseDataFlexivel` (`serialExcelParaIso`)
já o interpretava desde a 0001**, então zero código de data novo. `.xls`
binário segue recusado com correção ("salvar como .xlsx").

**Formato cego ao pipeline.** `lerPlanilha` devolve o MESMO `string[][]` do
`parseCsv`; o `import_batches` já tinha CHECK `('csv','xlsx')` e `delimiter`
nullable — o schema esperava este dia. A prévia mostra "lido como xlsx" (sem
encoding/delimitador, nulos no tipo); `accept` da Dropzone e textos atualizados.

**Bug meu que o teste pegou:** o helper `casarBlocos` assume DOIS grupos de
captura e os regex de `<si>`/`<t>` tinham um — dicionário vazio, colunas em
branco. O teste de fixture (montado com `zipSync` do próprio fflate) pegou na
hora.

**Verificação:** 3 testes novos (`tests/imports/xlsx.test.ts` — prévia,
confirmação com serial de data, recusa de zip mentiroso e de `.xls`);
657/657; build limpo; e o fluxo REAL no navegador com `dev@zarpa.local`:
prévia mapeando colunas, confirmação, 2 contatos criados.

## 2026-09-10 (tarde) — Fase 4a: PJ no contato + centro de custo

O ok do PO no plano (`docs/FASE4_PJ.md`) virou código na mesma sessão. Duas
peças que viajam juntas e não se tocam: **empresa é um contato PJ** e
**centro de custo é a etiqueta do setor que paga**.

**PJ — zero tabela nova.** `contacts.person_type` (`'fisica'` default |
`'juridica'`), CNPJ na MESMA coluna `document_encrypted` e no MESMO índice
cego — `blindIndexFor` normaliza por dígitos, então 14 deduplicam pela mesma
máquina que 11 (provado em teste: `04.252.011/0001-10` e `04252011000110`
colidem no CONFLITO). A validação virou `validarDocumentoPorTipo`
(`cpfValido` × `cnpjValido`, `src/server/normalize.ts`); no PATCH de
documento, o tipo efetivo é lido de dentro do `withTenant` — ler fora seria
ignorar o FORCE RLS. A busca da ficha aceita documento inteiro de 11 OU 14
dígitos (`pareceDocumento`). `.optional()` no zod de propósito: `.default()`
tornaria o campo obrigatório no tipo de saída e quebraria todo chamador que
cria contato sem saber do PJ.

**UI do PJ:** seletor "Tipo de cliente" no card Dados da ficha (mesmo
contrato do VendedorField: commit no change, retorno reconcilia, erro do
servidor devolve o select) — o TIPO governa o resto: "Razão social" no lugar
do "Nome", "CNPJ" com placeholder próprio, nascimento nem nasce para PJ.
Criar/atualizar contato valida na entrada com o campo culpado; a importação
de planilha AINDA é PF-only (furo no handoff).

**Centro de custo — molde `pipeline_stages` à risca.** Tabela `cost_centers`
(label, position, archived_at; rótulo único ENTRE ATIVOS, case-insensitive),
serviço espelhando `pipelineStages.ts` (gate de dunning, arquivar/reabrir —
DELETE não existe; FK RESTRICT em deals e sales é a rede por baixo). É
atributo do deal — **atribuir NÃO é dono-only** (classificar a viagem num
setor é trabalho de quem vende; reatribuir vendedor é que é de dono) — e
FOTOGRAFADO na venda na conversão, mesma mecânica do `agent_id`. Nullable
não é tolerância: viagem PF não tem centro de custo e nunca terá.

**Superfícies:** select "Centro de custo" no card Viagem da ficha (uma
leitura no mount; lista vazia não bloqueia a ficha — atribuir é opcional),
gestão da lista em `/configuracoes` (criar + arquivar com desfazer de 8s que
REABRE de verdade), 3ª sub-aba em Relatórios ("Centros de custo", o Map do
ranking com outra chave; "Sem centro de custo" é linha de verdade e mora por
ÚLTIMO — residual, não categoria), e coluna "Centro de custo" no CSV de
vendas (o contador recebe a classificação; `—` quando não tem).

**Migration 0022** (`drizzle/0022_pj_e_centro_de_custo.sql`, aplicada no dev
— 32 tabelas, RLS íntegro): RLS ENABLE+FORCE + policy simétrica na tabela
nova NA MESMA migration, `person_type` com CHECK e índice parcial PJ,
verificação final que FALLA ALTO se algum contato existente nascesse
jurídico. Backfill: nenhum — não há verdade antiga a preservar.

**Números:** `tsc --noEmit` limpo (regra da casa: testes também — o build
pegou 3 no arquivo de teste novo depois de eu achar que tinha acabado).
`npm test`: **36 arquivos / 654 testes** (11 novos no
`tests/contacts/pj-e-centros.test.ts`); 1 teste existente atualizado
(`exportacoes.test.ts` — o cabeçalho do CSV mudou de contrato, de propósito).
`npm run build` limpo; eslint zerado nos 5 arquivos novos. A fotografia na
conversão não tem teste dedicado — o caminho da conversão é coberto pela
suíte de `tests/sales`, que passou com a coluna nova no INSERT.

**Furos para o rafa:** `docs/handoffs/nina-para-rafa.md` (importação PF-only,
flip de tipo não retrovalida documento armazenado, `obterDocumentoDoContato`
devolve `cpf` para CNPJ também).

## 2026-09-10 (2ª) — O símbolo da marca nas superfícies públicas (pedido do PO)

A Vela de Papel entrou na única superfície que ela tem a direito de ocupar
enquanto não existe site: **o colofão**.

**Posicionamento — a peça é do agente; o Zarpa assina uma vez, no fim.**
O símbolo mora DENTRO da linha "via {APP_NAME}" da `Assinatura`
(`src/components/public/Assinatura.tsx`): lockup inline `[símbolo 16px] via
Zarpa`, `currentColor` na cor mais quieta do papel (`text-subtle`). Decidi
contra colocá-lo acima do bloco do colofão: ali ele pareceria MARCAR a marca
do agente, e a capa/topo de `/p` e `/r` são dele (`PublicBrandBar`). E decidi
contra qualquer segundo ponto editorial (capa, divisor): o §13 da MARCA.md
diz que o mestre "entra quando houver superfície grande de marca (site,
capa)" — a capa pública é do agente, então a contenção É a decisão. Uma
aparição do símbolo por página; se o guia não autoriza mais que o colofão,
não se inventa autorização.

**Por que 16px e a variante pequena.** §3.1: vinco e mar são descartados na
faixa pequena ("o que não sobrevive a 16px não entra lá") — a 16px o mestre
vira lama (fio de 0,055px). Traço 10/160 = exatamente 1px em 16px. O colofão
é o registro mais silencioso que a marca tem; 20px+ começaria a disputar com
o nome do agente em 13px.

**Fonte de verdade técnica: `src/components/brand/SimboloVela.tsx`** (pasta
`brand/` nova — símbolo é logo, não prancha; o acervo de `plates/` é fechado
por §7). Duas variantes (`pequena` padrão 16px, `mestre`), geometria
verificada byte a byte contra `public/brand/*.svg` (os 5 caminhos do mestre,
os 3 da pequena = mestre sem vinco/mar), `stroke="currentColor"`, pontas
arredondadas, `aria-hidden` por padrão. Sem `non-scaling-stroke` de propósito:
na prancha a linha é instrumento (1px sempre); na logo o traço É parte do
desenho. Nada do §3.3 (sem girar, sombrear, recolorir, caixa).

**Glifo antigo: nada a aposentar.** `/p`, `/r`, os dois not-found e
termos/privacidade não têm nenhum símbolo do produto hoje (grep) — só a marca
do agente e texto. A `CompassPlate` segue só em entrada (§3.1 a mantém como
prancha de entrada) e no catálogo.

**Kitchen-sink:** seção `Marca — Vela de Papel` nova (antes de Pranchas), com
mestre 96, pequena 24 e 16, e o lockup do colofão — nos dois temas via
`TwoThemes`. O texto "via" sai de `linhaViaApp()`, nunca de string solta.

**Números:** `npx tsc --noEmit` limpo; guardas de design **203/203**;
SSR de inspeção renderiza o lockup esperado nos três estados da `Assinatura`
(completo, sem nomes, com Instagram — o " · " viaja dentro do span do link
para quebra nunca órfã). `npm run build` passa.

**Para o PO/rafa, fora do meu alcance:** a suíte completa tem **6 falhas
pré-existentes** que NÃO são desta rodada — provei escondendo só os meus
arquivos e rerodando (a falha persiste sem eles): `tests/brand/assinatura.test.ts`
(roteiro: fallback do `gerarRoteiro`), `tests/security/deal-contacts-rls.test.ts`
(4) e `tests/security/public-roteiro.test.ts` (1) — todas em áreas do rafa
(`src/server/itineraries.ts`, `deals`, `contacts` e a migration 0021 em voo
não-commitada na árvore). Nada em design, a11y ou UI.

## 2026-09-10 — UI de negócio com vários clientes (§15 do Rafa, commit 5139393)

Uma viagem, vários clientes — do cadastro ao clique, nos dois editores e nas
duas superfícies públicas. Cinco entregas sobre o backend de `deal_contacts`
(N:N da 0020): **Clientes card na ficha do negócio** (adicionar via sheet com
combobox, remover com desfazer de 8s), **"Quem viaja" no editor de proposta**
(a MESMA lista, um hook só), **"Preparado para Ana e Carlos" na capa de
`/p/[slug]`**, **escolha de destinatário no WhatsApp do roteiro** (mais de um
telefone → sheet de destinos) e **"Ana +2" no card do funil**.

O núcleo é um arquivo: `src/components/app/ClientesDoNegocio.tsx` (~500 linhas)
— o hook `useClientesDoNegocio` semeia do servidor e reconcilia do RETORNO das
actions (que já vêm com a lista atualizada), então ficha e editor nunca
divergem. Não é componente duplicado com props diferentes; é uma fonte de
verdade com duas roupas (sheet própria de cada contexto).

### Decisões visuais que tomei sozinha

1. **O titular nunca é removível — nem renderiza o lugar do remover.**
   Removê-lo é trocar o titular, que é outra operação (imutável no contrato);
   oferecer o botão e recusar depois seria crueldade de latência. O Badge
   "Principal" é neutral, porque principal não é status de cor — é ordem.
2. **Undo de remover = re-adicionar de verdade.** `toast.undo` de 8s chama a
   MESMA action de adicionar (membership removida não se cola de volta). O
   desfazer é uma ação que existe, não uma promessa de UI.
3. **"Ana +2" no funil fica FORA do truncate e em `text-muted`.** Nome comprido
   é o que se corta; o número é o que se lê. Nunca cor — o "+2" não se clica,
   e o azul continua dizendo só onde se clica.
4. **Fio entre linhas, nunca depois da última.** `<Rule inner />` só quando há
   outra linha abaixo (`indice < length - 1`); fio colado no rodapé do card
   virava moldura de novo.
5. **Skeleton com o lugar reservado no milímetro** — `h-10` / 11 no pointer
   coarse, a mesma altura da combobox que chega. O card não pula quando o
   cadastro termina de carregar.
6. **"Preparado para" é tipografia, não etiqueta.** Rótulo em `text-muted`
   17/1.5, NOMES em peso médio `text-ink` — o mesmo contrato da capa do
   roteiro. Zero azul (nada ali se clica), zero prancha (a capa já tem a sua).
   Junta os nomes com `juntarNomes()` (`src/lib/ui/format.ts`, novo): "Ana,
   Carlos e Marina" — vírgula de lista, "e" de conclusão, o jeito de livro.
7. **WhatsApp: destinatário por nome, número à direita.** A lista da sheet
   mostra nome + " · principal" + telefone cru tabular; a segunda ação do
   rodapé ("Escolher conversa no WhatsApp") é TEXTO, não botão — havendo duas
   ações, a segunda vira texto. Zero telefones confiáveis nem falha de leitura
   caem no share-picker de sempre: o envio nunca bloqueia por uma conveniência.
8. **O custo da leitura é de quem pediu.** O editor de proposta lê a lista no
   mount (o card nasce pintado); o roteiro lê NO TOQUE do envio, com `loading`
   no botão. Quem não manda, não paga.

### Verificação (estática, sem navegador — o PO testa)

- `npx tsc --noEmit`: **0 erros**, rodado após cada tela salva.
- `npm test`: **629 testes / 34 arquivos** passando, guards de design
  incluídos — **203/203**. O guard pegou 1 violação minha durante a rodada
  (`transition-colors` no botão Remover; cor não transiciona na casa) e foi
  consertada, não registrada como desvio.
- `npm run build`: **✓ Compiled successfully**.
- Lint nos 8 arquivos: 8 erros + 6 warnings, **todos pré-existentes no HEAD**
  (comprovado com worktree comparativo — mesmos códigos, linhas deslocadas).
  Os 2 arquivos novos: **0 problemas**.
- 390px: linhas de cliente em uma linha só (nome truncado + Badge/ação à
  direita), alvo de toque ≥ 36px, sheets full-width.

### Arquivos

`src/components/app/ClientesDoNegocio.tsx` (novo),
`src/components/public/PreparadoPara.tsx` (novo),
`src/lib/ui/format.ts` (`juntarNomes`, novo),
`src/app/(app)/funil/[id]/NegocioScreen.tsx` (ClientesCard),
`src/app/(app)/funil/FunnelScreen.tsx` ("+N" no card),
`src/app/(app)/propostas/[id]/editar/PropostaEditorScreen.tsx` (ClientesMeta),
`src/app/(app)/funil/[id]/roteiro/RoteiroEditorScreen.tsx` (destinatário),
`src/app/p/[slug]/PublicProposalScreen.tsx` (PreparadoPara na capa),
`docs/handoffs/nina-para-rafa.md` (3 furos de contrato, não consertados por
fronteira — leitura leve, `RoteiroPublico` sem a lista, histórico da ficha 360°
só pelo titular). Nota: mudanças em `AppShell.tsx` e `public/brand/` no working
tree são da rodada paralela de marca (docs/MARCA.md §3) — não são desta rodada.

## 2026-09-09 (noite, 3ª) — Micro-rodada: furos fechados pelo Rafa (e79b6f1), contornos aposentados

O §14 do handoff dele cumpre o que promete. O que mudou do meu lado:

- **`src/lib/ui/equipeApi.ts`**: a interface `AuthOrganization` (e o cast
  `organizacao()`) se aposentou — as quatro mutações chamam
  `authClient.organization.*` direto, tipadas. Achado da integração que
  vale registrar: o método CLIENT do convite é **`inviteMember`**, não
  `createInvitation` — o nome do lado browser vem do PATH
  (`/organization/invite-member`), enquanto `createInvitation` é o nome do
  endpoint NO SERVIDOR (`auth.api.createInvitation`). Mesma rota, mesmo input,
  mesmo gate de assentos; o comentário no arquivo conta isso para o próximo.
  E a regra do §14.1 virou ASSINATURA: `organizationId` é obrigatório em
  `mudarPapelDoMembro`/`removerMembro` (opcional no schema do plugin, mas sem
  ele a rota procura "organization ativa" da sessão, que a casa não mantém).
  Os tradutores de erro ficaram intocados, como previsto — o shape do plugin
  casa no `RespostaDoPlugin`.
- **`EquipeScreen.tsx`**: as chamadas de mudar papel e remover passam o
  `organizationId` do tenant; guarda honesta no caso (teórico) de a carga ter
  vindo pela metade — toast de erro + reload, sem chamar o plugin às cegas.
- **`NegocioScreen.tsx`** (`VendedorField`): o contorno do furo 2 saiu INTEIRO.
  A ficha carrega `agentId`/`agentName` (inclusive no negócio PERDIDO, que era
  exatamente o caso que o contorno não cobria), então a segunda leitura
  (`listarNegociosDoFunil`) saiu, o hint "de quem era não aparece em negócio
  perdido" se aposentou, e o patch do pai agora sai do RETORNO do
  `atualizarNegocio` (o `NegocioDetalhe` reconciliado) — sem adivinhar o nome
  no cliente. Uma leitura a menos em cada abertura de ficha. O guard de dono
  continua idêntico: quem decide é o `listarEquipe`, e o erro do servidor
  segue sendo a verdade.

### Verificação

- `npx tsc --noEmit`: **0 erros** (verificado após cada passo).
- Lint: `equipeApi.ts` e `EquipeScreen.tsx` **0 problemas**;
  `NegocioScreen.tsx` mantém os 8 pré-existentes (5 erros + 3 warnings, todos
  da fundação — retirei só o warning que a aposentadoria do hint criou).
- `npm test`: **32 arquivos / 606 testes** (o 606º é o teste do Rafa que trava
  o furo 2). `npm run build`: limpo.

## 2026-09-09 (noite, 2ª) — TELAS DA FASE 3: `/equipe`, monograma, escopo, quebra por vendedor, reatribuição

A fundação do Rafa (§13 do handoff dele) consumida de ponta a ponta. A tela da
frente é `/equipe`: gente, papel e assento no registro silencioso do miolo —
zero ilustração, porque a Equipe abre quinze vezes por dia quando existe (e
nunca quando não existe). Estrutura 1 : 4 : 1 por card; fio como cornija; a
ÚNICA cor de destaque da tela está onde se clica ("Convidar", "Aplicar").

### 1. Monograma (`src/components/ui/Monogram.tsx`) — §8 à risca

Identidade de agente NUNCA leva cor: o monograma é o `<Rule />` fechado em
círculo — contorno `border-current`, nunca preenchido, nunca uma cor por
pessoa (avatar colorido por agente é exatamente o SaaS de template que o
produto proíbe). Três tamanhos (sm 24 / md 36 / lg 48), iniciais de
`initials()` (2 letras, nome longo incluído), `aria-hidden` de propósito: o
nome completo mora SEMPRE ao lado — ler "ML Marina Lima" para leitor de tela é
ler duas vezes. O usuário atual se distingue por PESO no nome (semibold +
"· você"), nunca por fundo. Em `KitchenSink` com seção própria: tamanhos,
herança de `text-muted`/`text-subtle` (gradação de tinta, não matiz) e a linha
de lista montada nos dois temas.

### 2. `/equipe` (`page.tsx` + `EquipeScreen.tsx`)

Membros (monograma + nome + e-mail + papel + "desde {data}"), convites
pendentes ("Convidado por {nome} em {data} · vence {quando}"), assentos com o
número grande tabular ("{usados} de {pagos} assentos em uso"). Papel nativo do
banco, rótulo de tela: owner → "Dono(a)", member → "Agente", admin → "Admin".
Em si mesmo: ZERO ação (demitir-se não é tarefa de tela); dono identifica o
time pelo `solicitanteUserId` que o servidor manda. Entrada no shell: lateral
no desktop, ícone quieto no topo no celular (a barra inferior já está no
limite de cinco alvos) — `TeamIcon` desenhada em `icons.tsx` (duas pessoas, a
de trás em arco; não é o ClientsIcon, que é UMA pessoa com o cliente).

Decisões que tomei sozinha:

- **Assentos com stepper + "Aplicar", não autosave.** Cada mudança troca a
  assinatura no Asaas (cancelar + recriar no servidor) — não se salva no blur
  como campo de ficha. O rodapé anuncia o efeito ANTES do toque e "mesmo
  número" nem habilita o botão. Solo: sem stepper, uma linha honesta ("O Solo
  é para quem trabalha sozinho") + "Migrar para o Pro".
- **`usados > pagos` tem estado amarelo próprio** (corrida rara do gate
  N+1): esconder seria maquiar a conta que vai chegar — o card warn diz o
  número real e oferece o conserto ("Ajustar para N").
- **Destrutivos com desfazer de 8s, na régua.** Cancelar convite e remover
  membro removem OTIMISTAMENTE e oferecem desfazer — que RECONVIDA (membership
  removida não se cola de volta; convite sim, e o toast avisa disso). Mudar
  papel também tem desfazer (restaura o papel anterior). Recusa do servidor
  sempre vence o otimismo: reload + toast de erro com a mensagem de lá.
- **Sheet de convite é formulário, não linha nova**: e-mail com validação
  local antes da rede, papel com hint ("vende e cuida do próprio cliente" /
  "também convida"), recusa INLINE com o conserto junto — limite de assentos
  fecha o sheet e rola até os assentos; rede caiu, "Tentar de novo" reenvia.
  Solo avisa antes, mas o botão não trava: a recusa do plugin é a verdade.
- **Escrita da equipe NÃO é ServiceResult** — `src/lib/ui/equipeApi.ts`
  traduz o `{ error: { message, status } }` better-auth para o par
  mensagem + correção da casa (limite de assentos, já participa, sem
  permissão, sessão, rede). O furo do `organizationClient()` ausente está no
  handoff com o contorno.

### 3. Resumo do período (`RelatoriosScreen.tsx`) — §13.4 + §13.5

- A linha do período agora diz DE QUEM SÃO os números, lido do
  `resumo.escopo` que o SERVIDOR mandou: "set 2026 · Time" (dono) /
  "· Meus" (membro). Sem alternador para ninguém — o board já vem escopado;
  toggle no cliente seria re-filtrar verdade alheia.
- Seção "Vendas por vendedor" entre Resultado das viagens e Receita por
  origem: tabela com monograma sm + nome; `agentId: null` é linha de verdade
  ("Sem vendedor" — venda não classificada é categoria, não ruído); dinheiro
  com `reserveFor` pelo maior valor da tabela. Indisponível por plano: UMA
  linha quieta ("A quebra por vendedor é do Studio.") — upsell não grita numa
  tela de leitura. `membro_unico`: a seção some inteira.

### 4. Funil e ficha — §13.6

- Card do funil ganha a quarta linha (monograma sm + primeiro nome) SÓ quando
  o quadro tem 2+ `agentId` distintos — membro não vê etiqueta redundante, e
  conta de um vendedor também não. `null` → "sem vendedor" quieto. O sobrevoo
  do arrasto reproduz a MESMA linha (um desenho só, dois lugares).
- Ficha do negócio: campo "Vendedor" no card Viagem, dono-only (não-dono nem
  vê), select com "Sem vendedor" + os membros, commit no change, "Salvo"
  discreto, desfazer via toast. Esqueleto na MESMA altura do campo: o card não
  pula quando a equipe chega. Valor atual lido do quadro (furo do
  `NegocioDetalhe` no handoff); negócio perdido mostra o hint honesto de que
  reatribuir sem saber de quem era.

### 5. Números

- `npx tsc --noEmit`: **0 erros**, verificado após CADA tela (nunca acumulei).
- `npm run build`: limpo; `/equipe` presente como rota dinâmica.
- `npm test` (suite inteira): **32 arquivos / 605 testes passando**, guards de
  design incluídos (paridade de tema, só transform/opacity, reduced-motion).
- Lint nos meus arquivos novos (`Monogram`, `equipeApi`, `EquipeScreen`,
  `page`): **0 problemas**. Nos tocados: zerei 2 instâncias pré-existentes de
  `set-state-in-effect` (Relatorios, Funnel); `NegocioScreen` mantém as 5
  instâncias + 3 warnings pré-existentes (não são desta rodada).
- 390px: linhas de membro/convite em uma linha de nome + e-mail truncados com
  papel à direita; ações do dono (select sm 128px + "Remover") descem para uma
  segunda linha alinhada ao texto (`pl-12`) — alvo de toque nunca abaixo de
  36px; sheet de convite full-width.

### 6. Arquivos

`src/components/ui/Monogram.tsx` (novo),
`src/lib/ui/equipeApi.ts` (novo),
`src/app/(app)/equipe/` (novo: `page.tsx` + `EquipeScreen.tsx`),
`src/components/app/AppShell.tsx` (entradas /equipe),
`src/components/app/icons.tsx` (`TeamIcon`),
`src/app/(app)/relatorios/RelatoriosScreen.tsx` (escopo + porVendedor),
`src/app/(app)/funil/FunnelScreen.tsx` (atribuição no card),
`src/app/(app)/funil/[id]/NegocioScreen.tsx` (`VendedorField`),
`src/app/(app)/kitchen-sink/KitchenSink.tsx` (seção Monogram),
`docs/handoffs/nina-para-rafa.md` (rodada nova: 2 furos de contrato).

## 2026-09-09 (noite) — Prévia do modelo na "Nova proposta" (`obterConteudoDoTemplate` ganhou chamador)

O pendente que eu mesma registrei: a função existia no servidor sem nenhum
consumidor, e escolher modelo era apostar no escuro — o nome da linha era toda
a informação. Agora tocar num modelo (e o default, ao abrir) mostra o SUMÁRIO
dos blocos logo abaixo da lista, no registro de sumário de livro: uma linha
por bloco, rótulo do tipo em 13 + título em 15 truncado. O corpo completo
mora no editor — prévia que quer ser lida inteira é editor disfarçado.

Arquivos: `src/components/app/PreviaDoModelo.tsx` (novo, 210 linhas) e
`src/components/app/NovaPropostaSheet.tsx` (chamada + `FieldHint` reescrita).

### Verificação estática (números)

- `npx tsc --noEmit`: **2 erros, ambos FORA da minha fronteira** —
  `src/app/api/recibos/[vendaId]/route.ts:31` e `src/lib/pdf/recibo.tsx:123`
  (rodada viva do recibo/PDF; o erro do route mudou de linha entre duas
  execuções minhas — tem gente editando esse arquivo agora). Nenhum erro nos
  meus dois arquivos.
- `eslint` no `PreviaDoModelo.tsx`: **0 problemas**. A
  `NovaPropostaSheet.tsx` mantém 2 erros pré-existentes da rodada de tarde
  (`react-hooks/set-state-in-effect` nos efeitos das linhas 104/125 — código
  que não é desta rodada; não mexi).
- `npm run build`: falha somente nos 2 erros acima.
- `npx vitest run tests/proposals/templates.test.ts`: **3/3** — incluindo o
  isolamento (modelo de outro tenant não lista, não copia). É o contrato que a
  prévia consome.
- `tests/design` (guards + rules + deviations): **172/172** sobre a árvore com
  o arquivo novo.
- 390px: sheet full-width, conteúdo 358px (px-4 de cada lado). Pior rótulo
  ("Contato de emergência", 13px) ≈ 134px → sobram ≈ 214px de título (~24–26
  caracteres) antes da elipse. Prévia cheia (6 linhas) ≈ 217px de altura;
  1 linha ≈ 75px; skeleton ≈ 132px (só existe no primeiro toque de cada
  modelo; depois, cache).
- Grep no componente novo: `accent` **0** (o único azul da seção é o ponto do
  rádio, que é seleção), `serif/italic` **0**, animação **0** (a única
  ocorrência de "motion" é em comentário). Skeleton é `still`.

### Decisões que tomei sozinha

1. **A prévia mora abaixo da lista inteira, não expande a linha escolhida.**
   Proximidade vs. estabilidade: expandir linha empurra o "Do zero" e as
   ações de remover/tornar padrão a cada toque — e só transform e opacity
   animam, então a abertura seria seca. Posição fixa, conteúdo troca; o
   cabeçalho do sumário diz o total, e a cauda diz onde o corte aconteceu.
2. **O default abre com prévia montada.** Ele já vem marcado; mostrar o
   sumário na abertura ensina o recurso sem um toque e o conteúdo está lá
   quando ela olha — latência percebida é isso.
3. **Uma linha por bloco, com fallback:** título → corpo inteiro truncado em
   CSS → "n fotos". Zero contagem de caractere em JS; o CSS corta. Bloco oco
   não entra nem na lista nem no total (a proposta também não o renderiza).
4. **`price_note` APARECE.** Aqui é a casa da agente (autenticado); a trava
   de vazamento é da página pública (§4), não desta tela. Ela precisa saber
   que o modelo carrega nota de preço antes de mandar.
5. **Modelo sem blocos = vazio sem exemplo de propósito.** Inventar blocos
   mentiria sobre ESTE modelo — a regra do exemplo vale para lista vazia de
   sistema. O que há: o que acontece se criar dele + UM caminho de volta
   ("Começar do zero", texto, não botão).
6. **Zero animação na troca.** Trocar de modelo é trocar de texto, e texto
   não voa. O teste da doutrina: sem animação, a tela comunica igual.
7. **Estado derivado de um Map de leituras**, sem `setState` síncrono em
   efeito: a primeira forma que escrevi foi reprovada pelo lint da casa e eu
   consertei a arquitetura (leituras por id, ausente = carregando, resposta
   atrasada morre no cleanup) em vez de calar a regra. Cache por id: voltar
   ao modelo de antes é instantâneo.
8. **`FieldHint` saiu do `radiogroup`** (parágrafo não é rádio) e foi
   reescrita para sobreviver ao modelo sem blocos: "o que o modelo tem —
   blocos e opções — vai junto" continua verdade quando o que ele tem é nada.

### Preciso dos outros

Nada desta rodada. O build quebrado é dos arquivos da rodada do recibo
(`src/app/api/recibos/…`, `src/lib/pdf/recibo.tsx`) — quem está lá fecha;
não toquei porque não é meu e estava mudando sob os meus pés.

---

## 2026-09-09 (tarde) — Fases 1 e 2 do Monde: modelos, recibo, resultado por viagem, ranking e CSV

Cinco entregas sobre os contratos que o rafa pôs no ar no meio da rodada
(§12 do handoff dele): **"Salvar como modelo"** no editor, **"Começar de um
modelo"** na `NovaPropostaSheet` (com "Tornar padrão"), **"Recibo"** na ficha
da venda, **Resultado da viagem** na ficha do negócio ganho + **agregado no
Resumo** do financeiro, **aba Clientes** nos Relatórios (ranking → ficha 360°)
e **"Exportar CSV"** em três pontos (vendas, passageiros, relatórios).

Verificação estática: `npx tsc --noEmit` **0 erros no repositório inteiro**
(rodei ao fechar cada tela), `npm run build` limpo,
`npx vitest run tests/design/guards.test.ts` **6/6** (pegou e eu consertei uma
transição de `border-color` que um rádio meu tinha herdado — só transform e
opacity animam, a régua vale para código meu de ontem também). Sem navegador —
o PO testa.

---

### Decisões de desenho que tomei sozinha

1. **"Tornar padrão" mora na linha escolhida, não em toda linha.** A sheet
   abre quinze vezes por dia; um comando por linha viraria painel de controle.
   A ação aparece só quando a agente acabou de preferir um modelo ao padrão —
   o momento exato em que "esse merece ser o de sempre" acontece. O Badge
   "Padrão" troca de linha no toque (otimista; recusa → reload honesto).
2. **Recibo é âncora, não fetch.** `<a target="_blank">` dentro de
   `Button asChild`: sai no toque, imune a popup blocker, e o PDF carrega no
   próprio aba — o progresso é o do navegador. Fingir carregamento na ficha
   seria um spinner, que a casa não tem.
3. **O agregado usa o MESMO card da ficha** (`ResultadoViagemCard`,
   `titulo="Resultado das viagens"`): os seis campos são somáveis, então a soma
   tem o shape do item — a agente aprende uma gramática e a lê em qualquer
   escala. Ficou depois de Comissão de propósito: margem = venda − custo −
   comissão, o card é a conclusão dos dois blocos anteriores.
4. **Soma falha fechada.** Uma recusa em `resultadoDaViagem` fecha o card
   inteiro com "Tentar de novo" — nunca metade de uma soma. E deals repetidos
   entram uma vez (`Set`), porque a action é por viagem, não por venda.
5. **CSV segue o recinte da URL e ignora o chip de status** (vendas): o
   arquivo é para o contador, que não conhece o filtro da tela. Em Relatórios,
   o CSV mora no rodapé do card de resultado — o mesmo gesto dos passageiros.
6. **Ranking: o azul só no nome.** Posição e números são leitura; o nome é o
   único clique (→ ficha 360°). Molde de largura da coluna "Total comprado" =
   o maior da lista — nada pula de linha para linha. Top 10; vazia, o estado
   vazio mostra uma linha de exemplo.
7. **Sub-abas Resumo/Clientes copiam a gramática do `MoneyHubTabs`**
   (segmented, `aria-current`, links de verdade): aba na URL (`?aba=`), o
   `?periodo=` viaja junto e a aba Resumo nem escreve o parâmetro — ausente É
   resumo. O h2 virou "Relatórios" (mesmo padrão de /vendas, que repete a tab).
8. **A ponte nasceu sonda e morreu no mesmo dia.** `fase12Api.ts` sondava o
   barril em runtime enquanto o backend era forno; os nomes saíram, vira
   re-export estático — nenhuma tela mudou na aposentadoria.

### Números das checagens estáticas (por tela)

`serif|italic|rounded-lg` = 0 e hex cru = 0 em TODOS os arquivos tocados;
accent sempre = cliques; valores sempre por `Money`/`MoneyStat`/`tabular-nums`.

| Arquivo | accent | Money/tabular | onClick/pointerdown | min-h-9/11 |
|---|---|---|---|---|
| `relatorios/RelatoriosScreen.tsx` | 0 | 10 | 1/0 | 2 |
| `relatorios/RankingClientes.tsx` | 1 (nome→ficha) | 5 | 1/0 | — |
| `relatorios/ResultadoDasViagens.tsx` | 0 | via card | 1/0 | — |
| `vendas/VendasScreen.tsx` | 1 (margem) | 5 | 7/1 | 1 |
| `vendas/[id]/VendaScreen.tsx` | 1 (link proposta) | 5 | 9/0 | — |
| `NovaPropostaSheet.tsx` | 2 (rádio+badge) | — | 4/2 (rádios no toque) | 4 |

(`onClick` aqui inclui os de componentes Button/Link da casa, que tratam o
gesto internamente; os rádios das linhas reagem no `onPointerDown`.)

### Arquivos tocados nesta rodada

`src/lib/ui/fase12Api.ts` (nova, aposentada no mesmo dia), `src/lib/ui/periodo.ts`
(`limitesDoPeriodo`), `src/components/app/ResultadoViagemCard.tsx` (novo),
`src/components/app/SalvarComoModeloSheet.tsx` (novo),
`src/components/app/NovaPropostaSheet.tsx` (modelos + tornar padrão + rádio sem
transição de cor), `src/app/(app)/propostas/[id]/editar/PropostaEditorScreen.tsx`,
`src/app/(app)/funil/[id]/NegocioScreen.tsx` (PassageirosCard + ResultadoCard),
`src/app/(app)/vendas/VendasScreen.tsx`, `src/app/(app)/vendas/[id]/VendaScreen.tsx`,
`src/app/(app)/relatorios/page.tsx`, `src/app/(app)/relatorios/RelatoriosScreen.tsx`,
`src/app/(app)/relatorios/RankingClientes.tsx` (novo),
`src/app/(app)/relatorios/ResultadoDasViagens.tsx` (novo). Nada commitado.

---

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
