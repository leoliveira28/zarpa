# Zarpa — SaaS de gestão para agentes de viagem independentes

> `zarpa` é codinome de trabalho. O nome comercial ainda não foi decidido — não espalhe a string pela UI, use o token `APP_NAME` em `src/lib/config.ts`.

## Produto em uma frase
O agente de viagem independente (MEI, home-based, 10–15 vendas/mês) monta uma **proposta de viagem com a marca dele em 2 minutos, do celular**, manda o link pelo WhatsApp, **sabe quando o cliente abriu**, e não perde a venda por esquecer o follow-up. Preço: **R$ 99/mês** (Solo R$ 49 / Pro R$ 99 / Studio R$ 199).

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
| Fora do v1 | Integrações (Infotravel/Wooba/Despegar), NF-e, multiusuário real, motor de reservas, app nativo |

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

## Regras de interface (skill apple-design)
- **Tokens**: accent `#12557F`, ink `#0D1A24`, muted `#5A6B78`, paper `#F3F5F7`, ok `#2F7D57`, warn `#A8632A`. Neutros com viés frio. Tema claro E escuro via tokens no `:root` — nunca cor definida só dentro de `@media` ou `[data-theme]`.
- **Tipografia**: `system-ui` para toda a interface (familiaridade). Escala 13 / 15 / 17 / 20 / 32. Display `letter-spacing: -0.02em`, `line-height: 1.05`. Corpo `line-height: 1.5`.
- **Todo valor financeiro**: `font-variant-numeric: tabular-nums` + largura reservada. Número que muda de largura ao carregar é bug.
- **Springs**: padrão `{ type:'spring', bounce:0, duration:0.35 }`. Sheet/drawer `bounce:0.15, duration:0.3`. Card arrastado herda velocidade do gesto.
- **Só `transform` e `opacity` animam.** Nada mais.
- Reagir no `pointerdown`, não no `click`. Toda animação interrompível.
- **Skeleton, nunca spinner.** Estado vazio sempre com conteúdo de exemplo.
- Ação destrutiva = **toast com desfazer (8s)**, não modal "tem certeza?".
- Erro diz o que aconteceu E oferece a correção, com o botão junto.
- Salvamento automático com "Salvo" discreto. Sem botão Salvar grande.
- `prefers-reduced-motion` e `prefers-reduced-transparency` tratados desde o primeiro componente.
- **Proibido**: gradiente roxo-azul, emoji como marcador de seção, `rounded-lg` em tudo, tudo centralizado, Inter/Space Grotesk como "fonte segura".

## Sprint atual: S1 + S2 (fundação e design system)
Critério de aceite S1: dois tenants no banco e um teste automatizado que tenta ler dado do outro tenant **retorna zero linhas**, rodando no CI.
Critério de aceite S2: rota `/kitchen-sink` com todos os componentes em todos os estados, verificada nos dois temas e com reduced-motion ligado.
