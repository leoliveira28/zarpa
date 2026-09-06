/**
 * Schema v1 do Zarpa — 18 tabelas (17 do S1 + `import_batches` no S3).
 *
 * Todas as tabelas com `tenant_id` (e mais `tenants`, isolada por `id`) têm RLS
 * ENABLE + FORCE e policy `USING`/`WITH CHECK` contra `app.tenant_id`. As policies vivem
 * na migration `drizzle/0000_fundacao.sql`, na mesma migration que cria a tabela.
 * Drizzle não modela policy: se você criar tabela nova aqui e esquecer a policy lá,
 * o vazamento não aparece em nenhum type check. Só no teste do Téo.
 */

export * from './tenants';
export * from './auth';
export * from './people';
export * from './pipeline';
export * from './proposals';
export * from './money';
export * from './platform';
export * from './imports';
