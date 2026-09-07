"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient, useSession } from "@/lib/auth/client";
import { CompassPlate, Rule } from "@/components/plates";
import { EyeIcon, EyeOffIcon } from "@/components/app/icons";
import { criarConta } from "@/server";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field, FieldError, FieldHint, Label } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { LoadingRegion, Skeleton } from "@/components/ui/Skeleton";
import { APP_NAME } from "@/lib/ui/brand";

/* =============================================================================
   /cadastrar
   -----------------------------------------------------------------------------
   A outra metade da entrada. Mesmo registro do /entrar (CLAUDE.md,
   "intermediário"): a rosa dos ventos sozinha, marca em caixa alta pequena,
   título de página em display, coluna ancorada como página que se abre — não
   card flutuante centralizado, que é o visual de SaaS genérico que este
   sistema existe para não parecer.

   O contrato do servidor (docs/handoffs/rafa-para-nina.md, S13a):
     1. `criarConta({ nomeAgente, email, senha, nomeAgencia })` cria tenant +
        assinatura (trial de 14 dias) + usuário — e NÃO loga.
     2. O login vem na sequência, aqui, por `authClient.signIn.email` — o
        mesmo caminho do /entrar, com a senha que a agente acabou de digitar.
        Nada de redigir de novo.
     3. A agente NUNCA escolhe o endereço da conta (slug): o servidor deriva
        do nome da agência e resolve colisão com sufixo sozinho. É por isso
        que este formulário não tem campo de "endereço" — uma decisão a menos
        na tela que a agente usa uma vez na vida.

   Erro diz o que aconteceu E oferece a correção: e-mail já cadastrado (na
   criação OU no login) vira erro de campo com o link "Entrar" junto — a
   correção é navegar, não re-tentar.
   ========================================================================== */

const CAMPOS = ["nomeAgente", "email", "senha", "nomeAgencia"] as const;
type Campo = (typeof CAMPOS)[number];

type CorrecaoDeCampo = { label: string; href: string };
type ErroDeCampo = { message: string; correction?: CorrecaoDeCampo };
type ErrosPorCampo = Partial<Record<Campo, ErroDeCampo>>;

const E_MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * O mesmo texto de link discreto do rodapé do /entrar (`CardAction`), em
 * <Link>: navegação entre as duas portas de entrada. Sem
 * `transition-colors` — a troca de cor num texto de 13px não precisa de
 * rampa, e cor não entra na régua de movimento do sistema.
 */
const acaoLink =
  "shrink-0 rounded-xs text-13 font-medium text-muted hover:text-ink hover:underline hover:underline-offset-4 [@media(pointer:coarse)]:min-h-11";

/**
 * Voz do rodapé legal: um degrau abaixo dos links de navegação entre as
 * portas — presente e legível, mas sem disputar o olho com "Entrar"/"Criar
 * conta". Sem `transition-colors` (mesma razão do `acaoLink`).
 */
const acaoLegal =
  "rounded-xs py-2 text-13 text-subtle hover:text-ink hover:underline hover:underline-offset-4";

export function CadastroScreen() {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  React.useEffect(() => {
    if (session) router.replace("/hoje");
  }, [session, router]);

  const [nomeAgente, setNomeAgente] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [senha, setSenha] = React.useState("");
  const [nomeAgencia, setNomeAgencia] = React.useState("");
  const [aceitouTermos, setAceitouTermos] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);
  const [erros, setErros] = React.useState<ErrosPorCampo>({});
  const [erroGeral, setErroGeral] = React.useState<ErroDeCampo | null>(null);
  /** Mensagem do erro de consentimento — a local (mesmos termos do servidor)
   * ou a que o servidor devolver com `campo: 'aceitouTermos'`. */
  const [erroTermos, setErroTermos] = React.useState<string | null>(null);

  const nomeAgenteRef = React.useRef<HTMLInputElement>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);
  const senhaRef = React.useRef<HTMLInputElement>(null);
  const nomeAgenciaRef = React.useRef<HTMLInputElement>(null);
  const termosRef = React.useRef<HTMLButtonElement>(null);

  const refs: Record<Campo, React.RefObject<HTMLInputElement | null>> = {
    nomeAgente: nomeAgenteRef,
    email: emailRef,
    senha: senhaRef,
    nomeAgencia: nomeAgenciaRef,
  };

  // sessão já existe (ou ainda estamos checando) — nada de piscar o
  // formulário antes de sair da tela. Skeleton, nunca spinner.
  if (isPending || session) {
    return <CadastroSkeleton />;
  }

  function limparErro(campo: Campo) {
    setErros((current) =>
      current[campo] ? { ...current, [campo]: undefined } : current,
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Validação local: as mesmas regras do servidor (zod em `signup.ts`),
    // ditas nos mesmos termos — a tela recusa antes de gastar uma chamada,
    // mas o servidor continua sendo quem decide.
    const locais: ErrosPorCampo = {};
    if (nomeAgente.trim().length < 2) {
      locais.nomeAgente = { message: "Informe seu nome." };
    }
    if (!E_MAIL.test(email.trim())) {
      locais.email = { message: "Informe um e-mail válido." };
    }
    if (senha.length < 8) {
      locais.senha = { message: "A senha precisa de pelo menos 8 caracteres." };
    }
    if (nomeAgencia.trim().length < 2) {
      locais.nomeAgencia = { message: "Informe o nome da agência." };
    }
    if (CAMPOS.some((campo) => locais[campo])) {
      setErros(locais);
      setErroGeral(null);
      const primeiro = CAMPOS.find((campo) => locais[campo]);
      if (primeiro) refs[primeiro].current?.focus();
      return;
    }

    // Consentimento é obrigatório ANTES de criar a conta — não é um campo a
    // mais, é a condição legal do cadastro (o servidor também recusa: o campo
    // nasce obrigatório no zod e `false` é recusa explícita, S13b). A correção
    // está na mesma linha do erro: marcar a caixa (o foco vai para ela).
    if (!aceitouTermos) {
      setErroTermos(
        "Para criar a conta, é preciso ler e aceitar os Termos de uso e a Política de privacidade.",
      );
      setErroGeral(null);
      termosRef.current?.focus();
      return;
    }

    setErros({});
    setErroGeral(null);
    setEnviando(true);

    const result = await criarConta({
      nomeAgente: nomeAgente.trim(),
      email: email.trim(),
      senha,
      nomeAgencia: nomeAgencia.trim(),
      // Obrigatório no contrato (S13b): o backend NÃO assume true — e grava
      // `terms_accepted_at` + `terms_version` + audit `consent.recorded`.
      aceitouTermos: true,
    });

    if (!result.ok) {
      setEnviando(false);
      const campo = result.campo;

      // Recusa de consentimento vinda do servidor (corrida improvável — o
      // gate local acima já pegou — mas o ramo existe): a mensagem dele,
      // junto do checkbox, com o foco nele.
      if (campo === "aceitouTermos") {
        setErroTermos(result.mensagem);
        setErroGeral(null);
        termosRef.current?.focus();
        return;
      }
      const campoValido =
        campo === "nomeAgente" ||
        campo === "email" ||
        campo === "senha" ||
        campo === "nomeAgencia"
          ? campo
          : null;

      if (campoValido) {
        // E-mail já tem conta: a correção é IR, não tentar de novo.
        const correction: CorrecaoDeCampo | undefined =
          campoValido === "email" && result.code === "CONFLITO"
            ? { label: "Entrar", href: "/entrar" }
            : undefined;
        setErros({
          [campoValido]: { message: result.mensagem, correction },
        });
        refs[campoValido].current?.focus();
        return;
      }

      setErroGeral({ message: result.mensagem });
      return;
    }

    // Conta criada. O servidor não loga de propósito (decisão do handoff —
    // cookie de sessão dentro de Server Action seria parse manual de
    // Set-Cookie); o login é o caminho de sempre, já testado no /entrar.
    const { error: authError } = await authClient.signIn.email({
      email: email.trim(),
      password: senha,
      callbackURL: "/hoje",
    });

    if (authError) {
      setEnviando(false);
      // A conta EXISTE agora — "senha incorreta" do Better Auth seria
      // mentira. O que aconteceu é o acesso automático falhar, e a correção
      // é a porta de entrada de sempre.
      setErroGeral({
        message:
          "Sua conta foi criada, mas o acesso automático falhou. Use o mesmo e-mail e a senha que acabou de criar.",
        correction: { label: "Entrar", href: "/entrar" },
      });
      return;
    }

    // `callbackURL` é contrato do servidor; para e-mail+senha quem move a
    // agente de tela é o router — mesmo caminho do /entrar.
    router.push("/hoje");
  }

  return (
    <div className="relative isolate min-h-dvh overflow-hidden bg-bg">
      {/* Única prancha da tela — a rosa dos ventos é a que pode ficar sozinha
          (regra em src/components/plates/index.tsx). Mesma posição, tamanho e
          opacidade do /entrar: as duas portas são o mesmo lugar. */}
      <CompassPlate
        size={360}
        className="plate-wash pointer-events-none absolute -top-28 -right-32 hidden select-none sm:block"
      />

      <div className="enter relative mx-auto flex min-h-dvh w-full max-w-[26rem] flex-col px-6 pt-14 pb-10 sm:px-8 sm:pt-20">
        <p className="text-13 font-medium tracking-[0.08em] text-muted uppercase">
          {APP_NAME}
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <h1 className="display text-32 text-ink">Criar conta</h1>
          <p className="max-w-[32ch] text-15 text-muted">
            Crie sua agência e mande a primeira proposta hoje — 14 dias
            grátis.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="mt-10 flex flex-col gap-5"
        >
          <Field invalid={!!erros.nomeAgente}>
            <Label htmlFor="cadastrar-nome">Seu nome</Label>
            <Input
              ref={nomeAgenteRef}
              id="cadastrar-nome"
              type="text"
              name="name"
              autoComplete="name"
              placeholder="Marina Duarte"
              value={nomeAgente}
              onChange={(event) => {
                setNomeAgente(event.target.value);
                limparErro("nomeAgente");
              }}
              required
            />
            {erros.nomeAgente ? (
              <FieldError>{erros.nomeAgente.message}</FieldError>
            ) : null}
          </Field>

          <Field invalid={!!erros.email}>
            <Label htmlFor="cadastrar-email">E-mail</Label>
            <Input
              ref={emailRef}
              id="cadastrar-email"
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              placeholder="voce@agencia.com"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                limparErro("email");
              }}
              required
            />
            {erros.email ? (
              <FieldError
                action={
                  erros.email.correction ? (
                    <Link
                      href={erros.email.correction.href}
                      className="font-medium text-danger underline underline-offset-2"
                    >
                      {erros.email.correction.label}
                    </Link>
                  ) : undefined
                }
              >
                {erros.email.message}
              </FieldError>
            ) : null}
          </Field>

          <Field invalid={!!erros.senha}>
            <Label htmlFor="cadastrar-senha">Senha</Label>
            <Input
              ref={senhaRef}
              id="cadastrar-senha"
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete="new-password"
              value={senha}
              onChange={(event) => {
                setSenha(event.target.value);
                limparErro("senha");
              }}
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
            <FieldHint>Mínimo de 8 caracteres.</FieldHint>
            {erros.senha ? (
              <FieldError>{erros.senha.message}</FieldError>
            ) : null}
          </Field>

          <Field invalid={!!erros.nomeAgencia}>
            <Label htmlFor="cadastrar-agencia">Nome da agência</Label>
            <Input
              ref={nomeAgenciaRef}
              id="cadastrar-agencia"
              type="text"
              name="organization"
              autoComplete="organization"
              placeholder="Agência Maré Norte"
              value={nomeAgencia}
              onChange={(event) => {
                setNomeAgencia(event.target.value);
                limparErro("nomeAgencia");
              }}
              required
            />
            <FieldHint>
              É deste nome que nasce o endereço da sua conta — você não
              precisa escolher.
            </FieldHint>
            {erros.nomeAgencia ? (
              <FieldError>{erros.nomeAgencia.message}</FieldError>
            ) : null}
          </Field>

          {/* Consentimento (S13b) — a linha inteira é clicável (geometria do
              CheckboxRow), mas os links ficam FORA da ativação do label
              (stopPropagation): navegar para os termos não pode marcar a
              caixa por acidente. O servidor recusa ausente E `false` com
              `campo: 'aceitouTermos'`; o gate local é a primeira linha, e o
              retorno do `criarConta` grava `terms_accepted_at` + versão. */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-start gap-3 py-1.5">
              <Checkbox
                id="cadastrar-termos"
                ref={termosRef}
                checked={aceitouTermos}
                onCheckedChange={(checked) => {
                  setAceitouTermos(checked === true);
                  if (checked) setErroTermos(null);
                }}
                aria-invalid={erroTermos ? true : undefined}
                className="mt-0.5"
              />
              <label
                htmlFor="cadastrar-termos"
                className="min-w-0 cursor-pointer select-none text-13 text-muted"
              >
                Li e aceito os{" "}
                <Link
                  href="/termos"
                  onClick={(event) => event.stopPropagation()}
                  className="font-medium text-ink underline underline-offset-4 hover:text-muted"
                >
                  Termos de uso
                </Link>{" "}
                e a{" "}
                <Link
                  href="/privacidade"
                  onClick={(event) => event.stopPropagation()}
                  className="font-medium text-ink underline underline-offset-4 hover:text-muted"
                >
                  Política de privacidade
                </Link>
                .
              </label>
            </div>
            {erroTermos ? <FieldError>{erroTermos}</FieldError> : null}
          </div>

          {/* Erro que não aponta para um campo: não invento campo, mostro no
              caminho do olhar — entre o formulário e a ação que falhou. */}
          {erroGeral ? (
            <FieldError
              action={
                erroGeral.correction ? (
                  <Link
                    href={erroGeral.correction.href}
                    className="font-medium text-danger underline underline-offset-2"
                  >
                    {erroGeral.correction.label}
                  </Link>
                ) : undefined
              }
            >
              {erroGeral.message}
            </FieldError>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            loading={enviando}
          >
            Criar conta
          </Button>
        </form>

        <Rule className="mt-9" />
        <div className="flex items-center justify-between gap-4 pt-4">
          <p className="text-13 text-muted">Já tem conta?</p>
          <Link href="/entrar" className={acaoLink}>
            Entrar
          </Link>
        </div>

        {/* Rodapé legal — o mesmo par de links nas duas portas (/entrar e
            /cadastrar); as páginas são do rafa (/termos, /privacidade). */}
        <div className="flex items-center gap-x-5 pt-3">
          <Link href="/termos" className={acaoLegal}>
            Termos de uso
          </Link>
          <Link href="/privacidade" className={acaoLegal}>
            Privacidade
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Mesma geometria da tela real, em skeleton — evita o pulo de layout entre
 * "checando sessão" e "formulário" (o /entrar já paga esse cuidado; as duas
 * telas de entrada têm que piscar igual, ou seja, não piscar).
 */
function CadastroSkeleton() {
  return (
    <LoadingRegion label="Verificando sessão">
      <div className="relative isolate min-h-dvh overflow-hidden bg-bg">
        <div className="relative mx-auto flex min-h-dvh w-full max-w-[26rem] flex-col px-6 pt-14 pb-10 sm:px-8 sm:pt-20">
          <Skeleton className="h-[0.8125rem] w-16" />
          <div className="mt-6 flex flex-col gap-3">
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-[0.9375rem] w-56" />
          </div>
          <div className="mt-10 flex flex-col gap-5">
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-16 w-full rounded-md" />
            <Skeleton className="h-6 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
          </div>
        </div>
      </div>
    </LoadingRegion>
  );
}
