/**
 * Nome de exibição do produto.
 *
 * O token mora em `src/lib/config.ts` (que hoje existe — o pedido antigo,
 * registrado no handoff para o PO, foi atendido). Este arquivo só REEXPORTA:
 * nenhuma tela precisa mudar, todas continuam importando daqui. A descrição
 * curta é de interface (estados vazios e <title>), então segue aqui.
 */
export { APP_NAME } from "@/lib/config";

/** Descrição curta, usada em <title> e em estados vazios. */
export const APP_TAGLINE = "Propostas de viagem em 2 minutos";
