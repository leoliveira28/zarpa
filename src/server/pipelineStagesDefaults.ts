import { eq, sql } from 'drizzle-orm';
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
 * visível do quadro hoje. Os mesmos rótulos e a mesma ordem foram semeados para os tenants
 * existentes em `drizzle/0015_estagios_do_funil.sql` — se um dia divergirem, o backfill da
 * migration é a fonte histórica e ESTA lista é a fonte para tenant novo. Manter as duas
 * iguais é responsabilidade de quem mexer.
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
 * Idempotente: `pipeline_stages_tenant_legacy_key` (único parcial por
 * `(tenant_id, legacy_stage)`) faz a segunda passada virar no-op. Tenant que já tem
 * estágio (semeado pela 0015) não ganha linha duplicada.
 */
export async function semearEstagiosPadrao(tx: TenantDb, tenantId: string): Promise<void> {
  await tx
    .insert(pipelineStages)
    .values(ESTAGIOS_PADRAO.map((estagio) => ({ tenantId, ...estagio })))
    .onConflictDoNothing();
}

/** Quantos estágios (ativos ou não) este tenant tem. Usado pelo teto de colunas. */
export async function contarEstagios(tx: TenantDb, tenantId: string): Promise<number> {
  const [linha] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(pipelineStages)
    .where(eq(pipelineStages.tenantId, tenantId));
  return linha?.total ?? 0;
}
