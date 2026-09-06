import * as React from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { getAuthContext } from "@/lib/auth";

/**
 * Shell das telas autenticadas.
 *
 * O grupo `(app)` existe para que a proposta pública (`/p/[slug]`, S3) fique
 * FORA dele: aquela página é vista pelo cliente final, com a marca do agente,
 * sem nenhuma navegação nossa.
 *
 * Guard de sessão: antes deste layout existir, uma rota sem cookie válido
 * derrubava o `requireAuthContext()` de alguma Server Action lá dentro e a
 * tela mostrava `NÃO_AUTENTICADO` cru — nada que a agente devesse ler.
 * `getAuthContext()` é a versão que não estoura (`@/lib/auth`, barril de
 * SERVIDOR — não confundir com `@/lib/auth/client`, que é o único importável
 * daqui de um Client Component). Sem sessão, ninguém entra no miolo: manda
 * para `/entrar` antes de montar o AppShell, então nenhuma tela-filha do
 * grupo precisa checar isso sozinha.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await getAuthContext();
  if (!auth) {
    redirect("/entrar");
  }

  return (
    <>
      <a
        href="#conteudo"
        className="sr-only rounded-md bg-surface px-3 py-2 text-15 font-medium text-ink shadow-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70]"
      >
        Pular para o conteúdo
      </a>
      <AppShell>{children}</AppShell>
    </>
  );
}
