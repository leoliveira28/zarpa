import { ServiceError } from '@/server/errors';
import type { BuscarHoteisInput, Credencial, Cotacao, CotacaoInput, FornecedorAdapter, HotelBusca } from './types';

/**
 * Adapter Wooba — cotação de hotéis/pacotes.
 *
 * `WOOBA_API_URL` é URL do produto (sandbox em dev, produção em prod). A chave
 * da conta **não** vem do env: a decisão é conta por agente, então a credencial
 * vem da linha `integrations` do tenant (decriptada pela action dentro de
 * `withTenant`). O env só guarda a URL base do produto.
 *
 * **Modo dev**: se `credencial` é `null` (sem integração ativa), o adapter
 * devolve 3 hotéis de EXEMPLO — nunca chama a API real. Se a credencial existe
 * mas a API falha (timeout/401), lança `ServiceError` com `correcao`.
 *
 * NOTA: a API real do Wooba não está provisionada neste repositório (sem
 * credencial, sem doc oficial em mãos). O shape de chamada abaixo é o que faz
 * sentido para um REST de cotação de hotel (GET com query params, header de
 * API key). Quando a doc real chegar, ajustar o path/headers aqui — o resto
 * (encriptação, RLS, action) não mexe.
 */

const WOOBA_API_URL = process.env.WOOBA_API_URL ?? 'https://api.wooba.com.br';
const WOOBA_TIMEOUT_MS = 12_000;

type CredencialWooba = { apiKey: string; agencyId?: string };

function credencialWooba(c: Credencial): CredencialWooba {
  const apiKey = c['apiKey'] ?? c['api_key'] ?? c['token'];
  if (!apiKey) {
    throw new ServiceError(
      'DADOS_INVALIDOS',
      'A credencial da conta Wooba não tem chave de API.',
      { correcao: 'Editar a integração e informar a chave de API (apiKey).' },
    );
  }
  return { apiKey, agencyId: c['agencyId'] ?? c['agency_id'] };
}

function hoteisExemplo(input: BuscarHoteisInput): HotelBusca[] {
  // Determinístico por destino — a UI de teste precisa de dados estáveis.
  const seed = input.destino.toLowerCase().charCodeAt(0) ?? 97;
  const base = (seed * 127) % 800 + 600; // 600–1400
  return [
    {
      id: 'ex-wooba-1',
      nome: `Hotel ${input.destino} — Centro`,
      destino: input.destino,
      categoriaEstrelas: 4,
      thumbnailUrl: undefined,
      precoCents: base * 100,
      moeda: 'BRL',
      disponivel: true,
    },
    {
      id: 'ex-wooba-2',
      nome: `Hotel ${input.destino} — Beira-mar`,
      destino: input.destino,
      categoriaEstrelas: 5,
      thumbnailUrl: undefined,
      precoCents: (base + 400) * 100,
      moeda: 'BRL',
      disponivel: true,
    },
    {
      id: 'ex-wooba-3',
      nome: `Pousada ${input.destino} — Charme`,
      destino: input.destino,
      categoriaEstrelas: 3,
      thumbnailUrl: undefined,
      precoCents: Math.max(base - 200, 400) * 100,
      moeda: 'BRL',
      disponivel: true,
    },
  ];
}

function cotacaoExemplo(input: CotacaoInput): Cotacao {
  const seed = input.hotelId.charCodeAt(input.hotelId.length - 1) ?? 97;
  const base = (seed * 127) % 800 + 600;
  return {
    hotelId: input.hotelId,
    nome: `Hotel ${input.hotelId}`,
    custoCents: base * 100,
    moeda: 'BRL',
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    detalhes: 'Cotação de exemplo — cadastre sua conta Wooba para cotações reais.',
  };
}

async function buscarHoteisReal(
  credencial: CredencialWooba,
  input: BuscarHoteisInput,
): Promise<HotelBusca[]> {
  const url = new URL('/v1/hotels/search', WOOBA_API_URL);
  url.searchParams.set('destino', input.destino);
  url.searchParams.set('checkIn', input.checkIn);
  url.searchParams.set('checkOut', input.checkOut);
  url.searchParams.set('adults', String(input.paxAdults));
  if (input.paxChildren) url.searchParams.set('children', String(input.paxChildren));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WOOBA_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${credencial.apiKey}`,
        ...(credencial.agencyId ? { 'X-Agency-Id': credencial.agencyId } : {}),
      },
    });
    if (res.status === 401) {
      throw new ServiceError(
        'DADOS_INVALIDOS',
        'A Wooba rejeitou a chave de API (401).',
        { correcao: 'Editar a integração e conferir a chave de API.' },
      );
    }
    if (!res.ok) {
      throw new ServiceError(
        'DADOS_INVALIDOS',
        `A Wooba devolveu status ${res.status}.`,
        { correcao: 'Tentar de novo em alguns instantes.' },
      );
    }
    const body = (await res.json().catch(() => null)) as
      | { data?: Array<{ id?: string; nome?: string; destino?: string; categoriaEstrelas?: number; thumbnailUrl?: string; precoCents?: number; moeda?: string; disponivel?: boolean }> }
      | null;
    if (!body?.data) {
      throw new ServiceError(
        'DADOS_INVALIDOS',
        'A Wooba devolveu uma resposta sem dados.',
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
        'A Wooba demorou demais para responder.',
        { correcao: 'Tentar de novo em alguns instantes.' },
      );
    }
    throw new ServiceError(
      'DADOS_INVALIDOS',
      'Não consegui falar com a Wooba agora.',
      { correcao: 'Tentar de novo em alguns instantes.' },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function obterCotacaoReal(
  credencial: CredencialWooba,
  input: CotacaoInput,
): Promise<Cotacao> {
  const url = new URL(`/v1/hotels/${encodeURIComponent(input.hotelId)}/quote`, WOOBA_API_URL);
  url.searchParams.set('checkIn', input.checkIn);
  url.searchParams.set('checkOut', input.checkOut);
  url.searchParams.set('adults', String(input.paxAdults));
  if (input.paxChildren) url.searchParams.set('children', String(input.paxChildren));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WOOBA_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${credencial.apiKey}`,
        ...(credencial.agencyId ? { 'X-Agency-Id': credencial.agencyId } : {}),
      },
    });
    if (res.status === 401) {
      throw new ServiceError(
        'DADOS_INVALIDOS',
        'A Wooba rejeitou a chave de API (401).',
        { correcao: 'Editar a integração e conferir a chave de API.' },
      );
    }
    if (!res.ok) {
      throw new ServiceError(
        'DADOS_INVALIDOS',
        `A Wooba devolveu status ${res.status}.`,
        { correcao: 'Tentar de novo em alguns instantes.' },
      );
    }
    const body = (await res.json().catch(() => null)) as
      | { hotelId?: string; nome?: string; custoCents?: number; moeda?: string; checkIn?: string; checkOut?: string; detalhes?: string }
      | null;
    if (!body) {
      throw new ServiceError(
        'DADOS_INVALIDOS',
        'A Wooba devolveu uma resposta sem dados.',
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
        'A Wooba demorou demais para responder.',
        { correcao: 'Tentar de novo em alguns instantes.' },
      );
    }
    throw new ServiceError(
      'DADOS_INVALIDOS',
      'Não consegui falar com a Wooba agora.',
      { correcao: 'Tentar de novo em alguns instantes.' },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export const woobaAdapter: FornecedorAdapter = {
  async buscarHoteis(credencial: Credencial | null, input: BuscarHoteisInput): Promise<HotelBusca[]> {
    if (!credencial) return hoteisExemplo(input);
    return buscarHoteisReal(credencialWooba(credencial), input);
  },
  async obterCotacao(credencial: Credencial | null, input: CotacaoInput): Promise<Cotacao> {
    if (!credencial) return cotacaoExemplo(input);
    return obterCotacaoReal(credencialWooba(credencial), input);
  },
};
