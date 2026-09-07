# Nina → Rafa

## 0. BLOQUEIO DE BUILD (urgente) — `src/server/deals.ts` quebra `npm run build`

Isto não é meu — não toquei em `src/server/**` — mas bloqueia a verificação
que o PO pede no fim de toda tarefa (`npm run build` limpo), então registro
aqui antes de mais nada. Reproduz na `main` de hoje, ANTES de qualquer edição
minha (confirmei com `git stash` + `npm run build`, depois `git stash pop`):

```
Error: Failed to collect configuration for /p/[slug]
  [cause]: Error: A "use server" file can only export async functions, found object.
      at module evaluation (src/server/deals.ts:714:1)
      at module evaluation (src/server/index.ts:142:1)
      at module evaluation (src/app/p/[slug]/page.tsx:53:1)
```

Causa: `deals.ts` tem `'use server'` no topo do arquivo (linha 1) e exporta
`COLUNAS_DO_FUNIL` como `const` — um array de objetos, não uma função. O
Next.js valida em BUILD (não em `tsc --noEmit`, que passa limpo — só apareceu
rodando `npm run build`) que todo export de um módulo `'use server'` seja
`async function`; qualquer outra coisa (const, type, objeto) quebra a
"Server Reference Manifest". `/p/[slug]/page.tsx` só quebra porque é a
primeira rota que a coleta de páginas do Next atravessa importando `@/server`
até `deals.ts` — mas o problema está no módulo, não naquela rota: qualquer
página que importasse `@/server` reproduziria.

`listarNegociosDoFunil`/`moverEstagioDoNegocio`/etc. (as seis actions, todas
`async function`) não têm problema nenhum — é só a constante.

Sugestão de correção (não fiz — é `src/server/**`, sua fronteira): mover
`COLUNAS_DO_FUNIL` (e o tipo `EstagioDeFunil`, se quiser deixar tudo junto)
para um arquivo SEM `'use server'` — por exemplo `src/server/dealsConstants.ts`
— e reexportar de lá em `deals.ts`/`index.ts`. Como é só um array de 5 objetos
literais sem lógica de servidor, não perde nada saindo do arquivo de actions.

Até isso ser corrigido, `npm run build` não fica limpo para ninguém que tocar
em `@/server` — reportei ao PO nas duas entregas do S4
(`FunnelScreen.tsx`/`TodayScreen.tsx`) que dependem exatamente de
`COLUNAS_DO_FUNIL`.

## 1. Falta a action de "aceitar opção" na proposta pública (S7)

Montei `/p/[slug]` (`src/app/p/[slug]/`) inteira em cima do contrato de
`docs/handoffs/rafa-para-nina.md`, mas não existe hoje nenhuma Server Action
para o cliente final "aceitar" uma opção sem login — só encontrei
`acceptedOptionId`/`acceptedAt` como colunas de LEITURA em `PropostaPublicaMeta`
e `proposals`, nunca uma escrita correspondente. Segui a instrução de não
inventar chamada de servidor: o botão principal de cada opção
(`OptionCard` em `PublicProposalScreen.tsx`) abre o WhatsApp do agente com uma
mensagem pronta ("Olá! Quero confirmar a opção [nome] da proposta [título] —
R$ [preço].") em vez de gravar nada no banco. Quando `accept.hei` que o link
`brand.whatsappLink` vem nulo (agente sem WhatsApp cadastrado), o cartão mostra
"Fale com quem te mandou esta proposta para confirmar" — sem botão morto.

Se/quando fizer sentido ter uma `aceitarOpcaoPublica(slug, optionId)` (sem
sessão, mesmo desenho de `registrarVisitaProposta` — provavelmente também
`SECURITY DEFINER`, gravando `accepted_option_id`/`accepted_at`/`status`
diretamente), eu troco o `<a href="wa.me/...">` por essa chamada mantendo o
WhatsApp como confirmação SECUNDÁRIA ("aceite, e depois confirme por
WhatsApp"), não como o único caminho.

## 2. `public.proposta_publica` no banco de dev estava desatualizada — já corrigi na minha sessão, mas verifique nos outros ambientes

Ao testar `/p/[slug]` de ponta a ponta (login, "Reenviar" numa proposta
seedada, abrir o link sem sessão), o campo `brand.whatsappLink` chegava
sempre `null` mesmo com `tenants.whatsapp` preenchido. Investigando: a
função `public.proposta_publica` que estava DE FATO instalada no meu
`zarpa_dev` fazia

```sql
'brand', (SELECT COALESCE(p.brand_snapshot, '{}'::jsonb) FROM proposals p WHERE p.id = v_proposal_id)
```

— ou seja, repassava `brand_snapshot` cru (com a chave `whatsapp`, número
puro), não o formato reshaped do arquivo atual de
`drizzle/0004_proposta_publica.sql` (que monta `whatsappLink` como
`https://wa.me/<dígitos>` e nunca deixa a chave `whatsapp` sair). O hash
gravado em `drizzle.__drizzle_migrations` para a migration `0004` não bate
com o hash do arquivo em disco hoje (`shasum -a 256` diferente) — isto é, o
arquivo foi editado DEPOIS de já ter sido aplicado neste banco, e
`drizzle-kit migrate` não reaplica migration já marcada como feita, mesmo
que o conteúdo tenha mudado. Não sei se isso aconteceu só no meu ambiente
local ou se é um problema de fluxo (editar migration já aplicada é sempre
arriscado — o caminho correto seria uma migration NOVA de `CREATE OR REPLACE
FUNCTION`, não editar a 0004 depois do fato).

O que fiz para poder testar (só no meu `zarpa_dev`, não toquei em nenhum
arquivo): rodei manualmente o `CREATE OR REPLACE FUNCTION` extraído de
`drizzle/0004_proposta_publica.sql` linhas 168–276 direto no Postgres do meu
ambiente, para sincronizar a função instalada com o que está no repositório.
Depois disso `brand.whatsappLink` passou a vir `https://wa.me/5511987650001`
corretamente e o resto da tela (accept link por opção, atalho de WhatsApp no
topo) passou a renderizar.

Ação sugerida: confirme se isso é só uma cicatriz do meu ambiente (banco
criado antes da última edição do arquivo 0004) ou se existe em outros
lugares — e considere se vale a pena um script/lembrete de "toda vez que
editar uma migration já commitada, rode `db:reset` local" para quem pegar
essa pasta depois.

## 3. Ainda em aberto de uma rodada anterior: falta `listarNegocios()`

Este item já estava pedido antes e continua valendo — reproduzo aqui porque
reescrevi este arquivo do zero para o assunto do S7 e não quero que ele se
perca: `criarPropostaAPartirDoNegocio({ dealId, title? })` pede um `dealId`
que já existe, mas não há hoje nenhum serviço que LISTE negócios do tenant
para um seletor por nome (`listarPropostas` só devolve negócio de proposta já
criada). Resolvi com um campo "Cole o ID do negócio" na Sheet de criação
(`src/app/(app)/propostas/PropostasScreen.tsx`, `NovaPropostaSheet`) — funciona
de ponta a ponta, mas é um provisório, documentado na tela com uma
`FieldHint`. Pedido: um `listarNegocios()` (`NegocioResumo[]` com pelo menos
`id`, `title`, `destination`, `contactName`, `currency`) destrava trocar o
campo de texto por um `Combobox` de verdade.

(O bloqueio de build em `src/server/storage.ts`/`@vercel/blob` que estava
registrado aqui antes já não reproduz — `npm run build` está limpo nesta
sessão, incluindo `/p/[slug]`. Não sei se foi você ou o PO quem resolveu, só
registro que sumiu.)

## O que ENTREGUEI (contexto, não pedido)

- `/p/[slug]` pública, fora do grupo `(app)`, sem AppShell/auth — server
  component (`page.tsx`) + client (`PublicProposalScreen.tsx`) +
  `not-found.tsx` elegante (mesmo tratamento para slug errado e proposta não
  publicável, como o contrato pede).
- Beacon de abertura com `registrarVisitaProposta`: uma chamada no mount
  (sem `durationSeconds`) e outra no `visibilitychange`/`pagehide` (com
  duração e `focusedOptionId`, via `IntersectionObserver` nas opções).
  `sessionKey` gerado com `crypto.randomUUID()` e guardado em
  `sessionStorage`. Testei com Playwright de verdade (não só curl) e confirmei
  linhas novas em `proposal_views` com `duration_ms`/`focused_option_id`
  batendo com o tempo real da aba aberta.
- Adicionei um botão "Enviar proposta"/"Reenviar"/"Copiar link" no editor
  (`PropostaEditorScreen.tsx`, dentro da minha fronteira) chamando
  `enviarProposta` — S7 tinha a action pronta do seu lado mas nada no editor
  ainda ligava nela.

Detalhes de decisão de design em `docs/status/nina.md`.
