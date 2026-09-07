import type { Metadata } from "next";
import Link from "next/link";
import { Rule } from "@/components/plates";
import { APP_NAME } from "@/lib/ui/brand";
import { CANAL_DE_PRIVACIDADE, TERMS_VERSION } from "@/lib/legal/termsVersion";

export const metadata: Metadata = { title: "Termos de uso" };

/**
 * Página pública e estática — sem sessão, sem banco, fora do grupo `(app)`,
 * mesmo padrão do /cadastrar e do /entrar. Registro intermediário (miolo, sem
 * prancha): papel, fio como cornija entre registros, zero ilustração. O texto é
 * mínimo e honesto — descreve o que o serviço de fato é e faz, sem cláusula de
 * enfeite. A versão citada aqui é a MESMA constante que o cadastro grava no
 * consentimento (`tenants.terms_version`): uma fonte só.
 */
export default function TermosPage() {
  return (
    <main className="enter mx-auto w-full max-w-[42rem] px-5 pb-16 pt-10 sm:pt-16">
      <header>
        <p className="text-[13px] uppercase tracking-[0.14em] text-subtle">{APP_NAME}</p>
        <h1 className="display mt-3 text-[32px]">Termos de uso</h1>
        <p className="mt-4 text-[15px] text-muted">
          Última atualização: <time dateTime="2026-09-07">7 de setembro de 2026</time> ·
          versão {TERMS_VERSION}. Ao criar uma conta, você aceita estes termos — a data
          e a versão aceitas ficam registradas na sua conta.
        </p>
      </header>

      <Rule loose />

      <div className="space-y-9 text-[15px] leading-[1.65]">
        <section>
          <h2 className="text-[17px] font-semibold">1. O que é o serviço</h2>
          <p className="mt-3">
            O {APP_NAME} é uma plataforma web para agentes de viagem independentes:
            organizar clientes e negócios, montar propostas de viagem com a sua marca,
            enviar o link pelo WhatsApp e acompanhar abertura e aceite — além de
            registrar vendas, parcelas e comissão.
          </p>
          <p className="mt-3">
            É uma ferramenta de trabalho: o {APP_NAME} não é agência de viagens, não
            vende passagem ou pacote e não intermedia pagamento entre você e seus
            clientes. A viagem, o preço e a relação com o cliente final são seus.
          </p>
        </section>

        <section>
          <h2 className="text-[17px] font-semibold">2. Sua conta</h2>
          <p className="mt-3">
            A conta é criada com seu nome, e-mail, senha e o nome da sua agência. A
            senha é guardada apenas como hash criptográfico — ninguém aqui a lê. A
            conta é individual: uma pessoa por conta nos planos atuais.
          </p>
          <p className="mt-3">
            Você responde pelas informações que cadastra, por manter sua senha em
            segredo e pelo uso que faz da conta. Pode encerrá-la quando quiser (seção
            7).
          </p>
        </section>

        <section>
          <h2 className="text-[17px] font-semibold">3. Os dados dos seus clientes são seus</h2>
          <p className="mt-3">
            O conteúdo que você cadastra — clientes, viajantes, negócios, propostas —
            é seu. O {APP_NAME} trata esses dados <strong>em seu nome</strong>, apenas
            para o serviço funcionar, e nunca para os próprios fins.
          </p>
          <p className="mt-3">
            Perante seus clientes, você é quem decide por que base legal trata os dados
            deles — em geral, o próprio serviço que você presta — e quem responde por
            isso. Não cadastre dados de quem não autorizou ou não espera isso de você.
            O detalhe completo dos papéis está na{" "}
            <Link href="/privacidade" className="text-accent underline underline-offset-2">
              Política de privacidade
            </Link>
            .
          </p>
        </section>

        <section>
          <h2 className="text-[17px] font-semibold">4. Assinatura, teste e cobrança</h2>
          <p className="mt-3">
            A conta começa com teste gratuito de 14 dias, sem cartão. Depois, a
            assinatura é mensal (planos Solo, Pro ou Studio), cobrada por Pix, cartão
            ou boleto. Você pode cancelar a qualquer momento; o cancelamento encerra a
            cobrança futura.
          </p>
          <p className="mt-3">
            Em atraso, a conta passa a <strong>somente leitura</strong>: você continua
            vendo tudo que registrou, mas não cria nem edita. Inadimplência nunca
            apaga dado e nunca bloqueia leitura.
          </p>
        </section>

        <section>
          <h2 className="text-[17px] font-semibold">5. Uso aceitável</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              Não use o serviço para atividades ilícitas nem para tratar dados que você
              não tem direito ou base para tratar.
            </li>
            <li>Não tente acessar contas ou dados de outros usuários.</li>
            <li>Não tente sobrecarregar, desestabilizar ou reverter o serviço.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-[17px] font-semibold">6. Disponibilidade e mudanças</h2>
          <p className="mt-3">
            Buscamos manter o serviço disponível e os dados seguros, mas nenhum serviço
            é infalível: mantenha cópia própria do que for insubstituível para o seu
            trabalho.
          </p>
          <p className="mt-3">
            Mudanças relevantes nestes termos serão comunicadas dentro do aplicativo e
            valem para o futuro. Continuar usando depois da mudança significa aceitá-la;
            discordar, encerrar a conta.
          </p>
        </section>

        <section>
          <h2 className="text-[17px] font-semibold">7. Encerramento</h2>
          <p className="mt-3">
            Você pode encerrar a conta a qualquer momento. Ao encerrar, os dados são
            eliminados conforme descrito na{" "}
            <Link href="/privacidade" className="text-accent underline underline-offset-2">
              Política de privacidade
            </Link>
            , salvo o que for preciso conservar por segurança ou obrigação legal.
          </p>
        </section>

        <section>
          <h2 className="text-[17px] font-semibold">8. Contato</h2>
          <p className="mt-3">
            Dúvidas sobre estes termos ou sobre dados pessoais:{" "}
            <a
              href={`mailto:${CANAL_DE_PRIVACIDADE}`}
              className="text-accent underline underline-offset-2"
            >
              {CANAL_DE_PRIVACIDADE}
            </a>
            .
          </p>
        </section>
      </div>

      <Rule loose />

      <footer className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-subtle">
        <p>
          Versão {TERMS_VERSION} · a versão aceita no cadastro fica registrada na sua
          conta.
        </p>
        <nav className="flex gap-4">
          <Link href="/privacidade" className="text-accent underline underline-offset-2">
            Política de privacidade
          </Link>
          <Link href="/cadastrar" className="text-accent underline underline-offset-2">
            Criar conta
          </Link>
        </nav>
      </footer>
    </main>
  );
}
