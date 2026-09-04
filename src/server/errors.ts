/**
 * Erros de serviço.
 *
 * Regra do CLAUDE.md: "erro diz o que aconteceu E oferece a correção". Então todo erro
 * carrega uma `mensagem` já em português, pronta para a interface — a Nina não deve
 * precisar traduzir código de erro nem inventar texto.
 *
 * O que NUNCA entra na mensagem: PII, id interno de outro tenant, detalhe do banco.
 */

export type ServiceErrorCode =
  | 'NAO_AUTENTICADO'
  | 'NAO_ENCONTRADO'
  | 'DADOS_INVALIDOS'
  | 'CONFLITO'
  | 'LIMITE_DO_PLANO';

export class ServiceError extends Error {
  code: ServiceErrorCode;
  /** Texto pronto para a interface. */
  mensagem: string;
  /** O que o usuário pode fazer para resolver. Vira o botão junto do erro. */
  correcao?: string;
  campo?: string;

  constructor(
    code: ServiceErrorCode,
    mensagem: string,
    extra: { correcao?: string; campo?: string } = {},
  ) {
    super(`${code}: ${mensagem}`);
    this.name = 'ServiceError';
    this.code = code;
    this.mensagem = mensagem;
    this.correcao = extra.correcao;
    this.campo = extra.campo;
  }
}

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ServiceErrorCode; mensagem: string; correcao?: string; campo?: string };

/**
 * Envelope para Server Action. Uma Server Action que estoura vira erro genérico
 * ("An error occurred in the Server Components render") na tela do usuário — inútil.
 * Aqui o erro vira dado, e a interface decide como mostrar.
 */
export async function comoResultado<T>(fn: () => Promise<T>): Promise<ServiceResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error: unknown) {
    if (error instanceof ServiceError) {
      return {
        ok: false,
        code: error.code,
        mensagem: error.mensagem,
        correcao: error.correcao,
        campo: error.campo,
      };
    }
    if (error instanceof Error && error.message === 'NÃO_AUTENTICADO') {
      return {
        ok: false,
        code: 'NAO_AUTENTICADO',
        mensagem: 'Sua sessão expirou.',
        correcao: 'Entrar de novo',
      };
    }
    // Erro não previsto: o detalhe vai para o log do servidor, não para a tela.
    console.error('[server] erro não tratado:', error);
    return {
      ok: false,
      code: 'DADOS_INVALIDOS',
      mensagem: 'Não consegui completar essa ação agora.',
      correcao: 'Tentar de novo',
    };
  }
}
