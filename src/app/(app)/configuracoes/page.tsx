import type { Metadata } from "next";
import { ConfiguracoesScreen } from "./ConfiguracoesScreen";

export const metadata: Metadata = { title: "Sua marca" };

/**
 * "Sua marca" — o lugar onde a agente dá a cara dela ao produto.
 *
 * Existe por uma lacuna antiga: `atualizarMarca` (com logo, WhatsApp,
 * instagram e, desde a 0017, o nome do agente para a assinatura) não tinha
 * NENHUMA tela — a marca só era editada por quem mexesse no banco. É rota
 * irmã de /cobranca e /integracoes: fora da barra inferior (cinco alvos de
 * toque já é o limite em 390px), na lateral no desktop e no slider do topo no
 * celular.
 */
export default function ConfiguracoesPage() {
  return <ConfiguracoesScreen />;
}
