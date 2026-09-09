# Multiusuário e agências pequenas — mira, preço e arquitetura

> Decisão do PO em 2026-09-09. Este documento é o "como" da Fase 3 (e prepara a Fase 4)
> de `docs/ROADMAP_MONDE.md`. Regras de negócio gerais continuam em
> `docs/REGRAS_DE_NEGOCIO.md` — este arquivo só existe porque a Fase 3 é grande demais
> para caber lá como uma seção. Nada aqui vira código sem passar pela fronteira de
> `docs/OWNERSHIP.md` normalmente (Rafa: dados/servidor: Nina: telas; Téo: testes).

## 1. A mira: 2 a 4 pessoas, não "agência" no sentido amplo

Não é para competir de frente com agência estruturada de 5+ vendedores — ali o Monde tem
95+ integrações de fornecedor como fosso (relacionamento comercial de anos, não coisa que
se replica em um sprint) e um módulo de operação própria (excursão, lista de passageiro,
análise de operação) que o Zarpa não tem e não deveria tentar ter agora.

A faixa que importa é **2 a 4 pessoas**: pequena demais para o Monde valer a pena (pacote
de 5 assentos por R$ 440/mês fica ocioso e caro para quem só precisa de 2 ou 3), grande
demais para "planilha + WhatsApp + Canva" aguentar sozinha. Ninguém constrói para essa
faixa de propósito — ela cai no meio do pacote de todo mundo. Essa é a cunha.

**Sinal de que uma feature saiu da mira**: qualquer coisa que só faz sentido com 5+
pessoas — aprovação em cadeia, papel granular por departamento, múltiplos centros de
custo cruzados — é a Fase 4 do Monde falando mais alto que a Fase 3 do Zarpa. Pare e
pergunte se ainda está resolvendo o dono de 2-4 pessoas antes de construir.

## 2. Preço — o mecanismo que sustenta a mira

- Assento extra: **R$ 39,90/mês**, mesmo valor em Pro e Studio — uma régua só, nunca duas.
- Solo **não tem assento**. Fica sozinho de propósito; quem precisa de time já é Pro ou
  Studio.
- Studio já inclui 3 assentos no R$ 199. O 4º em diante paga R$ 39,90 igual ao Pro — uma
  agência de 4 pessoas no Studio fecha em R$ 238,90.
- **Sem taxa de implementação.** O Monde cobra R$ 880 de setup — contradiz o pitch de
  "pronto em 2 minutos" deste produto. Nunca cobrar por onboarding aqui.
- Contra o Monde, a régua por assento fica de 36% a 68% mais barata que o pacote de 5
  para qualquer time de 2 a 10 pessoas (a vantagem cai conforme o time cresce — é assim
  que deveria ser: quem cresce de verdade começa a pagar pelo que o Monde entrega e o
  Zarpa não tenta entregar).

**Cruzamento de preço a resolver antes de expor o Studio na tela** (não trava a Fase 3,
mas precisa de resposta do PO antes dela fechar): Pro + 3 assentos extras para um time de
4 fecha em R$ 219,60 — mais barato que Studio + 1 assento extra para o mesmo time (R$
238,90). Sem algo que só o Studio compra (marca própria mais completa, relatório de
equipe sem exigir 2º membro, suporte prioritário), ninguém racional escolhe Studio com 4
pessoas. Resolver com feature exclusiva do Studio, não com um segundo preço de assento —
duas réguas de assento é pior que essa inconsistência.

**RESOLVIDO pelo PO em 2026-09-09**: a feature exclusiva do Studio é o **relatório de
equipe** — a quebra por vendedor da seção 7 só aparece para Studio; no Pro, cada membro
vê apenas o próprio resultado (escopo `own` da seção 4). Marca própria plena e suporte
prioritário ficam de fora da conta por enquanto.

## 3. Modelo de dados — plugin `organization` do Better Auth, não uma tabela nova

Better Auth tem um plugin oficial pra isto (verificado em `better-auth.com/docs/plugins/organization`
em 2026-09-09) — usar em vez de desenhar convite/papel do zero:

- `organization` (id, name, slug, ...) — **o `id` da organization é o mesmo `id` de
  `tenants`**. Não existem dois conceitos de tenant no sistema; a organização Better Auth
  É o tenant, só o nome da tabela muda.
- `member` (id, userId, organizationId, role) — os papéis nativos (`owner` / `admin` /
  `member`) já cobrem owner/admin/agente. Mapear `member` → "agente" só no rótulo da
  interface, nunca reescrever o valor gravado no banco.
- `invitation` (email, organizationId, role, status, expiresAt) — convite por e-mail já
  pronto no plugin. Reusar o fluxo, não construir um segundo canal de convite.
- `membershipLimit` é uma **função**, pode ser dinâmica — ligar direto na contagem de
  assentos pagos (`subscriptions.seats_paid`, seção 6). A própria lib recusa o convite
  N+1 se o tenant não pagou o assento N: o gate de billing entra de graça pelo limite de
  membership, sem escrever lógica de "assento cheio" em nenhum outro lugar do produto.
- `createAccessControl()` existe para papel customizado — **não usar agora**. Três papéis
  chegam (seção 9); customizar isso é complexidade de ERP que não serve à mira.
- **RLS**: `organization`, `member` e `invitation` carregam `organizationId`. Pela regra 1
  do `CLAUDE.md` ("RLS antes de feature"), entram na mesma policy `tenant_id =
  current_setting('app.tenant_id')` que toda tabela do produto. Tabelas geradas por
  plugin de auth às vezes escapam da migration normal do Drizzle — Rafa confirma isso
  antes de qualquer outra coisa na Fase 3, porque uma tabela de auth sem RLS é exatamente
  o tipo de furo que o resto do sistema foi desenhado para não ter.

## 4. Visibilidade dentro do tenant — decisão deliberada de ficar fora do RLS

RLS continua resolvendo só uma pergunta: **este dado pertence a este tenant?** Não é para
responder "este agente pode ver o negócio daquele outro agente do mesmo tenant?" — isso é
regra de produto, não fronteira de segurança, e tratar como RLS duplicaria toda policy
existente sem necessidade.

Razão da escolha: dentro de um tenant não há adversário. O dono de uma agência de 2 a 4
pessoas tem, na vida real, direito de ver tudo que os agentes dele fazem — não é
"vazamento de dado", é o negócio dele. O caso que o RLS existe para evitar (bug de
aplicação misturando o tenant A com o tenant B) continua exatamente igual, intocado.

**Implementação**: `withTenant()` (`src/lib/tenant/`) ganha um parâmetro opcional de
escopo — `{ scope: 'own', userId }` filtra a query por `deals.agent_id = userId`; sem o
parâmetro, devolve o tenant inteiro (comportamento padrão hoje, correto para owner/admin).
Decisão de escopo sempre no service layer (mesma disciplina do `ServiceResult` que já
existe em `src/server/`), nunca no componente de tela.

**Teste que precisa existir** (Téo): um usuário com papel `member` chamando a função de
listar negócios com `scope: 'own'` nunca recebe negócio de `agent_id` de outro usuário do
mesmo tenant. É teste funcional, não RLS — mas com o mesmo rigor que o scanner de
vazamento da proposta pública já tem.

## 5. Atribuição e comissão dividida

- `deals.agent_id` (nullable, `references user.id`) — quem toca o negócio. Default: quem
  criou o negócio. Dono/admin pode reatribuir a qualquer momento.
- `sales` ganha `agent_id` (herdado do deal na conversão em venda) e
  `commission_split_pct` (padrão **100** — o agente fica com toda a comissão prevista; a
  "casa" já é remunerada pela assinatura do Zarpa, não por um corte extra da venda). Split
  diferente de 100 é decisão manual por venda, feita pelo dono — não inventar régua
  automática de comissão-da-casa sem pedido explícito.
- Tabela nova e leve: `agent_profiles` (`user_id`, `tenant_id`, `default_commission_pct`)
  — criada com RLS por `tenant_id` como qualquer outra tabela do produto. Guarda o que é
  do **negócio** (papel comercial, comissão padrão), não do login — por isso não entra no
  schema do Better Auth.

## 6. Cobrança — o Asaas não tem endpoint para mudar valor de assinatura ativa

Verificado direto na spec do Asaas em 2026-09-09 (`PUT /v3/subscriptions/{id}`): o corpo
de atualização (`SubscriptionUpdateRequestDTO`) tem `billingType`, `status`, `cycle`,
`discount`, `fine`, `interest`, `nextDueDate`, `split`, `externalReference`... **não tem
`value`.** Não existe operação de "só aumentar o valor" de uma assinatura existente
quando o cliente compra um assento a mais — checar de novo se a Asaas mudar a API antes
de implementar, mas hoje (2026-09-09) é assim.

**Caminho prático**: ao mudar a contagem de assentos, **cancelar
(`DELETE /v3/subscriptions/{id}`) e recriar (`POST /v3/subscriptions`)** com o valor total
novo (base do plano + assentos × R$ 39,90), preservando o `nextDueDate` da assinatura
antiga para não cobrar duas vezes no mesmo ciclo. Isso gera dois eventos de webhook em
sequência rápida (cancelamento + criação) — o handler **não pode** tratar o cancelamento
da assinatura antiga como perda de cliente e disparar o gate de inadimplência (seção 6 de
`docs/REGRAS_DE_NEGOCIO.md`) nesse meio-tempo. Escrever teste de idempotência para esse
par de eventos antes de considerar a Fase 3 pronta.

`subscriptions.seats_paid` (int, default 1) guarda a contagem paga — alimenta o
`membershipLimit` do Better Auth (seção 3) e o valor recalculado no cancelar+recriar.

## 7. Relatório por vendedor — extensão do que já foi proposto, não tela nova

`docs/PROPOSTAS_PRODUTO.md` §2 já propõe a tab "Resumo do período" dentro do Dinheiro. A
Fase 3 adiciona uma quebra por `agent_id` nessa mesma tab quando o tenant tem mais de 1
membro — esconder a quebra por agente com 1 membro só (não mostrar "ranking de
vendedores" com um vendedor). Mesma tabela numérica, `tabular-nums`, largura reservada,
sem gráfico novo. **Decisão do PO (2026-09-09): a quebra por vendedor é EXCLUSIVA do
Studio** — no Pro, cada membro vê só o próprio resultado (escopo `own`); é o que fecha o
cruzamento de preço da seção 2.

## 8. Design — "de quem é isso" sem gastar a cor

Uma cor de destaque só é regra travada do `CLAUDE.md`. Identidade de agente dentro do
funil e das listas **nunca leva cor** — é monograma (iniciais, 2 letras, círculo com
contorno de `<Rule />`, nunca preenchido) em `currentColor`, na mesma gramática das
pranchas: traço, não tinta. O usuário atual se distingue por peso tipográfico (negrito no
nome), nunca por cor de fundo — um avatar colorido por pessoa é exatamente o visual de
template SaaS que este produto proíbe.

Filtro "Meus negócios / Time" no funil: alternador de texto no cabeçalho (mesmo padrão de
segmented control já usado em outras telas do miolo), nunca uma pílula colorida por
pessoa.

Tela nova: **Equipe** (convite, papel, assentos, cobrança de assento) — vive no registro
"silencioso" do miolo, zero ilustração, mobile-first como o resto do produto. Rota
sugerida: `/equipe`.

## 9. Fora, de propósito, mesmo dentro da Fase 3

Aprovação em cadeia, papel granular por módulo, chat interno, split de comissão
automático por regra (fica manual por venda, seção 5), mais de 3 papéis
(owner/admin/agente chega para 2-4 pessoas), múltiplo centro de custo cruzado (isso é
Fase 4, uma dimensão só, quando chegar — ver `docs/ROADMAP_MONDE.md`).

## 10. Critério de aceite da Fase 3

Dono convida um segundo e-mail → convidado aceita e vira `member` do **mesmo** tenant
(nunca cria tenant novo) → cria um negócio → dono vê esse negócio na quebra por vendedor
da seção 7 → um convite além do limite de assentos pagos é recusado pelo
`membershipLimit` antes de gerar qualquer cobrança nova → um `member` sem papel admin, no
escopo `own`, não recebe negócio de `agent_id` alheio ao chamar a função de listagem
(teste funcional do Téo, seção 4) → cancelar+recriar assinatura por mudança de assento
não dispara o gate de inadimplência no meio-tempo (seção 6).
