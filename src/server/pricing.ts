/**
 * Matemática pura de precificação da proposta. Fora de `proposals.ts` porque esse arquivo
 * tem `'use server'` — e um módulo `'use server'` só pode exportar função ASYNC (mesma
 * regra documentada em `audit.ts`); isto aqui é síncrono de propósito.
 *
 * O parcelamento NÃO é recalculado pelo servidor a cada leitura: `installments` e
 * `installment_cents` são gravados como o agente digitou, porque juros de cartão às vezes
 * fazem `installment_cents * installments` não bater exatamente com `price_cents` — e essa
 * diferença é legítima, não um bug para "corrigir" na escrita. `sugerirValorParcela` existe
 * só para a INTERFACE mostrar um palpite inicial antes do agente digitar por cima.
 */

/**
 * Palpite de parcela sem juros: preço dividido em N, arredondado para cima no centavo —
 * nunca para baixo, porque `parcelas * valor` tem que cobrir `preco` no mínimo (o
 * arredondamento sobra no agente, nunca falta pro cliente).
 */
export function sugerirValorParcelaCents(precoVendaCents: number, parcelas: number): number {
  if (!Number.isInteger(parcelas) || parcelas < 1) return precoVendaCents;
  return Math.ceil(precoVendaCents / parcelas);
}

/** `priceCents - costCents`, o palpite inicial de `commissionCents` numa opção nova. */
export function sugerirComissaoCents(precoVendaCents: number, precoCustoCents: number): number {
  return Math.max(0, precoVendaCents - precoCustoCents);
}
