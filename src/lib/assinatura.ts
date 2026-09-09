/**
 * A assinatura da marca — as linhas que fecham toda comunicação que chega na ponta:
 *
 *   Volta ao Mundo · por Marina Albuquerque
 *   via Zarpa
 *
 * Uma função só, de propósito. Antes dela, o "nome da agência" e o "nome do agente"
 * seriam montados de um jeito diferente em cada tela — e a primeira tela que esquecer
 * o agente (ou inventar outro separador) quebra a promessa do produto: a comunicação
 * do agente independente assina com a marca DELE, sempre igual.
 *
 * É ARQUIVO PURO de propósito (sem `'use server'`, sem banco, sem driver): é importado
 * tanto por Server Components (páginas públicas) quanto por Client Components (copy do
 * `?text=` do WhatsApp). Por isso NÃO é reexportado pelo barril `@/server` — módulo
 * importado por cliente não pode sair de arquivo `'use server'` (mesma lição do
 * `subscriptionGate`).
 *
 * As entradas aceitam os dois nomes que a marca tem no sistema: `brandName` (o campo de
 * `tenants`/`TenantAtual`) e `name` (a chave do payload público de `/p/` e `/r/`). É
 * para poder chamar `assinaturaDaMarca(brand)` direto com o objeto que cada lado já tem
 * na mão — e para NINGUÉM precisar lembrar qual dos dois nomes vem de onde. `null`,
 * `undefined` e `''` significam a mesma coisa: "não configurado".
 */
import { APP_NAME } from './config';

// Reexportado porque o consumo do token ("via {APP_NAME}") acontece fora daqui
// também — quem assina importa de um lugar só (mesmo desenho do helper).
export { APP_NAME };

/** Separador da linha principal — o mesmo do pedido de produto: "Agência · por Agente". */
const SEPARADOR = ' · ';

export type MarcaParaAssinatura = {
  /** Nome da agência no cadastro (`tenants.brand_name`). */
  brandName?: string | null;
  /** O MESMO nome, como vem no payload público (`brand.name`). */
  name?: string | null;
  /** Nome do agente para exibição (`tenants.agent_display_name`). Ausente/null/'' = a
   * assinatura fica só com o nome da agência. */
  agentDisplayName?: string | null;
};

function texto(valor: string | null | undefined): string {
  return (valor ?? '').trim();
}

/**
 * Linha principal: `"Volta ao Mundo · por Marina Albuquerque"`. Sem nome de agente
 * configurado, assina só com a agência; sem agência, com o agente; sem nenhum dos
 * dois, não há linha (o chamador decide o que mostrar — a função nunca inventa texto).
 */
export function linhaDeAssinatura(marca: MarcaParaAssinatura): string | null {
  const agencia = texto(marca.brandName ?? marca.name);
  const agente = texto(marca.agentDisplayName);
  if (agencia && agente) return `${agencia}${SEPARADOR}por ${agente}`;
  return agencia || agente || null;
}

/** Segunda linha — sempre presente. O nome sai do token, nunca de string solta. */
export function linhaViaApp(): string {
  return `via ${APP_NAME}`;
}

/**
 * As linhas da assinatura, prontas para renderizar (uma por linha, sem linha vazia).
 * O nome do agente não existe como estado "vazio" na interface: o que existe é a
 * assinatura com uma linha a menos.
 */
export function assinaturaDaMarca(marca: MarcaParaAssinatura): string[] {
  const linha = linhaDeAssinatura(marca);
  return linha ? [linha, linhaViaApp()] : [linhaViaApp()];
}

/**
 * Mensagem + assinatura em um texto só — o corpo do `?text=` do WhatsApp e de qualquer
 * outro canal copiável. Preserva a mensagem como veio (só corta espaço no fim) e nunca
 * devolve string vazia: sem mensagem, devolve a própria assinatura.
 */
export function textoComAssinatura(mensagem: string, marca: MarcaParaAssinatura): string {
  const corpo = mensagem.trimEnd();
  const linhas = assinaturaDaMarca(marca);
  return corpo.length > 0 ? `${corpo}\n\n${linhas.join('\n')}` : linhas.join('\n');
}
