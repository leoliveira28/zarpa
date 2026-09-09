# Zarpa — SaaS de gestão para agentes de viagem independentes

> `zarpa` é codinome de trabalho. O nome comercial ainda não foi decidido — não espalhe a string pela UI, use o token `APP_NAME` em `src/lib/config.ts`.

## Produto em uma frase
O agente de viagem independente (MEI, home-based, 10–15 vendas/mês) monta uma **proposta de viagem com a marca dele em 2 minutos, do celular**, manda o link pelo WhatsApp, **sabe quando o cliente abriu**, e não perde a venda por esquecer o follow-up. Preço: **R$ 99/mês** (Solo R$ 49 / Pro R$ 99 / Studio R$ 199). Expansão de time mira agências de **2 a 4 pessoas** — não a agência estruturada de 5+, que já é terreno do Monde.

Concorrência: Monde (R$ 440/mês, agências estruturadas), Otoos (R$ 95,92/mês, ERP com NF-e), Turismo CRM (R$ 39,90/mês). O concorrente real é **planilha + WhatsApp + Canva**.

## Decisões travadas (não rediscutir)
| Tema | Decisão |
|---|---|
| Framework | Next.js 15 App Router, React 19, TypeScript **strict** |
| ORM | **Drizzle** (não Prisma — cold start em serverless) |
| Auth | **Better Auth** self-hospedado no próprio Postgres |
| Multi-tenant | **Um banco, RLS por `tenant_id`**. Nunca branch/DB por cliente |
| Estilo | Tailwind v4 + tokens em CSS custom properties |
| Componentes | **Radix Primitives + estilo próprio**. Proibido shadcn/ui inteiro ou qualquer lib com visual de template |
| Motion | `motion` (ex-Framer Motion), springs |
| Proposta | **Link web é o produto**. PDF é secundário (`@react-pdf/renderer` depois). Sem Chromium headless |
| Cobrança | Asaas (Pix + cartão recorrente + boleto) |
| Prioridade do roadmap (decisão do PO, 2026-09-09) | Multiusuário (equipe), faturamento PJ e centro de custo ENTRAM e vêm ANTES de integrações e NF-e — estas duas por último (ver `docs/ROADMAP_MONDE.md`). Motor de reservas e app nativo seguem fora |
| Mira do time (decisão do PO, 2026-09-09) | Multiusuário mira agências de **2 a 4 pessoas** — não competir de frente com agência estruturada de 5+ (ali o Monde tem o fosso de 95+ integrações de fornecedor). Assento extra **R$ 39,90/mês** em Pro e Studio, régua única, sem taxa de implementação. Arquitetura, modelo de dados e critério de aceite completos em `docs/MULTIUSUARIO_AGENCIAS.md` |

## Ambiente local (já pronto)
- Postgres 16 rodando. `DATABASE_URL=postgres://zarpa:zarpa@localhost:5432/zarpa_dev`
- Banco de teste: `zarpa_test`
- O role `zarpa` é **NOSUPERUSER / NOBYPASSRLS** de propósito. Se uma query só funciona como superuser, a policy está errada — conserte a policy, não o role.
- Não há Neon, Vercel, Asaas ou Resend provisionados ainda (sem credenciais). Escreva o código pronto para eles e deixe `.env.example` completo.

## Regras de engenharia
1. **RLS antes de feature.** Toda tabela com `tenant_id` nasce com `ENABLE ROW LEVEL SECURITY` e policy `USING`+`WITH CHECK`.
2. `set_config('app.tenant_id', $1, true)` é **local à transação** — toda query de tenant roda dentro de uma transação.
3. **Dados sensíveis** (CPF, passaporte, nascimento) = AES-256-GCM na aplicação, com `key_id` gravado junto do ciphertext. Nunca em log.
4. **Proposta pública** é lida sem login, via função `SECURITY DEFINER` que devolve só proposta/opções/blocos/marca. **Nunca** custo, comissão ou documento de passageiro.
5. TypeScript `strict`. Sem `any` sem comentário justificando.
6. Sem segredo no repositório. `.env.local` está no `.gitignore`.

## Regras de interface — direção "Papel e Pedra"

Direção aprovada: paleta reduzida com uma cor só, tipografia como imagem, ilustração
técnica e botânica em linha, proporção emprestada da arquitetura antiga.

### Os dois registros
O ornamento **não é distribuído por igual**. A agente abre o app quinze vezes por dia:
o que encanta na primeira visita irrita na quinquagésima.

| Superfície | Registro | O que herda |
|---|---|---|
| Miolo do app | Silencioso | Grid, fios, proporção, uma cor. Zero ilustração exceto estado vazio |
| Proposta pública | Editorial pleno | Tipografia como imagem, prancha, margem de livro, arco como divisor |
| Entrada e estados vazios | Intermediário | Uma prancha por tela, discreta |
| Marca e site | Editorial pleno | Tudo |

### Cor
Papel `#F4F3F0` (calor quase imperceptível — página de livro, não branco de tela).
Tinta `#14181B` com viés frio, como tinta de gravura. **Uma única cor de destaque**:
`#12557F`, azul de carta náutica, que serve para uma coisa só — dizer onde clicar.
Verde e âmbar são **estado**, não marca. Se o azul aparecer duas vezes na mesma tela,
uma delas está errada.

### Tipografia
- **NENHUMA SERIFA no sistema, em nenhuma superfície.**
- Display: **Libre Franklin** (`var(--stack-display)`, classe `.display`) — linhagem
  Franklin Gothic, 1902, letra de jornal e placa institucional. Só em título de página
  e capa de proposta. Nunca desce para rótulo, campo ou tabela.
- Interface: `system-ui`. Escala 13 / 15 / 17 / 20 / 32.
- O contraste de display vem de **peso**, nunca de itálico: 800 sobre 300.
- Display grande: `letter-spacing: -0.035em`, `line-height: 0.94`.
- **Todo valor financeiro**: `tabular-nums` + largura reservada. Número que muda de
  largura ao carregar é bug.

### Proporção e estrutura
Da arquitetura antiga vem a **proporção, não a pedra desenhada**. Base, fuste, capitel
viram a estrutura de todo card: cabeçalho curto, corpo alto, rodapé de ação curto, na
razão aproximada **1 : 4 : 1**. Uma ação em destaque no rodapé — havendo duas, a segunda
vira texto. Margem de página generosa como livro, não como dashboard.

**O fio horizontal é cornija: separa registros, não envolve caixas.** Card com borda nos
quatro lados é o oposto desta direção — use `<Rule />` de `@/components/plates`.

### Ilustração
`src/components/plates/` — `FernPlate` (estado vazio), `ArchPlate` (divisor de seção na
proposta), `CompassPlate` (marca e entrada). Traço único, sem preenchimento, monocromático
em `currentColor` sobre a classe `.plate`. **Nunca no accent.** No máximo uma prancha por
tela, a 12–16% de opacidade quando for fundo. Desenho original — nunca prancha histórica
escaneada.

### Movimento
Motion tipográfico é quase todo subtração.
- **Texto não voa.** Só opacidade e no máximo 4px de deslocamento (`.enter`, 180ms, uma
  vez por rota).
- **Nada de letra por letra.** Stagger tipográfico é o efeito que envelhece pior.
- **Nada animado no scroll.** A página em repouso já está inteira.
- Permitido: **número que rola** ao mudar de valor (300ms, `tabular-nums`, sem mudar de
  largura) — é o único movimento tipográfico expressivo do produto; e o **fio que se
  estende** (`.plate-rule--draw`, 240ms via `scaleX`).
- Springs de interação: padrão `{ bounce: 0, duration: 0.35 }`; sheet `{ bounce: 0.15,
  duration: 0.3 }`. Card arrastado herda a velocidade do gesto.
- Só `transform` e `opacity` animam. Reagir no `pointerdown`, não no `click`. Toda
  animação interrompível.
- **O teste:** tire toda a animação da tela. Se ela continuar comunicando a mesma coisa,
  o movimento está certo. Se algo ficar confuso, você usou movimento para consertar uma
  hierarquia que devia ter sido resolvida com tipografia e espaço.

### Demais regras
- Todo token existe no `:root` base. `@media (prefers-color-scheme: dark)` guardado como
  `:root:not([data-theme="light"])` e `:root[data-theme="dark"]` apenas **redefinem**.
  Nenhuma cor com definição única dentro de media query.
- Skeleton, nunca spinner. Estado vazio sempre com conteúdo de exemplo.
- Destrutivo = toast com desfazer de 8s, não modal "tem certeza?".
- Erro diz o que aconteceu E oferece a correção, com o botão junto.
- Salvamento automático com "Salvo" discreto. Sem botão Salvar grande.
- `prefers-reduced-motion` e `prefers-reduced-transparency` desde o primeiro componente.
- Mobile-first de verdade: a agente vive no celular. Teste em 390px.
- **Proibido:** qualquer serifa, itálico decorativo, gradiente roxo-azul, emoji como
  marcador de seção, `rounded-lg` em tudo, tudo centralizado, Inter ou Space Grotesk.

## Sprint atual: S1 + S2 (fundação e design system)
Critério de aceite S1: dois tenants no banco e um teste automatizado que tenta ler dado do outro tenant **retorna zero linhas**, rodando no CI.
Critério de aceite S2: rota `/kitchen-sink` com todos os componentes em todos os estados, verificada nos dois temas e com reduced-motion ligado.

Depois do que já está em andamento (S2 com a Nina, S3 com a Rafa — ver `docs/status/po.md`), a próxima frente é a Fase 3 do `docs/ROADMAP_MONDE.md` (multiusuário). Não começar essa frente sem ler `docs/MULTIUSUARIO_AGENCIAS.md` inteiro primeiro — tem decisão de arquitetura (Better Auth `organization`, não RLS de segundo nível) e uma pesquisa já feita na API do Asaas que evita retrabalho.
