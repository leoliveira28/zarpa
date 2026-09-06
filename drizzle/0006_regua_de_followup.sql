-- 0006_regua_de_followup — S8: régua de follow-up automático depois do envio da proposta.
--
-- Duas mudanças em `tasks`, tabela que já existe desde `0000_fundacao.sql` com RLS
-- (ENABLE + FORCE) e policy própria — nada aqui cria tabela nova, então não há policy
-- nova para escrever. `tasks` continua sob a MESMA policy de sempre
-- (`tasks_tenant_isolation`, ver 0000): tenant só vê/escreve a própria linha.
--
-- 1. `suggested_message` — texto pronto para colar no WhatsApp, só em tarefa gerada.
-- 2. `source` ganha o valor `'followup_proposta'` — a régua D+2/D+5/D+10 depois do envio.
--    O `CHECK` é nomeado e precisa ser recriado (Postgres não tem `ALTER CHECK`);
--    dropar e recriar com o mesmo nome mantém compatibilidade com quem já lê
--    `pg_constraint` por nome.
--
-- Idempotência da régua em si (ver `src/server/followups.ts`) usa o MESMO mecanismo que
-- os alertas de passaporte/aniversário já usam: `dedupe_key` determinístico
-- (`followup:proposta:<propostaId>:d2` etc.) mais o índice único parcial
-- `tasks_tenant_dedupe_key` (`0001_pessoas_e_importacao.sql`) — nenhum índice novo
-- precisa nascer aqui, o de 0001 já cobre qualquer `source` não-manual.

ALTER TABLE "tasks" ADD COLUMN "suggested_message" text;
--> statement-breakpoint

ALTER TABLE "tasks" DROP CONSTRAINT "tasks_source_check";
--> statement-breakpoint

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_check"
  CHECK ("source" IN ('manual', 'alerta_passaporte', 'alerta_aniversario', 'importacao', 'followup_proposta'));
