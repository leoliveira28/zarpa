"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/Button";
import { usePrefersReducedMotion } from "@/lib/ui/motion";
import { cn } from "@/lib/ui/cn";

/* =============================================================================
   TourGuiado — onboarding guiado que atravessa as telas (v2, revisão do PO)
   -----------------------------------------------------------------------------
   Cada passo mora numa TELA: "Próximo" navega para a rota do passo seguinte
   (funil → propostas → clientes → dinheiro → vitrine → grupos), de modo que o
   agente percorre o produto DE DENTRO, com o cartão explicando a tela em que
   acabou de chegar. Clicável e completo, sem spotlight frágil sobre o DOM.

   Estado na localStorage: fechar no meio guarda o passo — recarregar não
   recomeça do zero; "Rever tour" na lateral reabre do início (o canal de
   teste do PO). Réguas da casa: papel e fio, sem emoji, só transform e
   opacity animam, reduzido a motion respeitado, sem setState síncrono em
   effect (hidratação fora do corpo, com timeout 0).
   ========================================================================== */

const TOUR_STATE_KEY = "zarpa.tour.v2";
const TOUR_SEEN_KEY = "zarpa.tour.v1.seen";
export const TOUR_REPLAY_EVENT = "zarpa:tour-replay";

type Passo = { rota: string; titulo: string; texto: string };

const ROTEIRO: Passo[] = [
  {
    rota: "/hoje",
    titulo: "Hoje — o seu quadro diário",
    texto:
      "Esta tela é a sua manhã: tarefas vencendo, propostas que o cliente abriu, viagens em curso e o resumo do mês. Quando a sua vitrine gerar interesse, o lead aparece aqui em cima.",
  },
  {
    rota: "/funil",
    titulo: "Funil — cada viagem em negociação",
    texto:
      "Um cartão por viagem. Arraste entre as colunas conforme avança, marque as perdidas com o motivo e veja o valor de cada coluna. Grupos aparecem no cartão também.",
  },
  {
    rota: "/propostas",
    titulo: "Propostas — o orçamento que vende",
    texto:
      "Monte com blocos (voo, hotel, passeio), salve como modelo para reusar e mande o link público: o cliente escolhe a opção, aceita e a venda nasce sem retrabalho.",
  },
  {
    rota: "/clientes",
    titulo: "Clientes — a ficha 360°",
    texto:
      "Negócios, propostas, roteiros, viajantes e documentos de cada pessoa num lugar só — cifrados, com registro de quem abriu. Empresas (PJ) também moram aqui.",
  },
  {
    rota: "/vendas",
    titulo: "Dinheiro — o que entrou e o que falta",
    texto:
      "Vendas com parcelas do cliente, comissão prevista × recebida e o export para o contador. Nos Relatórios: ranking de clientes, centros de custo e grupos.",
  },
  {
    rota: "/vitrine",
    titulo: "Vitrine — sua página pública de ofertas",
    texto:
      "Monte ofertas com preço, publique e divulgue o link. Quem se interessa deixa nome e WhatsApp e aparece no seu quadro do /hoje, pronto para virar negócio.",
  },
  {
    rota: "/grupos",
    titulo: "Grupos — saídas com lugares",
    texto:
      "Monte a saída antes de vender: lugares, custo e preço por lugar. Os clientes vão ocupando e um toque cria o negócio de cada um no funil.",
  },
  {
    rota: "/hoje",
    titulo: "É por aqui que a gente começa",
    texto:
      "De volta ao início: cadastre um cliente, crie o primeiro negócio e mande a proposta. Na lateral ficam Equipe, Grupos, Vitrine e a sua Marca. Este passeio pode ser revisto a qualquer momento pelo link na lateral.",
  },
];

type EstadoTour = { ativo: boolean; passo: number };

function lerEstado(): EstadoTour {
  try {
    const cru = window.localStorage.getItem(TOUR_STATE_KEY);
    if (cru) return JSON.parse(cru) as EstadoTour;
  } catch {
    // localStorage indisponível: tour do zero.
  }
  return { ativo: false, passo: 0 };
}

function gravarEstado(estado: EstadoTour): void {
  try {
    window.localStorage.setItem(TOUR_STATE_KEY, JSON.stringify(estado));
  } catch {
    // idem
  }
}

function marcarVisto(): void {
  try {
    window.localStorage.setItem(TOUR_SEEN_KEY, "1");
  } catch {
    // idem
  }
}

export function iniciarTour(): void {
  gravarEstado({ ativo: true, passo: 0 });
  window.dispatchEvent(new Event(TOUR_REPLAY_EVENT));
}

/** Dispara a reabertura do tour (o link "Rever tour" da lateral usa isto). */
export function reverTour(): void {
  iniciarTour();
}

export function TourGuiado() {
  const router = useRouter();
  const pathname = usePathname();
  const reducedMotion = usePrefersReducedMotion();
  const [estado, setEstado] = React.useState<EstadoTour>({ ativo: false, passo: 0 });

  React.useEffect(() => {
    // Hidratação do estado persistido FORA do corpo do effect (réguas da casa).
    const inicial = window.setTimeout(() => setEstado(lerEstado()), 0);
    const sincronizar = () => setEstado(lerEstado());
    window.addEventListener(TOUR_REPLAY_EVENT, sincronizar);
    return () => {
      window.clearTimeout(inicial);
      window.removeEventListener(TOUR_REPLAY_EVENT, sincronizar);
    };
  }, []);

  function fechar(): void {
    marcarVisto();
    persistir({ ativo: false, passo: 0 });
  }

  function persistir(proximo: EstadoTour): void {
    gravarEstado(proximo);
    setEstado(proximo);
  }

  function proximo(): void {
    if (estado.passo >= ROTEIRO.length - 1) {
      fechar();
      return;
    }
    const passoSeguinte = estado.passo + 1;
    const rotaSeguinte = ROTEIRO[passoSeguinte]!.rota;
    persistir({ ativo: true, passo: passoSeguinte });
    // O tour é guiado: ele LEVA o agente para a tela do passo seguinte.
    if (!pathname.startsWith(rotaSeguinte)) router.push(rotaSeguinte);
  }

  function voltar(): void {
    if (estado.passo === 0) return;
    const passoAnterior = estado.passo - 1;
    const rotaAnterior = ROTEIRO[passoAnterior]!.rota;
    persistir({ ativo: true, passo: passoAnterior });
    if (!pathname.startsWith(rotaAnterior)) router.push(rotaAnterior);
  }

  const passoAtual = estado.ativo ? ROTEIRO[estado.passo] : undefined;
  const ultimo = estado.passo === ROTEIRO.length - 1;

  return (
    <AnimatePresence>
      {estado.ativo && passoAtual ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.2 }}
          className="fixed inset-0 z-[70] grid place-items-center bg-scrim px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Tour de apresentação do Zarpa"
        >
          <motion.div
            key={estado.passo}
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
            transition={{ duration: reducedMotion ? 0 : 0.18 }}
            className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-line bg-surface p-6 shadow-3"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-11 font-semibold uppercase tracking-wider text-subtle">
                Passo {estado.passo + 1} de {ROTEIRO.length}
              </span>
              <span className="flex items-center gap-1" aria-hidden>
                {ROTEIRO.map((_, indice) => (
                  <span
                    key={indice}
                    className={cn(
                      "size-1.5 rounded-pill",
                      indice === estado.passo ? "bg-accent" : "bg-line-strong",
                    )}
                  />
                ))}
              </span>
            </div>

            <h2 className="display text-24 text-ink">{passoAtual.titulo}</h2>
            <p className="text-15 leading-[1.5] text-muted">{passoAtual.texto}</p>

            <div className="flex items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={fechar}
                className="text-13 font-medium text-muted underline underline-offset-4 hover:text-ink"
              >
                {ultimo ? "Fechar" : "Pular tour"}
              </button>
              <span className="flex items-center gap-2">
                {estado.passo > 0 ? (
                  <Button variant="secondary" onClick={voltar}>
                    Voltar
                  </Button>
                ) : null}
                <Button variant="primary" onClick={proximo} className="min-h-11 px-6">
                  {ultimo ? "Começar" : "Próximo"}
                </Button>
              </span>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
