# Status — PO — fim do S1

## Verificado nesta máquina
```
[migrate] ok — 17 tabelas em public
[migrate] todas as tabelas com RLS habilitado e forçado
[seed] tenant A ... { contatos: 2, negocios: 2, propostas: 1, tenantsVisiveis: 1 }
[seed] tenant B ... { contatos: 2, negocios: 2, propostas: 1, tenantsVisiveis: 1 }

npx tsc --noEmit  -> limpo
npx vitest run    -> 103 passando, 4 falhando (todas propositais)
```

**Critério de aceite do S1: ATINGIDO.** Para cada tabela com `tenant_id`, conectado como o
role `zarpa` (NOBYPASSRLS) com `app.tenant_id` do tenant A: SELECT do B devolve zero linhas,
UPDATE e DELETE afetam zero linhas, INSERT com `tenant_id` do B não grava, e sem
`app.tenant_id` não vem nada (fail-closed).

## As 4 vermelhas, e por que continuam vermelhas
| Teste | Motivo |
|---|---|
| `public-proposal`: existe função SECURITY DEFINER | Não existe ainda. É trabalho do S7. Vermelho de propósito |
| `public-proposal`: search_path fixo | idem |
| `public-proposal`: nada sensível na resposta | idem — não dá para exercer sem a função |
| `pii`: a chave tem 32 bytes | `ENCRYPTION_KEY_V1` no `.env.local` é placeholder. Gere uma real: `openssl rand -base64 32` |

## Correções que o PO aplicou (fora da fronteira dos agentes)
- `package.json`: scripts `db:migrate`, `db:seed`, `test`, `typecheck` (pedido da Rafa em `docs/handoffs/rafa-para-po.md`)
- `@types/node` 20 -> 22 (vitest 5 exige), `tsconfig` target ES2017 -> ES2022
- `tests/security/rls-enabled.test.ts`: chave `}` órfã na linha 68 (diagnóstico da Rafa em `rafa-para-teo.md`)
- `tests/helpers/db.ts`: assinatura de `connect()`
- `vitest.config.ts`: `poolOptions` saiu do InlineConfig no vitest 5
- `src/components/ui/EmptyState.tsx`: `title` conflitando com `HTMLAttributes`

## Incompleto — o time foi interrompido
- **`src/app/(app)/kitchen-sink/KitchenSink.tsx` é um esqueleto meu**, não da Nina. Falta o
  critério de aceite do S2: todo componente em todos os estados, nos dois temas, com
  reduced-motion. Retomar com o agente `nina`.
- Nenhum dos três escreveu `docs/status/`. Este arquivo é do PO, não substitui.
- CI (`.github/workflows/ci.yml`) não foi escrito. Retomar com o agente `teo`.
- `scripts/check/all.sh` não existe (há `mutation.ts` e `security-probe.ts` soltos).

## Próximo passo
S2 com a Nina (design system + kitchen-sink) em paralelo com o Téo (CI + `scripts/check/all.sh`).
A Rafa está livre para começar o S3 (clientes, passageiros, importação de planilha).
