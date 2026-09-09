# Rafa → Téo

> O handoff antigo foi para `docs/handoffs/old_nao_abrir/`. Este arquivo recomeça com o
> ponto de atenção da rodada de 2026-09-09 (assinatura do agente, migration 0017).

## 0017 — a chave nova no payload público e a SUA whitelist (1 ponto, sem portão vermelho)

`proposta_publica` (0004) e `roteiro_publica` (0013, `CREATE OR REPLACE` na
`drizzle/0017_assinatura_do_agente.sql`) passam a poder devolver
`brand.agentDisplayName` — a assinatura "Agência · por Agente" (helper:
`src/lib/assinatura.ts`; coluna: `tenants.agent_display_name`).

**Por que a SUA suíte ficou verde sem eu tocar nela:** a emissão é CONDICIONAL — a chave
só existe no payload quando o `brand_snapshot` tem assinatura. A fixture do
`tests/security/public-roteiro.test.ts` (`seedCenarioRoteiro` → `BRAND_SNAPSHOT_FIXTURE`)
não tem assinatura, então a whitelist exata de `Object.keys(payload.brand)` (linha ~142)
continua batendo **e continua valendo** para todo payload sem assinatura — que é o caso
de toda proposta/roteiro entregue antes de o agente configurar o nome (o payload deles
não mudou um byte).

O caso "COM assinatura" está fixado em `tests/brand/assinatura.test.ts` (arquivo NOVO,
12 casos): whitelist com `agentDisplayName` na lista, envio real congelando o snapshot,
fallback do `gerarRoteiro` para o cadastro do tenant, `atualizarMarca` gravando/limpando,
cross-tenant cego. Se você quiser o par na casa de security, os pontos seriam:

1. Fixar o caso "com assinatura" também na SUA whitelist (fixture com
   `agentDisplayName` no snapshot) — hoje só o meu teste o cobre.
2. `agentDisplayName` é dado de exibição e PÚBLICO por desenho (sai em `/p/`, `/r/` e no
   `?text=` do WhatsApp) — se o scanner um dia reclamar de nome de pessoa em `brand`, é
   allowlist de `brand.agentDisplayName`, mesmo tratamento de `brand.name`.
3. Auditoria do limite (conferida na rodada): as duas funções expõem EXATAMENTE
   name/logoUrl/primaryColor/secondaryColor/whatsappLink/instagram + agentDisplayName.
   Nenhuma tabela nova, nenhuma policy nova, NENHUM GUC novo — **nada a acrescentar em
   `KNOWN_ESCAPE_HATCHES`**.
