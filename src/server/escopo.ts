import type { TenantScope } from '@/lib/tenant/withTenant';

/**
 * A decisão de escopo, no service layer (Fase 3, §4 de `docs/MULTIUSUARIO_AGENCIAS.md` —
 * nunca no componente de tela, nunca no repositório de query).
 *
 * Hoje o papel chega pela sessão (`user.role`, o legado da 0000: 'owner' | 'agent'):
 * dono vê o tenant inteiro; qualquer outro papel vê só o próprio trabalho. Quando o
 * papel passar a vir do `member` do plugin `organization` (owner/admin/member), é ESTE
 * arquivo o único lugar a mudar — o shape do escopo (`TenantScope`) já está travado em
 * `withTenant.ts`, e nenhuma query das telas precisa saber de onde o papel veio.
 *
 * É arquivo simples (sem `'use server'`) de propósito: Server Action só exporta função
 * assíncrona, e o que se quer aqui é uma função PURA que o Téo consegue testar sem
 * plantar linha nenhuma.
 */
export function escopoDaSessao(ctx: { role: string; userId: string }): TenantScope {
  return ctx.role === 'owner' ? { kind: 'tenant' } : { kind: 'own', userId: ctx.userId };
}
