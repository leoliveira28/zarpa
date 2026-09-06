"use client";

import * as React from "react";
import Link from "next/link";
import {
  confirmarImportacao,
  listarImportacoes,
  obterRelatorioDeImportacao,
  pravisualizarImportacao,
  type ImportacaoResumo,
  type Mapeamento,
  type MapeamentoColuna,
  type PreviaImportacao,
  type RelatorioImportacao,
} from "@/server";
import { Badge, type BadgeProps } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeading } from "@/components/ui/Card";
import { FieldError } from "@/components/ui/Field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Skeleton, SkeletonRow } from "@/components/ui/Skeleton";
import {
  Table,
  TableFrame,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui/Table";
import { ChevronRightIcon, DocumentIcon, UploadIcon } from "@/components/app/icons";
import { cn } from "@/lib/ui/cn";
import { formatDayMonth } from "@/lib/ui/format";

/* =============================================================================
   Assistente de importação
   -----------------------------------------------------------------------------
   Quatro telas, uma função de servidor cada, nenhum estado guardado no
   servidor entre elas — a mesma decisão de `imports.ts`: o MESMO arquivo é
   mandado duas vezes (pré-visualizar, depois confirmar já com o mapeamento
   ajustado). Aqui isso quer dizer só uma coisa: guardar o `File` inteiro no
   estado do componente entre os passos, e nunca navegar de rota no meio do
   fluxo — só assim ele sobrevive.

   "Importação que perde linha em silêncio é pior que importação que falha"
   (comentário de `imports.ts`) é a régua de tudo aqui: todo aviso do servidor
   aparece, cada linha do arquivo tem uma linha no relatório, e nada resume
   "27 ok" sem dizer quais.
   ========================================================================== */

type Step = "upload" | "mapping" | "result";

const FIELD_LABELS: Record<MapeamentoColuna, string> = {
  name: "Nome",
  email: "E-mail",
  phone: "Telefone",
  whatsapp: "WhatsApp",
  document: "CPF",
  birthDate: "Nascimento",
  source: "Origem",
  notes: "Observações",
  ignorar: "Ignorar coluna",
};

const FIELD_OPTIONS = Object.entries(FIELD_LABELS).map(([value, label]) => ({
  value: value as MapeamentoColuna,
  label,
}));

/* Nunca `accent` aqui: a cor de destaque é reservada para "onde clicar", não
   para status de linha — a mesma regra que tirou o accent do sinal de abertura
   do funil (docs/design/funil-v2.md, item 3.4). */
const SITUACAO_TONE: Record<string, BadgeProps["tone"]> = {
  criado: "ok",
  atualizado: "neutral",
  mesclado: "neutral",
  ignorado: "warn",
};

const SITUACAO_LABEL: Record<string, string> = {
  criado: "Criado",
  atualizado: "Atualizado",
  mesclado: "Mesclado",
  ignorado: "Ignorado",
};

export function ImportWizard() {
  const [step, setStep] = React.useState<Step>("upload");
  const [file, setFile] = React.useState<File | null>(null);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<{ mensagem: string; correcao?: string } | null>(null);

  const [preview, setPreview] = React.useState<PreviaImportacao | null>(null);
  const [mapping, setMapping] = React.useState<Mapeamento>({});
  const [confirming, setConfirming] = React.useState(false);
  const [confirmError, setConfirmError] = React.useState<{ mensagem: string; correcao?: string } | null>(null);

  const [report, setReport] = React.useState<RelatorioImportacao | null>(null);

  async function handleFile(picked: File) {
    setFile(picked);
    setAnalyzing(true);
    setUploadError(null);
    const result = await pravisualizarImportacao(picked);
    setAnalyzing(false);
    if (!result.ok) {
      setUploadError({ mensagem: result.mensagem, correcao: result.correcao });
      setFile(null);
      return;
    }
    setPreview(result.data);
    setMapping(result.data.mapeamentoSugerido);
    setStep("mapping");
  }

  async function handleConfirm() {
    if (!file) return;
    setConfirming(true);
    setConfirmError(null);
    const result = await confirmarImportacao(file, mapping);
    setConfirming(false);
    if (!result.ok) {
      setConfirmError({ mensagem: result.mensagem, correcao: result.correcao });
      return;
    }
    setReport(result.data);
    setStep("result");
  }

  function reset() {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setMapping({});
    setReport(null);
    setUploadError(null);
    setConfirmError(null);
  }

  const hasNameMapped = Object.values(mapping).includes("name");

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/clientes"
        className="flex w-fit items-center gap-1 text-13 font-medium text-muted hover:text-ink"
      >
        <ChevronRightIcon className="size-3.5 -scale-x-100" />
        Clientes
      </Link>

      <header className="flex flex-col gap-1">
        <h2 className="display text-32 text-ink">Importar planilha</h2>
        <p className="text-13 text-muted">
          Colunas fora de ordem não são problema — você confere o mapeamento antes de
          gravar, e nada é salvo até você confirmar.
        </p>
      </header>

      <Stepper step={step} />

      {step === "upload" ? (
        <>
          <Dropzone onFile={handleFile} busy={analyzing} />
          {analyzing ? (
            <Card className="flex flex-col gap-3 p-4">
              <SkeletonRow />
            </Card>
          ) : null}
          {uploadError ? (
            <Card className="flex flex-col items-start gap-3 p-4">
              <FieldError>{uploadError.mensagem}</FieldError>
              {uploadError.correcao ? (
                <p className="text-13 text-muted">{uploadError.correcao}</p>
              ) : null}
            </Card>
          ) : null}
          <RecentImports onOpen={(r) => { setReport(r); setStep("result"); }} />
        </>
      ) : null}

      {step === "mapping" && preview ? (
        <>
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-13 text-muted">
              <span className="flex items-center gap-1.5 text-15 font-medium text-ink">
                <DocumentIcon className="size-4 text-muted" />
                {preview.arquivoNome}
              </span>
              <span>{preview.totalLinhas} linhas</span>
              <span>
                lido como {preview.encoding} · separador &ldquo;{preview.delimitador}&rdquo;
              </span>
            </div>
          </Card>

          <section>
            <SectionHeading>Mapeamento de colunas</SectionHeading>
            <Card className="overflow-hidden">
              <ul className="flex flex-col divide-y divide-line-subtle">
                {preview.colunas.map((coluna) => (
                  <li key={coluna} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-15 font-medium text-ink">{coluna}</p>
                      {preview.amostra[0]?.[coluna] ? (
                        <p className="truncate text-13 text-muted">
                          Ex.: {preview.amostra[0][coluna]}
                        </p>
                      ) : null}
                    </div>
                    <Select
                      value={mapping[coluna] ?? "ignorar"}
                      onValueChange={(value) =>
                        setMapping((current) => ({
                          ...current,
                          [coluna]: value as MapeamentoColuna,
                        }))
                      }
                    >
                      <SelectTrigger size="sm" className="w-40 shrink-0">
                        <SelectValue>{FIELD_LABELS[mapping[coluna] ?? "ignorar"]}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {FIELD_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </li>
                ))}
              </ul>
            </Card>
          </section>

          {!hasNameMapped ? (
            <Card tone="warn" className="p-4">
              <p className="text-15 text-warn-soft-ink">
                Nenhuma coluna está mapeada para Nome. Sem nome não dá para criar um
                cliente — todas as linhas seriam ignoradas.
              </p>
            </Card>
          ) : null}

          <section>
            <SectionHeading>Pré-visualização</SectionHeading>
            <TableFrame>
              <Table>
                <THead>
                  <TR>
                    {preview.colunas.map((coluna) => (
                      <TH key={coluna}>{coluna}</TH>
                    ))}
                  </TR>
                </THead>
                <TBody>
                  {preview.amostra.map((linha, index) => (
                    <TR key={index}>
                      {preview.colunas.map((coluna) => (
                        <TD key={coluna} className="whitespace-nowrap">
                          {linha[coluna] || "—"}
                        </TD>
                      ))}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableFrame>
            <p className="mt-2 text-13 text-muted">
              Mostrando as primeiras {preview.amostra.length} de {preview.totalLinhas} linhas,
              sem nenhum mapeamento aplicado — só para conferir que a leitura bateu.
            </p>
          </section>

          {confirmError ? (
            <Card className="flex flex-col items-start gap-3 p-4">
              <FieldError>{confirmError.mensagem}</FieldError>
              <Button variant="secondary" size="sm" onClick={() => void handleConfirm()}>
                {confirmError.correcao ?? "Tentar de novo"}
              </Button>
            </Card>
          ) : null}

          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              loading={confirming}
              disabled={!hasNameMapped}
              onClick={() => void handleConfirm()}
            >
              Importar {preview.totalLinhas} linhas
            </Button>
            <Button variant="quiet" onClick={reset}>
              Escolher outro arquivo
            </Button>
          </div>
        </>
      ) : null}

      {step === "result" && report ? (
        <ResultStep report={report} onReset={reset} />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------- passos */

function Stepper({ step }: { step: Step }) {
  const items: { id: Step; label: string }[] = [
    { id: "upload", label: "Enviar" },
    { id: "mapping", label: "Conferir" },
    { id: "result", label: "Resultado" },
  ];
  const index = items.findIndex((i) => i.id === step);
  return (
    <ol className="flex items-center gap-2 text-13">
      {items.map((item, i) => (
        <li key={item.id} className="flex items-center gap-2">
          <span
            className={cn(
              "flex items-center gap-1.5 font-medium",
              i === index ? "text-ink" : i < index ? "text-muted" : "text-subtle",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "grid size-5 place-items-center rounded-pill text-13 tabular-nums",
                i <= index ? "bg-accent-soft text-accent-soft-ink" : "bg-surface-3 text-subtle",
              )}
            >
              {i + 1}
            </span>
            {item.label}
          </span>
          {i < items.length - 1 ? (
            <ChevronRightIcon className="size-3 text-subtle" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ upload */

function Dropzone({ onFile, busy }: { onFile: (file: File) => void; busy: boolean }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);

  function openPicker() {
    if (!busy) inputRef.current?.click();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={busy || undefined}
      onClick={openPicker}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPicker();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!busy) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        if (busy) return;
        const dropped = event.dataTransfer.files?.[0];
        if (dropped) onFile(dropped);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 text-center",
        busy && "pointer-events-none opacity-60",
        dragOver ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong",
      )}
    >
      <UploadIcon className="size-6 text-muted" />
      <div>
        <p className="text-15 font-medium text-ink">Toque para escolher a planilha</p>
        <p className="mt-1 text-13 text-muted">
          .csv exportado do Excel, Google Sheets ou Otoos — vírgula ou ponto e vírgula, tanto
          faz
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        disabled={busy}
        onChange={(event) => {
          const picked = event.target.files?.[0];
          event.target.value = "";
          if (picked) onFile(picked);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------- importações */

function RecentImports({ onOpen }: { onOpen: (report: RelatorioImportacao) => void }) {
  const [status, setStatus] = React.useState<"loading" | "ready" | "empty" | "error">("loading");
  const [items, setItems] = React.useState<ImportacaoResumo[]>([]);
  const [openingId, setOpeningId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    void listarImportacoes().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        return;
      }
      setItems(result.data);
      setStatus(result.data.length === 0 ? "empty" : "ready");
    });
    return () => {
      active = false;
    };
  }, []);

  async function open(id: string) {
    setOpeningId(id);
    const result = await obterRelatorioDeImportacao(id);
    setOpeningId(null);
    if (result.ok) onOpen(result.data);
  }

  if (status === "loading") {
    return (
      <Card className="flex flex-col gap-3 p-4">
        <Skeleton className="h-4 w-40 rounded-xs" />
        <SkeletonRow />
      </Card>
    );
  }
  if (status !== "ready") return null;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-13 font-semibold tracking-[0.04em] text-muted uppercase">
        Importações recentes
      </h3>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-line-subtle">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => void open(item.id)}
                disabled={openingId !== null}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 text-left",
                  "hover:bg-surface-2",
                  "disabled:pointer-events-none disabled:opacity-60",
                )}
              >
                <DocumentIcon className="size-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-15 font-medium text-ink">
                    {item.filename}
                  </span>
                  <span className="block text-13 text-muted">
                    {formatDayMonth(new Date(item.createdAt))} · {item.createdRows} criados ·{" "}
                    {item.skippedRows} ignorados
                  </span>
                </span>
                <ChevronRightIcon className="size-4 shrink-0 text-subtle" />
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

/* --------------------------------------------------------------- resultado */

function ResultStep({
  report,
  onReset,
}: {
  report: RelatorioImportacao;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Criados" value={report.criados} tone="ink" />
        <StatTile label="Atualizados" value={report.atualizados} tone="ink" />
        <StatTile label="Mesclados" value={report.mesclados} tone="muted" />
        <StatTile
          label="Ignorados"
          value={report.ignorados}
          tone={report.ignorados > 0 ? "warn" : "muted"}
        />
      </div>

      {report.itens.length > 0 ? (
        <TableFrame>
          <Table>
            <THead>
              <TR>
                <TH numeric>Linha</TH>
                <TH>Nome</TH>
                <TH>Situação</TH>
                <TH>Detalhe</TH>
              </TR>
            </THead>
            <TBody>
              {report.itens
                .slice()
                .sort((a, b) => a.linha - b.linha)
                .map((item) => (
                  <TR key={item.linha}>
                    <TD numeric>{item.linha}</TD>
                    <TD>{item.nome ?? "—"}</TD>
                    <TD>
                      <Badge tone={SITUACAO_TONE[item.situacao] ?? "neutral"}>
                        {SITUACAO_LABEL[item.situacao] ?? item.situacao}
                      </Badge>
                    </TD>
                    <TD className="max-w-80 text-13 text-muted">
                      {[item.motivo, ...(item.avisos ?? [])].filter(Boolean).join(" · ") || "—"}
                    </TD>
                  </TR>
                ))}
            </TBody>
          </Table>
        </TableFrame>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" asChild>
          <Link href="/clientes">Ver clientes importados</Link>
        </Button>
        <Button variant="quiet" onClick={onReset}>
          Importar outra planilha
        </Button>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ink" | "muted" | "warn";
}) {
  const toneClass = tone === "warn" ? "text-warn" : tone === "muted" ? "text-muted" : "text-ink";
  return (
    <Card className="p-4">
      <p className="text-13 font-medium text-muted">{label}</p>
      <p data-numeric className={cn("mt-1 text-32 font-semibold tabular-nums", toneClass)}>
        {value}
      </p>
    </Card>
  );
}
