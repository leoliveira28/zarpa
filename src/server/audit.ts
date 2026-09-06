import { auditLog } from '@/db/schema';
import type { TenantDb } from '@/lib/tenant/withTenant';

/**
 * Escrita no `audit_log`. Módulo próprio porque três serviços já precisam dele e porque
 * arquivo com `'use server'` só pode exportar função async — helper compartilhado tem que
 * morar fora.
 *
 * `metadata` NÃO recebe PII. Registre o FATO ("veio com documento", "documento mudou"),
 * nunca o valor. Se um identificador precisar mesmo aparecer, use `maskDocument`.
 */

export type EntradaAuditoria = {
  tenantId: string;
  actorUserId: string | null;
  action: string;
  entity: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
};

export async function registrarAuditoria(tx: TenantDb, entrada: EntradaAuditoria): Promise<void> {
  await tx.insert(auditLog).values({
    tenantId: entrada.tenantId,
    actorUserId: entrada.actorUserId,
    action: entrada.action,
    entity: entrada.entity,
    entityId: entrada.entityId,
    metadata: entrada.metadata ?? {},
  });
}
