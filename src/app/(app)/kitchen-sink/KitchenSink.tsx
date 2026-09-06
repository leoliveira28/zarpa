"use client";

/**
 * /kitchen-sink — critério de aceite do S2.
 *
 * Todo componente de `src/components/ui`, em todos os estados (repouso, hover,
 * foco por teclado, carregando, erro, vazio, desabilitado — os que se aplicam
 * a cada um), nos dois temas, e com `prefers-reduced-motion`.
 *
 * Três mecanismos fazem o "parado" ser possível de olhar, em vez de precisar
 * segurar o mouse ou mudar preferência do SO no meio da conferência:
 *
 *   `.force-hover` / `.force-focus`   — globals.css. Redefinem a variante
 *     `hover:` e congelam o anel de `:focus-visible`. Valem para QUALQUER
 *     componente não-portalado — é por isso que aparecem em quase toda
 *     seção abaixo, e não só no Button.
 *
 *   `ReducedMotionOverride`            — src/lib/ui/motion.ts. Força ligado
 *     ou desligado numa sub-árvore sem tocar a preferência do sistema. Junto
 *     com `.force-reduced-motion` (tokens.css, mesma dupla do `@media`), dá
 *     pra mostrar "normal" e "reduced-motion ligado" lado a lado.
 *
 *   ThemeIsland                        — `.theme-dark` entra na mesma regra
 *     de `:root[data-theme=dark]` (um seletor a mais, não um valor a mais),
 *     então claro e escuro cabem na mesma tela para componente NÃO-PORTALADO.
 *
 * O que ThemeIsland NÃO cobre: Select, Combobox, Dialog, Sheet, Toast e
 * Tooltip renderizam o painel num Portal para `document.body` — fora da árvore
 * da ilha, então herdam o tema do DOCUMENTO, não da ilha. Cada seção desses
 * mostra o componente uma vez e diz para alternar o tema pelo seletor do
 * shell (barra lateral) para conferir o outro. Fingir uma ilha ali seria o
 * kitchen-sink mentindo sobre o que está de fato testando.
 */
import * as React from "react";
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
import { Checkbox, CheckboxRow } from "@/components/ui/Checkbox";
import { Combobox } from "@/components/ui/Combobox";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  Field,
  FieldError,
  FieldHint,
  Label,
  SavedMark,
} from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Money, MoneyStat } from "@/components/ui/Money";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/Sheet";
import { Skeleton, SkeletonRow, SkeletonText } from "@/components/ui/Skeleton";
import {
  Table,
  TableFrame,
  TableSkeletonRows,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui/Table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { Tooltip } from "@/components/ui/Tooltip";
import { ArchPlate, BiplanePlate, CompassPlate, FernPlate, Rule } from "@/components/plates";
import { OpenedIcon } from "@/components/app/icons";
import { cn } from "@/lib/ui/cn";
import { ReducedMotionOverride } from "@/lib/ui/motion";

const VARIANTS = ["primary", "secondary", "ghost", "quiet", "danger"] as const;

const BUTTON_STATES = [
  { label: "repouso", props: {}, className: "" },
  { label: "hover", props: {}, className: "force-hover" },
  { label: "pressionado", props: { "data-pressed": "" }, className: "" },
  { label: "foco", props: {}, className: "force-focus" },
  { label: "carregando", props: { loading: true }, className: "" },
  { label: "desabilitado", props: { disabled: true }, className: "" },
] as const;

export function KitchenSink() {
  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-1">
        <h2 className="display text-32 text-ink">Kitchen sink</h2>
        <p className="max-w-prose text-13 text-muted">
          Todo componente de <code>src/components/ui</code> em todos os
          estados, nos dois temas, com <code>prefers-reduced-motion</code>.
          Portal (Select, Combobox, Dialog, Sheet, Toast, Tooltip) segue o
          tema do documento — use o seletor da barra lateral para conferir o
          escuro nesses.
        </p>
      </header>

      <ButtonSection />
      <BadgeSection />
      <CardSection />
      <EmptyStateSection />
      <TableSection />
      <TabsSection />
      <CheckboxSection />
      <FieldSection />
      <SelectSection />
      <ComboboxSection />
      <MoneySection />
      <SkeletonSection />
      <DialogSection />
      <SheetSection />
      <ToastSection />
      <TooltipSection />
      <PlatesSection />
      <ReducedMotionSection />
    </div>
  );
}

/* =============================================================================
   Infraestrutura de demonstração
   ========================================================================== */

function Heading({
  children,
  note,
}: {
  children: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <SectionHeading>{children}</SectionHeading>
      {note ? (
        <p className="-mt-1 mb-3 max-w-prose text-13 text-muted">{note}</p>
      ) : null}
    </div>
  );
}

/**
 * Ilha de tema. `.theme-dark` entra na MESMA regra do `:root[data-theme=dark]`
 * do tokens.css — é um seletor a mais, não um valor a mais — e por isso os dois
 * temas podem aparecer na mesma página sem nenhuma cor nascer aqui. Só serve
 * para componente NÃO-PORTALADO — ver nota no topo do arquivo.
 */
function ThemeIsland({
  label,
  dark,
  children,
}: {
  label: string;
  dark?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg bg-bg p-4",
        dark && "theme-dark",
      )}
    >
      <span className="text-13 font-semibold tracking-[0.04em] text-muted uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

function TwoThemes({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <ThemeIsland label="Claro">{children}</ThemeIsland>
      <ThemeIsland label="Escuro" dark>
        {children}
      </ThemeIsland>
    </div>
  );
}

/** Nota fixa para toda seção cujo painel é portalado. */
function PortalNote() {
  return (
    <p className="max-w-prose text-13 text-muted">
      Painel em Portal — segue o tema do documento. Alterne o tema na barra
      lateral para ver o escuro.
    </p>
  );
}

/* =============================================================================
   Button
   ========================================================================== */

function ButtonSection() {
  return (
    <section className="flex flex-col gap-4">
      <Heading note="Contraste medido no tema claro: contorno de controle 3,78:1 sobre branco (era 1,41:1), 5,30:1 no hover. Rótulo desabilitado 4,72:1.">
        Button — cinco variantes, seis estados
      </Heading>
      <TwoThemes>
        {["bg-bg", "bg-surface"].map((surface) => (
          <div key={surface} className="flex flex-col gap-2">
            <span className="text-13 text-subtle">
              {surface === "bg-bg" ? "sobre papel" : "sobre card"}
            </span>
            <div className={cn("overflow-x-auto rounded-md p-3", surface)}>
              <table className="w-full border-separate border-spacing-x-3 border-spacing-y-2">
                <thead>
                  <tr>
                    <th className="text-left text-13 font-medium text-subtle" />
                    {BUTTON_STATES.map((state) => (
                      <th
                        key={state.label}
                        className="text-left text-13 font-medium text-subtle"
                      >
                        {state.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {VARIANTS.map((variant) => (
                    <tr key={variant}>
                      <th className="pr-2 text-left text-13 font-medium text-muted">
                        {variant}
                      </th>
                      {BUTTON_STATES.map((state) => (
                        <td key={state.label}>
                          <Button
                            variant={variant}
                            size="sm"
                            className={state.className}
                            {...state.props}
                          >
                            Enviar
                          </Button>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </TwoThemes>
    </section>
  );
}

/* =============================================================================
   Badge
   ========================================================================== */

function BadgeSection() {
  const tones = ["neutral", "accent", "ok", "warn", "danger"] as const;
  return (
    <section className="flex flex-col gap-4">
      <Heading>Badge — cinco tons, com e sem ponto</Heading>
      <TwoThemes>
        <div className="flex flex-wrap gap-2">
          {tones.map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {tones.map((tone) => (
            <Badge key={tone} tone={tone} dot size="md">
              {tone}
            </Badge>
          ))}
        </div>
      </TwoThemes>
    </section>
  );
}

/* =============================================================================
   Card
   ========================================================================== */

function CardSection() {
  const tones = ["default", "raised", "inset", "accent", "warn"] as const;
  return (
    <section className="flex flex-col gap-4">
      <Heading note="Proporção base/fuste/capitel (1:4:1). Fio horizontal separa as faixas — nunca contorno nos quatro lados.">
        Card — tons, e interativo em cada estado
      </Heading>

      <TwoThemes>
        <div className="grid gap-3 sm:grid-cols-3">
          {tones.map((tone) => (
            <Card key={tone} tone={tone}>
              <CardHeader>
                <CardTitle>{tone}</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="text-13 text-muted">Corpo do registro.</p>
              </CardBody>
              <CardFooter action={<Button size="sm">Abrir</Button>}>
                contexto curto
              </CardFooter>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              { label: "repouso", className: "" },
              { label: "hover", className: "force-hover" },
              { label: "foco", className: "force-focus" },
              { label: "duas ações", className: "" },
            ] as const
          ).map((state) => (
            <Card
              key={state.label}
              interactive
              tabIndex={0}
              className={state.className}
            >
              <CardHeader rule={false}>
                <CardTitle>{state.label}</CardTitle>
              </CardHeader>
              <CardBody flush>
                <p className="text-13 text-muted">Card interativo.</p>
              </CardBody>
              {state.label === "duas ações" ? (
                <CardFooter
                  action={<Button size="sm">Confirmar</Button>}
                  secondary={<CardAction>ver detalhe</CardAction>}
                />
              ) : (
                <CardFooter action={<Button size="sm">Abrir</Button>} />
              )}
            </Card>
          ))}
        </div>
      </TwoThemes>
    </section>
  );
}

/* =============================================================================
   EmptyState
   ========================================================================== */

function EmptyStateSection() {
  return (
    <section className="flex flex-col gap-4">
      <Heading note="Estado vazio sempre com conteúdo de exemplo. No máximo uma prancha por tela.">
        EmptyState — padrão, compacto, com prancha
      </Heading>
      <TwoThemes>
        <EmptyState
          title="Ninguém abriu ainda"
          description="Assim que o cliente tocar no link, ele aparece aqui."
          preview={
            <div className="flex items-center gap-3 rounded-md bg-surface p-3 shadow-1">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-soft-ink">
                <OpenedIcon className="size-4" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-15 font-medium text-ink">
                  Marina Albuquerque
                </span>
                <span className="text-13 text-muted">abriu 6 vezes · há 3h</span>
              </span>
            </div>
          }
          action={<Button variant="primary">Enviar uma proposta</Button>}
          secondaryAction={
            <button className="text-13 font-medium text-muted hover:text-ink hover:underline">
              ver exemplo
            </button>
          }
        />
        <EmptyState compact title="Nada por aqui" description="Variante compacta, sem prancha." />
        <EmptyState
          plate
          title="Nenhum cliente ainda"
          description="Cadastre o primeiro contato ou importe de uma planilha."
          action={<Button variant="primary">Adicionar cliente</Button>}
        />
      </TwoThemes>
    </section>
  );
}

/* =============================================================================
   Table
   ========================================================================== */

const TABLE_ROWS = [
  { name: "Marina Albuquerque", city: "Recife", cents: 1_284_000 },
  { name: "Família Tanaka", city: "São Paulo", cents: 4_760_000 },
  { name: "Rodrigo Sá", city: "Curitiba", cents: 989_000 },
];

function TableSection() {
  return (
    <section className="flex flex-col gap-4">
      <Heading note="Densa (linha de 40px), sem zebra e sem moldura — o fio do cabeçalho e o fim das linhas delimitam.">
        Table — normal, hover de linha, carregando, vazia
      </Heading>
      <TwoThemes>
        <TableFrame>
          <Table>
            <THead>
              <TR>
                <TH>Cliente</TH>
                <TH>Cidade</TH>
                <TH numeric>Valor</TH>
              </TR>
            </THead>
            <TBody>
              {TABLE_ROWS.map((row, index) => (
                <TR
                  key={row.name}
                  interactive
                  className={index === 1 ? "force-hover" : undefined}
                >
                  <TD>{row.name}</TD>
                  <TD className="text-muted">{row.city}</TD>
                  <TD numeric>
                    <Money cents={row.cents} align="right" />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableFrame>

        <TableFrame>
          <Table>
            <THead>
              <TR>
                <TH>Cliente</TH>
                <TH>Cidade</TH>
                <TH numeric>Valor</TH>
              </TR>
            </THead>
            <TBody>
              <TableSkeletonRows rows={3} columns={3} />
            </TBody>
          </Table>
        </TableFrame>

        <EmptyState
          compact
          title="Nenhum registro"
          description="A tabela some e o vazio ocupa o lugar dela — não fica linha em branco."
        />
      </TwoThemes>
    </section>
  );
}

/* =============================================================================
   Tabs
   ========================================================================== */

function TabsSection() {
  return (
    <section className="flex flex-col gap-4">
      <Heading note="O sublinhado viaja entre abas (layoutId). Cornija embaixo da fita, não contorno.">
        Tabs — ativa, hover, foco, desabilitada
      </Heading>
      <TwoThemes>
        <Tabs defaultValue="viajantes">
          <TabsList>
            <TabsTrigger value="viajantes">Passageiros</TabsTrigger>
            <TabsTrigger value="hover" className="force-hover">
              hover
            </TabsTrigger>
            <TabsTrigger value="foco" className="force-focus">
              foco
            </TabsTrigger>
            <TabsTrigger value="documentos" count={2}>
              Documentos
            </TabsTrigger>
            <TabsTrigger value="desabilitada" disabled>
              desabilitada
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </TwoThemes>
    </section>
  );
}

/* =============================================================================
   Checkbox
   ========================================================================== */

function CheckboxSection() {
  return (
    <section className="flex flex-col gap-4">
      <Heading>Checkbox — marcado, indeterminado, foco, inválido, desabilitado</Heading>
      <TwoThemes>
        <div className="flex flex-wrap items-center gap-6">
          <LabeledCheckbox label="repouso" />
          <LabeledCheckbox label="marcado" checked />
          <LabeledCheckbox label="indeterminado" checked="indeterminate" />
          <LabeledCheckbox label="hover" className="force-hover" />
          <LabeledCheckbox label="foco" className="force-focus" />
          <LabeledCheckbox label="inválido" aria-invalid />
          <LabeledCheckbox label="desabilitado" disabled />
          <LabeledCheckbox label="marcado + desabilitado" checked disabled />
        </div>
        <div className="flex max-w-sm flex-col divide-y divide-line-subtle">
          <CheckboxRow label="Passaporte conferido" description="Validade acima de 6 meses" />
          <CheckboxRow label="Opção desabilitada" description="Sem CPF cadastrado" disabled />
        </div>
      </TwoThemes>
    </section>
  );
}

function LabeledCheckbox({
  label,
  className,
  ...props
}: React.ComponentProps<typeof Checkbox> & { label: string }) {
  const id = React.useId();
  return (
    <span className="flex items-center gap-2">
      <Checkbox id={id} className={className} {...props} />
      <label htmlFor={id} className="text-13 text-muted select-none">
        {label}
      </label>
    </span>
  );
}

/* =============================================================================
   Field / Input / SavedMark
   ========================================================================== */

function FieldSection() {
  return (
    <section className="flex flex-col gap-4">
      <Heading note='Erro diz o que aconteceu E oferece a correção — o botão vem junto da frase, não numa barra à parte.'>
        Field — rótulo, dica, erro com correção, tamanhos
      </Heading>
      <TwoThemes>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <Label>Nome do cliente</Label>
            <Input placeholder="Marina Albuquerque" />
            <FieldHint>Como aparece na proposta</FieldHint>
          </Field>

          <Field>
            <Label>Hover</Label>
            <Input placeholder="passe o mouse" className="force-hover" />
          </Field>

          <Field>
            <Label>Foco</Label>
            <Input placeholder="campo focado" className="force-focus" />
          </Field>

          <Field disabled>
            <Label>Desabilitado</Label>
            <Input placeholder="sem edição" disabled />
          </Field>

          <Field>
            <Label>Somente leitura</Label>
            <Input value="cliente@exemplo.com" readOnly />
          </Field>

          <Field invalid>
            <Label>CPF</Label>
            <Input defaultValue="123.456.789-00" aria-invalid />
            <FieldError
              action={
                <button className="font-medium text-danger underline underline-offset-2">
                  Corrigir e salvar de novo
                </button>
              }
            >
              Esse CPF não é válido.
            </FieldError>
          </Field>

          <Field>
            <Label optional>Telefone</Label>
            <Input prefix="+55" placeholder="(81) 99999-0000" />
          </Field>

          <Field>
            <Label>Valor de entrada</Label>
            <Input prefix="R$" numeric placeholder="0,00" />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input size="sm" placeholder="sm" className="w-24" />
          <Input size="md" placeholder="md" className="w-24" />
          <Input size="lg" placeholder="lg" className="w-24" />
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <span className="flex items-center gap-2 text-13 text-muted">
            idle <SavedMark state="idle" />
          </span>
          <span className="flex items-center gap-2 text-13 text-muted">
            salvando <SavedMark state="saving" />
          </span>
          <span className="flex items-center gap-2 text-13 text-muted">
            salvo <SavedMark state="saved" />
          </span>
          <span className="flex items-center gap-2 text-13 text-muted">
            erro <SavedMark state="error" />
          </span>
        </div>
      </TwoThemes>
    </section>
  );
}

/* =============================================================================
   Select
   ========================================================================== */

function SelectSection() {
  return (
    <section className="flex flex-col gap-4">
      <Heading note="Gatilho não-portalado (ilha funciona); painel é Portal.">
        Select
      </Heading>
      <TwoThemes>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Select>
            <SelectTrigger size="sm">
              <SelectValue placeholder="placeholder" />
            </SelectTrigger>
          </Select>
          <Select defaultValue="enviada">
            <SelectTrigger size="sm">
              <SelectValue placeholder="selecionado" />
            </SelectTrigger>
          </Select>
          <Select>
            <SelectTrigger size="sm" className="force-hover">
              <SelectValue placeholder="hover" />
            </SelectTrigger>
          </Select>
          <Select>
            <SelectTrigger size="sm" className="force-focus">
              <SelectValue placeholder="foco" />
            </SelectTrigger>
          </Select>
          <Select disabled>
            <SelectTrigger size="sm">
              <SelectValue placeholder="desabilitado" />
            </SelectTrigger>
          </Select>
          <Select>
            <SelectTrigger size="sm" aria-invalid>
              <SelectValue placeholder="inválido" />
            </SelectTrigger>
          </Select>
        </div>
      </TwoThemes>

      <PortalNote />
      <Select defaultValue="enviada" defaultOpen>
        <SelectTrigger className="max-w-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="novo">Novo contato</SelectItem>
          <SelectItem value="enviada">Enviada</SelectItem>
          <SelectItem value="fechada" disabled>
            Fechada (indisponível)
          </SelectItem>
        </SelectContent>
      </Select>
    </section>
  );
}

/* =============================================================================
   Combobox
   ========================================================================== */

const COMBOBOX_OPTIONS = [
  { value: "novo", label: "Novo contato" },
  { value: "montando", label: "Montando" },
  { value: "enviada", label: "Enviada", hint: "2 aberturas" },
];

function ComboboxSection() {
  return (
    <section className="flex flex-col gap-4">
      <Heading>Combobox — busca, carregando, vazio, aberto</Heading>
      <PortalNote />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field>
          <Label>Repouso</Label>
          <Combobox options={COMBOBOX_OPTIONS} placeholder="Selecione" />
        </Field>
        <Field>
          <Label>Carregando</Label>
          <Combobox options={[]} loading placeholder="Selecione" />
        </Field>
        <Field>
          <Label>Vazio</Label>
          <Combobox options={[]} placeholder="Selecione" emptyMessage="Nenhum negócio" />
        </Field>
        <Field disabled>
          <Label>Desabilitado</Label>
          <Combobox options={COMBOBOX_OPTIONS} disabled placeholder="Selecione" />
        </Field>
      </div>
      <Field className="max-w-xs">
        <Label>Aberto</Label>
        <Combobox
          options={COMBOBOX_OPTIONS}
          value="enviada"
          placeholder="Selecione"
          defaultOpen
        />
      </Field>
    </section>
  );
}

/* =============================================================================
   Money
   ========================================================================== */

function MoneySection() {
  const [tick, setTick] = React.useState(0);
  const values = [128_400, 4_760_000, 4_761_500];

  return (
    <section className="flex flex-col gap-4">
      <Heading note="tabular-nums + largura reservada: o valor nunca troca de largura entre skeleton e dado, nem entre um valor e outro.">
        Money — tons, alinhamento, carregando, número que rola
      </Heading>
      <TwoThemes>
        <div className="flex flex-wrap items-end gap-6">
          {(["default", "muted", "accent", "ok", "warn", "danger"] as const).map(
            (tone) => (
              <MoneyStat key={tone} label={tone} cents={128_400} tone={tone} />
            ),
          )}
        </div>
        <div className="flex flex-wrap items-end gap-6">
          <MoneyStat label="carregando" cents={null} />
          <MoneyStat label="align left (card)" cents={128_400} align="left" />
          <MoneyStat label="align right (tabela)" cents={128_400} align="right" />
          <MoneyStat label="com sinal" cents={-12_000} signed />
        </div>
      </TwoThemes>

      <div className="flex flex-wrap items-center gap-4">
        <Button size="sm" onClick={() => setTick((t) => t + 1)}>
          Simular atualização de valor
        </Button>
        <span className="flex items-center gap-2 text-13 text-muted">
          normal
          <Money size="20" cents={values[tick % values.length]} reserveFor={5_000_000} />
        </span>
        <ReducedMotionOverride value>
          <span className="flex items-center gap-2 text-13 text-muted">
            reduced-motion
            <Money size="20" cents={values[tick % values.length]} reserveFor={5_000_000} />
          </span>
        </ReducedMotionOverride>
      </div>
    </section>
  );
}

/* =============================================================================
   Skeleton
   ========================================================================== */

function SkeletonSection() {
  return (
    <section className="flex flex-col gap-4">
      <Heading note="Nunca spinner: o esqueleto diz o que vem e quanto ocupa, então o layout não pula quando o dado chega.">
        Skeleton
      </Heading>
      <TwoThemes>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-9 w-40 rounded-md" />
          <SkeletonText lines={3} className="max-w-sm" />
          <SkeletonRow className="max-w-sm" />
          <Skeleton still className="h-16 w-full max-w-sm rounded-lg" />
        </div>
      </TwoThemes>
    </section>
  );
}

/* =============================================================================
   Dialog
   ========================================================================== */

function DialogSection() {
  return (
    <section className="flex flex-col gap-4">
      <Heading note="Modal é para decisão que precisa de informação nova — não para confirmar exclusão (isso é toast com desfazer).">
        Dialog
      </Heading>
      <PortalNote />
      <div className="flex flex-wrap gap-3">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary">Abrir diálogo</Button>
          </DialogTrigger>
          <DialogContent
            title="Arquivar cliente"
            description="Marina Albuquerque sai da lista principal, mas os dados continuam."
            footer={
              <>
                <CardAction>cancelar</CardAction>
                <Button variant="primary">Arquivar</Button>
              </>
            }
          >
            <p className="text-15 text-ink">
              Sem conteúdo adicional — o footer já carrega a decisão.
            </p>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog defaultOpen>
        <DialogTrigger asChild>
          <Button variant="secondary">reabrir demonstração</Button>
        </DialogTrigger>
        <DialogContent
          width="md"
          title="Novo passageiro"
          description="Vinculado a Marina Albuquerque"
          footer={
            <>
              <CardAction>cancelar</CardAction>
              <Button variant="primary">Salvar</Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Field>
              <Label>Nome completo</Label>
              <Input placeholder="Nome como no documento" />
            </Field>
            <Field invalid>
              <Label>CPF</Label>
              <Input defaultValue="000.000.000-00" aria-invalid />
              <FieldError>Esse CPF não é válido.</FieldError>
            </Field>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/* =============================================================================
   Sheet
   ========================================================================== */

function SheetSection() {
  const [bottom, setBottom] = React.useState(true);
  const [right, setRight] = React.useState(false);

  return (
    <section className="flex flex-col gap-4">
      <Heading note="Arrasto 1:1 para fechar, resistência no sentido contrário. Fecha por distância OU velocidade, o que vier primeiro.">
        Sheet — painel de baixo (celular) e da direita (desktop)
      </Heading>
      <PortalNote />
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => setBottom(true)}>
          Abrir de baixo
        </Button>
        <Button variant="secondary" onClick={() => setRight(true)}>
          Abrir da direita
        </Button>
      </div>

      <Sheet open={bottom} onOpenChange={setBottom}>
        <SheetContent
          open={bottom}
          onOpenChange={setBottom}
          side="bottom"
          title="Marcar follow-up"
          description="Marina Albuquerque"
          footer={<Button variant="primary" block>Salvar</Button>}
        >
          <p className="py-2 text-15 text-ink">
            Arraste a alça para baixo, ou solte rápido, para fechar.
          </p>
        </SheetContent>
      </Sheet>

      <Sheet open={right} onOpenChange={setRight}>
        <SheetContent
          open={right}
          onOpenChange={setRight}
          side="right"
          title="Ficha do passageiro"
          footer={<Button variant="primary" block>Salvar</Button>}
        >
          <p className="py-2 text-15 text-ink">Painel lateral, mesma mecânica.</p>
        </SheetContent>
      </Sheet>
    </section>
  );
}

/* =============================================================================
   Toast
   ========================================================================== */

function ToastSection() {
  const toast = useToast();
  return (
    <section className="flex flex-col gap-4">
      <Heading note="Destrutivo nunca é modal de confirmação: acontece, e o toast oferece desfazer por 8s. O relógio pausa no hover/foco.">
        Toast
      </Heading>
      <PortalNote />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => toast.show({ title: "Proposta enviada", tone: "neutral" })}
        >
          neutro
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            toast.show({ title: "Pagamento confirmado", tone: "ok", description: "R$ 5.000,00" })
          }
        >
          ok
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            toast.show({ title: "Tarifa vence em 2h", tone: "warn" })
          }
        >
          aviso
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            toast.undo("Contato arquivado", () => {}, { description: "Marina Albuquerque", tone: "danger" })
          }
        >
          destrutivo + desfazer
        </Button>
      </div>
    </section>
  );
}

/* =============================================================================
   Tooltip
   ========================================================================== */

function TooltipSection() {
  return (
    <section className="flex flex-col gap-4">
      <Heading note="Complemento, nunca única fonte da informação — no celular não existe hover.">
        Tooltip
      </Heading>
      <PortalNote />
      <div className="flex items-center gap-6">
        <Tooltip content="Enviar por WhatsApp">
          <Button variant="ghost" size="sm">
            passe o mouse
          </Button>
        </Tooltip>
      </div>
    </section>
  );
}

/* =============================================================================
   Plates
   ========================================================================== */

function PlatesSection() {
  return (
    <section className="flex flex-col gap-4">
      <Heading note="Traço único, currentColor, nunca no accent. No máximo uma por tela — aqui as três aparecem juntas só porque é o catálogo.">
        Pranchas e fio
      </Heading>
      <TwoThemes>
        <div className="flex flex-wrap items-center gap-8 text-ink">
          <FernPlate size={96} title="Fronde de samambaia" />
          <ArchPlate size={96} title="Arco de volta plena" />
          <CompassPlate size={96} title="Rosa dos ventos" />
          <BiplanePlate size={96} title="Biplano de células, motivo 14-bis" />
          <FernPlate size={96} className="plate-wash" />
        </div>
        <div className="flex flex-col gap-4">
          <Rule />
          <Rule inner />
          <span className="text-13 text-subtle">com folga (título + fio, `loose`):</span>
          <Rule loose />
          <span className="text-13 text-subtle">animada (desenha da esquerda):</span>
          <Rule animate />
        </div>
      </TwoThemes>
    </section>
  );
}

/* =============================================================================
   Reduced motion
   ========================================================================== */

function ReducedMotionSection() {
  const [seed, setSeed] = React.useState(0);
  return (
    <section className="flex flex-col gap-4">
      <Heading note="CSS (.enter, .plate-rule--draw) some via prefers-reduced-motion real ou via .force-reduced-motion. Componentes com spring (Money, Tabs, Sheet, Toast) leem usePrefersReducedMotion, que aceita o mesmo override em React.">
        prefers-reduced-motion — normal vs. ligado
      </Heading>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-lg bg-surface p-4 shadow-1">
          <span className="text-13 font-semibold tracking-[0.04em] text-muted uppercase">
            normal
          </span>
          <ReducedMotionOverride value={false}>
            <Rule animate key={`normal-${seed}`} />
            <p className="enter text-15 text-ink" key={`enter-normal-${seed}`}>
              Entrada de rota — opacidade + 4px.
            </p>
          </ReducedMotionOverride>
        </div>

        <div
          className={cn(
            "force-reduced-motion flex flex-col gap-3 rounded-lg bg-surface p-4 shadow-1",
          )}
        >
          <span className="text-13 font-semibold tracking-[0.04em] text-muted uppercase">
            reduced-motion ligado
          </span>
          <ReducedMotionOverride value={true}>
            <Rule animate key={`reduced-${seed}`} />
            <p className="enter text-15 text-ink" key={`enter-reduced-${seed}`}>
              Entrada de rota — sem percurso, o estado final acontece igual.
            </p>
          </ReducedMotionOverride>
        </div>
      </div>

      <Button size="sm" variant="secondary" className="self-start" onClick={() => setSeed((s) => s + 1)}>
        Repetir as duas entradas
      </Button>
    </section>
  );
}
