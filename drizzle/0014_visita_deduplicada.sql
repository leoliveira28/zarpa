-- 0014_visita_deduplicada — o contador da proposta pública contava EM DOBRO.
--
-- O QUE ESTAVA ERRADO
-- A página pública (`src/app/p/[slug]/PublicProposalScreen.tsx`,
-- `useProposalVisitBeacon`) chama `registrarVisitaProposta` DUAS vezes por abertura:
-- uma no mount (entrada, sem `durationSeconds`) e uma no `visibilitychange`/`pagehide`
-- (saída, com `durationSeconds` e a opção focada). As duas caíam na MESMA função
-- `public.registrar_visita_proposta`, que sempre fazia `INSERT INTO proposal_views` +
-- `view_count = view_count + 1`. Uma abertura real virava 2 no `view_count` e 2 linhas em
-- `proposal_views` (e, de quebra, 2 no `openCount` de `listarAberturasRecentes`).
--
-- POR QUE A CORREÇÃO É TODA DO LADO DO BANCO
-- `src/app/**` é fronteira da Nina. O cliente continua chamando duas vezes exatamente
-- como hoje; quem passa a distinguir "abriu" de "terminou de olhar" é a função.
--
-- O IDENTIFICADOR DA VISITA É `session_key`
-- O cliente gera `crypto.randomUUID()` UMA vez por proposta e guarda em `sessionStorage`
-- (`zarpa:proposal-visit:<slug>`), reenviando a MESMA chave nas duas chamadas. Então
-- `(proposal_id, session_key)` dentro de uma janela curta = UMA visita:
--
--   1ª chamada  -> INSERT em `proposal_views` + `view_count + 1` (comportamento de hoje)
--   2ª chamada  -> UPDATE na linha que já existe (grava `duration_ms`/`focused_option_id`),
--                  SEM linha nova e SEM incrementar `view_count` de novo.
--
-- Deliberadamente NÃO confiei só em "tem `durationSeconds` = é saída": duration é dado do
-- navegador e um cliente que mandasse duas entradas (React StrictMode, remount, reload)
-- voltaria a contar em dobro. A chave de sessão é o que amarra as duas chamadas.
--
-- SEM `session_key` (modo privado sem `sessionStorage`, hoje o cliente manda `undefined`)
-- Não existe nada para deduplicar sem cooperação do cliente. Mantém-se o comportamento
-- ANTIGO — sempre insere, sempre conta. Continua contando a mais nesse caso, mas nunca
-- fica PIOR do que hoje, e nunca deixa de registrar uma abertura real.
--
-- DUAS JANELAS, DE PROPÓSITO
--   - Chamada de SAÍDA (com duration): procura a visita aberta nas últimas 24h. É o teto
--     do próprio `durationSeconds` no zod (`max(24*60*60)`) — a saída pode chegar horas
--     depois da entrada, com a aba esquecida aberta, e ainda assim pertence àquela visita.
--   - Chamada de ENTRADA (sem duration): janela de 30 min. Recarregar/voltar à aba dentro
--     de meia hora é a MESMA visita ("voltou a olhar"), não uma abertura nova; passou
--     disso, é abertura nova de verdade e conta. `sessionStorage` sobrevive a reload, então
--     sem janela um cliente que abrisse o link amanhã na mesma aba nunca mais contaria.
--     A janela é o que impede a dedupe de virar subcontagem permanente.
--
-- CONCORRÊNCIA
-- Entrada e saída podem chegar quase juntas (o `pagehide` de quem abre e fecha rápido).
-- `pg_advisory_xact_lock` sobre `(proposal_id, session_key)` serializa as duas dentro da
-- transação — sem ele, duas transações simultâneas leriam "não existe" e inseririam as
-- duas. NÃO usei índice único parcial em `(proposal_id, session_key)`: unicidade
-- impediria a segunda visita LEGÍTIMA da mesma sessão (o cliente que volta amanhã),
-- que é justamente o que a janela permite.
--
-- RLS
-- `proposal_views` tem `FORCE ROW LEVEL SECURITY` e o role que conecta é NOBYPASSRLS —
-- `SECURITY DEFINER` só troca de role, não fura policy. A função já tinha
-- `proposal_views_public_insert` e `proposal_views_public_select`; agora precisa também de
-- UPDATE. Daí a policy nova `proposal_views_public_update`, com EXATAMENTE a mesma guarda
-- das outras (GUC `app.proposal_public_context` ligado só dentro da função + proposta em
-- estado publicável) e `USING` + `WITH CHECK` — a linha tem que continuar pertencendo à
-- mesma proposta publicável depois do UPDATE. `SELECT ... FOR UPDATE` também consulta a
-- policy de UPDATE, então ela é obrigatória para o próprio lock da linha.
-- PEDIDO ABERTO AO TÉO: uma linha em `KNOWN_ESCAPE_HATCHES`
-- (`tests/security/rls-checks.ts`) — mesmo fluxo de 0004/0010/0013.
--
-- O ROTEIRO PÚBLICO (`itineraries`/`roteiro_publica`, 0013) NÃO É TOCADO por esta
-- migration: ele não registra visita nenhuma (decisão do S14, "não inventei métrica") e
-- continua sem registrar.

-- ---------------------------------------------------------------------------
-- Índice do lookup de dedupe.
-- Parcial (`WHERE session_key IS NOT NULL`) porque a consulta NUNCA procura por chave
-- nula — sem chave não há dedupe. Não é UNIQUE de propósito (ver comentário acima).
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "proposal_views_session_dedupe_idx"
  ON "proposal_views" ("proposal_id", "session_key", "created_at" DESC)
  WHERE "session_key" IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Policy nova: UPDATE público da própria linha de visita.
-- ---------------------------------------------------------------------------

CREATE POLICY "proposal_views_public_update" ON "proposal_views"
  FOR UPDATE
  USING (
    current_setting('app.proposal_public_context', true) = 'on'
    AND EXISTS (
      SELECT 1 FROM "proposals" p
      WHERE p."id" = "proposal_views"."proposal_id"
        AND p."tenant_id" = "proposal_views"."tenant_id"
        AND p."status" <> 'draft'
        AND p."sent_at" IS NOT NULL
        AND p."archived_at" IS NULL
    )
  )
  WITH CHECK (
    current_setting('app.proposal_public_context', true) = 'on'
    AND EXISTS (
      SELECT 1 FROM "proposals" p
      WHERE p."id" = "proposal_views"."proposal_id"
        AND p."tenant_id" = "proposal_views"."tenant_id"
        AND p."status" <> 'draft'
        AND p."sent_at" IS NOT NULL
        AND p."archived_at" IS NULL
    )
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A função, agora com dedupe por sessão. Assinatura IDÊNTICA à de 0004 — a action
-- `registrarVisitaProposta` (`src/server/publicProposals.ts`) não muda uma linha, e o
-- contrato de retorno (`is_first_view`, `tenant_id`, `proposal_id`, `deal_id`) é o mesmo.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.registrar_visita_proposta(
  p_slug text,
  p_ip_hash text,
  p_duration_seconds integer,
  p_focused_option_id uuid,
  p_session_key text,
  p_user_agent text,
  p_referrer text
)
RETURNS TABLE (is_first_view boolean, tenant_id uuid, proposal_id uuid, deal_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_proposal proposals%ROWTYPE;
  v_option_ok boolean;
  v_was_sent boolean;
  v_session text;
  v_is_exit boolean;
  v_janela interval;
  v_existing_id uuid;
BEGIN
  PERFORM set_config('app.proposal_public_context', 'on', true);

  SELECT p.* INTO v_proposal
  FROM proposals p
  WHERE p.public_token = p_slug
    AND p.status <> 'draft'
    AND p.sent_at IS NOT NULL
    AND p.archived_at IS NULL
  LIMIT 1;

  IF v_proposal.id IS NULL THEN
    RETURN;
  END IF;

  -- Nunca confia em `p_focused_option_id` vindo do navegador: confere que a opção é
  -- desta MESMA proposta antes de gravar; se não for, grava NULL em vez de rejeitar a
  -- visita inteira (registrar a abertura importa mais do que o detalhe da opção focada).
  v_option_ok := false;
  IF p_focused_option_id IS NOT NULL THEN
    SELECT true INTO v_option_ok
    FROM proposal_options o
    WHERE o.id = p_focused_option_id AND o.proposal_id = v_proposal.id;
  END IF;

  -- Chave vazia ('') é tratada como ausente: o cliente manda `undefined` no modo privado,
  -- mas string vazia entraria como uma "sessão" que casaria com todas as outras vazias.
  v_session := nullif(btrim(coalesce(p_session_key, '')), '');
  v_is_exit := p_duration_seconds IS NOT NULL;
  v_was_sent := (v_proposal.status = 'sent');

  IF v_session IS NOT NULL THEN
    -- Serializa entrada e saída da MESMA visita (ver "CONCORRÊNCIA" no topo).
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_proposal.id::text || ':' || v_session, 0)
    );

    v_janela := CASE WHEN v_is_exit THEN interval '24 hours' ELSE interval '30 minutes' END;

    SELECT v.id INTO v_existing_id
    FROM proposal_views v
    WHERE v.proposal_id = v_proposal.id
      AND v.session_key = v_session
      AND v.created_at > now() - v_janela
    ORDER BY v.created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    -- MESMA visita: completa a linha que já existe. Nada de INSERT, nada de `view_count`.
    UPDATE proposal_views
    SET
      -- `GREATEST` para a saída nunca ENCURTAR uma duração já gravada (reload dentro da
      -- janela manda uma duração nova, menor, da segunda passada).
      duration_ms = CASE
        WHEN p_duration_seconds IS NULL THEN duration_ms
        ELSE GREATEST(COALESCE(duration_ms, 0), GREATEST(p_duration_seconds, 0) * 1000)
      END,
      -- Opção focada só é sobrescrita quando a nova é válida — a chamada de entrada não
      -- manda opção nenhuma e não pode apagar a que a saída gravou.
      focused_option_id = CASE
        WHEN v_option_ok THEN p_focused_option_id
        ELSE focused_option_id
      END,
      ip_hash = COALESCE(ip_hash, p_ip_hash),
      user_agent = COALESCE(user_agent, p_user_agent),
      referrer = COALESCE(referrer, p_referrer)
    WHERE id = v_existing_id;
  ELSE
    INSERT INTO proposal_views (
      tenant_id, proposal_id, session_key, ip_hash, user_agent, referrer,
      duration_ms, focused_option_id
    ) VALUES (
      v_proposal.tenant_id,
      v_proposal.id,
      v_session,
      p_ip_hash,
      p_user_agent,
      p_referrer,
      CASE WHEN p_duration_seconds IS NULL THEN NULL ELSE GREATEST(p_duration_seconds, 0) * 1000 END,
      CASE WHEN v_option_ok THEN p_focused_option_id ELSE NULL END
    );
  END IF;

  UPDATE proposals
  SET
    status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END,
    -- A ÚNICA diferença entre visita nova e continuação da mesma visita.
    view_count = CASE WHEN v_existing_id IS NULL THEN view_count + 1 ELSE view_count END,
    first_viewed_at = COALESCE(first_viewed_at, now()),
    last_viewed_at = now(),
    updated_at = now()
  WHERE id = v_proposal.id;

  -- `is_first_view` continua saindo do status LIDO NO INÍCIO: na continuação da visita o
  -- status já é 'viewed' (a entrada virou), então a notificação "seu cliente abriu" sai
  -- no máximo uma vez — que é o motivo de o campo existir.
  RETURN QUERY SELECT v_was_sent, v_proposal.tenant_id, v_proposal.id, v_proposal.deal_id;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.registrar_visita_proposta(text, text, integer, uuid, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.registrar_visita_proposta(text, text, integer, uuid, text, text, text) TO current_user;
