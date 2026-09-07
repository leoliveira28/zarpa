"use client";

import { useSyncExternalStore } from "react";
import type { ServiceResult } from "@/server";

/* =============================================================================
   Assinatura — reconhecimento do gate de dunning (S13a)
   -----------------------------------------------------------------------------
   Quando a assinatura está `past_due`, cancelada ou com trial vencido, TODA
   Server Action de escrita recusa com `code: 'ASSINATURA_INATIVA'`
   (`src/server/subscriptionGate.ts`). Leituras nunca recusam. A recusa chega
   com `mensagem` e `correcao` prontos — o padrão de toast de cada tela já os
   mostra. O que faltava era a camada PERSISTENTE: um aviso que continue na
   tela depois que o toast some, porque a conta continua bloqueada.

   A mecânica, em três peças:

     1. `recusaDeAssinatura(result)` — reconhece o código num ServiceResult.
        Pura, sem estado, testável.

     2. `avisarRecusaDeEscrita(result)` — reconhece E anuncia. UMA LINHA no
        ramo de erro de qualquer action de escrita; não faz nada quando o
        código é outro, então é seguro chamar em todo `!result.ok` de escrita.
        É o contrato para action nova: se escreve, avisa.

     3. `useBloqueioDeAssinatura()` — o banner (`AssinaturaBanner`) assina o
        estado por `useSyncExternalStore`. Sem provider: o estado mora no
        módulo, e o banner vive no AppShell, que persiste entre rotas.

   Decisões (minhas, documentadas em docs/status/nina.md):

     - **O banner só aparece depois da PRIMEIRA recusa.** Nenhuma chamada
       extra no load (`obterAssinaturaAtual` não roda no shell) — quem está
       com a conta em dia nunca paga um round-trip para descobrir isso.
     - **Vida de sessão de navegação.** Um refresh limpa o banner (ele volta
       na próxima recusa). Persistir entre reloads exigiria storage + uma
       forma de expirar, e o toast na hora da escrita continua sendo a
       primeira linha de aviso — o banner é a segunda.
     - **Limpa na regularização, não por polling.** A /cobranca chama
       `avisarAssinaturaRegularizada(status)` quando `trocarPlano` devolve
       `active`/`trialing`. Quem regulariza vê o banner sair na hora; quem não
       regulariza o vê em toda tela — que é o ponto.
     - **`correcao` vira destino fixo `/cobranca`.** O servidor manda o rótulo
       ("Ir para Cobrança"); o destino é rota nossa, não dado do servidor.
   ========================================================================== */

/** Rota que resolve o bloqueio — o banner e a correção apontam para ela. */
export const ROTA_COBRANCA = "/cobranca";

const CODIGO_BLOQUEIO = "ASSINATURA_INATIVA";
const CORRECAO_PADRAO = "Ir para Cobrança";

/** O que o banner precisa: a mensagem do servidor e o rótulo do botão. */
export type BloqueioDeAssinatura = {
  mensagem: string;
  correcao: string;
};

/**
 * Reconhece a recusa do gate num resultado de action. `null` em qualquer outro
 * caso — sucesso, ou erro de qualquer outro código (esses seguem o caminho de
 * sempre: toast/FieldError da tela).
 */
export function recusaDeAssinatura(
  result: ServiceResult<unknown>,
): BloqueioDeAssinatura | null {
  if (result.ok) return null;
  if (result.code !== CODIGO_BLOQUEIO) return null;
  return {
    mensagem: result.mensagem,
    correcao: result.correcao || CORRECAO_PADRAO,
  };
}

/* ------------------------------------------------------------------ emissão */

let bloqueioAtual: BloqueioDeAssinatura | null = null;
const ouvintes = new Set<() => void>();

function emitir() {
  for (const ouvir of ouvintes) ouvir();
}

/**
 * Chame no ramo de erro de toda action de ESCRITA. Uma linha; não faz nada
 * quando a recusa não é do gate. O toast da tela continua acontecendo — este
 * aviso é a camada persistente por cima dele.
 */
export function avisarRecusaDeEscrita(result: ServiceResult<unknown>): void {
  const bloqueio = recusaDeAssinatura(result);
  if (!bloqueio) return;
  bloqueioAtual = bloqueio;
  emitir();
}

/**
 * A conta voltou a valer (`trocarPlano` devolveu `active`/`trialing` na
 * /cobranca) — o banner sai na hora, sem esperar a próxima navegação.
 */
export function avisarAssinaturaRegularizada(
  status: string | null | undefined,
): void {
  if (!bloqueioAtual) return;
  if (status !== "active" && status !== "trialing") return;
  bloqueioAtual = null;
  emitir();
}

/* ------------------------------------------------------------- assinatura do estado */

function inscrever(ouvir: () => void) {
  ouvintes.add(ouvir);
  return () => {
    ouvintes.delete(ouvir);
  };
}

function obterBloqueio() {
  return bloqueioAtual;
}

function obterBloqueioServidor() {
  // No SSR o módulo nasce vazio em qualquer caso — e o banner não corre no
  // servidor: ele nasce de uma recusa, que só existe no navegador.
  return null;
}

/**
 * O bloqueio vigente, ou `null` quando a conta está livre. Referência estável
 * entre renders: só muda quando o bloqueio entra ou sai.
 */
export function useBloqueioDeAssinatura(): BloqueioDeAssinatura | null {
  return useSyncExternalStore(inscrever, obterBloqueio, obterBloqueioServidor);
}
