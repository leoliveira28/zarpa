# Status — Rafa (backend / plataforma)

## Tarefa desta rodada: auto-revisão do construtor de proposta (S5/S6) + contratos

A rodada anterior foi interrompida por limite de sessão no meio do S5. O PO já tinha
commitado o trabalho parcial e confirmado verde (`tsc` limpo, migration
`0003_construtor_de_proposta.sql` aplicada, 327 testes passando). Esta rodada foi só
revisão + documentação — não reescrevi nada do que já existia.

### Pronto

1. **Auto-revisão de `library_items` (RLS de `is_global`)** — li a migration
   (`drizzle/0003_construtor_de_proposta.sql`), o schema (`src/db/schema/library.ts`) e o
   helper (`src/lib/tenant/withPlatformContext.ts`) linha a linha. Confirmação:
   - A policy de SELECT (`is_global = true OR tenant_id = current_setting(...)`) devolve
     global + próprio, nunca de outro tenant.
   - INSERT/UPDATE recusam `is_global = true` mesmo que o chamador tente forçar no `WITH
     CHECK` — não depende de `library.ts` nunca mandar isso (defesa em profundidade real,
     não só por convenção de código).
   - DELETE é policy PRÓPRIA, não reaproveita o `USING` do SELECT — outra tabela, com
     `FOR ALL` e `USING (is_global OR dono)`, deixaria qualquer tenant apagar item global
     (`DELETE` só consulta `USING`, nunca `WITH CHECK`). Esse desenho já estava certo no
     código herdado; documentei o motivo de forma mais explícita no handoff do Téo para
     virar teste nomeado, não só comentário.
   - `withPlatformContext` **não é bypass**: ele só liga `app.platform_context = 'on'`,
     nunca `app.tenant_id`. Dentro dele, a policy de tenant continua ativa e continua
     exigindo `tenant_id = current_setting('app.tenant_id')`, que fica `NULL` — logo
     nenhuma linha de tenant é visível de dentro do helper. Ele só amplia acesso a linhas
     `is_global = true`, nunca a dado de tenant. Nenhum defeito encontrado; registrei o
     risco explícito (não misturar `tenant_id` setado com `platform_context = on` no
     futuro) no handoff do Téo, para virar teste de contrato.
   - Nenhum defeito encontrado. Nada foi alterado nesses três arquivos.

2. **Auto-revisão de vazamento de custo/comissão/documento** — `src/server/proposals.ts`
   expõe `costCents`/`commissionCents` em `OpcaoEdicao` de propósito (autenticado, quem
   edita precisa ver a margem) e o próprio arquivo documenta, em comentário de topo, que
   isso nunca deve ser reaproveitado para a rota pública (S7, ainda não existe). Não há
   nenhum link entre `proposals`/`proposal_options`/`proposal_blocks` e `travelers` (CPF,
   passaporte) no schema — documento de passageiro não passa perto do construtor de
   proposta. Nenhum defeito encontrado.

3. **Auto-revisão de transação/`withTenant`** — toda função de leitura/escrita em
   `proposals.ts` e `library.ts` passa por `withTenant(tenantId, ...)`, que abre
   transação e faz `set_config('app.tenant_id', $1, true)` local a ela. Nenhuma query solta
   fora desse padrão. Nenhum defeito encontrado.

4. **Defeito real encontrado e corrigido**: `src/server/index.ts` (o barril `@/server` que
   `docs/handoffs/rafa-para-nina.md` instrui a Nina a importar) não reexportava **nada** de
   `proposals.ts` nem `library.ts` — as 16 funções e ~15 tipos do construtor de proposta
   existiam no disco mas eram inacessíveis via `import { ... } from '@/server'`. Um
   artefato claro da sessão anterior ter sido interrompida antes de fechar o arquivo. Corrigi
   adicionando os dois blocos de export (todas as funções + todos os tipos públicos de
   `proposals.ts` e `library.ts`). Sem isso a Nina não conseguiria montar o construtor.

5. **`docs/handoffs/rafa-para-nina.md`** — seção nova "Construtor de proposta (S5/S6) —
   contrato completo": assinatura exata de cada action (proposta, opção, bloco,
   reordenação em lote, biblioteca, upload de imagem), como parcelamento e comissão são
   sugeridos vs. gravados (não recalculados na leitura), como a comparação de 3 opções é
   só a mesma lista `options[]` já ordenada (sem endpoint próprio), e a lista do que nunca
   vai para a proposta pública.

6. **`docs/handoffs/rafa-para-teo.md`** — seção nova pedindo três frentes de teste:
   isolamento padrão das 4 tabelas de proposta (com atenção a preço/custo/comissão nunca
   vazando nem em mensagem de erro), o comportamento de 4 pontas de `is_global` (vê global +
   próprio; não vê de outro tenant; INSERT/UPDATE com `is_global=true` falha mesmo fora da
   action; **DELETE de item global dá 0 linhas**, o caso que não aparece testando só
   SELECT), e um teste de contrato que trave `withPlatformContext` nunca ver dado de
   tenant.

### Decisões que tomei sozinha

- Corrigi o `src/server/index.ts` sem pedir confirmação: é dentro da minha fronteira
  (`src/server/**`), é uma correção mecânica (reexport, sem mudar nenhuma lógica), e
  bloquearia a Nina sem ela nem descobrir o motivo (import quebrado silenciosamente não
  aparece no `tsc` de `proposals.ts`, só no lado de quem tenta importar do barril).
- Não toquei em nenhuma policy, schema ou Server Action além do export — a auto-revisão
  não achou defeito que justificasse mudança de comportamento, só o export faltando.

### Riscos e o que fica para depois

- Os mesmos riscos já registrados nas rodadas anteriores continuam valendo (leitura
  pública da proposta ainda não implementada — S7; GUC `app.platform_context` e
  `app.auth_context` são forjáveis por SQL arbitrário, mitigação estrutural pedida ao PO
  em `docs/handoffs/rafa-para-po.md`, item 5).
- `withPlatformContext` não tem nenhum chamador real (sem tela de admin no v1) — existe só
  para documentar a policy em código e dar ao Téo um jeito de criar fixture de item
  global em teste sem superuser. Se um dia ganhar chamador de verdade, revisar de novo
  antes de expor via Server Action.

### Verificação

- `npx tsc --noEmit`: limpo.
- `npx tsx scripts/check/known-failures.ts`: 327 testes, só os 3 vermelhos esperados do
  S7 (função `SECURITY DEFINER` da proposta pública) — igual ao estado herdado, sem
  regressão.
- Não toquei em `src/components`, `src/styles`, `tests/`, `package.json` — fronteira
  respeitada.
