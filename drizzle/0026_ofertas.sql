-- 0026_ofertas — a Vitrine: o catálogo público do agente (Fit 7,
-- `docs/FIT7_VITRINE.md`, rodada 7a).
--
-- O agente solo não tem site; a Vitrine É a página dele. A OFERTA é o contrato
-- novo: um pacote, um voo, uma hospedagem, um transfer ou um serviço montado
-- com os MESMOS BLOCOS do construtor de proposta (`blocks` é FOTOGRAFIA do
-- documento inteiro, como `proposal_templates.blocks` — a oferta é editada
-- como um todo e gravada inteira; não existe bloco solto com vida própria
-- aqui, então não há tabela filha). `type` carrega o que o card do catálogo
-- etiqueta; `price_cents` é o preço público (fotografia — o dinheiro real
-- continua morando em `sales`).
--
-- `public_token` (unique, global): o endereço público da oferta
-- (`/a/[slug]/o/[token]`) — mesmo desenho de `proposals.public_token`: token
-- opaco em vez de id, para o link divulgado não expor sequencialidade.
-- `published_at`/`unpublished_at` são o interruptor: despublicar sai do ar na
-- hora, mas o link já divulgado responde "não disponível" + catálogo (nunca
-- 404 seco). `group_id` nullable SET NULL: a oferta pode SER um grupo com
-- lugares (a unificação da meta Grupos com a Vitrine).
--
-- `published_at`/`unpublished_at` são o interruptor e a semântica é do serviço:
-- publicar grava o primeiro e limpa o segundo; despublicar grava o segundo. O
-- CHECK não tenta prever o futuro (despublicar sem publicar não é estado que o
-- serviço produz).
--
-- LEITURA PÚBLICA: funções `SECURITY DEFINER` com LISTA DE COLUNAS EXPLÍCITA
-- (`public.vitrine_publica(slug)` para o catálogo, `public.oferta_publica(slug,
-- token)` para a oferta) — a mesma disciplina de `proposta_publica` (0004): a
-- função liga o GUC `app.proposal_public_context`, a policy de RLS concede
-- SELECT só com ele E só quando publicada. Nome de interessado, contato de
-- cliente e qualquer PII não têm caminho para o payload (não existem na
-- tabela).
--
-- Backfill: nenhum — entidade nova.

-- ---------------------------------------------------------------------------
-- 1. A oferta
-- ---------------------------------------------------------------------------

CREATE TABLE "offers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "type" text NOT NULL,
  "price_cents" bigint NOT NULL DEFAULT 0,
  "summary" text,
  "cover_url" text,
  -- Fotografia dos blocos (mesma forma de proposal_templates.blocks: array de
  -- blocos com kind/title/body/images/content).
  "blocks" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "public_token" text NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  "published_at" timestamp with time zone,
  "unpublished_at" timestamp with time zone,
  "group_id" uuid REFERENCES "groups"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "offers_title_check" CHECK (char_length(btrim("title")) BETWEEN 1 AND 200),
  CONSTRAINT "offers_type_check" CHECK ("type" IN ('pacote', 'voo', 'hospedagem', 'transfer', 'servico')),
  CONSTRAINT "offers_price_check" CHECK ("price_cents" >= 0),
  CONSTRAINT "offers_blocks_is_array_check" CHECK (jsonb_typeof("blocks") = 'array')
);
--> statement-breakpoint
CREATE INDEX "offers_tenant_created_idx" ON "offers" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX "offers_public_token_key" ON "offers" ("public_token");
--> statement-breakpoint
CREATE INDEX "offers_tenant_published_idx" ON "offers" ("tenant_id", "position")
  WHERE "published_at" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. RLS — isolamento + leitura pública sob o MESMO GUC de /p/ e /r/
-- ---------------------------------------------------------------------------

ALTER TABLE "offers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "offers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "offers_isolation" ON "offers"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- Mesma porta de /p/ e /r/ (0004): SELECT só com o GUC do contexto público E
-- só a oferta publicada. As funções DEFINER abaixo são os únicos caminhos.
CREATE POLICY "offers_public_read" ON "offers"
  FOR SELECT
  USING (
    current_setting('app.proposal_public_context', true) = 'on'
    AND "published_at" IS NOT NULL
    AND "unpublished_at" IS NULL
  );
--> statement-breakpoint
-- A função DEFINER conta os lugares restantes da oferta-grupo: `groups`/`group_members`
-- são FORCE RLS e a vitrine não tem sessão. Mesma porta e mesmo modelo de confiança da
-- `offers_public_read`: o GUC só é ligado dentro das funções DEFINER, e o que chega ao
-- payload público é a CONTAGEM (`lugaresRestantes`), nunca linha de grupo ou nome de
-- membro. Registrada em KNOWN_ESCAPE_HATCHES (tests/security/rls-checks.ts).
CREATE POLICY "groups_public_read" ON "groups"
  FOR SELECT
  USING (current_setting('app.proposal_public_context', true) = 'on');
--> statement-breakpoint
CREATE POLICY "group_members_public_read" ON "group_members"
  FOR SELECT
  USING (current_setting('app.proposal_public_context', true) = 'on');

-- ---------------------------------------------------------------------------
-- 3. As funções públicas — colunas EXPLÍCITAS, sem PII, sem nomes de interessados
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.vitrine_publica(p_slug text)
RETURNS TABLE (payload jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.proposal_public_context', 'on', true);
  -- `tenants` é FORCE RLS e a vitrine resolve o tenant POR SLUG, sem sessão — a
  -- mesma porta do auth-service (`tenants_auth_service`, 0000) que resolve o tenant
  -- do usuário antes de qualquer contexto existir. Alcance mínimo: só leitura da
  -- linha que casa o slug, dentro da função DEFINER.
  PERFORM set_config('app.auth_context', 'on', true);

  RETURN QUERY
  SELECT jsonb_build_object(
    'agencia', (
      SELECT jsonb_build_object(
        'nome', t.name,
        'logo', t.brand_logo_url,
        'instagram', t.instagram,
        'whatsapp', t.whatsapp,
        'agentName', t.agent_display_name
      )
      FROM tenants t
      WHERE t.slug = p_slug
      LIMIT 1
    ),
    'ofertas', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'token', o.public_token,
          'title', o.title,
          'type', o.type,
          'priceCents', o.price_cents,
          'summary', o.summary,
          'coverUrl', o.cover_url,
          'temLugares', o.group_id IS NOT NULL,
          'lugaresRestantes', (
            SELECT COALESCE(g.total_seats, 0) - COALESCE((
              SELECT SUM(m.seats)::int FROM group_members m WHERE m.group_id = o.group_id
            ), 0)
            FROM groups g WHERE g.id = o.group_id
          )
        ) ORDER BY o.position ASC, o.created_at ASC
      )
      FROM offers o
      JOIN tenants t2 ON t2.id = o.tenant_id AND t2.slug = p_slug
      WHERE o.published_at IS NOT NULL AND o.unpublished_at IS NULL
    ), '[]'::jsonb)
  );
END;
$$;
--> statement-breakpoint

CREATE FUNCTION public.oferta_publica(p_slug text, p_token text)
RETURNS TABLE (payload jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.proposal_public_context', 'on', true);
  PERFORM set_config('app.auth_context', 'on', true);

  RETURN QUERY
  SELECT jsonb_build_object(
    'oferta', (
      SELECT jsonb_build_object(
        'id', o.id,
        'token', o.public_token,
        'title', o.title,
        'type', o.type,
        'priceCents', o.price_cents,
        'summary', o.summary,
        'coverUrl', o.cover_url,
        'blocks', o.blocks,
        'temLugares', o.group_id IS NOT NULL,
        'lugaresRestantes', (
          SELECT COALESCE(g.total_seats, 0) - COALESCE((
            SELECT SUM(m.seats)::int FROM group_members m WHERE m.group_id = o.group_id
          ), 0)
          FROM groups g WHERE g.id = o.group_id
        )
      )
      FROM offers o
      JOIN tenants t ON t.id = o.tenant_id AND t.slug = p_slug
      WHERE o.public_token = p_token
        AND o.published_at IS NOT NULL
        AND o.unpublished_at IS NULL
      LIMIT 1
    ),
    'agencia', (
      SELECT jsonb_build_object(
        'nome', t.name,
        'logo', t.brand_logo_url,
        'instagram', t.instagram,
        'whatsapp', t.whatsapp,
        'agentName', t.agent_display_name
      )
      FROM tenants t
      WHERE t.slug = p_slug
      LIMIT 1
    )
  );
END;
$$;
