'use server';

import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, deals, pipelineStages, proposalOptions, receivables, sales } from '@/db/schema';
import { withTenant } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { propostaAceitaRecente } from './itineraries';

/**
 * O dinheiro de UMA viagem fechada — a "Análise de Operações" do Monde, versão solo
 * (fase 2 do roadmap).
 *
 * A PERGUNTA que esta action responde: "nessa viagem que fechei, eu ganho quanto?" —
 * e ela responde com PREVISTO e REALIZADO lado a lado:
 *
 *   valorVendaCents      o preço combinado
 *   custoPrevistoCents   o custo (fornecedor)
 *   comissaoPrevistaCents a comissão esperada
 *   recebidoCents        o que já caiu na conta (parcelas pagas)
 *   aReceberCents        o que falta cair
 *   margemPrevistaCents  valorVenda − custoPrevisto (o número que decide se vale vender)
 *
 * A FONTE do "previsto" é uma cascata, da mais confiável para a mais crua — cada nível
 * é o que a agente efetivamente comprometeu:
 *
 *   1. VENDA LANÇADA — a `sales` do negócio é a fotografia do fechado (converterPropostaEmVenda
 *      congela nela o valor/custo/comissão do instante do aceite). Existe → é a verdade.
 *   2. PROPOSTA ACEITA — sem venda lançada, a opção aceita (`propostaAceitaRecente`, a
 *      MESMA regra do roteiro) tem preço/custo/comissão. É a mesma verdade num grau anterior.
 *   3. O NEGÓCIO — nada aceito nem lançado, sobram `deals.value_cents/cost_cents/
 *      commission_cents`, que a agente digitou à mão. Melhor que zero; nunca inventado.
 *
 * Recusa negócio ABERTO com CONFLITO: enquanto o negócio não fechou, "resultado" é
 * adivinhação — a ficha só pede quando `isWon`, e quem manda aqui é o funil (coluna
 * `is_won` de `pipeline_stages` via `deals.stage_id`, 0016 — não o literal do enum).
 *
 * Agregação (soma de parcelas) em JAVASCRIPT de propósito: as colunas são `bigint`
 * `mode: 'number'` e voltam número no select de coluna; `sum()` em SQL voltaria string
 * pelo driver — misturar as duas escalas é bug silencioso de centavo.
 */

export type ResultadoDaViagem = {
  dealId: string;
  /** Venda lançada que fotografa o previsto — `null` quando o previsto veio do aceite ou do negócio. */
  saleId: string | null;
  currency: string;
  valorVendaCents: number;
  custoPrevistoCents: number;
  comissaoPrevistaCents: number;
  recebidoCents: number;
  aReceberCents: number;
  margemPrevistaCents: number;
  /** Espelho do estado da comissão na venda; `'prevista'` quando ainda não há venda. */
  comissaoStatus: 'prevista' | 'recebida' | 'atrasada';
  /**
   * Quebra por comprador (Fase 5a, 0024) — a saída com cobrança individual. Só
   * existe quando HÁ parcelas etiquetadas; viagem de um comprador só vem vazia
   * (a seção nem nasce na tela).
   */
  porComprador: Array<{
    contactId: string;
    nome: string;
    pagoCents: number;
    aPagarCents: number;
  }>;
};

const resultadoInput = z.object({ dealId: z.uuid('Negócio inválido') });

export async function resultadoDaViagem(dealId: string): Promise<ServiceResult<ResultadoDaViagem>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const parsed = resultadoInput.safeParse({ dealId });
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
        campo: primeiro?.path.join('.'),
        correcao: 'Corrigir e tentar de novo',
      });
    }

    return withTenant(tenantId, async (tx) => {
      // isWon vem do funil, como no roteiro — o enum `deals.stage` é espelho, não fonte.
      const [negocio] = await tx
        .select({
          id: deals.id,
          title: deals.title,
          valueCents: deals.valueCents,
          costCents: deals.costCents,
          commissionCents: deals.commissionCents,
          currency: deals.currency,
          isWon: pipelineStages.isWon,
        })
        .from(deals)
        .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
        .where(eq(deals.id, parsed.data.dealId))
        .limit(1);

      if (!negocio) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse negócio não existe mais.', {
          correcao: 'Voltar para o funil',
        });
      }

      if (!negocio.isWon) {
        throw new ServiceError(
          'CONFLITO',
          `Só dá para ver o resultado de viagem fechada — "${negocio.title}" está aberta.`,
          { correcao: 'Mover o negócio para Fechada antes' },
        );
      }

      // Fonte 1 — a venda lançada. Um negócio fecha uma venda; se um dia houver mais de
      // uma, a mais recente é a fotografia atual (mesmo critério de `listarVendas`).
      const [venda] = await tx
        .select({
          id: sales.id,
          valorBrutoCents: sales.valorBrutoCents,
          custoCents: sales.custoCents,
          comissaoPrevistaCents: sales.comissaoPrevistaCents,
          comissaoStatus: sales.comissaoStatus,
        })
        .from(sales)
        .where(eq(sales.dealId, negocio.id))
        .orderBy(desc(sales.createdAt))
        .limit(1);

      let valorVendaCents: number;
      let custoPrevistoCents: number;
      let comissaoPrevistaCents: number;
      let comissaoStatus: ResultadoDaViagem['comissaoStatus'];
      let saleId: string | null = null;

      if (venda) {
        saleId = venda.id;
        valorVendaCents = venda.valorBrutoCents;
        custoPrevistoCents = venda.custoCents;
        comissaoPrevistaCents = venda.comissaoPrevistaCents;
        comissaoStatus = venda.comissaoStatus;
      } else {
        // Fonte 2 — a opção aceita. Mesma regra de escolha do roteiro.
        const proposta = await propostaAceitaRecente(tx, negocio.id);
        if (proposta) {
          const [opcao] = await tx
            .select({
              priceCents: proposalOptions.priceCents,
              costCents: proposalOptions.costCents,
              commissionCents: proposalOptions.commissionCents,
            })
            .from(proposalOptions)
            .where(eq(proposalOptions.id, proposta.acceptedOptionId))
            .limit(1);

          if (opcao) {
            valorVendaCents = opcao.priceCents;
            custoPrevistoCents = opcao.costCents;
            comissaoPrevistaCents = opcao.commissionCents;
          } else {
            // Aceite apontando para opção que sumiu (não deve acontecer — FK RESTRICT? —
            // mas jsonb/estado legado ensina humildade): cai para o negócio.
            valorVendaCents = negocio.valueCents;
            custoPrevistoCents = negocio.costCents;
            comissaoPrevistaCents = negocio.commissionCents;
          }
        } else {
          // Fonte 3 — o que a agente digitou no negócio.
          valorVendaCents = negocio.valueCents;
          custoPrevistoCents = negocio.costCents;
          comissaoPrevistaCents = negocio.commissionCents;
        }
        comissaoStatus = 'prevista';
      }

      // Realizado — só existe com venda lançada (parcelas são da venda).
      let recebidoCents = 0;
      let aReceberCents = 0;

      let porComprador: ResultadoDaViagem['porComprador'] = [];

      if (venda) {
        const parcelas = await tx
          .select({
            status: receivables.status,
            valorCents: receivables.valorCents,
            contactId: receivables.contactId,
            comprador: contacts.name,
          })
          .from(receivables)
          .leftJoin(contacts, eq(contacts.id, receivables.contactId))
          .where(eq(receivables.saleId, venda.id));

        // A quebra só existe com etiqueta — soma por comprador as vivas, na mesma
        // gramática do Map do ranking (Fase 5a). Sem etiqueta nenhuma, seção nula.
        const porContato = new Map<string, { nome: string; pago: number; aPagar: number }>();
        for (const p of parcelas) {
          if (!p.contactId || p.status === 'cancelado') continue;
          let entrada = porContato.get(p.contactId);
          if (!entrada) {
            entrada = { nome: p.comprador ?? '', pago: 0, aPagar: 0 };
            porContato.set(p.contactId, entrada);
          }
          if (p.status === 'pago') entrada.pago += p.valorCents;
          if (p.status === 'pendente' || p.status === 'atrasado') entrada.aPagar += p.valorCents;
        }
        porComprador = [...porContato.entries()]
          .map(([contactId, e]) => ({ contactId, nome: e.nome, pagoCents: e.pago, aPagarCents: e.aPagar }))
          // Maior pendência primeiro — é a cobrança do dia.
          .sort((a, b) => b.aPagarCents - a.aPagarCents || b.pagoCents - a.pagoCents);

        const vivas = parcelas.filter((p) => p.status !== 'cancelado');
        recebidoCents = vivas
          .filter((p) => p.status === 'pago')
          .reduce((total, p) => total + p.valorCents, 0);

        aReceberCents =
          vivas.length > 0
            ? vivas
                .filter((p) => p.status === 'pendente' || p.status === 'atrasado')
                .reduce((total, p) => total + p.valorCents, 0)
            : // Venda sem parcelas geradas: o que falta é o total menos o que já entrou.
              Math.max(valorVendaCents - recebidoCents, 0);
      }

      return {
        dealId: negocio.id,
        saleId,
        currency: negocio.currency,
        valorVendaCents,
        custoPrevistoCents,
        comissaoPrevistaCents,
        recebidoCents,
        aReceberCents,
        margemPrevistaCents: valorVendaCents - custoPrevistoCents,
        comissaoStatus,
        porComprador,
      } satisfies ResultadoDaViagem;
    });
  });
}
