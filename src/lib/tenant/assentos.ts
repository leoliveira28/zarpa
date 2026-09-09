import { desc, eq } from 'drizzle-orm';
import { subscriptions } from '../../db/schema';
import { withTenant } from './withTenant';

/**
 * Contabilidade de assentos (Fase 3 — §2 e §6 de `docs/MULTIUSUARIO_AGENCIAS.md`).
 *
 * Uma régua só, valendo em Pro e Studio: assento extra = R$ 39,90/mês. Solo NÃO tem
 * assento — fica sozinho de propósito (quem precisa de time já é Pro ou Studio).
 *
 * Quem conta é `subscriptions.seats_paid`, e o número é o MESMO para duas coisas:
 *   - o `membershipLimit` dinâmico do plugin `organization` (a lib recusa o convite
 *     N+1 quando o assento N não foi pago — gate de billing de graça);
 *   - o valor total recalculado no cancelar+recriar da assinatura no Asaas
 *     (`alterarAssentos`, `src/server/billing.ts`).
 *
 * Este módulo é `lib`, não `server`, de propósito: o `membershipLimit` é configurado
 * dentro de `src/lib/auth/auth.ts` (camada de baixo não puxa a de cima) e precisa
 * destas contas sem importar uma Server Action.
 */

/** Preço do assento extra: R$ 39,90/mês, em centavos. Uma régua só, nunca duas. */
export const PRECO_ASSENTO_CENTS = 3_990;

/** Assentos INCLUSOS no preço-base do plano. Studio inclui 3 (R$ 199); os demais, 1. */
export function assentosInclusosNoPlano(plano: 'solo' | 'pro' | 'studio'): number {
  return plano === 'studio' ? 3 : 1;
}

/**
 * Valor total mensal do plano + assentos, em centavos: base + (extras × R$ 39,90).
 * Assentos dentro do incluso não mudam o valor — Studio com 2 ou 3 membros paga R$ 199.
 */
export function valorTotalComAssentos(
  plano: 'solo' | 'pro' | 'studio',
  baseCents: number,
  assentos: number,
): number {
  const inclusos = assentosInclusosNoPlano(plano);
  const extras = Math.max(0, assentos - inclusos);
  return baseCents + extras * PRECO_ASSENTO_CENTS;
}

/**
 * Assentos pagos do tenant, lidos de `subscriptions.seats_paid` (a assinatura viva mais
 * recente). Abre contexto de tenant próprio: o `membershipLimit` é chamado pelo plugin
 * FORA de qualquer `withTenant`, e `subscriptions` está sob FORCE RLS — sem o contexto
 * a leitura devolveria zero linhas e o limite viraria 1 para todo mundo.
 *
 * Falha aberta para cima (sem catch): a leitura que faltou não pode virar limite
 * infinito — o pior caso aqui é recusar um convite legítimo, nunca aceitar um ilegítimo.
 */
export async function assentosPagosDoTenant(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const [linha] = await tx
      .select({ seatsPaid: subscriptions.seatsPaid })
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);
    return linha?.seatsPaid ?? 1;
  });
}
