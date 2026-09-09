/**
 * Auditoria de RLS pelo catálogo. Sem lista escrita à mão.
 *
 * Este é o teste que impede regressão silenciosa: tabela nova sem RLS não passa
 * despercebida, porque a varredura é do `pg_class`, não de um array que alguém
 * precisa lembrar de atualizar.
 */
import { discoverAllTables, discoverPolicies, type Sql } from '../helpers/db'

export type RlsFinding = {
  table: string
  rule:
    | 'enable'
    | 'force'
    | 'policy-exists'
    | 'policy-using'
    | 'policy-with-check'
    | 'policy-escape-hatch'
    | 'tenant-column'
  ok: boolean
  detail: string
}

/**
 * Portas de fuga aceitas — policies permissivas que, de propósito, não filtram
 * por tenant. Cada entrada aqui é uma decisão de risco tomada por alguém, não um
 * descuido. Acrescentar linha aqui deve doer um pouco e passar por review.
 *
 * `*_auth_service` existe porque o Better Auth precisa achar o usuário (e o
 * tenant dele) ANTES de existir contexto de tenant. Enquanto
 * `app.auth_context = 'on'` estiver ligado na conexão, `tenants` e `user` ficam
 * legíveis e graváveis entre tenants. O risco real não é a policy: é a GUC
 * sobreviver ao fim da requisição numa conexão de pool. Ver
 * docs/handoffs/teo-para-rafa.md.
 */
export const KNOWN_ESCAPE_HATCHES: { table: string; policy: string }[] = [
  { table: 'public.tenants', policy: 'tenants_auth_service' },
  { table: 'public.user', policy: 'user_auth_service' },
  // S7 — leitura pública da proposta (`drizzle/0004_proposta_publica.sql`). O GUC
  // `app.proposal_public_context` só liga DENTRO de `proposta_publica`/
  // `registrar_visita_proposta` (SECURITY DEFINER), nunca por nenhum outro caminho
  // do código. Mesma ressalva de sempre: o GUC é forjável por SQL arbitrário — o
  // alcance foi mantido às 4 tabelas de proposta, nunca contacts/travelers, e a
  // policy de leitura ainda exige status publicável mesmo com o GUC ligado. Ver
  // docs/handoffs/rafa-para-teo.md, seção S7.
  { table: 'public.proposals', policy: 'proposals_public_read' },
  { table: 'public.proposals', policy: 'proposals_public_view_update' },
  { table: 'public.proposals', policy: 'proposals_public_accept_update' },
  { table: 'public.proposal_options', policy: 'proposal_options_public_read' },
  { table: 'public.proposal_blocks', policy: 'proposal_blocks_public_read' },
  { table: 'public.proposal_views', policy: 'proposal_views_public_insert' },
  { table: 'public.proposal_views', policy: 'proposal_views_public_select' },
  // S14 — leitura pública do roteiro pós-venda (`drizzle/0013_roteiro_publico.sql`).
  // Mesmo desenho da proposta pública (0004): `roteiro_publica` (SECURITY DEFINER) liga
  // o GUC `app.roteiro_public_context` com `set_config(..., true)` local à transação e
  // em NENHUM outro lugar do código. GUC DE PROPOSTA não foi reusado de propósito —
  // um GUC de proposta não pode abrir tabela de roteiro; assim o alcance de cada escape
  // hatch segue auditável separadamente. A policy é FOR SELECT e a proteção de COLUNA
  // é a lista explícita dentro da função (o roteiro sai só de `itineraries`, nunca de
  // join com proposals/contacts/travelers); a de LINHA é o token. Mesma ressalva de
  // sempre: GUC é forjável por SQL arbitrário. Ver docs/handoffs/rafa-para-teo.md, §S14.1.
  { table: 'public.itineraries', policy: 'itineraries_public_read' },
  // S11 — webhook do Asaas (`drizzle/0010_webhook_context.sql`). O webhook chega
  // sem sessão; precisa resolver o `tenantId` pelo `asaasSubscriptionId` antes de
  // abrir `withTenant`. O GUC `app.webhook_context` só liga DENTRO de
  // `withWebhookContext` (`src/lib/tenant/withWebhookContext.ts`), local à
  // transação. Policy `FOR SELECT` — só leitura de `id`/`tenant_id`/`status` para
  // abrir contexto; a escrita (em `payments`/`subscriptions`) passa por
  // `withTenant` real depois. Mesma ressalva: GUC forjável por SQL arbitrário,
  // alcance mínimo. Ver docs/handoffs/teo-para-rafa.md.
  { table: 'public.subscriptions', policy: 'subscriptions_webhook_read' },
  // S3/S5 — acervo global da biblioteca (`drizzle/0003_construtor_de_proposta.sql`). O GUC
  // `app.platform_context` não é ligado por nenhum caminho do código hoje (sem tela de
  // administração no v1) — existe para o dia em que alguém precisar administrar o acervo
  // global sem rodar como superuser. Achada por revisão manual: o WITH CHECK desta policy
  // menciona `tenant_id` (`"tenant_id" IS NULL`), o que escondia do detector de string que
  // o USING de leitura/escrita de fato só depende do GUC + `is_global`, não do tenant da
  // sessão. Ver "ponto cego" abaixo.
  { table: 'public.library_items', policy: 'library_items_platform_service' },
  // S15 — dedupe do contador de visita (`drizzle/0014_visita_deduplicada.sql`). Mesmo GUC
  // `app.proposal_public_context` da família 0004/0005, novo comando (UPDATE) na mesma
  // tabela de `proposal_views`. Mesma ressalva de sempre.
  { table: 'public.proposal_views', policy: 'proposal_views_public_update' },
]

/**
 * GUCs que a aplicação liga para abrir um escape hatch deliberado. `app.tenant_id` NÃO
 * entra aqui — é o mecanismo normal de isolamento (toda policy de tenant o referencia), e
 * incluí-lo faria o detector abaixo nunca disparar.
 */
const KNOWN_CONTEXT_GUCS = [
  'app.auth_context',
  'app.platform_context',
  'app.proposal_public_context',
  'app.roteiro_public_context',
  'app.webhook_context',
]

/**
 * PONTO CEGO ENCONTRADO E FECHADO (registrado pela Rafa em docs/status/rafa.md, S15):
 * a varredura de "policy que ignora o tenant" original testava só
 * `!expr.includes('tenant_id') && !/\bid\b/.test(expr)` — ou seja, bastava a policy
 * mencionar a STRING `tenant_id` em QUALQUER lugar (inclusive dentro de um `EXISTS`
 * comparando tenant de duas tabelas, ou um `WITH CHECK` com `"tenant_id" IS NULL`) para
 * passar como "normal", mesmo que o `USING` de verdade só dependesse de um GUC de escape
 * (`current_setting('app.algo_context', true) = 'on'`) e nada mais. Foi assim que
 * `library_items_platform_service` (desde a 0003) e `proposal_views_public_update` (0014)
 * nunca precisaram de entrada no `KNOWN_ESCAPE_HATCHES` — o detector nem via que eram
 * escape hatches.
 *
 * A correção soma um segundo critério: qualquer policy cujo `USING`/`WITH CHECK` referencie
 * um `current_setting('app.<algo>_context', ...)` de `KNOWN_CONTEXT_GUCS` conta como
 * possível hatch, INDEPENDENTE de também mencionar `tenant_id` em outro trecho da mesma
 * expressão. O critério antigo (bare, sem tenant_id nem id) continua valendo em paralelo —
 * uma policy pega em QUALQUER um dos dois vira candidata, e só passa se estiver na
 * allowlist.
 */
function referenciaGucDeEscape(expr: string): boolean {
  return KNOWN_CONTEXT_GUCS.some((guc) => expr.includes(`current_setting('${guc}'`))
}

export type RlsAudit = {
  findings: RlsFinding[]
  tenantTables: string[]
  tablesWithoutTenantColumn: string[]
  currentUserOwnsTables: boolean
}

export async function runRlsAudit(sql: Sql): Promise<RlsAudit> {
  const all = await discoverAllTables(sql)
  const policies = await discoverPolicies(sql)

  const meta = await sql<
    { schema: string; name: string; enabled: boolean; forced: boolean; owner: string }[]
  >`
    select n.nspname as schema, c.relname as name,
           c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
           pg_get_userbyid(c.relowner) as owner
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname = 'public'
  `
  const metaByName = new Map(meta.map((m) => [`${m.schema}.${m.name}`, m]))

  const [{ who }] = await sql<{ who: string }[]>`select current_user as who`

  const findings: RlsFinding[] = []
  const tenantTables: string[] = []
  const tablesWithoutTenantColumn: string[] = []
  let currentUserOwnsTables = false

  for (const t of all) {
    if (!t.hasTenantColumn) {
      tablesWithoutTenantColumn.push(t.qualified)
      continue
    }
    tenantTables.push(t.qualified)

    const m = metaByName.get(t.qualified)
    const owned = m?.owner === who
    if (owned) currentUserOwnsTables = true

    findings.push({
      table: t.qualified,
      rule: 'enable',
      ok: m?.enabled === true,
      detail:
        m?.enabled === true
          ? 'relrowsecurity = true'
          : `tem coluna tenant_id e está SEM ROW LEVEL SECURITY. ` +
            `Falta: ALTER TABLE ${t.qualified} ENABLE ROW LEVEL SECURITY;`,
    })

    // O pulo do gato: o DONO da tabela ignora a policy mesmo sendo NOBYPASSRLS.
    // Como o role `zarpa` é dono do banco (e portanto das tabelas criadas pelas
    // migrations), ENABLE sozinho não protege nada em produção.
    findings.push({
      table: t.qualified,
      rule: 'force',
      ok: m?.forced === true,
      detail:
        m?.forced === true
          ? 'relforcerowsecurity = true'
          : `RLS não está FORÇADO. O dono da tabela (${m?.owner ?? '?'}) ignora a policy, ` +
            `e a aplicação conecta como ${who}${owned ? ' — que é o dono' : ''}. ` +
            `Falta: ALTER TABLE ${t.qualified} FORCE ROW LEVEL SECURITY;`,
    })

    const own = policies.filter((p) => p.table === t.qualified)
    findings.push({
      table: t.qualified,
      rule: 'policy-exists',
      ok: own.length > 0,
      detail:
        own.length > 0
          ? `${own.length} policy(ies): ${own.map((p) => `${p.policy}[${p.command}]`).join(', ')}`
          : 'RLS sem nenhuma policy: a tabela fica inacessível (nega tudo) em vez de isolada',
    })

    if (own.length > 0) {
      const readable = own.filter((p) => p.command === 'ALL' || p.command === 'SELECT')
      findings.push({
        table: t.qualified,
        rule: 'policy-using',
        ok: readable.some((p) => p.using !== null && p.using.includes('tenant_id')),
        detail: readable.some((p) => p.using !== null && p.using.includes('tenant_id'))
          ? 'policy de leitura filtra por tenant_id no USING'
          : `nenhuma policy de leitura tem USING referenciando tenant_id. USING atual: ` +
            `${readable.map((p) => p.using ?? 'null').join(' | ') || '<nenhuma>'}`,
      })

      // Atenção à semântica real do Postgres: numa policy FOR ALL (ou FOR UPDATE)
      // sem WITH CHECK, o USING vale TAMBÉM como WITH CHECK. Medido, não suposto —
      // ver scripts/check/mutation.ts. Exigir WITH CHECK explícito seria falso
      // positivo, e teste de segurança que grita à toa é teste que alguém desliga.
      const writable = own.filter((p) => ['ALL', 'INSERT', 'UPDATE'].includes(p.command))
      const checked = writable.filter((p) =>
        p.withCheck !== null
          ? p.withCheck.includes('tenant_id')
          : ['ALL', 'UPDATE'].includes(p.command) && (p.using?.includes('tenant_id') ?? false),
      )
      findings.push({
        table: t.qualified,
        rule: 'policy-with-check',
        ok: checked.length > 0,
        detail:
          checked.length > 0
            ? `escrita checada por tenant_id (${checked
                .map((p) => `${p.policy}${p.withCheck === null ? ' via USING' : ''}`)
                .join(', ')})`
            : `nenhuma policy de escrita amarra tenant_id — dá para gravar linha carimbada ` +
              `com tenant alheio. Policies de escrita: ` +
              `${writable.map((p) => `${p.policy}[${p.command}] check=${p.withCheck ?? 'null'} using=${p.using ?? 'null'}`).join(' | ') || '<nenhuma>'}`,
      })

      // Porta de fuga: policy PERMISSIVE que não fala de tenant nenhum entra por
      // OR e anula o isolamento enquanto a condição dela valer. Existem casos
      // legítimos (o serviço de auth precisa resolver o tenant do usuário ANTES
      // de haver contexto de tenant), então isto não reprova — mas fica fixado
      // na allowlist para que uma porta NOVA não apareça calada.
      const hatches = own.filter((p) => {
        const expr = `${p.using ?? ''} ${p.withCheck ?? ''}`
        const bare = !expr.includes('tenant_id') && !/\bid\b/.test(expr)
        return bare || referenciaGucDeEscape(expr)
      })
      const unexpected = hatches.filter(
        (p) => !KNOWN_ESCAPE_HATCHES.some((k) => k.table === t.qualified && k.policy === p.policy),
      )
      findings.push({
        table: t.qualified,
        rule: 'policy-escape-hatch',
        ok: unexpected.length === 0,
        detail:
          unexpected.length === 0
            ? hatches.length === 0
              ? 'nenhuma policy ignora o tenant'
              : `porta(s) de fuga conhecida(s) e fixada(s): ${hatches.map((p) => p.policy).join(', ')}`
            : `policy PERMISSIVE nova que ignora tenant_id: ` +
              `${unexpected.map((p) => `${p.policy}[${p.command}] using=${p.using ?? 'null'}`).join(' | ')}. ` +
              `Policies permissivas somam por OR: enquanto a condição dela for verdadeira, ` +
              `o isolamento desta tabela não existe. Se for intencional, registre em ` +
              `KNOWN_ESCAPE_HATCHES (tests/security/rls-checks.ts) para o próximo não descobrir de susto.`,
      })
    }
  }

  return { findings, tenantTables, tablesWithoutTenantColumn, currentUserOwnsTables }
}
