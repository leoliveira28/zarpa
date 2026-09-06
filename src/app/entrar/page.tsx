import type { Metadata } from "next";
import { LoginScreen } from "./LoginScreen";

export const metadata: Metadata = { title: "Entrar" };

/**
 * Fora do grupo `(app)` de propósito — sem AppShell, sem navegação do miolo.
 * Registro "entrada/intermediário" (CLAUDE.md): uma prancha discreta, marca,
 * margem de livro. Nem o silêncio do miolo, nem o editorial pleno da proposta.
 */
export default function EntrarPage() {
  return <LoginScreen />;
}
