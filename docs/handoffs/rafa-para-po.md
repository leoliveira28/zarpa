# Rafa → PO

Pedidos que dependem de arquivo que não é meu (`package.json`, `.env*`, `tsconfig.json`).
Ordenados por impacto. Os dois primeiros bloqueiam o critério de aceite escrito ao pé da
letra; entreguei um caminho alternativo para os dois, então nada está parado.

---

## 1. `package.json`: os scripts `db:migrate` e `db:seed` não existem

O critério de aceite do S1 é `npm run db:migrate && npm run db:seed`. Esses scripts não
estão no `package.json` e eu não edito esse arquivo.

Funciona hoje, com o comando completo:

```bash
node --import ./src/db/_register.mjs --env-file=.env.local src/db/migrate.ts
node --import ./src/db/_register.mjs --env-file=.env.local src/db/seed.ts
```

Para virar `npm run`, acrescente em `scripts`:

```json
"db:migrate": "node --import ./src/db/_register.mjs --env-file=.env.local src/db/migrate.ts",
"db:seed":    "node --import ./src/db/_register.mjs --env-file=.env.local src/db/seed.ts",
"db:reset":   "npm run db:migrate && npm run db:seed"
```

O `--import ./src/db/_register.mjs` registra um resolvedor de módulo de 40 linhas que
existe só porque o Node exige extensão explícita no import e não conhece o alias `@/` do
`tsconfig.json`. Ele some no dia em que o item 2 for atendido.

## 2. `drizzle-kit` não está instalado

Só `drizzle-orm` está. Consequências:

- as migrations são escritas à mão (o que eu faria de qualquer jeito: o gerador não emite
  `CREATE POLICY`, e a regra 1 do CLAUDE.md exige a policy na mesma migration da tabela);
- `drizzle.config.ts` existe mas **não importa `defineConfig`** — o import quebraria
  `npx tsc --noEmit`. Está como objeto tipado localmente, mesmo formato. Quando a
  dependência entrar, é trocar uma linha;
- não há `drizzle-studio` nem `drizzle-kit check` para conferir drift entre o schema TS e
  o SQL aplicado. **Esse é o risco real**, não a falta do gerador: hoje o alinhamento entre
  `src/db/schema/*.ts` e `drizzle/0000_fundacao.sql` é garantido por revisão, não por
  ferramenta.

Pedido: `npm i -D drizzle-kit`. Também `tsx`, se quiser scripts sem o `--import`.

## 3. `.env.local`: `ENCRYPTION_KEY_V1` não é uma chave de 32 bytes

O valor atual (`dev_only_32_bytes_base64_AAAA...`) decodifica em **36 bytes**. AES-256
precisa de exatamente 32.

Como não posso editar `.env*`, o `src/lib/crypto/keyring.ts` faz o seguinte: **fora de
produção**, deriva 32 bytes do material via HKDF-SHA256 e imprime um aviso a cada boot;
**em produção**, lança e recusa subir. Ou seja, o seed roda hoje, e um deploy com chave
torta falha alto em vez de gravar CPF com chave imprevisível.

Substituir por uma chave de verdade:

```bash
openssl rand -base64 32
```

## 4. `.env.example`: variáveis que o código já lê e não estão lá

Acrescente:

```
# Criptografia — chave ativa é a de maior N; o key_id vai gravado no ciphertext
ENCRYPTION_KEY_V1=
# Opcional: fixa qual chave cifra os dados NOVOS durante uma rotação (ex.: v2)
ENCRYPTION_ACTIVE_KEY_ID=
# Remetente dos e-mails transacionais (magic link)
MAIL_FROM=
# Tamanho do pool por instância (padrão 10 / 4)
DATABASE_POOL_MAX=
AUTH_POOL_MAX=
```

## 5. Infra de banco: um segundo role para o serviço de autenticação (S2)

Detalhe em `docs/status/rafa.md`, seção "Riscos". Resumo: autenticar acontece antes de
existir tenant, então as tabelas de credencial têm uma policy que libera quando
`app.auth_context = 'on'`. Esse GUC é ligado no startup da conexão do serviço de auth, e
só lá. Mas **um GUC é forjável por qualquer SQL** — confirmado neste ambiente:

```
begin; select set_config('app.auth_context','on',true);
select count(*) from "user";   -- 2
```

Isso não é regressão (quem executa SQL arbitrário também forja `app.tenant_id`), mas o
raio de alcance é maior: `app.tenant_id` te dá um tenant por vez, `app.auth_context` abre
`user` + `tenants` + hashes de senha de todo mundo de uma vez.

Correção estrutural, para o S2: um role dedicado, e a policy passa a olhar o role em vez do
GUC (role não se forja com SQL, exige credencial).

```sql
CREATE ROLE zarpa_auth LOGIN PASSWORD '<segredo>';
GRANT USAGE ON SCHEMA public TO zarpa_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "user", session, account, verification, tenants TO zarpa_auth;
-- e as policies *_auth_service viram: USING (current_user = 'zarpa_auth')
```

Preciso de você (ou do superuser) porque o role `zarpa` não tem `CREATEROLE` — testei:
`ERROR: permission denied to create role`. Junto com isso viria uma `AUTH_DATABASE_URL`
no `.env.example`.

## 6. O CLAUDE.md fala em "16 tabelas do v1" mas não lista quais

Não achei a lista em lugar nenhum do repositório (só há dois commits, e nenhuma versão
anterior do arquivo tem a tabela). Derivei **17 tabelas** da descrição do produto. O mapa
está em `docs/status/rafa.md`, seção "Decisões que tomei sozinha". Se você tinha uma lista
fechada em mente, me diga o que sobra e o que falta — mexer agora custa uma migration
`0001`, e daqui a duas semanas custa um backfill.

## 7. S8 — rota de cron para a régua de follow-up (`src/app/api/**`, sua fronteira)

O runner do dia está pronto e testado: `rodarFilaDeFollowups()`, exportado no barril
(`import { rodarFilaDeFollowups } from '@/server'`). Falta só a rota HTTP que o
agendador (Vercel Cron ou equivalente) chama — isso é `src/app/api/**`, não toco.

```ts
// src/app/api/cron/followups/route.ts (sugestão de caminho)
import { rodarFilaDeFollowups } from '@/server';

export async function GET(request: Request) {
  const token = request.headers.get('authorization');
  if (token !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('unauthorized', { status: 401 });
  }
  const resultado = await rodarFilaDeFollowups();
  return Response.json(resultado);
}
```

Pontos que importam para você decidir a proteção:

- `rodarFilaDeFollowups()` roda **sem sessão de usuário** (usa `authDb`, a mesma conexão
  com `app.auth_context` ligado que já resolve tenant no login) — ela varre TODOS os
  tenants, então a rota que a expõe precisa de autenticação de máquina (token de cron),
  nunca de `requireAuthContext()`. Um `CRON_SECRET` em `.env.example` (que também não
  edito) resolve.
- É **idempotente sob chamada repetida** — se o agendador disparar duas vezes (retry,
  timeout do lado dele, o que for), não duplica nada. Não precisa de trava de
  "já rodei hoje" na camada HTTP.
- Ela também substitui o cron antigo de `gerarAlertas()` (`alerts.ts`) — não são mais
  duas rotas de cron, é uma só. Se já existir uma rota `/api/cron/alerts` chamando
  `gerarAlertas()` direto, sugiro trocar para chamar `rodarFilaDeFollowups()` no lugar
  (ela chama os dois `gerarAlertasDe*` internamente, então nada se perde) — `gerarAlertas()`
  continua exportado para quem só quiser os alertas isolados (ex.: um botão manual).
- Resposta da função: `{ ok, data: { tenantsProcessados, followupsCriados,
  passaporteCriadas, aniversarioCriadas } }` (ou `{ ok: false, error }`) — dá para logar
  isso e não precisa de mais nada no corpo da resposta HTTP.

## 8. S9 — Docker Desktop não subiu nesta sessão (ambiente, não código)

Tentei `docker compose up -d db` / `open -a Docker` várias vezes nesta rodada (S9 —
`sales`/`receivables`) e o daemon nunca ficou pronto (`docker info` sempre "não pronto",
mesmo depois de esperas de minutos). Sem Postgres de pé, não consegui rodar
`npm run db:migrate` nem `npx tsx scripts/check/known-failures.ts` para confirmar ao vivo
que `drizzle/0007_vendas_e_recebiveis.sql` aplica limpa e que
`tests/security/tenant-isolation.test.ts` cobre as duas tabelas novas — revisei a
migration byte a byte contra o padrão das anteriores e `tsc`/`eslint` estão limpos, mas
isso é verificação estática, não a mesma coisa que rodar contra Postgres de verdade.
Pedido: alguém com Docker funcionando nesta máquina (ou no CI) rode a migration e a suíte
antes de considerar a entrega fechada — detalhe completo em
`docs/handoffs/rafa-para-teo.md`, seção "S9". Se isso se repetir em rodadas futuras, vale
investigar se é específico desta sessão/sandbox ou algo mais estrutural no ambiente.
