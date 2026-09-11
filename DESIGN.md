# Zarpa — DESIGN.md

## Theme
Híbrido com padrão system: `:root` claro, `[data-theme="dark"]` escuro (tokens.css). Papel claro de livro no light; tinta profunda no dark. O app mantém os DOIS tons de primeira classe (o PO exige prints nos dois).

## Palette
- Papel `--bg: #F4F3F0` (light) / tinta `--bg` escura (dark)
- Tinta `--ink: #14181B` (texto) · muted/subtle como gradações de tinta, nunca matiz
- Azul náutico `--accent: #12557F` — única cor de marca; diz APENAS onde se clica
- Fio `--line` / `--hairline` — contornos 1px, doutrina do traço constante
- Dinheiro/tom ok/warn/danger: estados, nunca decoração

## Typography
- Libre Franklin (display + texto, variável) — mantida por identidade (preservação vence lista de rejeição)
- Escala: 11/13/15/17/20/24/32 com `display` para títulos de página
- tabular-nums em TODO número; text-wrap balance em h1–h3

## Components
- Cards de papel com fio 1px (`--line`) — contorno, não sombra; camada flutuante usa sombra discreta
- Pranchas (`src/components/plates/`) — fios e molduras do sistema
- Sheets: bottom no celular, gaveta lateral no desktop
- Botão primário: `bg-accent text-on-accent` — o único azul cheio

## Layout
- App shell: lateral no desktop (seções expansíveis), barra inferior de 5 alvos no celular
- Fios como separadores internos; fio como cornija; régua 1 : 4 : 1 por card
