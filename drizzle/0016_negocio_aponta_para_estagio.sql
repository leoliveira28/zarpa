-- 0016_negocio_aponta_para_estagio — `deals.stage_id`, a FK que faltava.
--
-- A 0015 criou `pipeline_stages` (as colunas do funil, por tenant) e deixou escrito no
-- topo o caminho para ligar `deals` nela. Esta migration EXECUTA esse caminho: `deals`
-- ganha `stage_id uuid NOT NULL REFERENCES pipeline_stages(id)`, com backfill por
-- `legacy_stage` dentro deste mesmo arquivo.
--
-- ESTRATÉGIA: AS DUAS COLUNAS CONVIVEM, SINCRONIZADAS POR TRIGGER NO BANCO.
-- `deals.stage` (o enum de 6 valores, com CHECK) NÃO sai. Ele vira PROJEÇÃO de
-- `stage_id`, mantida pelo trigger `deals_estagio_sync`. Motivo, em uma frase: existe
-- código escrevendo e lendo `deals.stage` em seis lugares de `src/server/**`, no
-- `src/db/seed.ts`, em SEIS arquivos de teste que eu não posso editar (fronteira do Téo) e
-- no seed sintético do scanner de isolamento — e qualquer estratégia que exija que TODOS
-- eles mudem no mesmo commit é uma aposta, não uma migração.
--
-- Com o trigger, a regra é simples e vale para QUALQUER escritor, hoje e amanhã:
--
--   * quem grava `stage_id`  → o trigger deriva `stage`   (o id manda);
--   * quem grava só `stage`  → o trigger resolve `stage_id` pelo `legacy_stage`;
--   * quem não toca em nenhum dos dois → o trigger não faz nada (early return).
--
-- Ou seja: `INSERT INTO deals (..., stage) VALUES (..., 'ganho')` continua funcionando
-- exatamente como antes desta migration e agora sai com `stage_id` preenchido; e a UI de
-- funil configurável (a próxima rodada da Nina) escreve `stage_id` e não precisa saber
-- que o enum existe.
--
-- QUEM É A FONTE DA VERDADE DE "FECHOU COMO GANHO/PERDIDO"
-- `pipeline_stages.is_won` / `is_lost`. O enum é derivado DELES:
--
--   stage := coalesce(legacy_stage,
--                     case when is_won then 'ganho'
--                          when is_lost then 'perdido'
--                          else 'negociando' end)
--
-- Consequência que É o ponto: `deals.stage = 'ganho'` passa a ser VERDADEIRO SE E SOMENTE
-- SE o negócio está no estágio `is_won` do tenant. Por isso as comparações literais
-- espalhadas pelo código (`gerarRoteiro` recusando `stage <> 'ganho'`, `money.ts` filtrando
-- `stage = 'perdido'`, `viagens.ts` filtrando `stage = 'ganho'`) continuam CORRETAS sem
-- serem reescritas uma a uma — elas passam a ser, na prática, um teste de `is_won`/`is_lost`
-- escrito em outra sintaxe. (Reescrevi mesmo assim as de `src/server/**` para lerem
-- `is_won`/`is_lost` pelo join, porque explícito é melhor; o trigger é o cinto de segurança
-- para todo o resto: seed, testes, importação futura.)
--
-- O FALLBACK `'negociando'` PARA COLUNA CRIADA PELA AGENTE
-- Estágio criado pela agente não tem `legacy_stage` (não existe enum para ele). Ele precisa
-- de ALGUM valor de enum, porque o CHECK de `deals.stage` continua valendo. Escolhi um
-- valor ABERTO (nem ganho, nem perdido) — é a única propriedade que importa para todo
-- consumidor legado: `listarNegociosParados`, `obterResumoDoPipeline` e o board só
-- perguntam "está aberto?". Entre os quatro abertos, `negociando` é o último antes do fim
-- de funil. Efeito colateral conhecido e aceito: enquanto `/funil` ainda montar as colunas
-- pela lista fixa `COLUNAS_DO_FUNIL`, um negócio numa coluna customizada aparece embaixo de
-- "Negociando". Some no minuto em que a tela passar a usar `stageId`/`stageLabel`, que
-- `listarNegociosDoFunil` já devolve.
--
-- O TENANT QUE NÃO TEM COLUNA NENHUMA
-- `criarTenant` semeia o funil de fábrica desde a 0015, e o backfill abaixo semeia quem
-- ficou para trás. Mas tenant nasce por outros caminhos que não passam pelo serviço: o
-- `src/db/seed.ts`, os testes (que inserem em `tenants` direto, via `withTenant`) e o seed
-- sintético do scanner de isolamento. Para esses, `stage_id NOT NULL` seria uma bomba —
-- por isso o trigger, ao resolver pelo enum, chama `semear_estagios_padrao(tenant)`, que é
-- idempotente e só age quando o tenant não tem NENHUMA linha em `pipeline_stages`. Não é
-- conserto de dados escondido: é a mesma semente da 0015 e de `pipelineStagesDefaults.ts`,
-- aplicada no único momento em que dá para saber que ela faltou.
--
-- RLS
-- Nenhuma tabela nova, nenhuma policy nova, NENHUM GUC novo — logo, nada a acrescentar em
-- `KNOWN_ESCAPE_HATCHES`. As duas funções são SECURITY INVOKER (o padrão): elas rodam com
-- os direitos de quem escreveu no `deals`, sob o mesmo `app.tenant_id`, e as policies de
-- `pipeline_stages` valem dentro delas. Isso não é detalhe: é o que faz `stage_id` de OUTRO
-- tenant simplesmente NÃO SER ENCONTRADO na resolução (a policy some com a linha) e o
-- INSERT/UPDATE morrer com erro, em vez de gravar uma referência cruzada. O FK sozinho não
-- garantiria isso — FK não sabe o que é tenant.
--
-- ORDEM DAS INSTRUÇÕES: coluna → índices → funções → trigger → backfill → NOT NULL. O
-- backfill roda com o trigger JÁ instalado (ele apenas reconfirma o enum que já estava lá) e
-- o `SET NOT NULL` é a verificação final: se algum negócio tivesse ficado sem estágio, a
-- migration FALHA aqui, alto e claro, em vez de deixar buraco. Não conferi por `SELECT`
-- antes: `deals` tem FORCE RLS, um `SELECT ... WHERE stage_id IS NULL` num `DO` block só
-- enxergaria o tenant do GUC corrente e daria um "está tudo certo" falso. `ALTER TABLE` roda
-- como dono, sem RLS, e vê a tabela inteira — é a única checagem honesta disponível aqui.

-- ---------------------------------------------------------------------------
-- Coluna + índices
-- ---------------------------------------------------------------------------

-- DEFERRABLE INITIALLY DEFERRED: `tenants` apaga em cascata `deals` E `pipeline_stages`.
-- Com a checagem imediata, a ordem em que o Postgres processa as duas cascatas dentro do
-- mesmo comando pode fazer a RI reclamar de uma linha de `deals` que está prestes a sumir.
-- Adiando para o COMMIT, as duas cascatas já aconteceram e a checagem passa. NO ACTION (e
-- não CASCADE) de propósito: estágio nunca é apagado no produto (arquivamento é soft), e
-- CASCADE aqui significaria "apagar uma coluna do funil apaga os negócios dela" — a última
-- coisa que essa tabela deveria poder fazer.
ALTER TABLE "deals"
  ADD COLUMN "stage_id" uuid
  REFERENCES "pipeline_stages" ("id") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint

-- Índice em toda FK (regra da casa) — este serve a checagem de RI e a contagem
-- "quantos negócios tem nesta coluna" de `arquivarEstagio`.
CREATE INDEX "deals_stage_id_idx" ON "deals" ("stage_id");
--> statement-breakpoint
-- O board lê por tenant + coluna; `deals_tenant_stage_idx` (0000) continua servindo o enum.
CREATE INDEX "deals_tenant_stage_id_idx" ON "deals" ("tenant_id", "stage_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Semente de fábrica, em SQL — mesma lista de `src/server/pipelineStagesDefaults.ts` (que
-- passou a CHAMAR esta função, para a lista não existir em dois lugares) e do backfill da
-- 0015.
--
-- A GARANTIA QUE ELA DÁ, e é a que o trigger precisa: ao voltar, existe uma linha para
-- CADA um dos seis valores do enum. Não é "semeia se o tenant estiver vazio" — foi assim
-- que eu escrevi na primeira versão e a sonda ao vivo derrubou: o seed sintético do
-- scanner de isolamento (`tests/helpers/db.ts`) cria UMA coluna de funil por tenant, sem
-- `legacy_stage`; com ela lá, "o tenant tem alguma coluna" era verdade, a semente não
-- rodava, e o INSERT em `deals` com o enum morria. Pior: só quando aquele arquivo de teste
-- rodava sozinho — na suíte inteira outro teste semeava o tenant antes e o defeito sumia.
-- Falha dependente de ordem de arquivo é a que mais custa caro depois; a função agora
-- semeia POR VALOR FALTANTE, e não por "o tenant está vazio".
--
-- Dois desvios de rota, para a semente nunca esbarrar em quem já configurou o funil:
--   * RÓTULO já usado por uma coluna ativa (o índice único `(tenant_id, lower(label))`):
--     entra como "Enviada (proposta_enviada)". Feio de propósito — é sinal de estado
--     estranho, não deve parecer normal, e não pode derrubar o insert de um negócio.
--   * FIM DE FUNIL já ocupado por outra coluna ativa: a linha nasce SEM a marca. Só
--     acontece se alguém tiver criado um `is_won`/`is_lost` fora do caminho do produto
--     (`criarEstagio` nunca cria fim de funil) — e nesse cenário o enum `'ganho'` deixaria
--     de coincidir com `is_won`. Registrado como risco em `docs/status/rafa.md`; a
--     alternativa (recusar o INSERT do negócio) seria trocar uma inconsistência de
--     relatório por perda de dado da agente.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.semear_estagios_padrao(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  s        record;
  v_label  text;
  v_won    boolean;
  v_lost   boolean;
BEGIN
  FOR s IN
    SELECT * FROM (VALUES
      ('novo',             'Novo contato', 0, false, false),
      ('cotando',          'Montando',     1, false, false),
      ('proposta_enviada', 'Enviada',      2, false, false),
      ('negociando',       'Negociando',   3, false, false),
      ('ganho',            'Fechada',      4, true,  false),
      ('perdido',          'Perdida',      5, false, true )
    ) AS v(legacy_stage, label, pos, is_won, is_lost)
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM pipeline_stages ps
       WHERE ps.tenant_id = p_tenant AND ps.legacy_stage = s.legacy_stage
    );

    v_label := s.label;
    IF EXISTS (
      SELECT 1 FROM pipeline_stages ps
       WHERE ps.tenant_id = p_tenant
         AND ps.archived_at IS NULL
         AND lower(ps.label) = lower(v_label)
    ) THEN
      v_label := s.label || ' (' || s.legacy_stage || ')';
    END IF;

    v_won := s.is_won AND NOT EXISTS (
      SELECT 1 FROM pipeline_stages ps
       WHERE ps.tenant_id = p_tenant AND ps.is_won AND ps.archived_at IS NULL
    );
    v_lost := s.is_lost AND NOT EXISTS (
      SELECT 1 FROM pipeline_stages ps
       WHERE ps.tenant_id = p_tenant AND ps.is_lost AND ps.archived_at IS NULL
    );

    -- `ON CONFLICT DO NOTHING` fecha a corrida entre duas transações semeando o mesmo
    -- tenant ao mesmo tempo (apoiado nos índices únicos da 0015).
    INSERT INTO pipeline_stages (tenant_id, legacy_stage, label, position, is_won, is_lost)
    VALUES (p_tenant, s.legacy_stage, v_label, s.pos, v_won, v_lost)
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- O trigger que mantém `stage` e `stage_id` dizendo a MESMA coisa.
--
-- Não valida arquivamento de propósito: recusar "mover para coluna arquivada" é regra de
-- produto e mora em `moverEstagioDoNegocio` (`src/server/deals.ts`), onde dá para devolver
-- uma mensagem que a agente entende. Aqui, uma recusa dessas quebraria o backfill de um
-- tenant que tenha arquivado uma coluna legada — e trigger não é lugar de dar conselho.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.deals_sincronizar_estagio()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_por_id     boolean;
  v_id         uuid;
  v_legacy     text;
  v_is_won     boolean;
  v_is_lost    boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Quem mandou id, manda. Quem não mandou, cai no enum (que tem DEFAULT 'novo').
    v_por_id := NEW.stage_id IS NOT NULL;
  ELSE
    IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
      IF NEW.stage_id IS NULL THEN
        RAISE EXCEPTION 'deals.stage_id não pode voltar a ser nulo (negócio %)', NEW.id
          USING ERRCODE = '23502';
      END IF;
      v_por_id := true;
    ELSIF NEW.stage IS DISTINCT FROM OLD.stage THEN
      v_por_id := false;
    ELSE
      -- Nem o id nem o enum mudaram: nada a sincronizar, nenhuma query.
      RETURN NEW;
    END IF;
  END IF;

  IF v_por_id THEN
    SELECT ps.legacy_stage, ps.is_won, ps.is_lost
      INTO v_legacy, v_is_won, v_is_lost
      FROM pipeline_stages ps
     WHERE ps.id = NEW.stage_id
       AND ps.tenant_id = NEW.tenant_id;

    IF NOT FOUND THEN
      -- Inclui o caso "id de outro tenant": a policy de `pipeline_stages` some com a linha
      -- antes de esta função enxergá-la. Não é mensagem de usuário — a camada de serviço
      -- traduz antes de chegar aqui.
      RAISE EXCEPTION 'estágio % não existe neste tenant', NEW.stage_id
        USING ERRCODE = '23503';
    END IF;

    NEW.stage := coalesce(
      v_legacy,
      CASE WHEN v_is_won THEN 'ganho' WHEN v_is_lost THEN 'perdido' ELSE 'negociando' END
    );
  ELSE
    -- Tenant nascido fora do serviço (seed, teste, scanner) pode não ter funil ainda.
    PERFORM public.semear_estagios_padrao(NEW.tenant_id);

    SELECT ps.id
      INTO v_id
      FROM pipeline_stages ps
     WHERE ps.tenant_id = NEW.tenant_id
       AND ps.legacy_stage = NEW.stage;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'o funil do tenant % não tem coluna para o estágio "%"',
        NEW.tenant_id, NEW.stage
        USING ERRCODE = '23503';
    END IF;

    NEW.stage_id := v_id;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- `UPDATE OF stage, stage_id`: um autosave que só mexe em título/valor não paga nem a
-- entrada da função.
CREATE TRIGGER "deals_estagio_sync"
  BEFORE INSERT OR UPDATE OF "stage", "stage_id" ON "deals"
  FOR EACH ROW
  EXECUTE FUNCTION public.deals_sincronizar_estagio();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Backfill, tenant a tenant, RESPEITANDO O RLS.
--
-- Não desliguei RLS e não rodei como superuser (o role da aplicação é NOBYPASSRLS por
-- desenho): entro no contexto de cada tenant, exatamente como a aplicação faria. Para LER a
-- lista de tenants preciso de `app.auth_context` — `tenants` tem FORCE RLS e, sem contexto,
-- `SELECT id FROM tenants` devolve zero linhas e o backfill viraria um no-op silencioso.
-- Mesmo canal e mesma justificativa da 0015; local à transação, apagado no fim.
--
-- Os ids são materializados num array ANTES do laço: o GUC `app.tenant_id` muda a cada
-- volta, e não quero que a visibilidade do cursor dependa da volta em que ele está.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_tenants uuid[];
  v_tenant  uuid;
BEGIN
  PERFORM set_config('app.auth_context', 'on', true);
  SELECT coalesce(array_agg(id), '{}'::uuid[]) INTO v_tenants FROM tenants;

  FOREACH v_tenant IN ARRAY v_tenants LOOP
    PERFORM set_config('app.tenant_id', v_tenant::text, true);
    PERFORM public.semear_estagios_padrao(v_tenant);

    UPDATE deals d
       SET stage_id = ps.id
      FROM pipeline_stages ps
     WHERE ps.tenant_id = d.tenant_id
       AND ps.legacy_stage = d.stage
       AND d.stage_id IS NULL;
  END LOOP;

  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.auth_context', '', true);
END $$;
--> statement-breakpoint

-- O backfill deixou a checagem da FK pendente para o COMMIT (a coluna nasceu DEFERRABLE
-- INITIALLY DEFERRED, ver acima), e o Postgres recusa `ALTER TABLE` com evento de trigger
-- pendente (55006, `cannot ALTER TABLE "deals" because it has pending trigger events` —
-- foi exatamente o erro que a primeira tentativa desta migration deu). Forçar as checagens
-- agora resolve e, de quebra, faz a integridade do backfill ser verificada AQUI, dentro da
-- migration, e não no commit lá no fim.
SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint

-- A verificação final. Roda como dono, enxerga a tabela inteira: se sobrou negócio sem
-- estágio, esta migration falha aqui.
ALTER TABLE "deals" ALTER COLUMN "stage_id" SET NOT NULL;
