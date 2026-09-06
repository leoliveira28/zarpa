# Status — Téo — CI (S1) + teste de aceite da importação (S3)

## O que ficou pronto

### 1. `.github/workflows/ci.yml`
Um job (`ubuntu-latest`), Postgres 16 como `services:`, na ordem pedida:

1. checkout + Node 22 (com cache de `npm`)
2. `npm ci`
3. `npm run typecheck`
4. bootstrap do Postgres — roda `scripts/db-init/01-init.sql` (o MESMO arquivo do
   `docker-compose.yml` local) contra o serviço, criando o role `zarpa`
   (`NOSUPERUSER`/`NOBYPASSRLS`, como o CLAUDE.md exige) e os bancos `zarpa_dev`/`zarpa_test`.
   Única fonte de verdade para esse role — não há uma segunda definição no YAML.
5. escreve um `.env.local` efêmero (vive só no runner) com as mesmas credenciais de
   dev do `docker-compose.yml` e uma `ENCRYPTION_KEY_V1` de 32 bytes gerada na hora
   (`openssl rand -base64 32`) — não é segredo real, é chave de teste descartável.
6. aplica as migrations em `zarpa_test` via `npm run db:migrate` (`USE_TEST_DATABASE=1`),
   o migrator de verdade do `drizzle-orm` — redundante de propósito com o `globalSetup`
   do vitest (que aplica o `.sql` cru, statement a statement): são dois caminhos
   diferentes para o mesmo schema, e se um dia divergirem é aqui que aparece primeiro.
7. `npx tsx scripts/check/known-failures.ts` — **não** `npm test` cru. Motivo: 3 testes
   de `public-proposal.test.ts` ficam vermelhos DE PROPÓSITO (a função `SECURITY
   DEFINER` da proposta pública é trabalho da S7 — não existe ainda, ver
   `docs/handoffs/rafa-para-teo.md`, item 5). `known-failures.ts` roda a suíte inteira
   e só fecha o portão se: (a) algum teste FORA da lista dos 3 estiver vermelho
   (regressão real), ou (b) um dos 3 da lista virar verde (allowlist obsoleta —
   sinal de que a S7 chegou e é hora de tirar a entrada).

Validado localmente simulando a sequência exata do CI contra um Postgres **vazio de
verdade** (`DROP DATABASE`/`DROP ROLE` e reconstrução do zero): bootstrap → migrate →
gate, três vezes, sempre com o mesmo resultado (só os 3 vermelhos da S7).

Este workflow cobre literalmente o critério de aceite da S1 — "um teste automatizado
que tenta ler dado de outro tenant retorna zero linhas, rodando no CI" —, porque
`tests/security/tenant-isolation.test.ts` e `rls-enabled.test.ts` rodam dentro da
mesma suíte que o portão executa (não há como rodar a suíte sem rodá-los; o
`globalSetup` do vitest aplica todas as migrations antes de qualquer teste).

### 2. `scripts/check/known-failures.ts` — allowlist corrigida
Rodei o portão antes de mexer em qualquer coisa e ele mesmo apontou: a 4ª entrada
(`pii.test.ts` reclamando de `ENCRYPTION_KEY_V1` sem 32 bytes) estava **obsoleta** — a
chave de dev em `.env.local` já tem 32 bytes de verdade, o teste já passa. Deixar a
entrada ali seria exatamente a "cobertura falsa" que o script existe para impedir.
Removi a entrada e atualizei o comentário do cabeçalho. Allowlist hoje: só os 3 da S7,
todos dono Rafa.

### 3. `tests/crypto/pii-checks.ts` — teste de adulteração era flaky (falso positivo ~1 em 3)
Achei rodando a suíte cheia repetidas vezes antes de escrever qualquer coisa nova:
`AES-256-GCM > ciphertext adulterado FALHA ao decifrar` falhava de forma intermitente
(non-determinística), sem eu ter tocado em nada ainda. Investiguei: `flipLastAlphanumeric`
trocava o ÚLTIMO caractere alfanumérico do envelope inteiro por um "+1" na base
(`A→B`, `0→1`, `a→b`) ou por `A` (qualquer outro caractere). Como o envelope usa
base64url SEM padding e nem a tag (16 bytes) nem o ciphertext do CPF de teste (14
bytes) têm comprimento múltiplo de 3, o ÚLTIMO caractere de um desses segmentos carrega
só 2 dos 6 bits em dado real — os outros 4 (ou 2) bits são padding, descartados na
decodificação. Quando o IV aleatório fazia esse último caractere cair em `'A'`
(≈1/4 das vezes), o "+1" mexia exatamente nesse bit de padding: o `decrypt` do
"adulterado" tinha os MESMOS bytes de antes, a tag do GCM continuava batendo, e o
teste passava por sorte — o oposto do que um teste de adulteração deveria provar.

Troquei por `tamperEnvelope`: muta um caractere no MEIO do maior segmento do envelope
(longe de qualquer borda de grupo incompleto de base64), trocando por um valor bem
diferente (`Z`, ou `A` se já for `Z`). No meio de um segmento comprido todo grupo de
base64 está completo — os 6 bits são todos dado real, então a tag do GCM sempre
rejeita. Rodei 20x em loop antes e depois: antes, ~1 em cada 3 falhava; depois, 20/20
verde. Ficou registrado em comentário no próprio arquivo, com a análise de bits, para
ninguém reintroduzir o mesmo bug fazendo "refactor" do helper.

### 4. `vitest.config.ts` — alias `@/*`
Faltava para o teste da S3 sequer importar: `src/server/imports.ts` usa `@/db/schema`,
`@/lib/tenant/withTenant` e `@/lib/auth/session` internamente. Os testes de segurança
existentes escapavam disso porque tudo que eles importam (`src/lib/crypto`,
`src/lib/tenant`) só usa caminho relativo por dentro — sorte de escopo, não alias
resolvido. Acrescentei `resolve.alias['@']` apontando para `./src`, espelhando
`tsconfig.json`. Não reescrevi nenhum teste existente para usar `@/` — os que já
funcionavam com caminho relativo continuam exatamente como estavam.

### 5. `tests/imports/import-planilha.test.ts` — critério de aceite da S3
Chama `pravisualizarImportacao` e `confirmarImportacao` de `src/server/imports.ts` DE
VERDADE, contra o `zarpa_test` de verdade. A única coisa mockada é
`@/lib/auth/session` (via `vi.hoisted` + `vi.mock`, porque a Server Action lê sessão de
`next/headers`/Better Auth, e não existe requisição HTTP num teste de vitest) — o
`tenantId`/`userId` do mock apontam para um tenant e um usuário REAIS, inseridos no
banco no `beforeAll` pelo mesmo caminho que `tests/helpers/db.ts` usa para semear a
raiz do tenant (`withTenant` + `INSERT` dentro do contexto). Tudo que importa —
parsing de CSV, detecção de delimitador/encoding, normalização, dedupe, escrita — é
código real e não mockado.

Fixture: 200 pessoas, CPF válido e único cada — validado pelo `cpfValido` **real**
importado de `src/server/normalize.ts` (não por suposição sobre o algoritmo). Cabeçalho
da planilha fora de ordem de propósito (`Telefone, CPF, Observações, Nome Completo,
WhatsApp, Data de Nascimento, E-mail, Origem` — nome e e-mail não vêm primeiro, CPF vem
antes do nome). Uma linha carrega observação com `;` (o delimitador do arquivo) dentro
de aspas, para provar que o parser RFC 4180 não corta a linha errada.

Asserções (nada campo-a-campo isolado — sempre a varredura inteira):
- pré-visualização: 200 linhas, delimitador `;`, encoding `utf-8`, e o mapeamento
  sugerido acerta as 8 colunas mesmo fora de ordem (mapeia por CABEÇALHO, não por
  posição — se um dia isso regredir para mapear por índice, este teste pega).
- **zero perdido**: todo número de linha do arquivo (2..201) aparece EXATAMENTE uma
  vez no relatório — não confio só no contador `criados` (que poderia bater por
  coincidência somando uma perda com uma duplicata).
- **zero duplicado**: `contacts` tem exatamente 200 linhas para o tenant, 200 nomes
  distintos, e nenhum `document_hash` repetido — direto do banco, não do que a função
  disse que fez.
- o campo com `;` dentro de aspas sobrevive inteiro.
- **idempotência ao reimportar o MESMO arquivo**: o backend SUPORTA (achei ao ler
  `imports.ts` — casa por `document_hash`/e-mail contra o que já existe e ENRIQUECE em
  vez de criar). Reimportei o mesmo arquivo e confirmei: `criados: 0`,
  `atualizados + mesclados: 200`, contagem no banco continua 200. Não precisei de
  handoff aqui — o critério "reimportar não duplica" já está coberto pelo código do
  Rafa, e agora tem teste.

**Prova de que o teste não testa o mock nem passa à toa**: sabotei a fixture duas
vezes (temporariamente, revertido antes de qualquer commit) — removendo uma pessoa
(199 em vez de 200: pegou, em 4 asserções diferentes, incluindo a checagem linha-a-linha
do relatório) e duplicando um CPF (pegou já na checagem da própria fixture, antes até
de chegar ao banco). As duas sabotagens quebraram o teste do jeito esperado; a versão
final no repositório é a limpa, idêntica ao que rodou verde.

## O que NÃO está coberto (explícito, para não virar cobertura falsa)

- **XLSX**: `src/server/imports.ts` recusa `.xlsx`/`.xls` com erro claro (linha 42,
  comentário do próprio Rafa — falta biblioteca de parsing, pedido em
  `docs/handoffs/rafa-para-po.md`). Não escrevi teste de importação de XLSX porque a
  funcionalidade não existe; testar isso hoje seria testar "lança erro", que é
  verdade mas não é o critério de aceite.
- **Merge de linhas DENTRO do mesmo arquivo** (duas linhas do próprio CSV com o mesmo
  CPF): a fixture usa 200 CPFs distintos de propósito (é o caminho "zero perdido, zero
  duplicado" da S3). O caminho de merge-dentro-do-arquivo (`situacao: 'mesclado'`)
  já tem lógica em `imports.ts` mas não ganhou um teste de aceite aqui — só é
  exercitado indiretamente. Se quiser, é um teste separado e pequeno de acrescentar.
- **`a11y em /kitchen-sink`, `public-proposal` end-to-end, `rls-enabled` isolado por
  tabela nova**: já existem e continuam cobertos (não mexi neles), mas não fizeram
  parte do pedido de hoje — não refiz a varredura de cobertura desses.
- **Lint no CI**: não acrescentei `npm run lint` ao workflow. Rodei antes de decidir e
  a árvore `src/**` hoje NÃO está limpa (10 erros de `react-hooks/set-state-in-effect`
  e `react-hooks/refs`, a maioria em arquivos que mudaram de conteúdo enquanto eu
  investigava — outro agente está trabalhando em `src/app/**`/`src/lib/ui/**` ao vivo
  nesta mesma sessão). Colocar lint no portão hoje quebraria o CI por um motivo que não
  é meu para consertar (fora de `tests/**`, `scripts/check/**`,
  `.github/workflows/**`). Fica registrado aqui como próximo passo, não como handoff —
  não faz sentido reportar bug num arquivo que ainda está sendo escrito.
- **Concorrência observada, não uma regressão minha**: nas últimas rodadas da suíte
  completa (não do meu escopo — `tests/design/guards.test.ts`), vi
  `src/app/(app)/clientes/ClientesScreen.tsx` (arquivo novo, ainda não commitado)
  falhar o guarda de movimento (`transition-colors` em vez de `transform`/`opacity`).
  Não é meu para editar (`src/app/**`), e o próprio arquivo mudou de tamanho entre duas
  das minhas verificações — está em desenvolvimento ativo agora. `npx tsx
  scripts/check/known-failures.ts` vai acusar esse vermelho até quem estiver mexendo
  ali terminar; é o portão funcionando certo (pegou uma violação real do CLAUDE.md),
  não um bug meu.

## Decisões que tomei sozinho (dentro da minha fronteira)

1. **Removi a 4ª entrada da allowlist de `known-failures.ts`** em vez de só documentar
   que estava obsoleta — é literalmente o que o próprio script pede para fazer quando
   aponta "OBSOLETA", e deixá-la ali para "não mexer" seria pior: o script existe para
   impedir exatamente essa acumulação de allowlist morta.
2. **Corrigi o teste flaky de adulteração em `tests/crypto/pii-checks.ts`** em vez de
   só reportar — é `tests/**`, é minha fronteira, e um teste de segurança
   intermitente é mais perigoso que nenhum teste (ensina o time a ignorar vermelho).
3. **Acrescentei `resolve.alias` em `vitest.config.ts`** em vez de reescrever
   `src/server/imports.ts` para usar caminho relativo — `src/server/**` não é meu para
   editar, e o alias é a correção correta de qualquer forma (é o que `tsconfig.json`
   já promete; os testes que "funcionavam sem alias" só tinham sorte de escopo).
4. **CI usa o gate de `known-failures.ts` em vez de `npm test` cru** — é a orientação
   explícita da tarefa, e é o único jeito de ter os 3 vermelhos da S7 tolerados sem
   `.skip`/`.todo` (que fariam a asserção sumir, não só ficar vermelha).
5. **`.env.local` do CI é escrito num step do workflow, não commitado** — `db:migrate`
   tem `--env-file=.env.local` fixo no `package.json` (não é meu para editar); sem o
   arquivo, o `node` recusa subir (`ENOENT`) antes de rodar uma linha de código. Os
   valores são os mesmos placeholders de desenvolvimento do `docker-compose.yml`
   (`zarpa`/`zarpa`), exceto a chave de cifra, gerada na hora — nada disso é segredo
   real, então não há problema em escrever num step de workflow.
6. **Não acrescentei teste de merge-dentro-do-arquivo nem de XLSX** — ver seção
   "não coberto" acima; achei mais honesto listar a lacuna do que inflar o escopo do
   pedido de hoje com testes que ninguém pediu.

## O que preciso dos outros

- **Nada bloqueante para hoje.** As duas tarefas pedidas estão prontas e verificadas
  ponta a ponta (simulei a sequência exata do CI localmente, banco vazio de verdade,
  3 vezes).
- **Rafa, quando a S7 chegar** (função `SECURITY DEFINER` da proposta pública): assim
  que os 3 testes de `public-proposal.test.ts` ficarem verdes, `npx tsx
  scripts/check/known-failures.ts` vai FALHAR até alguém remover as 3 entradas de
  `KNOWN_FAILURES` em `scripts/check/known-failures.ts` — é o sinal esperado, não bug.
- **Quem estiver em `src/app/(app)/clientes/**` agora**: `tests/design/guards.test.ts`
  vai acusar `ClientesScreen.tsx` até o `transition-colors` (linha ~188/195,
  mudou durante minha sessão) virar `transition-transform`/`transition-opacity` ou
  entrar em `tests/design/deviations.ts` com dono e motivo, se for intencional.
- **PO**, se algum dia quiser lint no portão de CI: primeiro `src/**` precisa ficar
  limpo em `npm run lint` (hoje não está — ver seção "não coberto"); não é pedido de
  ação imediata, só o registro de que hoje eu decidi deixar de fora por esse motivo.

## Verificação final

```
npx tsc --noEmit                        -> limpo
npx tsx scripts/check/known-failures.ts -> 321 testes; só os 3 vermelhos da S7
                                            (verificado 3x contra Postgres recriado do zero)
```
