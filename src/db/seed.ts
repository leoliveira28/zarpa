/**
 * Seed: dois tenants com dados distintos.
 *
 *     node --import ./src/db/_register.mjs --env-file=.env.local src/db/seed.ts
 *
 * É o insumo do teste de isolamento (S1): com `app.tenant_id` do tenant A, nenhuma linha
 * do tenant B pode aparecer. Por isso os dois tenants têm dados com nomes reconhecíveis à
 * vista — "Volta ao Mundo" nunca aparece em consulta da "Maré Alta" e vice-versa.
 *
 * Reparar: TODA escrita aqui passa por `withTenant`. Nem o seed usa o cliente cru para
 * inserir dado de tenant. Se o seed precisasse de atalho para gravar, a policy estaria
 * errada — o seed é o primeiro teste da policy, e ele roda como `zarpa` (NOSUPERUSER,
 * NOBYPASSRLS), igual à aplicação.
 *
 * Idempotente: apaga os dois tenants de demonstração (CASCADE leva o resto junto) antes
 * de recriar. Só apaga o que ele mesmo cria, pelos slugs conhecidos.
 */

import { eq, inArray } from 'drizzle-orm';
import { unsafeDbWithoutTenant, unsafeSqlWithoutTenant } from './client';
import { withTenant } from '../lib/tenant/withTenant';
import { uuidv7 } from './uuid';
import { blindIndex } from '../lib/crypto/keyring';
import {
  activities,
  auditLog,
  contacts,
  deals,
  payments,
  proposalBlocks,
  proposalOptions,
  proposalViews,
  proposals,
  subscriptions,
  tasks,
  tenants,
  travelers,
  user,
} from './schema';

const DEMO_SLUGS = ['volta-ao-mundo', 'mare-alta'];

/** Token de link público. 22 chars base64url ~= 128 bits. Não é sequencial de propósito. */
function publicToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function isoDate(days: number): string {
  return daysFromNow(days).toISOString().slice(0, 10);
}

type TenantSpec = {
  slug: string;
  name: string;
  brandName: string;
  brandPrimaryColor: string;
  plan: 'solo' | 'pro' | 'studio';
  ownerEmail: string;
  ownerName: string;
  document: string;
  contacts: {
    name: string;
    email: string;
    phone: string;
    document: string;
    birthDate: string;
    source: 'whatsapp' | 'instagram' | 'indicacao' | 'site' | 'evento' | 'outro';
    traveler: { fullName: string; cpf: string; passport: string; birthDate: string };
    deal: {
      title: string;
      destination: string;
      stage: 'novo' | 'cotando' | 'proposta_enviada' | 'negociando' | 'ganho' | 'perdido';
      valueCents: number;
      costCents: number;
    };
    proposal?: {
      title: string;
      summary: string;
      options: { name: string; priceCents: number; costCents: number; recommended: boolean }[];
    };
  }[];
};

const TENANT_A: TenantSpec = {
  slug: 'volta-ao-mundo',
  name: 'Volta ao Mundo Viagens',
  brandName: 'Volta ao Mundo',
  brandPrimaryColor: '#12557F',
  plan: 'pro',
  ownerEmail: 'carol@voltaaomundo.test',
  ownerName: 'Carolina Vasques',
  document: '11122233344',
  contacts: [
    {
      name: 'Marcos Aurélio Bittencourt',
      email: 'marcos.bittencourt@exemplo.test',
      phone: '+5511987650001',
      document: '52998224725',
      birthDate: '1979-03-14',
      source: 'indicacao',
      traveler: {
        fullName: 'Marcos Aurélio Bittencourt',
        cpf: '52998224725',
        passport: 'FX884213',
        birthDate: '1979-03-14',
      },
      deal: {
        title: 'Lua de mel na Grécia',
        destination: 'Santorini, Grécia',
        stage: 'proposta_enviada',
        valueCents: 4_280_000,
        costCents: 3_310_000,
      },
      proposal: {
        title: 'Grécia — 12 noites, Atenas + Santorini + Milos',
        summary: 'Três ilhas, voos internos incluídos, hotéis com vista para a caldera.',
        options: [
          { name: 'Essencial', priceCents: 3_890_000, costCents: 3_050_000, recommended: false },
          { name: 'Conforto', priceCents: 4_280_000, costCents: 3_310_000, recommended: true },
          { name: 'Assinatura', priceCents: 5_640_000, costCents: 4_290_000, recommended: false },
        ],
      },
    },
    {
      name: 'Juliana Prates Coutinho',
      email: 'ju.coutinho@exemplo.test',
      phone: '+5511987650002',
      document: '39053344705',
      birthDate: '1991-11-02',
      source: 'instagram',
      traveler: {
        fullName: 'Juliana Prates Coutinho',
        cpf: '39053344705',
        passport: 'GA119027',
        birthDate: '1991-11-02',
      },
      deal: {
        title: 'Réveillon em Buenos Aires',
        destination: 'Buenos Aires, Argentina',
        stage: 'negociando',
        valueCents: 1_190_000,
        costCents: 940_000,
      },
    },
  ],
};

const TENANT_B: TenantSpec = {
  slug: 'mare-alta',
  name: 'Maré Alta Turismo',
  brandName: 'Maré Alta',
  brandPrimaryColor: '#2F7D57',
  plan: 'solo',
  ownerEmail: 'rodrigo@marealta.test',
  ownerName: 'Rodrigo Sanhudo',
  document: '55566677788',
  contacts: [
    {
      name: 'Tereza Nunes de Albuquerque',
      email: 'tereza.albuquerque@exemplo.test',
      phone: '+5581987650003',
      document: '19100000000',
      birthDate: '1965-07-21',
      source: 'whatsapp',
      traveler: {
        fullName: 'Tereza Nunes de Albuquerque',
        cpf: '19100000000',
        passport: 'HB552901',
        birthDate: '1965-07-21',
      },
      deal: {
        title: 'Cruzeiro pelo Caribe',
        destination: 'Caribe — saída de Miami',
        stage: 'ganho',
        valueCents: 2_760_000,
        costCents: 2_180_000,
      },
      proposal: {
        title: 'Caribe — 7 noites, cabine varanda',
        summary: 'Miami, Cozumel, Grand Cayman e Ocho Rios. Aéreo e transfers inclusos.',
        options: [
          { name: 'Cabine interna', priceCents: 2_180_000, costCents: 1_790_000, recommended: false },
          { name: 'Cabine varanda', priceCents: 2_760_000, costCents: 2_180_000, recommended: true },
        ],
      },
    },
    {
      name: 'Wagner D’Ávila Pontes',
      email: 'wagner.pontes@exemplo.test',
      phone: '+5581987650004',
      document: '12345678909',
      birthDate: '1988-01-30',
      source: 'site',
      traveler: {
        fullName: 'Wagner D’Ávila Pontes',
        cpf: '12345678909',
        passport: 'JC730884',
        birthDate: '1988-01-30',
      },
      deal: {
        title: 'Fernando de Noronha em família',
        destination: 'Fernando de Noronha, PE',
        stage: 'cotando',
        valueCents: 1_840_000,
        costCents: 1_520_000,
      },
    },
  ],
};

const PLAN_PRICE_CENTS = { solo: 4_900, pro: 9_900, studio: 19_900 } as const;

async function limparDemo(): Promise<void> {
  // O DELETE em `tenants` é a única operação do seed que NÃO cabe em `withTenant`:
  // são dois tenants diferentes numa tacada, e a policy (corretamente) só deixa apagar
  // o tenant do contexto. Fica explícito no cliente cru — e é por isso que ele tem
  // esse nome. CASCADE das FKs leva contacts, deals, proposals e o resto junto.
  const alvos = await unsafeDbWithoutTenant
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(inArray(tenants.slug, DEMO_SLUGS));

  for (const alvo of alvos) {
    await withTenant(alvo.id, async (tx) => {
      await tx.delete(tenants).where(eq(tenants.id, alvo.id));
    });
    console.log(`[seed] tenant anterior removido: ${alvo.slug}`);
  }
}

async function criarTenant(spec: TenantSpec): Promise<string> {
  // O id nasce aqui, na aplicação: a policy de `tenants` compara `id` com `app.tenant_id`,
  // então precisamos saber o id ANTES do INSERT para poder abrir o contexto.
  const tenantId = uuidv7();

  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: spec.name,
      slug: spec.slug,
      plan: spec.plan,
      status: 'active',
      brandName: spec.brandName,
      brandPrimaryColor: spec.brandPrimaryColor,
      brandSecondaryColor: '#0D1A24',
      contactEmail: spec.ownerEmail,
      whatsapp: spec.contacts[0]?.phone ?? null,
      document: spec.document, // cifrado em trânsito pelo tipo `encryptedText`
      trialEndsAt: daysFromNow(-30),
    });

    const ownerId = `usr_${spec.slug.replace(/-/g, '_')}`;
    await tx.insert(user).values({
      id: ownerId,
      tenantId,
      name: spec.ownerName,
      email: spec.ownerEmail,
      emailVerified: true,
      role: 'owner',
    });

    await tx.insert(subscriptions).values({
      tenantId,
      plan: spec.plan,
      status: 'active',
      amountCents: PLAN_PRICE_CENTS[spec.plan],
      billingCycle: 'monthly',
      currentPeriodStart: isoDate(-5),
      currentPeriodEnd: isoDate(25),
      asaasCustomerId: `cus_demo_${spec.slug}`,
      asaasSubscriptionId: `sub_demo_${spec.slug}`,
    });

    await tx.insert(payments).values({
      tenantId,
      provider: 'asaas',
      asaasPaymentId: `pay_demo_${spec.slug}`,
      amountCents: PLAN_PRICE_CENTS[spec.plan],
      status: 'received',
      method: 'pix',
      dueOn: isoDate(-5),
      paidAt: daysFromNow(-5),
    });

    for (const c of spec.contacts) {
      const [contato] = await tx
        .insert(contacts)
        .values({
          tenantId,
          name: c.name,
          email: c.email,
          phone: c.phone,
          whatsapp: c.phone,
          document: c.document,
          birthDate: c.birthDate,
          source: c.source,
          tags: [spec.brandName.toLowerCase().replace(/\s+/g, '-')],
          notes: `Cliente de ${spec.brandName}.`,
        })
        .returning({ id: contacts.id });

      const contatoId = contato!.id;

      await tx.insert(travelers).values({
        tenantId,
        contactId: contatoId,
        fullName: c.traveler.fullName,
        kind: 'adult',
        cpf: c.traveler.cpf,
        passportNumber: c.traveler.passport,
        passportExpiresOn: isoDate(900),
        birthDate: c.traveler.birthDate,
        nationality: 'BR',
      });

      const [negocio] = await tx
        .insert(deals)
        .values({
          tenantId,
          contactId: contatoId,
          title: c.deal.title,
          destination: c.deal.destination,
          stage: c.deal.stage,
          valueCents: c.deal.valueCents,
          costCents: c.deal.costCents,
          commissionCents: c.deal.valueCents - c.deal.costCents,
          paxAdults: 2,
          departureOn: isoDate(75),
          returnOn: isoDate(87),
          expectedCloseOn: isoDate(12),
          closedAt: c.deal.stage === 'ganho' ? daysFromNow(-2) : null,
        })
        .returning({ id: deals.id });

      const negocioId = negocio!.id;

      await tx.insert(tasks).values({
        tenantId,
        dealId: negocioId,
        contactId: contatoId,
        title: `Retomar contato sobre ${c.deal.destination}`,
        kind: 'whatsapp',
        dueAt: daysFromNow(2),
        createdBy: ownerId,
      });

      await tx.insert(activities).values({
        tenantId,
        dealId: negocioId,
        contactId: contatoId,
        actorUserId: ownerId,
        type: 'contact_created',
        body: `${c.name} entrou pelo canal ${c.source}.`,
        metadata: { source: c.source },
      });

      if (!c.proposal) continue;

      const token = publicToken();
      const [proposta] = await tx
        .insert(proposals)
        .values({
          tenantId,
          dealId: negocioId,
          publicToken: token,
          title: c.proposal.title,
          summary: c.proposal.summary,
          status: 'sent',
          validUntil: isoDate(14),
          brandSnapshot: {
            brandName: spec.brandName,
            primaryColor: spec.brandPrimaryColor,
          },
          terms: 'Valores sujeitos a confirmação de disponibilidade e câmbio do dia.',
          sentAt: daysFromNow(-3),
        })
        .returning({ id: proposals.id });

      const propostaId = proposta!.id;

      const opcoesInseridas = await tx
        .insert(proposalOptions)
        .values(
          c.proposal.options.map((o, i) => ({
            tenantId,
            proposalId: propostaId,
            name: o.name,
            description: `Opção ${o.name} para ${c.deal.destination}.`,
            position: i,
            priceCents: o.priceCents,
            costCents: o.costCents,
            commissionCents: o.priceCents - o.costCents,
            installments: 10,
            installmentCents: Math.round(o.priceCents / 10),
            isRecommended: o.recommended,
          })),
        )
        .returning({ id: proposalOptions.id, isRecommended: proposalOptions.isRecommended });

      const recomendada = opcoesInseridas.find((o) => o.isRecommended) ?? opcoesInseridas[0]!;

      await tx.insert(proposalBlocks).values([
        {
          tenantId,
          proposalId: propostaId,
          optionId: null,
          kind: 'text',
          position: 0,
          title: 'Sobre a viagem',
          body: c.proposal.summary,
        },
        {
          tenantId,
          proposalId: propostaId,
          optionId: recomendada.id,
          kind: 'flight',
          position: 1,
          title: 'Aéreo internacional',
          content: { cia: 'LATAM', bagagem: '1x23kg', escalas: 1 },
        },
        {
          tenantId,
          proposalId: propostaId,
          optionId: recomendada.id,
          kind: 'hotel',
          position: 2,
          title: 'Hospedagem',
          content: { noites: 12, regime: 'café da manhã', categoria: '4 estrelas' },
        },
      ]);

      // Duas aberturas do link — é o dado que alimenta o "seu cliente abriu a proposta".
      await tx.insert(proposalViews).values([
        {
          tenantId,
          proposalId: propostaId,
          sessionKey: `sess_${token.slice(0, 8)}_1`,
          ipHash: blindIndex('203.0.113.10', 'proposal_view_ip'),
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
          referrer: 'https://wa.me/',
          country: 'BR',
          durationMs: 74_000,
          viewedAt: daysFromNow(-2),
        },
        {
          tenantId,
          proposalId: propostaId,
          sessionKey: `sess_${token.slice(0, 8)}_2`,
          ipHash: blindIndex('203.0.113.10', 'proposal_view_ip'),
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
          referrer: null,
          country: 'BR',
          durationMs: 191_000,
          viewedAt: daysFromNow(-1),
        },
      ]);

      await tx
        .update(proposals)
        .set({
          status: 'viewed',
          viewCount: 2,
          firstViewedAt: daysFromNow(-2),
          lastViewedAt: daysFromNow(-1),
        })
        .where(eq(proposals.id, propostaId));

      await tx.insert(activities).values({
        tenantId,
        dealId: negocioId,
        contactId: contatoId,
        proposalId: propostaId,
        actorUserId: ownerId,
        type: 'proposal_viewed',
        body: 'Cliente abriu a proposta pela segunda vez.',
        metadata: { viewCount: 2 },
        occurredAt: daysFromNow(-1),
      });

      await tx.insert(auditLog).values({
        tenantId,
        actorUserId: ownerId,
        action: 'proposal.sent',
        entity: 'proposal',
        entityId: propostaId,
        metadata: { channel: 'whatsapp' },
      });
    }
  });

  console.log(`[seed] tenant criado: ${spec.name} (${tenantId})`);
  return tenantId;
}

async function main(): Promise<void> {
  await limparDemo();

  const tenantAId = await criarTenant(TENANT_A);
  const tenantBId = await criarTenant(TENANT_B);

  // Conferência de sanidade: cada tenant só enxerga o que é dele. Não substitui o teste
  // do Téo, mas se isto falhar não vale a pena nem abrir o psql.
  const contagem = async (tenantId: string) =>
    withTenant(tenantId, async (tx) => ({
      contatos: (await tx.select({ id: contacts.id }).from(contacts)).length,
      negocios: (await tx.select({ id: deals.id }).from(deals)).length,
      propostas: (await tx.select({ id: proposals.id }).from(proposals)).length,
      tenantsVisiveis: (await tx.select({ id: tenants.id }).from(tenants)).length,
    }));

  console.log('[seed] tenant A', tenantAId, await contagem(tenantAId));
  console.log('[seed] tenant B', tenantBId, await contagem(tenantBId));
  console.log('[seed] pronto.');
  console.log(`[seed] TENANT_A_ID=${tenantAId}`);
  console.log(`[seed] TENANT_B_ID=${tenantBId}`);
}

main()
  .catch((error: unknown) => {
    console.error('[seed] erro:', error);
    process.exitCode = 1;
  })
  .finally(() => unsafeSqlWithoutTenant.end());
