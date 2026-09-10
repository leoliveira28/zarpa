-- 0020_negocio_varios_clientes — UM negócio pode pertencer a MAIS DE UM cliente.
--
-- O PRODUTO
-- Casal, família, amigos: a viagem tem dois CPFs na cabine e um único orçamento. Até
-- aqui o negócio tinha UM cliente (`deals.contact_id`), e a agente que vendia para um
-- casal cadastrava "Maria (e João)" no nome — o que estraga busca, ficha 360°, ranking
-- e o "Preparado para" da proposta pública. A fonte de verdade passa a ser a N:N
-- `deal_contacts`; o "adicionar cliente" dos editores de proposta e de negócio grava
-- nela (contrato em `docs/handoffs/rafa-para-nina.md` §15).
--
-- O QUE NÃO MUDA (decisão travada, não rediscutir)
-- `deals.contact_id` continua sendo o cliente PRINCIPAL e é IMUTÁVEL nesta rodada:
-- relatórios, ranking, escopo e recompra continuam lendo por ele. Secundários entram e
-- saem por aqui; o principal não. A tabela nasce com essa hierarquia dentro:
-- `principal boolean` marca a linha do contato principal, e o partial unique index
-- garante NO BANCO (não na aplicação) que existe NO MÁXIMO uma por negócio — o mesmo
-- "aplicação cai, índice não" do `is_default` da 0018. O backfill planta essa linha
-- para todo negócio existente, e `criarNegocio` (`src/server/deals.ts`) passa a plantar
-- no nascimento: depois desta migration, TODO negócio tem exatamente uma linha
-- `principal = true` que espelha `deals.contact_id`.
--
-- POR QUE A TABELA TEM PK COMPOSTA (e não `id` de sabor da casa)
-- A chave REAL da relação é `(deal_id, contact_id)` — o unique pedido é o próprio
-- conteúdo da linha. Um `id uuid` paralelo seria um segundo candidato a identidade
-- sem nenhum consumidor, e o índice único de (deal_id, contact_id) teria que existir
-- do mesmo jeito. PK composta resolve os dois com um índice só: unicidade, busca por
-- negócio (o lado quente — a lista de clientes de UM negócio) e a checagem de RI da
-- FK de `deal_id` (CASCADE varre por aqui). `contact_id` ganha índice próprio (RESTRICT
-- varre por ele; e é a pergunta inversa, "em que negócios este cliente está").
--
-- FKs, cada uma com a semântica de casa:
--   - `deal_id` → `deals` ON DELETE CASCADE: a lista de clientes É do negócio; apagar
--     o negócio apaga a lista (não existe linha órfã de ligação para preservar).
--   - `contact_id` → `contacts` ON DELETE RESTRICT: mesma doutrina de
--     `deals.contact_id` — apagar contato não pode sumir com a composição de um
--     negócio (que virou histórico de venda). O banco recusa; a UI resolve antes.
--   - `tenant_id` → `tenants` ON DELETE CASCADE: o padrão de toda tabela de tenant.
--
-- RLS: ENABLE + FORCE + policy `deal_contacts_isolation` NA MESMA migration (regra 1,
-- sem exceção), USING e WITH CHECK contra `current_setting('app.tenant_id', true)` —
-- o padrão de `proposal_templates_isolation`/0018. Sem policy nova de escape hatch,
-- sem GUC novo: nada a acrescentar em `KNOWN_ESCAPE_HATCHES`.
--
-- Backfill (mesma técnica da 0016, mesma justificativa): `deals` e a tabela nova têm
-- FORCE RLS e o role é NOBYPASSRLS — um INSERT...SELECT atravessando tenants é
-- impossível por construção. A lista de tenants precisa de `app.auth_context` (sem ele
-- o SELECT em `tenants` devolve zero linhas, silencioso). Os ids são materializados em
-- array ANTES do laço porque o GUC muda a cada volta. `created_at` herdado do negócio:
-- a ordem de entrada é o que a lista pública e a ficha usam para ordenar secundários.
-- A verificação final roda por tenant e FALLA ALTO se sobrou negócio sem linha
-- principal — backfill silencioso é backfill que não aconteceu.

-- ---------------------------------------------------------------------------
-- Tabela
-- ---------------------------------------------------------------------------

CREATE TABLE "deal_contacts" (
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
  "deal_id" uuid NOT NULL REFERENCES "deals" ("id") ON DELETE CASCADE,
  "contact_id" uuid NOT NULL REFERENCES "contacts" ("id") ON DELETE RESTRICT,
  -- A linha do `deals.contact_id`. Imutável nesta rodada: trocar o cliente principal
  -- é decisão de produto que ainda não existe (relatórios e ranking dependem dele).
  "principal" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  -- A invariante que o produto pediu: o mesmo cliente não entra duas vezes no mesmo
  -- negócio. É a PK — recusar duplicado acontece no BANCO (a action devolve CONFLITO
  -- lendo antes, mas quem garante é aqui).
  CONSTRAINT "deal_contacts_deal_contact_pk" PRIMARY KEY ("deal_id", "contact_id")
);
--> statement-breakpoint

CREATE INDEX "deal_contacts_contact_id_idx" ON "deal_contacts" ("contact_id");
--> statement-breakpoint
-- NO MÁXIMO UMA linha principal por negócio. Parcial: só as linhas que SÃO principal
-- disputam a vaga — o partial unique é o cinto de segurança do espelho de
-- `deals.contact_id` caso um caminho futuro esqueça a regra.
CREATE UNIQUE INDEX "deal_contacts_deal_principal_key" ON "deal_contacts" ("deal_id") WHERE "principal";
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS — na mesma migration, ENABLE + FORCE + policy com USING e WITH CHECK
-- ---------------------------------------------------------------------------

ALTER TABLE "deal_contacts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "deal_contacts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "deal_contacts_isolation" ON "deal_contacts"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Backfill — uma linha principal por negócio existente, a partir de deals.contact_id
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_tenants uuid[];
  v_tenant  uuid;
BEGIN
  -- Mesmo canal e mesma justificativa da 0015/0016: `tenants` é FORCE RLS e só abre
  -- por `app.auth_context` — sem ele a lista de tenants é vazia e o backfill seria um
  -- no-op silencioso. Local à transação, apagado no fim.
  PERFORM set_config('app.auth_context', 'on', true);
  SELECT coalesce(array_agg(id), '{}'::uuid[]) INTO v_tenants FROM tenants;

  FOREACH v_tenant IN ARRAY v_tenants LOOP
    PERFORM set_config('app.tenant_id', v_tenant::text, true);

    INSERT INTO deal_contacts ("tenant_id", "deal_id", "contact_id", "principal", "created_at")
    SELECT d.tenant_id, d.id, d.contact_id, true, d.created_at
    FROM deals d
    ON CONFLICT DO NOTHING;
  END LOOP;

  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.auth_context', '', true);
END $$;
--> statement-breakpoint

-- A prova do backfill, por tenant (o dono da tabela SEM `app.tenant_id` não vê linha
-- nenhuma — um SELECT de verificação fora do laço daria um "está tudo certo" FALSO).
-- Se sobrou negócio sem linha principal, esta migration falha aqui, alto e claro.
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
    FROM deals d
    WHERE NOT EXISTS (
      SELECT 1 FROM deal_contacts dc
      WHERE dc.deal_id = d.id AND dc.principal
    );

    IF v_faltando > 0 THEN
      RAISE EXCEPTION 'backfill 0020: % negócio(s) do tenant % ficaram sem linha principal em deal_contacts', v_faltando, v_tenant;
    END IF;
  END LOOP;

  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.auth_context', '', true);
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A página pública passa a dizer PARA QUEM é a viagem — "Preparado para Ana e Carlos"
-- ---------------------------------------------------------------------------
--
-- `proposta_publica` (0004, emendada pela 0017) ganha a chave `clientes`: a LISTA DE
-- NOMES dos clientes do negócio, principal primeiro. NUNCA MAIS QUE NOME — a fonte é
-- `deal_contacts ⋈ contacts` e a lista de colunas é EXPLÍCITA (`c.name` só): telefone,
-- e-mail, documento e nascimento de cliente (principal ou secundário) não têm caminho
-- para o payload. O teste que prova é o scanner (`tests/security/`), que varre o
-- payload inteiro com canários plantados nos dois contatos.
--
-- COMO A FUNÇÃO LÊ `deal_contacts` SEM POLICY PÚBLICA NOVA (a decisão desta migration)
-- A função é SECURITY DEFINER, mas o role é NOBYPASSRLS e `deal_contacts` é FORCE RLS
-- com UMA policy só — a de isolation por `app.tenant_id`. "Definer sozinho" não abre
-- tabela (o desenho inteiro da 0004 existe por causa disso), e criar uma
-- `deal_contacts_public_read` amarrada ao GUC `app.proposal_public_context` seria uma
-- PORTA nova numa tabela que liga clientes a negócios — alcance maior do que o produto
-- pede, e mais uma linha de allowlist para alguém auditar para sempre. Em vez disso, a
-- função descobre o tenant DA PROPOSTA que já resolveu e faz
-- `set_config('app.tenant_id', ..., true)` — LOCAL à transação — e lê os nomes PELA
-- policy normal de isolation. Três propriedades:
--
--   1. O alcance é o mínimo possível: o contexto vale dentro desta função, para o
--      tenant da proposta resolvida pelo slug anônimo, e morre no fim do statement
--      (`true` = local à transação; o chamador público roda uma única instrução em
--      autocommit). O slug é o único insumo do chamador — o tenant NÃO vem de fora.
--   2. Nenhuma porta nova: quem forjar `app.proposal_public_context` ganha proposta/
--      opções/blocos, como antes — `deal_contacts` continua fechada para esse GUC. E
--      forjar `app.tenant_id` já é o risco estrutural de sempre (quem executa SQL
--      arbitrário), e esta função não muda nada nisso.
--   3. A lista de colunas continua sendo a proteção de COLUNA: a policy controla LINHA
--      (tenant), a lista explícita do SELECT controla COLUNA (nome) — a mesma divisão
--      de trabalho da 0004.
--
-- O corpo é o da 0017; as diferenças são três: `v_deal_id`/`v_tenant_id` resolvidos
-- junto do id, o `set_config` do tenant depois da guarda de rascunho, e a chave
-- `clientes` no payload (COALESCE para `[]`: negócio sem linha nenhuma — só possível
-- por escrita fora da aplicação — devolve lista vazia, nunca null).

CREATE OR REPLACE FUNCTION public.proposta_publica(p_slug text)
RETURNS TABLE (payload jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_proposal_id uuid;
  v_deal_id uuid;
  v_tenant_id uuid;
BEGIN
  PERFORM set_config('app.proposal_public_context', 'on', true);

  SELECT p.id, p.deal_id, p.tenant_id
    INTO v_proposal_id, v_deal_id, v_tenant_id
  FROM proposals p
  WHERE p.public_token = p_slug
    AND p.status <> 'draft'
    AND p.sent_at IS NOT NULL
    AND p.archived_at IS NULL
  LIMIT 1;

  IF v_proposal_id IS NULL THEN
    RETURN;
  END IF;

  -- O contexto de tenant do DONO da proposta, local a esta transação: é o que deixa a
  -- leitura de `deal_contacts`/`contacts` passar pela policy normal de isolation, sem
  -- policy pública nova (ver o comentário de topo). NOME nunca foi PII que o cliente
  -- não saiba — ele está na conversa do WhatsApp; telefone/e-mail/documento não saem.
  PERFORM set_config('app.tenant_id', v_tenant_id::text, true);

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
    ),
    -- NOVO (0020): PARA QUEM é a viagem. Só `c.name` — a explicitação da coluna é a
    -- proteção; telefone/e-mail/documento de cliente principal ou secundário não
    -- existem nesta chave. Principal primeiro (`principal DESC`), depois a ordem em
    -- que cada cliente entrou (`created_at ASC`), que é a ordem em que a agente
    -- adicionou.
    'clientes', (
      SELECT COALESCE(
        jsonb_agg(c.name ORDER BY dc.principal DESC, dc.created_at ASC),
        '[]'::jsonb
      )
      FROM deal_contacts dc
      JOIN contacts c ON c.id = dc.contact_id
      WHERE dc.deal_id = v_deal_id
    )
  );
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.proposta_publica(text) FROM PUBLIC;
--> statement-breakpoint
-- Neutro de ambiente (mesma justificativa da 0004/0017): o role que conecta é o dono da
-- função e já tem EXECUTE — o grant fica explícito, sem se acoplar a nome de role.
GRANT EXECUTE ON FUNCTION public.proposta_publica(text) TO current_user;
