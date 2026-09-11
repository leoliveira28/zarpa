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
  obterHistoricoDoContato,
  type HistoricoDoContato,
  type ContatoInput,
  type ContatoPatch,
  type ContatoResumo,
  type ContatoDetalhe,
  type FiltroContatos,
} from './contacts';
export {
  listarViajantes,
  listarViajantesDoNegocio,
  type ViajanteDoNegocio,
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
  criarConta,
  type CriarContaInput,
  type ContaCriada,
} from './signup';
// ATENÇÃO: `subscriptionGate.ts` NÃO é reexportado aqui de propósito. Não é arquivo
// `'use server'` e importa o cliente do Postgres — reexportar pelo barril arrasta o
// driver para dentro do grafo de Client Components (o build quebra). Quem precisa do
// gate ou de `vereditoDaAssinatura` importa de '@/server/subscriptionGate' direto.
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
  listarProximasTarefas,
  criarTarefa,
  type ResultadoFilaTenant,
  type ResultadoFilaGeral,
  type TarefaDeHoje,
  type CriarTarefaInput,
} from './followups';
export {
  listarPropostas,
  listarNegocios,
  criarPropostaAPartirDoNegocio,
  obterPropostaParaEdicao,
  atualizarProposta,
  enviarProposta,
  marcarPropostaComoAceita,
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
  atualizarNegocio,
  // 0020 — a composição de clientes do negócio (casal, família, amigos). Ver §15 do
  // handoff para a Nina: os editores de proposta e de negócio chamam estas duas actions.
  adicionarClienteAoNegocio,
  removerClienteDoNegocio,
  // 0021 — leitura LEVE da mesma lista: o editor reconcilia sem carregar o negócio
  // inteiro (`obterNegocio`).
  listarClientesDoNegocio,
  listarNegociosParados,
  obterResumoDoPipeline,
  type DealStage,
  type DestinoDeEstagio,
  type EstagioDeFunil,
  type NegocioDoFunil,
  type NegocioMovido,
  type CriarNegocioInput,
  type NegocioPatch,
  type AtividadeDoNegocio,
  type NegocioDetalhe,
  type ClienteDoNegocio,
  type ClientesDoNegocio,
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
export {
  obterResumoDoMes,
  exportarResumoDoMesCsv,
  type ResumoDoMes,
  type ResumoVendasDoMes,
  type ResumoComissaoDoMes,
  type ConversaoDePropostas,
  type PropostaParada,
  type ResumoDePropostasParadas,
  type ResumoDoMesCsv,
} from './dashboard';
export {
  obterAssinaturaAtual,
  listarPlanos,
  trocarPlano,
  cancelarAssinatura,
  alterarAssentos,
  listarFaturas,
  processarWebhookAsaas,
  type PlanoResumo,
  type StatusAssinatura,
  type AssinaturaAtual,
  type StatusFatura,
  type FaturaResumo,
  type TrocarPlanoInput,
  type AlterarAssentosInput,
} from './billing';
export { verificarWebhookAsaas } from '@/lib/asaas/client';
export {
  listarIntegracoes,
  criarIntegracao,
  removerIntegracao,
  buscarHoteis,
  obterCotacao,
  type Provider,
  type Credencial,
  type BuscarHoteisInput,
  type HotelBusca,
  type CotacaoInput,
  type Cotacao,
  type ResultadoBuscaHoteis,
  type ResultadoCotacao,
  type IntegracaoResumo,
  type CriarIntegracaoInput,
} from './integrations';
export {
  gerarRoteiro,
  listarRoteiros,
  // Editor de roteiro: leitura apontada + escrita de SÓ conteúdo (`blocks_snapshot`).
  // O link (`publicToken`) e os dados comerciais nunca mudam por aqui.
  listarRoteiroDoNegocio,
  obterConteudoDoRoteiro,
  obterPropostaAceitaDoNegocio,
  atualizarConteudoDoRoteiro,
  type RoteiroResumo,
  type BlocoDoRoteiro,
  type GerarRoteiroInput,
  type PropostaAceitaDoNegocio,
} from './itineraries';
export {
  obterRoteiroPublico,
  type RoteiroPublico,
  type RoteiroPublicoMeta,
  type RoteiroPublicoBrand,
  type RoteiroPublicoBloco,
} from './publicItineraries';
export {
  listarEmViagem,
  type EmViagemGrupos,
  type ViagemEmCurso,
  type PartidaProxima,
  type ViagemAndamento,
  type RetornoRecente,
} from './viagens';
export {
  resumoDoPeriodo,
  type ResumoDoPeriodo,
  type OrigemDeContato,
  type MotivoDePerda,
  type QuebraPorVendedor,
} from './money';
// Fase 3 — multiusuário. `escopoDaSessao.ts` NÃO entra no barril de propósito (arquivo
// puro, sem `'use server'`; a decisão de escopo é do service layer, não da tela).
export {
  listarEquipe,
  type EquipeResumo,
  type MembroDaEquipe,
  type ConviteDaEquipe,
  type PapelDoMembro,
} from './equipe';
// Só TIPOS de `./periodo`: reexportar a função puxaria zod para o grafo de Client
// Components que importa o barril (mesmo cuidado do `subscriptionGate` acima).
export type { PeriodoInput, Periodo } from './periodo';
// S15/S16 — funil configurável. Desde a 0016 `deals.stage_id` é FK para `pipeline_stages`:
// `criarNegocio({ stageId })` e `moverEstagioDoNegocio(id, { stageId })` aceitam a coluna
// pelo id, e `listarNegociosDoFunil` devolve `stageId`/`stageLabel`/`stagePosition`. O que
// falta é a UI: `/funil` ainda monta as colunas por `COLUNAS_DO_FUNIL` (`dealStages.ts`).
// Ver `src/server/pipelineStages.ts`, a 0015 e a 0016.
// `pipelineStagesDefaults.ts` NÃO é reexportado aqui (mesma razão do `subscriptionGate`:
// módulo sem `'use server'` que importa o schema/driver arrasta o driver para o grafo de
// Client Components e quebra o build).
export {
  listarEstagios,
  criarEstagio,
  renomearEstagio,
  reordenarEstagios,
  arquivarEstagio,
  reabrirEstagio,
  type EstagioDoFunil,
  type CriarEstagioInput,
  type RenomearEstagioInput,
  type ReordenarEstagiosInput,
  type ArquivarEstagioInput,
  type ReabrirEstagioInput,
} from './pipelineStages';
// Rodada Monde — fases 1 e 2 (templates, dinheiro por viagem, ranking).
// `recibos.ts`/`exportacoes.ts` NÃO entram no barril de propósito: são helpers de
// ROTA (não actions) e os tipos deles viajam com as rotas `/api/recibos/…` e
// `/api/export/…` — reexportá-los sugeriria que são chamadas de UI.
export {
  listarTemplates,
  obterConteudoDoTemplate,
  criarTemplateDeProposta,
  removerTemplate,
  definirTemplatePadrao,
  criarPropostaDeTemplate,
  type TemplateResumo,
  type BlocoDeTemplate,
} from './proposalTemplates';
export {
  resultadoDaViagem,
  type ResultadoDaViagem,
} from './resultado';
export {
  rankingDeClientes,
  vendasPorCentroDeCusto,
  type LinhaDoRanking,
  type LinhaPorCentroDeCusto,
} from './ranking';
export {
  listarCentrosDeCusto,
  criarCentroDeCusto,
  renomearCentroDeCusto,
  arquivarCentroDeCusto,
  reabrirCentroDeCusto,
  type CentroDeCusto,
  type CriarCentroDeCustoInput,
  type RenomearCentroDeCustoInput,
  type ArquivarCentroDeCustoInput,
  type ReabrirCentroDeCustoInput,
} from './costCenters';
export {
  criarFatura,
  listarFaturasDoCliente,
  obterFatura,
  emitirBoletoDaFatura,
  type FaturaDoCliente,
  type DetalheDaFaturaDoCliente,
  type CriarFaturaInput,
  type EmitirBoletoInput,
} from './invoices';
export {
  criarGrupo,
  listarGrupos,
  obterGrupo,
  atualizarGrupo,
  adicionarMembroAoGrupo,
  removerMembroDoGrupo,
  type GrupoResumo,
  type GrupoDetalhe,
  type MembroDoGrupo,
  type GrupoStatus,
  type CriarGrupoInput,
  type AtualizarGrupoInput,
  type MembroInput,
} from './groups';
export {
  criarOferta,
  listarOfertas,
  obterOferta,
  atualizarOferta,
  publicarOferta,
  reordenarOfertas,
  urlDaVitrine,
  type OfertaResumo,
  type BlocoDeOferta,
} from './offers';
export {
  grupoDoNegocio,
  parcelasDoGrupo,
  resumoDosGrupos,
  type ParcelasDoGrupo,
} from './groups';
export {
  registrarInteresseOferta,
  listarInteressadosDaOferta,
  type InteressadoDaOferta,
} from './offers';
