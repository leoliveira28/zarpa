/* =============================================================================
   WhatsApp — o único canal de saída do produto
   -----------------------------------------------------------------------------
   `contacts.whatsapp` é o texto COMO FOI DIGITADO no cadastro (max 32, sem
   normalização — ver o comentário do campo em `src/server/viagens.ts`). O link
   `wa.me` precisa de dígitos com código do país, então a interface constrói na
   hora de montar o CTA — e prefere NÃO oferecer o botão a oferecer um link
   quebrado: um `wa.me` com lixo abre a conversa com o número errado, que é
   pior que não abrir.
   ========================================================================== */

/**
 * Link `https://wa.me/...` a partir do WhatsApp digitado no cadastro.
 * `null` quando não dá para formar um número confiável (vazio, ou menos de 10
 * dígitos — um fixo sem DDD, um ramal, um "falar com a filha").
 */
export function waMeLink(
  whatsapp: string | null | undefined,
  texto?: string,
): string | null {
  const digitos = (whatsapp ?? "").replace(/\D/g, "");
  if (digitos.length < 10 || digitos.length > 15) return null;
  const base = `https://wa.me/${digitos}`;
  return texto ? `${base}?text=${encodeURIComponent(texto)}` : base;
}

/**
 * Mensagem pronta do ÚNICO CTA da seção "Em viagem" (/hoje): pedir depoimento
 * de quem já voltou. Tom de agente, sem gênero forçado, curta o bastante para
 * ser respondida num bilhete — a mesma doutrina do `suggestedMessage` de
 * `listarTarefasDeHoje` (S8): um botão "abrir WhatsApp" resolve sem editor.
 */
export function mensagemDepoimento(
  contactName: string,
  destination: string | null,
): string {
  const destino = destination ? ` para ${destination}` : "";
  return [
    `Olá, ${contactName}! Como foi a viagem${destino}?`,
    "Se puder me mandar um depoimento curto sobre como foi, ajuda demais quem está planejando a próxima.",
    "Fico à disposição para o que precisar!",
  ].join(" ");
}
