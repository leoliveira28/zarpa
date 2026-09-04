import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins/magic-link';
import { account, session, user, verification } from '@/db/schema';
import { requiredEnv } from '@/db/env';
import { authDb } from './db';
import { deliverMagicLink } from './delivery';

/**
 * Better Auth, auto-hospedado no mesmo Postgres (decisão travada no CLAUDE.md).
 *
 * Dois caminhos de entrada:
 *   - magic link, que é o caminho principal para quem vende do celular e não quer
 *     lembrar de senha;
 *   - e-mail + senha, para quem prefere.
 *
 * Todo usuário nasce amarrado a um `tenant_id`. Isso NÃO é opcional: `user.tenant_id` é
 * `NOT NULL` no banco, e `input: false` no campo adicional impede que o valor chegue pelo
 * corpo da requisição. Quem cria tenant é `src/server/signup.ts`, que gera o tenant antes
 * e passa o id por dentro. Se alguém conseguisse mandar `tenantId` no JSON de cadastro,
 * criaria usuário dentro do tenant dos outros — e o RLS não salvaria, porque a linha
 * teria nascido com o `tenant_id` da vítima.
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
        // NUNCA aceitar este campo vindo da requisição. Ver comentário acima.
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
