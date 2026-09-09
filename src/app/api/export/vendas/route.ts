import { csvVendasDoPeriodo } from '@/server/exportacoes';
import { falhou, respostaDeErro } from '@/server/respostas';

/**
 * GET /api/export/vendas?de=&ate= — o CSV das vendas do período (fase 2), o arquivo
 * que vai para o contador. `de`/`ate` em `AAAA-MM-DD`, mesma gramática de período do
 * resto do produto (`resolverPeriodo`: ausente = mês corrente, uma ponta só = recusa
 * com a correção).
 *
 * Sem documento (PII) no conteúdo — por isso NÃO audita (audit é para export com
 * documento; ver `exportacoes.ts`). Sessão obrigatória; leitura não passa pelo gate
 * de dunning, como toda leitura da casa.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const resultado = await csvVendasDoPeriodo({
    de: searchParams.get('de') ?? undefined,
    ate: searchParams.get('ate') ?? undefined,
  });
  if (falhou(resultado)) {
    return respostaDeErro(resultado);
  }

  return new Response(resultado.data.conteudo, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${resultado.data.nomeArquivo}"`,
      'Cache-Control': 'no-store',
    },
  });
}
