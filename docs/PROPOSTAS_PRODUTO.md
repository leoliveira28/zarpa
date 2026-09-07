# Propostas de produto — fluxos que ainda não existem

> Registro estratégico, não spec de implementação. Cada proposta diz o problema,
> o fluxo mínimo, onde mora no que já existe e o que fica FORA de propósito.
> A régua de todas: o bater-o-molde (1ª proposta em <15 min) e os dois dinheiros
> (`docs/REGRAS_DE_NEGOCIO.md` §2). Nada aqui vira código sem decisão do PO.

## 1. Período nas telas de leitura (filtros de data)

**Problema.** Hoje as telas mostram "este mês" fixo. O agente que fecha 12 numa
vidinha de dezembro e nada em março não consegue olhar para trás — a tela conta
uma história de um mês só.

**Fluxo proposto.** Um seletor de período único, no topo das telas de leitura
(/hoje, Dinheiro): `Este mês` · `Mês passado` · `Este ano` · `Escolher datas`
(calendário de duas pontas, teclado primeiro em 390px). O período é estado da
URL (`?periodo=2026-09`), não memória escondida — link compartilhável, voltar do
navegador restaura.

**Onde mora.** Leituras existentes; **nenhuma tabela nova** — `sales.createdAt`,
`receivables.venceEm`, `deals.departureOn` já respondem.

**Não fazer.** Filtro por dez campos (o concorrente pesado faz isso); filtro no
funil (kanban compara estágios, não tempo).

**Quando.** Primeiro da fila: é o solo onde o relatório (§2) cresce, e é barato.

## 2. Relatórios — dentro do Dinheiro, não como sexta aba

**Problema.** "Quanto entrou, quanto vem, onde perdi" vive hoje espalhado entre
o /hoje e o Dinheiro. A barra inferior já está no limite de 5 alvos de toque
— uma sexta aba é o caminho errado.

**Fluxo proposto.** Terceira tab no hub Dinheiro (ao lado de Vendas e
Financeiro — `MoneyHubTabs` já existe para isso): **Resumo do período** —
segundo o seletor de §1: vendas fechadas, receita bruta, comissão
recebida vs. prevista, ticket médio, e o melhor: **de onde vieram** (origem do
contato) e **onde se perderam** (motivos de perda — o dado obrigatório de
`deals` `perdido` finalmente vira aprendizado, não só registro).

**Não fazer.** Gráficos decorativos, PDF exportável, comparativo mensal
complexo. Número tabular, largura reservada, tab simples — é o registro
silencioso do miolo.

**Quando.** Depois de §1. Só quando §1 já estiver clicado pelo PO.

## 3. Clientes em viagem — o pós-venda que sustenta a recompra

**Problema.** A venda fecha e o cliente desaparece do produto até procurar o
agente de novo. Para quem vive de confiança (MEI, 10–15 vendas/mês), a viagem
em curso é o momento de maior risco (emergência, problema no hotel) e maior
oportunidade (depoimento, próxima venda) — e hoje o produto não sabe que ela
existe.

**Fluxo proposto.** Seção **"Em viagem"** no /hoje (não tela nova), alimentada
por `deals.departureOn`/`returnOn` de deals `ganho` — **dado que já existe**.
Três estados, um por linha:
- *Viaja em N dias* → prompt discreto de última chamada (documentos, check-in)
- *Em viagem até dd/mm* → uma linha, sem CTA — presença, não ruído
- *Retornou há N dias* → o único CTA: **pedir depoimento** (mensagem pronta pro
  WhatsApp) — a recompra nasce daí

**Não fazer.** Chat no app, alerta push de voo, integração com operadora — é
motor de reservas disfarçado (fora do escopo, §9 da spec).

**Quando.** Segundo trimestre de produto — mas é a proposta com mais retorno
por linha de código, porque só reusa datas existentes.

## 4. Roteiro pós-venda — a página pública do roteiro

**Problema.** Depois de aceitar a proposta, o cliente recebe o roteiro como
PDF improvisado no WhatsApp — o mesmo desencontro que a proposta veio resolver,
repetido na etapa final da venda.

**Fluxo proposto.** Do negócio `ganho` (com proposta aceita), ação **"Gerar
roteiro"**: página pública `/r/[slug]` reusando o motor da `/p/[slug]`
(SECURITY DEFINER, mesmo scanner de vazamento) — só blocos, datas, nome do
cliente e marca; **nunca** custo, comissão, PII de passageiro (§4 da spec vale
na íntegra). O roteiro é fotografia do fechado: editar proposta depois não
muda o roteiro já gerado. Envio pelo mesmo botão de WhatsApp do hoje.

**Não fazer.** PDF (a proposta PDF é dívida anterior — não dobrar), vouchers
por operadora, aceite/assinatura no roteiro.

**Quando.** Por último: é página pública nova e herda a regra mais séria do
produto (o scanner). Vale esperar e fazer certo.

---

**Ordem sugerida**: §1 → §2 → §3 → §4. §1–§2 cabem no registro silencioso do
miolo com zero tabela nova; §3 reusa datas existentes; §4 é o único que cria
superfície pública nova e por isso vai por último.
