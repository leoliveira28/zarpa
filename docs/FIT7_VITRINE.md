# Fit 7 — Vitrine: a página pública do agente (o site que ele não tem)

> Proposta do coordenador (2026-09-10), a pedido do PO. O agente solo não tem
> site — e não precisa ter: a Vitrine É a página pública dele, com o catálogo
> de ofertas montadas com o que o construtor de proposta já sabe construir.
> Nada vira código sem o ok do PO.

## 1. A mira

"Muitos agente não têm uma parte própria" — o Instagram é a vitrine deles,
e o WhatsApp é o site. A Vitrine dá a página que faltava: **um endereço
público fixo** (`zarpa.app/a/mare-alta-turismo`) onde as ofertas da agência
ficam publicadas — pacote, só voo, só hospedagem, transfer, serviço — com
preço, e o cliente demonstrando interesse sem fricção. O agente divulga UM
link; a página nunca desatualiza (despublicou a oferta, ela sai do ar na hora).

## 2. Nome — proposta com o tom da marca

A voz da marca (MARCA.md §10) é "a profissional competente que assina o
documento, não a vendedora". **Proposta: "Vitrine"** — entendimento imediato
pelo agente ("sua vitrine pública"), sem jargão de e-commerce. Alternativas
avaliadas: **"Balcão"** (o balcão da agência de viagem — mais charmoso e mais
quieto, mas hoje significa menos), **"Catálogo"** (correto e frio). Decisão do
PO; o nome só entra em rótulo — a URL é `/a/[slug]`, o roteamento não depende.

## 3. Arquitetura — a oferta é o contrato novo; o bloco é o de sempre

- **`offers`** (0026): `title`, `type` (`pacote | voo | hospedagem | transfer |
  serviço`), preço (fotografia), capa, **`blocks_snapshot`** — os MESMOS blocos
  do construtor de proposta (fotos, texto, roteiro, inclusos): "tudo que ele
  pode já construir na proposta hoje ele monta a oferta" — zero editor novo,
  os componentes existem. `published_at`/`unpublished_at` (soft), ordem manual
  (a agente escolhe o que aparece primeiro). `group_id` nullable: **a oferta
  pode SER um grupo** — o "Fátima 2027 com 10 lugares" da meta anterior é uma
  oferta do tipo pacote com assento; a Vitrine unifica (o card mostra
  "restam N" quando tem lugares, nada quando não tem).
- **A página pública** `/a/[slug]` (slug do tenant, `tenants.slug` já existe):
  hero quieto com a marca da agência (mesma fotografia de `/p/` e `/r/` —
  logo, nome, a Vela de Papel no colofão) e o catálogo em cards consistentes.
- **A página da oferta** `/a/[slug]/o/[id]`: o desenho que os players usam
  (verificado — [Unicorn Platform](https://unicornplatform.com/blog/travel-agency-website-examples-booking/),
  [Loonis](https://www.loonis.co/blog/best-webflow-templates-for-travel-agencies-in-2026)):
  1. Hero com a promessa (destino + para quem é + estilo — específico, nunca
     "viagem dos sonhos");
  2. O que está incluso / o que não está (a resposta que mais gera hesitação
     quando falta);
  3. Preço com UMA régua por tipo ("a partir de", fixo, ou sob consulta com
     prazo de resposta) — **preço escondido é o erro nº 1 dos sites de agente**;
  4. UM CTA só: **"Tenho interesse"** — formulário curto, contexto da oferta
     visível, expectativa de resposta dita ("a {agente} responde em até 1 dia").
- **O interesse**: o botão pede o Google **sem criar sessão** — Sign-In do
  Google verifica identidade e preenche nome + e-mail confirmados; o cliente
  NUNCA loga no Zarpa (a organização é da agência, nunca do cliente — regra da
  Fase 4). Servidor grava/reativa o contato PF com a tag `oferta:{slug}` e o
  registro de interesse na oferta. WhatsApp como campo opcional do formulário
  (o canal de conversa da agente).
- **Interessados → funil**: card "Interessados (N)" na ficha da oferta
  (superfície autenticada) — um toque em "Criar negócio" abre o
  `NovoNovoNegocioSheet` com contato fixo, negócio nasce no funil. O lead vira
  pipeline sem digitar nada duas vezes.

## 4. Disciplina de página pública (a mesma de `/p/` e `/r/`)

Nomes de interessados/ocupantes JAMAIS aparecem na página (só contagens);
política de privacidade linkada; rate limit no endpoint de interesse; ofertada
despublicada sai do ar na hora mas o link já divulgado responde com "esta
oferta não está mais disponível" + o link do catálogo (nunca 404 seco);
esgotou, o botão vira "Lista de espera". `robot`/OG tags: a oferta é a capa
compartilhada no WhatsApp — imagem, título e preço no preview do link.

## 5. Rodadas

| Rodada | Entrega |
|---|---|
| **7a** | `offers` (0026) + editor de oferta reusando os blocos do construtor + `/a/[slug]` (catálogo) + página da oferta (leitura) |
| **7b** | Interesse com Google (identidade, sem sessão) + tag automática + card Interessados + "criar negócio" |
| **7c** | Grupos como oferta com lugares na Vitrine (unificação) + Relatórios ("origem: oferta X" nos negócios) |

## 6. Fora de escopo, de propósito

Reserva/pagamento na página (o interesse é o CTA — o fechamento é humano,
no WhatsApp/funil; passar a vender sozinha é virar OTA), múltiplas páginas
por agente, domínio próprio, blog, CMS livre. Se um player pedir, decisão
explícita.
