import {
  atualizarConteudoDoRoteiro,
  listarRoteiroDoNegocio as listarRoteiroDoNegocioNoServidor,
  obterConteudoDoRoteiro,
  type BlocoDoRoteiro,
  type RoteiroResumo,
  type ServiceResult,
} from "@/server";

/* =============================================================================
   Camada de chamada do roteiro — a costura entre as telas e o servidor
   -----------------------------------------------------------------------------
   Toda chamada de roteiro (RoteiroCard, editor) passa por aqui: uma linha por
   ação, nenhuma tela importa action de roteiro direto. Os wrappers existem para
   haver UM lugar que sabe compor as leituras — e para o dia em que um contrato
   mudar, a caça ser a este arquivo, não às telas.

   Contratos reais (`src/server/itineraries.ts`, rafa):
     - listarRoteiroDoNegocio(dealId)   → o resumo de UM negócio (sem teto 200);
     - obterConteudoDoRoteiro(dealId)   → o snapshot autenticado, MESMA forma
       que a escrita aceita — load → edit → save sem reshape;
     - atualizarConteudoDoRoteiro(dealId, blocos) → SÓ conteúdo; token, nome,
       datas e marca nunca passam; portaria do §4 recusa chave que cheire a
       custo/comissão/documento antes de abrir transação; idempotente (mesmo
       conteúdo = no-op, o autosave pode martelar).
   ========================================================================== */

/** O roteiro de um negócio COM o conteúdo — a forma que o editor edita. */
export type RoteiroParaEdicao = RoteiroResumo & { blocos: BlocoDoRoteiro[] };

/** O roteiro DE UM negócio — o `RoteiroCard` não carrega mais 200 e filtra no cliente. */
export async function listarRoteiroDoNegocio(
  dealId: string,
): Promise<ServiceResult<RoteiroResumo | null>> {
  return listarRoteiroDoNegocioNoServidor(dealId);
}

/** Duas leituras, uma ida de composição: resumo + snapshot. `null` = não há roteiro. */
export async function obterRoteiroParaEdicao(
  dealId: string,
): Promise<ServiceResult<RoteiroParaEdicao | null>> {
  const resumo = await listarRoteiroDoNegocioNoServidor(dealId);
  if (!resumo.ok) return resumo;
  if (!resumo.data) return { ok: true, data: null };
  const conteudo = await obterConteudoDoRoteiro(dealId);
  if (!conteudo.ok) return conteudo;
  return { ok: true, data: { ...resumo.data, blocos: conteudo.data ?? [] } };
}

/** A escrita do conteúdo — a assinatura é a do contrato; nada de mais nada passa. */
export async function salvarConteudoDoRoteiro(
  dealId: string,
  blocos: BlocoDoRoteiro[],
): Promise<ServiceResult<RoteiroResumo>> {
  return atualizarConteudoDoRoteiro(dealId, blocos);
}
