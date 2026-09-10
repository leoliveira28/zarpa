/**
 * Schema do Zarpa — as tabelas do domínio + as do Better Auth (`auth.ts`, `organization.ts`).
 *
 * Todas as tabelas com `tenant_id` (e mais `tenants`, isolada por `id`) têm RLS
 * ENABLE + FORCE e policy `USING`/`WITH CHECK` contra `app.tenant_id`. As policies vivem
 * na migration que cria a tabela (`0000_fundacao.sql`, `0001_pessoas_e_importacao.sql`,
 * `0003_construtor_de_proposta.sql` ou `0007_vendas_e_recebiveis.sql`, dependendo da
 * tabela — nunca numa migration depois).
 * Drizzle não modela policy: se você criar tabela nova aqui e esquecer a policy lá,
 * o vazamento não aparece em nenhum type check. Só no teste do Téo.
 *
 * `library_items` é a única tabela com `tenant_id` ANULÁVEL (`is_global = true` não tem
 * dono) — a policy dela tem quatro regras em vez de uma só `USING`/`WITH CHECK` simétrica.
 * Ver o comentário no topo de `./library.ts` antes de mexer.
 */

export * from './tenants';
export * from './auth';
export * from './organization';
export * from './agents';
export * from './people';
export * from './pipeline';
export * from './proposals';
export * from './itineraries';
export * from './library';
export * from './plans';
export * from './money';
export * from './platform';
export * from './imports';
export * from './sales';
export * from './costCenters';
export * from './invoices';
export * from './groups';
export * from './integrations';
