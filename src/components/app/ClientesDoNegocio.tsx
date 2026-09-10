"use client";

import * as React from "react";
import {
  adicionarClienteAoNegocio,
  listarContatos,
  removerClienteDoNegocio,
  type ClientesDoNegocio,
  type ClienteDoNegocio,
  type ContatoResumo,
  type ServiceResult,
} from "@/server";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Skeleton } from "@/components/ui/Skeleton";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { avisarRecusaDeEscrita } from "@/lib/ui/assinatura";
import { cn } from "@/lib/ui/cn";
import { Rule } from "@/components/plates";

/* =============================================================================
   Clientes do negócio — a composição da viagem (0020)
   -----------------------------------------------------------------------------
   Casal, família, amigos: uma viagem, N clientes, um orçamento. A fonte de
   verdade é a N:N `deal_contacts` NO SERVIDOR — este arquivo é só a Gramática
   comum dos dois editores que a editam (ficha do negócio e editor de
   proposta). Nada de estado duplicado: quem monta a tela semeia o hook com a
   lista que o servidor mandou (`NegocioDetalhe.clientes`) e reconcilia com o
   RETORNO das actions (`ClientesDoNegocio.clientes` já vem atualizado — zero
   reconsulta).

   As peças:
     - `useClientesDoNegocio` — estado + as duas mutações, com os toasts de
       recusa (mensagem E correção juntos, como manda a casa) e o desfazer de
       8s da remoção. O desfazer RE-ADICIONA de verdade: a ação reversa existe
       (a mesma `adicionarClienteAoNegocio`), então "Desfazer" nunca promete o
       que não cumpre — por isso aqui NÃO se usa `useDeferredDelete`, que é
       para exclusão sem restauração.
     - `ClienteRow` — a linha (nome + "Principal" + remover). A MESMA linha na
       ficha e dentro da sheet do editor: uma fonte de verdade visual.
     - `AdicionarClienteSheet` — o campo de busca de contato, sozinho (ficha:
       a lista já está visível no card).
     - `ClientesDaViagemSheet` — lista + busca (editor de proposta: a sheet é
       a única superfície de edição).
     - O sumário em texto ("Preparado para Ana, Carlos e Débora") mora em
       `src/components/public/PreparadoPara.tsx` — é tipografia da CAPA, não
       peça deste módulo, e o editor o reaproveita.

   O cliente PRINCIPAL nunca tem botão de remover — nem desabilitado: o botão
   que não deve ser clicado não deve existir (§15.3 do handoff). O servidor
   recusaria; a interface nem oferece.
   ========================================================================== */

/* --------------------------------------------------------------------- hook -- */

/**
 * A correção que depende de CONTEXTO de tela: "Fechar" só fecha se existe uma
 * sheet aberta para fechar. A ficha passa o setOpen da sheet de adicionar; o
 * editor, o da sheet de edição.
 */
type ContextoDeCorrecao = {
  /** Fecha a sheet que o dono do hook controla, quando a correção pede. */
  aoFecharSheet?: () => void;
};

/**
 * A ação do toast a partir da correção que o servidor mandou. O padrão da
 * casa (`NegocioScreen.handleMove`): correção genérica re-tenta; "Fechar"
 * fecha a sheet, que é literal — e só existe onde há sheet.
 */
function acaoDaRecusa(
  result: Extract<ServiceResult<unknown>, { ok: false }>,
  contexto: ContextoDeCorrecao,
  retentar: () => void,
): { label: string; onClick: () => void } | undefined {
  if (!result.correcao) return undefined;
  if (result.correcao === "Fechar" && contexto.aoFecharSheet) {
    return { label: "Fechar", onClick: contexto.aoFecharSheet };
  }
  return { label: result.correcao, onClick: retentar };
}

export function useClientesDoNegocio({
  dealId,
  iniciais,
  aoFecharSheet,
}: {
  dealId: string;
  /**
   * A lista do último load do servidor. O hook NUNCA busca — quem monta a
   * tela sabe de onde a lista vem (ficha: `obterNegocio`; editor: a leitura
   * própria do MetaCard). Quando a referência muda (recarga da tela), o estado
   * ressincroniza.
   */
  iniciais: ClienteDoNegocio[];
} & ContextoDeCorrecao) {
  const toast = useToast();
  const [clientes, setClientes] = React.useState<ClienteDoNegocio[]>(iniciais);
  /** Uma mutação em voo — o botão que chamou mostra isso, nada mais pisca. */
  const [pendente, setPendente] = React.useState(false);

  /* Ressincroniza quando a tela recarrega e a lista do servidor vem NOVA —
     ajuste de estado durante render (o padrão do React para "prop mudou"),
     porque o efeito síncrono aqui seria um render a mais a cada montagem. */
  const [semente, setSemente] = React.useState(iniciais);
  if (semente !== iniciais) {
    setSemente(iniciais);
    setClientes(iniciais);
  }

  const contexto = React.useMemo(() => ({ aoFecharSheet }), [aoFecharSheet]);

  /**
   * "Recarregar a lista" (a correção do NAO_ENCONTRADO) é da fonte: quem
   * conhece o load da tela registra o retry aqui.
   */
  const retentarRef = React.useRef<() => void>(() => {});
  const definirRetentativa = React.useCallback((fn: () => void) => {
    retentarRef.current = fn;
  }, []);

  const adicionarPeloServidor = React.useCallback(
    async (contatoId: string): Promise<ServiceResult<ClientesDoNegocio>> => {
      setPendente(true);
      const result = await adicionarClienteAoNegocio({ negocioId: dealId, contatoId });
      setPendente(false);
      if (result.ok) {
        setClientes(result.data.clientes);
        return result;
      }
      avisarRecusaDeEscrita(result);
      toast.show({
        title: "Não consegui adicionar o cliente",
        description: result.mensagem,
        tone: "danger",
        action: acaoDaRecusa(result, contexto, () => retentarRef.current()),
      });
      return result;
    },
    [dealId, toast, contexto],
  );

  /** O caminho do DESFAZER: sem toast novo — a linha voltando é o feedback. */
  const voltarAtras = React.useCallback(
    (cliente: ClienteDoNegocio) => {
      void adicionarPeloServidor(cliente.contactId);
    },
    [adicionarPeloServidor],
  );

  /**
   * Remoção DESTRUTIVA com desfazer de 8s: a linha sai no toque, o servidor
   * confirma, o toast devolve o nome se a agente se arrependeu — e o desfazer
   * grava de volta pela MESMA action de adicionar (auditoria dos dois lados,
   * como o servidor já espera).
   */
  const remover = React.useCallback(
    async (cliente: ClienteDoNegocio) => {
      const anteriores = clientes;
      // Otimista: o toque não espera a rede.
      setClientes((current) => current.filter((c) => c.contactId !== cliente.contactId));
      setPendente(true);
      const result = await removerClienteDoNegocio({
        negocioId: dealId,
        contatoId: cliente.contactId,
      });
      setPendente(false);
      if (!result.ok) {
        avisarRecusaDeEscrita(result);
        setClientes(anteriores);
        toast.show({
          title: `Não consegui remover ${cliente.nome}`,
          description: result.mensagem,
          tone: "danger",
          action: acaoDaRecusa(result, contexto, () => retentarRef.current()),
        });
        return;
      }
      setClientes(result.data.clientes);
      toast.undo(`${cliente.nome} saiu da viagem`, () => voltarAtras(cliente));
    },
    [clientes, dealId, toast, contexto, voltarAtras],
  );

  return {
    clientes,
    pendente,
    adicionar: adicionarPeloServidor,
    remover,
    definirRetentativa,
  };
}

/* -------------------------------------------------------------------- linha -- */

/**
 * A MESMA linha nas duas superfícies de edição. O nome do principal é o
 * título da viagem dele — link para a ficha do cliente quando `href` existe.
 * Remover só existe para secundário; no principal, nem renderiza.
 */
export function ClienteRow({
  cliente,
  onRemover,
  href,
}: {
  cliente: ClienteDoNegocio;
  onRemover?: (cliente: ClienteDoNegocio) => void;
  href?: string;
}) {
  const peso = cliente.principal ? "font-medium text-ink" : "text-ink";
  const nome = href ? (
    <a href={href} className={cn("truncate hover:text-accent hover:underline", peso)}>
      {cliente.nome}
    </a>
  ) : (
    <span className={cn("truncate", peso)}>{cliente.nome}</span>
  );

  return (
    <div className="flex min-h-11 items-center gap-1 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-15 text-ink">
        <span className="min-w-0 truncate">{nome}</span>
        {cliente.principal ? <Badge tone="neutral">Principal</Badge> : null}
      </div>
      {!cliente.principal && onRemover ? (
        <button
          type="button"
          onPointerDown={(event) => {
            // decide no toque: remover é destrutivo e corre contra o arrependimento
            event.preventDefault();
            onRemover(cliente);
          }}
          className={cn(
            "shrink-0 rounded-xs px-2 py-2 text-13 font-medium text-danger",
            "hover:text-danger-hover",
            "[@media(pointer:coarse)]:min-h-11",
          )}
        >
          Remover
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ opções -- */

/**
 * Os contatos que PODEM entrar: os que a agente tem, menos os que já estão na
 * viagem. O filtro roda no cliente — a lista de candidatos é pequena (limite
 * da leitura é 200) e o servidor recusaria de qualquer forma (CONFLITO).
 * Devolve TAMBÉM se o cadastro tem contatos NENHUM, porque "você não tem
 * ninguém para convidar" e "todo mundo já está aqui" são mensagens diferentes.
 */
function opcoesDeContatos(
  contatos: ContatoResumo[],
  clientes: ClienteDoNegocio[],
): { opcoes: { value: string; label: string; hint?: string }[]; cadastroVazio: boolean } {
  const dentro = new Set(clientes.map((cliente) => cliente.contactId));
  const opcoes = contatos
    .filter((contato) => !dentro.has(contato.id))
    .map((contato) => ({
      value: contato.id,
      label: contato.name,
      hint: contato.whatsapp ?? contato.phone ?? contato.email ?? undefined,
    }));
  return { opcoes, cadastroVazio: contatos.length === 0 };
}

type EstadoContatos =
  | { fase: "carregando" }
  | { fase: "pronto"; contatos: ContatoResumo[] }
  | { fase: "erro"; mensagem: string; correcao?: string };

/** Carrega os contatos só quando a sheet abre — nada de busca no load da tela.
 *  Reabrir recarrega: a lista de candidatos pode ter mudado desde a última vez. */
function useContatosParaAdicionar(open: boolean): {
  estado: EstadoContatos;
  recarregar: () => void;
} {
  const [estado, setEstado] = React.useState<EstadoContatos>({ fase: "carregando" });
  const [reloadToken, setReloadToken] = React.useState(0);
  const recarregar = React.useCallback(() => {
    setEstado({ fase: "carregando" });
    setReloadToken((token) => token + 1);
  }, []);

  // Ajuste durante render (padrão do React): ao ABRIR, volta a carregar —
  // o estado velho da abertura anterior não pode aparecer como se fosse novo.
  const [abertoAntes, setAbertoAntes] = React.useState(open);
  if (abertoAntes !== open) {
    setAbertoAntes(open);
    if (open) setEstado({ fase: "carregando" });
  }

  React.useEffect(() => {
    if (!open) return;
    let active = true;
    void listarContatos({ limite: 200 }).then((result) => {
      if (!active) return;
      if (result.ok) setEstado({ fase: "pronto", contatos: result.data });
      else setEstado({ fase: "erro", mensagem: result.mensagem, correcao: result.correcao });
    });
    return () => {
      active = false;
    };
  }, [open, reloadToken]);

  return { estado, recarregar };
}

/**
 * Skeleton no MESMO formato do Combobox fechado (h-10, h-11 em ponteiro
 * grosso): a sheet não cresce de repente quando a lista chega — a doutrina do
 * lugar reservado, no milímetro.
 */
function ComboboxSkeleton() {
  return <Skeleton className="h-10 w-full rounded-md [@media(pointer:coarse)]:h-11" />;
}

/** Erro de carga COM a correção junto — leitura falhada nunca vira beco. */
function ErroDeContatos({
  estado,
  onRetry,
}: {
  estado: Extract<EstadoContatos, { fase: "erro" }>;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className="text-13 text-ink">{estado.mensagem}</p>
      <button
        type="button"
        onClick={onRetry}
        className="text-13 font-medium text-ink underline underline-offset-4 hover:text-muted"
      >
        {estado.correcao ?? "Tentar de novo"}
      </button>
    </div>
  );
}

/* --------------------------------------------- sheet de adicionar (ficha) -- */

/**
 * A busca, sozinha. Na ficha do negócio a lista está visível no card — a
 * sheet só pergunta QUEM entra. Escolher já adiciona: um toque a menos numa
 * sheet que abre no meio do atendimento.
 */
export function AdicionarClienteSheet({
  open,
  onOpenChange,
  clientes,
  onEscolher,
  pendente,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientes: ClienteDoNegocio[];
  /** Devolve o resultado para a sheet decidir fechar (só fecha no ok). */
  onEscolher: (contatoId: string) => Promise<ServiceResult<ClientesDoNegocio>>;
  pendente: boolean;
}) {
  const { estado, recarregar } = useContatosParaAdicionar(open);

  async function escolher(contatoId: string | null) {
    if (!contatoId) return;
    const result = await onEscolher(contatoId);
    if (result.ok) onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        open={open}
        onOpenChange={onOpenChange}
        title="Adicionar cliente"
        description="Quem viaja junto — entra na lista na hora e aparece na proposta pública."
      >
        <div className="flex flex-col gap-3 py-2">
          {estado.fase === "carregando" ? (
            <ComboboxSkeleton />
          ) : estado.fase === "erro" ? (
            <ErroDeContatos estado={estado} onRetry={recarregar} />
          ) : (() => {
              const { opcoes, cadastroVazio } = opcoesDeContatos(estado.contatos, clientes);
              return (
                <>
                  <Combobox
                    value={null}
                    onValueChange={(value) => void escolher(value)}
                    options={opcoes}
                    placeholder="Buscar contato pelo nome"
                    searchPlaceholder="Buscar pelo nome, telefone ou e-mail"
                    loading={pendente}
                    emptyMessage={cadastroVazio ? "Nada encontrado" : "Todo mundo do cadastro já está nesta viagem"}
                  />
                  {cadastroVazio ? (
                    <p className="text-13 text-muted">
                      Você ainda não tem contato para convidar — cadastre o acompanhante em
                      Clientes primeiro; a busca puxa de lá.
                    </p>
                  ) : null}
                </>
              );
            })()}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------- sheet completa (editor proposta) -- */

/**
 * Lista + busca na mesma sheet: no editor de proposta esta é a ÚNICA
 * superfície de edição — a linha "Preparado para" do MetaCard é o sumário.
 * A lista usa a MESMA `ClienteRow` da ficha; remover daqui tem o mesmo
 * desfazer de 8s do remover do card, porque os dois são o mesmo hook.
 */
export function ClientesDaViagemSheet({
  open,
  onOpenChange,
  gestor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gestor: ReturnType<typeof useClientesDoNegocio>;
}) {
  const { estado, recarregar } = useContatosParaAdicionar(open);
  const [escolhido, setEscolhido] = React.useState<string | null>(null);

  /** Fecha limpando a escolha: reabrir com alguém pré-selecionado faria o
   *  rodapé acreditar numa escolha que já virou água. */
  function mudarOpen(proximo: boolean) {
    if (!proximo) setEscolhido(null);
    onOpenChange(proximo);
  }

  async function adicionar() {
    if (!escolhido) return;
    const result = await gestor.adicionar(escolhido);
    if (result.ok) {
      setEscolhido(null);
      onOpenChange(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={mudarOpen}>
      <SheetContent
        open={open}
        onOpenChange={mudarOpen}
        title="Clientes da viagem"
        description="Quem recebe esta proposta — o principal responde pela venda."
        footer={
          <Button
            variant="primary"
            block
            disabled={!escolhido}
            loading={gestor.pendente}
            onPointerDown={() => void adicionar()}
          >
            Adicionar à viagem
          </Button>
        }
      >
        <div className="flex flex-col py-1">
          {gestor.clientes.map((cliente) => (
            <React.Fragment key={cliente.contactId}>
              <ClienteRow cliente={cliente} onRemover={(c) => void gestor.remover(c)} />
              <Rule inner />
            </React.Fragment>
          ))}
        </div>

        <div className="flex flex-col gap-2 pt-3">
          <p className="text-13 font-semibold uppercase tracking-[0.04em] text-muted">
            Adicionar acompanhante
          </p>
          {estado.fase === "carregando" ? (
            <ComboboxSkeleton />
          ) : estado.fase === "erro" ? (
            <ErroDeContatos estado={estado} onRetry={recarregar} />
          ) : (() => {
              const { opcoes, cadastroVazio } = opcoesDeContatos(estado.contatos, gestor.clientes);
              return (
                <>
                  <Combobox
                    value={escolhido}
                    onValueChange={setEscolhido}
                    options={opcoes}
                    placeholder="Buscar contato pelo nome"
                    searchPlaceholder="Buscar pelo nome, telefone ou e-mail"
                    emptyMessage={cadastroVazio ? "Nada encontrado" : "Todo mundo do cadastro já está nesta viagem"}
                  />
                  {cadastroVazio ? (
                    <p className="text-13 text-muted">
                      Cadastre o acompanhante em Clientes primeiro — a busca puxa de lá.
                    </p>
                  ) : null}
                </>
              );
            })()}
        </div>
      </SheetContent>
    </Sheet>
  );
}
