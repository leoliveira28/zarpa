# Fase 4 — Corporativo PJ e centro de custo

> Plano do coordenador (2026-09-10) a partir da auditoria da base. O "como" da
> Fase 4 de `docs/ROADMAP_MONDE.md`. Nada vira código sem o ok do PO.

## 1. A mira: a empresa pequena que o agente já atende na planilha

Não é o corporativo estruturado do Monde (política de viagem, aprovação em
cadeia, portal do cliente). É a firma de 5–50 pessoas que o agente solo já
atende hoje: **a empresa é o pagador, os funcionários viajam, às vezes um setor
é quem paga** (diretoria, marketing). O que ela precisa do agente: proposta,
viagem por funcionário, e **uma fatura por mês** em vez de dez recibos.

## 2. Empresa = contato de tipo PJ (não tabela nova)

Empresa é um `contacts` com `personType: 'fisica' | 'juridica'` (default
`fisica`), CNPJ na MESMA coluna `document` cifrada (AES-256-GCM + blind index —
o índice cego já aceita 14 dígitos; a validação `cpfValido` passa a aceitar
`cnpjValido` pelo tipo), razão social no `nome`. Reuso total:

- **N viajantes por empresa já existe** (`travelers.contact_id NOT NULL`) — o
  card Passageiros da ficha É a UI. Zero tabela nova.
- **Viagem da empresa** = deal com a empresa como contato titular
  (`deal_contacts` para N responsáveis, quando houver). "Histórico de compras
  por empresa" = `obterHistoricoDoContato` reescorado. Zero tabela nova.
- PJ **não** é auth: a `organization` da Fase 3 é a agência, nunca o cliente.

## 3. Centro de custo: lista do tenant, atributo da venda

Molde `pipelineStages` (tabela por tenant: `label`, `archivedAt`, posição) +
molde `agent_id` da Fase 3 (atributo do deal **fotografado na conversão**):
`cost_centers` + `deals.cost_center_id` / `sales.cost_center_id` (nullable —
viagem PF não tem centro de custo e nunca terá). Centro de custo é lista plana
do tenant; **não** é por empresa, não tem hierarquia, não tem rateio.

Relatório: 3ª sub-aba em Relatórios ("Centros de custo") reusando o Map de
`rankingDeClientes` com outra chave + coluna no CSV de vendas.

## 4. Faturamento consolidado: fatura + boleto + baixa automática

A peça pesada, dividida em três:

1. **Cobrança avulsa no client Asaas** (hoje só assinatura): `criarCobrancaAsaas`
   (POST `/payments`, `billingType: BOLETO`, `dueDate`, `description`) +
   customer real (decifrar documento com auditoria, padrão
   `obterDocumentoDoContato`; **consertar os placeholders do `trocarPlano`** —
   dívida antiga).
2. **Fatura** (`invoices`): contato-empresa + período + valor + status, ligada
   às `receivables` que consolida (coluna `invoice_id` na parcela). A fatura é
   o documento que vai pro boleto; as parcelas mantêm o vencimento delas.
3. **Baixa automática**: webhook Asaas CONFIRMED/RECEIVED da cobrança avulsa →
   marca as parcelas daquela fatura pagas. Hoje o webhook só entende assinatura —
   estender com idempotência por `asaasPaymentId` no mesmo padrão.

## 5. Rodadas (nesta ordem)

| Rodada | Entrega | Quem |
|---|---|---|
| **4a** | PJ no contato (tipo, CNPJ, telas) + centro de custo (tabela, atributo, relatório, CSV) | rafa + nina em paralelo |
| **4b** | Faturamento (cobrança avulsa, fatura, boleto, baixa automática) | rafa + nina |

## 6. Fora de escopo, de propósito

Política de viagem e aprovação em cadeia, múltiplos centros por venda, rateio,
portal do cliente PJ, contas a pagar, NF-e (Fase 6), integração com erp de
terceiro. Se virar pedido real, é decisão de produto explícita.

## 7. Critério de aceite

Agente cadastra a empresa (CNPJ) → cria a viagem de 2 funcionários dela →
atribui centro de custo → gera a venda → consolida o mês da empresa numa
fatura → emite o boleto Asaas → o webhook dá baixa automática nas parcelas →
o relatório por centro de custo fecha exatamente com o Financeiro.
