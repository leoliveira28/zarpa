import { ServiceError } from '@/server/errors';

/**
 * S11 — Cliente do Asaas (cobrança da assinatura do SaaS: Pix + cartão recorrente + boleto).
 *
 * Env-driven: `ASAAS_API_URL` (sandbox em dev, produção em prod), `ASAAS_API_KEY`,
 * `ASAAS_WEBHOOK_TOKEN`. **SEM chamada real quando `ASAAS_API_KEY` ausente** — toda
 * função devolve `ServiceError` com `code: 'ASAAS_NAO_CONFIGURADO'` e `correcao`
 * pronta para a interface. Em dev sem chave, as actions de troca/cancelar operam em
 * "modo local" (atualizam só o DB, sem chamar Asaas) — ver `src/server/billing.ts`.
 *
 * O role da aplicação é NOBYPASSRLS — nada aqui precisa de superuser. As credenciais
 * do Asaas nunca vão para log nem para a tela.
 */

const ASAAS_API_URL =
  process.env.ASAAS_API_URL ?? 'https://sandbox.asaas.com/api/v3';
const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN;

/** Guard: true quando a integração está configurada. Usado por `billing.ts`. */
export function asaasConfigurado(): boolean {
  return Boolean(ASAAS_API_KEY);
}

/** Erro padrão para quando a chave não existe — NÃO chama a API. */
export function erroAsaasNaoConfigurado(): ServiceError {
  return new ServiceError(
    'ASAAS_NAO_CONFIGURADO',
    'O Asaas não está configurado neste ambiente.',
    { correcao: 'Defina ASAAS_API_KEY no .env para habilitar cobrança.' },
  );
}

// ---------------------------------------------------------------------------
// Tipos de entrada/saída
// ---------------------------------------------------------------------------

export type BillingType = 'CREDIT_CARD' | 'PIX' | 'BOLETO';

export type CriarClienteInput = {
  name: string;
  email: string;
  /** CPF ou CNPJ (somente dígitos). */
  cpfCnpj: string;
};

export type CriarClienteResult = {
  asaasCustomerId: string;
};

export type CriarAssinaturaInput = {
  customerId: string;
  /** No Asaas, `value` é o valor da cobrança recorrente em reais (float, não cents). */
  value: number;
  billingType: BillingType;
  /** Dia do mês da cobrança (1-28). Opcional — Asaas escolhe se omitido. */
  dueDate?: number;
};

export type CriarAssinaturaResult = {
  asaasSubscriptionId: string;
};

export type PagamentoAsaas = {
  id: string;
  status: string;
  billingType: string;
  value: number;
  dueDate: string | null;
  paymentDate: string | null;
  installment?: number;
};

// ---------------------------------------------------------------------------
// Fetch interno
// ---------------------------------------------------------------------------

type AsaasResponse = Record<string, unknown> & {
  errors?: unknown;
  data?: unknown;
  totalCount?: number;
};

async function asaasFetch<T extends AsaasResponse>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${ASAAS_API_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      access_token: ASAAS_API_KEY ?? '',
      ...init.headers,
    },
  });

  const body = (await res.json().catch(() => null)) as T | null;

  if (!res.ok) {
    const detalhe = extrairErroAsaas(body);
    throw new ServiceError('DADOS_INVALIDOS', `Asaas rejeitou a requisição: ${detalhe}`, {
      correcao: 'Revisar os dados de cobrança e tentar de novo.',
    });
  }

  return body as T;
}

function extrairErroAsaas(body: AsaasResponse | null): string {
  if (!body) return `status HTTP inesperado`;
  const errors = body.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const primeiro = errors[0] as { description?: string; message?: string } | undefined;
    return primeiro?.description ?? primeiro?.message ?? 'erro desconhecido';
  }
  return 'erro desconhecido';
}

// ---------------------------------------------------------------------------
// Funções públicas — cada uma checa a chave antes de chamar a API
// ---------------------------------------------------------------------------

export async function criarClienteAsaas(
  input: CriarClienteInput,
): Promise<CriarClienteResult> {
  if (!asaasConfigurado()) throw erroAsaasNaoConfigurado();

  const body = await asaasFetch<{ id: string }>('/customers', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      email: input.email,
      cpfCnpj: input.cpfCnpj,
    }),
  });

  return { asaasCustomerId: body.id };
}

export async function criarAssinaturaAsaas(
  input: CriarAssinaturaInput,
): Promise<CriarAssinaturaResult> {
  if (!asaasConfigurado()) throw erroAsaasNaoConfigurado();

  const body = await asaasFetch<{ id: string }>('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      customer: input.customerId,
      billingType: input.billingType,
      value: input.value,
      cycle: 'MONTHLY',
      dueDate: input.dueDate,
    }),
  });

  return { asaasSubscriptionId: body.id };
}

export async function cancelarAssinaturaAsaas(
  asaasSubscriptionId: string,
): Promise<void> {
  if (!asaasConfigurado()) throw erroAsaasNaoConfigurado();

  await asaasFetch(`/subscriptions/${asaasSubscriptionId}`, {
    method: 'DELETE',
  });
}

export async function listarPagamentosAsaas(
  asaasSubscriptionId: string,
): Promise<PagamentoAsaas[]> {
  if (!asaasConfigurado()) throw erroAsaasNaoConfigurado();

  const body = await asaasFetch<{ data?: PagamentoAsaas[] }>(
    `/payments?subscription=${encodeURIComponent(asaasSubscriptionId)}`,
    { method: 'GET' },
  );

  return body.data ?? [];
}

// ---------------------------------------------------------------------------
// Webhook — verificação de token
// ---------------------------------------------------------------------------

/**
 * O Asaas não assina o body por padrão. A validação é por **token configurado**
 * (`ASAAS_WEBHOOK_TOKEN`) enviado no header `asaas-access-token` ou em query
 * `access_token`. Esta função compara o token recebido com o configurado.
 *
 * Retorna `true` se o token bate (ou se não há token configurado — ver doc abaixo).
 */
export function verificarWebhookAsaas(req: {
  headers: Record<string, string | string[] | undefined>;
  searchParams?: URLSearchParams | Record<string, string>;
}): boolean {
  if (!ASAAS_WEBHOOK_TOKEN) {
    // Sem token configurado: em dev/teste o webhook é aceito para não travar o
    // fluxo. Em produção o PO deve definir ASAAS_WEBHOOK_TOKEN — o Téo testa isto.
    return true;
  }

  const headerToken =
    req.headers['asaas-access-token'] ?? req.headers['Asaas-Access-Token'];
  const headerStr = Array.isArray(headerToken) ? headerToken[0] : headerToken;

  const queryToken = req.searchParams
    ? 'get' in req.searchParams
      ? (req.searchParams as URLSearchParams).get('access_token')
      : (req.searchParams as Record<string, string>).access_token
    : undefined;

  const recebido = headerStr ?? queryToken;
  if (!recebido || typeof recebido !== 'string') return false;

  // Comparação em tempo constante para evitar timing attack.
  return timingSafeEqual(recebido, ASAAS_WEBHOOK_TOKEN);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
