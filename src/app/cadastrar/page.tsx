import type { Metadata } from "next";
import { CadastroScreen } from "./CadastroScreen";

export const metadata: Metadata = { title: "Criar conta" };

/**
 * Fora do grupo `(app)`, mesma razão do `/entrar`: é a única rota que se vê
 * SEM sessão — sem AppShell, sem navegação do miolo. Registro
 * "entrada/intermediário" (CLAUDE.md): uma prancha discreta, marca, margem de
 * livro. Nem o silêncio do miolo, nem o editorial pleno da proposta.
 */
export default function CadastrarPage() {
  return <CadastroScreen />;
}
