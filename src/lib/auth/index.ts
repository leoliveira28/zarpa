export { auth, type Auth } from './auth';
export { authDb, authSql } from './db';
export { getAuthContext, requireAuthContext, type AuthContext } from './session';
export { maskEmail } from './delivery';
export { withPendingTenant, pendingTenantId } from './signupContext';

// NÃO reexporte `./client` por aqui. Este barril puxa `./db` (conexão Postgres, segredo
// de banco) e `./auth` (BETTER_AUTH_SECRET) — tudo isso é server-only. Um Client Component
// que importasse `authClient`/`useSession` daqui arrastaria essa cadeia inteira para o
// bundle do browser. O client de auth mora em `./client` e é importado direto de lá:
// `import { authClient, useSession } from '@/lib/auth/client'`.
