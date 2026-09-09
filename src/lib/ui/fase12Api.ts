import {
  criarPropostaDeTemplate,
  criarTemplateDeProposta,
  definirTemplatePadrao,
  listarTemplates,
  obterConteudoDoTemplate,
  rankingDeClientes,
  removerTemplate,
  resultadoDaViagem,
  type BlocoDeTemplate,
  type LinhaDoRanking,
  type ResultadoDaViagem,
  type TemplateResumo,
} from "@/server";

/* =============================================================================
   Fases 1 e 2 do Monde — a ponte, agora RETIRADA
   -----------------------------------------------------------------------------
   Esta rodada nasceu com o backend em forno: as telas falavam a língua final e
   ESTE arquivo sondava o barril `@/server` em runtime, devolvendo uma recusa
   honesta ("ainda não está no ar") enquanto os contratos não chegavam. Chegaram
   — `proposalTemplates.ts`, `resultado.ts`, `ranking.ts` saíram no barril e as
   rotas `/api/recibos/[vendaId]` e `/api/export/…` existem — então a sonda foi
   aposentada no mesmo dia, como o plano previa: agora é re-export estático
   (nenhuma tela mudou uma linha) mais os três montadores de URL, que são
   endereço e não chamada, e por isso moram aqui e não no servidor.

   Os tipos são os REAIS do servidor. `ResultadoDaViagem` real carrega mais do
   que a UI lê (`dealId`, `saleId`, `currency`) — o que as telas somam e exibem
   é o `ValoresDaViagem` abaixo, os seis números somáveis do item.
   ========================================================================== */

export {
  listarTemplates,
  obterConteudoDoTemplate,
  criarTemplateDeProposta,
  removerTemplate,
  definirTemplatePadrao,
  criarPropostaDeTemplate,
  resultadoDaViagem,
  rankingDeClientes,
  type BlocoDeTemplate,
  type LinhaDoRanking,
  type ResultadoDaViagem,
  type TemplateResumo,
};

/** Os seis números que a ficha exibe e o relatório soma — todos somáveis. */
export type ValoresDaViagem = Pick<
  ResultadoDaViagem,
  | "valorVendaCents"
  | "custoPrevistoCents"
  | "comissaoPrevistaCents"
  | "recebidoCents"
  | "aReceberCents"
  | "margemPrevistaCents"
>;

/* ------------------------------------------------------------- as três rotas */

/** Recibo da venda — PDF inline, abre em nova aba (não leva a agente para fora da ficha). */
export function urlDoRecibo(vendaId: string): string {
  return `/api/recibos/${vendaId}`;
}

/** Passageiros da viagem — o CSV que vai para o fornecedor, com nome e documento. */
export function urlDoCsvDePassageiros(dealId: string): string {
  return `/api/export/passageiros/${dealId}`;
}

/** Vendas do recorte — `de`/`ate` em `AAAA-MM-DD` (mesma gramática de `limitesDoPeriodo`). */
export function urlDoCsvDeVendas(periodo: { de?: string; ate?: string }): string {
  const params = new URLSearchParams();
  if (periodo.de) params.set("de", periodo.de);
  if (periodo.ate) params.set("ate", periodo.ate);
  const query = params.toString();
  return `/api/export/vendas${query ? `?${query}` : ""}`;
}
