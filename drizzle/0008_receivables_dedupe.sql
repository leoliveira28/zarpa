-- 0008_receivables_dedupe — fecha o buraco de concorrência em `gerarParcelasDaVenda`.
--
-- Achado do Téo (`docs/status/teo.md`, S9): ao contrário de `converterPropostaEmVenda`
-- (protegida por `sales_proposal_id_key`, `0007_vendas_e_recebiveis.sql`),
-- `gerarParcelasDaVenda` (src/server/sales.ts) fazia "conta quantas parcelas já existem,
-- se zero insere N" sem nenhuma trava no banco — duas chamadas simultâneas (duplo clique
-- no botão "gerar parcelas") passam as duas pela checagem de contagem antes de qualquer
-- uma inserir, e a segunda duplica as parcelas inteiras.
--
-- `vence_em` de cada parcela gerada é uma função determinística de
-- (venda, quantidade, primeiraVencimento) — duas chamadas concorrentes com o MESMO
-- insumo (o caso real do duplo clique: mesmo formulário, mesmo estado) produzem
-- exatamente as mesmas datas. Um índice único em (sale_id, vence_em) faz o Postgres
-- recusar a segunda tentativa de inserir a mesma data para a mesma venda — a mesma
-- doutrina de `sales_proposal_id_key`: o banco garante idempotência, não a sorte da
-- Server Action nunca rodar duas vezes ao mesmo tempo.
--
-- Efeito colateral aceito e documentado: parcelamento manual (`criarParcela`) também
-- passa a proibir duas parcelas no MESMO dia para a MESMA venda. Não há caso de produto
-- hoje que precise de duas parcelas com vencimento idêntico — se aparecer, é somar valor
-- numa linha só, não duas linhas com a mesma data.
--
-- Limpeza antes do índice: se alguma duplicata já foi criada em ambiente de
-- desenvolvimento/teste pelo bug (não deveria existir em produção, que nunca rodou esta
-- versão do código), mantém a linha mais antiga por (sale_id, vence_em) e descarta as
-- demais antes de o índice recusar a duplicata na criação. Não mexe em `sales`, só em
-- `receivables`, e não tenta "consertar" o valor de nenhuma linha — só remove o
-- duplicado literal.
WITH duplicadas AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY sale_id, vence_em
      ORDER BY created_at ASC, id ASC
    ) AS posicao
  FROM receivables
)
DELETE FROM receivables
WHERE id IN (SELECT id FROM duplicadas WHERE posicao > 1);
--> statement-breakpoint

CREATE UNIQUE INDEX "receivables_sale_id_vence_em_key" ON "receivables" ("sale_id", "vence_em");
