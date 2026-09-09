"use client";

import * as React from "react";
import {
  arquivarEstagio,
  criarEstagio,
  renomearEstagio,
  reabrirEstagio,
  reordenarEstagios,
  type EstagioDoFunil,
} from "@/server";
import { avisarRecusaDeEscrita } from "@/lib/ui/assinatura";
import { cn } from "@/lib/ui/cn";
import { Button } from "@/components/ui/Button";
import { Field, FieldError, FieldHint, Label } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Rule } from "@/components/plates";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { ChevronDownIcon, ChevronUpIcon } from "@/components/app/icons";

/* =============================================================================
   Editar colunas — o funil como a agente trabalha, não como o banco nasceu
   -----------------------------------------------------------------------------
   S16. `listarEstagios`/`criarEstagio`/`renomearEstagio`/`reordenarEstagios`/
   `arquivarEstagio` existiam no servidor sem NENHUMA tela chamando — o funil
   configurável era promessa. Esta Sheet é o consumidor.

   Decisões de interface (minhas, detalhadas em docs/status/nina.md):

   1. ENTRA NO CABEÇALHO DO /FUNIL, não no TopBar. Configurar coluna é tarefa
      do funil — aparece uma vez por sessão, no lugar onde o efeito é visível.

   2. REORDENAR POR BOTÃO, não por arrasto. Dentro de uma sheet rolável, arrasto
      de linha briga com o scroll do painel — e `reordenarEstagios` manda a
      lista INTEIRA (recusa lista parcial), então subir/descer é um gesto
      atômico e reversível: troca local na hora, reconcilia com o servidor,
      volta se recusado.

   3. FIM DE FUNIL É OUTRO GRUPO, fixo no fim. `criarEstagio` não cria fim de
      funil e entra antes dele por contrato — a Sheet mostra "Colunas" e, depois
      do fio, "Fim de funil" (ganho + perdido), onde só se renomeia. Subir/
      descer não é oferecido ali: a ordem "abertas primeiro, fechamento no fim"
      é a que o quadro comunica; quebrá-la pela UI seria oferecer um estado que
      nenhum outro texto da tela explica. (O servidor aceita qualquer ordem;
      se um dia o produto quiser, é aqui que se abre.)

   4. ARQUIVAR É UM TOQUE COM DESFAZER DE 8s. O par (`reabrirEstagio`) chegou,
      então o desfazer é de verdade — não teatro. A coluna some do quadro na
      hora (otimista) e o toast oferece reabrir por 8s; quem reabre recebe a
      coluna NO FIM DO ABERTO (decisão do servidor) e com o rótulo QUE VEIO NO
      RETORNO — pode ter ganhado sufixo " (arquivada)" por conflito de nome
      com uma coluna ativa. A faixa de confirmação de dois toques saiu: com
      desfazer honesto, o segundo toque era atrito de graça. Coluna COM
      negócio nem oferece: o botão nasce desabilitado e a linha diz o que
      fazer primeiro ("mova os negócios") — a recusa do servidor continua
      válida para a corrida entre abrir a sheet e criar um negócio nela.

   5. RENOMEAR É INLINE COM ERRO ONDE SE DIGITA. Conflito de nome ("Já existe
      uma coluna com esse nome") reabre o campo com o FieldError — consertar é
      continuar digitando, não caçar um toast que já foi.
   ========================================================================== */

/** Mesmo teto do servidor (`MAX_ESTAGIOS` em src/server/pipelineStages.ts). */
const MAX_COLUNAS = 12;

export interface EditarColunasSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Colunas ATIVAS do tenant, na ordem do quadro — o mesmo estado do dono da tela. */
  estagios: EstagioDoFunil[];
  /** Aplica a próxima lista — otimista (troca, rename) ou reconciliada (retorno do servidor). */
  onApply: (estagios: EstagioDoFunil[]) => void;
  /** Reler do servidor sem piscar o quadro inteiro — a correção de "ordem recusada". */
  onRefresh: () => void;
}

export function EditarColunasSheet({
  open,
  onOpenChange,
  estagios,
  onApply,
  onRefresh,
}: EditarColunasSheetProps) {
  const toast = useToast();

  const abertas = estagios.filter((e) => !e.isWon && !e.isLost);
  const fim = estagios.filter((e) => e.isWon || e.isLost);
  const cheio = estagios.length >= MAX_COLUNAS;

  const [reordenando, setReordenando] = React.useState(false);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [rascunho, setRascunho] = React.useState("");
  const [editErro, setEditErro] = React.useState<string | null>(null);
  const [novoNome, setNovoNome] = React.useState("");
  const [criando, setCriando] = React.useState(false);
  const [criarErro, setCriarErro] = React.useState<{
    mensagem: string;
    correcao?: string;
  } | null>(null);

  // Fechar a sheet limpa rascunhos — reabrir é começar limpa, não herdar a
  // edição da última vez (mesmo comportamento de NovoNegocioSheet). No wrapper
  // de onOpenChange, não em efeito: toda porta de fechamento (Esc, backdrop,
  // arrasto, o X) passa por aqui.
  function mudarAbertura(next: boolean) {
    onOpenChange(next);
    if (next) return;
    setEditId(null);
    setRascunho("");
    setEditErro(null);
    setNovoNome("");
    setCriando(false);
    setCriarErro(null);
    setReordenando(false);
  }

  // O desfazer do arquivar roda DEPOIS que a sheet pode ter fechado — o
  // closure precisa da lista VIVA, não do snapshot de quando arquivou.
  const estagiosRef = React.useRef(estagios);
  estagiosRef.current = estagios;

  /* ------------------------------------------------------------ reordenar */

  async function mover(coluna: EstagioDoFunil, direcao: -1 | 1) {
    if (reordenando) return;
    const indice = abertas.findIndex((e) => e.id === coluna.id);
    const vizinho = abertas[indice + direcao];
    if (!vizinho) return;

    // A troca local JÁ É a lista que vai ao servidor — otimista e pedido são
    // a mesma coisa, então não existe chance de divergirem.
    const abertasTrocadas = [...abertas];
    abertasTrocadas[indice] = vizinho;
    abertasTrocadas[indice + direcao] = coluna;
    const trocada = [...abertasTrocadas, ...fim];

    // otimista: a ordem da lista é a ordem do quadro — a agente vê na hora.
    onApply(trocada);
    setReordenando(true);
    const result = await reordenarEstagios({
      ids: trocada.map((e) => e.id),
    });
    setReordenando(false);

    if (!result.ok) {
      onApply(estagios);
      avisarRecusaDeEscrita(result);
      toast.show({
        title: result.mensagem,
        description: result.correcao,
        tone: "danger",
        action: result.correcao
          ? { label: result.correcao, onClick: onRefresh }
          : undefined,
      });
      return;
    }
    onApply(result.data);
  }

  /* ------------------------------------------------------------- renomear */

  /** O gatilho de troca de linha faz preventDefault no pointerdown (para não
   *  roubar o foco do campo) — o que também suprime o blur que commitava a
   *  edição aberta. Então quem abre OUTRA linha resolve a pendente primeiro:
   *  o rascunho de meia digitação vira salva, não perda silenciosa. */
  function resolverPendente() {
    if (!editId) return;
    const pendente = estagios.find((e) => e.id === editId);
    if (pendente) void concluirRenomear(pendente);
  }

  function comecarRenomear(coluna: EstagioDoFunil) {
    resolverPendente();
    setEditId(coluna.id);
    setRascunho(coluna.label);
    setEditErro(null);
  }

  function cancelarRenomear() {
    setEditId(null);
    setRascunho("");
    setEditErro(null);
  }

  async function concluirRenomear(coluna: EstagioDoFunil) {
    const nome = rascunho.trim();
    if (!nome || nome === coluna.label) {
      cancelarRenomear();
      return;
    }
    setEditId(null); // antes de tudo: o blur que o Enter dispara não recommita
    setEditErro(null);

    const anterior = estagios;
    onApply(estagios.map((e) => (e.id === coluna.id ? { ...e, label: nome } : e)));

    const result = await renomearEstagio({ id: coluna.id, label: nome });
    if (!result.ok) {
      onApply(anterior);
      avisarRecusaDeEscrita(result);
      if (result.campo === "label") {
        // conflito de nome: volta pro campo com o erro junto — consertar é
        // continuar digitando, não caçar um toast que já foi.
        setEditId(coluna.id);
        setRascunho(nome);
        setEditErro(result.mensagem);
        return;
      }
      toast.show({
        title: result.mensagem,
        description: result.correcao,
        tone: "danger",
      });
      return;
    }
    onApply(
      anterior.map((e) => (e.id === coluna.id ? result.data : e)),
    );
  }

  /* -------------------------------------------------------------- arquivar */

  async function arquivar(coluna: EstagioDoFunil) {
    const anterior = estagios;
    // otimista: a coluna some do quadro na hora; recusa devolve.
    onApply(estagios.filter((e) => e.id !== coluna.id));

    const result = await arquivarEstagio({ id: coluna.id });
    if (!result.ok) {
      onApply(anterior);
      avisarRecusaDeEscrita(result);
      toast.show({
        title: result.mensagem,
        description: result.correcao,
        tone: "danger",
      });
      return;
    }
    toast.undo(
      `Coluna “${coluna.label}” arquivada`,
      () => void reabrir(coluna),
      { duration: 8000 },
    );
  }

  /**
   * O desfazer do arquivar. A reaberta volta NO FIM DO ABERTO (mesmo lugar de
   * uma coluna nova — contrato do servidor, não restauro posição antiga aqui)
   * e o rótulo exibido é o que VEIO no retorno: em conflito de nome com uma
   * coluna ativa, ela volta com sufixo " (arquivada)" — feio de propósito.
   */
  async function reabrir(coluna: EstagioDoFunil) {
    const result = await reabrirEstagio({ id: coluna.id });
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      onRefresh(); // o quadro pode ter mudado desde o arquivar — reconcilia
      toast.show({
        title: result.mensagem,
        description: result.correcao,
        tone: "danger",
      });
      return;
    }
    const atual = estagiosRef.current;
    const next = [...atual];
    const primeiroFim = next.findIndex((e) => e.isWon || e.isLost);
    next.splice(primeiroFim === -1 ? next.length : primeiroFim, 0, result.data);
    onApply(next);
  }

  /* ----------------------------------------------------------------- criar */

  async function criar() {
    const nome = novoNome.trim();
    if (!nome || criando) return;
    setCriando(true);
    setCriarErro(null);

    const result = await criarEstagio({ label: nome });
    setCriando(false);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      setCriarErro({
        mensagem: result.mensagem,
        correcao: result.correcao,
      });
      return;
    }
    setNovoNome("");
    // Mesma regra do servidor: entra antes do primeiro fim de funil.
    const criada = result.data;
    const next = [...estagios];
    const primeiroFim = next.findIndex((e) => e.isWon || e.isLost);
    next.splice(primeiroFim === -1 ? next.length : primeiroFim, 0, criada);
    onApply(next);
    toast.show({
      title: `Coluna “${criada.label}” criada`,
      description: "Já recebe negócio — arraste um cartão para ela.",
      tone: "ok",
    });
  }

  return (
    <Sheet open={open} onOpenChange={mudarAbertura}>
      <SheetContent
        open={open}
        onOpenChange={mudarAbertura}
        title="Editar colunas"
        description="A ordem daqui é a ordem do quadro."
      >
        <div className="flex flex-col pb-2">
          <p className="text-13 font-semibold tracking-[0.04em] text-muted uppercase">
            Colunas
          </p>

          <ul>
            {abertas.map((coluna, indice) => (
              <li key={coluna.id}>
                {indice > 0 ? <Rule inner /> : null}
                <LinhaColuna
                  coluna={coluna}
                  podeSubir={indice > 0}
                  podeDescer={indice < abertas.length - 1}
                  reordenando={reordenando}
                  editando={editId === coluna.id}
                  rascunho={rascunho}
                  editErro={editErro}
                  onRascunhoChange={(valor) => {
                    setRascunho(valor);
                    if (editErro) setEditErro(null);
                  }}
                  onRenomear={() => comecarRenomear(coluna)}
                  onRenomearConcluir={() => void concluirRenomear(coluna)}
                  onRenomearCancelar={cancelarRenomear}
                  onSubir={() => void mover(coluna, -1)}
                  onDescer={() => void mover(coluna, 1)}
                  onArquivar={() => {
                    resolverPendente();
                    setEditId(null);
                    void arquivar(coluna);
                  }}
                />
              </li>
            ))}
          </ul>

          {/* criar — no fim das colunas do quadro, ANTES do grupo fim de
              funil: onde a nova entra de verdade (contrato do servidor). */}
          <Rule loose />
          {cheio ? (
            <p className="text-13 text-muted">
              O funil já tem {MAX_COLUNAS} colunas — o máximo. Arquive uma
              coluna vazia antes de criar outra.
            </p>
          ) : (
            <Field invalid={criarErro !== null} className="pt-1">
              <Label>Nova coluna</Label>
              <div className="flex items-start gap-2">
                <Input
                  value={novoNome}
                  onChange={(event) => {
                    setNovoNome(event.target.value);
                    if (criarErro) setCriarErro(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void criar();
                    }
                  }}
                  placeholder="Ex.: Aguardando documentos"
                  maxLength={40}
                  aria-invalid={criarErro ? true : undefined}
                />
                {/* Ação no click, não no pointerdown: é a convenção do Button
                    (pointerdown ali é só o estado pressionado) e evita ação
                    dobrada — pointerdown e click chegam antes do estado
                    `criando` atualizar, então o guard não seguraria o segundo. */}
                <Button
                  variant="secondary"
                  loading={criando}
                  disabled={!novoNome.trim()}
                  onClick={() => void criar()}
                  className="shrink-0"
                >
                  Criar
                </Button>
              </div>
              {criarErro ? (
                <FieldError>
                  {criarErro.mensagem}
                  {criarErro.correcao ? ` ${criarErro.correcao}` : ""}
                </FieldError>
              ) : (
                <FieldHint>
                  Entra no fim do quadro, antes do fim de funil — e já recebe
                  negócio.
                </FieldHint>
              )}
            </Field>
          )}

          <Rule loose />

          <p className="text-13 font-semibold tracking-[0.04em] text-muted uppercase">
            Fim de funil
          </p>
          <ul>
            {fim.map((coluna, indice) => (
              <li key={coluna.id}>
                {indice > 0 ? <Rule inner /> : null}
                <LinhaColuna
                  coluna={coluna}
                  editando={editId === coluna.id}
                  rascunho={rascunho}
                  editErro={editErro}
                  onRascunhoChange={(valor) => {
                    setRascunho(valor);
                    if (editErro) setEditErro(null);
                  }}
                  onRenomear={() => comecarRenomear(coluna)}
                  onRenomearConcluir={() => void concluirRenomear(coluna)}
                  onRenomearCancelar={cancelarRenomear}
                />
              </li>
            ))}
          </ul>
          <p className="text-13 text-muted">
            Toda viagem fecha numa destas — o relatório depende delas.
            “Perdida” não mostra cartão: a viagem sai do quadro, com o motivo.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ a linha */

/**
 * Uma coluna da lista. Quase tudo é estado da Sheet — a linha é marcação:
 * nome (texto ou campo), contagem com a condição de arquivar, subir/descer
 * quando a ordem é dela, e as ações de texto (renomear / arquivar — o
 * arquivar desfaz no toast, não aqui).
 */
function LinhaColuna({
  coluna,
  editando = false,
  rascunho = "",
  editErro = null,
  podeSubir = false,
  podeDescer = false,
  reordenando = false,
  onRascunhoChange,
  onRenomear,
  onRenomearConcluir,
  onRenomearCancelar,
  onSubir,
  onDescer,
  onArquivar,
}: {
  coluna: EstagioDoFunil;
  editando?: boolean;
  rascunho?: string;
  editErro?: string | null;
  podeSubir?: boolean;
  podeDescer?: boolean;
  reordenando?: boolean;
  onRascunhoChange?: (valor: string) => void;
  onRenomear?: () => void;
  onRenomearConcluir?: () => void;
  onRenomearCancelar?: () => void;
  onSubir?: () => void;
  onDescer?: () => void;
  onArquivar?: () => void;
}) {
  const podeArquivar = onArquivar !== undefined && !coluna.isWon && !coluna.isLost;
  const temNegocio = coluna.totalNegocios > 0;

  return (
    <div className="flex flex-col gap-1.5 py-3">
      {editando ? (
        <Field invalid={editErro !== null}>
          <Label className="sr-only">Nome da coluna</Label>
          <Input
            autoFocus
            value={rascunho}
            onChange={(event) => onRascunhoChange?.(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={() => onRenomearConcluir?.()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onRenomearConcluir?.();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                onRenomearCancelar?.();
              }
            }}
            maxLength={40}
            enterKeyHint="done"
          />
          {editErro ? (
            <FieldError>{editErro}</FieldError>
          ) : (
            <FieldHint>Até 40 caracteres. Enter salva, Esc volta.</FieldHint>
          )}
        </Field>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-15 font-medium text-ink">
              {coluna.label}
            </p>
            <p className="text-13 text-muted">
              {temNegocio && podeArquivar ? (
                <span className="tabular-nums">
                  {coluna.totalNegocios}{" "}
                  {coluna.totalNegocios === 1 ? "negócio" : "negócios"} — mova
                  para outra coluna antes de arquivar
                </span>
              ) : temNegocio ? (
                <span className="tabular-nums">
                  {coluna.totalNegocios}{" "}
                  {coluna.totalNegocios === 1 ? "negócio" : "negócios"}
                </span>
              ) : podeArquivar ? (
                "vazia"
              ) : coluna.isLost ? (
                "saída do funil"
              ) : null}
            </p>
          </div>
          {onSubir && onDescer ? (
            <div className="flex shrink-0 items-center gap-1">
              {/* Mesma regra dos gatilhos de texto: preventDefault no
                  pointerdown (a lista troca no meio do gesto e o foco não tem
                  para onde ir de forma previsível) + teclado por onKeyDown. */}
              <button
                type="button"
                aria-label={`Mover “${coluna.label}” para cima`}
                disabled={!podeSubir || reordenando}
                onPointerDown={(event) => {
                  event.preventDefault();
                  onSubir();
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onSubir();
                }}
                className={cn(
                  "grid size-8 place-items-center rounded-sm text-muted",
                  "hover:bg-surface-3 hover:text-ink",
                  "[@media(pointer:coarse)]:size-10",
                  "disabled:pointer-events-none disabled:text-line-strong",
                )}
              >
                <ChevronUpIcon className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Mover “${coluna.label}” para baixo`}
                disabled={!podeDescer || reordenando}
                onPointerDown={(event) => {
                  event.preventDefault();
                  onDescer();
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onDescer();
                }}
                className={cn(
                  "grid size-8 place-items-center rounded-sm text-muted",
                  "hover:bg-surface-3 hover:text-ink",
                  "[@media(pointer:coarse)]:size-10",
                  "disabled:pointer-events-none disabled:text-line-strong",
                )}
              >
                <ChevronDownIcon className="size-4" />
              </button>
            </div>
          ) : null}
        </div>
      )}

      {editando ? null : (
        <div className="flex items-center gap-4">
          {/* pointerdown com preventDefault — ver a nota no Chevrons: a linha
              vira campo no meio do gesto, e o default de foco do pointerdown
              roubaria o foco do campo recém-montado (o editor abriria e
              fecharia no mesmo toque). O teclado entra por onKeyDown, que
              nunca dispara pointerdown — sem risco de ação dobrada. */}
          <button
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              onRenomear?.();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onRenomear?.();
            }}
            className="text-13 font-medium text-muted hover:text-ink hover:underline hover:underline-offset-4"
          >
            Renomear
          </button>
          {podeArquivar ? (
            <button
              type="button"
              disabled={temNegocio}
              onPointerDown={(event) => {
                event.preventDefault();
                onArquivar?.();
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onArquivar?.();
              }}
              className="text-13 font-medium text-muted hover:text-ink hover:underline hover:underline-offset-4 disabled:pointer-events-none disabled:text-line-strong"
            >
              Arquivar
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
