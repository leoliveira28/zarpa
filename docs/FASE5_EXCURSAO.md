# Fase 5 — Excursão/grupo leve

> Plano do coordenador (2026-09-10) a partir da auditoria da base, no molde do
> plano da Fase 4. A nota do roadmap vale e comanda o tamanho: **validar
> demanda com usuários antes de investir** — então o plano é o MENOR que fecha
> o critério de aceite. Nada vira código sem o ok do PO.

## 1. A mira: o ônibus que a agente enche com a igreja, a empresa e o grupo de amigos

A excursão da agente solo não é evento com inscrição e crédito coletivo — é
UMA saída (Petrópolis no feriado, a peregrinação, o grupo do sênior) onde ela
fecha UM pacote com o fornecedor e cobra N compradores, um a um, no pix/boleto
de cada um. O que ela precisa do Zarpa: ver o grupo inteiro numa ficha só,
saber QUEM JÁ PAGOU da saída, e fechar o mês sabendo se a saída deu margem.

## 2. Auditoria — o que a base JÁ tem (quase tudo é 0020/0021 prontos)

- **Negócio com múltiplos compradores JÁ EXISTE** — `deal_contacts` (0020) é a
  N:N com titular + secundários; a ficha tem o card Clientes, o funil mostra
  "Ana +2", e o board do funil é o quadro da excursão. Zero tabela nova.
- **"Resultado da viagem" JÁ EXISTE** por deal (`resultado.ts` +
  `ResultadoViagemCard`) — venda − custo − comissão, recebido/a receber. A
  excursão com UMA venda do grupo usa este card sem mudar nada.
- **Faturamento/parcelas** — `receivables` consolidáveis em fatura (0023) para
  a igreja-que-paga-junto, quando for o caso.
- **Centro de custo** (0022) — a saída da paróquia pode ser classificada.
- **Documento de passageiros cifrado + CSV auditado** — o export da fase 2 já
  decifra CPF/passaporte com auditoria; o grupo só amplia a consulta.

## 3. Os três gaps (e só eles)

1. **Passageiros do grupo ficam presos ao titular.** `csvPassageirosDoNegocio`
   e o card Passageiros leem `travelers` por `deals.contact_id` — os
   viajantes cadastrados nos contatos secundários do grupo somem da lista que
   vai para o fornecedor. Correção: varrer `deal_contacts` (titular primeiro,
   ordem de entrada depois — MESMA política dos nomes da 0021). Join existe;
   **zero migration**.
2. **Parcela não sabe de QUEM é.** `receivables` não tem contato — na saída
   com cobrança individual, "quem já pagou" é a pergunta do dia e hoje não há
   onde ler. Migration 0024: `receivables.contact_id` (nullable, SET NULL,
   RESTRICT na leitura de relatório — a PF de um comprador só existe como
   etiqueta da parcela). Preenchida pela UI de parcelas quando a venda é de
   grupo; nula = venda de um comprador só, sem mudança nenhuma no fluxo de
   sempre.
3. **Resultado da saída não quebra por comprador.** O agregado já fecha; falta
   a quebra "Maria pagou R$ 800 de R$ 1.200" — Map de agregação por
   `receivables.contact_id` reusando a gramática do ranking (Fase 4a repetiu o
   Map para centro de custo; aqui é a terceira leitura). Só faz sentido quando
   a venda tem parcelas etiquetadas — seção some quando não tem.

## 4. Fora de escopo, de propósito (a nota do roadmap mandou não investir)

Múltiplas VENDAS por deal (a venda continua nascente de UMA proposta aceita —
excursão com contratos separados por comprador continua sendo N negócios),
inscrição/check-in/evento, crédito coletivo e rateio automático de custos,
app do passageiro, comunicação em massa. Se virar pedido real, decisão de
produto explícita.

## 5. Rodada única (5a), uma frente só

| Entrega | Detalhe |
|---|---|
| Passageiros consolidados | Card Passageiros + CSV do grupo varrem `deal_contacts` (gaps 1) |
| Etiqueta de comprador | Migration 0024 (`receivables.contact_id`) + UI de quem paga cada parcela na ficha da venda (gap 2) |
| Resultado da saída | Quebra por comprador no `ResultadoViagemCard` da ficha (gap 3) |

## 6. Critério de aceite

Agente cria o negócio "Peregrinação 2027" → adiciona 5 compradores (0020) →
cadastra os viajantes de cada um → exporta a lista de passageiros do grupo
(GAP 1: os 5 aparecem, não só o titular) → gera a venda do pacote → lança as
parcelas etiquetadas por comprador (GAP 2) → o card Resultado mostra a margem
da saída E quem já pagou (GAP 3) — sem nenhuma migration além da 0024 e sem
mudar o fluxo da viagem de sempre (um comprador só continua idêntico).
