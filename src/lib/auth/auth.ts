import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins/magic-link';
import { account, session, user, verification } from '@/db/schema';
import { requiredEnv } from '@/db/env';
import { authDb } from './db';
import { deliverMagicLink } from './delivery';
import { pendingTenantId } from './signupContext';

/**
 * Better Auth, auto-hospedado no mesmo Postgres (decisão travada no CLAUDE.md).
 *
 * Dois caminhos de entrada:
 *   - magic link, que é o caminho principal para quem vende do celular e não quer
 *     lembrar de senha;
 *   - e-mail + senha, para quem prefere.
 *
 * Todo usuário nasce amarrado a um `tenant_id`. Isso NÃO é opcional: `user.tenant_id` é
 * `NOT NULL` no banco, `input: false` no campo adicional impede que o valor chegue pelo
 * corpo da requisição, e o `defaultValue` do campo (ver abaixo) é quem de fato o
 * preenche, lendo de `signupContext.ts` — nunca da requisição. Quem cria tenant é
 * `src/server/signup.ts` (a via de produção) ou `src/db/seed.ts` (dev), que geram o
 * tenant antes e chamam `withPendingTenant` ao redor de `signUpEmail`. Se alguém
 * conseguisse mandar `tenantId` no JSON de cadastro, criaria usuário dentro do tenant dos
 * outros — e o RLS não salvaria, porque a linha teria nascido com o `tenant_id` da
 * vítima.
 *
 * O adapter usa `authDb` (ver `db.ts`), a conexão com `app.auth_context=on`. É a única
 * que enxerga as tabelas de credencial.
 */

const secret = process.env.BETTER_AUTH_SECRET ?? '';
const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';

export const auth = betterAuth({
  appName: process.env.APP_NAME ?? 'Zarpa',
  secret: secret || requiredEnv('BETTER_AUTH_SECRET'),
  baseURL,

  database: drizzleAdapter(authDb, {
    provider: 'pg',
    // As chaves do objeto de schema do Drizzle são camelCase (emailVerified, userId…),
    // enquanto as colunas no banco são snake_case. Este flag diz respeito às chaves.
    camelCase: true,
    schema: { user, session, account, verification },
  }),

  emailAndPassword: {
    enabled: true,
    // 8 é o piso do NIST; a força real vem do rate limit e do magic link, não de exigir
    // caractere especial (que só produz senha anotada em papel).
    minPasswordLength: 8,
    requireEmailVerification: false,
  },

  user: {
    additionalFields: {
      tenantId: {
        type: 'string',
        required: true,
        // NUNCA aceitar este campo vindo da requisição: com `input: false`, se o corpo
        // da requisição trouxer `tenantId` o parser do Better Auth rejeita com
        // "tenantId is not allowed to be set" antes de chegar perto do INSERT.
        //
        // Mas `required: true` sem um jeito de preencher o campo também rejeitaria toda
        // criação de usuário com "tenantId is required" — pego em teste ao rodar o seed.
        // `defaultValue` é o mecanismo do próprio Better Auth para isso: só é consultado
        // quando o campo NÃO veio no corpo (exatamente o caso normal, já que é
        // `input: false`), e pode ser uma função. Aqui ela lê de `signupContext.ts`, um
        // `AsyncLocalStorage` que só código de servidor consegue preencher
        // (`withPendingTenant`) — nunca um header, cookie ou campo de JSON.
        defaultValue: () => {
          const tenantId = pendingTenantId();
          if (!tenantId) {
            throw new Error(
              'Criação de usuário sem withPendingTenant() no contexto. Todo cadastro ' +
                'precisa de um tenant decidido pelo servidor ANTES de chamar signUpEmail ' +
                '— nunca a partir de um campo da requisição.',
            );
          }
          return tenantId;
        },
        input: false,
      },
      role: {
        type: 'string',
        required: false,
        defaultValue: 'owner',
        input: false,
      },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 dias — o agente vende do celular, não quer relogar
    updateAge: 60 * 60 * 24, // renova no máximo uma vez por dia
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },

  databaseHooks: {
    user: {
      create: {
        // Defesa em profundidade: o `defaultValue` de `tenantId` acima é quem
        // efetivamente preenche o campo, mas se algum caminho de criação de usuário no
        // futuro (OAuth, plugin de admin, ...) não passar pelo parser de campo do Better
        // Auth, este hook garante que a linha nunca é gravada sem tenant. `user_tenant_id
        // NOT NULL` no banco pegaria de qualquer forma, mas um erro claro aqui é melhor
        // que estourar constraint no Postgres.
        before: async (userData) => {
          if (!userData.tenantId) {
            throw new Error(
              'Tentativa de criar usuário sem tenant_id. Recusando — ver withPendingTenant ' +
                'em signupContext.ts.',
            );
          }
        },
      },
    },
  },

  advanced: {
    // O id é gerado pelo Better Auth (text). As tabelas de domínio usam uuid v7 próprio.
    cookiePrefix: 'zarpa',
    useSecureCookies: process.env.NODE_ENV === 'production',
  },

  plugins: [
    magicLink({
      expiresIn: 60 * 10, // 10 minutos
      // Não criar conta a partir de um link enviado para e-mail arbitrário: cadastro
      // passa por `signup`, que também cria o tenant. Sem isso nasceria usuário sem tenant.
      disableSignUp: true,
      sendMagicLink: async ({ email, url }) => {
        await deliverMagicLink({ email, url });
      },
    }),
  ],
});

export type Auth = typeof auth;
