import { and, eq, isNull, sql } from 'drizzle-orm';
import { pipelineStages } from '@/db/schema';
import type { TenantDb } from '@/lib/tenant/withTenant';
import type { DealStage } from './deals';

/**
 * O funil de fábrica: os estágios que todo tenant nasce tendo.
 *
 * Mora FORA de `pipelineStages.ts` porque aquele arquivo é `'use server'` e um arquivo de
 * Server Actions só pode exportar função async — constante quebra o build do Next (mesmo
 * motivo de `dealStages.ts` existir). E por importar o schema/driver, este módulo NÃO é
 * reexportado pelo barril `@/server` (a lição do `subscriptionGate` em S13a: módulo sem
 * `'use server'` reexportado pelo barril arrasta o driver para Client Component).
 *
 * A lista espelha `COLUNAS_DO_FUNIL` (`./dealStages.ts`) mais `perdido`, que é valor real
 * de `deals.stage` e precisa existir como estágio (é o `is_lost`) mesmo não sendo coluna
 * visível do quadro hoje.
 *
 * S16 — ESTA CONSTANTE É DOCUMENTAÇÃO E TIPO, NÃO É MAIS QUEM SEMEIA. Quem semeia é
 * `public.semear_estagios_padrao` no banco (a 0016), porque o trigger também precisa
 * semear. Ela fica aqui para o servidor poder falar dos padrões em TypeScript; se mudar um
 * rótulo, mude na função SQL — é ela que roda.
 */
export const ESTAGIOS_PADRAO: {
  legacyStage: DealStage;
  label: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
}[] = [
  { legacyStage: 'novo', label: 'Novo contato', position: 0, isWon: false, isLost: false },
  { legacyStage: 'cotando', label: 'Montando', position: 1, isWon: false, isLost: false },
  { legacyStage: 'proposta_enviada', label: 'Enviada', position: 2, isWon: false, isLost: false },
  { legacyStage: 'negociando', label: 'Negociando', position: 3, isWon: false, isLost: false },
  { legacyStage: 'ganho', label: 'Fechada', position: 4, isWon: true, isLost: false },
  { legacyStage: 'perdido', label: 'Perdida', position: 5, isWon: false, isLost: true },
];

/**
 * Semeia o funil de fábrica para um tenant. Chamado DENTRO da transação que dá à luz o
 * tenant (`criarTenant`), no mesmo `withTenant` — nunca com `tenantId` vindo de argumento
 * de rota.
 *
 * S16 — É UM WRAPPER, DE PROPÓSITO. A semente de verdade é a função
 * `public.semear_estagios_padrao` (`drizzle/0016_negocio_aponta_para_estagio.sql`), porque
 * o trigger `deals_estagio_sync` precisa semear de dentro do banco, onde não existe
 * TypeScript. Duas implementações da mesma lista divergiriam no primeiro dia em que
 * alguém mudasse um rótulo — e a divergência apareceria como "o funil do tenant X está
 * diferente do do tenant Y", que ninguém liga ao commit que a causou.
 *
 * Idempotente e mais esperta que um `ON CONFLICT` cru: ela semeia por VALOR FALTANTE, e
 * desvia de rótulo já usado e de fim de funil já ocupado (ver o cabeçalho da função na
 * migration). Passar duas vezes é no-op.
 *
 * `tenantId` vai como parâmetro (`$1`), nunca interpolado — e o RLS de `pipeline_stages`
 * continua valendo dentro da função, que é SECURITY INVOKER: semear tenant que não é o do
 * `app.tenant_id` da transação é impossível daqui.
 */
export async function semearEstagiosPadrao(tx: TenantDb, tenantId: string): Promise<void> {
  await tx.execute(sql`select public.semear_estagios_padrao(${tenantId}::uuid)`);
}

/**
 * Quantas linhas de estágio este tenant tem, ARQUIVADAS OU NÃO. Consumidor: a cura de
 * semente de `listarEstagios` (`=== 0` = nunca semeado). NÃO é a contagem do teto — para
 * isso existe `contarEstagiosAtivos` abaixo: o teto é do QUADRO, e contar arquivada nele
 * tornava a correção do estouro ("Arquivar uma coluna antes de criar outra") falsa — a
 * agente arquivava, a vaga não abria, e o teto virava paredão sem porta.
 */
export async function contarEstagios(tx: TenantDb, tenantId: string): Promise<number> {
  const [linha] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(pipelineStages)
    .where(eq(pipelineStages.tenantId, tenantId));
  return linha?.total ?? 0;
}

/** A contagem que o teto usa: só as que estão no quadro (`archived_at is null`). */
export async function contarEstagiosAtivos(tx: TenantDb, tenantId: string): Promise<number> {
  const [linha] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(pipelineStages)
    .where(and(eq(pipelineStages.tenantId, tenantId), isNull(pipelineStages.archivedAt)));
  return linha?.total ?? 0;
}
