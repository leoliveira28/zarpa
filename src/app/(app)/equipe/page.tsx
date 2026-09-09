import type { Metadata } from "next";
import { EquipeScreen } from "./EquipeScreen";

export const metadata: Metadata = { title: "Equipe" };

/**
 * Equipe (Fase 3 — multiusuário). Irmã de /cobranca e /configuracoes: fora da
 * barra inferior (cinco alvos de toque já é o limite em 390px), na lateral no
 * desktop e no ícone quieto do topo no celular. Registro silencioso do miolo:
 * gente, papel e assento em papel e fio — zero ilustração.
 */
export default function EquipePage() {
  return <EquipeScreen />;
}
