# Téo para Rafa — bug na porta de fuga do webhook do Asaas (S11)

Encontrei um bug no backend de cobrança (`src/server/billing.ts` +
`src/lib/asaas/client.ts`, commit `14b718b`) que impede o webhook do Asaas de
funcionar em produção. Não corrigi — é fronteira sua (`src/server/**`,
`src/db/**`). Documento aqui com passo de reprodução.

## Resumo

`processarWebhookAsaas` (em `src/server/billing.ts`, linhas ~600-656) faz a
busca inicial da assinatura por `asaasSubscriptionId` via
`unsafeDbWithoutTenant` — **sem `set_config('app.tenant_id')`**. Mas a policy
`subscriptions_isolation` (em `drizzle/0000_fundacao.sql`, linha ~552) é:

```sql
CREATE POLICY "subscriptions_isolation" ON "subscriptions"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
```

Sem `app.tenant_id` setado, `current_setting('app.tenant_id', true)` devolve
`''`, `nullif('', '')` devolve `null`, `null::uuid` é `null`, e
`"tenant_id" = null` é `null` (falso em `USING`). O `SELECT` devolve **zero
linhas**. O role `zarpa` é `NOSUPERUSER / NOBYPASSRLS`, então
`unsafeDbWithoutTenant` **não bypassa** a policy — mesmo com `FORCE RLS`.

O webhook então sempre cai em `return { processado: false, motivo: 'assinatura
não encontrada' }`, mesmo quando a assinatura existe e tem o
`asaasSubscriptionId` correto. **O webhook nunca processa pagamento nenhum em
produção com o código como está.**

## Passo de reprodução

Rodei um probe direto em `zarpa_test` (role `zarpa`, NOBYPASSRLS):

```sql
-- 1. Cria tenant + subscription com asaasSubscriptionId, dentro de withTenant
--    (com app.tenant_id setado):
begin;
select set_config('app.tenant_id', '<uuid-do-tenant>', true);
insert into tenants (id, name, slug) values (<uuid>, 'probe', 'probe');
insert into subscriptions (tenant_id, plan, status, billing_cycle, amount_cents,
  asaas_subscription_id, asaas_customer_id)
values (<uuid>, 'pro', 'active', 'monthly', 9900, 'asaas-sub-probe', 'cust');
commit;

-- 2. Busca SEM contexto (caminho do unsafeDbWithoutTenant no webhook):
select id, tenant_id from subscriptions where asaas_subscription_id = 'asaas-sub-probe';
-- Resultado: 0 linhas. RLS barra.

-- 3. Busca COM contexto:
begin;
select set_config('app.tenant_id', '<uuid-do-tenant>', true);
select id, tenant_id from subscriptions where asaas_subscription_id = 'asaas-sub-probe';
-- Resultado: 1 linha.
commit;
```

Confirmei em Node/tsx: `0 linhas` sem contexto, `1 linha` com contexto.

## Testes que documentam o bug

Em `tests/billing/cobranca.test.ts`, dois testes ficam vermelhos de propósito
documentando o contrato esperado (o webhook deveria funcionar):

1. `processarWebhookAsaas — idempotência e validação processa PAYMENT_RECEIVED:
   encontra a assinatura, cria 1 linha em payments e ativa a subscription`
2. `processarWebhookAsaas — idempotência e validação idempotente: mesmo
   asaasPaymentId processado duas vezes cria UMA linha em payments`

Ambos estão na allowlist de `scripts/check/known-failures.ts` com `owner: 'teo'`
e motivo apontando para este arquivo. Quando você consertar a porta de fuga,
os testes ficam verdes e o gate acusa as entradas como `OBSOLETA` — sinal de
remover e a allowlist volta a vazia.

## Sugestões de conserto (decisão é sua)

1. **Função `SECURITY DEFINER`** (mesmo padrão da proposta pública em
   `drizzle/0004_proposta_publica.sql`): uma função `resolver_tenant_por_asaas_subscription(
   asaas_sub_id text) returns uuid` que bypassa RLS, com `search_path` fixo,
   que devolve o `tenantId` dono da assinatura. O webhook chama a função,
   pega o `tenantId`, e abre `withTenant(tenantId, ...)`. Mesma arquitetura
   que já existe para a proposta pública — consistente com o desenho.
2. **Policy permissiva específica** para leitura por `asaasSubscriptionId`
   — abre uma porta estreita (só leitura da coluna unique). Avaliar risco:
   a coluna é `asaas_subscription_id`, que não é PII, mas é dado de cobrança.
   Menos conservadora que a opção 1.
3. **Receber o `tenantId` de outra forma** — header assinado pelo Asaas com
   referência ao tenant. O Asaas não sabe o nosso `tenantId` (é nosso), então
   isto exigiria mapeamento Asaas-customerId → tenantId em lookup fora de
   RLS. Mais complexo, sem vantagem sobre a opção 1.

Recomendo a opção 1 (função `SECURITY DEFINER`), pelo mesmo padrão da proposta
pública. O teste vermelho já está escrito contra esse contrato.

## Divergência de documentação (menor, não bloqueia)

A migration `drizzle/0009_planos_e_assinatura.sql` diz, no comentário:

> Sem `WITH CHECK`: escrita negada sob RLS para o role da aplicação
> (NOBYPASSRLS) — o seed roda nesta migration como superuser, que bypassa
> RLS mesmo com FORCE.

Mas `CREATE POLICY "plans_read" ON "plans" USING (true)` sem `FOR` (default
`ALL`) e sem `WITH CHECK` tem `WITH CHECK` default = `USING` = `true` — a
escrita é **permitida** para o role da aplicação. Confirmei com probe: o role
`zarpa` consegue INSERT em `plans` (só o CHECK de slug barra slug inválido).

Não é bug de segurança (preço de plano é dado público e a escrita real é só
via migration como superuser), mas o comentário diverge do comportamento.
Se a intenção era negar escrita, a policy deveria ser `FOR SELECT` ou ter
`WITH CHECK (false)`. Se a intenção era permitir (e o comentário está errado),
tudo bem como está. Sugiro alinhar o comentário com a realidade.

---

# Téo para Rafa — tradução do 23505 em `criarTenant` é código morto (S13a)

Achado da rodada de testes S13a (`tests/signup/criarconta.test.ts`). Não corrigi —
é fronteira sua (`src/server/**`). Passo de reprodução abaixo.

## Resumo

`criarTenant` (`src/server/tenants.ts`) promete no comentário que "a violação que
escapar daqui [do pré-cheque] é traduzida logo abaixo". Não é. O catch chama
`ehViolacaoDeUnicidade(error)`, que faz:

```ts
const codigo: unknown = (error as { code?: unknown }).code;
return codigo === '23505';
```

Mas com drizzle-orm **0.45.2** (versão atual do `package.json`), toda falha de query
vem embrulhada em `DrizzleQueryError` — mensagem `Failed query: insert into "tenants"...`
— e o `PostgresError` original (que sim, tem `.code === '23505'`) está em
`error.cause`, não no próprio erro. `DrizzleQueryError` não tem `.code`. Resultado:

- **Pré-cheque via `authDb` (o fix do S13a): funciona** — colisão sequencial devolve
  `CONFLITO` amigável. Teste cobre e passa.
- **Corrida (dois cadastros simultâneos, o cenário que o catch existe para cobrir):**
  o perdedor do INSERT recebe o erro CRU do drizzle, não o `CONFLITO`.

## Passo de reprodução

```
npx vitest run tests/signup/criarconta.test.ts -t "duas criarTenant simultâneas"
```

É o teste que eu tinha escrito afirmando o contrato "perdedor recebe CONFLITO
traduzido" — ele falhou com:

```
AssertionError: expected Error: Failed query: insert into "tenants… { …(2) }
to be an instance of ServiceError
```

Ajustei o teste para o comportamento atual (afirma só o que é determinístico: 1
vencedora, 1 perdedora, exatamente 1 tenant com o slug no banco) e deixei o comentário
apontando para cá. **Quando você consertar, aquele teste deve voltar a afirmar o
CONFLITO** — troque a asserção condicional por uma fixa.

## Impacto

- Caminho `criarTenant` direto: erro cru sobe.
- Caminho `criarConta` (o real do produto): o erro não-`CONFLITO` escapa do laço de
  sufixos (`aindaTemSlug === false` → `throw error`) e `comoResultado` converte para
  `DADOS_INVALIDOS` / "Não consegui completar essa ação agora." — o usuário vê erro
  genérico em vez de "Esse endereço já está em uso.", e o `console.error` loga a query
  inteira de INSERT.
- Estado do banco: íntegro (o INSERT que falhou rolou sozinho, nenhum órfão). O problema
  é só a mensagem — mas é exatamente a mensagem que o catch foi escrito para dar.

## Correção sugerida (decisão sua)

Percorrer a cadeia de `cause` em `ehViolacaoDeUnicidade`:

```ts
function ehViolacaoDeUnicidade(error: unknown): boolean {
  let atual: unknown = error;
  while (atual instanceof Error) {
    if ((atual as { code?: unknown }).code === '23505') return true;
    atual = (atual as { cause?: unknown }).cause;
  }
  return false;
}
```

## Observação do mesmo tipo (menor, sem teste próprio)

O catch de `criarConta` identifica duplicidade de e-mail por
`/already exists|já existe/i.test(mensagem)`. O erro do `signUpEmail` em corrida também
vem embrulhado pelo drizzle (a mensagem vira `Failed query: insert into "user"...`),
então o sniff não casa e o perdedor da corrida de e-mail recebe o `CONFLITO` genérico
("Não consegui criar sua conta agora.") em vez de "Já existe uma conta com esse e-mail."
O mesmo `cause`-walking resolveria os dois se você preferir extrair a checagem para
`errors.ts`. Os testes de corrida de e-mail que escrevi são contrato-level
(`code === 'CONFLITO'`, estado final do banco) e passam nos dois desfechos — não
travam a correção, mas ela melhora a mensagem real que o usuário vê.
