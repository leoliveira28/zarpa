import { sql } from 'drizzle-orm';
import { unsafeDbWithoutTenant } from '../../db/client';
import type { TenantDb } from './withTenant';

/**
 * `withPlatformContext` — o equivalente de `withTenant` para o punhado de operações que
 * não pertencem a tenant nenhum. Hoje, uma única coisa: administrar o acervo global de
 * biblioteca (`library_items.is_global = true`), cuja policy `library_items_platform_service`
 * (`drizzle/0003_construtor_de_proposta.sql`) só concede acesso quando
 * `app.platform_context = 'on'`.
 *
 * Liga o GUC LOCAL À TRANSAÇÃO, do mesmo jeito que `withTenant` liga `app.tenant_id`, e
 * pela mesma razão: `set_config(..., true)` fora de transação não faz nada, e uma conexão
 * de pool não pode voltar ao próximo request ainda com o contexto ligado.
 *
 * NINGUÉM chama isto a partir de uma Server Action hoje — não existe tela de admin nem
 * seed de catálogo global no v1. Existe para (a) documentar o desenho da policy com código
 * de verdade em vez de só comentário em SQL, e (b) dar ao Téo um jeito de escrever fixture
 * de item global em teste sem precisar de um role que faz bypass de RLS, o que este
 * projeto não usa (`zarpa` é NOBYPASSRLS de propósito — ver CLAUDE.md).
 *
 * Ressalva já registrada para `app.auth_context` em `docs/handoffs/rafa-para-po.md` (item
 * 5) vale igual aqui: um GUC é forjável por qualquer SQL arbitrário. Não é regressão (quem
 * executa SQL arbitrário também forja `app.tenant_id`), mas por isso o alcance desta policy
 * foi mantido mínimo — só toca `is_global = true`, nunca dado de tenant.
 */
export async function withPlatformContext<T>(
  callback: (tx: TenantDb) => Promise<T>,
): Promise<T> {
  return unsafeDbWithoutTenant.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.platform_context', 'on', true)`);
    return callback(tx);
  });
}
