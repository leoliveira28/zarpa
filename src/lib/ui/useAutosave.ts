"use client";

import * as React from "react";
import type { ServiceResult } from "@/server";

/* =============================================================================
   useAutosave — salvamento automático, sem botão Salvar
   -----------------------------------------------------------------------------
   Regra do CLAUDE.md: "salvamento automático com 'Salvo' discreto. Sem botão
   Salvar grande." Este hook é o mecanismo único que toda a ficha de cliente usa
   para chegar lá: cada campo chama `commit` (imediato, ex.: no blur) ou
   `schedule` (com debounce, ex.: a cada tecla de uma observação longa), e o
   `state` devolvido alimenta `<SavedMark>` (Field.tsx) direto.

   Por que existe em vez de cada campo controlar seu próprio `useState`:
   1. Evita a corrida de digitar rápido em dois campos e o "Salvo" de um pintar
      por cima do outro — cada campo tem sua própria instância.
   2. `lastRef` descarta a resposta de um commit que já foi substituído por um
      mais novo (o usuário mudou de campo de novo antes do primeiro salvar
      voltar) — sem isso, uma resposta atrasada da rede pode reverter o rótulo
      de "Salvo" para o valor antigo.
   3. O estado "salvo" volta sozinho para "idle" depois de `idleAfterMs` — é o
      "discreto" da regra: o rótulo não fica pregado na tela para sempre.
   ========================================================================== */

export type AutosaveState = "idle" | "saving" | "saved" | "error";

interface UseAutosaveOptions {
  /** Espera parado antes de salvar sozinho. 0 salva na hora (uso em onBlur). */
  debounceMs?: number;
  /** Quanto tempo o rótulo "Salvo" fica visível antes de apagar. */
  idleAfterMs?: number;
}

export function useAutosave<T>(
  save: (value: T) => Promise<ServiceResult<unknown>>,
  { debounceMs = 0, idleAfterMs = 2000 }: UseAutosaveOptions = {},
) {
  const [state, setState] = React.useState<AutosaveState>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const debounceRef = React.useRef<number | undefined>(undefined);
  const idleRef = React.useRef<number | undefined>(undefined);
  const lastRef = React.useRef<T | undefined>(undefined);
  const saveRef = React.useRef(save);
  React.useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const commit = React.useCallback(async (value: T) => {
    window.clearTimeout(debounceRef.current);
    lastRef.current = value;
    setState("saving");
    setError(null);
    const result = await saveRef.current(value);
    // um commit mais novo já começou enquanto este estava no ar — a resposta
    // deste é velha, e aplicá-la sobrescreveria o rótulo do commit atual.
    if (lastRef.current !== value) return result;
    if (!result.ok) {
      setState("error");
      setError(result.mensagem);
      return result;
    }
    setState("saved");
    window.clearTimeout(idleRef.current);
    idleRef.current = window.setTimeout(() => setState("idle"), idleAfterMs);
    return result;
  }, [idleAfterMs]);

  const schedule = React.useCallback(
    (value: T) => {
      lastRef.current = value;
      window.clearTimeout(debounceRef.current);
      if (debounceMs <= 0) {
        void commit(value);
        return;
      }
      debounceRef.current = window.setTimeout(() => {
        void commit(value);
      }, debounceMs);
    },
    [commit, debounceMs],
  );

  React.useEffect(
    () => () => {
      window.clearTimeout(debounceRef.current);
      window.clearTimeout(idleRef.current);
    },
    [],
  );

  return { state, error, commit, schedule };
}
