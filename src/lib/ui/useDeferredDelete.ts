"use client";

import * as React from "react";
import { useToast } from "@/components/ui/Toast";
import type { ServiceResult } from "@/server";

/* =============================================================================
   useDeferredDelete — destrutivo real, com desfazer que funciona de verdade
   -----------------------------------------------------------------------------
   Regra do CLAUDE.md: "destrutivo = toast com desfazer de 8s, não modal 'tem
   certeza?'". Para exclusão ARQUIVÁVEL (contato tem `arquivarContato` +
   `restaurarContato` no servidor) isso é direto: apaga, e o desfazer chama
   `restaurarContato`.

   Mas exclusão de VERDADE (`excluirContato`, `excluirViajante`) não tem
   endpoint de restauração — é para ser irreversível (LGPD: o titular pediu
   para apagar). Um botão "Desfazer" que promete voltar atrás e não consegue é
   pior que um modal de confirmação: é uma mentira na interface. A saída é não
   apagar ainda — a interface REMOVE o item da tela na hora (parece instantâneo,
   photograph do que o usuário pediu) e só manda a exclusão de verdade para o
   servidor se os 8 segundos do toast passarem sem ninguém tocar em "Desfazer".
   Apertou desfazer: o timer morre e a chamada ao servidor nunca acontece — o
   item nunca saiu do banco.

   O timer roda em `window.setTimeout`, fora do ciclo de vida do React: se o
   componente que chamou isto desmontar (ex.: a ficha navegou de volta para a
   lista depois de excluir), o timer permanece de pé e a chamada ao servidor
   ainda acontece — o toast (montado uma vez, na raiz) sobrevive à navegação.
   ========================================================================== */

const DELETE_UNDO_MS = 8000;

interface DeferredDeleteOptions<T> {
  /** Texto do toast, ex.: `(item) => \`Cliente excluído: ${item.name}\`` */
  label: (item: T) => React.ReactNode;
  /** A exclusão de verdade — só roda se ninguém desfizer a tempo. */
  commit: (item: T) => Promise<ServiceResult<unknown>>;
  /** Chamado quando o commit tardio falha (ex.: negócio criado nesse meio-tempo). */
  onFailure?: (item: T, mensagem: string, correcao?: string) => void;
}

export function useDeferredDelete<T>({
  label,
  commit,
  onFailure,
}: DeferredDeleteOptions<T>) {
  const toast = useToast();
  const commitRef = React.useRef(commit);
  const onFailureRef = React.useRef(onFailure);
  React.useEffect(() => {
    commitRef.current = commit;
    onFailureRef.current = onFailure;
  }, [commit, onFailure]);

  return React.useCallback(
    (item: T) => {
      let cancelled = false;
      const timer = window.setTimeout(async () => {
        if (cancelled) return;
        const result = await commitRef.current(item);
        if (!result.ok) {
          onFailureRef.current?.(item, result.mensagem, result.correcao);
        }
      }, DELETE_UNDO_MS);

      toast.undo(
        label(item),
        () => {
          cancelled = true;
          window.clearTimeout(timer);
        },
        { duration: DELETE_UNDO_MS },
      );
    },
    [toast, label],
  );
}
