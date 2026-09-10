# Meta: Grupos — o pacote com lugares, de Fátima a Fernando de Noronha

> Próxima meta registrada pelo PO (2026-09-10), depois da Fase 5. É a evolução
> da excursão leve (Fase 5a, `docs/FASE5_EXCURSAO.md`): o grupo deixa de ser
> só um negócio com vários compradores e vira um PACOTE com lugares contados.
> Plano do coordenador — nada vira código sem o ok do PO.

## 1. A mira

A agente monta a saída ANTES de vender: "Fátima 2027, 10 lugares, voo +
hospedagem + transfer, custo R$ 4.000/lugar, vendo a R$ 5.500". O grupo existe
como produto — e os clientes vão ocupando os lugares. O que ela precisa ver
toda hora: quantos lugares sobram, quem ocupou qual, e se a saída fecha no
azul com o que já vendeu.

## 2. A entidade nova: `groups` (o pacote)

Molde `deal_contacts`/`invoices` — uma linha por saída, POR TENANT, RLS
padrão:

- `title`, `destination`, `departureOn`/`returnOn` (datas do pacote)
- `totalSeats` (10 lugares) + `pricePerSeatCents` (o que se vende)
- **Fotografia de custo por lugar**: `costPerSeatCents` (voo+hospedagem+transfer
  como a agente digitar — SEM rateio calculado: é o preço do fornecedor por
  pessoa), `commissionPerSeatCents`, `serviceFeePerSeatCents` (0 quando não
  tem) — mesmos quatro números da venda, em escala de lugar
- `status`: `montando` → `vendendo` → `encerrado` (a saída passou; lugar vago
  não se vende retroativo)

## 3. Ocupação: cada cliente/negócio consome um lugar

- `group_members`: `groupId` + `contactId` + `dealId` (nullable — reserva sem
  negócio ainda) + `seats` (a família do Sr. Antônio ocupa 3) + status de
  pagamento da reserva. Um lugar = um `seats` consumido; `totalSeats -
  SUM(seats)` é o que a ficha do grupo mostra como "sobram 4 lugares".
- Ligar ocupação ao ECOSISTEMA: o deal vinculado ganha no `NegocioDetalhe` o
  bloco "Grupo: Fátima 2027 · 2 lugares" (join barato); ao fechar a venda do
  negócio, o custo/comissão do PACOTE alimenta o resultado da viagem daquele
  negócio (a Fase 5a já quebrou por comprador — a etiqueta vira o grupo).
- **Parcelamento livre**: a reserva não impõe régua — a agente lança as
  parcelas que quiser (o `criarParcela`/`atualizarParcela` da 5a com juros e
  etiqueta de comprador É o mecanismo; o grupo só lê as parcelas dos negócios
  membros).

## 4. Relatórios e ecossistema

- Nova sub-aba "Grupos" em Relatórios (a quarta, ao lado de Clientes e
  Centros de custo): por grupo — lugares vendidos/total, receita prevista ×
  realizada (soma das vendas dos negócios membros), margem por lugar
  `(preço − custo − comissão − taxa) × lugares vendidos`.
- Ranking/Financeiro não mudam: o dinheiro continua morando em `sales`;
  grupo é LENTE sobre ele, não segunda contabilidade (regra da casa).
- Funil: card do negócio membro mostra o chip do grupo (mesma linha do
  "Ana +2" — texto, não cor).

## 5. Rodadas

| Rodada | Entrega |
|---|---|
| 6a | `groups` + `group_members` (migration 0025), CRUD da ficha do grupo (`/grupos`), ocupação de lugares, vínculo com negócio |
| 6b | Parcelamento por reserva (lendo as parcelas 5a), sub-aba Grupos nos Relatórios, chips no funil/ficha |

## 5b. A associação grupo ↔ proposta/negócio — DECIDIDO (2026-09-11, revisão do PO)

A pergunta: "vai associar uma proposta dentro do grupo ou grupo dentro da
proposta? Senão o grupo fica solto". Resposta: **a cadeia é uma só, e o
grupo fica no MEIO dela — no negócio, nunca na proposta**:

    grupo (o pacote com lugares)
      └── group_members (contato + deal_id, N lugares)   ← A ASSOCIAÇÃO É AQUI
            └── deal (o negócio da reserva)
                  ├── proposals (1..n, com opções)
                  └── sales (a venda) → receivables (parcelas)

- **Proposta NÃO se associa a grupo** — ela nasce de um deal, e o deal já é
  membro do grupo. Associar proposta diretamente criaria dois caminhos para a
  mesma verdade (e contagem dupla no relatório).
- **A contabilização sobe pela cadeia**: proposta/venda pertencem ao deal →
  o deal pertence ao grupo via `group_members` → o Relatório de Grupos soma as
  vendas dos deals membros (6b, já no ar). Uma reserva = um deal = uma linha
  de ocupação com N lugares; as vendas dele contam UMA vez para o grupo.
- **Superfícies do vínculo**: chip na ficha do negócio e no card do funil
  (6b, no ar); a ficha do grupo lista os membros com link para o deal; quando
  a Vitrine 7b entrar, o interessado vira contato → negócio → membro, e a
  cadeia se fecha sem novo mecanismo.
- **O que o PO pediu a mais**: ao criar um negócio PARA um contato que já é
  membro de um grupo, a ficha do grupo passa a sugerir "criar negócio" no
  lugar do membro sem deal (rodada 7c, junto com a origem da oferta).

## 6. Fora de escopo, de propósito

Assento específico/andaime de ônibus, lista de espera automática, portal do
cliente, venda direta ao público (sem negócio), pagamento ao fornecedor
(contas a pagar segue na Fase 6), price por faixa de idade (o kind do viajante
já diz criança/adulto no CSV do fornecedor).

## 7. Critério de aceite

Agente cria "Fátima 2027" com 10 lugares, custo R$ 4.000 e preço R$ 5.500/lugar
→ relaciona 3 negócios (a família ocupa 2 lugares) → a ficha mostra "sobram 5"
→ as parcelas de cada negócio são lançadas como ela quiser → o Relatório de
Grupos mostra 5/10 lugares, receita realizada 16.500, margem 4.500 × 3 vendidos
→ o funil mostra o chip do grupo no card de cada negócio → quando a saída
encerra, nada vaza para o Financeiro (o dinheiro sempre esteve nas vendas).
