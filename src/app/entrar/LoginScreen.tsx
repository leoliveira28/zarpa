"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { authClient, useSession } from "@/lib/auth/client";
import { CompassPlate, Rule } from "@/components/plates";
import { EyeIcon, EyeOffIcon } from "@/components/app/icons";
import { Button } from "@/components/ui/Button";
import { CardAction } from "@/components/ui/Card";
import { Field, FieldError, FieldHint, Label } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LoadingRegion, Skeleton } from "@/components/ui/Skeleton";
import { APP_NAME, APP_TAGLINE } from "@/lib/ui/brand";
import { mapAuthError, type AuthErrorInfo } from "@/lib/ui/authErrors";

/* =============================================================================
   /entrar
   -----------------------------------------------------------------------------
   Registro "entrada/intermediário" (CLAUDE.md): uma prancha discreta — a rosa
   dos ventos, a única que pode aparecer sozinha —, marca em caixa alta pequena,
   título de página em display, margem de livro. Nada de card flutuante
   centralizado na tela: a coluna fica ancorada como uma página que se abre, não
   como um modal de SaaS genérico.

   Dois caminhos, uma coluna: senha (padrão, quem já tem o hábito) e link
   mágico (a segunda ação, que por isso é texto — CLAUDE.md, rodapé de card).
   Nenhum dos dois cria conta: cadastro depende de `src/server/signup.ts`, que
   ainda não existe (ver docs/handoffs/rafa-para-nina.md).
   ========================================================================== */

type Mode = "password" | "magic";

export function LoginScreen() {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  React.useEffect(() => {
    if (session) router.replace("/hoje");
  }, [session, router]);

  const [mode, setMode] = React.useState<Mode>("password");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [magicSent, setMagicSent] = React.useState(false);
  const [error, setError] = React.useState<AuthErrorInfo | null>(null);

  const emailRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);

  // sessão já existe (ou ainda estamos checando) — nada de piscar o formulário
  // antes de sair da tela. Skeleton, nunca spinner.
  if (isPending || session) {
    return <LoginSkeleton />;
  }

  function toggleMode() {
    setError(null);
    setMagicSent(false);
    setMode((current) => (current === "password" ? "magic" : "password"));
  }

  async function handlePasswordSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const { data, error: authError } = await authClient.signIn.email({
      email: email.trim(),
      password,
      callbackURL: "/hoje",
    });

    if (authError || !data) {
      setSubmitting(false);
      setError(
        mapAuthError(authError, {
          onFocusEmail: () => emailRef.current?.focus(),
          onFocusPassword: () => passwordRef.current?.focus(),
        }),
      );
      return;
    }

    // `callbackURL` é o contrato do lado do servidor (redirecionos de OAuth e
    // de verificação de magic link). Para e-mail+senha a chamada não navega
    // sozinha — quem move a agente de tela é o router do Next.
    router.push("/hoje");
  }

  async function handleMagicLinkSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const { data, error: authError } = await authClient.signIn.magicLink({
      email: email.trim(),
      callbackURL: "/hoje",
    });

    setSubmitting(false);

    if (authError || !data) {
      setError(
        mapAuthError(authError, {
          onFocusEmail: () => emailRef.current?.focus(),
        }),
      );
      return;
    }

    setMagicSent(true);
  }

  return (
    <div className="relative isolate min-h-dvh overflow-hidden bg-bg">
      {/* Única prancha da tela — a rosa dos ventos é a que pode ficar sozinha,
          sem texto ao redor (regra em src/components/plates/index.tsx). Sangra
          pelo canto, a 14%: presença, não decoração. */}
      <CompassPlate
        size={360}
        className="plate-wash pointer-events-none absolute -top-28 -right-32 hidden select-none sm:block"
      />

      <div className="enter relative mx-auto flex min-h-dvh w-full max-w-[26rem] flex-col px-6 pt-14 pb-10 sm:px-8 sm:pt-20">
        <p className="text-13 font-medium tracking-[0.08em] text-muted uppercase">
          {APP_NAME}
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <h1 className="display text-32 text-ink">Entrar</h1>
          <p className="max-w-[32ch] text-15 text-muted">{APP_TAGLINE}</p>
        </div>

        <div className="mt-10">
          {mode === "password" ? (
            <form
              onSubmit={handlePasswordSubmit}
              noValidate
              className="flex flex-col gap-5"
            >
              <Field invalid={error?.field === "email"}>
                <Label htmlFor="entrar-email">E-mail</Label>
                <Input
                  ref={emailRef}
                  id="entrar-email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="voce@agencia.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </Field>

              <Field invalid={error?.field === "password" || (!!error && !error.field)}>
                <Label htmlFor="entrar-senha">Senha</Label>
                <Input
                  ref={passwordRef}
                  id="entrar-senha"
                  type={showPassword ? "text" : "password"}
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  suffix={
                    <button
                      type="button"
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      aria-pressed={showPassword}
                      onPointerDown={() => setShowPassword((current) => !current)}
                      className="grid size-6 place-items-center rounded-xs text-muted hover:text-ink"
                    >
                      {showPassword ? (
                        <EyeOffIcon className="size-4" />
                      ) : (
                        <EyeIcon className="size-4" />
                      )}
                    </button>
                  }
                />
                {error ? (
                  <FieldError
                    action={
                      error.correction ? (
                        <button
                          type="button"
                          onClick={error.correction.onClick}
                          className="font-medium text-danger underline underline-offset-2"
                        >
                          {error.correction.label}
                        </button>
                      ) : undefined
                    }
                  >
                    {error.message}
                  </FieldError>
                ) : null}
              </Field>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                block
                loading={submitting}
              >
                Entrar
              </Button>
            </form>
          ) : magicSent ? (
            <MagicLinkSent
              email={email}
              onUseAnotherEmail={() => {
                setMagicSent(false);
                setError(null);
              }}
            />
          ) : (
            <form
              onSubmit={handleMagicLinkSubmit}
              noValidate
              className="flex flex-col gap-5"
            >
              <Field invalid={!!error}>
                <Label htmlFor="entrar-email-magico">E-mail</Label>
                <Input
                  ref={emailRef}
                  id="entrar-email-magico"
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="voce@agencia.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
                <FieldHint>
                  Mandamos um link de acesso, válido por 10 minutos. Só entra
                  quem já tem conta.
                </FieldHint>
                {error ? (
                  <FieldError
                    action={
                      error.correction ? (
                        <button
                          type="button"
                          onClick={error.correction.onClick}
                          className="font-medium text-danger underline underline-offset-2"
                        >
                          {error.correction.label}
                        </button>
                      ) : undefined
                    }
                  >
                    {error.message}
                  </FieldError>
                ) : null}
              </Field>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                block
                loading={submitting}
              >
                Enviar link de acesso
              </Button>
            </form>
          )}
        </div>

        <Rule className="mt-9" />
        <div className="flex items-center justify-between gap-4 pt-4">
          <p className="text-13 text-muted">
            {mode === "password" ? "Sem lembrar a senha?" : "Já sabe a senha?"}
          </p>
          <CardAction type="button" onClick={toggleMode}>
            {mode === "password" ? "Entrar por link mágico" : "Entrar com senha"}
          </CardAction>
        </div>
      </div>
    </div>
  );
}

function MagicLinkSent({
  email,
  onUseAnotherEmail,
}: {
  email: string;
  onUseAnotherEmail: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface-2 px-4 py-5">
      <p className="text-15 font-medium text-ink">Link a caminho</p>
      <p className="text-13 text-muted">
        Mandamos um link de acesso para{" "}
        <span className="font-medium text-ink">{email}</span>. Abra-o no
        mesmo aparelho — ele vale por 10 minutos.
      </p>
      <CardAction type="button" onClick={onUseAnotherEmail} className="self-start">
        Usar outro e-mail
      </CardAction>
    </div>
  );
}

/**
 * Mesma geometria da tela real, em skeleton — evita o pulo de layout entre
 * "checando sessão" e "formulário" ou "já autenticada, saindo daqui".
 */
function LoginSkeleton() {
  return (
    <LoadingRegion label="Verificando sessão">
      <div className="relative isolate min-h-dvh overflow-hidden bg-bg">
        <div className="relative mx-auto flex min-h-dvh w-full max-w-[26rem] flex-col px-6 pt-14 pb-10 sm:px-8 sm:pt-20">
          <Skeleton className="h-[0.8125rem] w-16" />
          <div className="mt-6 flex flex-col gap-3">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-[0.9375rem] w-48" />
          </div>
          <div className="mt-10 flex flex-col gap-5">
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
          </div>
        </div>
      </div>
    </LoadingRegion>
  );
}
