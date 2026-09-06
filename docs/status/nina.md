# Status — Nina (frontend / design system)

## Tarefa
Fechar o loop de autenticação: construir a tela de login e proteger o grupo `(app)`
para que ele pare de vazar `NÃO_AUTENTICADO` cru. Segui o contrato do `authClient` em
`docs/handoffs/rafa-para-nina.md` à risca — não adivinhei nenhum shape de dado.

## O que ficou pronto

### Rotas
- **`/entrar`** (`src/app/entrar/page.tsx` + `LoginScreen.tsx`) — fora do grupo `(app)`,
  então sem `AppShell`: registro "entrada/intermediário" do CLAUDE.md, não o miolo
  silencioso. Uma `CompassPlate` (a única prancha que pode aparecer sozinha) a 14% de
  opacidade, sangrando pelo canto superior direito, some em telas estreitas (`hidden
  sm:block`) — em 390px ela brigaria com o formulário por espaço, e o registro pede
  "discreta", não "presente a qualquer custo". Coluna ancorada à esquerda com margem de
  livro (`max-w-[26rem]`, `pt-14`/`pt-20`), não um card flutuante centralizado — decisão
  deliberada contra o "tudo centralizado" proibido no CLAUDE.md: um login de SaaS genérico
  é exatamente uma caixa branca no meio da tela.
- **`src/app/(app)/layout.tsx`** virou Server Component `async`: chama `getAuthContext()`
  (barril de servidor do Rafa) antes de montar o `AppShell` e manda para `/entrar` com
  `redirect()` se não houver sessão. Guard num lugar só — nenhuma tela-filha de `(app)`
  precisa checar sessão sozinha, e nenhuma delas mais mostra `NÃO_AUTENTICADO` cru.

### Formulário
- E-mail + senha (`authClient.signIn.email`) e link mágico (`authClient.signIn.magicLink`)
  como segunda via — trocam de lugar num toggle, nunca lado a lado (a mesma regra do
  rodapé de card: duas ações no mesmo peso viram indecisão, então a segunda é texto —
  reusei `CardAction` para isso).
- Erro com correção junto (`Field`/`FieldError` já prontos): senha errada destaca o campo
  de senha e oferece "Corrigir a senha" (foca o input); e-mail sem conta destaca o e-mail.
  Nunca "erro ao processar".
- Olho de mostrar/ocultar senha (`EyeIcon`/`EyeOffIcon`, já existiam em `app/icons.tsx`) —
  reage no `pointerdown`.
- Skeleton (nunca spinner) enquanto `useSession()` resolve OU quando já existe sessão e a
  tela está prestes a te tirar de lá — evita o flash de formulário que vai sumir.

### Loop fechado de verdade
- Adicionei "Sair" no `SideNav` do `AppShell` (`signOut()` do client + `router.push` +
  `router.refresh`). Sem isso a sessão só terminava apagando cookie na mão — não dava para
  testar o guard de ponta a ponta pela própria interface.

### `src/lib/ui/authErrors.ts` (novo)
Tradução pt-BR do erro do Better Auth. Testei `signIn.email` com senha errada direto no
handler e confirmei que o `code` real é `INVALID_EMAIL_OR_PASSWORD` — então o mapeamento
compara por `code` primeiro (estável) e só cai para `message.toLowerCase()` como rede de
segurança nos casos que ainda não confirmei (usuário inexistente no magic link, e-mail não
confirmado, limite de tentativas). Pedido aberto em `docs/handoffs/nina-para-rafa.md` para
o Rafa confirmar os `code`s que faltam.

## Decisões tomadas sozinha
- **Uma prancha só, e ela some no celular estreito.** A regra "no máximo uma prancha por
  tela" eu já esperava seguir; a parte que decidi sozinha foi escondê-la abaixo de `sm:` —
  390px é o alvo real (CLAUDE.md: "o agente vive no celular"), e um enfeite que rouba
  espaço do formulário na primeira tela que a pessoa vê é o oposto do que a direção pede.
- **Coluna ancorada à esquerda, não centralizada.** Ver acima — evitar a "cara de template
  gerado" de login boxado no centro da viewport. Também ajuda o teclado do celular: um
  layout centralizado verticalmente pula quando o teclado abre; um layout em fluxo normal
  (padding no topo, sem `justify-center`) não.
- **`router.push('/hoje')` manual depois de `signIn.email`, além do `callbackURL`.** O
  contrato documenta `callbackURL` como "para onde o Better Auth redireciona depois", mas
  a chamada de e-mail/senha é um `fetch` do client, não uma navegação de página — testei
  contra o handler e confirmei que ela não redireciona sozinha (só devolve JSON). Quem move
  a agente de tela é o router do Next. `callbackURL` continua sendo passado porque o
  contrato pede e ele importa de verdade no fluxo de magic link (ali é o servidor que
  redireciona de fato, confirmado testando `/magic-link/verify` — devolve `302` com
  `Location`).
- **"Sair" só no `SideNav` (desktop), não na barra inferior do celular.** A barra inferior
  já tem os 4 destinos no alvo de toque certo; enfiar um quinto item ali para uma ação rara
  (sair) competiria por espaço todo dia com uma ação que a agente usa uma vez a cada trinta.
  Testei o guard inteiro por `curl` (login, sessão, sign-out, redirecionamento), então a
  ausência de "Sair" no mobile não bloqueou a verificação — mas é uma lacuna real que
  registro aqui: alguém vai precisar de um jeito de sair pelo celular antes do S3 fechar.
- **Mapeamento de erro por `code`, não só por `message`.** Ver seção acima. Escolhi
  verificar isso na prática (`curl` contra o handler) em vez de assumir o texto do Better
  Auth, porque comparar substring de mensagem em inglês quebra silenciosamente na primeira
  atualização de dependência.
- **Sem "Criar conta" na tela.** `signUp.email` existe no client mas não tem
  `src/server/signup.ts` por trás (documentado pelo Rafa) — colocar o link levaria a uma
  tela que estoura. Fica para quando o Rafa priorizar.

## Verificação
- `npx tsc --noEmit` — limpo.
- `npx vitest run tests/design/guards.test.ts` — 6/6 verde (tipografia, cor em contexto,
  paridade de tema escuro, movimento só em `transform`/`opacity`, motion em JS com
  reduced-motion, corte de `prefers-reduced-motion`). Não usei `transition-colors` nem
  nenhum outro novo site fora de `transform`/`opacity` nos arquivos que criei.
- `npm run build` — limpo. `/entrar` sai estático; todo o grupo `(app)` virou dinâmico
  (`ƒ`), esperado — o guard lê `headers()` a cada request.
- **Teste manual de ponta a ponta, via `npm run dev` + `curl`** (o dev server já estava no
  ar em `:3000` de outra sessão; usei ele em vez de subir um segundo):
  - `GET /clientes` sem cookie → `307` para `/entrar`. ✅ (o "fechar o loop" pedido).
  - `POST /api/auth/sign-in/email` com `dev@zarpa.local` / `dev12345` → `200`, sessão
    criada (`set-cookie` de `session_token`/`session_data`), `user.tenantId` presente.
  - `GET /hoje` e `GET /clientes` com o cookie da sessão → `200` nos dois.
  - Senha errada → `401`, `{"code":"INVALID_EMAIL_OR_PASSWORD"}` — confirma o `code` que
    `authErrors.ts` compara.
  - `POST /api/auth/sign-in/magic-link` → `{"status":true}`, link caiu no log do servidor
    (`.next/dev/logs/next-development.log`), exatamente como o Rafa documentou (sem
    `RESEND_API_KEY`). Segui o link (`GET /api/auth/magic-link/verify?...`) → `302` para
    `/hoje` com sessão nova.
  - `POST /api/auth/sign-out` (com `Origin` e cookie jar corretos) → `{"success":true}`,
    cookies voltam com `Max-Age=0`; `GET /clientes` com esses cookies limpos → `307` para
    `/entrar` de novo.
  - Não abri um navegador de verdade para julgar o visual a olho (não tenho como dirigir
    um aqui) — a verificação de pixel/animação fica para quem revisar a tela ao vivo.

## Preciso dos outros
`docs/handoffs/nina-para-rafa.md`: pedido para trocar o mapeamento de erro de
`message.toLowerCase()` (frágil) para `error.code` (estável) nos casos que não testei
diretamente — usuário inexistente no magic link, e-mail não confirmado, limite de
tentativas. Não bloqueia nada, é robustez.

## Fora desta entrega
- **Cadastro público.** Depende de `src/server/signup.ts` (Rafa ainda não escreveu).
- **"Sair" acessível no celular.** Só existe no `SideNav` de desktop hoje — ver decisão
  acima.
- **Julgamento visual em navegador real.** Verifiquei o contrato HTTP inteiro por `curl`;
  a conferência de tipografia/espaçamento/movimento a olho, em 390px de verdade, fica para
  quem tiver um navegador para abrir.
