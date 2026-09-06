# Funil — proposta de redesenho

Autora: Nina · Direção: Papel e Pedra · Estado: implementado (ver `docs/status/nina.md`)

## 1. O problema

A tela de funil hoje é um `overflow-x-auto` com `snap-x` e `gap-3` — **o padrão de
celular aplicado ao desktop**. Isso produz, em 1440px, cinco colunas de ~180px
espremidas dentro do `max-w-[64rem]` do shell, com metade da janela vazia dos dois
lados. É essa a causa da impressão de amadorismo, e não o acabamento dos cards.

Quatro sintomas, todos consequência da mesma decisão:

1. **A largura útil não é usada.** O shell trava em 64rem porque telas de leitura
   (Hoje, Propostas) pedem medida de linha curta. O funil não é texto: é uma
   comparação entre cinco conjuntos. Ele quer a janela inteira.
2. **A página inteira rola.** Rolar para ver o fim da coluna "Enviada" leva junto o
   cabeçalho e as outras quatro colunas. Num quadro de estágios, o que rola é a
   coluna; o quadro fica parado.
3. **O número que interessa não está lá.** O cabeçalho de coluna mostra a contagem
   ("3") e um valor somado em 13px cinza, do mesmo peso do resto. A pergunta que a
   agente faz ao abrir esta tela é "quanto tem em cada etapa" — a resposta tem que
   ser o segundo elemento mais forte da tela, depois do nome do estágio.
4. **O card não diz o suficiente e mesmo assim polui.** Cliente, destino e valor,
   sem data de viagem e sem há quantos dias está parado — e cada um dentro de uma
   caixa com borda nos quatro lados, dentro de outra caixa com borda nos quatro
   lados (a coluna). Duas violações da regra do fio empilhadas. É a moldura dentro
   da moldura que faz a tela parecer template.

## 2. Direções consideradas

### A. Lista agrupada por estágio (tabela com cabeçalho de grupo)

O funil vira uma tabela única, ordenável, com o estágio como cabeçalho de grupo:
cliente · destino · valor · viagem · parado há.

- **A favor:** densidade máxima, números em coluna alinhada, ótimo para triagem
  ("quem está parado há mais tempo?"), trivial de tornar responsiva.
- **Contra:** perde a leitura espacial que é o motivo de existir um funil — quanto
  cada etapa pesa, e onde o dinheiro empoça. E mata o arrasto: mover uma linha
  entre grupos de tabela é um gesto sem lugar no mundo.
- **Veredito:** descartada. Isto é a tela "Propostas", não o funil. Já existe.

### B. Grade de cinco colunas de altura cheia, na largura da janela

O quadro escapa do `max-w` do shell e ocupa a largura útil. Cinco colunas de altura
cheia, **cada uma com rolagem própria**, cabeçalho de coluna fixo com nome,
contagem e valor somado. No celular, continua sendo o scroller com encaixe.

- **A favor:** responde a pergunta da tela num olhar — cinco somas, mesma linha de
  base, alinhadas na mesma reserva de largura. Preserva o arrasto com transferência
  de velocidade. É a mesma tela em dois registros, não duas telas.
- **Contra:** abaixo de ~1280px as colunas apertam. Resolvido com largura mínima de
  coluna (12rem) e rolagem horizontal do quadro só quando ela é atingida — o
  aperto vira rolagem, e não vira coluna ilegível.
- **Veredito:** escolhida.

### C. Coluna em foco + trilhas condensadas

Uma coluna expandida por vez; as outras quatro viram trilhas estreitas com contagem
e soma, e expandem ao clique.

- **A favor:** resolve a largura em telas pequenas de desktop; cada card ganha muito
  espaço.
- **Contra:** esconde justamente o que a tela existe para mostrar. Ver as cinco
  etapas ao mesmo tempo **é** a funcionalidade. E introduz um modo (qual coluna
  está aberta) que a agente precisa gerenciar quinze vezes por dia.
- **Veredito:** descartada. É uma solução de layout para um problema de layout que
  a direção B resolve com largura mínima e rolagem.

## 3. A escolhida (B), em detalhe

### Largura e altura

- A rota `/funil` declara-se **larga**: o `AppShell` reconhece a rota e troca
  `mx-auto max-w-[64rem]` por largura total. É uma exceção nomeada num lugar só,
  não um `-mx-*` negativo espalhado pela tela.
- No desktop o shell passa a ter altura exata de viewport e o `<main>` não rola; quem
  rola é o corpo de cada coluna. No celular nada disso vale: a página rola como
  sempre, e o quadro é o scroller horizontal com encaixe.

### O fio, e o que ele separa

Regra que vale aqui inteira: **nada tem borda nos quatro lados.**

- **Coluna e coluna** se separam por espaço (goteira de 16px, 24px a partir de
  1280px). Sem fio vertical: a cornija é horizontal, e uma grade de fios verticais
  transformaria o quadro numa planilha.
- **Cabeçalho e corpo da coluna** se separam por um fio horizontal — a cornija na
  função exata dela.
- **Card e card** se separam por um fio interno (`Rule inner`) e por espaço. Um card
  parado é um registro numa lista de papel, não uma caixa.
- **Card arrastado** ganha papel: superfície, raio e sombra de arraste. A elevação
  aqui não é decoração — é a informação "isto saiu da pilha e está na sua mão".
  Solto, ele volta a ser registro.

### Cabeçalho de coluna

```
NOVO CONTATO                    2
R$ 33.455,00
────────────────────────────────── (fio)
```

Nome do estágio em 13px caixa alta com entreletra aberta (é rótulo, não título);
contagem em `tabular-nums` à direita; **valor somado em 17px, tinta cheia**, na
linha de baixo. As cinco somas usam a **mesma largura reservada** (`reserveFor` do
teto do quadro), então os cinco números nascem alinhados entre colunas — é o que
permite comparar as etapas sem ler, só olhando onde a mancha de dígitos começa.

### Densidade do card

Três linhas, hierarquia por peso e espaço:

```
Marina Albuquerque                    ⋯
Fernando de Noronha            6 nov
R$ 12.840,00              há 1 dia  ◦6
```

- **linha 1** — cliente, 15px, peso médio, tinta. É o que se procura.
- **linha 2** — destino (13px, cinza, trunca) e **data da viagem** (13px, tabular,
  não encolhe). Contexto.
- **linha 3** — **valor** (15px, tabular, tinta) e, à direita, **há quantos dias
  está parado** mais o sinal do produto: aberturas do link (chip de acento) ou
  parada crítica acima de 7 dias (chip âmbar). No máximo um chip por card — dois
  viram renda numa coluna de dez.

O menu de estágio (o caminho de teclado, que continua obrigatório) fica no canto
superior direito, revelado no hover e sempre presente em ponteiro grosso e no foco.

### Movimento

Nada de novo. O que já existia e fica: transferência de velocidade do gesto
(`projectThrow`), `springLayout` na reordenação, desfazer por toast de 8s. O que
entra: enquanto um card está no ar, a coluna sob a projeção do arremesso mostra o
papel dela e **engrossa o fio do cabeçalho para a cor de tinta**. Sem azul: o azul
diz onde clicar, e aqui não se clica — se solta. Sem borda tracejada, que é o
carimbo de protótipo.

## 4. O que fica de fora desta entrega

- Filtro e busca dentro do quadro (não pedido; entra quando o backend expuser
  leitura).
- Rolagem automática do quadro ao arrastar um card para a borda — só faz sentido
  quando houver mais colunas do que cabem, o que hoje não acontece.
- Virtualização das colunas: com 10 a 40 propostas por agente, não paga o custo.
