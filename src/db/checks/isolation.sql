-- Prova de isolamento entre tenants — critério de aceite do S1.
--
--   psql "$DATABASE_URL" -v tenant_a="<uuid A>" -v tenant_b="<uuid B>" \
--        -f src/db/checks/isolation.sql
--
-- Roda como o role da aplicação (`zarpa`: NOSUPERUSER, NOBYPASSRLS). Se qualquer
-- consulta abaixo devolver linha do tenant B com contexto do tenant A, o isolamento
-- não existe. Este arquivo é a versão manual; a versão automatizada em CI é do Téo.

\set ON_ERROR_STOP off
\pset pager off

\echo ''
\echo '=== 0. quem está executando ==='
SELECT current_user,
       rolsuper    AS eh_superuser,
       rolbypassrls AS ignora_rls
FROM pg_roles WHERE rolname = current_user;

\echo ''
\echo '=== 1. sem NENHUM contexto de tenant: tudo deve dar zero ==='
SELECT 'tenants'   AS tabela, count(*) FROM tenants
UNION ALL SELECT 'contacts',   count(*) FROM contacts
UNION ALL SELECT 'travelers',  count(*) FROM travelers
UNION ALL SELECT 'deals',      count(*) FROM deals
UNION ALL SELECT 'proposals',  count(*) FROM proposals
UNION ALL SELECT 'proposal_options', count(*) FROM proposal_options
UNION ALL SELECT 'proposal_views',   count(*) FROM proposal_views
UNION ALL SELECT 'payments',   count(*) FROM payments
UNION ALL SELECT 'audit_log',  count(*) FROM audit_log
UNION ALL SELECT 'user',       count(*) FROM "user"
UNION ALL SELECT 'account (senha)', count(*) FROM account
ORDER BY 1;

BEGIN;
SELECT set_config('app.tenant_id', :'tenant_a', true) AS contexto_ativo;

\echo ''
\echo '=== 2. contexto = TENANT A: quantas linhas de cada tenant o A enxerga? ==='
SELECT 'contacts' AS tabela,
       count(*) FILTER (WHERE tenant_id = :'tenant_a'::uuid) AS do_tenant_a,
       count(*) FILTER (WHERE tenant_id = :'tenant_b'::uuid) AS do_tenant_b
FROM contacts
UNION ALL
SELECT 'deals',
       count(*) FILTER (WHERE tenant_id = :'tenant_a'::uuid),
       count(*) FILTER (WHERE tenant_id = :'tenant_b'::uuid)
FROM deals
UNION ALL
SELECT 'proposals',
       count(*) FILTER (WHERE tenant_id = :'tenant_a'::uuid),
       count(*) FILTER (WHERE tenant_id = :'tenant_b'::uuid)
FROM proposals
UNION ALL
SELECT 'proposal_options',
       count(*) FILTER (WHERE tenant_id = :'tenant_a'::uuid),
       count(*) FILTER (WHERE tenant_id = :'tenant_b'::uuid)
FROM proposal_options
UNION ALL
SELECT 'travelers',
       count(*) FILTER (WHERE tenant_id = :'tenant_a'::uuid),
       count(*) FILTER (WHERE tenant_id = :'tenant_b'::uuid)
FROM travelers
UNION ALL
SELECT 'payments',
       count(*) FILTER (WHERE tenant_id = :'tenant_a'::uuid),
       count(*) FILTER (WHERE tenant_id = :'tenant_b'::uuid)
FROM payments
ORDER BY 1;

\echo ''
\echo '=== 3. tentando ler dado do B pelo NOME (busca direcionada) ==='
SELECT id, name FROM contacts WHERE name ILIKE '%Albuquerque%' OR name ILIKE '%Pontes%';

\echo ''
\echo '=== 4. tentando ler a linha do tenant B em tenants, pelo id ==='
SELECT id, name, slug FROM tenants WHERE id = :'tenant_b'::uuid;

\echo ''
\echo '=== 5. tentando ler as opções de proposta do B (custo e comissão) ==='
SELECT o.name, o.price_cents, o.cost_cents, o.commission_cents
FROM proposal_options o
WHERE o.tenant_id = :'tenant_b'::uuid;

\echo ''
\echo '=== 6. join a partir de tabela do A tentando puxar dado do B ==='
SELECT c.name AS contato, d.title AS negocio
FROM deals d JOIN contacts c ON c.id = d.contact_id
ORDER BY 1;

-- Cada tentativa de escrita abaixo vai num SAVEPOINT próprio: o primeiro erro aborta a
-- transação e, sem isso, os passos seguintes sairiam como "commands ignored" em vez de
-- mostrarem o próprio resultado.

\echo ''
\echo '=== 7. tentando GRAVAR uma linha com tenant_id do B (WITH CHECK) ==='
SAVEPOINT s7;
INSERT INTO contacts (tenant_id, name) VALUES (:'tenant_b'::uuid, 'invasor');
ROLLBACK TO SAVEPOINT s7;

\echo ''
\echo '=== 8. tentando ALTERAR o tenant_id de uma linha do A para o B ==='
SAVEPOINT s8;
UPDATE contacts SET tenant_id = :'tenant_b'::uuid WHERE tenant_id = :'tenant_a'::uuid;
ROLLBACK TO SAVEPOINT s8;

\echo ''
\echo '=== 9. tentando APAGAR dado do B (linhas afetadas deve ser 0) ==='
SAVEPOINT s9;
DELETE FROM contacts WHERE tenant_id = :'tenant_b'::uuid;
ROLLBACK TO SAVEPOINT s9;

\echo ''
\echo '=== 10. tentando ler credencial (account.password) do contexto de tenant ==='
SAVEPOINT s10;
SELECT count(*) AS linhas_de_credencial_visiveis FROM account;
ROLLBACK TO SAVEPOINT s10;

\echo ''
\echo '=== 11. audit_log é append-only: UPDATE e DELETE atingem 0 linhas ==='
SAVEPOINT s11a;
UPDATE audit_log SET action = 'adulterado' WHERE tenant_id = :'tenant_a'::uuid;
ROLLBACK TO SAVEPOINT s11a;
SAVEPOINT s11b;
DELETE FROM audit_log WHERE tenant_id = :'tenant_a'::uuid;
ROLLBACK TO SAVEPOINT s11b;

COMMIT;

\echo ''
\echo '=== 12. contexto = TENANT B: espelho do passo 2 ==='
BEGIN;
SELECT set_config('app.tenant_id', :'tenant_b', true) AS contexto_ativo;
SELECT 'contacts' AS tabela,
       count(*) FILTER (WHERE tenant_id = :'tenant_a'::uuid) AS do_tenant_a,
       count(*) FILTER (WHERE tenant_id = :'tenant_b'::uuid) AS do_tenant_b
FROM contacts
UNION ALL
SELECT 'proposals',
       count(*) FILTER (WHERE tenant_id = :'tenant_a'::uuid),
       count(*) FILTER (WHERE tenant_id = :'tenant_b'::uuid)
FROM proposals
ORDER BY 1;
COMMIT;

\echo ''
\echo '=== 13. o contexto é local à transação: fora dela, zero de novo ==='
SELECT current_setting('app.tenant_id', true) AS tenant_no_gud,
       (SELECT count(*) FROM contacts) AS contatos_visiveis;

\echo ''
\echo '=== 14. contexto forjado com uuid que não existe ==='
BEGIN;
SELECT set_config('app.tenant_id', '00000000-0000-7000-8000-000000000000', true);
SELECT count(*) AS contatos_visiveis FROM contacts;
COMMIT;

\echo ''
\echo '=== 15. amostra do que ESTÁ cifrado no banco (nenhum CPF em claro) ==='
BEGIN;
SELECT set_config('app.tenant_id', :'tenant_a', true);
SELECT left(cpf_encrypted, 46) || '…' AS cpf_como_esta_gravado FROM travelers LIMIT 2;
COMMIT;
