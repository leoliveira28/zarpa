-- 0021_roteiro_varios_clientes — o roteiro público diz PARA QUEM é a viagem.
--
-- Complemento da 0020: a proposta pública (`/p/`) já mostra "Preparado para Ana e
-- Carlos"; o roteiro público (`/r/`) ainda congelava `client_name` SINGULAR — a página
-- do roteiro diria só o nome do titular para a mesma viagem do casal. Furo apontado
-- pela nina (`docs/handoffs/nina-para-rafa.md`).
--
-- POR QUE COLUNA CONGELADA (e não join com `deal_contacts` na leitura pública)
-- O roteiro é FOTOGRAFIA do fechado — doutrina da 0013 que vale na íntegra:
-- `blocks_snapshot`/`brand_snapshot`/`client_name`/datas são copiados no momento do
-- `gerarRoteiro`, e a leitura pública NUNCA faz join com `contacts`/`deal_contacts`.
-- `clientes` entra na fotografia do mesmo jeito: lista de NOMES copiada na geração
-- (`src/server/itineraries.ts`), mesma política da proposta — titular primeiro
-- (`principal DESC`), depois a ordem de entrada (`created_at ASC`). Mudar a lista do
-- negócio DEPOIS de gerar não muda o roteiro que o cliente já recebeu — igual a
-- trocar o nome do contato depois não muda `client_name`.
--
-- A PROTEÇÃO DE COLUNA CONTINUA SENDO A LISTA EXPLÍCITA
-- A fonte do congelamento é `deal_contacts ⋈ contacts` e a lista de colunas é
-- EXPLÍCITA (`c.name` só): telefone, e-mail, documento e nascimento de cliente
-- (principal ou secundário) não têm caminho para a coluna, logo não têm caminho para
-- o payload. O scanner (`tests/security/leak-scanner.ts`) varre a resposta inteira com
-- canários plantados nos DOIS contatos.
--
-- NADA DE POLICY NOVA, NADA DE GUC NOVO
-- `roteiro_publica` continua lendo SÓ colunas de snapshot de `itineraries` — a chave
-- nova é uma coluna DELA, não um join. Nenhuma policy a acrescentar em
-- `KNOWN_ESCAPE_HATCHES`; nada a auditar além do que a 0013 já deixou registrado.
--
-- Backfill (mesma técnica da 0016/0020, mesma justificativa): `itineraries` e
-- `deal_contacts` têm FORCE RLS e o role é NOBYPASSRLS — um UPDATE...SELECT
-- atravessando tenants é impossível por construção. A lista de tenants precisa de
-- `app.auth_context`; o GUC do tenant é local à transação e muda a cada volta do laço.
-- COALESCE para `[]`: roteiro de negócio sem linha nenhuma em `deal_contacts` (só
-- possível por escrita fora da aplicação) fica com lista vazia, nunca null. A
-- verificação final roda por tenant e FALLA ALTO se sobrou roteiro com lista vazia
-- tendo clientes no negócio — backfill silencioso é backfill que não aconteceu.

-- ---------------------------------------------------------------------------
-- Coluna
-- ---------------------------------------------------------------------------

ALTER TABLE "itineraries" ADD COLUMN "clientes" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
-- Mesma cerca do `blocks_snapshot`: a coluna é ARRAY de nomes — um objeto ou escalar
-- aqui é bug de escrita, e o CHECK recusa no banco.
ALTER TABLE "itineraries"
  ADD CONSTRAINT "itineraries_clientes_is_array_check" CHECK (jsonb_typeof("clientes") = 'array');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Backfill — fotografar a lista atual para os roteiros JÁ gerados
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_tenants uuid[];
  v_tenant  uuid;
BEGIN
  -- Mesmo canal e mesma justificativa da 0015/0016/0020: `tenants` é FORCE RLS e só
  -- abre por `app.auth_context` — sem ele a lista de tenants é vazia e o backfill
  -- seria um no-op silencioso. Local à transação, apagado no fim.
  PERFORM set_config('app.auth_context', 'on', true);
  SELECT coalesce(array_agg(id), '{}'::uuid[]) INTO v_tenants FROM tenants;

  FOREACH v_tenant IN ARRAY v_tenants LOOP
    PERFORM set_config('app.tenant_id', v_tenant::text, true);

    UPDATE itineraries i
    SET clientes = COALESCE((
      SELECT jsonb_agg(c.name ORDER BY dc.principal DESC, dc.created_at ASC)
      FROM deal_contacts dc
      JOIN contacts c ON c.id = dc.contact_id
      WHERE dc.deal_id = i.deal_id
    ), '[]'::jsonb);
  END LOOP;

  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.auth_context', '', true);
END $$;
--> statement-breakpoint

-- A prova do backfill, por tenant (o dono da tabela SEM `app.tenant_id` não vê linha
-- nenhuma — verificação fora do laço daria um "está tudo certo" FALSO). Se sobrou
-- roteiro com lista vazia num negócio QUE TEM clientes, esta migration falha aqui,
-- alto e claro.
DO $$
DECLARE
  v_tenants uuid[];
  v_tenant  uuid;
  v_faltando integer;
BEGIN
  PERFORM set_config('app.auth_context', 'on', true);
  SELECT coalesce(array_agg(id), '{}'::uuid[]) INTO v_tenants FROM tenants;

  FOREACH v_tenant IN ARRAY v_tenants LOOP
    PERFORM set_config('app.tenant_id', v_tenant::text, true);

    SELECT count(*)::int INTO v_faltando
    FROM itineraries i
    WHERE i.clientes = '[]'::jsonb
      AND EXISTS (
        SELECT 1 FROM deal_contacts dc WHERE dc.deal_id = i.deal_id
      );

    IF v_faltando > 0 THEN
      RAISE EXCEPTION 'backfill 0021: % roteiro(s) do tenant % ficaram com clientes vazia tendo clientes no negócio', v_faltando, v_tenant;
    END IF;
  END LOOP;

  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.auth_context', '', true);
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Função pública — o corpo é o da 0013 COMO EMENDADO pela 0017 (assinatura no
-- `brand` por concatenação condicional); a diferença é UMA chave no payload
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
      -- NOVO (0021): PARA QUEM é a viagem — a mesma lista congelada da proposta
      -- (0020), titular primeiro. Só NOMES: a explicitação acontece na geração
      -- (`gerarRoteiro` copia `c.name`), então a coluna inteira já é publicável por
      -- desenho — o mesmo racional do `client_name` desde a 0013.
      'clientes', i.clientes,
      'currency', i.currency,
      'departureOn', i.departure_on,
      'returnOn', i.return_on,
      'createdAt', i.created_at
    ),
    -- Marca RESHAPED a partir de `brand_snapshot`, nunca repassada cru — `whatsapp` do
    -- snapshot vira `whatsappLink` (`https://wa.me/<dígitos>`): o NOME do campo é de
    -- propósito, o scanner trata "parece telefone" como vazamento e o WhatsApp COMERCIAL
    -- do agente é público por natureza (mesma decisão da `proposta_publica`, 0004).
    -- A assinatura do agente entra por CONCATENAÇÃO condicional (emendo da 0017 — sem
    -- assinatura no snapshot, o objeto é exatamente o de antes dela).
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
-- Neutro de ambiente (mesma justificativa da 0004/0013): o role que conecta é o dono da
-- função e já tem EXECUTE — o grant fica explícito, sem se acoplar a nome de role.
GRANT EXECUTE ON FUNCTION public.roteiro_publica(text) TO current_user;
