# rafa → po — Fase 3 (fundação multiusuário) + recibo com lib (2026-09-09)

Duas frentes fechadas: o recibo reescrito em cima do `@react-pdf/renderer` (resposta ao
seu pedido no handoff anterior) e a fundação da Fase 3 de
`docs/MULTIUSUARIO_AGENCIAS.md`. Suíte 605/605, `tsc --noEmit` limpo. **Nada commitado —
ordem do coordenador.**

## 1. A rota de recibo — o visto que você precisa dar

`src/app/api/recibos/[vendaId]/route.ts` mudou UMA linha: `renderizarReciboPdf()`
agora é assíncrono (a lib renderiza em memória), então o call ganhou `await`. Contrato,
headers (`inline`, `application/pdf`, `no-store`), coleta de dados e auditoria: intocados.
É a única entrada minha em `src/app/api/**` nesta rodada.

## 2. O pedido antigo foi atendido

A lib entrou (instalada pelo coordenador) e o escritor de PDF à mão **foi apagado** —
sem fallback: o spike provou o `renderToBuffer` em Node antes (PDF `%PDF-` válido,
texto em Helvetica/Courier, um só arquivo novo `src/lib/pdf/recibo.tsx`). Mesma seam
(`renderizarReciboPdf(dados)`), mesmo conteúdo, `MAX_PARCELAS_IMPRESAS = 12` mantido com
a nota de excedente. Motivo do delete em vez de manter fallback: duas implementações do
mesmo documento é duas verdades — o que a lib renderiza mal apareceria só às vezes.

## 3. Fase 3 — o que entrou (tudo com RLS na migration de nascimento)

- **Plugin `organization`**: `organization`/`member`/`invitation` no schema do Better
  Auth (`0019_multiusuario.sql`), ENABLE+FORCE + dual policy (canal da aplicação via
  `app.tenant_id`, canal do plugin via `app.auth_context`) — o mesmo padrão de
  `user`/`session` da 0000. O id da organization É o id de `tenants` (FK real, CASCADE).
  Sem `createAccessControl`, como travado.
- **Atribuição**: `deals.agent_id`/`sales.agent_id` (nullable, RESTRICT) +
  `commission_split_pct` default 100, sem régua automática. Backfill do `agent_id` de
  deals pelo primeiro ator da timeline — deal sem activity ficou **null de propósito**.
- **`agent_profiles`** (comissão padrão por usuário), RLS padrão.
- **Assentos**: `subscriptions.seats_paid` (default 1, Studio backfilled para 3);
  `alterarAssentos` com o par cancelar+recriar no Asaas **preservando `nextDueDate`**
  (o Asaas não tem endpoint de mudar valor de assinatura ativa). A ordem POST → swap
  local commitado → DELETE torna o webhook do id antigo INERTE por construção — o gate
  de dunning não dispara no meio do par. Travado em
  `tests/billing/webhook-par-asaas.test.ts` (par inerte, replay idempotente, churn real
  ainda cancela e bloqueia).
- **Escopo fora da RLS**: `withTenant(tx, id, fn, { scope: { kind: 'own', userId } })` +
  `escopoDaSessao()` no service layer. Dono vê o tenant; membro vê o próprio trabalho.
- **Quebra por vendedor**: exclusiva do Studio (sua decisão de hoje), com flag honesta
  (`disponivel: false, motivo: 'plano' | 'membro_unico'`) para a tela esconder sem
  adivinhar.
- **membershipLimit dinâmico** apontando para `seats_paid`: convite que estoura o
  limite é recusado pelo plugin — gate de billing de graça.

## 4. Divergências e decisões que tomei sozinho

1. **`organization.id` é `uuid`, não `text`** (os outros ids do plugin continuam text).
   Motivo técnico duro: o Postgres não implementa FK `text`→`uuid` — a migration com o
   id text quebrou ("foreign key constraint cannot be implemented", medido). A
   identidade "organization É o tenant" manda mais que a convenção do plugin, e o
   adapter trata uuid como string; nada do plugin quebra. `member.organization_id` e
   `invitation.organization_id` seguiram para uuid pela mesma razão.
2. **Usuário que já tem conta e tenant próprio, convidado para outra agência**: o
   aceite pelo endpoint do plugin cria o `member`, mas a sessão dele continua apontando
   para o tenant antigo — ele não "muda de agência" de verdade. O caso dominante
   (convidado sem conta) está inteiro via signup. **Preciso de decisão sua**: bloquear
   convite a quem já tem conta, ou trocar `tenant_id` no aceite (isso é migrar
   usuário de tenant, com dados próprios atrás). Enquanto não decidir, o cenário não é
   divulgado na UI.
3. **`billingType` do cancelar+recriar**: a nova assinatura nasce PIX; a antiga não é
   consultada para o método. Mostrar o método certo por fatura é trabalho da listagem
   de `payments` (que já grava por fatura). Se quiser preservar método na troca de
   assentos, é uma leitura a mais — barata, me diga.
4. **Membro não escolhe escopo** (não existe toggle "Time" para quem não é dono): dar
   visão de gestão sem poder de gestão era promessa falsa. Toggle "só os meus" para o
   DONO é barato se você pedir.
5. **DELETE da assinatura antiga fora da transação** (de propósito): o swap precisa
   estar commitado e visível para todo o pool antes do DELETE sair, senão o webhook
   poderia ler o id antigo ainda vivo. O par é auditado; falha do DELETE vira linha de
   auditoria com `pendencia: cancelamento_manual…` — pior caso é cobrança duplicada
   detectável, nunca bloqueio de conta.

## 5. O que fica pendurado em você

- Decisão do item 4.2 (convite a quem já tem conta).
- Quando o Asaas real entrar: criar o webhook configurado para os eventos de
  subscription (SUBSCRIPTION_CANCELED é o que o par usa; os de PAYMENT já tratados).
- A tela Equipe e o alternador Meus/Time são da Nina — contrato em §13 do meu handoff
  para ela.
