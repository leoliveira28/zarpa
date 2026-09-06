/**
 * Tradução de erro de autenticação — só para a tela de entrada.
 *
 * O Better Auth devolve `{ message, code }`. `code` é a fonte confiável
 * (`INVALID_EMAIL_OR_PASSWORD`, confirmado testando `signIn.email` direto
 * contra o handler) — comparar por ele não quebra se o texto em inglês da
 * mensagem mudar de versão. `message.toLowerCase()` fica só como rede de
 * segurança para o dia em que aparecer um `code` que ainda não mapeei aqui.
 *
 * A regra do CLAUDE.md é "erro diz o que aconteceu E oferece a correção, com
 * o botão junto" — por isso cada entrada carrega os dois pedaços, não só a
 * tradução da frase.
 *
 * Pedido em aberto (`docs/handoffs/nina-para-rafa.md`): confirmar o `code`
 * exato dos casos que hoje só tenho por `message` (usuário inexistente no
 * magic link, e-mail não confirmado, limite de tentativas).
 */

export type AuthCorrection = {
  label: string;
  onClick: () => void;
};

export type AuthErrorInfo = {
  /** Campo a destacar com `Field invalid` — quando o erro aponta para um só. */
  field?: "email" | "password";
  message: string;
  correction?: AuthCorrection;
};

export type AuthErrorFocus = {
  onFocusEmail?: () => void;
  onFocusPassword?: () => void;
};

type RawAuthError = { message?: string; code?: string } | null | undefined;

/** Devolve a mensagem em pt-BR + a correção correspondente, com foco no campo certo. */
export function mapAuthError(
  error: RawAuthError,
  focus: AuthErrorFocus = {},
): AuthErrorInfo {
  const code = (error?.code ?? "").toUpperCase();
  const raw = (error?.message ?? "").toLowerCase();

  if (
    code === "INVALID_EMAIL_OR_PASSWORD" ||
    raw.includes("invalid email or password") ||
    raw.includes("invalid password")
  ) {
    return {
      field: "password",
      message: "E-mail ou senha incorretos.",
      correction: focus.onFocusPassword
        ? { label: "Corrigir a senha", onClick: focus.onFocusPassword }
        : undefined,
    };
  }

  if (raw.includes("user not found") || raw.includes("no user")) {
    return {
      field: "email",
      message: "Não encontramos uma conta com esse e-mail.",
      correction: focus.onFocusEmail
        ? { label: "Conferir o e-mail", onClick: focus.onFocusEmail }
        : undefined,
    };
  }

  if (raw.includes("email not verified") || raw.includes("verify")) {
    return {
      field: "email",
      message: "Este e-mail ainda não foi confirmado.",
    };
  }

  if (raw.includes("too many") || raw.includes("rate limit")) {
    return {
      message: "Foram muitas tentativas seguidas. Espere um instante e tente de novo.",
    };
  }

  if (!error) {
    return {
      message: "Não conseguimos falar com o servidor agora.",
      correction: focus.onFocusEmail
        ? { label: "Tentar de novo", onClick: focus.onFocusEmail }
        : undefined,
    };
  }

  return {
    message: "Não foi possível entrar com esses dados.",
    correction: focus.onFocusEmail
      ? { label: "Revisar o e-mail e a senha", onClick: focus.onFocusEmail }
      : undefined,
  };
}
