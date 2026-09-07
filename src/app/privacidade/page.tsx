import type { Metadata } from "next";
import Link from "next/link";
import { Rule } from "@/components/plates";
import { APP_NAME } from "@/lib/ui/brand";
import { CANAL_DE_PRIVACIDADE, TERMS_VERSION } from "@/lib/legal/termsVersion";

export const metadata: Metadata = { title: "Política de privacidade" };

/**
 * Página pública e estática — sem sessão, sem banco, fora do grupo `(app)`,
 * mesmo padrão do /cadastrar e do /entrar. Registro intermediário (miolo, sem
 * prancha): papel, fio como cornija, zero ilustração.
 *
 * A seção 1 (controlador × operador) é o coração do texto e a razão de existir
 * da página: quem cadastra o cliente final é a AGENTE — ela é a controladora
 * daqueles dados, e o {APP_NAME} é operador. O texto é mínimo e honesto: só
 * descreve tratamento que de fato acontece no produto hoje.
 */
export default function PrivacidadePage() {
  return (
    <main className="enter mx-auto w-full max-w-[42rem] px-5 pb-16 pt-10 sm:pt-16">
      <header>
        <p className="text-[13px] uppercase tracking-[0.14em] text-subtle">{APP_NAME}</p>
        <h1 className="display mt-3 text-[32px]">Política de privacidade</h1>
        <p className="mt-4 text-[15px] text-muted">
          Última atualização: <time dateTime="2026-09-07">7 de setembro de 2026</time> ·
          versão {TERMS_VERSION}. Como o {APP_NAME} trata dados pessoais, conforme a
          LGPD (Lei nº 13.709/2018).
        </p>
      </header>

      <Rule loose />

      <div className="space-y-9 text-[15px] leading-[1.65]">
        <section>
          <h2 className="text-[17px] font-semibold">1. Papéis: controlador e operador</h2>
          <p className="mt-3">
            Existem duas relações de dados distintas no serviço, e distinguir as duas é
            a parte mais importante desta política:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong>Seus dados, de agente</strong> — nome, e-mail, senha, dados da
              agência e da assinatura: o {APP_NAME} é o{" "}
              <strong>controlador</strong>. É o serviço que você contratou; os dados
              existem para ele funcionar.
            </li>
            <li>
              <strong>Os dados dos seus clientes</strong> — contatos, viajantes,
              negócios, propostas: <strong>você é a controladora</strong> e o{" "}
              {APP_NAME} é o <strong>operador</strong>. Tratamos em seu nome, sob suas
              instruções, apenas para o serviço funcionar — nunca para os nossos fins.
            </li>
          </ul>
          <p className="mt-3">
            Na prática: se um dos seus clientes quiser acessar, corrigir ou apagar os
            próprios dados, o pedido é seu para responder — você conhece a relação e a
            base legal. Nós damos as ferramentas e o suporte técnico (extração,
            correção, eliminação) para você cumprir. E vale o inverso: nós nunca
            entramos em contato com seus clientes por conta própria.
          </p>
        </section>

        <section>
          <h2 className="text-[17px] font-semibold">2. Quais dados tratamos</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong>Cadastro do agente:</strong> nome, e-mail, senha (guardada apenas
              como hash), nome da agência e marca (nome, logo, cores), contato e, quando
              você assina, os dados de cobrança.
            </li>
            <li>
              <strong>Conteúdo que você cadastra:</strong> clientes e viajantes (nome,
              contato e, quando você lança, CPF, passaporte e data de nascimento),
              negócios e propostas (destinos, datas, valores, textos e imagens).
            </li>
            <li>
              <strong>Registros técnicos:</strong> data e hora de acessos; aberturas de
              proposta (registramos <em>quando</em> e por quanto tempo a página ficou
              aberta, sem identificar quem leu além do que o próprio navegador envia);
              registros de auditoria de dentro da conta (o que foi feito e quando).
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-[17px] font-semibold">3. Documentos: criptografia</h2>
          <p className="mt-3">
            CPF, passaporte e data de nascimento recebem rigor redobrado. São cifrados
            com AES-256-GCM na aplicação, antes de chegar ao banco — não ficam em claro
            em banco, log ou mensagem de erro —, e cada registro guarda junto a versão
            da chave que o cifrou, para permitir troca de chave sem reescrever o
            histórico.
          </p>
          <p className="mt-3">
            A leitura de um documento só acontece dentro da sessão da própria agente, e
            cada exibição é registrada — o fato e a hora, nunca o conteúdo.
          </p>
        </section>

        <section>
          <h2 className="text-[17px] font-semibold">4. Bases legais</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong>Seus dados, de agente:</strong> execução de contrato (art. 7º, V,
              da LGPD) — os dados existem para o serviço contratado funcionar.
            </li>
            <li>
              <strong>Os dados dos seus clientes, tratados como operador:</strong>{" "}
              execução do contrato com você e cumprimento das suas instruções (art. 7º,
              V, no âmbito da relação controladora–operadora) e legítimo interesse
              (art. 7º, IX) quando necessário à segurança do serviço e à prevenção de
              fraude.
            </li>
          </ul>
          <p className="mt-3">
            O aceite destes documentos no cadastro é registrado com data e versão (art.
            8º) — e pode ser revogado encerrando a conta.
          </p>
        </section>

        <section>
          <h2 className="text-[17px] font-semibold">5. Compartilhamento</h2>
          <p className="mt-3">
            Os dados passam pelo mínimo de fornecedores que o serviço exige:
            hospedagem e banco de dados, envio de e-mail transacional (link de login,
            avisos) e cobrança da assinatura via Asaas (Pix, cartão ou boleto) quando
            você assina.
          </p>
          <p className="mt-3">
            Não vendemos, alugamos ou trocamos dados pessoais. Não usamos os dados dos
            seus clientes para os nossos fins, nem para treinar modelo nenhum. As telas
            do produto não têm publicidade nem rastreadores de terceiros.
          </p>
        </section>

        <section>
          <h2 className="text-[17px] font-semibold">6. Retenção e eliminação</h2>
          <p className="mt-3">
            Seus dados existem enquanto sua conta existir. Ao encerrar a conta, os dados
            de negócio são eliminados; cópias de segurança expiram no ciclo normal de
            backup; registros de segurança e de auditoria — e o que for necessário a
            obrigação legal ou fiscal — permanecem pelo prazo necessário, sem uso para
            nenhum outro fim.
          </p>
        </section>

        <section>
          <h2 className="text-[17px] font-semibold">7. Seus direitos</h2>
          <p className="mt-3">
            A LGPD (art. 18) garante ao titular, entre outros: confirmação de
            tratamento, acesso aos dados, correção, anonimização ou eliminação de dados
            desnecessários, portabilidade, informação sobre com quem os dados foram
            compartilhados e revogação do consentimento.
          </p>
          <p className="mt-3">
            Para exercer, escreva para{" "}
            <a
              href={`mailto:${CANAL_DE_PRIVACIDADE}`}
              className="text-accent underline underline-offset-2"
            >
              {CANAL_DE_PRIVACIDADE}
            </a>
            . Pedimos o mínimo de identificação para proteger a conta e respondemos em
            prazo razoável. Pedidos sobre dados dos seus clientes podem ser direcionados
            a você — e nós ajudamos do lado técnico.
          </p>
        </section>

        <section>
          <h2 className="text-[17px] font-semibold">8. Sessão</h2>
          <p className="mt-3">
            Usamos um cookie de sessão para manter você logada. Nada além dele para
            publicidade — as telas do produto não têm anúncios.
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
          <Link href="/termos" className="text-accent underline underline-offset-2">
            Termos de uso
          </Link>
          <Link href="/cadastrar" className="text-accent underline underline-offset-2">
            Criar conta
          </Link>
        </nav>
      </footer>
    </main>
  );
}
