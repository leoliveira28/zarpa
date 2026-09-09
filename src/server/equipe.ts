'use server';

import { and, desc, eq, gt } from 'drizzle-orm';
import { invitation, member, tenants, user } from '@/db/schema';
import { withTenant } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { comoResultado, type ServiceResult } from './errors';
import { assentosPagosDoTenant } from '@/lib/tenant/assentos';

/**
 * Fase 3 (§3) — contrato da tela Equipe. LEITURA pura: lista membros, convites
 * pendentes e assentos, e diz à tela qual plano está rodando (a Nina usa a flag para
 * esconder com honestidade o que o plano não tem — mesma doutrina de
 * `QuebraPorVendedor` em `money.ts`).
 *
 * Quem CHAMA as mutações: o próprio plugin `organization` via `authClient.organization`
 * (createInvitation/cancelInvitation/updateMember/removeMember) — NÃO existe action
 * própria de convite aqui. Esta action existe para a tela ler tudo que precisa numa
 * chamada só, com `tenantId` da sessão e query dentro de `withTenant`.
 *
 * "Agente" é rótulo de interface sobre `member.role = 'member'` (§3 do doc) — o valor
 * que o banco grava é sempre o nativo do plugin. A tela traduz; esta action devolve o
 * valor cru e o nome do convidante para o histórico.
 */

export type PapelDoMembro = 'owner' | 'admin' | 'member';

export type MembroDaEquipe = {
  /** `member.id` (o id da linhas de membership, não do usuário). */
  memberId: string;
  userId: string;
  name: string | null;
  email: string;
  /** Papel NATIVO do plugin. Rótulo ("Dono", "Agente") é decisão da tela. */
  role: PapelDoMembro;
  memberSince: Date;
};

export type ConviteDaEquipe = {
  invitationId: string;
  email: string;
  role: PapelDoMembro;
  status: 'pending' | 'accepted' | 'rejected' | 'canceled';
  expiresAt: Date;
  createdAt: Date;
  /** Quem convidou — para "Convidado por Ana em 12/08" na lista. */
  inviterName: string | null;
};

export type EquipeResumo = {
  membros: MembroDaEquipe[];
  /** Só os PENDENTES e não vencidos — histórico aceito/recusado não ocupa tela. */
  convitesPendentes: ConviteDaEquipe[];
  assentos: {
    /** `subscriptions.seats_paid` — o que se paga (R$ 39,90 por assento além dos inclusos). */
    pagos: number;
    /** Ocupação real: membros ativos + convites pendentes (o gate conta membros; o convite reserva a vaga na percepção da tela). */
    usados: number;
    /** Inclusos no plano sem custo extra: 3 no Studio, 1 em Solo/Pro (`assentos.ts`). */
    inclusos: number;
  };
  plano: 'solo' | 'pro' | 'studio';
  /** O userId de quem pediu — a tela marca "você" na lista e esconde ação de demissão própria. */
  solicitanteUserId: string;
};

export async function listarEquipe(): Promise<ServiceResult<EquipeResumo>> {
  return comoResultado(async () => {
    const ctx = await requireAuthContext();

    // Assentos vêm de `subscriptions` pelo canal normal de tenant (fora desta transação
    // de propósito: `assentosPagosDoTenant` abre a própria — aninhar `withTenant` não).
    const pagos = await assentosPagosDoTenant(ctx.tenantId);

    return withTenant(ctx.tenantId, async (tx) => {
      const linhasMembros = await tx
        .select({
          memberId: member.id,
          userId: member.userId,
          role: member.role,
          memberSince: member.createdAt,
          name: user.name,
          email: user.email,
        })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .orderBy(desc(member.createdAt));

      const linhasConvites = await tx
        .select({
          invitationId: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
          inviterName: user.name,
        })
        .from(invitation)
        .leftJoin(user, eq(user.id, invitation.inviterId))
        .where(and(eq(invitation.status, 'pending'), gt(invitation.expiresAt, new Date())))
        .orderBy(desc(invitation.createdAt));

      const [tenant] = await tx.select({ plan: tenants.plan }).from(tenants).limit(1);
      const plano = tenant?.plan ?? 'solo';

      return {
        membros: linhasMembros.map((m) => ({
          memberId: m.memberId,
          userId: m.userId,
          name: m.name,
          email: m.email,
          role: m.role as PapelDoMembro,
          memberSince: m.memberSince,
        })),
        convitesPendentes: linhasConvites.map((c) => ({
          invitationId: c.invitationId,
          email: c.email,
          role: c.role as PapelDoMembro,
          status: c.status as ConviteDaEquipe['status'],
          expiresAt: c.expiresAt,
          createdAt: c.createdAt,
          inviterName: c.inviterName,
        })),
        assentos: {
          pagos,
          usados: linhasMembros.length + linhasConvites.length,
          inclusos: plano === 'studio' ? 3 : 1,
        },
        plano,
        solicitanteUserId: ctx.userId,
      };
    });
  });
}
