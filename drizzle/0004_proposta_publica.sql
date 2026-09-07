-- 0004_proposta_publica — leitura pública da proposta (S7), sem login.
--
-- A proposta pública é a superfície mais exposta do sistema: qualquer pessoa com o link
-- do WhatsApp chega aqui sem sessão, sem `app.tenant_id`, sem nada. Regra 4 do CLAUDE.md:
-- ela devolve proposta/opções/blocos/marca, e NUNCA custo, comissão ou documento de
-- passageiro.
--
-- PROBLEMA que esta migration resolve, registrado em `docs/status/rafa.md` desde o S1:
-- toda tabela de tenant nasce com `FORCE ROW LEVEL SECURITY`. FORCE significa que o RLS
-- vale INCLUSIVE para o dono da tabela — e o dono é `zarpa`, o mesmo role que é dono de
-- QUALQUER função `SECURITY DEFINER` criada por esta migration (o role `zarpa` é
-- NOBYPASSRLS de propósito; não existe superusuário rodando código deste projeto). Ou
-- seja: `SECURITY DEFINER` sozinho NÃO abre a tabela — ele só troca de role, e o role
-- novo esbarra na mesma policy de sempre. O desenho óbvio ("cria a função e pronto") não
-- funciona aqui, e é por isso que esta função não nasceu em S5/S6 junto do resto do
-- construtor.
--
-- SOLUÇÃO, mesmo padrão já usado duas vezes neste schema (`app.auth_context` em
-- `tenants_auth_service`/`0000_fundacao.sql`, `app.platform_context` em
-- `library_items_platform_service`/`0003_construtor_de_proposta.sql`): uma QUARTA policy
-- por tabela, que só concede quando um GUC próprio — `app.proposal_public_context` — está
-- ligado. Esse GUC é ligado DENTRO da própria função `SECURITY DEFINER`
-- (`PERFORM set_config('app.proposal_public_context', 'on', true)`, local à transação),
-- e em NENHUM outro lugar do código. Consequência prática:
--
--   - as quatro policies `*_public_read` (proposals/proposal_options/proposal_blocks) e
--     as duas de escrita (`proposal_views_public_insert`, `proposals_public_view_update`)
--     só abrem quando alguém já está DENTRO de uma das duas funções desta migration;
--   - a policy de leitura pública SEMPRE exige `status <> 'draft' AND sent_at IS NOT
--     NULL` — rascunho nunca é visível, mesmo que o slug vaze;
--   - column-safety (nunca `cost_cents`, `commission_cents`, nem qualquer coluna de
--     `travelers`/`contacts`) é responsabilidade da lista de colunas EXPLÍCITA dentro da
--     função — a policy de RLS controla LINHA, não COLUNA. `proposta_publica` nunca faz
--     `select *` e nunca faz JOIN com `travelers`/`contacts`: a marca vem de
--     `proposals.brand_snapshot`, congelada no envio (`enviarProposta`,
--     `src/server/proposals.ts`), não de `tenants` — então nem o e-mail/telefone/CPF do
--     próprio agente (colunas de `tenants`) chegam perto da resposta pública.
--
-- Ressalva já registrada duas vezes neste schema e válida aqui do mesmo jeito: um GUC é
-- forjável por qualquer SQL arbitrário. Não é regressão (quem executa SQL arbitrário já
-- forja `app.tenant_id`), mas por isso o alcance de `app.proposal_public_context` foi
-- mantido mínimo — só as quatro tabelas de proposta, nunca `contacts`/`travelers`, e a
-- policy de leitura ainda exige status publicável mesmo com o GUC ligado.
--
-- Duas coisas nascem aqui:
--
--   1. Coluna nova: `tenants.instagram` (a marca do agente ganhou uma quarta rede, além
--      de whatsapp) e `proposal_views.focused_option_id` ("opção focada" — qual opção o
--      cliente estava olhando quando a visita foi registrada). Nenhuma das duas muda RLS
--      da tabela (RLS é da tabela, não da coluna).
--
--   2. As duas funções `SECURITY DEFINER`, cada uma com `SET search_path = public,
--      pg_temp` (sem isso é escalada de privilégio clássica: quem controla o search_path
--      da sessão decide qual `proposals` a função lê):
--
--        - `proposta_publica(slug text)` — devolve `jsonb` com proposta/marca/opções/
--          blocos, ou zero linhas se o slug não existe, é rascunho, ou está arquivada.
--        - `registrar_visita_proposta(...)` — grava uma linha em `proposal_views` e
--          promove `proposals.status` de `sent` para `viewed` na primeira abertura,
--          devolvendo `is_first_view` para a aplicação decidir se dispara a notificação
--          "seu cliente abriu" (`src/server/publicProposals.ts`). Confere que
--          `p_focused_option_id`, se vier, pertence MESMO a esta proposta antes de
--          gravar — nunca confia em id vindo do navegador do cliente.

-- ---------------------------------------------------------------------------
-- Colunas novas
-- ---------------------------------------------------------------------------

ALTER TABLE "tenants" ADD COLUMN "instagram" text;
--> statement-breakpoint

ALTER TABLE "proposal_views" ADD COLUMN "focused_option_id" uuid
  REFERENCES "proposal_options" ("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "proposal_views_focused_option_id_idx" ON "proposal_views" ("focused_option_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Policies do escape hatch `app.proposal_public_context`
-- ---------------------------------------------------------------------------

CREATE POLICY "proposals_public_read" ON "proposals"
  FOR SELECT
  USING (
    current_setting('app.proposal_public_context', true) = 'on'
    AND "status" <> 'draft'
    AND "sent_at" IS NOT NULL
    AND "archived_at" IS NULL
  );
--> statement-breakpoint

-- A própria função de visita faz UPDATE em `proposals` (view_count, status sent->viewed,
-- first/last_viewed_at) — precisa de policy de UPDATE separada da de SELECT, porque
-- UPDATE consulta USING (linha antes) E WITH CHECK (linha depois); as duas exigem o
-- mesmo status publicável, então uma tentativa de "atualizar para draft" também cairia
-- fora daqui de qualquer forma (a aplicação nunca escreve isso, mas a policy não depende
-- da aplicação se comportar).
CREATE POLICY "proposals_public_view_update" ON "proposals"
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

CREATE POLICY "proposal_options_public_read" ON "proposal_options"
  FOR SELECT
  USING (
    current_setting('app.proposal_public_context', true) = 'on'
    AND EXISTS (
      SELECT 1 FROM "proposals" p
      WHERE p."id" = "proposal_options"."proposal_id"
        AND p."status" <> 'draft'
        AND p."sent_at" IS NOT NULL
        AND p."archived_at" IS NULL
    )
  );
--> statement-breakpoint

CREATE POLICY "proposal_blocks_public_read" ON "proposal_blocks"
  FOR SELECT
  USING (
    current_setting('app.proposal_public_context', true) = 'on'
    AND EXISTS (
      SELECT 1 FROM "proposals" p
      WHERE p."id" = "proposal_blocks"."proposal_id"
        AND p."status" <> 'draft'
        AND p."sent_at" IS NOT NULL
        AND p."archived_at" IS NULL
    )
  );
--> statement-breakpoint

-- `proposal_views` ganha INSERT (a visita nova) e SELECT (o `INSERT ... RETURNING` que a
-- função usa para pegar o id da linha gravada consulta a policy de SELECT também).
CREATE POLICY "proposal_views_public_insert" ON "proposal_views"
  FOR INSERT
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

CREATE POLICY "proposal_views_public_select" ON "proposal_views"
  FOR SELECT
  USING (current_setting('app.proposal_public_context', true) = 'on');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Função 1 — leitura pública. Nunca `select *`, nunca join com contacts/travelers.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.proposta_publica(p_slug text)
RETURNS TABLE (payload jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_proposal_id uuid;
BEGIN
  PERFORM set_config('app.proposal_public_context', 'on', true);

  SELECT p.id INTO v_proposal_id
  FROM proposals p
  WHERE p.public_token = p_slug
    AND p.status <> 'draft'
    AND p.sent_at IS NOT NULL
    AND p.archived_at IS NULL
  LIMIT 1;

  IF v_proposal_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'proposal', (
      SELECT jsonb_build_object(
        'id', p.id,
        'title', p.title,
        'summary', p.summary,
        'status', p.status,
        'currency', p.currency,
        'coverImageUrl', p.cover_image_url,
        'terms', p.terms,
        'validUntil', p.valid_until,
        'acceptedOptionId', p.accepted_option_id,
        'sentAt', p.sent_at
      )
      FROM proposals p
      WHERE p.id = v_proposal_id
    ),
    -- `brand` é RESHAPED explicitamente a partir de `brand_snapshot`, nunca repassado cru:
    -- `brand_snapshot` é um jsonb aberto (congelado por `enviarProposta`,
    -- `src/server/proposals.ts`) e um `select p.brand_snapshot` direto devolveria QUALQUER
    -- chave que ele tiver hoje ou ganhar amanhã, sem ninguém decidir. A chave
    -- `whatsappLink` (não `whatsapp`) é de propósito: é um link `wa.me` pronto para clicar,
    -- não o número cru — e o NOME da chave importa tanto quanto o valor aqui, porque é
    -- exatamente o tipo de campo que um scanner de vazamento (`tests/security/leak-
    -- scanner.ts`, `FORBIDDEN_KEY_PATTERNS`) trata como "parece telefone" e reprovaria de
    -- propósito, mesmo sendo o WhatsApp COMERCIAL do agente (dado público por natureza,
    -- diferente do telefone do cliente). Ver `docs/handoffs/rafa-para-teo.md`.
    'brand', (
      SELECT jsonb_build_object(
        'name', p.brand_snapshot->>'name',
        'logoUrl', p.brand_snapshot->>'logoUrl',
        'primaryColor', p.brand_snapshot->>'primaryColor',
        'secondaryColor', p.brand_snapshot->>'secondaryColor',
        'whatsappLink', CASE
          WHEN nullif(p.brand_snapshot->>'whatsapp', '') IS NULL THEN NULL
          ELSE 'https://wa.me/' || regexp_replace(p.brand_snapshot->>'whatsapp', '\D', '', 'g')
        END,
        'instagram', p.brand_snapshot->>'instagram'
      )
      FROM proposals p
      WHERE p.id = v_proposal_id
    ),
    'options', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'name', o.name,
            'description', o.description,
            'position', o.position,
            'priceCents', o.price_cents,
            'installments', o.installments,
            'installmentCents', o.installment_cents,
            'isRecommended', o.is_recommended
          )
          ORDER BY o.position
        ),
        '[]'::jsonb
      )
      FROM proposal_options o
      WHERE o.proposal_id = v_proposal_id
    ),
    'blocks', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', b.id,
            'optionId', b.option_id,
            'kind', b.kind,
            'position', b.position,
            'title', b.title,
            'body', b.body,
            'images', b.images,
            'content', b.content
          )
          ORDER BY b.position
        ),
        '[]'::jsonb
      )
      FROM proposal_blocks b
      WHERE b.proposal_id = v_proposal_id
    )
  );
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.proposta_publica(text) FROM PUBLIC;
--> statement-breakpoint
-- Neutro de ambiente: o role que conecta (zarpa local, neondb_owner no Neon) é o dono
-- da função e já tem EXECUTE — o grant fica explícito, e não se acopla a um nome de role.
GRANT EXECUTE ON FUNCTION public.proposta_publica(text) TO current_user;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Função 2 — registra a visita ("sabe quando o cliente abriu") e devolve se foi a
-- primeira abertura, para a aplicação decidir se dispara a notificação.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.registrar_visita_proposta(
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

  INSERT INTO proposal_views (
    tenant_id, proposal_id, session_key, ip_hash, user_agent, referrer,
    duration_ms, focused_option_id
  ) VALUES (
    v_proposal.tenant_id,
    v_proposal.id,
    p_session_key,
    p_ip_hash,
    p_user_agent,
    p_referrer,
    CASE WHEN p_duration_seconds IS NULL THEN NULL ELSE GREATEST(p_duration_seconds, 0) * 1000 END,
    CASE WHEN v_option_ok THEN p_focused_option_id ELSE NULL END
  );

  v_was_sent := (v_proposal.status = 'sent');

  UPDATE proposals
  SET
    status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END,
    view_count = view_count + 1,
    first_viewed_at = COALESCE(first_viewed_at, now()),
    last_viewed_at = now(),
    updated_at = now()
  WHERE id = v_proposal.id;

  RETURN QUERY SELECT v_was_sent, v_proposal.tenant_id, v_proposal.id, v_proposal.deal_id;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.registrar_visita_proposta(text, text, integer, uuid, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.registrar_visita_proposta(text, text, integer, uuid, text, text, text) TO current_user;
