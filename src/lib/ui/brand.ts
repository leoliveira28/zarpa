/**
 * Nome de exibição do produto.
 *
 * O CLAUDE.md manda esse valor viver em `src/lib/config.ts`, que ainda não
 * existe e está FORA da minha fronteira de arquivos. Deixei aqui, dentro de
 * `src/lib/ui/**`, e abri o pedido em `docs/handoffs/nina-para-po.md`.
 * Quando `src/lib/config.ts` existir, este arquivo passa a reexportar de lá e
 * some — nenhuma tela precisa mudar, todas importam daqui.
 */
export const APP_NAME = "Zarpa";

/** Descrição curta, usada em <title> e em estados vazios. */
export const APP_TAGLINE = "Propostas de viagem em 2 minutos";
