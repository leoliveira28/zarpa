import { textoComAssinatura, type MarcaParaAssinatura } from "@/lib/assinatura";

/* =============================================================================
   Mensagem que viaja com o link do roteiro
   -----------------------------------------------------------------------------
   As REGRAS da assinatura ("Agência · por Agente" + "via {APP_NAME}", o que
   entra quando falta nome) moram em `src/lib/assinatura.ts` — arquivo puro do
   rafa, testado em `tests/brand/assinatura.test.ts`. Nada delas se repete aqui:
   este módulo é só a CÓPIA da mensagem que o botão de envio do editor de
   roteiro monta (`wa.me/?text=…`, share-picker — a agente escolhe a conversa;
   o número do cliente não precisa passar pela URL).

   A página pública assina com a marca CONGELADA no snapshot; a mensagem sai
   com a marca de AGORA, que é a que a agente escolheria ao mandar. Os dois
   usam o mesmo helper, então o formato nunca diverge.
   ========================================================================== */

/** A mensagem do envio: contexto primeiro, link, assinatura embaixo. */
export function mensagemDoRoteiro(
  roteiro: { title: string },
  url: string,
  marca: MarcaParaAssinatura,
): string {
  return textoComAssinatura(`Aqui está o roteiro da viagem "${roteiro.title}": ${url}`, marca);
}
