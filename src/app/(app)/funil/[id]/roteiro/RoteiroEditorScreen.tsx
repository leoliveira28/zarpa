"use client";

import * as React from "react";
import Link from "next/link";
import {
  gerarRoteiro,
  obterTenantAtual,
  type BlocoDoRoteiro,
  type RoteiroResumo,
} from "@/server";
import { avisarRecusaDeEscrita } from "@/lib/ui/assinatura";
import { mensagemDoRoteiro } from "@/lib/ui/assinaturaDaMarca";
import { whatsappShareLink } from "@/lib/ui/whatsapp";
import { Button } from "@/components/ui/Button";
import { Card, CardAction, CardBody, CardFooter, CardHeader } from "@/components/ui/Card";
import { FieldError, FieldHint, SavedMark } from "@/components/ui/Field";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { ChatIcon, ChevronRightIcon } from "@/components/app/icons";
import { cn } from "@/lib/ui/cn";
import { formatarFaixaDeDatas } from "@/lib/ui/format";
import {
  blocosDe,
  chaveNova,
  type ItemBloco,
} from "@/lib/ui/roteiroConteudo";
import {
  obterRoteiroParaEdicao,
  salvarConteudoDoRoteiro,
} from "@/lib/ui/roteiroApi";
import { useAutosave } from "@/lib/ui/useAutosave";
import { RoteiroBlocos } from "./RoteiroBlocos";
import { RoteiroPreview } from "./RoteiroPreview";

/* =============================================================================
   Editor de roteiro — o irmão do editor de proposta, no miolo silencioso
   -----------------------------------------------------------------------------
   "Mesma alma, zero aprendizado": blocos arrastáveis, autosave discreto com
   "Salvo", prévia em tempo real à direita (abas em 390px). O que muda em
   relação à proposta é O QUE É ESCRITO: aqui não existe action por bloco —
   existe UM contrato (`salvarConteudoDoRoteiro`, handoff do rafa §10) que grava
   o snapshot inteiro. Então o autosave é UM, global: patch local a cada tecla
   (a prévia não espera rede), rede com debounce de 900ms.

   INTOCÁVEL por contrato (e por desenho): título, cliente, datas e link não
   têm campo editável — o link que já foi pelo WhatsApp continua válido e o
   cliente recarrega a MESMA URL vendo o conteúdo novo. Sem regeneração.

   O fio com o servidor mora em `roteiroApi.ts`: leitura composta
   (`obterRoteiroParaEdicao`) e escrita única (`salvarConteudoDoRoteiro`). Se
   um contrato mudar, a caça é lá — esta tela não importa action de roteiro.
   ========================================================================== */

type Status = "loading" | "ready" | "vazio" | "error";
type View = "editar" | "previa";

type ErroInfo = { mensagem: string; correcao?: string };

export function RoteiroEditorScreen({ dealId }: { dealId: string }) {
  const toast = useToast();
  const [status, setStatus] = React.useState<Status>("loading");
  const [roteiro, setRoteiro] = React.useState<RoteiroResumo | null>(null);
  /** Marca HOJE do tenant — assina a mensagem de envio. A página pública segue
   * assinada pela marca CONGELADA no snapshot; a mensagem sai com a de agora,
   * que é a que a agente escolheria ao mandar. */
  const [marca, setMarca] = React.useState<{ brandName: string | null; agentDisplayName: string | null } | null>(
    null,
  );
  const [itens, setItens] = React.useState<ItemBloco[]>([]);
  const [errorInfo, setErrorInfo] = React.useState<ErroInfo | null>(null);
  const [view, setView] = React.useState<View>("editar");
  const [reloadToken, setReloadToken] = React.useState(0);
  const retry = React.useCallback(() => setReloadToken((token) => token + 1), []);

  React.useEffect(() => {
    let active = true;
    setStatus((current) => (current === "ready" ? current : "loading"));
    void obterRoteiroParaEdicao(dealId).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setErrorInfo({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      if (!result.data) {
        setStatus("vazio");
        return;
      }
      setRoteiro(result.data);
      setItens(result.data.blocos.map((bloco) => ({ chave: chaveNova(), bloco })));
      setStatus("ready");
    });
    // A marca é acessória: se falhar, a mensagem de envio assina só "via …".
    void obterTenantAtual().then((result) => {
      if (active && result.ok) {
        setMarca({ brandName: result.data.brandName, agentDisplayName: result.data.agentDisplayName });
      }
    });
    return () => {
      active = false;
    };
  }, [dealId, reloadToken]);

  // A ordem do ARRAY é a verdade local (como no editor de proposta): o
  // `position` gravado no snapshot é reescrito pela ordem a cada salvamento.
  const itensRef = React.useRef(itens);
  itensRef.current = itens;

  const autosave = useAutosave(
    (blocos: BlocoDoRoteiro[]) => salvarConteudoDoRoteiro(dealId, blocos),
    { debounceMs: 900 },
  );

  /** Estado local + rede com debounce — a cada tecla, a cada foto, a cada remoção. */
  const aplicar = React.useCallback(
    (update: (current: ItemBloco[]) => ItemBloco[]) => {
      const next = update(itensRef.current);
      itensRef.current = next;
      setItens(next);
      autosave.schedule(blocosDe(next));
    },
    [autosave],
  );

  /** Estado local + rede IMEDIATA — a ordem final do arrasto, o mover de teclado. */
  const confirmar = React.useCallback(
    (update: (current: ItemBloco[]) => ItemBloco[]) => {
      const next = update(itensRef.current);
      itensRef.current = next;
      setItens(next);
      void autosave.commit(blocosDe(next));
    },
    [autosave],
  );

  /** Só estado local — trocas DURANTE o arrasto; a rede acontece no fim do gesto. */
  const segurar = React.useCallback((update: (current: ItemBloco[]) => ItemBloco[]) => {
    const next = update(itensRef.current);
    itensRef.current = next;
    setItens(next);
  }, []);

  // A PORTARIA, apontada: o `campo` da recusa chega como `blocos[2].content.preco`
  // (handoff do rafa §10) — o índice acende o bloco culpado na lista, em vez de
  // deixar a agente caçar onde está a chave proibida.
  const blocoComErro = React.useMemo(() => {
    const campo = autosave.failure?.campo;
    if (!campo) return null;
    const match = /^blocos\[(\d+)\]/.exec(campo);
    return match ? Number(match[1]) : null;
  }, [autosave.failure]);

  async function copiarLink() {
    if (!roteiro) return;
    const url = `${window.location.origin}/r/${roteiro.publicToken}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.show({ title: "Link copiado" });
    } catch {
      toast.show({
        title: "Não consegui copiar o link",
        description: url,
        tone: "danger",
      });
    }
  }

  /**
   * O envio: `wa.me/?text=…` abre o WhatsApp com a mensagem pronta — link,
   * assinatura — e DEIXA a agente escolher a conversa. O número do cliente não
   * precisa passar por aqui (e a ficha não o tem: contrato pendente com o
   * rafa); o share-picker resolve hoje com zero contrato novo.
   */
  function mandarPorWhatsApp() {
    if (!roteiro) return;
    const url = `${window.location.origin}/r/${roteiro.publicToken}`;
    const mensagem = mensagemDoRoteiro(roteiro, url, marca ?? {});
    window.open(whatsappShareLink(mensagem), "_blank", "noopener,noreferrer");
  }

  if (status === "loading") {
    return <EditorSkeleton />;
  }

  if (status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <BackLink dealId={dealId} />
        <Card className="flex flex-col items-start gap-3 p-5">
          <p className="text-15 text-ink">{errorInfo?.mensagem ?? "Não consegui carregar o roteiro."}</p>
          <Button variant="secondary" onClick={retry}>
            {errorInfo?.correcao ?? "Tentar de novo"}
          </Button>
        </Card>
      </div>
    );
  }

  if (status === "vazio" || !roteiro) {
    return <SemRoteiro dealId={dealId} onGerado={retry} />;
  }

  const datas = formatarFaixaDeDatas(roteiro.departureOn, roteiro.returnOn);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:h-full">
      <div className="flex shrink-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <BackLink dealId={dealId} />
          <CardAction
            onClick={() =>
              window.open(`/r/${roteiro.publicToken}`, "_blank", "noopener,noreferrer")
            }
          >
            Abrir
          </CardAction>
        </div>
        <ViewToggle view={view} onChange={setView} />
      </div>

      <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-2 lg:overflow-hidden">
        <div
          className={cn(
            "flex min-h-0 flex-col gap-4 lg:overflow-y-auto lg:pr-1",
            view === "previa" && "hidden lg:flex",
          )}
        >
          <FichaCard
            roteiro={roteiro}
            datas={datas}
            autosave={autosave}
            itensRef={itensRef}
            blocoComErro={blocoComErro}
            onCopiar={() => void copiarLink()}
            onCompartilhar={mandarPorWhatsApp}
          />
          <RoteiroBlocos
            itens={itens}
            erroNoBloco={blocoComErro}
            onSegurar={segurar}
            onAplicar={aplicar}
            onConfirmar={confirmar}
          />
        </div>

        <div className={cn("min-h-0 lg:overflow-y-auto", view === "editar" && "hidden lg:block")}>
          <RoteiroPreview roteiro={roteiro} blocos={blocosDe(itens)} />
        </div>
      </div>
    </div>
  );
}

function BackLink({ dealId }: { dealId: string }) {
  return (
    <Link
      href={`/funil/${dealId}`}
      className="flex w-fit items-center gap-1 text-13 font-medium text-muted hover:text-ink"
    >
      <ChevronRightIcon className="size-3.5 -scale-x-100" />
      Ficha do negócio
    </Link>
  );
}

/**
 * "Editar"/"Prévia" — mesma peça do editor de proposta: os dois painéis
 * existem sempre no DOM, a visibilidade muda por breakpoint; em 390px os dois
 * registros não cabem lado a lado.
 */
function ViewToggle({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  return (
    <div className="inline-flex w-fit gap-0.5 rounded-md bg-surface-2 p-0.5 lg:hidden">
      {(["editar", "previa"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onPointerDown={() => onChange(option)}
          className={cn(
            "min-h-9 rounded-sm px-3.5 text-13 font-medium",
            view === option ? "bg-surface text-ink shadow-1" : "text-muted",
          )}
        >
          {option === "editar" ? "Editar" : "Prévia"}
        </button>
      ))}
    </div>
  );
}

/* -----------------------------------------------------------------------------
   Ficha — o que NÃO muda, dito com todas as letras. O SavedMark do conteúdo
   mora aqui, no cabeçalho do documento (mesmo padrão do MetaCard do editor de
   proposta); o erro de autosave ganha linha própria com a correção junto; e o
   rodapé é a ENTREGA: mandar por WhatsApp é a ação do documento, copiar o link
   cru é a saída de texto.
   -------------------------------------------------------------------------- */

function FichaCard({
  roteiro,
  datas,
  autosave,
  itensRef,
  blocoComErro,
  onCopiar,
  onCompartilhar,
}: {
  roteiro: RoteiroResumo;
  datas: string | null;
  autosave: ReturnType<typeof useAutosave<BlocoDoRoteiro[]>>;
  itensRef: React.RefObject<ItemBloco[]>;
  /** Índice (0-based) do bloco apontado pela portaria, quando a recusa diz. */
  blocoComErro: number | null;
  onCopiar: () => void;
  onCompartilhar: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
          <h2 className="display min-w-0 text-20 text-ink">{roteiro.title}</h2>
          <SavedMark state={autosave.state} />
        </div>
      </CardHeader>
      <CardBody>
        <p className="text-13 text-muted">
          {roteiro.clientName}
          {datas ? ` · ${datas}` : ""}
        </p>
        <FieldHint>
          O link público, o nome do cliente e as datas não mudam na edição — o que já foi pelo
          WhatsApp continua válido.
        </FieldHint>
        {autosave.state === "error" ? (
          <div className="flex flex-col gap-1">
            <FieldError
              action={
                <button
                  type="button"
                  className="font-medium text-danger underline underline-offset-2"
                  onClick={() => void autosave.commit(blocosDe(itensRef.current))}
                >
                  Tentar de novo
                </button>
              }
            >
              {autosave.error}
            </FieldError>
            {blocoComErro !== null ? (
              <p className="text-13 text-muted">
                É o bloco nº {blocoComErro + 1} da lista — ele está aceso abaixo.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardBody>
      <CardFooter
        action={
          <Button variant="primary" size="sm" onPointerDown={onCompartilhar}>
            <ChatIcon className="size-4" />
            Mandar por WhatsApp
          </Button>
        }
        secondary={<CardAction onClick={onCopiar}>Copiar link</CardAction>}
      >
        A mensagem sai pronta com o link e a sua assinatura — você escolhe a conversa.
      </CardFooter>
    </Card>
  );
}

/* -----------------------------------------------------------------------------
   Sem roteiro — o convite. A geração é idempotente no servidor; a recusa
   (proposta sem aceite, por exemplo) chega com mensagem e correção prontas.
   -------------------------------------------------------------------------- */

function SemRoteiro({ dealId, onGerado }: { dealId: string; onGerado: () => void }) {
  const [gerando, setGerando] = React.useState(false);
  const [erro, setErro] = React.useState<ErroInfo | null>(null);

  async function handleGerar() {
    setGerando(true);
    setErro(null);
    const result = await gerarRoteiro(dealId);
    setGerando(false);
    if (!result.ok) {
      avisarRecusaDeEscrita(result);
      setErro({ mensagem: result.mensagem, correcao: result.correcao });
      return;
    }
    onGerado();
  }

  return (
    <div className="flex flex-col gap-4">
      <BackLink dealId={dealId} />
      <Card className="flex flex-col items-start gap-3 p-5">
        <div className="flex flex-col gap-1">
          <h2 className="display text-20 text-ink">Montar o roteiro da viagem</h2>
          <p className="max-w-[36rem] text-13 leading-[1.5] text-muted">
            O roteiro nasce da proposta aceita e vira blocos editáveis — dias, paradas, hospedagem,
            dicas locais, contato de emergência e fotos. O link público é criado na geração e
            <span className="font-medium text-ink"> não muda mais</span>: cada ajuste aparece na
            mesma URL que o cliente já recebeu.
          </p>
        </div>
        <Button variant="primary" loading={gerando} onPointerDown={() => void handleGerar()}>
          Gerar roteiro
        </Button>
        {erro ? (
          <div className="flex flex-col items-start gap-1">
            <FieldError>{erro.mensagem}</FieldError>
            {erro.correcao ? <p className="text-13 text-muted">{erro.correcao}</p> : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-4 w-28 rounded-xs" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-2/3 rounded-sm" />
        <Skeleton className="h-3.5 w-1/2 rounded-xs" />
      </div>
      <Card className="p-4">
        <SkeletonText lines={3} />
      </Card>
      <Card className="p-4">
        <SkeletonText lines={4} />
      </Card>
    </div>
  );
}
