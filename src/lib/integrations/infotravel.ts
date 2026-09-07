import { ServiceError } from '@/server/errors';
import type { BuscarHoteisInput, Credencial, Cotacao, CotacaoInput, FornecedorAdapter, HotelBusca } from './types';

/**
 * Adapter Infotravel — cotação de hotéis/pacotes.
 *
 * Mesmo padrão de `wooba.ts`: `INFOTRAVEL_API_URL` é URL do produto, a chave da
 * conta vem da linha `integrations` do tenant (decriptada pela action). O env só
 * guarda a URL base.
 *
 * **Modo dev**: sem credencial (`null`), devolve dados de EXEMPLO. Com credencial,
 * chama a API real; se falhar, `ServiceError` com `correcao`.
 *
 * NOTA: a API real do Infotravel não está provisionada. O shape de chamada é o
 * que faz sentido para um REST de cotação de hotel. Ajustar path/headers quando
 * a doc real chegar — o resto (encriptação, RLS, action) não mexe.
 */

const INFOTRAVEL_API_URL = process.env.INFOTRAVEL_API_URL ?? 'https://api.infotravel.com.br';
const INFOTRAVEL_TIMEOUT_MS = 12_000;

type CredencialInfotravel = { apiKey: string; clientId?: string };

function credencialInfotravel(c: Credencial): CredencialInfotravel {
  const apiKey = c['apiKey'] ?? c['api_key'] ?? c['token'];
  if (!apiKey) {
    throw new ServiceError(
      'DADOS_INVALIDOS',
      'A credencial da conta Infotravel não tem chave de API.',
      { correcao: 'Editar a integração e informar a chave de API (apiKey).' },
    );
  }
  return { apiKey, clientId: c['clientId'] ?? c['client_id'] };
}

function hoteisExemplo(input: BuscarHoteisInput): HotelBusca[] {
  const seed = input.destino.toLowerCase().charCodeAt(0) ?? 97;
  const base = (seed * 131) % 750 + 550;
  return [
    {
      id: 'ex-infotravel-1',
      nome: `Hotel ${input.destino} — Central`,
      destino: input.destino,
      categoriaEstrelas: 3,
      thumbnailUrl: undefined,
      precoCents: base * 100,
      moeda: 'BRL',
      disponivel: true,
    },
    {
      id: 'ex-infotravel-2',
      nome: `Resort ${input.destino} — All Inclusive`,
      destino: input.destino,
      categoriaEstrelas: 5,
      thumbnailUrl: undefined,
      precoCents: (base + 550) * 100,
      moeda: 'BRL',
      disponivel: true,
    },
    {
      id: 'ex-infotravel-3',
      nome: `Pousada ${input.destino} — Budget`,
      destino: input.destino,
      categoriaEstrelas: 2,
      thumbnailUrl: undefined,
      precoCents: Math.max(base - 250, 350) * 100,
      moeda: 'BRL',
      disponivel: true,
    },
  ];
}

function cotacaoExemplo(input: CotacaoInput): Cotacao {
  const seed = input.hotelId.charCodeAt(input.hotelId.length - 1) ?? 97;
  const base = (seed * 131) % 750 + 550;
  return {
    hotelId: input.hotelId,
    nome: `Hotel ${input.hotelId}`,
    custoCents: base * 100,
    moeda: 'BRL',
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    detalhes: 'Cotação de exemplo — cadastre sua conta Infotravel para cotações reais.',
  };
}

async function buscarHoteisReal(
  credencial: CredencialInfotravel,
  input: BuscarHoteisInput,
): Promise<HotelBusca[]> {
  const url = new URL('/api/v1/hotels/search', INFOTRAVEL_API_URL);
  url.searchParams.set('destination', input.destino);
  url.searchParams.set('checkIn', input.checkIn);
  url.searchParams.set('checkOut', input.checkOut);
  url.searchParams.set('adults', String(input.paxAdults));
  if (input.paxChildren) url.searchParams.set('children', String(input.paxChildren));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INFOTRAVEL_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'X-API-Key': credencial.apiKey,
        ...(credencial.clientId ? { 'X-Client-Id': credencial.clientId } : {}),
      },
    });
    if (res.status === 401) {
      throw new ServiceError(
        'DADOS_INVALIDOS',
        'O Infotravel rejeitou a chave de API (401).',
        { correcao: 'Editar a integração e conferir a chave de API.' },
      );
    }
    if (!res.ok) {
      throw new ServiceError(
        'DADOS_INVALIDOS',
        `O Infotravel devolveu status ${res.status}.`,
        { correcao: 'Tentar de novo em alguns instantes.' },
      );
    }
    const body = (await res.json().catch(() => null)) as
      | { data?: Array<{ id?: string; nome?: string; destino?: string; categoriaEstrelas?: number; thumbnailUrl?: string; precoCents?: number; moeda?: string; disponivel?: boolean }> }
      | null;
    if (!body?.data) {
      throw new ServiceError(
        'DADOS_INVALIDOS',
        'O Infotravel devolveu uma resposta sem dados.',
        { correcao: 'Tentar de novo.' },
      );
    }
    return body.data.map((h) => ({
      id: h.id ?? String(Math.random()),
      nome: h.nome ?? 'Hotel',
      destino: h.destino ?? input.destino,
      categoriaEstrelas: h.categoriaEstrelas,
      thumbnailUrl: h.thumbnailUrl ?? undefined,
      precoCents: h.precoCents ?? 0,
      moeda: h.moeda ?? 'BRL',
      disponivel: h.disponivel ?? true,
    }));
  } catch (error: unknown) {
    if (error instanceof ServiceError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ServiceError(
        'DADOS_INVALIDOS',
        'O Infotravel demorou demais para responder.',
        { correcao: 'Tentar de novo em alguns instantes.' },
      );
    }
    throw new ServiceError(
      'DADOS_INVALIDOS',
      'Não consegui falar com o Infotravel agora.',
      { correcao: 'Tentar de novo em alguns instantes.' },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function obterCotacaoReal(
  credencial: CredencialInfotravel,
  input: CotacaoInput,
): Promise<Cotacao> {
  const url = new URL(`/api/v1/hotels/${encodeURIComponent(input.hotelId)}/quote`, INFOTRAVEL_API_URL);
  url.searchParams.set('checkIn', input.checkIn);
  url.searchParams.set('checkOut', input.checkOut);
  url.searchParams.set('adults', String(input.paxAdults));
  if (input.paxChildren) url.searchParams.set('children', String(input.paxChildren));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INFOTRAVEL_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'X-API-Key': credencial.apiKey,
        ...(credencial.clientId ? { 'X-Client-Id': credencial.clientId } : {}),
      },
    });
    if (res.status === 401) {
      throw new ServiceError(
        'DADOS_INVALIDOS',
        'O Infotravel rejeitou a chave de API (401).',
        { correcao: 'Editar a integração e conferir a chave de API.' },
      );
    }
    if (!res.ok) {
      throw new ServiceError(
        'DADOS_INVALIDOS',
        `O Infotravel devolveu status ${res.status}.`,
        { correcao: 'Tentar de novo em alguns instantes.' },
      );
    }
    const body = (await res.json().catch(() => null)) as
      | { hotelId?: string; nome?: string; custoCents?: number; moeda?: string; checkIn?: string; checkOut?: string; detalhes?: string }
      | null;
    if (!body) {
      throw new ServiceError(
        'DADOS_INVALIDOS',
        'O Infotravel devolveu uma resposta sem dados.',
        { correcao: 'Tentar de novo.' },
      );
    }
    return {
      hotelId: body.hotelId ?? input.hotelId,
      nome: body.nome ?? 'Hotel',
      custoCents: body.custoCents ?? 0,
      moeda: body.moeda ?? 'BRL',
      checkIn: body.checkIn ?? input.checkIn,
      checkOut: body.checkOut ?? input.checkOut,
      detalhes: body.detalhes,
    };
  } catch (error: unknown) {
    if (error instanceof ServiceError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ServiceError(
        'DADOS_INVALIDOS',
        'O Infotravel demorou demais para responder.',
        { correcao: 'Tentar de novo em alguns instantes.' },
      );
    }
    throw new ServiceError(
      'DADOS_INVALIDOS',
      'Não consegui falar com o Infotravel agora.',
      { correcao: 'Tentar de novo em alguns instantes.' },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export const infotravelAdapter: FornecedorAdapter = {
  async buscarHoteis(credencial: Credencial | null, input: BuscarHoteisInput): Promise<HotelBusca[]> {
    if (!credencial) return hoteisExemplo(input);
    return buscarHoteisReal(credencialInfotravel(credencial), input);
  },
  async obterCotacao(credencial: Credencial | null, input: CotacaoInput): Promise<Cotacao> {
    if (!credencial) return cotacaoExemplo(input);
    return obterCotacaoReal(credencialInfotravel(credencial), input);
  },
};
