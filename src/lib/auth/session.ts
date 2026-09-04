import { headers } from 'next/headers';
import { auth } from './auth';

/**
 * Contexto de quem está pedindo. É daqui que sai o `tenantId` que vai para `withTenant` —
 * e ele vem da SESSÃO, nunca de parâmetro de rota, header, cookie próprio ou corpo do
 * request. Se um dia um `tenantId` chegar por argumento de Server Action, é bug de
 * segurança, não conveniência.
 */

export type AuthContext = {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
};

export async function getAuthContext(): Promise<AuthContext | null> {
  const result = await auth.api.getSession({ headers: await headers() });
  if (!result?.user) return null;

  // `tenantId` entra em `user` via `additionalFields` no `betterAuth({...})`. O cast
  // existe porque o tipo inferido do Better Auth não propaga campos adicionais para este
  // ponto; a coluna é NOT NULL no banco, então o valor existe.
  const user = result.user as unknown as {
    id: string;
    email: string;
    tenantId?: string;
    role?: string;
  };

  if (!user.tenantId) {
    // Usuário sem tenant não deveria existir (coluna NOT NULL). Se aparecer, é dado
    // corrompido — recusar é mais seguro do que escolher um tenant.
    throw new Error(`Usuário ${user.id} sem tenant_id na sessão. Recusando continuar.`);
  }

  return {
    userId: user.id,
    tenantId: user.tenantId,
    email: user.email,
    role: user.role ?? 'owner',
  };
}

/** Versão que estoura. Use nas Server Actions — não existe ação sem dono. */
export async function requireAuthContext(): Promise<AuthContext> {
  const context = await getAuthContext();
  if (!context) {
    throw new Error('NÃO_AUTENTICADO');
  }
  return context;
}
