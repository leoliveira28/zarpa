import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from '../uuid';
import { encryptedText } from '../../lib/crypto/encryptedColumn';

/**
 * O agente de viagem. Um tenant = uma conta = uma marca.
 *
 * `tenants` é a única tabela sem `tenant_id`: ela É o tenant. A policy de RLS compara
 * `id` com `app.tenant_id`, então criar um tenant exige abrir contexto com o id novo
 * ANTES do INSERT (é o que `withTenant` faz). Isso mata a classe de bug "criei o tenant
 * fora de contexto e agora tem linha órfã que ninguém enxerga".
 */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().$defaultFn(uuidv7),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    plan: text('plan', { enum: ['solo', 'pro', 'studio'] })
      .notNull()
      .default('solo'),
    status: text('status', { enum: ['trialing', 'active', 'past_due', 'canceled'] })
      .notNull()
      .default('trialing'),

    // Marca do agente — é o que aparece na proposta pública.
    brandName: text('brand_name'),
    brandLogoUrl: text('brand_logo_url'),
    brandPrimaryColor: text('brand_primary_color'),
    brandSecondaryColor: text('brand_secondary_color'),

    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    whatsapp: text('whatsapp'),
    /**
     * Instagram do agente (handle ou URL), exibido na proposta pública junto com o resto
     * da marca. Nasce em `0004_proposta_publica`, a mesma migration da função de leitura
     * pública — é o quarto dado de marca que a função devolve (nome, logo, cor, whatsapp,
     * instagram), e não existia coluna nenhuma para ele até aqui.
     */
    instagram: text('instagram'),

    /**
     * Nome do AGENTE para exibição — a segunda metade da assinatura de marca
     * ("[brand_name] · por [agent_display_name]", mais a linha "via {APP_NAME}"). É
     * dado de EXIBIÇÃO, não sensível: sai público na proposta (`/p/`), no roteiro
     * (`/r/`) e no texto de WhatsApp, e por isso é coluna em claro (nada de cifra).
     * Nulo ou '' = assinatura só com `brand_name`. Nasce em
     * `0017_assinatura_do_agente`; quem escreve é `atualizarMarca` (`tenants.ts`),
     * quem congela no snapshot é `enviarProposta` (`proposals.ts`).
     */
    agentDisplayName: text('agent_display_name'),

    /** CPF/CNPJ do próprio agente (MEI). Cifrado como qualquer outro documento. */
    document: encryptedText('document_encrypted'),

    /**
     * Consentimento LGPD (S13b): quando e qual versão dos Termos de uso e da
     * Política de privacidade a agente aceitou no cadastro. Gravados juntos em
     * `criarTenant` — o par (data, versão) é a prova do aceite: sem a versão,
     * um registro de "termos" não aponta para texto nenhum. Versão vem da
     * constante `TERMS_VERSION` (`src/lib/legal/termsVersion.ts`), nunca de
     * quem chama.
     *
     * Anuláveis de propósito: tenants anteriores à `0012_consentimento_de_termos`
     * e os de demonstração do seed não têm consentimento gravado — nulo é o
     * valor honesto ("sem registro"), não "recusou". Só `criarConta` preenche,
     * e só com aceite explícito: não existe caminho que grave data sem versão
     * nem versão sem data.
     */
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
    termsVersion: text('terms_version'),

    locale: text('locale').notNull().default('pt-BR'),
    currency: text('currency').notNull().default('BRL'),
    timezone: text('timezone').notNull().default('America/Sao_Paulo'),

    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tenants_slug_key').on(t.slug),
    check('tenants_plan_check', sql`${t.plan} in ('solo', 'pro', 'studio')`),
    check(
      'tenants_status_check',
      sql`${t.status} in ('trialing', 'active', 'past_due', 'canceled')`,
    ),
  ],
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
