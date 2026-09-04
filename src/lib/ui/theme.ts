import * as React from "react";

/* =============================================================================
   Tema
   -----------------------------------------------------------------------------
   Este módulo NÃO leva "use client" de propósito: o `themeBootstrapScript` é
   lido pelo layout raiz, que é Server Component. Marcar o arquivo como cliente
   transformaria a constante numa referência de cliente e o servidor não
   conseguiria ler a string. O hook abaixo só é importado por componentes que
   já são de cliente.
   -----------------------------------------------------------------------------
   Três estados, não dois: `system` (padrão), `light`, `dark`. O sistema é o
   padrão porque o agente troca de tema no celular ao anoitecer e espera que o
   app acompanhe sem ele pedir.

   O atributo vai no <html> ANTES do primeiro paint, por um script síncrono no
   <head>. Sem isso a tela pisca branca antes de escurecer, que é o tipo de
   detalhe que faz o app parecer um site.
   ========================================================================== */

export const THEME_STORAGE_KEY = "zarpa.theme";

export type ThemeChoice = "system" | "light" | "dark";

/**
 * Script síncrono injetado no <head>. Fica minúsculo de propósito: ele roda
 * bloqueando o render, então cada byte aqui é latência.
 */
export const themeBootstrapScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}}catch(e){}})()`;

function readStoredChoice(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function useTheme() {
  // no primeiro render assumimos "system" para bater com o HTML do servidor;
  // o efeito abaixo corrige antes de qualquer interação
  const [choice, setChoiceState] = React.useState<ThemeChoice>("system");
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setChoiceState(readStoredChoice());
    setMounted(true);
  }, []);

  const setChoice = React.useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    const root = document.documentElement;
    if (next === "system") {
      delete root.dataset.theme;
    } else {
      root.dataset.theme = next;
    }
    try {
      if (next === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // navegação privada: o tema vale só para esta sessão. Não é erro.
    }
  }, []);

  return { choice, setChoice, mounted };
}
