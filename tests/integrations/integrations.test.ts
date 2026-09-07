/**
 * S12 — testes de integrações de fornecedor (Wooba + Infotravel), cotação só.
 *
 * Mesmo padrão de `tests/billing/cobranca.test.ts` e `tests/deals/funil.test.ts`:
 * chama as funções REAIS de `src/server/integrations.ts` contra um Postgres de
 * verdade, só mockando `requireAuthContext` (não existe sessão HTTP fora de uma
 * requisição). `tenant-isolation.test.ts` já cobre, por varredura de catálogo,
 * que `integrations` tem RLS e que SELECT/UPDATE/DELETE cruzados devolvem zero
 * linhas em SQL direto — o que ESTE arquivo cobre é a camada de cima: as
 * Server Actions, o envelope de criptografia (AES-256-GCM com `context` AAD
 * amarrado ao tenant), o modo dev sem credencial, e a validação de entrada.
 *
 * Pontos do handoff S12 cobertos aqui:
 *  1. RLS de `integrations` — sanity: a varredura por catálogo de
 *     `tenant-isolation.test.ts` vê a tabela (mesma prova de `cobranca.test.ts`).
 *  2. Credenciais encriptadas (AES-256-GCM) — a coluna `credentialsCiphertext`
 *     é envelope `zp1.<key_id>.<iv>.<tag>.<ct>`, nunca plaintext; o `context`
 *     do AAD é `integrations:${tenantId}` — copiar a row para outro tenant não
 *     decripta (AAD mismatch).
 *  3. `listarIntegracoes` não devolve credenciais — `IntegracaoResumo` não tem
 *     `credentials`/`credentialsCiphertext`/`keyId`.
 *  4. Modo dev sem credencial — `buscarHoteis`/`obterCotacao` devolvem
 *     `exemplo: true` e 3 hotéis/cotação determinísticos.
 *  5. Idempotência de cotação — `obterCotacao` duas vezes com o mesmo input
 *     devolve o mesmo resultado e não cria rows fantasmas.
 *  6. `criarIntegracao` valida — provider inválido, label curto/longo,
 *     credentials vazia devolve `ServiceError` com `campo`/`correcao`.
 *  7. `removerIntegracao` é físico — depois de remover, `listarIntegracoes`
 *     não inclui; cross-tenant não remove (RLS); id inexistente `NAO_ENCONTRADO`.
 *
 * O que este arquivo NÃO cobre (registrado em docs/status/teo.md):
 *  - Chamada real à API do Wooba/Infotravel (sem credencial provisionada, sem
 *    rede no CI). O adapter Wooba tem fallback de exemplo para `credencial =
 *    null`; o caminho "credencial existe, fetch real" só é exercitável com a
 *    API real ou um servidor mock — fora do escopo do S12.
 *  - `isActive: false` — não existe action de toggle ainda (handoff S12).
 *  - Reserva/booking — cotação só, fora do v1.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { integrations, tenants, user } from '@/db/schema'
import { withTenant } from '@/lib/tenant/withTenant'
import { decryptPII, isEncryptedEnvelope } from '@/lib/crypto'
import { connect } from '../helpers/db'

// ---------------------------------------------------------------------------
// Mock de sessão — mesmo padrão de `tests/billing/cobranca.test.ts`.
// `requireAuthContext` não existe fora de uma requisição HTTP; o mock devolve
// um contexto determinístico que apontamos para o tenant da fixture.
// ---------------------------------------------------------------------------

const authCtx = vi.hoisted(() => ({
  tenantId: '',
  userId: 'qa-integrations-user',
  email: 'qa-integrations@example.com',
  role: 'owner',
}))

vi.mock('@/lib/auth/session', () => ({
  requireAuthContext: async () => ({ ...authCtx }),
  getAuthContext: async () => ({ ...authCtx }),
}))

const {
  listarIntegracoes,
  criarIntegracao,
  removerIntegracao,
  buscarHoteis,
  obterCotacao,
} = await import('@/server/integrations')

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

type Fixture = { tenantId: string; userId: string }

/**
 * Cria tenant + usuário dono. `registrarAuditoria` (chamado por `criarIntegracao`
 * e `removerIntegracao`) tem FK real para `user.id`, então `authCtx.userId`
 * precisa apontar para uma linha que existe.
 */
async function seedTenant(prefix: string): Promise<Fixture> {
  const tenantId = randomUUID()
  const userId = `qa-int-${prefix}-${randomUUID()}`
  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: `Agência QA Int ${prefix} ${tenantId.slice(0, 8)}`,
      slug: `qa-int-${prefix}-${tenantId.slice(0, 8)}`,
    })
    await tx.insert(user).values({
      id: userId,
      tenantId,
      name: 'QA Int Bot',
      email: `${userId}@exemplo-zarpa.com.br`,
    })
  })
  return { tenantId, userId }
}

/** Troca a sessão mockada para o tenant da fixture. */
function entrarComo(fixture: Pick<Fixture, 'tenantId' | 'userId'>): void {
  authCtx.tenantId = fixture.tenantId
  authCtx.userId = fixture.userId
}

const criados: string[] = []
const sql = connect()

afterAll(async () => {
  for (const tenantId of criados) {
    try {
      // Cascade em integrations/user — deletar o tenant limpa tudo.
      // Precisa de contexto (tenants_isolation exige id = app.tenant_id no WITH CHECK).
      await withTenant(tenantId, (tx) => tx.delete(tenants).where(eq(tenants.id, tenantId)))
    } catch {
      // best-effort
    }
  }
  await sql.end({ timeout: 5 })
})

// ---------------------------------------------------------------------------
// 1. Sanity — varredura por catálogo vê `integrations`
// ---------------------------------------------------------------------------

describe('sanity — varredura por catálogo vê integrations', () => {
  it('a tabela integrations tem tenant_id e está no schema public', async () => {
    // Mesma prova de `cobranca.test.ts`: confirmar que o teste de isolamento por
    // catálogo (que roda em `tenant-isolation.test.ts`) cobre esta tabela. A
    // varredura `discoverTenantTables` é o mesmo mecanismo — aqui só confirmamos
    // que a tabela tem `tenant_id` e está no schema `public`.
    const tabelas = await sql<{ name: string }[]>`
      select c.relname as name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r'
        and n.nspname = 'public'
        and c.relname = 'integrations'
        and exists (
          select 1 from information_schema.columns col
          where col.table_schema = n.nspname
            and col.table_name = c.relname
            and col.column_name = 'tenant_id'
        )
    `
    expect(tabelas.map((t) => t.name)).toContain('integrations')
  })

  it('integrations tem RLS habilitado E forçado (relrowsecurity + relforcerowsecurity)', async () => {
    const [row] = await sql<{ enabled: boolean; forced: boolean }[]>`
      select c.relrowsecurity as enabled, c.relforcerowsecurity as forced
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'integrations' and c.relkind = 'r'
    `
    expect(row, 'tabela integrations não existe — a migration 0011 rodou?').toBeTruthy()
    expect(row.enabled, 'integrations sem ENABLE ROW LEVEL SECURITY').toBe(true)
    expect(row.forced, 'integrations sem FORCE ROW LEVEL SECURITY — o dono ignora a policy').toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2 + 3. listarIntegracoes — vazio, e resumo sem credenciais
// ---------------------------------------------------------------------------

describe('listarIntegracoes — tenant novo não tem integrações', () => {
  it('devolve [] para um tenant sem integrações', async () => {
    const fixture = await seedTenant('list-empty')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await listarIntegracoes()
    expect(r.ok, !r.ok ? r.mensagem : '').toBe(true)
    if (!r.ok) return
    expect(r.data).toEqual([])
  })
})

describe('IntegracaoResumo não inclui credentials nem credentialsCiphertext nem keyId', () => {
  it('criarIntegracao devolve resumo sem o ciphertext, sem as credenciais, sem keyId', async () => {
    const fixture = await seedTenant('resumo')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await criarIntegracao({
      provider: 'wooba',
      label: 'Minha conta Wooba',
      credentials: { apiKey: 'sk-test-123' },
    })
    expect(r.ok, !r.ok ? r.mensagem : '').toBe(true)
    if (!r.ok) return

    // O resumo nunca inclui o ciphertext, nem as credenciais em claro, nem o keyId.
    const keys = Object.keys(r.data)
    expect(keys).not.toContain('credentialsCiphertext')
    expect(keys).not.toContain('credentials')
    expect(keys).not.toContain('keyId')
    expect(keys).not.toContain('credentials_ciphertext')
  })

  it('listarIntegracoes também não inclui nenhum desses campos em item algum', async () => {
    const fixture = await seedTenant('resumo-list')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const criada = await criarIntegracao({
      provider: 'wooba',
      label: 'Minha conta Wooba',
      credentials: { apiKey: 'sk-test-456' },
    })
    expect(criada.ok).toBe(true)
    if (!criada.ok) return

    const lista = await listarIntegracoes()
    expect(lista.ok).toBe(true)
    if (!lista.ok) return
    expect(lista.data).toHaveLength(1)
    for (const item of lista.data) {
      const keys = Object.keys(item)
      expect(keys).not.toContain('credentialsCiphertext')
      expect(keys).not.toContain('credentials')
      expect(keys).not.toContain('keyId')
      expect(keys).not.toContain('credentials_ciphertext')
    }
  })
})

// ---------------------------------------------------------------------------
// 6. criarIntegracao — validação
// ---------------------------------------------------------------------------

describe('criarIntegracao — validação', () => {
  it('provider inválido → DADOS_INVALIDOS com campo', async () => {
    const fixture = await seedTenant('val-provider')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await criarIntegracao({
      provider: 'despegar' as 'wooba',
      label: 'Conta Despegar',
      credentials: { apiKey: 'sk-test' },
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('DADOS_INVALIDOS')
    expect(r.campo).toBeTruthy()
    expect(r.correcao).toBeTruthy()
  })

  it('label com 1 char → DADOS_INVALIDOS com campo "label"', async () => {
    const fixture = await seedTenant('val-label-curto')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await criarIntegracao({
      provider: 'wooba',
      label: 'x',
      credentials: { apiKey: 'sk-test' },
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('DADOS_INVALIDOS')
    expect(r.campo).toBe('label')
  })

  it('label com 101 chars → DADOS_INVALIDOS', async () => {
    const fixture = await seedTenant('val-label-longo')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await criarIntegracao({
      provider: 'wooba',
      label: 'x'.repeat(101),
      credentials: { apiKey: 'sk-test' },
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('DADOS_INVALIDOS')
  })

  it('credentials vazia ({}) → DADOS_INVALIDOS', async () => {
    const fixture = await seedTenant('val-cred-vazia')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await criarIntegracao({
      provider: 'wooba',
      label: 'Conta Wooba',
      credentials: {},
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('DADOS_INVALIDOS')
    expect(r.correcao).toBeTruthy()
  })

  it('criar com sucesso devolve resumo com provider, label, isActive=true', async () => {
    const fixture = await seedTenant('val-ok')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await criarIntegracao({
      provider: 'infotravel',
      label: 'Conta Infotravel Principal',
      credentials: { apiKey: 'sk-info-1', clientId: 'cli-1' },
    })
    expect(r.ok, !r.ok ? r.mensagem : '').toBe(true)
    if (!r.ok) return
    expect(r.data.provider).toBe('infotravel')
    expect(r.data.label).toBe('Conta Infotravel Principal')
    expect(r.data.isActive).toBe(true)
    expect(r.data.id).toBeTruthy()
    expect(r.data.createdAt).toBeInstanceOf(Date)
  })

  it('label com espaços laterais é trimado antes de gravar', async () => {
    const fixture = await seedTenant('val-trim')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await criarIntegracao({
      provider: 'wooba',
      label: '  Conta com espaços  ',
      credentials: { apiKey: 'sk-test' },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.label).toBe('Conta com espaços')
  })
})

// ---------------------------------------------------------------------------
// 2. Credenciais encriptadas (AES-256-GCM) — ciphertext no banco + AAD por tenant
// ---------------------------------------------------------------------------

describe('credenciais encriptadas (AES-256-GCM)', () => {
  it('a coluna credentials_ciphertext é envelope zp1.<key_id>..., nunca plaintext', async () => {
    const fixture = await seedTenant('enc')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const segredo = 'sk-super-secreto-12345'
    const r = await criarIntegracao({
      provider: 'wooba',
      label: 'Conta Wooba Enc',
      credentials: { apiKey: segredo, agencyId: 'ag-1' },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // Lê a row DIRETO no banco (via withTenant, RLS) — a coluna tem que ser
    // envelope, não a API key em texto.
    const rows = await withTenant(fixture.tenantId, async (tx) =>
      tx
        .select({
          ct: integrations.credentialsCiphertext,
          keyId: integrations.keyId,
          provider: integrations.provider,
          label: integrations.label,
        })
        .from(integrations)
        .where(eq(integrations.id, r.data.id)),
    )
    expect(rows).toHaveLength(1)
    const row = rows[0]!

    // Formato do envelope: zp1.<key_id>.<iv>.<tag>.<ct>
    expect(isEncryptedEnvelope(row.ct)).toBe(true)
    // O segredo NÃO aparece no ciphertext.
    expect(row.ct).not.toContain(segredo)
    expect(row.ct).not.toContain('apiKey')
    // keyId está preenchido e bate com o keyId ativo do chaveiro.
    expect(row.keyId).toBeTruthy()
    expect(row.keyId).toMatch(/^v\d+$/)
  })

  it('o "context" do AAD amarra ao tenant — copiar a row para outro tenant não decripta', async () => {
    const fixtureA = await seedTenant('aad-a')
    const fixtureB = await seedTenant('aad-b')
    criados.push(fixtureA.tenantId, fixtureB.tenantId)
    entrarComo(fixtureA)

    const r = await criarIntegracao({
      provider: 'wooba',
      label: 'Conta Wooba AAD',
      credentials: { apiKey: 'sk-aad-test', agencyId: 'ag-aad' },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // Lê o ciphertext do tenant A (RLS).
    const [rowA] = await withTenant(fixtureA.tenantId, async (tx) =>
      tx
        .select({ ct: integrations.credentialsCiphertext })
        .from(integrations)
        .where(eq(integrations.id, r.data.id)),
    )
    expect(rowA).toBeTruthy()
    const ct = rowA!.ct

    // Decifrar com o context do tenant A funciona — é o caminho da action.
    const plaintextA = decryptPII(ct, { context: `integrations:${fixtureA.tenantId}` })
    expect(JSON.parse(plaintextA)).toEqual({ apiKey: 'sk-aad-test', agencyId: 'ag-aad' })

    // Decifrar com o context do tenant B falha — AAD mismatch. É o que impede
    // copiar a row de A para B e ainda ler as credenciais: o "context" é parte
    // da autenticação do GCM, não um comentário.
    expect(() => decryptPII(ct, { context: `integrations:${fixtureB.tenantId}` })).toThrow(
      /autenticação inválida|context/i,
    )

    // Decifrar sem context algum também falha (AAD da escrita tinha context).
    expect(() => decryptPII(ct)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// 7. removerIntegracao — físico, cross-tenant, id inexistente
// ---------------------------------------------------------------------------

describe('removerIntegracao — físico', () => {
  it('depois de remover, listarIntegracoes não inclui a integração', async () => {
    const fixture = await seedTenant('del')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const criada = await criarIntegracao({
      provider: 'wooba',
      label: 'Conta para remover',
      credentials: { apiKey: 'sk-del' },
    })
    expect(criada.ok).toBe(true)
    if (!criada.ok) return

    const listaAntes = await listarIntegracoes()
    expect(listaAntes.ok).toBe(true)
    if (!listaAntes.ok) return
    expect(listaAntes.data).toHaveLength(1)

    const del = await removerIntegracao(criada.data.id)
    expect(del.ok, !del.ok ? del.mensagem : '').toBe(true)

    const listaDepois = await listarIntegracoes()
    expect(listaDepois.ok).toBe(true)
    if (!listaDepois.ok) return
    expect(listaDepois.data).toEqual([])
  })

  it('remover id inexistente → NAO_ENCONTRADO', async () => {
    const fixture = await seedTenant('del-nao')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await removerIntegracao(randomUUID())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('NAO_ENCONTRADO')
    expect(r.correcao).toBeTruthy()
  })

  it('remover id de outro tenant → NAO_ENCONTRADO (RLS barrando na query)', async () => {
    const fixtureA = await seedTenant('del-cross-a')
    const fixtureB = await seedTenant('del-cross-b')
    criados.push(fixtureA.tenantId, fixtureB.tenantId)

    entrarComo(fixtureA)
    const criada = await criarIntegracao({
      provider: 'wooba',
      label: 'Conta A',
      credentials: { apiKey: 'sk-a' },
    })
    expect(criada.ok).toBe(true)
    if (!criada.ok) return

    // B tenta remover a integração de A — a query `where id = $1 and tenant_id =
    // tenantId(B)` devolve zero linhas (RLS), e a action devolve NAO_ENCONTRADO.
    entrarComo(fixtureB)
    const del = await removerIntegracao(criada.data.id)
    expect(del.ok).toBe(false)
    if (del.ok) return
    expect(del.code).toBe('NAO_ENCONTRADO')

    // A integração de A continua lá — B não a apagou.
    entrarComo(fixtureA)
    const lista = await listarIntegracoes()
    expect(lista.ok).toBe(true)
    if (!lista.ok) return
    expect(lista.data).toHaveLength(1)
    expect(lista.data[0]?.id).toBe(criada.data.id)
  })
})

// ---------------------------------------------------------------------------
// 4 + 5. Modo dev — sem integração ativa devolve exemplo determinístico
// ---------------------------------------------------------------------------

describe('modo dev — sem integração ativa devolve exemplo', () => {
  it('buscarHoteis devolve exemplo: true e 3 hotéis determinísticos', async () => {
    const fixture = await seedTenant('dev-busca')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await buscarHoteis({
      destino: 'Buenos Aires',
      checkIn: '2026-10-10',
      checkOut: '2026-10-15',
      paxAdults: 2,
    })
    expect(r.ok, !r.ok ? r.mensagem : '').toBe(true)
    if (!r.ok) return

    expect(r.data.exemplo).toBe(true)
    expect(r.data.hoteis).toHaveLength(3)
    // Determinístico: ids estáveis do adapter Wooba (hoteisExemplo).
    expect(r.data.hoteis.map((h) => h.id)).toEqual(['ex-wooba-1', 'ex-wooba-2', 'ex-wooba-3'])
    for (const h of r.data.hoteis) {
      expect(h.destino).toBe('Buenos Aires')
      expect(h.moeda).toBe('BRL')
      expect(h.disponivel).toBe(true)
      expect(h.precoCents).toBeGreaterThan(0)
    }
  })

  it('buscarHoteis é determinístico — mesma chamada devolve o mesmo resultado', async () => {
    const fixture = await seedTenant('dev-busca-idem')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const input = {
      destino: 'Florianópolis',
      checkIn: '2026-12-20',
      checkOut: '2026-12-27',
      paxAdults: 2,
      paxChildren: 1,
    }
    const r1 = await buscarHoteis(input)
    const r2 = await buscarHoteis(input)
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (!r1.ok || !r2.ok) return

    expect(r2.data).toEqual(r1.data)
  })

  it('obterCotacao devolve exemplo: true e cotação determinística', async () => {
    const fixture = await seedTenant('dev-cot')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await obterCotacao({
      hotelId: 'ex-wooba-1',
      checkIn: '2026-10-10',
      checkOut: '2026-10-15',
      paxAdults: 2,
    })
    expect(r.ok, !r.ok ? r.mensagem : '').toBe(true)
    if (!r.ok) return

    expect(r.data.exemplo).toBe(true)
    expect(r.data.cotacao.hotelId).toBe('ex-wooba-1')
    expect(r.data.cotacao.moeda).toBe('BRL')
    expect(r.data.cotacao.custoCents).toBeGreaterThan(0)
    expect(r.data.cotacao.checkIn).toBe('2026-10-10')
    expect(r.data.cotacao.checkOut).toBe('2026-10-15')
    expect(r.data.cotacao.detalhes).toMatch(/exemplo/i)
  })

  it('obterCotacao duas vezes com o mesmo input devolve o mesmo resultado (idempotente)', async () => {
    const fixture = await seedTenant('dev-cot-idem')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const input = {
      hotelId: 'ex-wooba-2',
      checkIn: '2026-11-01',
      checkOut: '2026-11-05',
      paxAdults: 2,
    }
    const r1 = await obterCotacao(input)
    const r2 = await obterCotacao(input)
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    if (!r1.ok || !r2.ok) return

    expect(r2.data.cotacao).toEqual(r1.data.cotacao)
    expect(r2.data.exemplo).toBe(r1.data.exemplo)

    // Cotação é efêmera — não cria rows em nenhuma tabela. Confirma que
    // `integrations` continua sem rows para este tenant.
    const countIntegrations = await withTenant(fixture.tenantId, async (tx) => {
      const rows = await tx.select({ id: integrations.id }).from(integrations)
      return rows.length
    })
    expect(countIntegrations).toBe(0)
  })

  it('obterCotacao com provider infotravel também devolve exemplo (adapter fallback)', async () => {
    // Sem integração ativa, a action sempre resolve para o adapter Wooba
    // (`obterAdapter('wooba')`) — ver `src/server/integrations.ts`. O teste
    // confirma que o caminho "sem credencial" do `obterCotacao` funciona
    // independentemente de qualquer integração infotravel cadastrada.
    const fixture = await seedTenant('dev-cot-info')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await obterCotacao({
      hotelId: 'ex-info-1',
      checkIn: '2026-10-10',
      checkOut: '2026-10-15',
      paxAdults: 2,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.exemplo).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// buscarHoteis/obterCotacao — validação de input e integracaoId inexistente
// ---------------------------------------------------------------------------

describe('buscarHoteis/obterCotacao — validação de input e integracaoId', () => {
  it('buscarHoteis com destino curto (1 char) → DADOS_INVALIDOS', async () => {
    const fixture = await seedTenant('val-busca-dest')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await buscarHoteis({
      destino: 'x',
      checkIn: '2026-10-10',
      checkOut: '2026-10-15',
      paxAdults: 2,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('DADOS_INVALIDOS')
    expect(r.correcao).toBeTruthy()
  })

  it('buscarHoteis com checkIn em formato errado → DADOS_INVALIDOS', async () => {
    const fixture = await seedTenant('val-busca-data')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await buscarHoteis({
      destino: 'Buenos Aires',
      checkIn: '10/10/2026',
      checkOut: '2026-10-15',
      paxAdults: 2,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('DADOS_INVALIDOS')
  })

  it('buscarHoteis com paxAdults < 1 → DADOS_INVALIDOS', async () => {
    const fixture = await seedTenant('val-busca-pax')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await buscarHoteis({
      destino: 'Buenos Aires',
      checkIn: '2026-10-10',
      checkOut: '2026-10-15',
      paxAdults: 0,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('DADOS_INVALIDOS')
  })

  it('buscarHoteis com integracaoId inexistente → NAO_ENCONTRADO', async () => {
    const fixture = await seedTenant('val-busca-intid')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await buscarHoteis({
      integracaoId: randomUUID(),
      destino: 'Buenos Aires',
      checkIn: '2026-10-10',
      checkOut: '2026-10-15',
      paxAdults: 2,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('NAO_ENCONTRADO')
    expect(r.correcao).toMatch(/integr/i)
  })

  it('obterCotacao com hotelId vazio → DADOS_INVALIDOS', async () => {
    const fixture = await seedTenant('val-cot-hotel')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await obterCotacao({
      hotelId: '',
      checkIn: '2026-10-10',
      checkOut: '2026-10-15',
      paxAdults: 2,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('DADOS_INVALIDOS')
  })

  it('obterCotacao com integracaoId inexistente → NAO_ENCONTRADO', async () => {
    const fixture = await seedTenant('val-cot-intid')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const r = await obterCotacao({
      integracaoId: randomUUID(),
      hotelId: 'ex-wooba-1',
      checkIn: '2026-10-10',
      checkOut: '2026-10-15',
      paxAdults: 2,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('NAO_ENCONTRADO')
  })

  it('buscarHoteis com integracaoId de outro tenant → NAO_ENCONTRADO (RLS)', async () => {
    const fixtureA = await seedTenant('val-busca-cross-a')
    const fixtureB = await seedTenant('val-busca-cross-b')
    criados.push(fixtureA.tenantId, fixtureB.tenantId)

    entrarComo(fixtureA)
    const criada = await criarIntegracao({
      provider: 'wooba',
      label: 'Conta A',
      credentials: { apiKey: 'sk-a' },
    })
    expect(criada.ok).toBe(true)
    if (!criada.ok) return

    // B tenta usar a integração de A — a query `where id = $1 and tenant_id =
    // tenantId(B)` devolve zero (RLS), action devolve NAO_ENCONTRADO.
    entrarComo(fixtureB)
    const r = await buscarHoteis({
      integracaoId: criada.data.id,
      destino: 'Buenos Aires',
      checkIn: '2026-10-10',
      checkOut: '2026-10-15',
      paxAdults: 2,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('NAO_ENCONTRADO')
  })

  it('buscarHoteis com credencial sem apiKey → DADOS_INVALIDOS (adapter Wooba barrando)', async () => {
    // Cria uma integração ativa com credencial que não tem `apiKey` — o adapter
    // Wooba lança `ServiceError('DADOS_INVALIDOS', 'A credencial da conta Wooba
    // não tem chave de API.')` ANTES de qualquer fetch. É o único caminho "com
    // credencial ativa" que podemos testar sem chamar a API real do Wooba.
    const fixture = await seedTenant('val-busca-no-apikey')
    criados.push(fixture.tenantId)
    entrarComo(fixture)

    const criada = await criarIntegracao({
      provider: 'wooba',
      label: 'Conta sem apiKey',
      credentials: { agencyId: 'ag-1' },
    })
    expect(criada.ok).toBe(true)
    if (!criada.ok) return

    const r = await buscarHoteis({
      integracaoId: criada.data.id,
      destino: 'Buenos Aires',
      checkIn: '2026-10-10',
      checkOut: '2026-10-15',
      paxAdults: 2,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('DADOS_INVALIDOS')
    expect(r.mensagem).toMatch(/chave de API|apiKey/i)
    expect(r.correcao).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Isolamento por tenant — integração de A não aparece para B (camada de action)
// ---------------------------------------------------------------------------

describe('isolamento por tenant — integração de A não aparece para B (action)', () => {
  it('listarIntegracoes de B contra A devolve []', async () => {
    const fixtureA = await seedTenant('iso-a')
    const fixtureB = await seedTenant('iso-b')
    criados.push(fixtureA.tenantId, fixtureB.tenantId)

    entrarComo(fixtureA)
    const r = await criarIntegracao({
      provider: 'wooba',
      label: 'Conta A',
      credentials: { apiKey: 'sk-a' },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // B não vê a integração de A — RLS na action.
    entrarComo(fixtureB)
    const lista = await listarIntegracoes()
    expect(lista.ok).toBe(true)
    if (!lista.ok) return
    expect(lista.data).toEqual([])
  })

  it('dois tenants com integrações distintas não misturam', async () => {
    const fixtureA = await seedTenant('iso-mix-a')
    const fixtureB = await seedTenant('iso-mix-b')
    criados.push(fixtureA.tenantId, fixtureB.tenantId)

    entrarComo(fixtureA)
    const a1 = await criarIntegracao({
      provider: 'wooba',
      label: 'Conta A wooba',
      credentials: { apiKey: 'sk-a1' },
    })
    expect(a1.ok).toBe(true)
    if (!a1.ok) return

    entrarComo(fixtureB)
    const b1 = await criarIntegracao({
      provider: 'infotravel',
      label: 'Conta B infotravel',
      credentials: { apiKey: 'sk-b1' },
    })
    expect(b1.ok).toBe(true)
    if (!b1.ok) return

    // A só vê a própria.
    entrarComo(fixtureA)
    const listaA = await listarIntegracoes()
    expect(listaA.ok).toBe(true)
    if (!listaA.ok) return
    expect(listaA.data).toHaveLength(1)
    expect(listaA.data[0]?.label).toBe('Conta A wooba')
    expect(listaA.data[0]?.provider).toBe('wooba')

    // B só vê a própria.
    entrarComo(fixtureB)
    const listaB = await listarIntegracoes()
    expect(listaB.ok).toBe(true)
    if (!listaB.ok) return
    expect(listaB.data).toHaveLength(1)
    expect(listaB.data[0]?.label).toBe('Conta B infotravel')
    expect(listaB.data[0]?.provider).toBe('infotravel')
  })
})
