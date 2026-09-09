import { NextResponse, type NextRequest } from "next/server";

/**
 * `/kitchen-sink` é bancada interna (todo componente em todo estado, para o
 * gate de design — `tests/a11y/kitchen-sink.spec.ts`), não uma tela de
 * produto. Nunca precisou existir para o agente de viagem que usa o app de
 * verdade — em produção ela só é superfície de confusão e peso de bundle
 * alcançável por URL direta. Bloqueada aqui (raiz, fora da fronteira da
 * Nina) em vez de apagada: o Téo e quem for revisar o design system
 * continuam usando em dev/preview.
 */
export function middleware(request: NextRequest) {
  if (process.env.NODE_ENV === "production" && request.nextUrl.pathname.startsWith("/kitchen-sink")) {
    return NextResponse.redirect(new URL("/hoje", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/kitchen-sink/:path*",
};
