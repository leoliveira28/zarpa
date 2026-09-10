import type { Metadata } from "next";
import { GruposScreen } from "./GruposScreen";

export const metadata: Metadata = { title: "Grupos" };

/**
 * Grupos (meta Grupos, docs/GRUPOS_META.md) — o pacote com lugares. Irmã de
 * /equipe e /configuracoes: lateral no desktop, ícone quieto no topo no celular.
 */
export default function GruposPage() {
  return <GruposScreen />;
}
