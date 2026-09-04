-- Role da aplicação: NOSUPERUSER e NOBYPASSRLS de propósito.
-- Se uma query só funciona como superuser, a policy está errada — conserte a policy.
CREATE ROLE zarpa LOGIN PASSWORD 'zarpa' NOSUPERUSER NOCREATEDB NOBYPASSRLS;
CREATE DATABASE zarpa_dev  OWNER zarpa;
CREATE DATABASE zarpa_test OWNER zarpa;
