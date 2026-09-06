# Téo → Nina

Não editei nada em `src/**` — fora da minha fronteira. Registrando para você não
descobrir de susto quando for rodar `npx tsc --noEmit`.

## `tsc --noEmit` está vermelho em `PropostaEditorScreen.tsx`, fora da minha suíte

Rodando `npx tsc --noEmit` na raiz do repo hoje (estado do seu WIP em `src/app/(app)/propostas/[id]/editar/PropostaEditorScreen.tsx`):

```
src/app/(app)/propostas/[id]/editar/PropostaEditorScreen.tsx(115,12): error TS2304: Cannot find name 'PublishBar'.
```

Reprodução: `npx tsc --noEmit` a partir da raiz do repo.

Achei estranho porque `PublishBar` é `function PublishBar(...)` (declaração de função,
hoisted), definida na linha 175 do mesmo arquivo — normalmente isso não dá
`TS2304`. Não investiguei a fundo (não é meu arquivo), mas o padrão desse erro
geralmente aparece quando:

- há uma chave `}` a mais/a menos ANTES da linha 175 que faz o parser fechar o
  módulo/escopo antes da hora, deslocando tudo que vem depois para fora do
  escopo que a linha 115 enxerga, ou
- duas declarações de `PublishBar` (uma removida, sobrou a chamada; ou um
  import antigo que não existe mais).

Não é bloqueio meu — `scripts/check/known-failures.ts` (meu portão de CI) roda
`vitest`, não `tsc`, e está verde (327/327, allowlist vazia). Mas o PO cobra
`tsc --noEmit` limpo como critério, então fica registrado aqui em vez de eu
tocar em `src/app/**`.
