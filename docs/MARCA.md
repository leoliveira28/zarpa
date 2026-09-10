# Marca — Papel e Pedra

> Guia de marca e design system. Este documento governa o que `CLAUDE.md > Regras de
> interface` resume: aqui está o porquê, o conjunto completo e as regras de uso da
> marca fora do produto (logo, apresentação, site). Em conflito, vale o texto mais
> específico — e qualquer mudança de direção passa por decisão do PO registrada aqui.

---

## 1. A ideia da marca

O produto dá ao agente de viagem independente uma proposta com a qualidade de
documento de uma agência estruturada — em 2 minutos, do celular. A marca traduz isso
sem decir: **somos o instrumento de trabalho, não o espetáculo**. A referência não é
o software de gestão (dashboard, CRM, pipeline) — é a prancheta do profissional que
desenha: papel de livro, tinta de gravura, carta náutica, prancha técnica de
arquitetura com cota e fio.

Daí os três materiais que aparecem em toda parte:

- **Papel** `#F4F3F0` — superfície de livro, não branco de tela.
- **Tinta** `#14181B` — quase preta, com viés frio, como tinta de gravura.
- **Azul de carta náutica** `#12557F` — a única cor de marca, reservada para dizer
  onde clicar.

E daí o gesto que a marca inteira repete: **um traço de espessura constante, sem
preenchimento, sem sombra, sem cor**. É a gramática das pranchas (`src/components/plates/`),
dos ícones (`src/components/app/icons.tsx`) e da logo. Numa linha de 1px não há moda —
é por isso que o sistema envelhece bem.

A marca tem nome clínico de desenhista — **Papel e Pedra** — e não tem logotipo
pronunciável ainda: o nome comercial não foi decidido. Nada disto depende do nome;
quando ele existir, entra como assinatura (§3.4) sem tocar no símbolo.

## 2. Os quatro registros

O ornamento não é distribuído por igual. A agente abre o app quinze vezes por dia:
o que encanta na primeira visita irrita na quinquagésima. A intensidade da marca
escala com a frequência de uso — ao contrário:

| Superfície | Registro | O que herda |
|---|---|---|
| Miolo do app | Silencioso | Grid, fios, proporção, uma cor. Zero ilustração exceto estado vazio |
| Proposta pública | Editorial pleno | Tipografia como imagem, prancha, margem de livro, arco como divisor |
| Entrada e estados vazios | Intermediário | Uma prancha por tela, discreta |
| Marca e site | Editorial pleno | Tudo |

Regra de bolso: **quanto mais vezes a tela é vista por dia, mais silenciosa ela é**.
A proposta pública é vista poucas vezes e precisa impressionar; o funil é visto
cinquenta vezes e precisa desaparecer.

## 3. Logo

### 3.1 O símbolo — Vela de Papel

A marca é a **vela** que já representa o produto — o glifo do `Wordmark`
(`src/components/app/AppShell.tsx`): vela principal, vela de proa e a linha do
casco, branco sobre o azul de carta náutica. A evolução criativa dá a ela o
conceito que faltava: **Vela de Papel**. A proposta que o agente manda é uma
folha; a folha dobrada vira a vela que zarpa. É o produto inteiro num símbolo —
o documento que vira viagem — e costura a marca à direção Papel e Pedra sem
precisar da rosa dos ventos, que volta a ser só prancha de entrada (§7).

Na prática, em três resoluções:

- **Mestre (grade 160).** O glifo de hoje, com dois acréscimos em fio cabelo:
  o **vinco da dobra** na vela principal (o mastro, de ponta a base) e o **mar** —
  duas linhas curtas e defasadas abaixo do casco, eco do horizonte do
  `TodayIcon`. Traço principal 1.2/160, pontas arredondadas, uma cor só.
- **Pequena (16–24px).** Só o glifo: vela principal, vela de proa, casco. Vinco
  e mar são descartados — o que não sobrevive a 16px não entra lá. Traço de
  10 unidades na grade 160 (= 1px em 16px).
- **Tile de app.** Vela branca sobre o quadrado azul `#12557F`, raio ~22,5%,
  margem de segurança de 25% — como o tile de hoje. Versão clara: tinta sobre papel.

A geometria é a do `Wordmark` levada a sério: os vértices não mudam de lugar.
A criatividade mora no vinco, no mar e no conceito — não em redesenhar o que
já funciona.

O desenho da produção está especificado em `docs/PROMPT_LOGO_FIGMA.md`; os
rascunhos em `public/brand/` (com `preview.html` para conferência).

### 3.2 Cor da logo

A logo é **monocromática, sempre**: tinta sobre papel, papel sobre tinta, ou
`currentColor` dentro do produto. Nunca recebe o azul de carta náutica — o azul
serve para dizer onde clicar, e logo não é clique. Nunca recebe cor de estado.

### 3.3 Usos proibidos

Não girar, não inclinar, não sombrear, não aplicar gradiente, não contornar com
outra caixa, não compor com foto, não recolorir com nenhuma cor fora de tinta/papel.
Não colocar a logo sobre superfície que não seja papel, tinta ou uma foto com veil
suficiente (`--surface-veil`). Não redesenhar versões "simplificadas" fora da
especificação do §3.1 — existe uma versão por faixa de tamanho, e pronto.

### 3.4 Assinatura (pendente de nome)

O nome comercial não existe ainda (`APP_NAME` em `src/lib/ui/brand.ts`). Quando
existir, a assinatura usa **Archivo Expanded, peso 800, tracking −0.035em** (§4),
sempre em tinta ou papel — nunca no azul. A assinatura nunca aparece abaixo de 20px;
abaixo disso, só o símbolo.

## 4. Tipografia

### 4.1 A proposta: Archivo substitui Libre Franklin no display

A interface continua em **`system-ui`** — decisão mantida: a UI é instrumento, e a
fonte do sistema é invisível por definição. A mudança é só no **display**.

**Archivo** (Omnibus-Type, open source, Google Fonts) herda a mesma linhagem da
Libre Franklin — a gótica americana de jornal e placa institucional — mas traz o que
a Libre Franklin não tem: **eixo de largura** (`wdth` 62–125) além do eixo de peso
(`wght` 100–900), com variável única e itálicos reais.

Por que ela e não outra:

- **A largura é o segundo contraste do registro editorial.** Hoje o contraste de
  display vem só de peso (800 sobre 300). Com o eixo `wdth`, a capa da proposta
  ganha **Expanded Black** — tipografia como placa, quase desenho — enquanto um
  título interno pode ficar em largura normal. Duas vozes da mesma família, sem
  introduzir uma segunda fonte.
- **É de imprensa, não de template.** Archivo nasceu para manchetes de jornal
  impresso; não é a fonte default de nenhum framework, e a Inter e a Space Grotesk
  continuam proibidas.
- **Português completo** (subconjunto `latin` cobre tudo que o produto escreve) e
  peso 300 disponível — o contraste 800/300 da direção atual se mantém sem
  recalcular a escala.

O que muda no código (uma troca, sem tocar em tokens de escala):

```ts
// src/app/layout.tsx
import { Archivo } from "next/font/google";

const display = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],          // eixo de largura, para o registro Expanded
  weight: "variable",
  variable: "--font-libre-franklin", // nome mantido de propósito: zero mudança em tokens.css
  display: "swap",
});
```

Manter o nome da variável CSS é o que torna a migração de uma linha: todo o resto
do sistema lê `--stack-display`, que aponta para `--font-libre-franklin`.
Classes de largura (`font-stretch`) entram só no registro de capa; a regra
`letter-spacing: -0.035em` em display grande e o `line-height: 0.94` não mudam.

**Verificação obrigatória na migração:** números tabulares. Todo valor financeiro
exige `tabular-nums` + largura reservada (regra da casa). A interface já os resolve
em `system-ui`; se a capa da proposta for renderizar preço em Archivo, conferir que
o recurso `tnum` responde — se não responder, o preço na capa usa o stack de UI.
Teste em `/kitchen-sink`, nos dois temas.

### 4.2 O que não muda

- **Nenhuma serifa no sistema, em nenhuma superfície** — regra absoluta.
- Escala travada 13 / 15 / 17 / 20 / 32 (tokens `--fs-*`), sem degraus intermediários.
- Contraste de display vem de **peso**, nunca de itálico decorativo: 800 sobre 300.
- Display grande: `letter-spacing: -0.035em`, `line-height: 0.94`.
- Display nunca desce para rótulo, campo ou tabela.
- Todo valor financeiro: `tabular-nums` + largura reservada. Número que muda de
  largura ao carregar é bug.
- Proibidas: Inter, Space Grotesk, serifa de qualquer família, itálico decorativo.

## 5. Cor

| Papel | Token | Claro | Escuro |
|---|---|---|---|
| Papel (fundo) | `--bg` | `#F4F3F0` | `#0E1114` |
| Tinta (texto) | `--text` | `#14181B` | papel |
| Azul de carta náutica | `--accent` | `#12557F` | claro suficiente p/ contraste |

As definições canônicas vivem em `src/styles/tokens.css` — este documento não
duplica valores que o código já governa; a tabela acima é a identidade, o arquivo é
a fonte da verdade.

Regras que valem como marca:

- **Uma única cor de destaque.** O azul serve para uma coisa só: dizer onde clicar.
  Se o azul aparecer duas vezes na mesma tela, uma delas está errada.
- **Verde e âmbar são estado, não marca.** Sucesso e atenção existem onde o estado
  existe e não aparecem em comunicação, capa ou logo.
- Toda cor nasce no `:root` base; os temas escuros apenas **redefinem**. Nenhuma cor
  com definição única dentro de media query.
- Gradiente roxo-azul, e qualquer gradiente decorativo, não existem nesta marca.

## 6. Proporção e estrutura

Da arquitetura antiga vem a proporção, não a pedra desenhada. **Base, fuste,
capitel** viram a estrutura de todo card: cabeçalho curto, corpo alto, rodapé de
ação curto — na razão aproximada **1 : 4 : 1**. Uma ação em destaque no rodapé;
havendo duas, a segunda vira texto.

- **O fio horizontal é cornija: separa registros, não envolve caixas.** Card com
  borda nos quatro lados é o oposto desta direção. Controle (campo, select, botão
  secundário) e camada flutuante (diálogo, sheet, menu, toast) são as duas únicas
  famílias que podem ter contorno nos quatro lados — a regra completa, com exemplos,
  está no comentário do `Rule` em `src/components/plates/index.tsx`.
- Margem de página generosa como livro, não como dashboard.
- `rounded-lg` em tudo, tudo centralizado: proibidos. O raio é hierarquia, não
  hábito.

## 7. Ilustração — as pranchas

Ilustração é desenho técnico e botânico em linha, e mora em
`src/components/plates/`. O acervo: `FernPlate` (fronde de samambaia — estado vazio),
`ArchPlate` (arco de volta plena com cotas — divisor da proposta pública),
`CompassPlate` (rosa dos ventos — tela de entrada) e `BiplanePlate` (14-bis em
células — capa de proposta sem foto).

Regras: traço de espessura constante, sem preenchimento, monocromático em
`currentColor`; nunca no accent; no máximo **uma prancha por tela**, a 12–16% de
opacidade quando for fundo; desenho sempre original — nunca prancha histórica
escaneada. O acervo é fechado: prancha nova só com decisão registrada neste documento.

## 8. Ícones

Desenhados em casa, em `src/components/app/icons.tsx`: grade de 16, traço 1.5,
pontas arredondadas, `currentColor`. Nenhuma biblioteca — um pacote de ícones traz
a personalidade dele, e é por aí que uma interface começa a parecer template. Logotipo
de terceiro nunca vira ícone (o WhatsApp é um balão genérico, não o glifo oficial).

## 9. Movimento

Motion tipográfico é quase todo subtração:

- **Texto não voa.** Só opacidade e no máximo 4px de deslocamento (`.enter`, 180ms,
  uma vez por rota). Nada de letra por letra. Nada animado no scroll.
- **Permitido:** o número que rola ao mudar de valor (300ms, `tabular-nums`, sem
  mudar de largura) — o único movimento tipográfico expressivo do produto; e o fio
  que se estende (`.plate-rule--draw`, 240ms via `scaleX`).
- Springs: `{ bounce: 0, duration: 0.35 }`; sheet `{ bounce: 0.15, duration: 0.3 }`.
  Só `transform` e `opacity` animam. Reagir no `pointerdown`. Toda animação é
  interrompível.
- **O teste:** tire toda a animação da tela. Se ela continuar comunicando a mesma
  coisa, o movimento está certo.

## 10. Voz

A voz é a da profissional competente que assina o documento — não a do vendedor:

- Verbo ativo e literal. O botão que diz "Publicar" produz o toast "Publicado"; a
  ação tem o mesmo nome no fluxo inteiro.
- **Erro diz o que aconteceu E oferece a correção, com o botão junto.** Erro não
  pede desculpa e não é vago.
- Destrutivo = toast com desfazer de 8s, não modal "tem certeza?".
- Estado vazio é convite com conteúdo de exemplo — nunca um vazio premiado com
  ilustração e sem saída.
- Salvamento automático com "Salvo" discreto; sem botão Salvar grande.
- Sem emoji como marcador; sem exclamação em rótulo; sem superlativo em UI.

## 11. Acessibilidade como material da marca

Não é conformidade — é material, do mesmo jeito que o papel:

- `prefers-reduced-motion` e `prefers-reduced-transparency` desde o primeiro
  componente.
- Skeleton, nunca spinner.
- Mobile-first de verdade: a agente vive no celular; toda tela existe em 390px.
- Zoom nunca bloqueado (`initialScale` sem `maximumScale`).

## 12. Inventário

| O que | Onde mora |
|---|---|
| Tokens de cor, escala, raio, elevação | `src/styles/tokens.css` |
| Ponte tokens → Tailwind | `src/app/globals.css` (`@theme inline`) |
| Pranchas e `Rule` | `src/components/plates/index.tsx` |
| Ícones | `src/components/app/icons.tsx` |
| Nome/tagline (`APP_NAME`) | `src/lib/ui/brand.ts` |
| Fonte display | `src/app/layout.tsx` |
| Estado do sistema renderizado | `/kitchen-sink` |
| Especificação da logo para produção | `docs/PROMPT_LOGO_FIGMA.md` |

## 13. Decisões registradas

| Data | Decisão |
|---|---|
| 2026-09-10 | Tipografia display: **Archivo** substitui Libre Franklin (eixo `wdth` para o registro Expanded; migração de uma linha em `layout.tsx`). Interface segue `system-ui`. |
| 2026-09-10 | Logo: **evolução fiel** da rosa dos ventos (`CompassPlate`), produção via agente Figma conforme `docs/PROMPT_LOGO_FIGMA.md`. Assinatura textual fica pendente até o nome comercial ser decidido. |
| 2026-09-10 | **Correção pelo PO** (com print do produto): a marca de hoje é a **vela** do `Wordmark` (`AppShell.tsx`), não a rosa dos ventos. Símbolo aprovado em conceito: **Vela de Papel** — vela do `Wordmark` + vinco da dobra e mar em fio cabelo no mestre; tile azul com vela branca mantido. Rosa dos ventos volta a ser só prancha de entrada. Rascunhos em `public/brand/`. |
| 2026-09-10 | **Aprovado e aplicado no app**: favicon novo em `src/app/icon.svg` (tile azul, vela branca — cópia do `app-icon-512.svg` de `public/brand/`) e pontas arredondadas no glifo do `Wordmark`. Pendente menor: o `src/app/favicon.ico` legado continua no repo (o shell estava indisponível para removê-lo); navegadores modernos preferem o SVG. O símbolo mestre (vinco + mar) ainda não é usado em tela nenhuma — entra quando houver superfície grande de marca (site, capa). |
