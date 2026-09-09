import type { ServiceErrorCode, ServiceResult } from './errors';

/**
 * A ponte entre o envelope `ServiceResult` (língua das actions) e `Response` (língua
 * das rotas) — usada pelas rotas desta rodada (`/api/recibos/…`, `/api/export/…`).
 *
 * As rotas NÃO devolvem envelope JSON de sucesso: sucesso é o ARQUIVO (PDF/CSV) com o
 * header certo — é isso que um link baixável significa. O envelope só aparece no erro,
 * com o mesmo vocabulário da casa (`code`/`mensagem`/`correcao`), para o chamador dar
 * ao usuário a correção junto do problema.
 *
 * Status HTTP por código — a legenda que os dois lados concordaram:
 *   401 NAO_AUTENTICADO / 404 NAO_ENCONTRADO / 400 DADOS_INVALIDOS / 409 CONFLITO /
 *   402 LIMITE_DO_PLANO e ASSINATURA_INATIVA (pagamento) / 503 ASAAS_NAO_CONFIGURADO.
 */
const STATUS_POR_CODIGO: Record<ServiceErrorCode, number> = {
  NAO_AUTENTICADO: 401,
  NAO_ENCONTRADO: 404,
  DADOS_INVALIDOS: 400,
  CONFLITO: 409,
  LIMITE_DO_PLANO: 402,
  ASSINATURA_INATIVA: 402,
  ASAAS_NAO_CONFIGURADO: 503,
};

export function respostaDeErro(falha: {
  code: ServiceErrorCode;
  mensagem: string;
  correcao?: string;
  campo?: string;
}): Response {
  return Response.json(
    { ok: false, code: falha.code, mensagem: falha.mensagem, correcao: falha.correcao },
    { status: STATUS_POR_CODIGO[falha.code] },
  );
}

/** Type-guard de conveniência para as rotas: `if (falha()) return respostaDeErro(...)`. */
export function falhou<T>(
  resultado: ServiceResult<T>,
): resultado is Extract<ServiceResult<T>, { ok: false }> {
  return !resultado.ok;
}
