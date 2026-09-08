'use server';

import { randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  contacts,
  deals,
  itineraries,
  proposalBlocks,
  proposals,
  tenants,
  type NewItinerary,
} from '@/db/schema';
import { withTenant } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { exigirContaAtiva } from './subscriptionGate';
import { registrarAuditoria } from './audit';

/**
 * §4 de `docs/PROPOSTAS_PRODUTO.md` — gerar e listar o roteiro pós-venda.
 *
 * `gerarRoteiro(dealId)` FOTOGRAFA a proposta aceita do negócio `ganho` em
 * `itineraries.blocks_snapshot`: editar a proposta depois NÃO muda o roteiro já gerado.
 * A leitura pública do link (`/r/[token]`) é a função `SECURITY DEFINER`
 * `public.roteiro_publica` (`drizzle/0013_roteiro_publico.sql`) + `obterRoteiroPublico`
 * (`./publicItineraries.ts`) — este arquivo é só o lado autenticado.
 *
 * Mesmas quatro regras de `contacts.ts`/`sales.ts`: `tenantId` vem da sessão, toda query
 * dentro de `withTenant`, `tenant_id` nunca vem do corpo da requisição, entrada validada
 * com zod antes de tocar no banco. ESCRITA — passa pelo gate de dunning
 * (`exigirContaAtiva`) na primeira linha da transação.
 *
 * O que NUNCA entra no snapshot (nem na tabela, nem na resposta pública): custo,
 * comissão, preço (preço é da opção, e a página pública do roteiro não é cotação),
 * documento de passageiro, contato do cliente além do nome. O scanner de vazamento
 * (`tests/security/leak-scanner.ts`) varre a resposta inteira — o §4 herda a disciplina
 * da `/p/[slug]` na íntegra.
 */

// ---------------------------------------------------------------------------
// Tipos e colunas
// ---------------------------------------------------------------------------

/**
 * Forma do bloco DENTRO de `blocks_snapshot` (e da resposta pública). Menos que o bloco
 * ao vivo de propósito: `id`/`optionId`/`proposalId`/`tenantId` são linhagem interna, não
 * conteúdo para o cliente ver.
 */
export type BlocoDoRoteiro = {
  kind: string;
  position: number;
  title: string | null;
  body: string | null;
  images: string[];
  content: Record<string, unknown>;
};

export type RoteiroResumo = {
  id: string;
  dealId: string;
  proposalId: string;
  /** Token do link público `/r/<token>` — 128 bits, mesmo desenho do `public_token`. */
  publicToken: string;
  title: string;
  clientName: string;
  currency: string;
  /** `AAAA-MM-DD`, ou `null` quando o negócio não tinha a data registrada. */
  departureOn: string | null;
  returnOn: string | null;
  createdAt: Date;
};

const COLUNAS_ROTEIRO = {
  id: itineraries.id,
  dealId: itineraries.dealId,
  proposalId: itineraries.proposalId,
  publicToken: itineraries.publicToken,
  title: itineraries.title,
  clientName: itineraries.clientName,
  currency: itineraries.currency,
  departureOn: itineraries.departureOn,
  returnOn: itineraries.returnOn,
  createdAt: itineraries.createdAt,
} as const;

/** 128 bits base64url (~22 caracteres) — mesmo desenho do `publicToken` de `proposals.ts`. */
function gerarTokenPublico(): string {
  return randomBytes(16).toString('base64url');
}

/** Lê uma chave string de um `jsonb` sem tipo no schema; vazio conta como ausente. */
function textoDoSnapshot(snapshot: unknown, chave: string): string | null {
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const valor = (snapshot as Record<string, unknown>)[chave];
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
}

/** `images`/`content` vêm de `jsonb` sem `$type` — saneia para a forma do snapshot. */
function paraSnapshotDeBloco(bloco: {
  kind: string;
  position: number;
  title: string | null;
  body: string | null;
  images: unknown;
  content: unknown;
}): BlocoDoRoteiro {
  const images = Array.isArray(bloco.images)
    ? bloco.images.filter((item): item is string => typeof item === 'string')
    : [];
  const content =
    typeof bloco.content === 'object' && bloco.content !== null
      ? (bloco.content as Record<string, unknown>)
      : {};
  return {
    kind: bloco.kind,
    position: bloco.position,
    title: bloco.title,
    body: bloco.body,
    images,
    content,
  };
}

// ---------------------------------------------------------------------------
// Gerar roteiro (escrita)
// ---------------------------------------------------------------------------

const roteiroInput = z.object({ dealId: z.uuid('Negócio inválido') });

export type GerarRoteiroInput = z.infer<typeof roteiroInput>;

/**
 * Fotografa a proposta ACEITA do negócio `ganho` e grava o roteiro.
 *
 * Recusa com mensagem certa quando:
 *   - o negócio não é `ganho` — roteiro é PÓS-venda, não material de cotação;
 *   - o negócio não tem proposta aceita — sem aceite não há o que fotografar.
 *
 * **Idempotente**: um negócio tem NO MÁXIMO um roteiro — índice único
 * `itineraries_deal_id_key` garante no BANCO (não na sorte do clique duplo). Chamar de
 * novo devolve o roteiro já existente; sob concorrência real, o `onConflictDoNothing`
 * faz a segunda chamada gravar nada e o reselect devolve o estado JÁ PERSISTIDO — mesma
 * doutrina de `converterPropostaEmVenda`/`gerarParcelasDaVenda` (`sales.ts`).
 *
 * NÃO há "regenerar": o roteiro é fotografia do fechado, e substituir a fotografia que o
 * cliente já recebeu silenciosamente seria pior que não deixar regenerar. Se um dia o
 * produto pedir regeneração, é decisão nova do PO (e o link/token deve mudar junto).
 */
export async function gerarRoteiro(dealId: string): Promise<ServiceResult<RoteiroResumo>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const parsed = roteiroInput.safeParse({ dealId });
    if (!parsed.success) {
      throw new ServiceError('DADOS_INVALIDOS', parsed.error.issues[0]?.message ?? 'Dados inválidos', {
        campo: 'dealId',
        correcao: 'Abrir o negócio de novo',
      });
    }

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada.
      await exigirContaAtiva(tx, tenantId);

      const [existente] = await tx
        .select(COLUNAS_ROTEIRO)
        .from(itineraries)
        .where(eq(itineraries.dealId, dealId))
        .limit(1);

      if (existente) {
        return existente as RoteiroResumo;
      }

      const [negocio] = await tx
        .select({
          id: deals.id,
          title: deals.title,
          stage: deals.stage,
          departureOn: deals.departureOn,
          returnOn: deals.returnOn,
          contactId: deals.contactId,
          contactName: contacts.name,
        })
        .from(deals)
        .innerJoin(contacts, eq(contacts.id, deals.contactId))
        .where(eq(deals.id, dealId))
        .limit(1);

      if (!negocio) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse negócio não existe mais.', {
          correcao: 'Voltar para o funil',
        });
      }

      if (negocio.stage !== 'ganho') {
        throw new ServiceError(
          'CONFLITO',
          'Só dá para gerar roteiro de negócio fechado como ganho.',
          { correcao: 'Mover o negócio para Fechada antes' },
        );
      }

      // A proposta ACEITA mais recente do negócio. Um negócio pode ter várias propostas;
      // a aceita é a que o cliente valeu — e, se houver mais de uma aceita (reenvio), a
      // última aceitada é a verdade comercial.
      const [proposta] = await tx
        .select({
          id: proposals.id,
          title: proposals.title,
          currency: proposals.currency,
          status: proposals.status,
          acceptedOptionId: proposals.acceptedOptionId,
          brandSnapshot: proposals.brandSnapshot,
        })
        .from(proposals)
        .where(and(eq(proposals.dealId, dealId), eq(proposals.status, 'accepted')))
        .orderBy(desc(proposals.acceptedAt))
        .limit(1);

      if (!proposta || !proposta.acceptedOptionId) {
        throw new ServiceError(
          'CONFLITO',
          'Este negócio fechado não tem proposta aceita.',
          { correcao: 'Registrar o aceite da proposta antes de gerar o roteiro' },
        );
      }

      // Blocos da fotografia: os da proposta INTEIRA (option_id null) + os da opção
      // aceita. Blocos das outras opções (econômico/premium quando o cliente aceitou
      // conforto) não são a viagem vendida — ficam fora.
      const linhasBlocos = await tx
        .select({
          kind: proposalBlocks.kind,
          position: proposalBlocks.position,
          title: proposalBlocks.title,
          body: proposalBlocks.body,
          images: proposalBlocks.images,
          content: proposalBlocks.content,
        })
        .from(proposalBlocks)
        .where(
          and(
            eq(proposalBlocks.proposalId, proposta.id),
            or(
              isNull(proposalBlocks.optionId),
              eq(proposalBlocks.optionId, proposta.acceptedOptionId),
            ),
          ),
        )
        .orderBy(proposalBlocks.position);

      const blocos = linhasBlocos.map(paraSnapshotDeBloco);

      // Marca congelada: a da PROPOSTA ACEITA (a cara que o cliente já viu e aceitou),
      // com fallback para o cadastro do tenant quando alguma chave vier vazia — proposta
      // aceita nasce de `enviarProposta`, que congela `brand_snapshot`, mas o seed/imports
      // antigos podem ter pulado chaves.
      const [marca] = await tx
        .select({
          brandName: tenants.brandName,
          brandLogoUrl: tenants.brandLogoUrl,
          brandPrimaryColor: tenants.brandPrimaryColor,
          brandSecondaryColor: tenants.brandSecondaryColor,
          whatsapp: tenants.whatsapp,
          instagram: tenants.instagram,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);

      const nova: NewItinerary = {
        tenantId,
        dealId,
        proposalId: proposta.id,
        publicToken: gerarTokenPublico(),
        title: proposta.title,
        currency: proposta.currency,
        clientName: negocio.contactName,
        departureOn: negocio.departureOn,
        returnOn: negocio.returnOn,
        blocksSnapshot: blocos,
        brandSnapshot: {
          name: textoDoSnapshot(proposta.brandSnapshot, 'name') ?? marca?.brandName ?? null,
          logoUrl:
            textoDoSnapshot(proposta.brandSnapshot, 'logoUrl') ?? marca?.brandLogoUrl ?? null,
          primaryColor:
            textoDoSnapshot(proposta.brandSnapshot, 'primaryColor') ??
            marca?.brandPrimaryColor ??
            null,
          secondaryColor:
            textoDoSnapshot(proposta.brandSnapshot, 'secondaryColor') ??
            marca?.brandSecondaryColor ??
            null,
          whatsapp: textoDoSnapshot(proposta.brandSnapshot, 'whatsapp') ?? marca?.whatsapp ?? null,
          instagram:
            textoDoSnapshot(proposta.brandSnapshot, 'instagram') ?? marca?.instagram ?? null,
        },
      };

      await tx.insert(itineraries).values(nova).onConflictDoNothing({
        target: itineraries.dealId,
      });

      // Estado JÁ PERSISTIDO, nunca "o que esta chamada conseguiu inserir".
      const [roteiro] = await tx
        .select(COLUNAS_ROTEIRO)
        .from(itineraries)
        .where(eq(itineraries.dealId, dealId))
        .limit(1);

      if (!roteiro) {
        // Só alcançável se a linha sumir entre insert e select — impossível sem
        // concorrência externa; tratado para o tipo não mentir.
        throw new ServiceError('CONFLITO', 'Não consegui gravar o roteiro.', {
          correcao: 'Tentar de novo',
        });
      }

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'itinerary.created',
        entity: 'itinerary',
        entityId: roteiro.id,
        metadata: { dealId, proposalId: proposta.id },
      });

      return roteiro as RoteiroResumo;
    });
  });
}

// ---------------------------------------------------------------------------
// Listar roteiros (leitura)
// ---------------------------------------------------------------------------

/** Mais recente primeiro. Snapshot completo fica de fora — quem precisa do conteúdo é a página pública. */
export async function listarRoteiros(): Promise<ServiceResult<RoteiroResumo[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const linhas = await tx
        .select(COLUNAS_ROTEIRO)
        .from(itineraries)
        .orderBy(desc(itineraries.createdAt))
        .limit(200);

      return linhas as RoteiroResumo[];
    });
  });
}
