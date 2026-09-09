import { csvPassageirosDoNegocio } from '@/server/exportacoes';
import { falhou, respostaDeErro } from '@/server/respostas';

/**
 * GET /api/export/passageiros/[dealId] — o CSV dos passageiros do negócio (fase 2).
 *
 * O arquivo que vai para o fornecedor: nome, tipo e documento DECIFRADO (a via da
 * casa — `encryptedText` decifra na leitura; chave nunca sai do servidor, nada vai
 * para log). Export com documento é AUDITADO dentro do helper. Sessão obrigatória;
 * negócio de outro tenant é 404, como em toda leitura da casa.
 *
 * `attachment` + nome datado — download de verdade, não aba do navegador: planilha
 * se guarda, link não.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;

  const resultado = await csvPassageirosDoNegocio(dealId);
  if (falhou(resultado)) {
    return respostaDeErro(resultado);
  }

  return new Response(resultado.data.conteudo, {
    status: 200,
    headers: {
      // BOM UTF-8 JÁ VEM NO CONTEÚDO (montarCsv) — o header é utf-8 e o Excel BR
      // abre acento certo no duplo clique.
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${resultado.data.nomeArquivo}"`,
      'Cache-Control': 'no-store',
    },
  });
}
