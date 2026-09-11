import type { Metadata } from "next";
import Link from "next/link";
import "./landing.css";

/**
 * A landing pública do Zarpa (a raiz do domínio). Superfície de MARCA:
 * conta o produto com os PRINTS reais da aplicação nos dois tons
 * (`public/landings/*.png`) e converte para `/cadastrar`.
 *
 * Server component sem JS de cliente: zero hidratação, o carregamento É a
 * conversão. O tom papel é forçado no wrapper (`.zland` re-mapeia os tokens),
 * então a preferência do sistema do visitante não desmonta a marca. Os dois
 * tons do PRODUTO são mostrados como conteúdo, na seção "De dia e de noite".
 */

export const metadata: Metadata = {
  title: "Zarpa · Propostas de viagem com qualidade de agência grande",
  description:
    "Monte propostas de viagem em dois minutos do celular, organize o funil, receba pagamentos e publique sua página de ofertas. Feito para agentes de viagem independentes.",
};

const recursos = [
  {
    titulo: "Uma proposta que parece de agência estruturada",
    texto:
      "Blocos de voo, hotel, transfer e passeio com fotos, três opções de preço e o link público para o cliente escolher. Salve como modelo e a próxima proposta sai em dois minutos.",
    print: "/landings/proposta-editor-light.png",
    alt: "Editor de proposta do Zarpa com blocos de voo, hotel e valores em reais",
  },
  {
    titulo: "O funil mostra a verdade do mês",
    texto:
      "Cada viagem é um cartão: arraste pelo funil, veja o valor de cada coluna, marque as perdidas com o motivo. Em equipe, cada cartão diz de quem é.",
    print: "/landings/funil-dark.png",
    alt: "Quadro do funil do Zarpa com colunas de negociação e valores por coluna",
  },
  {
    titulo: "A ficha de cada cliente, de ponta a ponta",
    texto:
      "Negócios, propostas, roteiros, viajantes e documentos num lugar só. Documentos cifrados, com registro de quem abriu. Empresas com centro de custo e faturamento.",
    print: "/landings/clientes-light.png",
    alt: "Ficha 360 graus de um cliente no Zarpa com histórico e viajantes",
  },
  {
    titulo: "Dinheiro sem planilha",
    texto:
      "A venda nasce da proposta aceita com valor, custo e comissão fotografados. Parcelas do cliente, comissão prevista × recebida, export para o contador e relatórios que fecham.",
    print: "/landings/vendas-light.png",
    alt: "Lista de vendas do Zarpa com valores e status de comissão",
  },
];

const faq = [
  {
    p: "Preciso de cartão de crédito para começar?",
    r: "Não. Crie a conta, cadastre um cliente e mande a primeira proposta hoje. O cartão só entra quando você assinar um plano.",
  },
  {
    p: "Meus clientes precisam criar conta?",
    r: "Não. Eles recebem um link e veem a proposta, o roteiro ou a vitrine no navegador, sem login nenhum.",
  },
  {
    p: "Meus dados e os dos meus clientes ficam seguros?",
    r: "Documentos e datas sensíveis ficam cifrados no banco, cada agência isolada da outra, e toda abertura de documento fica registrada. O que é seu, é seu.",
  },
  {
    p: "Funciona no celular?",
    r: "O Zarpa é feito para o celular primeiro: proposta, funil e envio por WhatsApp cabem na mão. No computador, a experiência completa acompanha.",
  },
];

export default function LandingPage() {
  return (
    <div className="zland">
      {/* ---------------------------------------------------------- header */}
      <header className="zland-header">
        <div className="zland-header-in">
          <Link href="/" className="zland-brand" aria-label="Zarpa, página inicial">
            {/* eslint-disable-next-line @next/next/no-img-element -- símbolo estático da marca */}
            <img src="/brand/symbol-small.svg" alt="" width={24} height={24} />
            Zarpa
          </Link>
          <nav className="zland-nav" aria-label="Seções da página">
            <a href="#produto">Produto</a>
            <a href="#vitrine">Vitrine</a>
            <a href="#precos">Preços</a>
            <a href="#perguntas">Perguntas</a>
          </nav>
          <div className="zland-header-ctas">
            <a href="/entrar" className="zland-entrar">
              Entrar
            </a>
            <a href="/cadastrar" className="zland-cta">
              Criar conta grátis
            </a>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------ hero */}
      <section className="zland-hero">
        <div className="zland-hero-in">
          <span className="zland-kicker">Para agentes de viagem independentes</span>
          <h1>A proposta de agência grande, em dois minutos do celular</h1>
          <p>
            O Zarpa monta o orçamento com cara de agência estruturada, organiza
            suas viagens no funil, cobra por parcela e publica sua página de
            ofertas. Do atendimento ao pagamento, sem planilha.
          </p>
          <div className="zland-hero-ctas">
            <a href="/cadastrar" className="zland-cta">
              Criar conta grátis
            </a>
            <a href="#produto" className="zland-cta-ghost">
              Ver como funciona
            </a>
          </div>
          <span className="zland-micro">Grátis para começar. Sem cartão de crédito.</span>
        </div>
        <div className="zland-hero-print">
          <figure className="zland-frame" style={{ margin: "44px auto 0" }}>
            <div className="zland-frame-bar" aria-hidden>
              <i />
              <i />
              <i />
              <span>app.zarpa.com.br/hoje</span>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- print estático da própria aplicação */}
            <img
              src="/landings/hoje-light.png"
              alt="Tela Hoje do Zarpa: tarefas do dia, propostas abertas pelo cliente, viagens em curso e o resumo do mês"
              width={1440}
              height={900}
            />
          </figure>
        </div>
      </section>

      {/* -------------------------------------------------------- produto */}
      <section id="produto" className="zland-secao">
        <div className="zland-secao-in">
          <h2>Tudo o que a venda precisa, na ordem em que acontece</h2>
          <p className="zland-lead">
            Nada de ferramenta solta: a proposta vira negócio, o negócio vira
            venda, a venda vira parcela e o relatório fecha a conta no fim do
            mês.
          </p>

          {recursos.map((recurso, indice) => (
            <div key={recurso.titulo} className={indice % 2 === 1 ? "zland-bloco zland-inverte" : "zland-bloco"}>
              <div>
                <h3>{recurso.titulo}</h3>
                <ul>
                  <li>{recurso.texto}</li>
                </ul>
              </div>
              <div className="zland-print">
                {/* eslint-disable-next-line @next/next/no-img-element -- print estático da própria aplicação */}
                <img src={recurso.print} alt={recurso.alt} width={1440} height={900} loading="lazy" />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------ dois tons */}
      <section className="zland-secao" style={{ background: "var(--surface-2)" }}>
        <div className="zland-secao-in">
          <h2>De dia e de noite, no seu tom</h2>
          <p className="zland-lead">
            O Zarpa vem nos dois tons: papel claro de dia, tinta profunda para
            fechar o dia. Você alterna quando quiser, e o cliente nem percebe
            a mudança.
          </p>
          <div className="zland-tones">
            <figure className="zland-tone">
              {/* eslint-disable-next-line @next/next/no-img-element -- print estático da própria aplicação */}
              <img
                src="/landings/hoje-light.png"
                alt="Zarpa em tom claro: quadro do dia com tarefas e resumo do mês"
                width={1440}
                height={900}
                loading="lazy"
              />
              <figcaption>
                <strong>Tom claro</strong>
                <span>para a manhã cheia de atendimento</span>
              </figcaption>
            </figure>
            <figure className="zland-tone">
              {/* eslint-disable-next-line @next/next/no-img-element -- print estático da própria aplicação */}
              <img
                src="/landings/funil-dark.png"
                alt="Zarpa em tom escuro: funil com cartões de viagens e valores"
                width={1440}
                height={900}
                loading="lazy"
              />
              <figcaption>
                <strong>Tom escuro</strong>
                <span>para fechar o dia olhando o funil</span>
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- vitrine */}
      <section id="vitrine" className="zland-secao">
        <div className="zland-secao-in">
          <h2>Sua página pública que capta leads</h2>
          <p className="zland-lead">
            Muita gente vai conhecer seu trabalho por um link. A Vitrine é a
            página do seu agenciamento: ofertas com preço, do pacote completo
            ao traslado. Quem se interessa deixa nome e WhatsApp, e o lead
            aparece no seu quadro com um toque para virar negócio.
          </p>
          <div className="zland-bloco">
            <div>
              <h3>Do link divulgado ao cliente no funil</h3>
              <ul>
                <li>Ofertas com preço, montadas por você, sem depender de programador</li>
                <li>Interessado deixa nome e WhatsApp e já vira cliente no seu cadastro</li>
                <li>Um toque transforma o interesse em negócio no funil</li>
                <li>Relatório mostra quanto a página pública trouxe no mês</li>
              </ul>
            </div>
            <div className="zland-print">
              {/* eslint-disable-next-line @next/next/no-img-element -- print estático da própria aplicação */}
              <img
                src="/landings/catalogo-light.png"
                alt="Catálogo público da vitrine com ofertas de viagem, preços e filtros por tipo"
                width={1440}
                height={900}
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- grupos */}
      <section className="zland-secao" style={{ background: "var(--surface-2)" }}>
        <div className="zland-secao-in">
          <h2>Excursões com lugares, margem por lugar</h2>
          <p className="zland-lead">
            Monte a saída antes de vender: quantos lugares, quanto custa por
            lugar, por quanto você vende. Os clientes vão ocupando, e o
            relatório mostra a margem da excursão.
          </p>
          <div className="zland-bloco zland-inverte">
            <div>
              <h3>O pacote existe antes do primeiro cliente</h3>
              <ul>
                <li>Lugares contados: quando enche, o aviso aparece na hora</li>
                <li>Custo, comissão e taxa por lugar, fotografados no pacote</li>
                <li>Cada cliente ocupa os lugares da família dele</li>
                <li>A margem da saída fecha no relatório de grupos</li>
              </ul>
            </div>
            <div className="zland-print">
              {/* eslint-disable-next-line @next/next/no-img-element -- print estático da própria aplicação */}
              <img
                src="/landings/grupos-light.png"
                alt="Ficha de um grupo no Zarpa com lugares, valores por lugar e ocupação"
                width={1440}
                height={900}
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- preços */}
      <section id="precos" className="zland-secao">
        <div className="zland-secao-in">
          <h2>Preço na mesa, como na sua proposta</h2>
          <p className="zland-lead">
            Todos os planos incluem propostas e modelos, funil, clientes com
            ficha 360°, vitrine pública, grupos, relatórios e suporte humano.
          </p>
          <div className="zland-planos">
            <article className="zland-plano">
              <header>
                <h3>Solo</h3>
              </header>
              <span className="zland-preco">
                R$ 49 <small>/mês</small>
              </span>
              <ul>
                <li>Para quem trabalha sozinho</li>
                <li>Propostas, funil e clientes sem limite</li>
                <li>Vitrine pública e grupos</li>
              </ul>
              <a href="/cadastrar" className="zland-cta zland-cta-suave">
                Começar no Solo
              </a>
            </article>
            <article className="zland-plano zland-plano-destaque">
              <header>
                <h3>Pro</h3>
                <span className="zland-plano-badge">Mais escolhido</span>
              </header>
              <span className="zland-preco">
                R$ 99 <small>/mês</small>
              </span>
              <ul>
                <li>Para a agência com equipe pequena</li>
                <li>Assentos para a equipe</li>
                <li>Relatórios por vendedor</li>
              </ul>
              <a href="/cadastrar" className="zland-cta">
                Começar no Pro
              </a>
            </article>
            <article className="zland-plano">
              <header>
                <h3>Studio</h3>
              </header>
              <span className="zland-preco">
                R$ 199 <small>/mês</small>
              </span>
              <ul>
                <li>Para a operação estabelecida</li>
                <li>Tudo do Pro, com o teto maior</li>
                <li>Recursos de operação avançada primeiro</li>
              </ul>
              <a href="/cadastrar" className="zland-cta zland-cta-suave">
                Começar no Studio
              </a>
            </article>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ faq */}
      <section id="perguntas" className="zland-secao" style={{ background: "var(--surface-2)" }}>
        <div className="zland-secao-in">
          <h2>Perguntas diretas, respostas também</h2>
          <div className="zland-faq" style={{ marginTop: 24 }}>
            {faq.map((item) => (
              <details key={item.p}>
                <summary>{item.p}</summary>
                <p>{item.r}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ cta final */}
      <section className="zland-final">
        <div className="zland-final-in">
          <h2>Sua próxima proposta está a dois minutos</h2>
          <p>
            Crie a conta, cadastre o cliente e mande o link. O resto é com o
            Zarpa.
          </p>
          <a href="/cadastrar" className="zland-cta">
            Criar conta grátis
          </a>
          <span className="zland-micro">Sem cartão de crédito. Sem fidelidade.</span>
        </div>
      </section>

      {/* --------------------------------------------------------- footer */}
      <footer className="zland-footer">
        <div className="zland-footer-in">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- símbolo da marca */}
            <img src="/brand/symbol-small.svg" alt="" width={18} height={18} />
            Zarpa
          </span>
          <nav aria-label="Links do rodapé">
            <a href="/entrar">Entrar</a>
            <a href="/termos">Termos</a>
            <a href="/privacidade">Privacidade</a>
          </nav>
          <span>Feito no Brasil, para quem vende Brasil e mundo.</span>
        </div>
      </footer>
    </div>
  );
}
