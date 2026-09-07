/**
 * S12 — Abstração de fornecedor de cotação (Wooba + Infotravel).
 *
 * COTAÇÃO SÓ. `buscarHoteis` é pull de preço/availability; `obterCotacao` é o
 * detalhe de um hotel específico. Nada de reserva, pagamento, cancelamento —
 * isso é o "motor de reservas", fora do v1.
 *
 * Cada `integrations` row do tenant carrega credenciais encriptadas. A camada
 * de actions (`src/server/integrations.ts`) decripta dentro de `withTenant` e
 * passa a credencial DECRYPTED para o adapter. O adapter NÃO lê a coluna — ele
 * recebe a credencial como argumento, ou `null` quando não há integração
 * cadastrada (modo dev: dados de exemplo).
 *
 * **Modo dev**: se a credencial é `null` (sem integração ativa), o adapter
 * devolve dados de EXEMPLO — 3 hotéis fake para `buscarHoteis`, uma cotação
 * fake para `obterCotacao`. Nunca chama a API real sem credencial. Se a
 * credencial existe mas a API falha (timeout/401), o adapter lança
 * `ServiceError` com `correcao` — nunca mistura "exemplo" com "real".
 */

import type { ServiceResult } from '@/server/errors';

export type Provider = 'wooba' | 'infotravel';

/**
 * Credencial decifrada. Cada provider tem o seu shape — Wooba pode pedir
 * `{ apiKey, agencyId }`, Infotravel `{ apiKey, clientId }`. O adapter faz
 * o cast para o shape que precisa. Genérico aqui porque a coluna do banco
 * guarda um JSON arbitrário.
 */
export type Credencial = Record<string, string>;

export type BuscarHoteisInput = {
  /** Id da integração do tenant. Opcional: se ausente, a action usa a primeira ativa. */
  integracaoId?: string;
  destino: string;
  /** ISO date (YYYY-MM-DD). */
  checkIn: string;
  checkOut: string;
  paxAdults: number;
  paxChildren?: number;
};

export type HotelBusca = {
  id: string;
  nome: string;
  destino: string;
  categoriaEstrelas?: number;
  thumbnailUrl?: string;
  precoCents: number;
  moeda: string;
  disponivel: boolean;
};

export type CotacaoInput = {
  integracaoId?: string;
  hotelId: string;
  checkIn: string;
  checkOut: string;
  paxAdults: number;
  paxChildren?: number;
};

export type Cotacao = {
  hotelId: string;
  nome: string;
  custoCents: number;
  moeda: string;
  checkIn: string;
  checkOut: string;
  detalhes?: string;
};

/**
 * Wrapper do resultado das actions. `exemplo: true` quando os dados vieram do
 * modo dev (sem credencial) — a UI sinaliza "cotação de exemplo". `false`
 * quando veio da API real do fornecedor.
 */
export type ResultadoBuscaHoteis = { hoteis: HotelBusca[]; exemplo: boolean };
export type ResultadoCotacao = { cotacao: Cotacao; exemplo: boolean };

export type IntegracaoResumo = {
  id: string;
  provider: Provider;
  label: string;
  isActive: boolean;
  createdAt: Date;
};

export type CriarIntegracaoInput = {
  provider: Provider;
  label: string;
  credentials: Credencial;
};

/**
 * Interface que cada adapter implementa. `credencial` é `null` quando não há
 * integração ativa — o adapter devolve dados de exemplo. Quando presente, o
 * adapter chama a API real; se falhar, lança `ServiceError`.
 */
export interface FornecedorAdapter {
  buscarHoteis(credencial: Credencial | null, input: BuscarHoteisInput): Promise<HotelBusca[]>;
  obterCotacao(credencial: Credencial | null, input: CotacaoInput): Promise<Cotacao>;
}

export type { ServiceResult };
