'use server';

import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { integrations } from '@/db/schema';
import { withTenant } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { activeKeyId, decryptPII, encryptPII } from '@/lib/crypto';
import {
  obterAdapter,
  type Credencial,
  type Provider,
  type HotelBusca,
  type Cotacao,
  type ResultadoBuscaHoteis,
  type ResultadoCotacao,
  type IntegracaoResumo,
} from '@/lib/integrations';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { exigirContaAtiva } from './subscriptionGate';
import { registrarAuditoria } from './audit';

/**
 * S12 — Integrações de fornecedor (Wooba + Infotravel), cotação só.
 *
 * Mesmas quatro regras de `billing.ts`/`contacts.ts`: `tenantId` vem da sessão
 * (`requireAuthContext`), toda query dentro de `withTenant`, `tenant_id` nunca
 * do corpo, entrada validada com zod.
 *
 * Credenciais encriptadas com AES-256-GCM (`encryptPII`/`decryptPII` de
 * `src/lib/crypto/pii.ts`) — mesma infra que protege CPF/passaporte. O
 * ciphertext nunca volta para a interface: `listarIntegracoes` devolve
 * `IntegracaoResumo` sem a coluna `credentialsCiphertext`.
 *
 * **Modo dev**: `buscarHoteis`/`obterCotacao` sem integração ativa devolvem
 * dados de EXEMPLO (adapter retorna 3 hotéis/cotação fake com
 * `exemplo: true` no wrapper). Com integração ativa, chamam a API real; se
 * falhar (timeout/401), `ServiceError` com `correcao`.
 *
 * O fetch para a API externa fica FORA de `withTenant` — a transação só abre
 * para ler/decriptar a credencial (precisa de `app.tenant_id` para a policy de
 * RLS). O adapter recebe a credencial DECRYPTED e faz o fetch fora da
 * transação, sem segurar conexão do pool.
 */

// ---------------------------------------------------------------------------
// Tipos públicos (re-exportados de src/lib/integrations/types.ts)
// ---------------------------------------------------------------------------

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
} from '@/lib/integrations';

// ---------------------------------------------------------------------------
// Colunas explícitas — nunca `select()` sem lista. Ciphertext nunca lido.
// ---------------------------------------------------------------------------

const COLUNAS_INTEGRACAO_RESUMO = {
  id: integrations.id,
  provider: integrations.provider,
  label: integrations.label,
  isActive: integrations.isActive,
  createdAt: integrations.createdAt,
} as const;

// ---------------------------------------------------------------------------
// Schemas de validação (zod)
// ---------------------------------------------------------------------------

const providerSchema = z.enum(['wooba', 'infotravel']);

const criarIntegracaoSchema = z.object({
  provider: providerSchema,
  label: z.string().trim().min(2, 'O nome precisa de 2 letras ou mais.').max(100, 'O nome pode ter no máximo 100 letras.'),
  credentials: z
    .record(z.string(), z.string())
    .refine((c) => Object.keys(c).length > 0, 'As credenciais não podem estar vazias.'),
});

const buscarHoteisSchema = z.object({
  integracaoId: z.string().uuid('integracaoId inválido').optional(),
  destino: z.string().trim().min(2, 'Destino precisa de 2 letras ou mais.').max(120),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de check-in inválida (YYYY-MM-DD).'),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de check-out inválida (YYYY-MM-DD).'),
  paxAdults: z.number().int().min(1, 'Precisa de pelo menos 1 adulto.').max(20),
  paxChildren: z.number().int().min(0).max(20).optional(),
});

const obterCotacaoSchema = z.object({
  integracaoId: z.string().uuid('integracaoId inválido').optional(),
  hotelId: z.string().trim().min(1, 'hotelId obrigatório.').max(200),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de check-in inválida (YYYY-MM-DD).'),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de check-out inválida (YYYY-MM-DD).'),
  paxAdults: z.number().int().min(1, 'Precisa de pelo menos 1 adulto.').max(20),
  paxChildren: z.number().int().min(0).max(20).optional(),
});

// ---------------------------------------------------------------------------
// Actions — listar / criar / remover
// ---------------------------------------------------------------------------

/**
 * Lista as integrações ativas e inativas do tenant. Nunca devolve o ciphertext.
 */
export async function listarIntegracoes(): Promise<ServiceResult<IntegracaoResumo[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select(COLUNAS_INTEGRACAO_RESUMO)
        .from(integrations)
        .where(eq(integrations.tenantId, tenantId))
        .orderBy(desc(integrations.createdAt));

      return rows.map((r) => ({
        id: r.id,
        provider: r.provider as Provider,
        label: r.label,
        isActive: r.isActive,
        createdAt: r.createdAt,
      }));
    });
  });
}

/**
 * Cadastra uma conta de fornecedor. Encripta as credenciais com AES-256-GCM,
 * grava o envelope + key_id. Devolve resumo (sem ciphertext).
 */
export async function criarIntegracao(
  input: { provider: Provider; label: string; credentials: Credencial },
): Promise<ServiceResult<IntegracaoResumo>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const parsed = criarIntegracaoSchema.safeParse(input);
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos.', {
        campo: primeiro?.path.join('.'),
        correcao: 'Corrigir e tentar de novo.',
      });
    }
    const { provider, label, credentials } = parsed.data;

    // Encripta as credenciais: JSON -> string -> AES-256-GCM envelope.
    // O ciphertext nunca vai para log, nunca volta para a interface.
    const plaintext = JSON.stringify(credentials);
    const ciphertext = encryptPII(plaintext, { context: `integrations:${tenantId}` });
    const keyId = activeKeyId();

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const [criada] = await tx
        .insert(integrations)
        .values({
          tenantId,
          provider,
          label: label.trim(),
          credentialsCiphertext: ciphertext,
          keyId,
          isActive: true,
        })
        .returning(COLUNAS_INTEGRACAO_RESUMO);

      if (!criada) {
        throw new ServiceError('DADOS_INVALIDOS', 'Não consegui cadastrar a integração.');
      }

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'integration.created',
        entity: 'integration',
        entityId: criada.id,
        metadata: { provider, label: label.trim() },
      });

      return {
        id: criada.id,
        provider: criada.provider as Provider,
        label: criada.label,
        isActive: criada.isActive,
        createdAt: criada.createdAt,
      };
    });
  });
}

/**
 * Remove a integração (físico). Cotação é efêmera — não há FK que referencie
 * a integração, então o DELETE não quebra nada. Se um dia persistirmos
 * cotação como row, vira `ON DELETE SET NULL`.
 */
export async function removerIntegracao(id: string): Promise<ServiceResult<null>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    if (!id || typeof id !== 'string') {
      throw new ServiceError('DADOS_INVALIDOS', 'Id da integração obrigatório.');
    }

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const [deletada] = await tx
        .delete(integrations)
        .where(and(eq(integrations.id, id), eq(integrations.tenantId, tenantId)))
        .returning({ id: integrations.id, provider: integrations.provider, label: integrations.label });

      if (!deletada) {
        throw new ServiceError('NAO_ENCONTRADO', 'Essa integração não existe.', {
          correcao: 'Recarregar a lista de integrações.',
        });
      }

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'integration.deleted',
        entity: 'integration',
        entityId: deletada.id,
        metadata: { provider: deletada.provider, label: deletada.label },
      });

      return null;
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers internos — resolver credencial dentro de withTenant
// ---------------------------------------------------------------------------

type CredencialResolvida =
  | { credencial: Credencial; provider: Provider; exemplo: false }
  | { credencial: null; provider: null; exemplo: true };

/**
 * Lê a row de integração dentro de `withTenant` (RLS), decripta a credencial
 * e devolve para o chamador chamar o adapter FORA da transação.
 *
 * Se `integracaoId` é fornecido, resolve aquela. Se não, tenta a primeira
 * ativa do tenant. Se nenhuma ativa existe, devolve `exemplo: true` (modo dev).
 */
async function resolverCredencial(
  tenantId: string,
  integracaoId: string | undefined,
): Promise<CredencialResolvida> {
  return withTenant(tenantId, async (tx) => {
    let row: typeof integrations.$inferSelect | null = null;

    if (integracaoId) {
      const [r] = await tx
        .select()
        .from(integrations)
        .where(
          and(
            eq(integrations.id, integracaoId),
            eq(integrations.tenantId, tenantId),
            eq(integrations.isActive, true),
          ),
        )
        .limit(1);
      row = r ?? null;
      if (!row) {
        throw new ServiceError(
          'NAO_ENCONTRADO',
          'Essa integração não existe ou está desativada.',
          { correcao: 'Cadastre ou ative uma integração em /integracoes.' },
        );
      }
    } else {
      // Sem integracaoId: tenta a primeira ativa do tenant.
      const [r] = await tx
        .select()
        .from(integrations)
        .where(and(eq(integrations.tenantId, tenantId), eq(integrations.isActive, true)))
        .orderBy(desc(integrations.createdAt))
        .limit(1);
      row = r ?? null;
    }

    if (!row) {
      // Modo dev: sem integração ativa, devolve exemplo.
      return { credencial: null, provider: null, exemplo: true } as CredencialResolvida;
    }

    const plaintext = decryptPII(row.credentialsCiphertext, {
      context: `integrations:${tenantId}`,
    });
    const credencial = JSON.parse(plaintext) as Credencial;
    return {
      credencial,
      provider: row.provider as Provider,
      exemplo: false,
    };
  });
}

// ---------------------------------------------------------------------------
// Actions — buscarHoteis / obterCotacao (cotação)
// ---------------------------------------------------------------------------

/**
 * Busca hotéis por destino/datas/pax. Resolve a integração (decripta a
 * credencial dentro de `withTenant`), chama o adapter FORA da transação.
 *
 * Sem integração ativa: devolve dados de EXEMPLO (`exemplo: true` no wrapper).
 * Com integração + API falhando: `ServiceError` com `correcao`.
 */
export async function buscarHoteis(
  input: {
    integracaoId?: string;
    destino: string;
    checkIn: string;
    checkOut: string;
    paxAdults: number;
    paxChildren?: number;
  },
): Promise<ServiceResult<ResultadoBuscaHoteis>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const parsed = buscarHoteisSchema.safeParse(input);
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos.', {
        campo: primeiro?.path.join('.'),
        correcao: 'Corrigir e tentar de novo.',
      });
    }

    const resolved = await resolverCredencial(tenantId, parsed.data.integracaoId);

    if (resolved.exemplo || !resolved.provider) {
      // Modo dev: sem credencial, adapter devolve exemplo. 'wooba' é um
      // provider válido — o adapter sempre existe para ele.
      const adapter = obterAdapter('wooba');
      if (!adapter) {
        throw new ServiceError('DADOS_INVALIDOS', 'Adapter de exemplo indisponível.');
      }
      const hoteis = await adapter.buscarHoteis(null, parsed.data);
      return { hoteis, exemplo: true };
    }

    const adapter = obterAdapter(resolved.provider);
    if (!adapter) {
      throw new ServiceError(
        'DADOS_INVALIDOS',
        `Provider "${resolved.provider}" não suportado.`,
        { correcao: 'Escolher Wooba ou Infotravel.' },
      );
    }

    const hoteis = await adapter.buscarHoteis(resolved.credencial, parsed.data);
    return { hoteis, exemplo: false };
  });
}

/**
 * Obtém a cotação de um hotel específico. Mesma estrutura de `buscarHoteis`:
 * resolve credencial dentro de `withTenant`, chama adapter fora.
 */
export async function obterCotacao(
  input: {
    integracaoId?: string;
    hotelId: string;
    checkIn: string;
    checkOut: string;
    paxAdults: number;
    paxChildren?: number;
  },
): Promise<ServiceResult<ResultadoCotacao>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const parsed = obterCotacaoSchema.safeParse(input);
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos.', {
        campo: primeiro?.path.join('.'),
        correcao: 'Corrigir e tentar de novo.',
      });
    }

    const resolved = await resolverCredencial(tenantId, parsed.data.integracaoId);

    if (resolved.exemplo || !resolved.provider) {
      const adapter = obterAdapter('wooba');
      if (!adapter) {
        throw new ServiceError('DADOS_INVALIDOS', 'Adapter de exemplo indisponível.');
      }
      const cotacao = await adapter.obterCotacao(null, parsed.data);
      return { cotacao, exemplo: true };
    }

    const adapter = obterAdapter(resolved.provider);
    if (!adapter) {
      throw new ServiceError(
        'DADOS_INVALIDOS',
        `Provider "${resolved.provider}" não suportado.`,
        { correcao: 'Escolher Wooba ou Infotravel.' },
      );
    }

    const cotacao = await adapter.obterCotacao(resolved.credencial, parsed.data);
    return { cotacao, exemplo: false };
  });
}
