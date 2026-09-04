/**
 * Camada de serviço / Server Actions.
 *
 * O padrão, em quatro linhas:
 *   1. `tenantId` vem de `requireAuthContext()` — da sessão, nunca de argumento;
 *   2. toda query dentro de `withTenant(tenantId, ...)`;
 *   3. entrada validada com zod antes de tocar no banco;
 *   4. erro volta como dado (`ServiceResult`), com mensagem pronta para a interface.
 */

export { ServiceError, comoResultado, type ServiceResult, type ServiceErrorCode } from './errors';
export {
  listarContatos,
  criarContato,
  arquivarContato,
  obterDocumentoDoViajante,
  type ContatoInput,
  type ContatoResumo,
} from './contacts';
export {
  obterTenantAtual,
  atualizarMarca,
  criarTenant,
  type MarcaInput,
  type TenantAtual,
} from './tenants';
