import { createAuthClient } from 'better-auth/react';
import { magicLinkClient, organizationClient } from 'better-auth/client/plugins';

/**
 * Client de auth para o browser.
 *
 * ATENÇÃO — este arquivo é importado por Client Components. Não pode, em nenhuma
 * hipótese, importar `authDb`, `postgres`, `better-auth/adapters/*`, nem qualquer coisa
 * de `./auth.ts`, `./db.ts` ou `./session.ts` (que puxam a conexão de banco e o segredo
 * `BETTER_AUTH_SECRET`). Se um dia isso vazar para o bundle do cliente, é a chave da casa
 * inteira exposta no DevTools de qualquer visitante.
 *
 * `baseURL`: propositalmente não fixamos um valor. O handler HTTP mora em
 * `/api/auth/[...all]` dentro do MESMO app Next.js que serve este client — então a rota
 * relativa (`/api/auth`, que é o default do `createAuthClient` quando nenhuma
 * `NEXT_PUBLIC_*` de auth está definida) já aponta para o mesmo host que serviu a página,
 * em dev e em produção, sem precisar embutir `BETTER_AUTH_URL` (que é lido só no
 * servidor, em `./auth.ts`) no bundle do browser. As duas URLs — a relativa daqui e a
 * `BETTER_AUTH_URL` absoluta do servidor — resolvem para o mesmo destino porque o app é
 * servido de um único domínio; não há proxy nem subdomínio de API separado no v1.
 */
export const authClient = createAuthClient({
  // `organizationClient` É o par client-side do plugin server de `./auth.ts` — sem ele
  // o `authClient.organization` até FUNCIONA em runtime (o client é proxy dinâmico de
  // rotas), mas não existe em tipo, e a tela não compila contra ele. Fase 3 (§13.2):
  // convite/cancelar/papel/remover são endpoints do plugin, não actions de `@/server`.
  plugins: [magicLinkClient(), organizationClient()],
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
