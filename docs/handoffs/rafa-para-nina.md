# Rafa → Nina

O que já existe do lado do servidor para você chamar, e as três coisas que mudam como o
componente é escrito.

## Como chamar

Tudo em `src/server/`. As funções são `'use server'` e devolvem **sempre** um
`ServiceResult`, nunca lançam:

```ts
import { listarContatos, criarContato } from '@/server';

const r = await listarContatos({ busca: 'marcos' });
if (!r.ok) {
  // r.mensagem  -> texto pronto, em português, para mostrar
  // r.correcao  -> o que oferecer no botão junto do erro ("Corrigir e salvar de novo")
  // r.campo     -> qual campo do formulário destacar, quando houver
  return;
}
r.data; // ContatoResumo[]
```

Isso é de propósito: uma Server Action que estoura vira *"An error occurred in the Server
Components render"* na tela, que não diz nada a ninguém. Aqui o erro é dado, e a mensagem
já vem escrita para caber na regra do CLAUDE.md ("erro diz o que aconteceu E oferece a
correção, com o botão junto").

Disponível hoje:

| função | devolve |
|---|---|
| `listarContatos({ busca?, limite? })` | `ContatoResumo[]` |
| `criarContato(input)` | `ContatoResumo` |
| `arquivarContato(id)` | `null` |
| `obterDocumentoDoViajante(id)` | `{ cpf, passaporte }` |
| `obterTenantAtual()` | `TenantAtual` (nome, plano, marca) |
| `atualizarMarca(input)` | `null` |

`obterTenantAtual()` é de onde saem `brandName`, `brandLogoUrl`, `brandPrimaryColor` e
`brandSecondaryColor` — a marca do agente, que manda na aparência da proposta pública.

## 1. Você nunca passa `tenantId`. Nenhuma função aceita.

O tenant sai da sessão, dentro do servidor. Se em algum momento parecer que você precisa
mandar o id do tenant como argumento, é bug meu — me chame em vez de contornar.

## 2. Dinheiro vem em centavos, como `number`

`valueCents: 4280000` é R$ 42.800,00. Nunca divida por 100 para guardar em estado; formate
só na hora de exibir. Combina com a regra de `tabular-nums` + largura reservada: o valor já
chega com precisão fixa, então a largura só depende do número de dígitos.

## 3. CPF e passaporte não vêm nas listagens. É intencional.

`ContatoResumo` tem `temDocumento: boolean`, não o documento. Para mostrar o documento de
verdade existe `obterDocumentoDoViajante(id)`, que é uma chamada separada **e grava em
`audit_log` quem viu o quê**. Então: só chame quando a pessoa pedir explicitamente (um
"mostrar documento"), não para preencher um card que talvez ninguém abra.

Se precisar exibir de forma parcial sem custo, tem `maskDocument` em `@/lib/crypto`
(`***8909`). Ela é síncrona e não toca no banco.

## Sobre estados vazios e skeleton

O seed cria dois tenants com dados de verdade (`npm run db:seed`, ver
`docs/handoffs/rafa-para-po.md` enquanto o script não existe): 2 contatos, 2 negócios e 1
proposta com 2–3 opções cada, e proposta já com 2 aberturas registradas. Serve para montar
lista, pipeline e o "seu cliente abriu a proposta" sem precisar inventar mock. Nomes são
reconhecíveis (`Volta ao Mundo` × `Maré Alta`) justamente para dar para ver, olhando a
tela, se algo de um tenant vazou no outro.

## O que **não** existe ainda e você vai sentir falta

- **Página pública da proposta.** Não implementei a leitura sem login no S1 (motivo em
  `docs/status/rafa.md`). Se `/p/[token]` estiver no seu escopo do S2, me avise que subo a
  função de leitura antes — ela precisa de um desenho específico por causa do RLS, não é só
  um `select`.
- **Serviços de deals / proposals / tasks.** Só contatos e tenant têm camada de serviço.
  O schema das outras está pronto; escrevo os serviços conforme a tela for chegando — me
  diga a ordem que ajuda mais.
- **Login com tela.** O Better Auth está configurado (magic link + senha) em
  `src/lib/auth/`, mas `src/app/api/auth/[...all]/route.ts` é `src/app/**`, que é seu. O
  handler é literalmente:

  ```ts
  import { auth } from '@/lib/auth';
  import { toNextJsHandler } from 'better-auth/next-js';
  export const { GET, POST } = toNextJsHandler(auth);
  ```

  Se preferir que eu escreva, é só falar com o PO para mover esse caminho para mim — não
  edito `src/app/**` por conta própria.
