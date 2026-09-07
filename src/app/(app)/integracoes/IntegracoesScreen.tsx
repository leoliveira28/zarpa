"use client";

import * as React from "react";
import {
  criarIntegracao,
  listarIntegracoes,
  removerIntegracao,
  type IntegracaoResumo,
  type Provider,
} from "@/server";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardAction,
  CardBody,
  CardFooter,
  CardHeader,
  CardTitle,
  SectionHeading,
} from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldError, FieldHint, Label } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Money } from "@/components/ui/Money";
import { Rule } from "@/components/plates";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Skeleton, SkeletonRow } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useDeferredDelete } from "@/lib/ui/useDeferredDelete";
import { formatDayMonth } from "@/lib/ui/format";

/* =============================================================================
   Integrações — contas de fornecedor (Wooba + Infotravel), cotação só
   -----------------------------------------------------------------------------
   Registro silencioso: papel, fio entre seções, uma cor de destaque. O azul do
   accent aparece uma vez — no botão "Cadastrar". O restante é tinta sobre papel.

   Credenciais nunca voltam: `listarIntegracoes` devolve `IntegracaoResumo`
   sem `credentials`. Os campos de credencial são `type="password"` e limpos
   após submit. Remover é físico, com toast de desfazer de 8s.
   ========================================================================== */

type Status = "loading" | "ready" | "error";

const PROVIDER_LABEL: Record<Provider, string> = {
  wooba: "Wooba",
  infotravel: "Infotravel",
};

/**
 * Campos de credencial por provider. O `key` é o que vai no
   `Record<string,string>` que o backend encripta — nunca exposto na
   listagem (`IntegracaoResumo` não tem `credentials`).
 */
const PROVIDER_FIELDS: Record<
  Provider,
  { key: string; label: string; placeholder: string }[]
> = {
  wooba: [{ key: "apiKey", label: "Chave de API", placeholder: "••••••••" }],
  infotravel: [
    { key: "apiKey", label: "Chave de API", placeholder: "••••••••" },
    { key: "clientId", label: "Client ID", placeholder: "••••••••" },
  ],
};

export function IntegracoesScreen() {
  const [status, setStatus] = React.useState<Status>("loading");
  const [integracoes, setIntegracoes] = React.useState<IntegracaoResumo[]>([]);
  const [errorInfo, setErrorInfo] = React.useState<{
    mensagem: string;
    correcao?: string;
  } | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const retry = React.useCallback(() => setReloadToken((t) => t + 1), []);
  const toast = useToast();

  const scheduleRemove = useDeferredDelete<IntegracaoResumo>({
    label: (item) => `Conta removida: ${item.label}`,
    commit: (item) => removerIntegracao(item.id),
    onFailure: (_item, mensagem) => {
      toast.show({
        title: "Não consegui remover a conta",
        description: mensagem,
        tone: "danger",
      });
      retry();
    },
  });

  React.useEffect(() => {
    let active = true;
    setStatus((current) => (current === "ready" ? current : "loading"));
    void listarIntegracoes().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setErrorInfo({ mensagem: result.mensagem, correcao: result.correcao });
        return;
      }
      setIntegracoes(result.data);
      setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  function handleRemoved(item: IntegracaoResumo) {
    setIntegracoes((current) => current.filter((i) => i.id !== item.id));
    scheduleRemove(item);
  }

  function handleCreated(nova: IntegracaoResumo) {
    setIntegracoes((current) => [nova, ...current]);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="display text-32 text-ink">Integrações</h2>
        <p className="text-13 text-muted">
          Cadastre sua conta de Wooba ou Infotravel para buscar cotações reais
          no construtor de proposta.
        </p>
      </header>

      {status === "loading" ? (
        <IntegracoesSkeleton />
      ) : status === "error" ? (
        <Card className="flex flex-col items-start gap-3 p-5">
          <p className="text-15 text-ink">{errorInfo?.mensagem}</p>
          <Button variant="secondary" onClick={retry}>
            {errorInfo?.correcao ?? "Tentar de novo"}
          </Button>
        </Card>
      ) : (
        <>
          <ContasSection integracoes={integracoes} onRemoved={handleRemoved} />
          <CadastrarSection onCreated={handleCreated} />
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- contas cadastradas */

function ContasSection({
  integracoes,
  onRemoved,
}: {
  integracoes: IntegracaoResumo[];
  onRemoved: (item: IntegracaoResumo) => void;
}) {
  if (integracoes.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <SectionHeading>Contas cadastradas</SectionHeading>
        <EmptyState
          title="Nenhuma conta cadastrada"
          description="Cadastre sua conta de Wooba ou Infotravel para buscar cotações reais no construtor de proposta. Sem conta ativa, a busca usa dados de exemplo."
          preview={
            <Card className="flex items-center justify-between gap-3 p-3">
              <span className="flex min-w-0 flex-col">
                <span className="text-15 font-medium text-ink">
                  Wooba — Conta principal
                </span>
                <span className="text-13 text-muted">Cadastrada em 12 set</span>
              </span>
              <Badge tone="ok" dot>
                Ativa
              </Badge>
            </Card>
          }
        />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading>Contas cadastradas</SectionHeading>
      <Card className="flex flex-col p-1">
        {integracoes.map((item, index) => (
          <React.Fragment key={item.id}>
            {index > 0 ? <Rule inner /> : null}
            <ContaRow item={item} onRemoved={() => onRemoved(item)} />
          </React.Fragment>
        ))}
      </Card>
    </section>
  );
}

function ContaRow({
  item,
  onRemoved,
}: {
  item: IntegracaoResumo;
  onRemoved: () => void;
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 rounded-md px-3 py-2.5">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="truncate text-15 font-medium text-ink">
            {item.label}
          </span>
          <Badge tone={item.isActive ? "ok" : "neutral"} dot>
            {item.isActive ? "Ativa" : "Inativa"}
          </Badge>
        </span>
        <span className="text-13 text-muted tabular-nums">
          {PROVIDER_LABEL[item.provider]} — cadastrada em{" "}
          {formatDayMonth(new Date(item.createdAt))}
        </span>
      </span>
      <CardAction
        className="text-danger hover:text-danger"
        onPointerDown={onRemoved}
      >
        Remover
      </CardAction>
    </div>
  );
}

/* --------------------------------------------------------------- cadastrar conta */

function CadastrarSection({
  onCreated,
}: {
  onCreated: (item: IntegracaoResumo) => void;
}) {
  const toast = useToast();
  const [provider, setProvider] = React.useState<Provider>("wooba");
  const [label, setLabel] = React.useState("");
  const [credentials, setCredentials] = React.useState<Record<string, string>>(
    {},
  );
  const [labelError, setLabelError] = React.useState<string | null>(null);
  const [credError, setCredError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  function handleProviderChange(next: Provider) {
    if (next === provider) return;
    setProvider(next);
    setCredentials({});
    setCredError(null);
  }

  function handleCredentialChange(key: string, value: string) {
    setCredentials((current) => ({ ...current, [key]: value }));
    setCredError(null);
  }

  async function handleSubmit() {
    const trimmedLabel = label.trim();
    if (trimmedLabel.length < 2) {
      setLabelError("O nome precisa de 2 letras ou mais.");
      return;
    }
    if (trimmedLabel.length > 100) {
      setLabelError("O nome pode ter no máximo 100 letras.");
      return;
    }
    const fields = PROVIDER_FIELDS[provider];
    const missing = fields.filter((f) => !credentials[f.key]?.trim());
    if (missing.length > 0) {
      setCredError(
        `Preencha ${missing.map((m) => m.label).join(", ")} para continuar.`,
      );
      return;
    }

    setSubmitting(true);
    const result = await criarIntegracao({
      provider,
      label: trimmedLabel,
      credentials,
    });
    setSubmitting(false);

    if (!result.ok) {
      toast.show({
        title: "Não consegui cadastrar a conta",
        description: result.mensagem,
        tone: "danger",
        action: result.correcao
          ? { label: result.correcao, onClick: () => void handleSubmit() }
          : undefined,
      });
      return;
    }

    // Limpa credenciais do estado local — nunca voltam do servidor.
    setLabel("");
    setCredentials({});
    setCredError(null);
    setLabelError(null);
    onCreated(result.data);
    toast.show({
      title: `Conta ${PROVIDER_LABEL[provider]} cadastrada`,
      description: result.data.label,
      tone: "ok",
    });
  }

  const fields = PROVIDER_FIELDS[provider];

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading>Cadastrar nova conta</SectionHeading>
      <Card>
        <CardHeader>
          <CardTitle>Nova conta</CardTitle>
        </CardHeader>
        <CardBody className="gap-4">
          <Field>
            <Label>Fornecedor</Label>
            <Select
              value={provider}
              onValueChange={(v) => handleProviderChange(v as Provider)}
            >
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="wooba">{PROVIDER_LABEL.wooba}</SelectItem>
                <SelectItem value="infotravel">
                  {PROVIDER_LABEL.infotravel}
                </SelectItem>
              </SelectContent>
            </Select>
            <FieldHint>
              Escolha o fornecedor que você tem conta. A busca de cotação no
              construtor usa a conta ativa que você cadastrar aqui.
            </FieldHint>
          </Field>

          <Field invalid={labelError ? true : false}>
            <Label>Nome da conta</Label>
            <Input
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
                setLabelError(null);
              }}
              placeholder="Ex.: Conta principal"
              maxLength={100}
              aria-invalid={labelError ? true : undefined}
            />
            {labelError ? <FieldError>{labelError}</FieldError> : null}
            <FieldHint>
              Um nome para você reconhecer a conta. Pode ter até 100 letras.
            </FieldHint>
          </Field>

          <Rule inner />

          <div className="flex flex-col gap-3">
            <span className="text-13 font-medium text-ink">
              Credenciais de {PROVIDER_LABEL[provider]}
            </span>
            {fields.map((field) => (
              <Field key={field.key} invalid={credError ? true : false}>
                <Label>{field.label}</Label>
                <Input
                  type="password"
                  value={credentials[field.key] ?? ""}
                  onChange={(event) =>
                    handleCredentialChange(field.key, event.target.value)
                  }
                  placeholder={field.placeholder}
                  autoComplete="off"
                  aria-invalid={credError ? true : undefined}
                />
              </Field>
            ))}
            {credError ? <FieldError>{credError}</FieldError> : null}
            <FieldHint>
              As credenciais são encriptadas e nunca aparecem novamente — nem
              na listagem, nem em nenhuma outra tela.
            </FieldHint>
          </div>
        </CardBody>
        <CardFooter
          action={
            <Button
              variant="primary"
              size="sm"
              loading={submitting}
              onPointerDown={() => void handleSubmit()}
            >
              Cadastrar conta
            </Button>
          }
        >
          <span className="text-13 text-muted">
            Cotação só — sem reserva real.
          </span>
        </CardFooter>
      </Card>
    </section>
  );
}

/* --------------------------------------------------------------- skeleton */

function IntegracoesSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-32 rounded-xs" />
        <Card className="flex flex-col divide-y divide-line-subtle p-1">
          {[0, 1].map((row) => (
            <div key={row} className="p-3">
              <SkeletonRow />
            </div>
          ))}
        </Card>
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-40 rounded-xs" />
        <Card className="p-4">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        </Card>
      </div>
    </div>
  );
}
