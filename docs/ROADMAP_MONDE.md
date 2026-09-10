# Roadmap — comparação com Monde e ordem de execução

> Decisão do PO em 2026-09-09, a partir das páginas `monde.com.br/{operacao-propria,orcamentos,viagens-corporativas}`.
> Aviso anterior "fora do v1" foi REVOGADO para multiusuário, faturamento PJ e centro de custo.
> **Ordem do PO: integrações (Wooba/Infotravel/Despegar) e NF-e por ÚLTIMO.** Motor de reservas e app nativo seguem fora.
> **Mira do multiusuário: agências de 2 a 4 pessoas, não 5+.** Arquitetura, preço do
> assento e critério de aceite completos da Fase 3 em `docs/MULTIUSUARIO_AGENCIAS.md`.

## O que o Monde oferece (levantado)

- **Operação própria**: excursão/evento como produto próprio com N vendas, múltiplos
  fornecedores, lista de passageiros exportável (Excel) e envio ao fornecedor, recibo
  de venda, análise financeira da operação (recebido vs previsto, custo e resultado por
  passageiro, margem, status).
- **Orçamentos**: proposta como página (não PDF), edição sem gerar novo link, marca
  (logo/cores/WhatsApp/redes), histórico, mobile, modelo padrão para a equipe.
  **NÃO menciona notificação de visualização — nosso "sabe quando abriu" é diferencial.**
- **Viagens corporativas**: contas PJ, faturamento por empresa/período, boletos (PJBank),
  baixa automática, relatórios por centro de custo, histórico de compras, ranking de
  clientes, alteração pós-emissão (depende de integrações).

## O que já temos (2026-09-09)

Orçamentos: ~90% (link, edição viva, marca completa + assinatura do agente, histórico,
mobile). Falta: modelo/template de proposta. • Ficha 360°, funil configurável, financeiro
(vendas/comissões/parcelas), lembretes em régua, roteiro editorial, CSV só para IMPORTAR.

## Fases acordadas (nesta ordem)

| Fase | Escopo | Nota |
|---|---|---|
| **1. Fechar o orçamento** | Template de proposta (salvar como modelo / criar de modelo) + recibo de venda em PDF (`@react-pdf/renderer`) | Fecha 100% da página Orçamentos |
| **2. Dinheiro da viagem** | Resultado por viagem (venda − custo da opção aceita − comissão; realizado vs previsto), ranking de clientes nos Relatórios, exportação CSV (passageiros por viagem, vendas do período) | A "Análise de Operações" do Monde, versão solo |
| **3. Multiusuário (equipe)** | Better Auth organization: owner/membros por tenant, papéis, atribuição por agente (quem enviou/fechou), ranking e relatórios por vendedor. RLS continua por `tenant_id` — membros dividem o tenant | Desbloqueia "modelo padrão da equipe" e Studio R$ 199. Mira 2-4 pessoas — detalhe completo em `docs/MULTIUSUARIO_AGENCIAS.md` |
| **4. Corporativo (PJ)** | Conta PJ (empresa com N viajantes vinculados), centro de custo como atributo de venda + relatórios por centro, faturamento consolidado por empresa/período com boleto Asaas e baixa | O jogo do Monde, na nossa escala |
| **5. Excursão/grupo leve** | Negócio com múltiplos compradores, lista de passageiros consolidada, resultado da saída | Validar demanda com usuários antes de investir |
| **6. Por último (PO)** | Integrações reais (Wooba/Infotravel/Despegar) e NF-e | Adapter de cotação já existe (S12) |
| **7. Vitrine** (fit novo, 2026-09-10) | Página pública do agente (`/a/[slug]`): catálogo de ofertas (pacote/voo/hospedagem/transfer/serviço) montadas com os blocos do construtor, com preço e interesse do cliente via Google — o site que o agente solo não tem | Plano completo em `docs/FIT7_VITRINE.md`; absorve a meta Grupos (oferta com lugares) |

## Não fazer

Motor de reservas, app nativo, 90 integrações de uma vez, concorrência de template visual
(shadcn etc.) — continuam travados.
