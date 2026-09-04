"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/ui/cn";

/* =============================================================================
   Field — rótulo, dica, erro e correção.
   -----------------------------------------------------------------------------
   Regra do CLAUDE.md: "erro diz o que aconteceu E oferece a correção, com o
   botão junto". Por isso `error` aceita um nó e `FieldError` tem slot de ação:
   o botão que conserta fica na mesma linha da frase que reclama, não numa
   barra de erro no topo da página.

   O contexto abaixo distribui os ids (label / describedby / errormessage) pra
   ninguém precisar lembrar de amarrar aria à mão.
   ========================================================================== */

type FieldContextValue = {
  id: string;
  hintId: string;
  errorId: string;
  invalid: boolean;
  disabled: boolean;
};

const FieldContext = React.createContext<FieldContextValue | null>(null);

export type FieldControlProps = {
  id?: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
  disabled?: true;
};

/**
 * Props de acessibilidade que todo controle dentro de um <Field> herda.
 * Fora de um Field devolve objeto vazio — o controle segue funcionando solto.
 */
export function useFieldControl(): FieldControlProps {
  const field = React.useContext(FieldContext);
  if (!field) return {};
  return {
    id: field.id,
    "aria-invalid": field.invalid ? true : undefined,
    "aria-describedby":
      [field.invalid ? field.errorId : null, field.hintId]
        .filter(Boolean)
        .join(" ") || undefined,
    disabled: field.disabled ? true : undefined,
  };
}

export interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  invalid?: boolean;
  disabled?: boolean;
}

export function Field({
  className,
  invalid = false,
  disabled = false,
  ...props
}: FieldProps) {
  const generated = React.useId();
  const value = React.useMemo<FieldContextValue>(
    () => ({
      id: `${generated}-control`,
      hintId: `${generated}-hint`,
      errorId: `${generated}-error`,
      invalid,
      disabled,
    }),
    [generated, invalid, disabled],
  );

  return (
    <FieldContext.Provider value={value}>
      <div
        data-invalid={invalid || undefined}
        data-disabled={disabled || undefined}
        className={cn("flex flex-col gap-1.5", className)}
        {...props}
      />
    </FieldContext.Provider>
  );
}

export function Label({
  className,
  children,
  optional,
  ...props
}: React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & {
  optional?: boolean;
}) {
  const field = React.useContext(FieldContext);
  return (
    <LabelPrimitive.Root
      htmlFor={props.htmlFor ?? field?.id}
      className={cn(
        "flex items-baseline gap-2 text-13 font-medium text-ink select-none",
        field?.disabled && "opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      {optional ? (
        <span className="text-13 font-normal text-muted">opcional</span>
      ) : null}
    </LabelPrimitive.Root>
  );
}

/** Dica permanente. Fica abaixo do campo, some quando há erro. */
export function FieldHint({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  const field = React.useContext(FieldContext);
  if (field?.invalid) return null;
  return (
    <p
      id={field?.hintId}
      className={cn("text-13 text-muted", className)}
      {...props}
    />
  );
}

/**
 * Erro com correção junto. `action` é o botão que resolve — "usar o valor
 * anterior", "remover o caractere", "abrir o cadastro". Erro sem saída é
 * só um empurrão.
 */
export function FieldError({
  className,
  children,
  action,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { action?: React.ReactNode }) {
  const field = React.useContext(FieldContext);
  if (!children) return null;
  return (
    <div
      id={field?.errorId}
      role="alert"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-13 text-danger",
        className,
      )}
      {...props}
    >
      <span className="flex items-start gap-1.5">
        <ErrorGlyph />
        <span>{children}</span>
      </span>
      {action}
    </div>
  );
}

function ErrorGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="mt-[0.2em] size-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.75v3.75" />
      <path d="M8 11.1v.15" />
    </svg>
  );
}

/** Marca "Salvo" discreta do salvamento automático. Sem botão Salvar grande. */
export function SavedMark({
  state,
  className,
}: {
  state: "idle" | "saving" | "saved" | "error";
  className?: string;
}) {
  const label =
    state === "saving"
      ? "Salvando"
      : state === "saved"
        ? "Salvo"
        : state === "error"
          ? "Não salvou"
          : "";
  return (
    <span
      aria-live="polite"
      className={cn(
        "text-13 tabular-nums transition-opacity duration-200",
        state === "error" ? "text-danger" : "text-muted",
        state === "idle" ? "opacity-0" : "opacity-100",
        className,
      )}
    >
      {label || " "}
    </span>
  );
}
