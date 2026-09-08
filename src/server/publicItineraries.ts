'use server';

import { z } from 'zod';
import { unsafeSqlWithoutTenant } from '@/db/client';
import { comoResultado, type ServiceResult } from './errors';
import type { PropostaPublicaBrand } from './publicProposals';
import type { BlocoDoRoteiro } from './itineraries';

/**
 * O roteiro público — lido SEM login, §4 de `docs/PROPOSTAS_PRODUTO.md`. A página
 * `/r/[slug]` (fora da minha fronteira) chama esta action.
 *
 * Segue EXATAMENTE a disciplina de `obterPropostaPublica` (`publicProposals.ts`): este
 * módulo NUNCA importa `withTenant` para ler o roteiro (não existe `tenantId` de sessão —
 * o token é anônimo) e NUNCA faz `select` direto em `itineraries` pelo cliente cru — com
 * `FORCE ROW LEVEL SECURITY` devolveria zero linhas (RLS falha fechado), e "consertar"
 * soltando a policy abriria a tabela inteira. O único caminho é a função `SECURITY
 * DEFINER` `public.roteiro_publica` (`drizzle/0013_roteiro_publico.sql`),
 * que devolve SÓ o que o cliente vê, das colunas de SNAPSHOT da tabela: título, nome do
 * cliente, datas, blocos e marca. Nunca custo, comissão, preço, documento de passageiro,
 * e-mail/telefone do cliente — o scanner de vazamento (`tests/security/leak-scanner.ts`)
 * varre a resposta inteira, igual à proposta.
 *
 * Diferença consciente da proposta: aqui NÃO há `registrarVisita` — o roteiro não tem
 * "sabe quando o cliente abriu" nesta rodada (não pedido no §4; não inventar métrica).
 */

export type RoteiroPublicoMeta = {
  title: string;
  /** Nome do cliente, congelado na geração — o ÚNICO dado de contato que sai público. */
  clientName: string;
  currency: string;
  /** `AAAA-MM-DD` (string JSON), ou `null`. */
  departureOn: string | null;
  returnOn: string | null;
  /** ISO, string JSON — a página formata. */
  createdAt: string | null;
};

/** Mesma forma da marca da proposta pública — as duas páginas usam o mesmo desenho. */
export type RoteiroPublicoBrand = PropostaPublicaBrand;

export type RoteiroPublicoBloco = BlocoDoRoteiro;

export type RoteiroPublico = {
  roteiro: RoteiroPublicoMeta;
  brand: RoteiroPublicoBrand;
  blocks: RoteiroPublicoBloco[];
};

/**
 * Mesma cerca de bom senso do `public_token` da proposta: a validação não é a segurança
 * (a segurança é a imprevisibilidade dos 128 bits mais a função devolvendo zero linhas
 * para o que não bater) — ela existe para não mandar lixo óbvio ao banco.
 */
const roteiroTokenSchema = z
  .string()
  .trim()
  .min(10, 'Link inválido')
  .max(80, 'Link inválido')
  .regex(/^[A-Za-z0-9_-]+$/, 'Link inválido');

/** O que a página pública do roteiro (`/r/[slug]`) chama para renderizar. */
export async function obterRoteiroPublico(
  slug: string,
): Promise<ServiceResult<RoteiroPublico | null>> {
  return comoResultado(async () => {
    const parsed = roteiroTokenSchema.safeParse(slug);
    if (!parsed.success) return null;

    const linhas = await unsafeSqlWithoutTenant<{ payload: RoteiroPublico }[]>`
      select payload from public.roteiro_publica(${parsed.data})
    `;
    return linhas[0]?.payload ?? null;
  });
}
