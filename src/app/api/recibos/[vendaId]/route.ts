import { dadosDoRecibo } from '@/server/recibos';
import { renderizarReciboPdf } from '@/lib/pdf/recibo';
import { falhou, respostaDeErro } from '@/server/respostas';

/**
 * GET /api/recibos/[vendaId] — o recibo de venda em PDF (fase 1 do roadmap).
 *
 * Rota, não Server Action: recibo é ARQUIVO — link que abre no navegador (`inline`,
 * o PDF abre em aba e a agente não perde a ficha) e que o WhatsApp/contador recebe
 * como documento. Sessão Better Auth obrigatória: o tenant vem da SESSÃO dentro de
 * `dadosDoRecibo` (nunca de parâmetro) e o RLS resolve o resto — venda de outro
 * tenant é 404, idêntico a "não existe", sem revelar existência.
 *
 * Erro também é envelope JSON (`respostas.ts`): sucesso é PDF, erro é a gramática
 * da casa com a correção junto.
 *
 * Fase 3: o render é da lib `@react-pdf/renderer` e por isso ASSÍNCRONO — a única
 * mudança nesta rota em toda a troca é o `await` abaixo. Contrato, headers e
 * auditoria intocados.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ vendaId: string }> }) {
  const { vendaId } = await ctx.params;

  const resultado = await dadosDoRecibo(vendaId);
  if (falhou(resultado)) {
    return respostaDeErro(resultado);
  }

  const pdf = await renderizarReciboPdf(resultado.data);

  return new Response(pdf, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="recibo-${resultado.data.numero}.pdf"`,
      // Recibo é sempre regenerado — cache de PDF de dinheiro é bug esperando dia.
      'Cache-Control': 'no-store',
    },
  });
}
