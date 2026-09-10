import { sql } from 'drizzle-orm';
import { check, date, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from '../uuid';
import { tenants } from './tenants';
import { deals } from './pipeline';
import { proposals } from './proposals';

/**
 * §4 de `docs/PROPOSTAS_PRODUTO.md` — o roteiro pós-venda: a página pública do roteiro.
 *
 * Depois de aceitar a proposta, o cliente recebia o roteiro como PDF improvisado no
 * WhatsApp — o mesmo desencontro que a proposta veio resolver, repetido na etapa final.
 * O roteiro é a resposta: uma página pública `/r/[token]`, lida sem login via função
 * `SECURITY DEFINER` `public.roteiro_publica(token)` (`drizzle/0013_roteiro_publico.sql`).
 *
 * A regra central: **o roteiro é FOTOGRAFIA do fechado.** Editar a proposta depois NÃO
 * muda o roteiro já gerado —
 * `blocks_snapshot`/`brand_snapshot`/`client_name`/`clientes`/datas são copiados no
 * momento do `gerarRoteiro` (`src/server/itineraries.ts`), não referenciados.
 * Por isso a leitura pública NÃO faz join com `proposals`/`proposal_blocks`/`contacts`/
 * `tenants`: tudo sai das colunas desta tabela, e o que não está aqui não vaza.
 *
 * NUNCA entra no snapshot (nem nesta tabela, nem na resposta pública): custo, comissão,
 * documento de passageiro, contato do cliente além do nome — §4 da spec vale na íntegra,
 * e o scanner de vazamento (`tests/security/leak-scanner.ts`) varre a resposta inteira.
 *
 * A leitura pública segue a MESMA disciplina de `proposta_publica` (0004): a tabela nasce
 * com `FORCE ROW LEVEL SECURITY`, então a função `SECURITY DEFINER` precisa de uma policy
 * de escape hatch (`itineraries_public_read`, GUC `app.roteiro_public_context` ligado
 * APENAS dentro dela) — registrada em `KNOWN_ESCAPE_HATCHES`
 * (`tests/security/rls-checks.ts`), como já foi feito para a proposta e para o webhook.
 */

export const itineraries = pgTable(
  'itineraries',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /**
     * RESTRICT: o roteiro é um documento ENTREGUE ao cliente — apagar o negócio não pode
     * sumir com o link que já foi pelo WhatsApp (mesma doutrina de `sales.deal_id`).
     * Único por negócio: um negócio fechado tem UM roteiro; gerar de novo devolve o que
     * já existe (`gerarRoteiro` é idempotente, garantido pelo índice
     * `itineraries_deal_id_key`, não pela sorte do clique duplo).
     */
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'restrict' }),
    /** RESTRICT pelo mesmo motivo — a origem da fotografia, sobrevive à proposta. */
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'restrict' }),

    /**
     * A chave do link que vai pelo WhatsApp. Único GLOBAL, não por tenant — o token é o
     * segredo, mesma técnica do `proposals.public_token`: 128 bits base64url.
     */
    publicToken: text('public_token').notNull(),

    /** Título congelado (era o título da proposta aceita quando o roteiro foi gerado). */
    title: text('title').notNull(),
    currency: text('currency').notNull().default('BRL'),
    /**
     * Nome do CLIENTE, congelado — o que a página pública mostra. É o ÚNICO dado do
     * contato que sai na superfície pública; e-mail/telefone/CPF do contato ficam
     * FORA de propósito (regra 4 do CLAUDE.md, scanner reprova qualquer um deles).
     */
    clientName: text('client_name').notNull(),
    /**
     * Lista de NOMES de TODOS os clientes do negócio, congelada na geração (0021) —
     * complemento do `client_name` singular desde que um negócio passou a ter vários
     * clientes (0020): a mesma viagem do casal não pode dizer "Preparado para Ana" na
     * proposta e "Preparado para Ana" no roteiro. MESMA POLÍTICA da proposta: titular
     * primeiro (`principal DESC`), depois a ordem de entrada (`created_at ASC`). É
     * FOTOGRAFIA — mudar a lista do negócio depois de gerar não muda o roteiro já
     * entregue (mesmo racional do `client_name`). Só nomes: a explicitação acontece na
     * geração (`gerarRoteiro` copia `c.name`), então telefone/e-mail/documento de
     * principal ou secundário não têm caminho para cá nem para o payload público.
     */
    clientes: jsonb('clientes').$type<string[]>().notNull().default(sql`'[]'::jsonb`),

    /** Datas da viagem, fotografadas do negócio no momento da geração. */
    departureOn: date('departure_on'),
    returnOn: date('return_on'),

    /**
     * Fotografia dos blocos da proposta aceita (apenas os da opção aceita + os da
     * proposta inteira), na forma `BlocoDoRoteiroSnapshot` — `kind`, `position`, `title`,
     * `body`, `images`, `content`. NUNCA os blocos ao vivo, NUNCA `cost_cents`/
     * `commission_cents` (blocos não têm dinheiro; preço é da opção e NÃO vai pro roteiro).
     */
    blocksSnapshot: jsonb('blocks_snapshot').notNull().default(sql`'[]'::jsonb`),

    /**
     * Marca congelada no momento da geração (mesmas chaves de `proposals.brand_snapshot`:
     * `name`, `logoUrl`, `primaryColor`, `secondaryColor`, `whatsapp`, `instagram`). A
     * resposta pública RESHAPEIA (ex.: `whatsapp` → `whatsappLink` pronto para clicar,
     * nunca o número cru) — nunca repassa o jsonb cru, mesmo racional da 0004.
     */
    brandSnapshot: jsonb('brand_snapshot').notNull().default(sql`'{}'::jsonb`),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('itineraries_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    uniqueIndex('itineraries_public_token_key').on(t.publicToken),
    index('itineraries_proposal_id_idx').on(t.proposalId),
    // Um roteiro por negócio — o banco garante a idempotência de `gerarRoteiro`.
    uniqueIndex('itineraries_deal_id_key').on(t.dealId),
    check(
      'itineraries_dates_check',
      sql`${t.returnOn} is null or ${t.departureOn} is null or ${t.returnOn} >= ${t.departureOn}`,
    ),
    check('itineraries_blocks_is_array_check', sql`jsonb_typeof(${t.blocksSnapshot}) = 'array'`),
    check('itineraries_clientes_is_array_check', sql`jsonb_typeof(${t.clientes}) = 'array'`),
  ],
);

export type Itinerary = typeof itineraries.$inferSelect;
export type NewItinerary = typeof itineraries.$inferInsert;
