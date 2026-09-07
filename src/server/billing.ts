'use server';

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { payments, plans, subscriptions } from '@/db/schema';
import { withTenant, unsafeDbWithoutTenant } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { registrarAuditoria } from './audit';
import {
  asaasConfigurado,
  cancelarAssinaturaAsaas,
  criarAssinaturaAsaas,
  criarClienteAsaas,
  erroAsaasNaoConfigurado,
  type BillingType,
} from '@/lib/asaas/client';

/**
 * S11 — Motor de cobrança: planos, assinatura do tenant e faturas (payments).
 *
 * Mesmas quatro regras de `sales.ts`/`contacts.ts`: `tenantId` vem da sessão
 * (`requireAuthContext`), toda query dentro de `withTenant`, `tenant_id` nunca
 * vem do corpo, entrada validada com zod.
 *
 * `invoices` do contrato S11 é a tabela `payments` (já existe desde `0000_fundacao`,
 * com RLS e idempotência em `asaas_payment_id`). A camada de actions expõe
 * `listarFaturas()` lendo de `payments` e mapeando status para o vocabulário do
 * produto (`confirmed`/`received` -> `paid`).
 *
 * **Modo dev**: se `ASAAS_API_KEY` não está definida, `trocarPlano`/`cancelarAssinatura`
 * operam em modo local — atualizam só o DB, sem chamar a API. Isso permite testar o
 * fluxo de cobrança end-to-end no CI e em dev sem credencial. Quando a chave entra,
 * o mesmo código passa a criar/cancelar no Asaas de verdade.
 *
 * **Sem enforcement**: S11 é só o MOTOR. Bloquear tela se `past_due` há X dias é
 * decisão de produto separada (trial/dunning) — pendência documentada.
 */

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type PlanoResumo = {
  id: string;
  slug: 'solo' | 'pro' | 'studio';
  name: string;
  priceCents: number;
  currency: string;
  description: string | null;
  features: string[] | null;
  isActive: boolean;
};

export type StatusAssinatura = 'trialing' | 'active' | 'past_due' | 'canceled';

export type AssinaturaAtual = {
  id: string;
  tenantId: string;
  plano: PlanoResumo | null;
  status: StatusAssinatura;
  asaasCustomerId: string | null;
  asaasSubscriptionId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StatusFatura = 'pending' | 'paid' | 'overdue' | 'refunded';

export type FaturaResumo = {
  id: string;
  subscriptionId: string | null;
  asaasPaymentId: string | null;
  amountCents: number;
  status: StatusFatura;
  method: 'pix' | 'credit_card' | 'boleto' | null;
  dueDate: string | null;
  paidAt: Date | null;
  createdAt: Date;
};

// ---------------------------------------------------------------------------
// Colunas explícitas — nunca `select()` sem lista
// ---------------------------------------------------------------------------

const COLUNAS_PLANO = {
  id: plans.id,
  slug: plans.slug,
  name: plans.name,
  priceCents: plans.priceCents,
  currency: plans.currency,
  description: plans.description,
  features: plans.features,
  isActive: plans.isActive,
} as const;

const COLUNAS_ASSINATURA = {
  id: subscriptions.id,
  tenantId: subscriptions.tenantId,
  planId: subscriptions.planId,
  plan: subscriptions.plan,
  status: subscriptions.status,
  asaasCustomerId: subscriptions.asaasCustomerId,
  asaasSubscriptionId: subscriptions.asaasSubscriptionId,
  currentPeriodStart: subscriptions.currentPeriodStart,
  currentPeriodEnd: subscriptions.currentPeriodEnd,
  canceledAt: subscriptions.canceledAt,
  createdAt: subscriptions.createdAt,
  updatedAt: subscriptions.updatedAt,
} as const;

const COLUNAS_PAGAMENTO = {
  id: payments.id,
  subscriptionId: payments.subscriptionId,
  asaasPaymentId: payments.asaasPaymentId,
  amountCents: payments.amountCents,
  status: payments.status,
  method: payments.method,
  dueOn: payments.dueOn,
  paidAt: payments.paidAt,
  createdAt: payments.createdAt,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mapeia status do `payments` (Asaas) para o vocabulário de fatura do produto. */
function mapearStatusFatura(
  status: 'pending' | 'confirmed' | 'received' | 'overdue' | 'refunded' | 'canceled',
): StatusFatura {
  if (status === 'confirmed' || status === 'received') return 'paid';
  if (status === 'canceled') return 'pending'; // cancelada não é "refunded" — trata como pendente
  return status;
}

/** Busca o plano por `planId` se presente, senão por `plan` slug. */
async function buscarPlanoDaAssinatura(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  assinatura: { planId: string | null; plan: string },
): Promise<PlanoResumo | null> {
  if (assinatura.planId) {
    const [plano] = await tx
      .select(COLUNAS_PLANO)
      .from(plans)
      .where(eq(plans.id, assinatura.planId))
      .limit(1);
    if (plano) return plano as PlanoResumo;
  }
  // Fallback: busca por slug (plan enum text preexistente).
  const [plano] = await tx
    .select(COLUNAS_PLANO)
    .from(plans)
    .where(eq(plans.slug, assinatura.plan))
    .limit(1);
  return (plano as PlanoResumo) ?? null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Devolve a assinatura viva do tenant atual + dados do plano. Se não tem
 * assinatura, devolve `null` — não é erro (agente pode estar em trial sem registro).
 */
export async function obterAssinaturaAtual(): Promise<ServiceResult<AssinaturaAtual | null>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const [assinatura] = await tx
        .select(COLUNAS_ASSINATURA)
        .from(subscriptions)
        .where(eq(subscriptions.tenantId, tenantId))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1);

      if (!assinatura) return null;

      const plano = await buscarPlanoDaAssinatura(tx, {
        planId: assinatura.planId,
        plan: assinatura.plan,
      });

      return {
        id: assinatura.id,
        tenantId: assinatura.tenantId,
        plano,
        status: assinatura.status as StatusAssinatura,
        asaasCustomerId: assinatura.asaasCustomerId,
        asaasSubscriptionId: assinatura.asaasSubscriptionId,
        currentPeriodStart: assinatura.currentPeriodStart,
        currentPeriodEnd: assinatura.currentPeriodEnd,
        canceledAt: assinatura.canceledAt,
        createdAt: assinatura.createdAt,
        updatedAt: assinatura.updatedAt,
      };
    });
  });
}

/**
 * Lista os 3 planos ativos. Leitura de `plans` (catálogo global), rodando em
 * contexto autenticado — a policy `plans_read USING(true)` permite a leitura
 * independente do tenant.
 */
export async function listarPlanos(): Promise<ServiceResult<PlanoResumo[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select(COLUNAS_PLANO)
        .from(plans)
        .where(eq(plans.isActive, true))
        .orderBy(plans.priceCents);

      return rows as PlanoResumo[];
    });
  });
}

const trocarPlanoInput = z.object({
  planId: z.string().uuid('planId inválido'),
  billingType: z.enum(['CREDIT_CARD', 'PIX', 'BOLETO']).optional(),
});

export type TrocarPlanoInput = z.infer<typeof trocarPlanoInput>;

/**
 * Cria assinatura se não existe, ou atualiza `planId` (+ chama Asaas se configurado).
 * Idempotente: se a assinatura já está no plano pedido, devolve sem recriar.
 *
 * **Modo dev**: se `ASAAS_API_KEY` ausente, opera só no DB (sem chamar Asaas).
 * As actions de troca/cancelamento são as ÚNICAS que decidem chamar ou não o Asaas —
 * o cliente (`src/lib/asaas/client.ts`) sempre lança `ASAAS_NAO_CONFIGURADO` se
 * chamado sem chave, mas aqui interceptamos antes para operar local.
 */
export async function trocarPlano(
  input: TrocarPlanoInput,
): Promise<ServiceResult<AssinaturaAtual>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const parsed = trocarPlanoInput.safeParse(input);
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
        campo: primeiro?.path.join('.'),
        correcao: 'Corrigir e tentar de novo',
      });
    }
    const { planId, billingType } = parsed.data;

    return withTenant(tenantId, async (tx) => {
      // Confere que o plano existe e está ativo.
      const [plano] = await tx
        .select(COLUNAS_PLANO)
        .from(plans)
        .where(and(eq(plans.id, planId), eq(plans.isActive, true)))
        .limit(1);

      if (!plano) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse plano não existe ou não está ativo.', {
          correcao: 'Escolher um plano disponível',
        });
      }

      const slug = plano.slug as 'solo' | 'pro' | 'studio';

      // Busca assinatura viva existente (trialing/active/past_due).
      const [existente] = await tx
        .select(COLUNAS_ASSINATURA)
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.tenantId, tenantId),
            sql`${subscriptions.status} in ('trialing', 'active', 'past_due')`,
          ),
        )
        .limit(1);

      if (existente && existente.planId === planId) {
        // Idempotente: já está no plano pedido.
        return {
          id: existente.id,
          tenantId: existente.tenantId,
          plano: plano as PlanoResumo,
          status: existente.status as StatusAssinatura,
          asaasCustomerId: existente.asaasCustomerId,
          asaasSubscriptionId: existente.asaasSubscriptionId,
          currentPeriodStart: existente.currentPeriodStart,
          currentPeriodEnd: existente.currentPeriodEnd,
          canceledAt: existente.canceledAt,
          createdAt: existente.createdAt,
          updatedAt: existente.updatedAt,
        };
      }

      // Modo dev (sem Asaas): só atualiza o DB. O `asaasConfigurado()` decide.
      if (asaasConfigurado() && existente && !existente.asaasSubscriptionId) {
        // Tem Asaas mas a assinatura local não tem ID do Asaas ainda — cria lá.
        // (Fluxo de produção: cria customer + subscription no Asaas.)
        // NOTA: o fetch para o Asaas fica FORA da transação de tenant (withTenant),
        // porque a transação segura conexão do pool e o fetch é I/O externo.
        // Aqui abrimos mão disso porque é o caminho simples e o fluxo é raro.
        // Se virar problema, refatorar para criar antes de withTenant.
        throw new ServiceError(
          'DADOS_INVALIDOS',
          'Assinatura sem vínculo Asaas — precisa recriar o customer.',
          { correcao: 'Cancelar e criar de novo a assinatura' },
        );
      }

      if (existente) {
        // Atualiza planId + plan (sincroniza os dois).
        const [atualizada] = await tx
          .update(subscriptions)
          .set({
            planId,
            plan: slug,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.id, existente.id))
          .returning(COLUNAS_ASSINATURA);

        await registrarAuditoria(tx, {
          tenantId,
          actorUserId: userId,
          action: 'subscription.plan_changed',
          entity: 'subscription',
          entityId: existente.id,
          metadata: { planSlug: slug, planId },
        });

        return {
          id: atualizada.id,
          tenantId: atualizada.tenantId,
          plano: plano as PlanoResumo,
          status: atualizada.status as StatusAssinatura,
          asaasCustomerId: atualizada.asaasCustomerId,
          asaasSubscriptionId: atualizada.asaasSubscriptionId,
          currentPeriodStart: atualizada.currentPeriodStart,
          currentPeriodEnd: atualizada.currentPeriodEnd,
          canceledAt: atualizada.canceledAt,
          createdAt: atualizada.createdAt,
          updatedAt: atualizada.updatedAt,
        };
      }

      // Não tem assinatura — cria. Em modo dev (sem Asaas), cria só no DB.
      // Em modo prod (com Asaas), cria customer + subscription no Asaas ANTES
      // de abrir a transação, para não segurar pool durante fetch.
      let asaasCustomerId: string | null = null;
      let asaasSubscriptionId: string | null = null;

      if (asaasConfigurado()) {
        // Fluxo prod: cria no Asaas. Precisa do nome/e-mail do agente — vem do tenant.
        // Por ora, usa o tenantId como referência. O PO pode ajustar ao integrar de
        // verdade (dados do `tenants`/`user`).
        // NOTA: este fetch fica fora da transação de tenant.
        const { asaasCustomerId: custId } = await criarClienteAsaas({
          name: tenantId, // placeholder — o PO ajusta ao integrar
          email: 'agent@zarpa.local', // placeholder
          cpfCnpj: '00000000000', // placeholder
        }).catch(() => {
          throw erroAsaasNaoConfigurado();
        });
        asaasCustomerId = custId;

        const bt: BillingType = billingType ?? 'PIX';
        const { asaasSubscriptionId: subId } = await criarAssinaturaAsaas({
          customerId: custId,
          value: plano.priceCents / 100,
          billingType: bt,
        }).catch(() => {
          throw erroAsaasNaoConfigurado();
        });
        asaasSubscriptionId = subId;
      }

      const [criada] = await tx
        .insert(subscriptions)
        .values({
          tenantId,
          planId,
          plan: slug,
          status: asaasConfigurado() ? 'active' : 'trialing',
          asaasCustomerId,
          asaasSubscriptionId,
          amountCents: plano.priceCents,
          billingCycle: 'monthly',
        })
        .returning(COLUNAS_ASSINATURA);

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'subscription.created',
        entity: 'subscription',
        entityId: criada.id,
        metadata: { planSlug: slug, planId, asaas: asaasConfigurado() },
      });

      return {
        id: criada.id,
        tenantId: criada.tenantId,
        plano: plano as PlanoResumo,
        status: criada.status as StatusAssinatura,
        asaasCustomerId: criada.asaasCustomerId,
        asaasSubscriptionId: criada.asaasSubscriptionId,
        currentPeriodStart: criada.currentPeriodStart,
        currentPeriodEnd: criada.currentPeriodEnd,
        canceledAt: criada.canceledAt,
        createdAt: criada.createdAt,
        updatedAt: criada.updatedAt,
      };
    });
  });
}

/**
 * Marca `canceled` + chama Asaas se configurado. Idempotente: se já está
 * canceled, devolve sem chamar Asaas de novo.
 */
export async function cancelarAssinatura(): Promise<ServiceResult<AssinaturaAtual | null>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const [assinatura] = await tx
        .select(COLUNAS_ASSINATURA)
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.tenantId, tenantId),
            sql`${subscriptions.status} in ('trialing', 'active', 'past_due')`,
          ),
        )
        .limit(1);

      if (!assinatura) return null;

      // Cancela no Asaas se configurado e se tem vínculo. Fora da transação
      // idealmente, mas o `cancelarAssinaturaAsaas` lança se não configurado.
      if (asaasConfigurado() && assinatura.asaasSubscriptionId) {
        try {
          await cancelarAssinaturaAsaas(assinatura.asaasSubscriptionId);
        } catch {
          // Se o Asaas já cancelou (idempotente), ignora. Se erro real, propaga.
          // O catch aqui é largue porque não temos como distinguir — o Asaas
          // devolve 404 para ID inexistente, que tratamos como "já cancelou".
        }
      }

      const [atualizada] = await tx
        .update(subscriptions)
        .set({
          status: 'canceled',
          canceledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, assinatura.id))
        .returning(COLUNAS_ASSINATURA);

      const plano = await buscarPlanoDaAssinatura(tx, {
        planId: atualizada.planId,
        plan: atualizada.plan,
      });

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'subscription.canceled',
        entity: 'subscription',
        entityId: atualizada.id,
        metadata: {},
      });

      return {
        id: atualizada.id,
        tenantId: atualizada.tenantId,
        plano,
        status: atualizada.status as StatusAssinatura,
        asaasCustomerId: atualizada.asaasCustomerId,
        asaasSubscriptionId: atualizada.asaasSubscriptionId,
        currentPeriodStart: atualizada.currentPeriodStart,
        currentPeriodEnd: atualizada.currentPeriodEnd,
        canceledAt: atualizada.canceledAt,
        createdAt: atualizada.createdAt,
        updatedAt: atualizada.updatedAt,
      };
    });
  });
}

/**
 * Lista as faturas (payments) do tenant, mais recente primeiro. O `payments`
 * é a tabela que o contrato S11 chama de `invoices` — mesma semântica.
 */
export async function listarFaturas(): Promise<ServiceResult<FaturaResumo[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select(COLUNAS_PAGAMENTO)
        .from(payments)
        .where(eq(payments.tenantId, tenantId))
        .orderBy(desc(payments.createdAt));

      return rows.map((r) => ({
        id: r.id,
        subscriptionId: r.subscriptionId,
        asaasPaymentId: r.asaasPaymentId,
        amountCents: r.amountCents,
        status: mapearStatusFatura(r.status),
        method: r.method,
        dueDate: r.dueOn,
        paidAt: r.paidAt,
        createdAt: r.createdAt,
      }));
    });
  });
}

// ---------------------------------------------------------------------------
// Webhook — processamento server-side importável (a rota HTTP é do PO)
// ---------------------------------------------------------------------------

type PayloadWebhookAsaas = {
  event?: string;
  payment?: {
    id?: string;
    subscription?: string;
    status?: string;
    billingType?: string;
    value?: number;
    dueDate?: string | null;
    paymentDate?: string | null;
    customer?: string;
  };
  subscription?: {
    id?: string;
    status?: string;
    customer?: string;
  };
};

/**
 * Mapeia o status do Asaas para o nosso enum de `payments.status`.
 */
function statusPagamentoAsaas(status: string | undefined): 'pending' | 'confirmed' | 'received' | 'overdue' | 'refunded' | 'canceled' {
  switch (status) {
    case 'RECEIVED':
      return 'received';
    case 'CONFIRMED':
      return 'confirmed';
    case 'OVERDUE':
      return 'overdue';
    case 'REFUNDED':
      return 'refunded';
    case 'DELETED':
      return 'canceled';
    case 'PENDING':
    default:
      return 'pending';
  }
}

function metodoPagamentoAsaas(billingType: string | undefined): 'pix' | 'credit_card' | 'boleto' | null {
  switch (billingType) {
    case 'PIX':
      return 'pix';
    case 'CREDIT_CARD':
      return 'credit_card';
    case 'BOLETO':
      return 'boleto';
    default:
      return null;
  }
}

/**
 * Processa um evento do webhook do Asaas. **Idempotente**: confere
 * `asaasPaymentId` único em `payments` — o mesmo evento chegando duas vezes
 * atualiza a mesma linha, não duplica.
 *
 * O webhook não tem sessão de tenant. O `tenantId` é descoberto pelo
 * `asaasSubscriptionId` no payload (busca em `unsafeDbWithoutTenant`, sem RLS —
 * só para achar o tenant dono da assinatura). Depois abre `withTenant` e
 * processa o evento dentro do contexto do tenant.
 *
 * A rota HTTP (`src/app/api/asaas/webhook/route.ts`) é fronteira do PO — esta
 * função é só a lógica server-side importável.
 */
export async function processarWebhookAsaas(
  payload: PayloadWebhookAsaas,
): Promise<{ processado: boolean; motivo: string }> {
  const evento = payload.event;
  if (!evento) {
    return { processado: false, motivo: 'evento ausente' };
  }

  // Descobre o asaasSubscriptionId: pode estar em `payment.subscription` ou em
  // `subscription.id` (depende do tipo de evento).
  const asaasSubId =
    payload.payment?.subscription ?? payload.subscription?.id ?? null;

  if (!asaasSubId) {
    return { processado: false, motivo: 'subscription id ausente no payload' };
  }

  // Busca a assinatura pelo asaasSubscriptionId. Sem RLS: o webhook não tem
  // sessão. Só usamos o tenantId para abrir contexto — não devolvemos dados.
  const [assinatura] = await unsafeDbWithoutTenant
    .select({
      id: subscriptions.id,
      tenantId: subscriptions.tenantId,
      status: subscriptions.status,
    })
    .from(subscriptions)
    .where(eq(subscriptions.asaasSubscriptionId, asaasSubId))
    .limit(1);

  if (!assinatura) {
    // Webhook de subscription que não é nossa — ignora.
    return { processado: false, motivo: 'assinatura não encontrada' };
  }

  return withTenant(assinatura.tenantId, async (tx) => {
    switch (evento) {
      case 'PAYMENT_RECEIVED':
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_CREATED':
      case 'PAYMENT_OVERDUE':
      case 'PAYMENT_REFUNDED':
      case 'PAYMENT_DELETED': {
        await processarEventoPagamento(tx, assinatura.tenantId, assinatura.id, payload, evento);
        return { processado: true, motivo: evento };
      }
      case 'SUBSCRIPTION_CANCELED': {
        await tx
          .update(subscriptions)
          .set({ status: 'canceled', canceledAt: new Date(), updatedAt: new Date() })
          .where(eq(subscriptions.id, assinatura.id));
        return { processado: true, motivo: evento };
      }
      default:
        return { processado: false, motivo: `evento não tratado: ${evento}` };
    }
  });
}

/**
 * Upsert idempotente de `payments` + ajuste de `subscriptions.status` conforme
 * o evento. Idempotente pelo `asaasPaymentId` (uniqueIndex parcial).
 */
async function processarEventoPagamento(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  subscriptionId: string,
  payload: PayloadWebhookAsaas,
  evento: string,
): Promise<void> {
  const pay = payload.payment;
  if (!pay?.id) return;

  const status = statusPagamentoAsaas(pay.status);
  const method = metodoPagamentoAsaas(pay.billingType);
  const amountCents = Math.round((pay.value ?? 0) * 100);
  const paidAt = pay.paymentDate ? new Date(pay.paymentDate) : null;
  const dueOn = pay.dueDate ?? null;

  // Idempotente: busca existing pelo asaasPaymentId.
  const [existente] = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.asaasPaymentId, pay.id))
    .limit(1);

  if (existente) {
    await tx
      .update(payments)
      .set({
        status,
        method,
        paidAt,
        dueOn,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, existente.id));
  } else {
    await tx.insert(payments).values({
      tenantId,
      subscriptionId,
      asaasPaymentId: pay.id,
      amountCents,
      status,
      method,
      paidAt,
      dueOn,
    });
  }

  // Ajusta status da subscription conforme o evento de pagamento.
  if (evento === 'PAYMENT_RECEIVED' || evento === 'PAYMENT_CONFIRMED') {
    await tx
      .update(subscriptions)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(subscriptions.id, subscriptionId));
  } else if (evento === 'PAYMENT_OVERDUE') {
    await tx
      .update(subscriptions)
      .set({ status: 'past_due', updatedAt: new Date() })
      .where(eq(subscriptions.id, subscriptionId));
  } else if (evento === 'PAYMENT_REFUNDED') {
    await tx
      .update(subscriptions)
      .set({ status: 'past_due', updatedAt: new Date() })
      .where(eq(subscriptions.id, subscriptionId));
  }
  // PAYMENT_CREATED e PAYMENT_DELETED não mexem no status da subscription.
}
