-- 0017_assinatura_do_agente — a assinatura de marca nas comunicações da ponta.
--
-- O PRODUTO
-- Toda comunicação que chega ao cliente final assina em duas linhas:
--
--   [Nome da agência] · por [Nome do agente]
--   via {APP_NAME}
--
-- O nome da agência já existia (`tenants.brand_name`). O nome do AGENTE não — é a
-- coluna que esta migration cria: `tenants.agent_display_name text`, anulável. Nulo ou
-- `''` significa "assinatura só com brand_name"; não existe estado inválido. É dado de
-- EXIBIÇÃO (nada de cifra, nada de CHECK de formato — quem valida é o zod de
-- `atualizarMarca`, máx. 80, trim), e sai público por desenho: proposta `/p/`, roteiro
-- `/r/` e texto de WhatsApp. Quem escreve é `atualizarMarca` (`src/server/tenants.ts`,
-- a tela "Sua marca"); quem congela no snapshot é `enviarProposta`
-- (`src/server/proposals.ts`).
--
-- A ASSINATURA NA PONTA (as duas funções OR REPLACE)
-- As duas leituras públicas — `proposta_publica` (0004, intocada desde então) e
-- `roteiro_publica` (0013) — passam a devolver `brand.agentDisplayName` junto da marca.
-- `CREATE OR REPLACE` NUMA migration NOVA, nunca edição de migration antiga (o mesmo
-- que a 0014 fez com `registrar_visita_proposta`): assinatura, retorno e grants são os
-- mesmos; só o corpo do `brand` muda.
--
-- A AUDITORIA (o limite do que sai pelo portão público NÃO se move)
-- As duas funções expõem EXATAMENTE: name, logoUrl, primaryColor, secondaryColor,
-- whatsappLink, instagram — e agora agentDisplayName. Nada mais: continuam sem `select *`,
-- sem JOIN com `tenants`/`contacts`/`travelers` (a marca vem do SNAPSHOT, não do
-- cadastro ao vivo), sem custo/comissão/PII de passageiro. Nenhuma tabela nova, nenhuma
-- policy nova, NENHUM GUC novo — logo, nada a acrescentar em `KNOWN_ESCAPE_HATCHES`. A
-- coluna nova segue a linha que o RLS de `tenants` já cerca (RLS é da tabela, não da
-- coluna).
--
-- POR QUE A CHAVE NOVA SAI SÓ QUANDO HÁ ASSINATURA (jsonb `||` condicional)
-- Duas razões, as duas boas por si:
--
--   1. FOTOGRAFIA: `brand_snapshot` é congelado no envio (proposta) e na geração
--      (roteiro). Proposta/roteiro entregues ANTES de o agente configurar o nome não
--      têm a assinatura — e com a emissão condicional o payload deles fica BYTE a BYTE
--      igual ao de hoje: link que já foi pelo WhatsApp não muda de cara por causa desta
--      migration. A chave aparece quando a assinatura existe no snapshot, e o
--      `enviarProposta`/`gerarRoteiro` passam a levá-la.
--   2. O portão de forma do Téo (`tests/security/public-roteiro.test.ts`) fixa em
--      whitelist EXATA as chaves de `brand` — é ele fazendo o trabalho dele: toda
--      mudança de contrato público é obrigada a ser consciente. Com a emissão
--      condicional, o caso "sem assinatura" continua batendo na whitelist dele; o caso
--      "com assinatura" é fixado no teste novo desta rodada
--      (`tests/brand/assinatura.test.ts`). Pedido aberto em
--      `docs/handoffs/rafa-para-teo.md` para ele decidir se fixa também o caso novo.
--
-- Consequência de contrato para quem consome (`PropostaPublicaBrand`):
-- `agentDisplayName?: string | null` — AUSENTE ou nulo = assinatura só com brand_name.
-- O helper `src/lib/assinatura.ts` trata os dois do mesmo jeito; ninguém precisa
-- distinguir.

-- ---------------------------------------------------------------------------
-- Coluna
-- ---------------------------------------------------------------------------

ALTER TABLE "tenants" ADD COLUMN "agent_display_name" text;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Função 1 — leitura pública da proposta. Corpo idêntico ao da 0004; a única
-- diferença é o `|| CASE ... END` que anexa `agentDisplayName` ao `brand` QUANDO o
-- snapshot o tem. Sem JOIN novo: `brand_snapshot` continua sendo a fonte única.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.proposta_publica(p_slug text)
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
    -- `brand` é RESHAPED explicitamente a partir de `brand_snapshot`, nunca repassado cru
    -- (mesma disciplina da 0004 — leia o comentário dela para o porquê do nome
    -- `whatsappLink`). A assinatura do agente entra por CONCATENAÇÃO condicional: sem
    -- assinatura no snapshot, o objeto é exatamente o de antes da 0017.
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
      || CASE
           WHEN nullif(p.brand_snapshot->>'agentDisplayName', '') IS NULL THEN '{}'::jsonb
           ELSE jsonb_build_object('agentDisplayName', p.brand_snapshot->>'agentDisplayName')
         END
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
-- Neutro de ambiente (mesma justificativa da 0004): o role que conecta é o dono da
-- função e já tem EXECUTE — o grant fica explícito, sem se acoplar a nome de role.
GRANT EXECUTE ON FUNCTION public.proposta_publica(text) TO current_user;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Função 2 — leitura pública do roteiro. Corpo idêntico ao da 0013; mesma
-- concatenação condicional no `brand`, a partir de `itineraries.brand_snapshot`.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.roteiro_publica(p_token text)
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
    -- Marca RESHAPED a partir de `brand_snapshot`, nunca crua (`whatsapp` vira
    -- `whatsappLink`; ver 0004/0013). Assinatura por concatenação condicional, como na
    -- `proposta_publica` acima.
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
      || CASE
           WHEN nullif(i.brand_snapshot->>'agentDisplayName', '') IS NULL THEN '{}'::jsonb
           ELSE jsonb_build_object('agentDisplayName', i.brand_snapshot->>'agentDisplayName')
         END
    ),
    -- Os blocos são a FOTOGRAFIA (`blocks_snapshot`), não os blocos ao vivo — e nada de
    -- preço aqui (preço é da opção e nunca entrou no snapshot do roteiro).
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
GRANT EXECUTE ON FUNCTION public.roteiro_publica(text) TO current_user;
