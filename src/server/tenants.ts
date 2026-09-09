'use server';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { plans, subscriptions, tenants } from '@/db/schema';
import { withTenant } from '@/lib/tenant/withTenant';
import { authDb } from '@/lib/auth/db';
import { uuidv7 } from '@/db/uuid';
import { requireAuthContext } from '@/lib/auth/session';
import { TERMS_VERSION } from '@/lib/legal/termsVersion';
import { slugificar } from './normalize';
import { registrarAuditoria } from './audit';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { exigirContaAtiva } from './subscriptionGate';
import { semearEstagiosPadrao } from './pipelineStagesDefaults';

const PLAN_PRICE_CENTS = { solo: 4_900, pro: 9_900, studio: 19_900 } as const;

/** Trial do cadastro público (S13a): 14 dias corridos desde o cadastro. */
const DIAS_DE_TRIAL = 14;

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
  instagram: z.string().trim().max(80).optional().or(z.literal('')),
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
  whatsapp: string | null;
  instagram: string | null;
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
          whatsapp: tenants.whatsapp,
          instagram: tenants.instagram,
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
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
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
 * NÃO é Server Action exposta para o usuário final: é função de serviço, chamada pelo
 * fluxo de signup (`src/server/signup.ts`, S13a), que decide o `slug` e cria o usuário
 * logo depois. Está aqui porque só existe um lugar no sistema onde um `tenant_id` novo
 * nasce, e ele deve ser fácil de achar.
 *
 * O id é gerado antes do INSERT porque a policy de `tenants` compara `id` com
 * `app.tenant_id`: sem contexto aberto com o id novo, o próprio INSERT é recusado pelo
 * `WITH CHECK`. Não é obstáculo, é a garantia de que não existe tenant criado fora de
 * contexto.
 *
 * Nasce com assinatura trial (`status: 'trialing'`, `trialEndsAt = agora + 14 dias`) em
 * `tenants` E em `subscriptions` — o gate de dunning (`src/server/subscriptionGate.ts`)
 * avalia a de `subscriptions`; a de `tenants` é a fotografia de estado da conta.
 * `amountCents` vem do catálogo `plans` (S11) e cai para a tabela fixa só se o catálogo
 * estiver vazio — o fallback é rede de segurança, não fonte de verdade. Colisão de
 * `slug` vira `CONFLITO`: quem chama decide se tenta sufixo (`criarConta` tenta) ou
 * devolve o erro para a pessoa escolher outro nome.
 *
 * S13b — consentimento LGPD: `consentimento` (aceite dos Termos de uso e da Política
 * de privacidade, `/termos` e `/privacidade`) nasce AQUI, na mesma transação do tenant,
 * porque consentimento sem conta para anexar não existe. Quem EXIGE o aceite é
 * `criarConta` (única porta pública de nascimento de tenant) — esta função apenas
 * registra o que lhe for dado, e NUNCA inventa: sem `consentimento`, as colunas
 * `terms_accepted_at`/`terms_version` nascem nulas ("sem registro"), que é o valor
 * honesto para tenants criados fora do cadastro público (seed, testes). A versão dos
 * termos vem da constante `TERMS_VERSION` (`src/lib/legal/termsVersion.ts`) e não é
 * parâmetro de quem chama — quem nasce do cadastro público grava a versão vigente,
 * ponto.
 */
export async function criarTenant(dados: {
  name: string;
  slug: string;
  plan?: 'solo' | 'pro' | 'studio';
  contactEmail?: string;
  /** S13b — aceite dos termos no cadastro. Ausente = sem registro, nunca 'aceito'. */
  consentimento?: { aceitoEm: Date };
}): Promise<{ tenantId: string }> {
  const slug = slugificar(dados.slug);

  if (slug.length < 3) {
    throw new ServiceError('DADOS_INVALIDOS', 'O endereço da conta precisa de 3 letras ou mais.', {
      campo: 'slug',
    });
  }

  // `slug` é único global e a checagem precisa enxergar TODOS os tenants — inclusive os
  // que este usuário ainda não tem contexto para ver. Usa `authDb`, NÃO o cliente cru:
  // `tenants` está sob FORCE ROW LEVEL SECURITY e o cliente cru (sem nenhum GUC) devolve
  // ZERO linhas em `tenants`, sempre — o pré-cheque antigo (cliente cru) era código
  // morto, e a colisão só aparecia como erro 23505 cru no INSERT (achado do teste ao
  // vivo desta rodada; o seed documenta o mesmo comportamento em `limparDemo`).
  // `authDb` liga `app.auth_context=on`, que a policy `tenants_auth_service` aceita —
  // é o mesmo canal do login, que também precisa resolver tenant antes de haver sessão.
  // O índice único no banco continua sendo a garantia real contra corrida; a violação
  // que escapar daqui é traduzida logo abaixo.
  const jaExiste = await authDb
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
  const trialEndsAt = new Date(Date.now() + DIAS_DE_TRIAL * 24 * 60 * 60 * 1000);

  try {
    await withTenant(tenantId, async (tx) => {
      // Preço do catálogo (policy `plans_read USING(true)` — leitura liberada em
      // qualquer contexto). Fallback à tabela fixa se o catálogo não tiver o plano.
      const [plano] = await tx
        .select({ id: plans.id, priceCents: plans.priceCents })
        .from(plans)
        .where(and(eq(plans.slug, plan), eq(plans.isActive, true)))
        .limit(1);
      const amountCents = plano?.priceCents ?? PLAN_PRICE_CENTS[plan];

      await tx.insert(tenants).values({
        id: tenantId,
        name: dados.name.trim(),
        slug,
        plan,
        status: 'trialing',
        brandName: dados.name.trim(),
        contactEmail: dados.contactEmail ?? null,
        trialEndsAt,
        // S13b: o par (quando, versão) é a prova do consentimento. A versão não
        // é parâmetro — vem da constante `TERMS_VERSION`, a que estava valendo
        // na página que a pessoa leu. Sem `consentimento`, nulo: sem registro.
        termsAcceptedAt: dados.consentimento?.aceitoEm ?? null,
        termsVersion: dados.consentimento ? TERMS_VERSION : null,
      });

      await tx.insert(subscriptions).values({
        tenantId,
        plan,
        planId: plano?.id ?? null,
        status: 'trialing',
        amountCents,
        billingCycle: 'monthly',
        trialEndsAt,
      });

      // S15: o funil de fábrica nasce junto com o tenant, na MESMA transação. A 0015
      // semeou os tenants que já existiam; daqui para frente é esta linha. Sem ela,
      // tenant novo nasceria sem nenhuma coluna e sem fim de funil — e a invariante
      // "sempre existe um `is_won` e um `is_lost`" começaria quebrada.
      // NÃO liga nada ao quadro atual: `/funil` continua lendo `COLUNAS_DO_FUNIL`.
      await semearEstagiosPadrao(tx, tenantId);

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: null,
        action: 'account.created',
        entity: 'tenant',
        entityId: tenantId,
        metadata: { plano: plan, trialDias: DIAS_DE_TRIAL },
      });

      // S13b: o registro do consentimento é um FATO (aceitou, quando, qual
      // versão) — metadata só leva a versão, nunca conteúdo das páginas nem
      // dado pessoal. Nascido fora do cadastro público (seed, testes), não há
      // consentimento para registrar e esta linha não existe.
      if (dados.consentimento) {
        await registrarAuditoria(tx, {
          tenantId,
          actorUserId: null,
          action: 'consent.recorded',
          entity: 'tenant',
          entityId: tenantId,
          metadata: { termsVersion: TERMS_VERSION },
        });
      }
    });
  } catch (error: unknown) {
    // Corrida: dois cadastros simultâneos passam pelo pré-cheque e um perde o INSERT.
    // Traduz a violação de `tenants_slug_key` para a mesma resposta do pré-cheque —
    // quem chama (`criarConta`) trata as duas igualmente (sufixo numérico).
    if (ehViolacaoDeUnicidade(error)) {
      throw new ServiceError('CONFLITO', 'Esse endereço já está em uso.', {
        campo: 'slug',
        correcao: 'Escolher outro endereço',
      });
    }
    throw error;
  }

  return { tenantId };
}

/**
 * Postgres 23505 = unique_violation.
 *
 * O drizzle-orm (0.45.2) embrulha a falha do driver em `DrizzleQueryError`
 * ("Failed query: insert into ...") e o `PostgresError` original — o único que
 * tem `.code === '23505'` — fica em `error.cause`. Ler só `error.code` devolve
 * `undefined` para toda falha que passar pelo query builder, então percorre-se
 * a cadeia de `cause` procurando o código (limite de 5 níveis, rede de
 * segurança contra cadeia circular). Regressão coberta por
 * `tests/signup/criarconta.test.ts` (corrida real de slug).
 */
function ehViolacaoDeUnicidade(error: unknown): boolean {
  let atual: unknown = error;
  for (let nivel = 0; nivel < 5; nivel += 1) {
    if (!(atual instanceof Error)) return false;
    if ((atual as { code?: unknown }).code === '23505') return true;
    atual = (atual as { cause?: unknown }).cause;
  }
  return false;
}
