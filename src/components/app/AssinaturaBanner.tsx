"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/ui/cn";
import { Button } from "@/components/ui/Button";
import { ROTA_COBRANCA, useBloqueioDeAssinatura } from "@/lib/ui/assinatura";

/* =============================================================================
   Banner de conta bloqueada — a camada persistente do dunning (S13a)
   -----------------------------------------------------------------------------
   Aparece na AppShell (acima do conteúdo, abaixo do TopBar) quando uma action
   de escrita devolve `ASSINATURA_INATIVA` — e fica em TODA tela até a conta
   ser regularizada na /cobranca. As leituras continuam funcionando (decisão
   de produto: bloquear leitura é perder o cliente; bloquear escrita é
   cobrar), então este aviso convive com o app inteiro visível: ele não pode
   gritar. Registro silencioso: uma faixa âmbar (cor de ESTADO, não de marca),
   a cornija embaixo separando o aviso do conteúdo — não uma caixa com quatro
   bordas.

   Sem animação, de propósito: o banner é ESTADO, não evento. A urgência já
   foi comunicada pelo toast no momento da recusa; o movimento aqui só faria
   a página tremer toda vez que a agente tentasse escrever — e ela vai tentar
   de novo. (O teste do CLAUDE.md: sem animação, o banner comunica exatamente
   a mesma coisa.)

   O botão é `secondary`, não `primary`: o azul do accent é "onde clicar" e
   está ocupado pelo CTA global do TopBar (que, no bloqueio, recusa toda
   escrita). O fio do botão diz botão; o âmbar diz por quê.

   Na própria /cobranca o banner não renderiza: a tela de destino já mostra
   o status em Badge e o caminho de regularização — um aviso linkando para
   a página em que ele está é ruído.
   ========================================================================== */

export function AssinaturaBanner({ wide = false }: { wide?: boolean }) {
  const bloqueio = useBloqueioDeAssinatura();
  const pathname = usePathname();

  if (!bloqueio || pathname === ROTA_COBRANCA) return null;

  return (
    <div
      role="status"
      className="border-b border-hairline bg-warn-soft"
    >
      {/* O conteúdo do banner segue a MESMA medida do miolo abaixo dele —
          inclusive a exceção das rotas de quadro (`/funil`, editor de
          proposta), que abrem para a largura da janela no desktop. Banner
          desalinhado do conteúdo é o tipo de ruído que um aviso persistente
          não pode ter. */}
      <div
        className={cn(
          "flex w-full flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-6",
          wide ? "lg:px-6" : "mx-auto max-w-[64rem] lg:px-8",
        )}
      >
        <p className="min-w-0 flex-1 text-13 leading-snug text-warn-soft-ink">
          {bloqueio.mensagem}
        </p>
        <Button
          variant="secondary"
          size="sm"
          asChild
          className="self-start sm:self-auto"
        >
          <Link href={ROTA_COBRANCA}>{bloqueio.correcao}</Link>
        </Button>
      </div>
    </div>
  );
}
