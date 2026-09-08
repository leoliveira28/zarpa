/**
 * Fixture do fluxo de roteiro (S14 §4) — usada por `tests/itineraries/roteiro.test.ts`
 * (comportamento da action) e por `tests/security/public-roteiro.test.ts` (varredura de
 * vazamento da leitura pública).
 *
 * Cenário de verdade, não mock: tenant + usuário (o `audit_log` tem FK real para `user`)
 * + contato + negócio com datas + proposta ACEITA com DUAS opções e QUATRO blocos —
 * dois compartilhados (`option_id` null), um da opção aceita e um da outra opção (que
 * NÃO pode entrar no roteiro: o snapshot só leva os blocos da proposta inteira + os da
 * opção aceita). Os `cost_cents`/`commission_cents` das opções são canário: valores
 * distintos e reconhecíveis que NUNCA podem aparecer no payload público.
 */
import { eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { withTenant } from '@/lib/tenant/withTenant'
import {
  contacts,
  deals,
  itineraries,
  proposalBlocks,
  proposalOptions,
  proposals,
  tenants,
  user,
} from '@/db/schema'

/** Datas estáticas — nenhum teste de roteiro classifica por "hoje", então não precisam
 * ser relativas ao relógio (diferente de `tests/viagens/em-viagem.test.ts`). */
export const PARTIDA_FIXTURE = '2026-10-10'
export const VOLTA_FIXTURE = '2026-10-20'

export const BRAND_SNAPSHOT_FIXTURE = {
  name: 'Agência QA Roteiro',
  whatsapp: '11987654321',
  instagram: '@qa.roteiro',
  primaryColor: '#12557F',
}

export type CenarioRoteiro = {
  tenantId: string
  userId: string
  contactId: string
  contactName: string
  dealId: string
  propostaId: string
  propostaTitle: string
  /** O `public_token` da PROPOSTA — para provar que o portão de uma página não abre a outra. */
  propostaToken: string
  opcaoAceitaId: string
  opcaoOutraId: string
  blocos: {
    compartilhado1: string
    daAceita: string
    compartilhado2: string
    daOutra: string
  }
}

export type OpcoesCenarioRoteiro = {
  /** Estágio do negócio. Default `ganho` — é o único que a action aceita. */
  stage?: 'ganho' | 'cotando' | 'perdido' | 'negociando'
  /** `false` = proposta nasce `sent` sem aceite (para a recusa "sem proposta aceita"). */
  propostaAceita?: boolean
  /** PII de canário do CLIENTE — o que NUNCA pode vazar para a página pública. */
  contato?: { email?: string; whatsapp?: string }
  /** Reaproveita tenant/usuário já criados (para ter 2 roteiros no MESMO tenant). */
  reuso?: { tenantId: string; userId: string }
}

export async function seedCenarioRoteiro(
  opts: OpcoesCenarioRoteiro = {},
): Promise<CenarioRoteiro> {
  const propostaAceita = opts.propostaAceita ?? true
  const stage = opts.stage ?? 'ganho'

  const tenantId = opts.reuso?.tenantId ?? randomUUID()
  const userId = opts.reuso?.userId ?? `qa-roteiro-${randomUUID()}`
  const tag = `qa-roteiro-${tenantId.slice(0, 8)}`
  const contactName = 'Marina Cliente QA'
  const propostaTitle = 'Roteiro QA Lisboa'
  const propostaToken = randomUUID()

  return withTenant(tenantId, async (tx) => {
    if (!opts.reuso) {
      await tx.insert(tenants).values({
        id: tenantId,
        name: `Agência ${tag}`,
        slug: tag,
        brandName: BRAND_SNAPSHOT_FIXTURE.name,
        whatsapp: BRAND_SNAPSHOT_FIXTURE.whatsapp,
        instagram: BRAND_SNAPSHOT_FIXTURE.instagram,
      })
      await tx.insert(user).values({
        id: userId,
        tenantId,
        name: 'QA Roteiro Bot',
        email: `${tag}@exemplo-zarpa.test`,
      })
    }

    const [contact] = await tx
      .insert(contacts)
      .values({
        tenantId,
        name: contactName,
        email: opts.contato?.email ?? null,
        whatsapp: opts.contato?.whatsapp ?? null,
      })
      .returning({ id: contacts.id })

    const [deal] = await tx
      .insert(deals)
      .values({
        tenantId,
        contactId: contact!.id,
        title: 'Viagem QA Roteiro',
        destination: 'Lisboa',
        stage,
        valueCents: 500_000,
        departureOn: PARTIDA_FIXTURE,
        returnOn: VOLTA_FIXTURE,
        closedAt: stage === 'ganho' || stage === 'perdido' ? new Date() : null,
      })
      .returning({ id: deals.id })

    const [proposta] = await tx
      .insert(proposals)
      .values({
        tenantId,
        dealId: deal!.id,
        publicToken: propostaToken,
        title: propostaTitle,
        status: propostaAceita ? 'accepted' : 'sent',
        sentAt: new Date(),
        acceptedAt: propostaAceita ? new Date() : null,
        brandSnapshot: BRAND_SNAPSHOT_FIXTURE,
      })
      .returning({ id: proposals.id })

    const [opcaoAceita] = await tx
      .insert(proposalOptions)
      .values({
        tenantId,
        proposalId: proposta!.id,
        name: 'Conforto',
        position: 1,
        priceCents: 500_000,
        costCents: 320_000,
        commissionCents: 98_765,
      })
      .returning({ id: proposalOptions.id })

    const [opcaoOutra] = await tx
      .insert(proposalOptions)
      .values({
        tenantId,
        proposalId: proposta!.id,
        name: 'Econômica',
        position: 2,
        priceCents: 350_000,
        costCents: 250_000,
        commissionCents: 50_000,
      })
      .returning({ id: proposalOptions.id })

    if (propostaAceita) {
      await tx
        .update(proposals)
        .set({ acceptedOptionId: opcaoAceita!.id })
        .where(eq(proposals.id, proposta!.id))
    }

    const inserirBloco = (
      kind: 'text' | 'flight' | 'hotel',
      position: number,
      title: string,
      body: string,
      optionId: string | null,
      content: Record<string, unknown> = {},
    ) =>
      tx
        .insert(proposalBlocks)
        .values({ tenantId, proposalId: proposta!.id, optionId, kind, position, title, body, content })
        .returning({ id: proposalBlocks.id })

    const [compartilhado1] = await inserirBloco(
      'flight', 1, 'Voo de ida', 'Voo direto para Lisboa, dez de outubro.', null, { voo: 'TP083' },
    )
    const [daAceita] = await inserirBloco(
      'hotel', 2, 'Hotel do conforto', 'Dez noites com vista para o Tejo.', opcaoAceita!.id, { diarias: 10 },
    )
    const [compartilhado2] = await inserirBloco(
      'text', 3, 'Boas-vindas', 'Bem-vindo ao seu roteiro de viagem.', null,
    )
    const [daOutra] = await inserirBloco(
      'text', 4, 'Bloco da econômica', 'Só entra no roteiro se a econômica for a aceita.', opcaoOutra!.id,
    )

    return {
      tenantId,
      userId,
      contactId: contact!.id,
      contactName,
      dealId: deal!.id,
      propostaId: proposta!.id,
      propostaTitle,
      propostaToken,
      opcaoAceitaId: opcaoAceita!.id,
      opcaoOutraId: opcaoOutra!.id,
      blocos: {
        compartilhado1: compartilhado1!.id,
        daAceita: daAceita!.id,
        compartilhado2: compartilhado2!.id,
        daOutra: daOutra!.id,
      },
    }
  })
}

/** Apaga o cenário na ordem das FKs (RESTRICT entre itineraries↔deals/proposals). */
export async function apagarCenarioRoteiro(tenantId: string): Promise<void> {
  try {
    await withTenant(tenantId, async (tx) => {
      await tx.delete(itineraries)
      await tx.delete(proposalBlocks)
      await tx.delete(proposalOptions)
      await tx.delete(proposals)
      await tx.delete(deals)
      await tx.delete(contacts)
      await tx.delete(user)
      await tx.delete(tenants)
    })
  } catch {
    /* best-effort — o globalSetup recria o schema a cada rodada */
  }
}
