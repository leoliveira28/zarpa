# Zarpa — Regras de negócio

> Este documento existe para um agente/desenvolvedor que vai **continuar construindo o
> produto** e precisa entender o negócio, não só o código. Não é um changelog. Se uma
> regra aqui e uma linha de código divergirem, o código venceu — mas avise, porque
> provavelmente uma das duas está errada.

## 1. O produto, em uma frase

O agente de viagem independente (MEI, home-based, 10–15 vendas por mês) monta uma
**proposta de viagem com a própria marca em 2 minutos, do celular**, manda o link pelo
WhatsApp, **sabe quando o cliente abriu**, e não perde a venda por esquecer o follow-up.

Ele não é uma agência estruturada com equipe e ERP. É uma pessoa só, vendendo pacote de
viagem para quem confia nela, cobrando comissão da operadora e taxa de serviço do
cliente. O produto existe para substituir a combinação **planilha + WhatsApp + Canva**
que ele usa hoje — esse é o concorrente real, não outro SaaS.

**Preço**: Solo R$ 49/mês, Pro R$ 99/mês, Studio R$ 199/mês. Trial de 14 dias sem cartão.

**Concorrência de categoria**: Monde (R$ 440/mês, para agências estruturadas — caro e
pesado demais para o público-alvo), Otoos (R$ 95,92/mês, ERP com nota fiscal — resolve
problema que este agente ainda não tem), Turismo CRM (R$ 39,90/mês, mais simples que o
Zarpa). O Zarpa se posiciona entre "simples demais" e "pesado demais": a coisa mais cara
que ele tem é o construtor de proposta e a página pública — é isso que o diferencia, não
recursos de ERP.

**O bater-o-molde é**: a agente cria conta sozinha, sem ninguém explicando nada, e em
menos de 15 minutos manda a primeira proposta de verdade pro WhatsApp de um cliente. Se
qualquer mudança no produto tornar esse caminho mais longo ou mais confuso, a mudança
está errada, mesmo que resolva outro problema real.

## 2. Os dois dinheiros — não confundir nunca

O produto lida com dois fluxos de dinheiro completamente separados, e misturar os dois
em uma tela, uma tabela ou uma métrica é o erro mais fácil de cometer:

| | Dinheiro da viagem | Dinheiro da assinatura |
|---|---|---|
| **É o quê** | O que o passageiro paga pela viagem, e o que a operadora paga de comissão pro agente | O que o **agente** paga pro Zarpa pra usar o produto |
| **Onde mora** | `deals`, `proposal_options`, `sales`, `receivables` | `subscriptions`, `payments`, `plans` |
| **Quem vê** | Só o agente (nunca o cliente final — ver seção 4) | Só o agente |
| **Gateway** | Nenhum ainda — o agente cobra o cliente por fora (Pix, cartão da própria maquininha, o que ele já usa) | Asaas (Pix + cartão recorrente + boleto) |

Se uma feature nova precisa de "valor" ou "preço", pare e pergunte: é o preço que o
cliente final paga pela viagem, ou o preço que o agente paga pelo Zarpa? São tabelas,
regras e telas diferentes.

## 3. O modelo de dados como regras de negócio

### Tenant = um agente de viagem (ou uma pequena operação, no plano Studio)

Um banco Postgres só, isolamento por `tenant_id` com Row Level Security — nunca banco ou
schema por cliente (custo de infraestrutura explodiria com centenas de agentes pagando
R$ 49–199). Todo dado do produto pertence a um tenant, exceto o catálogo de planos
(`plans`, global, é preço público) e as tabelas do Better Auth.

`tenants.status` (`trialing`/`active`/`past_due`/`canceled`) e `subscriptions` juntos
decidem se a conta pode escrever — ver seção 6.

### Contato → Viajante

Um `contact` é uma pessoa que o agente conhece (cliente, ou quem decide a compra). Um
`traveler` é uma pessoa que efetivamente viaja — vinculado a um contato, mas nem sempre
é a mesma pessoa (o contato compra para a família toda). CPF, passaporte e data de
nascimento são dados sensíveis: cifrados com AES-256-GCM na aplicação (nunca no banco em
claro, nunca em log), com `key_id` gravado junto do ciphertext para permitir rotação de
chave sem migração.

### Negócio (`deals`) — a oportunidade de venda

Um negócio nasce de um ou mais contatos — casal, família ou amigos dividindo a
mesma viagem (N:N em `deal_contacts`; o contato de criação é o cliente
**principal**, fixo; secundários se adicionam e removem; relatórios e ranking
contam pelo principal para não vender a mesma viagem duas vezes) — e representa
**uma viagem em negociação**. Estágios:
`novo → cotando → proposta_enviada → negociando → ganho` ou `perdido`. `perdido` não é
uma coluna do funil visual (kanban de 5 colunas) — é uma saída, e **o motivo da perda é
obrigatório** para registrar (decisão de produto travada: perder venda sem registrar por
quê é perder o aprendizado do que não funciona).

Um negócio pode virar `ganho` sem nunca ter tido proposta formal no sistema — o agente
fecha "na palavra" às vezes. Isso é esperado; não force a existência de proposta antes de
permitir marcar como ganho.

### Proposta (`proposals`) — o produto que o cliente final vê

Uma proposta pertence a um negócio. Tem até **3 opções comparáveis** (`proposal_options`
— ex.: Essencial / Conforto / Premium), cada uma com preço de venda, custo, comissão
prevista, taxa de serviço e parcelamento. Cada opção tem **blocos** (`proposal_blocks`)
de tipos: hotel, voo, transfer, passeio, seguro, cruzeiro, texto livre, imagem, nota de
preço.

Ciclo de vida: `draft → sent → viewed → accepted` (ou `declined`/`expired`). Ao enviar,
nasce um slug público de 128 bits (`public_token`) — é o link que vai pro WhatsApp do
cliente. `sent_at`/`first_viewed_at`/`accepted_at`/`accepted_option_id` registram a
jornada.

**A proposta é o produto.** O link web é a entrega, não o PDF (PDF é secundário, gerado
sob demanda, nunca via navegador headless — custo e complexidade desnecessários para o
que é essencialmente HTML bem tipografado).

### Venda (`sales`) e recebíveis (`receivables`) — quando a proposta vira dinheiro de verdade

Uma proposta **aceita** pode ser convertida em venda (ação explícita do agente, não
automática — "Gerar venda" no editor). Uma venda tem fornecedor, valor bruto, custo,
comissão prevista, taxa de serviço, e status de comissão (`prevista/recebida/atrasada` —
o agente confere manualmente quando a operadora paga, porque não há integração de
conciliação bancária). Uma venda pode ter várias parcelas (`receivables`) com vencimento
e status de pagamento — o que o **cliente** deve ao agente, parcelado.

Uma proposta só pode virar **uma** venda (índice único em `sales.proposal_id`) — gerar
venda duas vezes da mesma proposta é erro do agente clicando duas vezes, não uma segunda
venda real.

### Integrações de fornecedor (`integrations`) — cotação, não reserva

Cada agente pode conectar a própria conta de fornecedor (Wooba, Infotravel) para buscar
hotéis e cotações **dentro do construtor de proposta**, em vez de cotar por fora e
copiar/colar. As credenciais de cada agente são cifradas por tenant (mesma técnica de
CPF/passaporte) — nunca aparecem em log nem voltam pra interface depois de salvas.

Isto é **cotação, não reserva**: o produto não fecha a compra com o fornecedor, não
processa pagamento pra operadora, não confirma disponibilidade em tempo real de forma
vinculante. O agente ainda fecha a venda com o fornecedor pelos canais de sempre; a
integração só acelera montar a proposta com preço e disponibilidade reais em vez de
inventados. Sem integração conectada, o construtor mostra dados de exemplo (modo dev) —
nunca trava o fluxo de montar proposta.

### Assinatura do SaaS (`subscriptions`/`payments`/`plans`)

Trial de 14 dias sem cartão ao criar conta. Depois, Pix/cartão recorrente/boleto via
Asaas. Um tenant tem no máximo **uma** assinatura viva por vez (trialing/active/past_due)
— histórico de canceladas acumula, nunca se apaga.

## 4. A regra mais importante do produto: o que o cliente final pode ver

A proposta pública (`/p/[slug]`) é lida **sem login**, pelo cliente do agente, no celular
dele. Ela passa por uma função `SECURITY DEFINER` no Postgres que devolve **apenas**:
proposta, opções (rótulo e preço de venda), blocos, marca do agente (nome, logo, cor,
WhatsApp).

Ela **nunca**, em nenhuma circunstância, devolve: custo, comissão, taxa de serviço,
qualquer dado de passageiro (CPF, passaporte, nascimento), ou dado de outro negócio do
mesmo agente. Isso é testado automaticamente com um "scanner de vazamento" que planta
valores-canário em toda coluna sensível do banco e varre a resposta inteira, campo por
campo e até dentro de JSON embutido em string — porque a forma mais fácil de vazar
comissão é um `select *` displicente numa função nova, seis meses depois de todo mundo
ter esquecido esta regra.

**Qualquer função ou rota nova que toque na proposta pública precisa ser auditada contra
esta regra antes de existir em produção.** Não é opcional, não é "depois a gente reforça".

## 5. O fluxo de ponta a ponta (o caminho que precisa sempre funcionar)

```
cadastro público (/cadastrar)
  → tenant nasce em trial de 14 dias, sem cartão
  → login (/entrar)
  → criar negócio (a partir de um contato)
  → montar proposta (até 3 opções, blocos, preço) — cotação via integração se conectada
  → enviar proposta → nasce o link público
  → cliente final abre o link (/p/[slug]) — sem login, no celular dele
  → cliente aceita uma opção (ou confirma por WhatsApp)
  → agente gera a venda a partir da proposta aceita
  → parcelas do cliente e comissão da operadora aparecem no Financeiro
  → dashboard do mês (Hoje) resume vendas, comissão, conversão, propostas paradas
  → trial acaba → agente assina um plano (Cobrança) → segue usando sem fricção
```

Cada elo desta corrente precisa ter uma **porta de entrada visível na interface**. Um
backend que sabe fazer algo mas que nenhuma tela chama é, na prática, uma funcionalidade
que não existe — já aconteceu neste projeto (criar negócio existiu no servidor por
sprints inteiros sem nenhum botão na tela) e é o tipo de lacuna mais caro de descobrir
tarde, porque só aparece quando alguém tenta usar o produto do zero, não quando os testes
passam.

## 6. O gate de inadimplência (dunning) — regra exata, fácil de errar

Quando a assinatura está com trial vencido, em atraso, cancelada ou expirada, o app fica
**somente leitura** para o agente — ele continua vendo tudo (negócios, propostas,
clientes, financeiro), mas não consegue criar, editar ou excluir nada. A leitura nunca é
bloqueada: bloquear leitura é perder o cliente para sempre; bloquear escrita é a forma de
cobrar sem ser hostil.

O bloqueio é a **primeira coisa** que toda ação de escrita autenticada verifica, dentro
da própria transação, antes de qualquer gravação.

**Exceções que nunca podem ser bloqueadas** — e que um agente futuro pode, por engano,
tentar "proteger" também:
- a tela de Cobrança em si (trocar de plano, ver faturas) — é justamente o caminho para
  sair do bloqueio;
- qualquer leitura, sempre;
- os motores automáticos (régua de follow-up D+2/D+5/D+10, alertas de passaporte e
  aniversário) — não são ação do agente, e parar o motor de retenção de quem já é
  cliente pagante em dia seria punir o produto, não o inadimplente;
- a criação do próprio tenant (é o que cria a assinatura que o gate avalia);
- a proposta pública — quem lê e aceita é o **cliente do agente**, sem sessão, e não deve
  nada ao Zarpa.

## 7. Direção de marca e interface (resumo — o detalhe completo está no design system)

A interface tem **dois registros**, e não são intercambiáveis:

- **Miolo do app** (onde o agente trabalha, várias vezes por dia): silencioso. Grid, fios
  finos separando seções (nunca borda em volta de card), uma cor de destaque só — azul
  de carta náutica, `#12557F`, que serve para uma coisa: dizer onde clicar. Zero
  ilustração, exceto estado vazio.
- **Proposta pública** (a única tela que o cliente final vê): editorial pleno. Tipografia
  como imagem, prancha ilustrada, margem de página como livro. É a peça de marketing do
  próprio agente, e precisa parecer cuidada — é o que justifica ele cobrar mais do que
  "manda um PDF".

Nenhuma serifa em nenhuma superfície. Todo valor financeiro em `tabular-nums` com largura
reservada. Skeleton, nunca spinner. Ação destrutiva é toast com desfazer de 8 segundos,
nunca modal de confirmação. Erro sempre diz o que aconteceu e oferece o botão de
correção, nunca "erro ao processar".

## 8. O que existe hoje e não precisa ser reconstruído

Cadastro público com trial, login (senha e link mágico), CRUD de clientes/viajantes com
importação de planilha, funil de negócios com motivo de perda obrigatório, construtor de
proposta com blocos e até 3 opções, cotação via Wooba/Infotravel por tenant, envio e
página pública da proposta com rastreamento de abertura e aceite, régua de follow-up
automática, conversão de proposta em venda, recebíveis e conferência de comissão,
dashboard do mês, cobrança recorrente via Asaas com gate de inadimplência.

## 9. O que continua fora do escopo, de propósito

- **Emissão de nota fiscal.** O agente não emite NF-e/NFS-e pelo produto — é add-on
  futuro, só quando virar objeção real de venda repetida.
- **Motor de reservas.** As integrações de fornecedor são cotação, não fechamento de
  compra automatizado — ver seção 3.
- ~~Multiusuário real (times, permissões, split de comissão entre vendedores)~~ —
  **revogado em 2026-09-09.** Entrou no roadmap como Fase 3 (`docs/ROADMAP_MONDE.md`),
  mirando agências de **2 a 4 pessoas**, não a agência estruturada de 5+. Arquitetura,
  modelo de dados e critério de aceite em `docs/MULTIUSUARIO_AGENCIAS.md` — não
  duplicar a regra aqui, só linkar.
- **App nativo.** PWA resolve o "instalar no celular"; não abrir uma frente de
  iOS/Android nativo.
- **Despegar** como fornecedor de cotação (só Wooba e Infotravel existem hoje).

Se qualquer um destes virar prioridade, é decisão de produto explícita — não um efeito
colateral de outra tarefa.
