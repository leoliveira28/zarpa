import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Canal por onde um `tenantId` "entra por dentro" no cadastro de usuário do Better Auth.
 *
 * `user.tenantId` é `NOT NULL`, sem default, e `input: false` em `auth.ts` — ou seja, o
 * valor não pode vir do corpo da requisição de `/sign-up/email`. Ele precisa vir de algum
 * lugar antes do INSERT, e esse lugar é o hook `databaseHooks.user.create.before` (ver
 * `auth.ts`), que lê o valor pendurado aqui.
 *
 * Por que isto é seguro e não reabre a porta que `input: false` fecha: `AsyncLocalStorage`
 * propaga um valor pela cadeia de chamadas assíncronas de UMA execução, dentro do mesmo
 * processo Node. Não existe header, cookie ou campo de JSON que um cliente HTTP possa
 * mandar para preencher isto — só código rodando no servidor, que já decidiu de quem é o
 * tenant (`src/server/signup.ts`, que cria o tenant antes de chamar `signUpEmail`; ou o
 * seed), pode chamar `withPendingTenant`.
 *
 * Se `auth.api.signUpEmail` rodar fora de um `withPendingTenant`, o hook em `auth.ts`
 * lança — nunca cria usuário sem tenant, nunca cai num tenant por acaso.
 */
const tenantSignupContext = new AsyncLocalStorage<{ tenantId: string }>();

export function withPendingTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantSignupContext.run({ tenantId }, fn);
}

export function pendingTenantId(): string | undefined {
  return tenantSignupContext.getStore()?.tenantId;
}
