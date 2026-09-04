import * as React from "react";
import { AppShell } from "@/components/app/AppShell";

/**
 * Shell das telas autenticadas.
 *
 * O grupo `(app)` existe para que a proposta pública (`/p/[slug]`, S3) fique
 * FORA dele: aquela página é vista pelo cliente final, com a marca do agente,
 * sem nenhuma navegação nossa.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
