-- 0024_comprador_da_parcela — "quem já pagou da saída?" (Fase 5a, docs/FASE5_EXCURSAO.md).
--
-- Na excursão, o agente fecha UM pacote e cobra N compradores, um a um. A pergunta do
-- dia é "quem já pagou" — e a `receivables` não tinha onde ler isso. Esta migration
-- dá a ETIQUETA: `receivables.contact_id` aponta para o comprador da parcela.
--
-- Nullable NÃO é tolerância: venda de um comprador só não tem etiqueta e nunca
-- precisará ter — o fluxo da viagem de sempre não muda em nada (§6 do plano:
-- múltiplas vendas por deal, inscrição e rateio seguem fora de escopo).
--
-- FK SET NULL: apagar o contato não pode apagar a parcela — o histórico financeiro
-- sobrevive; a etiqueta é que some (a parcela vira "sem comprador", a mesma leitura
-- do dado antigo). Índice direto pela pergunta real: parcelas DE UM comprador.
--
-- Validade da etiqueta (camada de serviço, `src/server/sales.ts`): o comprador tem
-- que ser cliente DO negócio da venda (`deal_contacts`) — etiquetar a parcela com
-- um estranho recusa na entrada. O banco não impõe (atravessaria duas FKs com
-- tenant; o RLS + o serviço cobrem), e o custo do erro é cosmético.
--
-- Backfill: nenhum — coluna nova nula por padrão, parcela antiga fica sem etiqueta,
-- que é o estado legítimo dela.

ALTER TABLE "receivables" ADD COLUMN "contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "receivables_contact_id_idx" ON "receivables" ("contact_id");
