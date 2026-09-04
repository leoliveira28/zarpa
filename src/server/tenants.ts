'use server';

import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { subscriptions, tenants } from '@/db/schema';
import { withTenant } from '@/lib/tenant/withTenant';
import { unsafeDbWithoutTenant } from '@/db/client';
import { uuidv7 } from '@/db/uuid';
import { requireAuthContext } from '@/lib/auth/session';
import { ServiceError, comoResultado, type ServiceResult } from './errors';

const PLAN_PRICE_CENTS = { solo: 4_900, pro: 9_900, studio: 19_900 } as const;

const marcaInput = z.object({
  brandName: z.string().trim().min(2).max(80).optional(),
  brandLogoUrl: z.url().max(500).optional().or(z.literal('')),
  brandPrimaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Cor precisa estar no formato #RRGGBB')
    .optional(),
  brandSecondaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Cor precisa estar no formato #RRGGBB')
    .optional(),
  whatsapp: z.string().trim().max(32).optional().or(z.literal('')),
  contactEmail: z.email().max(200).optional().or(z.literal('')),
});

export type MarcaInput = z.infer<typeof marcaInput>;

export type TenantAtual = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  brandName: string | null;
  brandLogoUrl: string | null;
  brandPrimaryColor: string | null;
  brandSecondaryColor: string | null;
};

/** Os dados do próprio tenant. `document` fica de fora: é CPF/CNPJ do agente. */
export async function obterTenantAtual(): Promise<ServiceResult<TenantAtual>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const [linha] = await tx
        .select({
          id: tenants.id,
          name: tenants.name,
          slug: tenants.slug,
          plan: tenants.plan,
          status: tenants.status,
          brandName: tenants.brandName,
          brandLogoUrl: tenants.brandLogoUrl,
          brandPrimaryColor: tenants.brandPrimaryColor,
          brandSecondaryColor: tenants.brandSecondaryColor,
        })
        .from(tenants)
        .limit(1);

      // Só existe uma linha visível aqui: a policy compara `id` com o contexto.
      if (!linha) throw new ServiceError('NAO_ENCONTRADO', 'Conta não encontrada.');
      return linha as TenantAtual;
    });
  });
}

export async function atualizarMarca(input: MarcaInput): Promise<ServiceResult<null>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    const parsed = marcaInput.safeParse(input);
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
        campo: primeiro?.path.join('.'),
        correcao: 'Corrigir e salvar de novo',
      });
    }

    await withTenant(tenantId, async (tx) => {
      await tx
        .update(tenants)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(tenants.id, tenantId));
    });

    return null;
  });
}

/**
 * Criação de tenant — o caminho de cadastro.
 *
 * NÃO é Server Action exposta: é função de serviço, chamada pelo fluxo de signup depois
 * de o Better Auth validar o e-mail. Está aqui porque só existe um lugar no sistema onde
 * um `tenant_id` novo nasce, e ele deve ser fácil de achar.
 *
 * O id é gerado antes do INSERT porque a policy de `tenants` compara `id` com
 * `app.tenant_id`: sem contexto aberto com o id novo, o próprio INSERT é recusado pelo
 * `WITH CHECK`. Não é obstáculo, é a garantia de que não existe tenant criado fora de
 * contexto.
 */
export async function criarTenant(dados: {
  name: string;
  slug: string;
  plan?: 'solo' | 'pro' | 'studio';
  contactEmail?: string;
}): Promise<{ tenantId: string }> {
  const slug = dados.slug
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length < 3) {
    throw new ServiceError('DADOS_INVALIDOS', 'O endereço da conta precisa de 3 letras ou mais.', {
      campo: 'slug',
    });
  }

  // `slug` é único global e a checagem precisa enxergar TODOS os tenants — inclusive os
  // que este usuário não pode ver. É um dos poucos usos legítimos do cliente cru: uma
  // leitura de uma coluna não sensível, para dar mensagem melhor que "erro 23505".
  // O índice único no banco continua sendo a garantia real, inclusive contra corrida.
  const jaExiste = await unsafeDbWithoutTenant
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);

  if (jaExiste.length > 0) {
    throw new ServiceError('CONFLITO', 'Esse endereço já está em uso.', {
      campo: 'slug',
      correcao: 'Escolher outro endereço',
    });
  }

  const tenantId = uuidv7();
  const plan = dados.plan ?? 'solo';

  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: dados.name.trim(),
      slug,
      plan,
      status: 'trialing',
      brandName: dados.name.trim(),
      contactEmail: dados.contactEmail ?? null,
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    });

    await tx.insert(subscriptions).values({
      tenantId,
      plan,
      status: 'trialing',
      amountCents: PLAN_PRICE_CENTS[plan],
      billingCycle: 'monthly',
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    });
  });

  return { tenantId };
}
