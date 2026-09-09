"use client";

import * as React from "react";
import { atualizarMarca, enviarImagemDaProposta, obterTenantAtual } from "@/server";
import type { ServiceResult } from "@/server";
import { avisarRecusaDeEscrita } from "@/lib/ui/assinatura";
import { Assinatura } from "@/components/public/Assinatura";
import { Button } from "@/components/ui/Button";
import { Card, CardAction, CardBody, CardFooter, CardHeader, CardTitle } from "@/components/ui/Card";
import { Field, FieldError, FieldHint, Label, SavedMark } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { UploadIcon } from "@/components/app/icons";
import { waMeLink } from "@/lib/ui/whatsapp";
import { useAutosave } from "@/lib/ui/useAutosave";

/* =============================================================================
   "Sua marca" — a tela que faltava para a marca deixar de ser dado de banco
   -----------------------------------------------------------------------------
   Tudo aqui é PATCH de um campo por vez (`atualizarMarca` aceita entrada
   parcial; `undefined` NÃO TOCA na coluna — 0017): cada campo salva no blur
   com "Salvo" discreto, sem botão Salvar. O gate de dunning vale para toda
   escrita; a recusa acende o banner global e o "Não salvou" do campo.

   As recusas de FORMATO não chegam ao servidor: `marcaInput` do tenants.ts
   devolveria mensagem crua de zod (em inglês) para nome curto — a guarda é
   aqui, com a frase no vocabulário da agente e a correção junto do erro.

   O rodapé da página é a PROVA: o componente `<Assinatura />` — o mesmo das
   duas páginas públicas, sem moldura, sobre o mesmo papel — lendo o ESTADO
   LOCAL. Preview ao vivo de verdade: a digitação vira colofão na hora, não
   depois do salvamento.
   ========================================================================== */

type ValoresDaMarca = {
  brandName: string;
  agentDisplayName: string;
  whatsapp: string;
  instagram: string;
  brandLogoUrl: string;
};

export function ConfiguracoesScreen() {
  const toast = useToast();
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [valores, setValores] = React.useState<ValoresDaMarca | null>(null);
  const [erroCarga, setErroCarga] = React.useState<{ mensagem: string; correcao?: string } | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    void obterTenantAtual().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setErroCarga({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setValores({
        brandName: result.data.brandName ?? "",
        agentDisplayName: result.data.agentDisplayName ?? "",
        whatsapp: result.data.whatsapp ?? "",
        instagram: result.data.instagram ?? "",
        brandLogoUrl: result.data.brandLogoUrl ?? "",
      });
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  if (status === "loading") return <TelaSkeleton />;
  if (status === "error" || !valores) {
    return (
      <Card className="flex flex-col items-start gap-3 p-5">
        <FieldError>{erroCarga?.mensagem ?? "Não consegui carregar a sua marca."}</FieldError>
        <Button
          variant="secondary"
          onPointerDown={() => setReloadToken((token) => token + 1)}
        >
          {erroCarga?.correcao ?? "Tentar de novo"}
        </Button>
      </Card>
    );
  }

  /** Uma função só por campo: serve ao preview (cada tecla) e à conciliação
   * pós-save (o servidor grava o valor trimado — o estado local acompanha). */
  const mudou = (campo: keyof ValoresDaMarca) => (valor: string) =>
    setValores((atual) => (atual ? { ...atual, [campo]: valor } : atual));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="display text-32 text-ink">Sua marca</h1>
        <p className="max-w-[36rem] text-15 leading-[1.5] text-muted">
          É o que assina a proposta e o roteiro que o cliente recebe — e o que aparece na barra
          de WhatsApp das páginas públicas.
        </p>
      </header>

      {/* Identidade — nome e logo. */}
      <Card>
        <CardHeader>
          <CardTitle>Identidade</CardTitle>
        </CardHeader>
        <CardBody>
          <CampoDaMarca
            label="Nome da agência"
            valor={valores.brandName}
            onChange={mudou("brandName")}
            aoSalvar={mudou("brandName")}
            salvar={(valor) => atualizarMarca({ brandName: valor })}
            validar={(valor) =>
              valor.length < 2 ? "O nome da agência precisa de pelo menos 2 letras." : null
            }
          />
          <div className="mt-4">
            <CampoLogo
              valor={valores.brandLogoUrl}
              inicial={valores.brandName.trim().charAt(0).toUpperCase()}
              aoAplicar={mudou("brandLogoUrl")}
            />
          </div>
        </CardBody>
      </Card>

      {/* Assinatura — a segunda metade do colofão ("por …"). 0017. */}
      <Card>
        <CardHeader>
          <CardTitle>Assinatura</CardTitle>
        </CardHeader>
        <CardBody>
          <CampoDaMarca
            label="Seu nome"
            optional
            valor={valores.agentDisplayName}
            onChange={mudou("agentDisplayName")}
            aoSalvar={mudou("agentDisplayName")}
            salvar={(valor) => atualizarMarca({ agentDisplayName: valor })}
          >
            <FieldHint>
              Assina como “por seu nome” no fim da proposta e do roteiro. Vazio assina só com a
              agência.
            </FieldHint>
          </CampoDaMarca>
        </CardBody>
        <CardFooter>Agência, seu nome, o app — nessa ordem, sempre igual.</CardFooter>
      </Card>

      {/* Contato público — o que vira botão e link nas páginas do cliente. */}
      <Card>
        <CardHeader>
          <CardTitle>Contato nas páginas públicas</CardTitle>
        </CardHeader>
        <CardBody>
          <CampoDaMarca
            label="WhatsApp"
            optional
            valor={valores.whatsapp}
            onChange={mudou("whatsapp")}
            aoSalvar={mudou("whatsapp")}
            salvar={(valor) => atualizarMarca({ whatsapp: valor })}
            validar={(valor) => {
              if (valor === "") return null;
              return waMeLink(valor) === null
                ? "Esse número não abre conversa — precisa de 10 a 15 dígitos, com DDD."
                : null;
            }}
          >
            <FieldHint>
              É o número que o cliente toca para falar com você na proposta e no roteiro.
            </FieldHint>
          </CampoDaMarca>

          <div className="mt-4">
            <CampoDaMarca
              label="Instagram"
              optional
              valor={valores.instagram}
              onChange={mudou("instagram")}
              aoSalvar={mudou("instagram")}
              salvar={(valor) => atualizarMarca({ instagram: valor })}
            >
              <FieldHint>O @ ou o link do perfil — entra na assinatura.</FieldHint>
            </CampoDaMarca>
          </div>
        </CardBody>
      </Card>

      {/* A prova, no rodapé e SEM MOLDURA — como o cliente encontra, no mesmo
          papel, com o mesmo fio. Estado local: digitação vira colofão. */}
      <section className="flex flex-col gap-2">
        <p className="text-13 font-medium text-muted">
          Como o cliente vê no fim da proposta e do roteiro
        </p>
        <div className="px-2 py-6">
          <Assinatura
            marca={{
              brandName: valores.brandName,
              agentDisplayName: valores.agentDisplayName,
            }}
            instagram={valores.instagram}
          />
        </div>
        <p className="text-13 leading-[1.5] text-muted">
          A mesma assinatura vai na mensagem do botão “Mandar por WhatsApp” do editor de roteiro.
        </p>
      </section>
    </div>
  );
}

/* -----------------------------------------------------------------------------
   Campo da marca — valor local (o preview lê a cada tecla), rede no blur.
   Sem mudança desde o último salvamento, blur não fala com o servidor.
   -------------------------------------------------------------------------- */

function CampoDaMarca({
  label,
  optional,
  valor,
  onChange,
  salvar,
  validar,
  aoSalvar,
  children,
}: {
  label: string;
  optional?: boolean;
  valor: string;
  onChange: (valor: string) => void;
  salvar: (valor: string) => Promise<ServiceResult<unknown>>;
  /** Recusa local antes da rede; `null` = pode ir. */
  validar?: (valor: string) => string | null;
  /** Concilia o preview com o que o servidor gravou (trim). */
  aoSalvar?: (valor: string) => void;
  children?: React.ReactNode;
}) {
  const autosave = useAutosave(salvar, { idleAfterMs: 2000 });
  const [erroLocal, setErroLocal] = React.useState<string | null>(null);
  // O último valor que o SERVIDOR confirmou — não o digitado (comparar com o
  // digitado faria todo blur parecer "intocado" e o campo nunca salvaria).
  const salvoRef = React.useRef(valor);

  function salvarAgora() {
    if (valor === salvoRef.current) return;
    const limpo = valor.trim();
    const recusa = validar?.(limpo) ?? null;
    if (recusa !== null) {
      setErroLocal(recusa);
      return;
    }
    setErroLocal(null);
    aoSalvar?.(limpo);
    void autosave.commit(limpo).then((result) => {
      // Só vira o novo "intocado" se o servidor confirmar — falhando, o valor
      // continua diferente e o "Tentar de novo" (ou o próximo blur) reenvia.
      if (result.ok) salvoRef.current = limpo;
    });
  }

  const invalido = erroLocal !== null || autosave.state === "error";

  return (
    <Field invalid={invalido}>
      <div className="flex items-baseline justify-between gap-3">
        <Label optional={optional}>{label}</Label>
        <SavedMark state={invalido ? "error" : autosave.state} />
      </div>
      <Input
        value={valor}
        onChange={(event) => onChange(event.target.value)}
        onBlur={salvarAgora}
      />
      {erroLocal !== null ? (
        <FieldError>{erroLocal}</FieldError>
      ) : autosave.state === "error" ? (
        <FieldError
          action={
            <button
              type="button"
              className="font-medium text-danger underline underline-offset-2"
              onPointerDown={salvarAgora}
            >
              Tentar de novo
            </button>
          }
        >
          {autosave.error}
        </FieldError>
      ) : (
        children
      )}
    </Field>
  );
}

/* -----------------------------------------------------------------------------
   Logo — o único campo que não é texto. Upload pelo MESMO caminho do editor
   de proposta (`enviarImagemDaProposta`): um caminho só de upload no produto.
   O vazio não é caixa tracejada vazia: é a inicial da agência — o lugar onde
   o logo vai ficar, ocupado pelo que já se tem.
   Remover é destrutivo → toast com desfazer de 8s (restaura a URL anterior).
   -------------------------------------------------------------------------- */

function CampoLogo({
  valor,
  inicial,
  aoAplicar,
}: {
  valor: string;
  inicial: string;
  aoAplicar: (valor: string) => void;
}) {
  const toast = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  async function enviarLogo(file: File) {
    setEnviando(true);
    setErro(null);
    // Upload e gravação são duas etapas DE PROPÓSITO: falhando a gravação, o
    // erro manda tentar de novo sem o arquivo se perder.
    const upload = await enviarImagemDaProposta(file);
    if (!upload.ok) {
      setEnviando(false);
      avisarRecusaDeEscrita(upload);
      setErro(upload.mensagem);
      return;
    }
    const gravou = await atualizarMarca({ brandLogoUrl: upload.data.url });
    setEnviando(false);
    if (!gravou.ok) {
      avisarRecusaDeEscrita(gravou);
      setErro(gravou.mensagem);
      return;
    }
    aoAplicar(upload.data.url);
    toast.show({ title: "Logo atualizado" });
  }

  function removerLogo() {
    const anterior = valor;
    aoAplicar("");
    void atualizarMarca({ brandLogoUrl: "" });
    toast.undo("Logo removido", () => {
      aoAplicar(anterior);
      void atualizarMarca({ brandLogoUrl: anterior });
    }, { duration: 8000 });
  }

  return (
    <Field invalid={erro !== null}>
      <Label optional>Logo</Label>
      <div className="flex items-center gap-3">
        {valor !== "" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={valor}
            alt=""
            className="size-14 shrink-0 rounded-full border border-line object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="grid size-14 shrink-0 place-items-center rounded-full border border-dashed border-line text-17 font-medium text-subtle"
          >
            {inicial !== "" ? inicial : "·"}
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onPointerDown={() => inputRef.current?.click()}
              disabled={enviando}
            >
              <UploadIcon className="size-4" />
              {enviando ? "Enviando…" : valor === "" ? "Enviar logo" : "Trocar"}
            </Button>
            {valor !== "" ? (
              <CardAction onClick={removerLogo} className="text-danger hover:text-danger">
                Remover
              </CardAction>
            ) : null}
          </div>
          {erro !== null ? (
            <FieldError>{erro}</FieldError>
          ) : (
            <FieldHint>Redondo, ao lado do nome nas páginas públicas.</FieldHint>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void enviarLogo(file);
        }}
      />
    </Field>
  );
}

function TelaSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48 rounded-sm" />
        <Skeleton className="h-4 w-72 rounded-xs" />
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
