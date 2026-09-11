"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/Button";
import { usePrefersReducedMotion } from "@/lib/ui/motion";
import { cn } from "@/lib/ui/cn";

/* =============================================================================
   TourGuiado — o passeio de primeira vez pelas telas principais
   -----------------------------------------------------------------------------
   Estratégia (2026-09-11, pedido do PO): o produto ensina a si mesmo UMA vez,
   no quadro que o agente abre todo dia (/hoje), em passos curtos que nomeiam
   cada área e o que ELA resolve — não é manual de recurso, é mapa de "o que
   faço onde". Complementa (não repete) as dicas contextuais que já existem
   (a alça de arrasto do funil, o painel de primeira venda).

   Regras da casa: papel e fio, sem emoji, sem exclamação; reduzido a motion
   respeitado (só opacity); estado em localStorage — quem pula não é
   importunado de novo, e o link "Rever tour" na lateral reabre à vontade
   (é o que o PO usa para testar).
   ========================================================================== */

const TOUR_SEEN_KEY = "zarpa.tour.v1.seen";
export const TOUR_REPLAY_EVENT = "zarpa:tour-replay";

type Passo = { titulo: string; texto: string };

const PASSOS: Passo[] = [
  {
    titulo: "Bem-vinda ao Zarpa",
    texto:
      "O instrumento de trabalho da sua agência: proposta com qualidade de agência grande em 2 minutos, do celular. Este passeio mostra o que fica em cada tela — leva menos de um minuto.",
  },
  {
    titulo: "Hoje — o seu quadro diário",
    texto:
      "Esta tela é a sua manhã: tarefas vencendo, propostas que o cliente abriu, viagens em curso e o resumo do mês. Comece por aqui todos os dias.",
  },
  {
    titulo: "Funil — cada viagem em negociação",
    texto:
      "Um cartão por viagem. Arraste entre as colunas conforme avança, marque as perdidas com o motivo e veja o valor de cada coluna. Vendedores aparecem nos cartões quando a agência tem equipe.",
  },
  {
    titulo: "Propostas — o orçamento que vende",
    texto:
      "Monte com blocos (voo, hotel, passeio), salve como modelo para reusar e mande o link público ao cliente — ele vê as opções e escolhe. O aceite vira venda sem retrabalho.",
  },
  {
    titulo: "Clientes — a ficha 360°",
    texto:
      "Tudo de uma pessoa num lugar: negócios, propostas, roteiros, viajantes e documentos (cifrados, com registro de quem abriu). Empresas (PJ) e grupos também moram aqui.",
  },
  {
    titulo: "Dinheiro — o que entrou e o que falta",
    texto:
      "Vendas, parcelas do cliente, comissão prevista × recebida e os relatórios: ranking de clientes, centros de custo, grupos e o que a vitrine trouxe.",
  },
  {
    titulo: "Vitrine — sua página pública",
    texto:
      "O site que faltava: monte ofertas com preço, publique e divulgue o link. Quem se interessa deixa o contato e aparece aqui no seu quadro, pronto para virar negócio.",
  },
  {
    titulo: "Grupos — saídas com lugares",
    texto:
      "Monte a saída antes de vender: quantos lugares, custo e preço por lugar. Os clientes vão ocupando e o relatório mostra a margem da saída.",
  },
  {
    titulo: "Pronta para começar",
    texto:
      "Comece cadastrando um cliente e criando o primeiro negócio no funil. Na lateral ficam Equipe, Sua marca e a Assinatura. Este passeio pode ser revisto a qualquer momento pelo link na lateral.",
  },
];

function marcarVisto(): void {
  try {
    window.localStorage.setItem(TOUR_SEEN_KEY, "1");
  } catch {
    // navegação privada: o tour volta na próxima visita. Não é erro.
  }
}

function jaViu(): boolean {
  try {
    return window.localStorage.getItem(TOUR_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function TourGuiado() {
  const reducedMotion = usePrefersReducedMotion();
  const [aberto, setAberto] = React.useState(false);
  const [passo, setPasso] = React.useState(0);

  React.useEffect(() => {
    // Abre só no primeiro uso, com um respiro para o quadro assentar.
    if (jaViu()) return;
    const timer = window.setTimeout(() => setAberto(true), 1200);
    return () => window.clearTimeout(timer);
  }, []);

  React.useEffect(() => {
    // "Rever tour" na lateral reabre a qualquer momento (e marca como visto ao fechar).
    const reabrir = () => {
      setPasso(0);
      setAberto(true);
    };
    window.addEventListener(TOUR_REPLAY_EVENT, reabrir);
    return () => window.removeEventListener(TOUR_REPLAY_EVENT, reabrir);
  }, []);

  function fechar() {
    marcarVisto();
    setAberto(false);
  }

  function proximo() {
    if (passo >= PASSOS.length - 1) {
      fechar();
      return;
    }
    setPasso((atual) => atual + 1);
  }

  const passoAtual = PASSOS[passo]!;
  const ultimo = passo === PASSOS.length - 1;

  return (
    <AnimatePresence>
      {aberto ? (
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
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
            transition={{ duration: reducedMotion ? 0 : 0.25 }}
            className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-line bg-surface p-6 shadow-3"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-11 font-semibold uppercase tracking-wider text-subtle">
                Passo {passo + 1} de {PASSOS.length}
              </span>
              {/* progresso: pontos tabulares, cor só no atual */}
              <span className="flex items-center gap-1" aria-hidden>
                {PASSOS.map((_, indice) => (
                  <span
                    key={indice}
                    className={cn(
                      "size-1.5 rounded-pill",
                      indice === passo ? "bg-accent" : "bg-line-strong",
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
              <Button variant="primary" onClick={proximo} className="min-h-11 px-6">
                {ultimo ? "Começar" : "Próximo"}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Dispara a reabertura do tour (o link "Rever tour" da lateral usa isto). */
export function reverTour(): void {
  window.dispatchEvent(new Event(TOUR_REPLAY_EVENT));
}
