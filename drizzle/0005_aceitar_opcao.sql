-- 0005_aceitar_opcao — aceite de opção na proposta pública (S7+), sem login.
--
-- A proposta pública permite que o cliente aceite uma opção clicando no botão
-- "Aceitar esta opção" sem efetuar login. Esta migration cria a função
-- SECURITY DEFINER que grava o aceite: `accepted_option_id`, `accepted_at` e
-- promove `status` para `'accepted'`.
--
-- Segue o padrão de `registrar_visita_proposta` (0004_proposta_publica.sql):
-- mesma SECURITY DEFINER com `SET search_path = public, pg_temp`, mesmo GUC
-- de escape hatch `app.proposal_public_context`, mesma resolução de proposta
-- por slug (public_token). Nunca confia em ids vindo do navegador do cliente.

-- NOVA POLICY para UPDATE de aceite — o próprio função faz UPDATE em proposals.
CREATE POLICY "proposals_public_accept_update" ON "proposals"
  FOR UPDATE
  USING (
    current_setting('app.proposal_public_context', true) = 'on'
    AND "status" <> 'draft'
    AND "sent_at" IS NOT NULL
    AND "archived_at" IS NULL
  )
  WITH CHECK (
    current_setting('app.proposal_public_context', true) = 'on'
    AND "status" <> 'draft'
    AND "sent_at" IS NOT NULL
    AND "archived_at" IS NULL
  );
--> statement-breakpoint

-- Função que registra o aceite de uma opção. Segue o contrato:
-- - Aceita se a proposta está em status 'sent' ou 'viewed' (publicável)
-- - A opção pertence MESMO a esta proposta (nunca confia no navegador)
-- - Grava `accepted_option_id`, `accepted_at = now()`, `status = 'accepted'`
-- - Não devolve nada sensível (custo, comissão, PII)
CREATE FUNCTION public.aceitar_opcao_proposta(
  p_slug text,
  p_option_id uuid
)
RETURNS TABLE (success boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_proposal_id uuid;
  v_proposal_status text;
  v_option_exists boolean;
BEGIN
  PERFORM set_config('app.proposal_public_context', 'on', true);

  -- Resolve a proposta pelo slug público (public_token)
  SELECT p.id, p.status INTO v_proposal_id, v_proposal_status
  FROM proposals p
  WHERE p.public_token = p_slug
    AND p.status <> 'draft'
    AND p.sent_at IS NOT NULL
    AND p.archived_at IS NULL
  LIMIT 1;

  IF v_proposal_id IS NULL THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  -- Só aceita se a proposta está em 'sent' ou 'viewed' (publicável)
  IF v_proposal_status NOT IN ('sent', 'viewed') THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  -- Valida que a opção pertence MESMO a esta proposta
  SELECT EXISTS(
    SELECT 1 FROM proposal_options o
    WHERE o.id = p_option_id AND o.proposal_id = v_proposal_id
  ) INTO v_option_exists;

  IF NOT v_option_exists THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  -- Grava o aceite
  UPDATE proposals
  SET
    accepted_option_id = p_option_id,
    accepted_at = now(),
    status = 'accepted',
    updated_at = now()
  WHERE id = v_proposal_id;

  RETURN QUERY SELECT true;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.aceitar_opcao_proposta(text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.aceitar_opcao_proposta(text, uuid) TO current_user;
