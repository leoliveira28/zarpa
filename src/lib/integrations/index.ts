import type { FornecedorAdapter, Provider } from './types';
import { woobaAdapter } from './wooba';
import { infotravelAdapter } from './infotravel';

export { woobaAdapter } from './wooba';
export { infotravelAdapter } from './infotravel';
export type {
  Provider,
  Credencial,
  BuscarHoteisInput,
  HotelBusca,
  CotacaoInput,
  Cotacao,
  ResultadoBuscaHoteis,
  ResultadoCotacao,
  IntegracaoResumo,
  CriarIntegracaoInput,
  FornecedorAdapter,
} from './types';

/**
 * Factory de adapter por provider. Devolve o adapter singleton (stateless —
 * a credencial é passada nos métodos, não guardada no adapter). Devolve `null`
 * se o provider não existe — a action decide o que fazer.
 */
export function obterAdapter(provider: Provider): FornecedorAdapter | null {
  switch (provider) {
    case 'wooba':
      return woobaAdapter;
    case 'infotravel':
      return infotravelAdapter;
    default:
      return null;
  }
}
