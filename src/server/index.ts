/**
 * Camada de serviço / Server Actions.
 *
 * O padrão, em quatro linhas:
 *   1. `tenantId` vem de `requireAuthContext()` — da sessão, nunca de argumento;
 *   2. toda query dentro de `withTenant(tenantId, ...)`;
 *   3. entrada validada com zod antes de tocar no banco;
 *   4. erro volta como dado (`ServiceResult`), com mensagem pronta para a interface.
 */

export { ServiceError, comoResultado, type ServiceResult, type ServiceErrorCode } from './errors';
export {
  listarContatos,
  buscarContatoPorCpf,
  obterContato,
  criarContato,
  atualizarContato,
  arquivarContato,
  restaurarContato,
  excluirContato,
  obterDocumentoDoContato,
  type ContatoInput,
  type ContatoPatch,
  type ContatoResumo,
  type ContatoDetalhe,
  type FiltroContatos,
} from './contacts';
export {
  listarViajantes,
  obterViajante,
  buscarViajantePorCpf,
  criarViajante,
  atualizarViajante,
  excluirViajante,
  obterDocumentoDoViajante,
  listarPassaportesVencendo,
  type ViajanteInput,
  type ViajantePatch,
  type ViajanteResumo,
  type FiltroViajantes,
} from './travelers';
export {
  obterTenantAtual,
  atualizarMarca,
  criarTenant,
  type MarcaInput,
  type TenantAtual,
} from './tenants';
export {
  pravisualizarImportacao,
  confirmarImportacao,
  listarImportacoes,
  obterRelatorioDeImportacao,
  type Mapeamento,
  type MapeamentoColuna,
  type CampoContatoImportavel,
  type PreviaImportacao,
  type RelatorioImportacao,
  type ItemRelatorio,
  type ImportacaoResumo,
} from './imports';
export {
  gerarAlertas,
  gerarAlertasDoTenantAtual,
  listarTarefas,
  concluirTarefa,
  type TarefaResumo,
  type ResultadoAlertasTenant,
  type ResultadoAlertasGeral,
} from './alerts';
export {
  rodarFilaDeFollowups,
  gerarFollowupsDaProposta,
  listarTarefasDeHoje,
  type ResultadoFilaTenant,
  type ResultadoFilaGeral,
  type TarefaDeHoje,
} from './followups';
export {
  listarPropostas,
  listarNegocios,
  criarPropostaAPartirDoNegocio,
  obterPropostaParaEdicao,
  atualizarProposta,
  enviarProposta,
  arquivarProposta,
  restaurarProposta,
  criarOpcao,
  atualizarOpcao,
  excluirOpcao,
  reordenarOpcoes,
  criarBloco,
  atualizarBloco,
  excluirBloco,
  reordenarBlocos,
  inserirItemDaBibliotecaComoBloco,
  enviarImagemDaProposta,
  type PropostaMeta,
  type OpcaoEdicao,
  type BlocoEdicao,
  type PropostaEdicao,
  type PropostaResumo,
  type NegocioResumo,
  type FiltroPropostas,
  type PropostaMetaPatch,
  type OpcaoInput,
  type OpcaoPatch,
  type BlocoInput,
  type BlocoPatch,
  type BlocoKind,
  type ItemReordenacao,
} from './proposals';
export {
  listarBiblioteca,
  obterItemDaBiblioteca,
  criarItemNaBiblioteca,
  atualizarItemDaBiblioteca,
  excluirItemDaBiblioteca,
  type ItemBibliotecaKind,
  type ItemBibliotecaInput,
  type ItemBibliotecaPatch,
  type ItemBibliotecaResumo,
  type FiltroBiblioteca,
} from './library';
export {
  obterPropostaPublica,
  registrarVisitaProposta,
  aceitarOpcaoPublica,
  type PropostaPublica,
  type PropostaPublicaBrand,
  type PropostaPublicaMeta,
  type PropostaPublicaOpcao,
  type PropostaPublicaBloco,
  type RegistrarVisitaInput,
  type AceitarOpcaoInput,
} from './publicProposals';
export {
  listarAberturasRecentes,
  type AberturaProposta,
  type FiltroAberturas,
} from './aberturas';
export {
  listarNegociosDoFunil,
  moverEstagioDoNegocio,
  criarNegocio,
  obterNegocio,
  listarNegociosParados,
  obterResumoDoPipeline,
  type DealStage,
  type EstagioDeFunil,
  type NegocioDoFunil,
  type NegocioMovido,
  type CriarNegocioInput,
  type AtividadeDoNegocio,
  type NegocioDetalhe,
  type NegocioParado,
  type ResumoDeParados,
  type ResumoDoPipeline,
} from './deals';
export { COLUNAS_DO_FUNIL } from './dealStages';
export {
  converterPropostaEmVenda,
  listarVendas,
  obterVenda,
  atualizarVenda,
  atualizarStatusComissao,
  excluirVenda,
  listarParcelas,
  criarParcela,
  gerarParcelasDaVenda,
  atualizarParcela,
  marcarParcelaPaga,
  excluirParcela,
  type ComissaoStatus,
  type ParcelaStatus,
  type VendaResumo,
  type ParcelaResumo,
  type FiltroVendas,
  type ConverterPropostaInput,
  type VendaPatch,
  type ParcelaInput,
  type GerarParcelasInput,
  type ParcelaPatch,
} from './sales';
