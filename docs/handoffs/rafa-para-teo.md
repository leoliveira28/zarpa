# Rafa → Téo

Li `tests/security/rls-checks.ts` e `tests/helpers/db.ts`. A varredura por catálogo em vez
de lista fixa é o jeito certo, e você já tinha achado o `FORCE ROW LEVEL SECURITY` sozinho
— então isso aqui é convergência, não descoberta.

## 1. Erro de sintaxe em `tests/security/rls-enabled.test.ts` (te bloqueia)

`npx tsc --noEmit` está vermelho, e os dois únicos erros do repositório são esse arquivo:

```
tests/security/rls-enabled.test.ts(78,1): error TS1128: Declaration or statement expected.
tests/security/rls-enabled.test.ts(78,2): error TS1128: Declaration or statement expected.
```

O `describe('RLS habilitado…')` fecha na linha 68, e aí o `it('nenhuma policy permissiva
nova ignora o tenant')` das linhas 70–77 fica fora de qualquer `describe`, com um `})`
órfão na 78. Pelo texto, esse `it` era para estar dentro do primeiro `describe` — mover o
`})` da linha 68 para depois da 77 resolve. Não toquei: `tests/**` é seu.

## 2. O que está pronto para você apontar o teste

`drizzle/0000_fundacao.sql` aplica limpo pelo seu `globalSetup` (mesmo formato:
`--> statement-breakpoint`, statement por statement). Resultado: **17 tabelas, todas com
`relrowsecurity` e `relforcerowsecurity`**.

Rodando do zero, hoje:

```
[migrate] ok — 17 tabelas em public
[migrate] todas as tabelas com RLS habilitado e forçado
[seed] tenant A … { contatos: 2, negocios: 2, propostas: 1, tenantsVisiveis: 1 }
[seed] tenant B … { contatos: 2, negocios: 2, propostas: 1, tenantsVisiveis: 1 }
```

Minha prova manual está versionada em `src/db/checks/isolation.sql` (15 passos, roda com
`psql -v tenant_a=… -v tenant_b=…`). Saída completa em `docs/status/rafa.md`. Ela não
substitui o seu teste — é o que eu conferi antes de dizer "pronto", e serve de checklist
do que vale automatizar.

Dois pontos dela que valem virar caso de teste seu, porque eu não conseguiria testar de
forma independente (é o meu próprio código):

- **passo 8**: `UPDATE contacts SET tenant_id = <B>` de dentro do contexto A. Falha por
  `WITH CHECK`. Sem `WITH CHECK`, o `USING` sozinho deixaria a linha *sair* do tenant.
- **passo 11**: `audit_log` não tem policy de UPDATE nem de DELETE — só SELECT e INSERT.
  `UPDATE 0` / `DELETE 0`, sem erro. É append-only pelo banco. Se alguém acrescentar uma
  policy `FOR ALL` nessa tabela, a garantia some sem quebrar nada — vale um teste.

## 3. Sobre `KNOWN_ESCAPE_HATCHES` — você está certo, e aqui está o contorno

Você fixou `tenants_auth_service` e `user_auth_service`, e escreveu: *"o risco real não é a
policy: é a GUC sobreviver ao fim da requisição numa conexão de pool"*. Correto. Duas
coisas a acrescentar:

**a) Existem mais duas policies desse tipo que você ainda não listou**, em tabelas SEM
`tenant_id` (por isso sua varredura não as pega): `session_auth_service`,
`account_auth_service` e `verification_auth_service`. Elas não afrouxam nada — pelo
contrário, essas três tabelas ganharam RLS *só* com essa policy, então uma conexão de
tenant comum lê **zero** hashes de senha em vez de todos. Sem RLS nelas, seria todos.
Vale incluir na sua lista como cobertura explícita.

**b) A GUC não sobrevive à requisição, porque não é setada por requisição.** Ela vai no
pacote de startup da conexão (`connection: { options: '-c app.auth_context=on' }`, em
`src/lib/auth/db.ts`), num pool separado usado só pelo Better Auth. O pool da aplicação
(`src/db/client.ts`) nunca a tem. Medido agora:

```
authDb ve usuarios (sem contexto de tenant): 2      <- login funciona
authDb ve contatos (dado de negocio):        0      <- nenhuma tabela de negócio tem policy auth_service
cliente comum ve usuarios (sem contexto):    0
cliente comum ve credenciais (account):      0
```

Sugestão de teste de contrato, que fecha o buraco de forma verificável e não depende de
ninguém lembrar da convenção: **falhar se qualquer tabela que NÃO seja
`tenants|user|session|account|verification` tiver uma policy cujo nome termine em
`_auth_service`, ou cuja expressão mencione `app.auth_context`.** Assim o dia em que
alguém colar essa policy em `contacts` para "resolver" um bug, o CI grita.

O que continua verdadeiro e não dá para testar de dentro do banco: `app.auth_context` é um
GUC comum e **qualquer SQL arbitrário liga ele**. Confirmei. A correção estrutural (role
dedicado em vez de GUC) está pedida em `docs/handoffs/rafa-para-po.md`, item 5.

## 4. Detalhes do schema que provavelmente afetam seu seed genérico

Li o `seedTenantRows`/`insertRow`. Pelo que percorri, o schema não tem armadilha para ele,
mas registro o que eu olharia se algo falhar:

- `tenants` é a raiz e a policy dela compara `id` (não `tenant_id`) com o contexto — seu
  `bootstrapTenantRoots` já trata isso, e o comentário lá está certo.
- `proposals.accepted_option_id` → `proposal_options` é o ciclo que você previu. É
  anulável, e sua ordenação topológica ignora FK anulável, então resolve sozinho.
- `subscriptions` tem índice único parcial `(tenant_id) WHERE status IN
  ('trialing','active','past_due')`: **uma assinatura viva por tenant**. Inserir duas para
  o mesmo tenant estoura — de propósito.
- `contacts` tem único parcial em `(tenant_id, lower(email)) WHERE email IS NOT NULL`.
  `email` é anulável, então seu seed deve passar batido.
- `payments.asaas_payment_id` e `subscriptions.asaas_subscription_id` são únicos globais
  (parciais, `WHERE ... IS NOT NULL`) — chave de idempotência de webhook. São anuláveis.
- Colunas `*_encrypted` (`contacts.document_encrypted`, `travelers.cpf_encrypted`, …) são
  `text` no banco e guardam `zp1.<key_id>.<iv>.<tag>.<ct>`. Texto arbitrário entra sem
  erro, mas quem ler pelo Drizzle vai tentar decifrar. O tipo tolera valor que não parece
  envelope e devolve como está — seu seed sintético não quebra por isso.

## 5. Para o `leak-scanner.ts` e o `public-proposal.test.ts`

Vi os arquivos. Aviso para você não escrever teste contra algo que não existe: **a leitura
pública da proposta não foi implementada no S1.** Não há função `SECURITY DEFINER`, não há
rota, não há policy de leitura por token. Motivo em `docs/status/rafa.md` — resumo: com
`FORCE ROW LEVEL SECURITY`, uma função `SECURITY DEFINER` de dono `zarpa` **continua**
sujeita ao RLS, então o desenho óbvio não funciona e o que funciona precisa de decisão de
risco que não cabia hoje.

O que já está pronto para quando isso chegar: `proposals.public_token` (único, 128 bits),
`brand_snapshot` congelado no envio, e a separação `price_cents` (público) × `cost_cents` /
`commission_cents` (nunca públicos). Se seu scanner de vazamento já procura `cost_cents` e
`commission_cents` em resposta pública, mantenha — é exatamente o que precisa quebrar o CI
no dia em que a rota nascer errada.
