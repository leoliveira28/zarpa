'use server';

import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { tenants, user } from '@/db/schema';
import { authDb } from '@/lib/auth/db';
import { auth } from '@/lib/auth/auth';
import { withPendingTenant } from '@/lib/auth/signupContext';
import { withTenant } from '@/lib/tenant/withTenant';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { criarTenant } from './tenants';
import { slugificar } from './normalize';

/**
 * S13a — Cadastro público: uma chamada cria a conta inteira da agente.
 *
 *     criarConta({ nomeAgente, email, senha, nomeAgencia })
 *       → tenant ('trialing', trial de 14 dias)
 *       + usuário Better Auth (senha com hash de verdade, via `auth.api.signUpEmail`)
 *       + assinatura trial ('trialing', trialEndsAt = agora + 14d, plano 'solo',
 *         amountCents do catálogo `plans`)
 *       + audit_log 'account.created' (dentro de `criarTenant`)
 *
 * Por que o tenant nasce em `criarTenant` (`tenants.ts`) e não aqui: aquele é o ÚNICO
 * lugar do sistema onde um `tenant_id` novo nasce — a policy de `tenants` compara `id`
 * com `app.tenant_id`, o id é gerado antes do INSERT e o contexto é aberto com ele.
 * Duplicar isso aqui criaria um segundo caminho de nascimento de tenant, e caminho de
 * nascimento de tenant é o tipo de coisa que não pode ter duas versões.
 *
 * **Este é o único ponto do sistema sem sessão onde um tenant é CRIADO, nunca
 * escolhido.** `tenantId` nunca entra por argumento — ele é gerado aqui dentro, por
 * `criarTenant`, a partir de um nome que a própria agente acabou de digitar para ELA
 * mesma. O `tenantId` do usuário nunca vem do corpo da requisição: `user.tenantId` é
 * `input: false` no Better Auth (ver `auth.ts`) e chega por `withPendingTenant`, que
 * só código de servidor consegue preencher (AsyncLocalStorage).
 *
 * **Sem login automático dentro da action** — decisão documentada no handoff: a UI
 * chama `authClient.signIn.email({ email, senha })` logo depois do retorno OK. Motivo:
 * transformar a resposta do Better Auth em cookie da sessão exigiria parse manual de
 * `Set-Cookie` (bandeiras Secure/HttpOnly/SameSite/prefixo `__Secure-`) dentro de uma
 * Server Action — é exatamente o tipo de código onde um erro vira falha de sessão.
 * O caminho de login normal já existe, já está testado (`/entrar`) e custa uma
 * requisição a mais num fluxo que acontece uma vez na vida da conta.
 *
 * **Atomicidade e a exceção honesta**: tenant + assinatura + audit nascem na MESMA
 * transação (`withTenant` dentro de `criarTenant`). O usuário NÃO nasce nessa
 * transação — o Better Auth escreve `user`/`account`/`session` pelo pool dele
 * (`authDb`, conexão com `app.auth_context=on`) e não aceita transação de fora, então
 * as duas metades não podem compartilhar COMMIT. A compensação é manual e explícita:
 * se `signUpEmail` falhar por qualquer motivo, o tenant recém-nascido é APAGADO
 * (CASCADE leva assinatura e audit juntos) e o erro volta como dado — não existe a
 * condição "tenant órfão sem usuário". A janela de inconsistência é o tempo entre os
 * dois comandos e nenhum cliente consegue observá-la: o tenant novo só fica visível
 * para o próprio dono, que ainda não existe.
 *
 * S13b — consentimento dos termos: `aceitouTermos: true` é OBRIGATÓRIO no input e o
 * backend NÃO assume true — campo ausente e campo `false` são recusas explícitas com
 * mensagem e correção prontas (é o checkbox legal da interface, não um detalhe de
 * formulário). O aceite vira registro: `tenants.terms_accepted_at` +
 * `tenants.terms_version` (a constante `TERMS_VERSION`, a que estava valendo nas
 * páginas /termos e /privacidade que a pessoa leu) + linha de `audit_log`
 * (`consent.recorded`), tudo na MESMA transação do nascimento do tenant, dentro de
 * `criarTenant`. Um tenant sem consentimento registrado só nasce fora deste caminho
 * (seed, testes) — nunca do cadastro público.
 */

const criarContaInput = z.object({
  nomeAgente: z.string().trim().min(2, 'Informe seu nome.').max(120),
  email: z.email('E-mail inválido.').max(200),
  senha: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres.').max(200),
  nomeAgencia: z.string().trim().min(2, 'Informe o nome da agência.').max(120),
  /**
   * Obrigatório e booleano de verdade — sem default, sem coerção. `false` passa
   * pelo zod e é recusado logo abaixo com a mensagem certa; ausente falha o zod
   * e cai na mesma mensagem (ver o `if` do `aceitouTermos` em `criarConta`).
   */
  aceitouTermos: z.boolean(),
});

/** Recusa única para os dois casos de consentimento ausente/recusado. */
const RECUSA_DE_TERMS = {
  mensagem:
    'Para criar a conta, é preciso ler e aceitar os Termos de uso e a Política de privacidade.',
  correcao: 'Aceitar os termos para continuar',
} as const;

export type CriarContaInput = z.infer<typeof criarContaInput>;

export type ContaCriada = {
  tenantId: string;
  /** Id do Better Auth — a UI não precisa dele hoje, mas log/troubleshooting sim. */
  userId: string | null;
  /** Endereço da conta derivado do nome da agência, com sufixo se preciso. */
  slug: string;
  nomeAgencia: string;
  email: string;
};

const TENTATIVAS_DE_SLUG = 10;

export async function criarConta(input: CriarContaInput): Promise<ServiceResult<ContaCriada>> {
  return comoResultado(async () => {
    const parsed = criarContaInput.safeParse(input);
    if (!parsed.success) {
      // Campo ausente ou não-booleano no aceite: mensagem de termos, não
      // "Invalid input" cru do zod — é o erro que a interface vai mostrar junto
      // do checkbox.
      const faltouAceite = parsed.error.issues.some((issue) =>
        issue.path.includes('aceitouTermos'),
      );
      if (faltouAceite) {
        throw new ServiceError('DADOS_INVALIDOS', RECUSA_DE_TERMS.mensagem, {
          campo: 'aceitouTermos',
          correcao: RECUSA_DE_TERMS.correcao,
        });
      }
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
        campo: primeiro?.path.join('.'),
        correcao: 'Corrigir e criar a conta',
      });
    }

    // `false` explícito: a pessoa leu e não aceitou. Mesma resposta do caso
    // ausente — o backend não cria conta em nenhuma das duas formas, e a
    // mensagem diz o que fazer (regra do CLAUDE.md: erro diz o que aconteceu E
    // oferece a correção).
    if (!parsed.data.aceitouTermos) {
      throw new ServiceError('DADOS_INVALIDOS', RECUSA_DE_TERMS.mensagem, {
        campo: 'aceitouTermos',
        correcao: RECUSA_DE_TERMS.correcao,
      });
    }

    const nomeAgente = parsed.data.nomeAgente;
    const nomeAgencia = parsed.data.nomeAgencia.trim();
    // E-mail é comparado/gravado em forma canônica; o Better Auth também normaliza,
    // mas o pré-cheque de duplicidade (abaixo) precisa comparar igual com igual.
    const email = parsed.data.email.trim().toLowerCase();
    const senha = parsed.data.senha; // nunca entra em log, erro ou audit

    // Duplicidade de e-mail com mensagem decente (o erro nativo do Better Auth existiria,
    // mas genérico). Continua sujeito a corrida — o catch do signUpEmail cobre o resto.
    const [emailEmUso] = await authDb
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);
    if (emailEmUso) {
      throw new ServiceError('CONFLITO', 'Já existe uma conta com esse e-mail.', {
        campo: 'email',
        correcao: 'Entrar com esse e-mail em /entrar',
      });
    }

    // Slug derivado do nome da agência — a agente não escolhe endereço no cadastro
    // (uma decisão a menos numa tela que já pede nome, e-mail e senha). Colisão é
    // esperada e resolvida por sufixo; `criarTenant` devolve CONFLITO quando o slug
    // está tomado (e o índice único `tenants_slug_key` cobre a corrida).
    const base = slugificar(nomeAgencia);
    if (base.length < 3) {
      throw new ServiceError(
        'DADOS_INVALIDOS',
        'Não consegui criar o endereço da conta a partir do nome da agência — use um nome com pelo menos 3 letras ou números.',
        { campo: 'nomeAgencia', correcao: 'Ajustar o nome da agência' },
      );
    }

    let tenantId: string | null = null;
    let slugUsado = base;
    for (let tentativa = 1; tentativa <= TENTATIVAS_DE_SLUG; tentativa += 1) {
      const candidato = tentativa === 1 ? base : `${base}-${tentativa}`;
      try {
        const criado = await criarTenant({
          name: nomeAgencia,
          slug: candidato,
          plan: 'solo',
          contactEmail: email,
          // S13b: o aceite já foi validado acima (obrigatório, true). O momento
          // do registro é aqui, dentro do nascimento do tenant — e a versão é
          // resolvida lá dentro pela constante, não aqui.
          consentimento: { aceitoEm: new Date() },
        });
        tenantId = criado.tenantId;
        slugUsado = candidato;
        break;
      } catch (error: unknown) {
        const aindaTemSlug = error instanceof ServiceError && error.code === 'CONFLITO';
        if (!aindaTemSlug || tentativa === TENTATIVAS_DE_SLUG) {
          if (aindaTemSlug) {
            throw new ServiceError(
              'CONFLITO',
              'Não encontrei um endereço livre para essa agência — tente um nome um pouco diferente.',
              { campo: 'nomeAgencia', correcao: 'Ajustar o nome da agência' },
            );
          }
          throw error;
        }
      }
    }
    if (!tenantId) {
      // Inalcançável (o laço acima sempre ou preenche ou lança) — guarda de tipagem.
      throw new ServiceError('CONFLITO', 'Não consegui criar sua conta agora.', {
        correcao: 'Tentar de novo',
      });
    }

    // Usuário Better Auth. `withPendingTenant` é o único canal pelo qual o tenantId
    // chega em `user` — ver `signupContext.ts` e o hook em `auth.ts`.
    try {
      const criado = await withPendingTenant(tenantId, () =>
        auth.api.signUpEmail({
          body: {
            name: nomeAgente,
            email,
            password: senha,
          },
        }),
      );
      return {
        tenantId,
        userId: criado?.user?.id ?? null,
        slug: slugUsado,
        nomeAgencia,
        email,
      };
    } catch (error: unknown) {
      // Compensação: o tenant não pode ficar órfão sem usuário. CASCADE apaga
      // assinatura e audit_log junto — o banco volta exatamente ao estado anterior.
      await desfazerTenant(tenantId);

      const mensagem = error instanceof Error ? error.message : '';
      if (/already exists|já existe/i.test(mensagem)) {
        throw new ServiceError('CONFLITO', 'Já existe uma conta com esse e-mail.', {
          campo: 'email',
          correcao: 'Entrar com esse e-mail em /entrar',
        });
      }
      // Motivo desconhecido: o detalhe fica no log do servidor (via comoResultado),
      // nunca com a senha — que não está no objeto de erro em momento nenhum.
      throw new ServiceError('CONFLITO', 'Não consegui criar sua conta agora.', {
        correcao: 'Tentar de novo em instantes',
      });
    }
  });
}

/** Compensação do signup: apaga o tenant que acabou de nascer sem usuário. */
async function desfazerTenant(tenantId: string): Promise<void> {
  try {
    await withTenant(tenantId, async (tx) => {
      await tx.delete(tenants).where(eq(tenants.id, tenantId));
    });
  } catch (error: unknown) {
    // Se nem a compensação passa, o erro original do cadastro é o que importa —
    // mas o tenant órfão fica registrado no log do servidor para limpeza manual.
    console.error('[signup] falha ao desfazer tenant após erro de cadastro:', error);
  }
}
