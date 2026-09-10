# Prompt para o agente Figma — produção da logo (Vela de Papel)

> Copie o bloco abaixo e cole no agente conectado ao Figma. Ele é autocontido:
> descreve a geometria de referência (o glifo do `Wordmark` em
> `src/components/app/AppShell.tsx`), os entregáveis e o critério de aceite. Não
> dependa do agente ler o repositório.
>
> **Status (2026-09-10):** APROVADO pelo PO e aplicado no app — favicon em
> `src/app/icon.svg` e pontas arredondadas no `Wordmark` (docs/MARCA.md §13).
> Os 5 entregáveis vivem em `public/brand/` (com `preview.html` para conferência).
> O prompt abaixo continua válido para iterar variações dentro do Figma.

---

## Prompt (colar no agente)

```text
Você vai desenhar o SÍMBOLO de logotipo de um produto SaaS brasileiro de viagens,
em SVG vetorial, como evolução do símbolo que o produto já usa hoje: uma vela
(estilo de barco à vela) desenhada em traço, com duas velas triangulares e a linha
do casco. Não é criação livre: a geometria de referência está abaixo em coordenadas
exatas e deve ser respeitada — os vértices NÃO mudam de lugar. A entrega são
arquivos SVG, não mockups de imagem.

## Conceito — "Vela de Papel"
A proposta de viagem que o produto gera é uma folha de papel; a folha dobrada vira
a vela que zarpa. O símbolo conta isso com dois acréscimos discretos ao glifo de
hoje, ambos em fio cabelo: (1) o VINCO da dobra — uma linha vertical da ponta da
vela principal até a base dela; (2) o MAR — duas linhas curtas e defasadas abaixo
do casco, como um horizonte duplo. Personalidade: instrumento de desenhista —
papel, tinta, gravura, prancha técnica. NADA de: gradientes, sombras, brilho, 3D,
cores múltiplas, estilo "tech startup", barco realista com detalhe de madeira,
velas infladas com curvas dramáticas, texto ou letras de qualquer tipo.

## Geometria de referência (grade 160×160, tudo em traço, pontas arredondadas)
Glifo de hoje (o que existe e permanece):
- Vela principal (triângulo retângulo): ponta (80,25); base de (80,100) a (125,100).
- Vela de proa (triângulo menor): ponta (70,55); base de (35,100) a (70,100).
- Casco: linha horizontal de (25,122.5) a (135,122.5).
Acréscimos da evolução (fio cabelo):
- Vinco da dobra: linha vertical de (80,25) a (80,100).
- Mar: linha de (42,134) a (80,134) e linha de (56,143) a (98,143).

## Pesos de traço
- Símbolo mestre: traço principal 1.2 unidades na grade 160 (0.75% da largura do
  viewBox); vinco e mar em fio cabelo de 0.55 com opacidade 65%. PONTAS ARREDONDADAS
  (round linecap/linejoin) em tudo — é a assinatura do traço do sistema.
- Variante pequena (16–24px): SÓ o glifo de hoje (sem vinco, sem mar — o que não
  sobrevive a 16px não entra), com todos os traços reproporcionados para 10 unidades
  na grade 160 (= 1px em 16px).

## Monocromia
Cada arquivo em UMA cor: tinta #14181B sobre transparente, ou branco-papel #F4F3F0
sobre o azul do tile. A logo nunca recebe outra cor — o azul é do tile, não do desenho.

## Entregáveis (SVG, um por arquivo, viewBox próprio, sem dependência externa)
1. `symbol-master.svg` — símbolo completo na grade 160 (glifo + vinco + mar).
2. `symbol-small.svg` — só o glifo, traços a 10 unidades, desenhado para 16–24px.
3. `app-icon-512.svg` — vela branca #F4F3F0 sobre tile azul #12557F com raio de
   canto 115 (22.5%), símbolo pequeno centralizado com margem de segurança de 25%.
4. `app-icon-inverse-512.svg` — a mesma composição, tile #F4F3F0 e vela #14181B.
5. `favicon-16.svg` — o glifo num viewBox 16×16, coordenadas já na escala final,
   traço 1.5, pontas arredondadas.
6. Um frame de apresentação mostrando os 5 arquivos em escala (16, 24, 48, 160 e
   512px) sobre papel #F4F3F0 e sobre tinta #14181B.

## Critérios de aceite (eu vou checar todos)
- [ ] Cada SVG abre com paths limpos: curvas/retas Bézier, sem raster, sem efeitos
      vivos de Figma no path (expand stroke quando fizer sentido).
- [ ] Um arquivo = uma cor, via fill/stroke literal.
- [ ] Teste da silhueta: preencher velas e casco 100% de preto e continua lendo
      como barco à vela.
- [ ] Em 16px, as duas velas continuam separadas (o vão entre elas na base, de
      x=70 a x=80 na grade 160, não pode fechar).
- [ ] Os vértices do glifo são EXATAMENTE os da referência — a evolução só acrescenta
      vinco e mar e calibra pesos; não redesenha o barco.
- [ ] Sem texto, sem letra, sem inicial (o nome comercial ainda não foi decidido).
- [ ] Traço de espessura constante por elemento, pontas sempre arredondadas.
```

---

## Versão em inglês (se o agente responder melhor em inglês)

```text
Design the LOGO SYMBOL (SVG, vector) for a Brazilian travel SaaS, evolving the mark
the product already uses today: a sailboat drawn in stroke — two triangular sails
and a hull line. This is not free creation: the reference geometry below is exact;
the vertices MUST NOT move. Deliver SVG files, not image mockups.

Concept — "Paper Sail": the travel proposal the product generates is a sheet of
paper; the folded sheet becomes the sail that sets off. Show this with two discreet
hairline additions: (1) the FOLD CREASE — a vertical line from the main sail's tip
to its base; (2) the SEA — two short, staggered lines below the hull, like a double
horizon. Personality: draftsman's instrument — paper, ink, engraving, technical
plate. NO gradients, shadows, gloss, 3D, multi-color, realistic rigging, dramatic
curved sails, or any text/letters.

Reference geometry (160×160 grid, all strokes, round caps/joins):
Existing glyph (unchanged):
- Main sail (right triangle): tip (80,25); base from (80,100) to (125,100).
- Fore sail (smaller triangle): tip (70,55); base from (35,100) to (70,100).
- Hull: horizontal line from (25,122.5) to (135,122.5).
Additions (hairlines):
- Fold crease: vertical line from (80,25) to (80,100).
- Sea: line (42,134)→(80,134) and line (56,143)→(98,143).

Stroke weights: master = main stroke 1.2 units on 160 (0.75% of viewBox width),
crease/sea hairlines 0.55 at 65% opacity, round caps and joins everywhere.
Small variant (16–24px) = glyph only (no crease, no sea), all strokes rebalanced
to 10 units on 160 (= 1px at 16px).

Monochrome: one color per file — ink #14181B on transparent, or paper #F4F3F0 on
the blue tile. Blue belongs to the tile, never to the drawing.

Deliverables: symbol-master.svg; symbol-small.svg; app-icon-512.svg (white #F4F3F0
sail on #12557F tile, corner radius 115, 25% safe margin); app-icon-inverse-512.svg
(#F4F3F0 tile, #14181B sail); favicon-16.svg (16×16 viewBox, final-scale coordinates,
stroke 1.5); plus a presentation frame at 16/24/48/160/512px on paper and ink.

Acceptance checks: clean paths, one color per file; solid-fill silhouette still
reads as a sailboat; at 16px the gap between the sails (x=70..80 on the 160 grid)
must not close; glyph vertices exactly as specified; no text/monogram (commercial
name not decided); constant stroke width per element; round caps everywhere.
```

---

## Checklist pós-geração (humano)

- Comparar o `symbol-small.svg` com o `Wordmark` do AppShell renderizado — tem de
  ser o mesmo glifo, só mais pesado.
- Favicon de 16px numa aba real do navegador, não só no zoom do Figma.
- Ícone de 512px na tela inicial do celular (install PWA ou atalho) antes de aprovar.
- Aprovação do PO registrada em `docs/MARCA.md` §13 antes de subir os usos no produto
  (trocar o SVG inline do `Wordmark` pelo arquivo, se for o caso).
