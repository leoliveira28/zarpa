-- 0013_roteiro_publico — §4 de `docs/PROPOSTAS_PRODUTO.md`: o roteiro pós-venda.
--
-- Depois de aceitar a proposta, o cliente recebia o roteiro como PDF improvisado no
-- WhatsApp. O roteiro é a página pública `/r/[token]` que resolve isso: só blocos, datas,
-- nome do cliente e marca — NUNCA custo, comissão ou documento de passageiro (§4 da spec
-- do produto, regra 4 do CLAUDE.md).
--
-- A tabela nasce com o MESMO desenho de toda tabela de tenant do schema (0000/0007):
-- `ENABLE` + `FORCE ROW LEVEL SECURITY` e policy `USING`+`WITH CHECK` contra
-- `current_setting('app.tenant_id', true)::uuid` NESTA migration (regra 1 do CLAUDE.md).
--
-- A LEITURA PÚBLICA segue a disciplina de `proposta_publica` (0004), que vale na íntegra
-- aqui — leia o comentário de topo daquela migration antes de mexer nesta:
--
--   - `FORCE RLS` significa que a policy vale INCLUSIVE para o dono da tabela, e o dono é
--     o role que conecta (NOBYPASSRLS de propósito). `SECURITY DEFINER` sozinho NÃO abre
--     a tabela — só troca de role e esbarra na mesma policy.
--   - Por isso existe a policy de escape hatch `itineraries_public_read`, que só concede
--     SELECT quando o GUC `app.roteiro_public_context` está ligado. Esse GUC é ligado
--     DENTRO da própria função `roteiro_publica` (`set_config(..., true)`, local à
--     transação) e em NENHUM outro lugar do código. Precisa ser registrada em
--     `KNOWN_ESCAPE_HATCHES` (`tests/security/rls-checks.ts`) — pedido aberto em
--     `docs/handoffs/rafa-para-teo.md`, mesmo fluxo da proposta pública (0004) e do
--     webhook (0010).
--   - A proteção de COLUNA é a lista explícita dentro da função: policy controla LINHA,
--     não coluna. `roteiro_publica` nunca faz `select *` e NUNCA faz join com
--     `proposals`/`proposal_blocks`/`contacts`/`tenants`/`travelers`: TUDO sai das
--     colunas de snapshot desta tabela. O roteiro é fotografia do fechado — editar a
--     proposta depois não muda o roteiro, e o que não está no snapshot nem chega perto
--     da resposta pública.
--   - Ressalva de sempre: GUC é forjável por SQL arbitrário — quem executa SQL arbitrário
--     já forja `app.tenant_id`. O alcance foi mantido mínimo: uma policy, FOR SELECT,
--     numa tabela cujas colunas públicas já são, por desenho, publicáveis.
--
-- Marca: `brand_snapshot` é congelado no `gerarRoteiro` (cópia de `proposals.brand_snapshot`,
-- com fallback para `tenants` quando alguma chave vier vazia) e a função RESHAPEIA —
-- `whatsapp` vira `whatsappLink` (`https://wa.me/<dígitos>`, nome de campo escolhido de
-- propósito para o scanner não confundir com telefone de cliente vazando; ver 0004).

-- ---------------------------------------------------------------------------
-- Tabela
-- ---------------------------------------------------------------------------

CREATE TABLE "itineraries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  -- RESTRICT nos dois: roteiro é documento ENTREGUE ao cliente. Apagar negócio/proposta
  -- que tem roteiro exige apagar o roteiro primeiro — perda de documento entregue não
  -- pode acontecer por cascata silenciosa.
  "deal_id" uuid NOT NULL REFERENCES "deals" ("id") ON DELETE RESTRICT,
  "proposal_id" uuid NOT NULL REFERENCES "proposals" ("id") ON DELETE RESTRICT,
  "public_token" text NOT NULL,
  "title" text NOT NULL,
  "currency" text NOT NULL DEFAULT 'BRL',
  "client_name" text NOT NULL,
  "departure_on" date,
  "return_on" date,
  "blocks_snapshot" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "brand_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "itineraries_dates_check" CHECK (
    "return_on" IS NULL OR "departure_on" IS NULL OR "return_on" >= "departure_on"
  ),
  CONSTRAINT "itineraries_blocks_is_array_check" CHECK (jsonb_typeof("blocks_snapshot") = 'array')
);
--> statement-breakpoint
CREATE INDEX "itineraries_tenant_created_idx" ON "itineraries" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
-- Token único GLOBAL: o token é o segredo, escopo por tenant não faz sentido numa URL
-- sem login (mesma decisão de `proposals_public_token_key`).
CREATE UNIQUE INDEX "itineraries_public_token_key" ON "itineraries" ("public_token");
--> statement-breakpoint
CREATE INDEX "itineraries_proposal_id_idx" ON "itineraries" ("proposal_id");
--> statement-breakpoint
-- Um roteiro por negócio: o banco garante a idempotência de `gerarRoteiro` sob clique
-- duplo/concorrência (mesma doutrina de `sales_proposal_id_key` em 0007).
CREATE UNIQUE INDEX "itineraries_deal_id_key" ON "itineraries" ("deal_id");
--> statement-breakpoint

ALTER TABLE "itineraries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "itineraries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "itineraries_isolation" ON "itineraries"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- Escape hatch da leitura pública — só abre dentro de `roteiro_publica`, que liga o GUC
-- local à transação. REGISTRAR em KNOWN_ESCAPE_HATCHES (tests/security/rls-checks.ts).
CREATE POLICY "itineraries_public_read" ON "itineraries"
  FOR SELECT
  USING (current_setting('app.roteiro_public_context', true) = 'on');
--> statement-breakpoint

-- Explícito e neutro de ambiente: o role que conecta (zarpa local, neondb_owner no Neon)
-- é o dono da tabela e já tem tudo isso; o grant fica como declaração de intenção sem
-- se acoplar a um nome de role que não existe nos dois ambientes.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "itineraries" TO current_user;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Função pública — a leitura sem login.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.roteiro_publica(p_token text)
RETURNS TABLE (payload jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.roteiro_public_context', 'on', true);

  RETURN QUERY
  SELECT jsonb_build_object(
    'roteiro', jsonb_build_object(
      'title', i.title,
      'clientName', i.client_name,
      'currency', i.currency,
      'departureOn', i.departure_on,
      'returnOn', i.return_on,
      'createdAt', i.created_at
    ),
    -- Marca RESHAPED a partir de `brand_snapshot`, nunca repassada cru — `whatsapp` do
    -- snapshot vira `whatsappLink` (`https://wa.me/<dígitos>`): o NOME do campo é de
    -- propósito, o scanner trata "parece telefone" como vazamento e o WhatsApp COMERCIAL
    -- do agente é público por natureza (mesma decisão da `proposta_publica`, 0004).
    'brand', (
      SELECT jsonb_build_object(
        'name', i.brand_snapshot->>'name',
        'logoUrl', i.brand_snapshot->>'logoUrl',
        'primaryColor', i.brand_snapshot->>'primaryColor',
        'secondaryColor', i.brand_snapshot->>'secondaryColor',
        'whatsappLink', CASE
          WHEN nullif(i.brand_snapshot->>'whatsapp', '') IS NULL THEN NULL
          ELSE 'https://wa.me/' || regexp_replace(i.brand_snapshot->>'whatsapp', '\D', '', 'g')
        END,
        'instagram', i.brand_snapshot->>'instagram'
      )
    ),
    -- Os blocos são a FOTOGRAFIA (`blocks_snapshot`), não os blocos ao vivo da proposta —
    -- editar a proposta depois não muda o roteiro. Nada de preço aqui: preço é da opção
    -- (`proposal_options.price_cents`) e NUNCA entrou no snapshot do roteiro.
    'blocks', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'kind', b->>'kind',
            'position', (b->>'position')::int,
            'title', b->>'title',
            'body', b->>'body',
            'images', b->'images',
            'content', b->'content'
          )
          ORDER BY (b->>'position')::int
        ),
        '[]'::jsonb
      )
      FROM jsonb_array_elements(i.blocks_snapshot) AS b
    )
  )
  FROM itineraries i
  WHERE i.public_token = p_token;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.roteiro_publica(text) FROM PUBLIC;
--> statement-breakpoint
-- Neutro de ambiente: o role que conecta é o dono da função e já tem EXECUTE — o grant
-- fica explícito, sem se acoplar a um nome de role (mesmo padrão da 0004).
GRANT EXECUTE ON FUNCTION public.roteiro_publica(text) TO current_user;
