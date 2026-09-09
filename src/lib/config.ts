/**
 * Config de produto — o token do nome comercial do app.
 *
 * O CLAUDE.md manda o nome comercial viver AQUI, sob o token `APP_NAME` (o codinome de
 * trabalho não deve se espalhar pela interface — nunca use a string crua em tela).
 * Nomes de exibição são constantes de código, não configuração de ambiente: se fosse
 * `process.env`, servidor e navegador poderiam divergir (variável que não é
 * `NEXT_PUBLIC_*` não chega ao cliente) e a mesma tela assinaria diferente nos dois
 * lados. Mudou o nome comercial, muda esta linha — num commit só, com o bump de
 * `src/lib/ui/brand.ts` (que passa a reexportar daqui).
 */

/** Nome de exibição do produto — "via {APP_NAME}" na assinatura, títulos, estados vazios. */
export const APP_NAME = 'Zarpa';
