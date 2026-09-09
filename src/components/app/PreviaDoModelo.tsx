"use client";

import * as React from "react";
import { Rule } from "@/components/plates";
import { CardAction } from "@/components/ui/Card";
import { LoadingRegion, Skeleton } from "@/components/ui/Skeleton";
import { obterConteudoDoTemplate, type BlocoDeTemplate } from "@/lib/ui/fase12Api";
import { rotuloDoBloco } from "@/lib/ui/roteiroConteudo";

/* =============================================================================
   Prévia do modelo — "olhe antes de entrar"
   -----------------------------------------------------------------------------
   O pendente que a Fase 1 deixou: `obterConteudoDoTemplate` existia no servidor
   sem chamador, e escolher modelo era apostar no escuro — o nome da linha
   ("Portugal em casal") era toda a informação disponível. A prévia traz o
   conteúdo ANTES de o rodapé virar "Criar do modelo", no registro de SUMÁRIO
   de livro, não de editor: uma linha por bloco, rótulo do tipo + título. O
   corpo completo mora no editor — prévia que quer ser lida inteira é editor
   disfarçado.

   Decisões que valem registro:

     - UMA linha por bloco: o título quando existe; senão o corpo inteiro na
       linha, truncado em CSS (zero contagem de caractere em JS); senão "n
       fotos". Bloco sem nada não entra — é o que a proposta também não
       renderiza, e contar bloco oco seria prometer conteúdo que não vem.
     - Máximo 6 linhas; o que passa vira "+N no editor" na cauda. O total fica
       no cabeçalho — um número em cada lugar, e o corte é explicado onde
       acontece.
     - `price_note` APARECE: esta é a casa da agente (autenticado). A trava de
       vazamento é da página pública (§4), não daqui.
     - Leituras por modelo num Mapa em estado: o que já foi lido fica (voltar
       ao modelo de antes é instantâneo, sem refetch) e o estado VISÍVEL é
       DERIVADO do modelo escolhido — sem setState síncrono em efeito, sem
       cascata de render. Resposta que chega atrasada (toque rápido em dois
       modelos) morre no cleanup do próprio efeito: o último toque manda.
     - Modelo sem blocos = estado vazio honesto: o que acontece se criar dele
       + UM caminho de volta ("Começar do zero"). Sem conteúdo de exemplo:
       inventar blocos mentiria sobre ESTE modelo — a regra do exemplo vale
       para lista vazia de sistema, não para retrato de um dado real.
     - Zero animação: trocar de modelo é trocar de texto, e texto não voa. O
       carregamento é skeleton `still` — a casa, sem desfile de brilho a cada
       toque. Nada aqui precisa de prefers-reduced-motion porque nada anima;
       o skeleton da casa já respeita.
     - Nada é clicável na prévia — azul nenhum. A única ação que existe é a
       fuga do vazio, e ela é texto (`CardAction`), não botão.
   ========================================================================== */

/** Linhas mostradas antes de a cauda assumir. Prévia que rola é editor disfarçado. */
const MAX_LINHAS = 6;

/** Skeleton com larguras irregulares — lista de verdade não tem linhas iguais. */
const LARGURAS_DO_SKELETON = ["88%", "64%", "76%", "45%"];

/** A leitura de um modelo: o que a prévia mostra dele. */
type Leitura =
  | { tipo: "ok"; blocos: BlocoDeTemplate[] }
  | { tipo: "erro"; mensagem: string };

export function PreviaDoModelo({
  templateId,
  templateName,
  onComecarDoZero,
}: {
  /** `null` = caminho "Do zero" escolhido — não há o que pré-visualizar. */
  templateId: string | null;
  /** Só para o leitor de tela amarrar a prévia ao modelo escolhido. */
  templateName: string;
  onComecarDoZero: () => void;
}) {
  // Uma entrada por modelo já lido. Ausente = ainda não lido = carregando
  // (o efeito abaixo entra para buscar; entre o toque e a resposta o estado
  // derivado já pinta o skeleton, sem setState síncrono nenhum).
  const [leituras, setLeituras] = React.useState<Map<string, Leitura>>(new Map());

  React.useEffect(() => {
    if (templateId === null) return;
    if (leituras.has(templateId)) return; // já lido — incluir no cache não refaz
    let ativo = true;
    void obterConteudoDoTemplate(templateId).then((result) => {
      if (!ativo) return; // o toque já foi para outro modelo, ou a sheet fechou
      setLeituras((atual) => {
        const proximo = new Map(atual);
        proximo.set(
          templateId,
          result.ok
            ? { tipo: "ok", blocos: result.data }
            : { tipo: "erro", mensagem: result.mensagem },
        );
        return proximo;
      });
    });
    return () => {
      ativo = false;
    };
  }, [templateId, leituras]);

  const leitura = templateId === null ? undefined : leituras.get(templateId);

  if (templateId === null) return null;

  return (
    <section aria-label={`Conteúdo do modelo ${templateName}`} className="flex flex-col">
      {/* Controles (a lista de rádio) e conteúdo (a prévia) são registros
          diferentes — a cornija cheia separa; `inner` seria para irmãos. */}
      <Rule />
      {leitura === undefined ? (
        <LoadingRegion label="Carregando prévia do modelo">
          <div className="flex flex-col gap-2.5 py-3">
            <Skeleton className="h-3 w-24 rounded-xs" />
            {LARGURAS_DO_SKELETON.map((largura) => (
              <Skeleton
                key={largura}
                still
                className="h-[0.875rem] rounded-xs"
                style={{ width: largura }}
              />
            ))}
          </div>
        </LoadingRegion>
      ) : leitura.tipo === "erro" ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
          <p className="text-13 text-muted">{leitura.mensagem}</p>
          <CardAction
            onClick={() =>
              // Tira a leitura recusada: o efeito refaz a busca do MESMO id.
              setLeituras((atual) => {
                const proximo = new Map(atual);
                proximo.delete(templateId);
                return proximo;
              })
            }
          >
            Tentar de novo
          </CardAction>
        </div>
      ) : contarComConteudo(leitura.blocos) === 0 ? (
        <div className="flex flex-col gap-1.5 py-3">
          <p className="text-15 font-medium text-ink">Este modelo está sem blocos.</p>
          <p className="text-13 text-muted">
            Criar dele monta a proposta vazia — cliente e valores continuam
            saindo deste negócio.
          </p>
          <CardAction className="self-start" onClick={onComecarDoZero}>
            Começar do zero
          </CardAction>
        </div>
      ) : (
        <Sumario blocos={leitura.blocos} />
      )}
    </section>
  );
}

/* ----------------------------------------------------------------- linhas --- */

function contarComConteudo(blocos: BlocoDeTemplate[]): number {
  return blocos.filter(temConteudo).length;
}

/** Bloco oco não entra na conta — a proposta também não o renderiza. */
function temConteudo(bloco: BlocoDeTemplate): boolean {
  return Boolean(bloco.title?.trim() || bloco.body?.trim() || bloco.images.length > 0);
}

function Sumario({ blocos }: { blocos: BlocoDeTemplate[] }) {
  const comConteudo = [...blocos].filter(temConteudo).sort((a, b) => a.position - b.position);
  const visiveis = comConteudo.slice(0, MAX_LINHAS);
  const restantes = comConteudo.length - visiveis.length;

  return (
    /* data-numeric: o total e a cauda são números que trocam de modelo a
       modelo — tabular-nums neles é o mesmo contrato dos valores em R$. */
    <div data-numeric className="flex flex-col py-3">
      <p className="text-13 uppercase tracking-[0.08em] text-muted">
        {comConteudo.length} {comConteudo.length === 1 ? "bloco" : "blocos"}
      </p>
      <ul className="mt-2.5 flex flex-col gap-1.5">
        {visiveis.map((bloco) => (
          <LinhaDoSumario key={bloco.position} bloco={bloco} />
        ))}
        {restantes > 0 ? (
          <li className="text-13 text-muted">+{restantes} no editor</li>
        ) : null}
      </ul>
    </div>
  );
}

/**
 * Rótulo do tipo + o que identifica o bloco. A coluna de rótulos é alinhada à
 * esquerda como sumário de capítulos: o olho escaneia pelos TIPOS (Voo, Hotel,
 * Dia) e o título de cada linha completa a leitura — sem coluna de largura
 * fixa, que quebraria com rótulo longo ("Contato de emergência").
 */
function LinhaDoSumario({ bloco }: { bloco: BlocoDeTemplate }) {
  const fotos = bloco.images.length;
  const principal =
    bloco.title?.trim() ||
    bloco.body?.trim() ||
    (fotos > 0 ? `${fotos} ${fotos === 1 ? "foto" : "fotos"}` : "");
  if (!principal) return null;

  return (
    <li className="flex min-w-0 items-baseline gap-2.5">
      <span className="shrink-0 text-13 text-muted">{rotuloDoBloco(bloco)}</span>
      <span className="min-w-0 truncate text-15 text-ink">{principal}</span>
    </li>
  );
}
