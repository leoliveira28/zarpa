'use server';

import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { groups, offers, tenants } from '@/db/schema';
import { unsafeSqlWithoutTenant } from '@/db/client';
import { withTenant } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { registrarAuditoria } from './audit';
import { exigirContaAtiva } from './subscriptionGate';
import type { BlocoKind } from './proposals';

/**
 * Ofertas da Vitrine (Fit 7, `docs/FIT7_VITRINE.md`, 0026) — o catálogo público
 * do agente que não tem site.
 *
 * `blocks` é FOTOGRAFIA do documento inteiro (mesma forma de
 * `proposal_templates.blocks` — os MESMOS blocos do construtor de proposta,
 * renderizados pela `PublicBlockSection`): a oferta é editada como um todo e
 * gravada inteira. Publicar/despublicar é o interruptor de `/a/[slug]`.
 *
 * LEITURA PÚBLICA: só pelas funções `SECURITY DEFINER` (`public.vitrine_publica`,
 * `public.oferta_publica` — 0026), com lista de colunas explícita e o MESMO GUC
 * de `/p/` e `/r/`. Nenhuma action lê oferta sem contexto de tenant; nenhum
 * payload público carrega nome de interessado ou contato de cliente (nem existem
 * na tabela).
 */

import type { OfertaTipo } from '@/lib/ui/ofertaTipo';

export type OfertaResumo = {
  id: string;
  title: string;
  type: OfertaTipo;
  priceCents: number;
  summary: string | null;
  coverUrl: string | null;
  position: number;
  publicada: boolean;
  publicToken: string;
  /** A oferta é um grupo com lugares — o catálogo mostra "restam N". */
  grupoId: string | null;
  createdAt: Date;
};

/** Bloco de oferta — a MESMA forma de `PublicBlockInput`/template blocks. */
export type BlocoDeOferta = {
  kind: BlocoKind;
  title: string | null;
  body: string | null;
  images: string[];
  content: Record<string, unknown>;
};

const TIPOS: OfertaTipo[] = ['pacote', 'voo', 'hospedagem', 'transfer', 'servico'];

const blocoInput = z.object({
  kind: z.enum([
    'text',
    'image',
    'flight',
    'hotel',
    'transfer',
    'tour',
    'cruise',
    'insurance',
    'price_note',
  ]),
  title: z.string().trim().max(200).nullable().optional(),
  body: z.string().trim().max(8000).nullable().optional(),
  images: z.array(z.string().trim().max(2000)).max(10).optional(),
  content: z.record(z.string(), z.unknown()).optional(),
});

const blocosInput = z.array(blocoInput).max(50);

const criarInput = z.object({
  title: z.string().trim().min(2, 'Dê um título à oferta').max(200),
  type: z.enum(['pacote', 'voo', 'hospedagem', 'transfer', 'servico']),
  priceCents: z.number().int().min(0).optional(),
  summary: z.string().trim().max(500).optional().or(z.literal('')),
  coverUrl: z.string().trim().max(2000).optional().or(z.literal('')),
  blocks: blocosInput.optional(),
  groupId: z.uuid('Grupo inválido').nullable().optional(),
});
export type CriarOfertaInput = z.infer<typeof criarInput>;

const atualizarInput = z.object({
  id: z.uuid('Oferta inválida'),
  title: z.string().trim().min(2).max(200).optional(),
  type: z.enum(['pacote', 'voo', 'hospedagem', 'transfer', 'servico']).optional(),
  priceCents: z.number().int().min(0).optional(),
  summary: z.string().trim().max(500).optional().or(z.literal('')),
  coverUrl: z.string().trim().max(2000).optional().or(z.literal('')),
  blocks: blocosInput.optional(),
  groupId: z.uuid('Grupo inválido').nullable().optional(),
});
export type AtualizarOfertaInput = z.infer<typeof atualizarInput>;

function validar<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const primeiro = parsed.error.issues[0];
    throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
      campo: primeiro?.path.join('.'),
      correcao: 'Corrigir e tentar de novo',
    });
  }
  return parsed.data;
}

const COLUNAS_OFERTA = {
  id: offers.id,
  title: offers.title,
  type: offers.type,
  priceCents: offers.priceCents,
  summary: offers.summary,
  coverUrl: offers.coverUrl,
  position: offers.position,
  publicToken: offers.publicToken,
  publicada: sql<boolean>`${offers.publishedAt} is not null and ${offers.unpublishedAt} is null`,
  grupoId: offers.groupId,
  createdAt: offers.createdAt,
} as const;

function tokenPublico(): string {
  // 128 bits de aleatoriedade em base64url — o mesmo papel do public_token da
  // proposta: opaco, sem sequencialidade, cabe num link de WhatsApp.
  return randomBytes(16).toString('base64url');
}

export async function criarOferta(
  input: CriarOfertaInput,
): Promise<ServiceResult<OfertaResumo>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(criarInput, input);

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);

      if (dados.groupId) {
        const [grupo] = await tx
          .select({ id: groups.id })
          .from(groups)
          .where(and(eq(groups.id, dados.groupId), eq(groups.tenantId, tenantId)))
          .limit(1);
        if (!grupo) {
          throw new ServiceError('NAO_ENCONTRADO', 'Esse grupo não existe mais.', {
            campo: 'groupId',
            correcao: 'Escolher outro grupo',
          });
        }
      }

      const position =
        ((await tx
          .select({ max: sql<number | null>`max(${offers.position})` })
          .from(offers)
          .where(eq(offers.tenantId, tenantId)))
          .at(0)?.max ?? -1) + 1;

      const [criada] = await tx
        .insert(offers)
        .values({
          tenantId,
          title: dados.title,
          type: dados.type,
          priceCents: dados.priceCents ?? 0,
          summary: dados.summary?.trim() || null,
          coverUrl: dados.coverUrl?.trim() || null,
          blocks: (dados.blocks ?? []) as unknown as Array<Record<string, unknown>>,
          publicToken: tokenPublico(),
          position,
          groupId: dados.groupId ?? null,
        })
        .returning(COLUNAS_OFERTA);

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'offer.created',
        entity: 'offer',
        entityId: criada!.id,
        metadata: { title: criada!.title, type: criada!.type },
      });

      return criada! as unknown as OfertaResumo;
    });
  });
}

export async function listarOfertas(): Promise<ServiceResult<OfertaResumo[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const linhas = await tx
        .select(COLUNAS_OFERTA)
        .from(offers)
        .where(eq(offers.tenantId, tenantId))
        .orderBy(asc(offers.position), desc(offers.createdAt))
        .limit(100);
      return linhas as unknown as OfertaResumo[];
    });
  });
}

/** A oferta com os blocos — o editor lê por aqui. */
export async function obterOferta(
  ofertaId: string,
): Promise<ServiceResult<OfertaResumo & { blocks: BlocoDeOferta[] }>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const [oferta] = await tx
        .select()
        .from(offers)
        .where(and(eq(offers.id, ofertaId), eq(offers.tenantId, tenantId)))
        .limit(1);
      if (!oferta) throw new ServiceError('NAO_ENCONTRADO', 'Oferta não encontrada.');

      return {
        id: oferta.id,
        title: oferta.title,
        type: oferta.type,
        priceCents: oferta.priceCents,
        summary: oferta.summary,
        coverUrl: oferta.coverUrl,
        position: oferta.position,
        publicToken: oferta.publicToken,
        publicada: oferta.publishedAt !== null && oferta.unpublishedAt === null,
        grupoId: oferta.groupId,
        createdAt: oferta.createdAt,
        blocks: (oferta.blocks ?? []) as unknown as BlocoDeOferta[],
      };
    });
  });
}

/** Grava a ficha E os blocos — autosave do documento inteiro (idempotente). */
export async function atualizarOferta(
  input: AtualizarOfertaInput,
): Promise<ServiceResult<OfertaResumo>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(atualizarInput, input);

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);

      const valores: Record<string, unknown> = { updatedAt: new Date() };
      if (dados.title !== undefined) valores.title = dados.title;
      if (dados.type !== undefined) valores.type = dados.type;
      if (dados.priceCents !== undefined) valores.priceCents = dados.priceCents;
      if (dados.summary !== undefined) valores.summary = dados.summary.trim() || null;
      if (dados.coverUrl !== undefined) valores.coverUrl = dados.coverUrl.trim() || null;
      if (dados.blocks !== undefined) valores.blocks = dados.blocks;
      if (dados.groupId !== undefined) valores.groupId = dados.groupId;

      if (Object.keys(valores).length === 1) {
        throw new ServiceError('DADOS_INVALIDOS', 'Nada para salvar.', { correcao: 'Fechar' });
      }

      if (dados.groupId) {
        const [grupo] = await tx
          .select({ id: groups.id })
          .from(groups)
          .where(and(eq(groups.id, dados.groupId), eq(groups.tenantId, tenantId)))
          .limit(1);
        if (!grupo) {
          throw new ServiceError('NAO_ENCONTRADO', 'Esse grupo não existe mais.', {
            campo: 'groupId',
            correcao: 'Escolher outro grupo',
          });
        }
      }

      const [atualizada] = await tx
        .update(offers)
        .set(valores)
        .where(and(eq(offers.id, dados.id), eq(offers.tenantId, tenantId)))
        .returning(COLUNAS_OFERTA);
      if (!atualizada) throw new ServiceError('NAO_ENCONTRADO', 'Oferta não encontrada.');

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'offer.updated',
        entity: 'offer',
        entityId: dados.id,
        metadata: { campos: Object.keys(valores).filter((k) => k !== 'updatedAt') },
      });

      return atualizada as unknown as OfertaResumo;
    });
  });
}

/** O interruptor de `/a/[slug]`. Publicar grava o primeiro instante; despublicar
 * grava o segundo — o link divulgado passa a responder "não disponível" + catálogo. */
export async function publicarOferta(
  input: { id: string; publicada: boolean },
): Promise<ServiceResult<OfertaResumo>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(z.object({ id: z.uuid(), publicada: z.boolean() }), input);

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);

      const agora = new Date();
      const [oferta] = await tx
        .update(offers)
        .set(
          dados.publicada
            ? { publishedAt: agora, unpublishedAt: null, updatedAt: agora }
            : { unpublishedAt: agora, updatedAt: agora },
        )
        .where(and(eq(offers.id, dados.id), eq(offers.tenantId, tenantId)))
        .returning(COLUNAS_OFERTA);
      if (!oferta) throw new ServiceError('NAO_ENCONTRADO', 'Oferta não encontrada.');

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: dados.publicada ? 'offer.published' : 'offer.unpublished',
        entity: 'offer',
        entityId: dados.id,
      });

      return oferta as unknown as OfertaResumo;
    });
  });
}

// ---------------------------------------------------------------------------
// Leitura pública — pelas funções SECURITY DEFINER da 0026, SEMPRE. A página
// `/a/[slug]` não tem sessão; o payload é o que a função devolve (colunas
// explícitas, sem PII). `null` para slug inválido / nada publicado — a página
// pública não distingue os dois (mesmo racional de `obterPropostaPublica`).
// ---------------------------------------------------------------------------

export type VitrinePublica = {
  agencia: {
    nome: string;
    logo: string | null;
    instagram: string | null;
    whatsapp: string | null;
    agentName: string | null;
  } | null;
  ofertas: Array<{
    id: string;
    token: string;
    title: string;
    type: string;
    priceCents: number;
    summary: string | null;
    coverUrl: string | null;
    temLugares: boolean;
    lugaresRestantes: number;
  }>;
};

export type OfertaPublica = {
  oferta: {
    id: string;
    token: string;
    title: string;
    type: string;
    priceCents: number;
    summary: string | null;
    coverUrl: string | null;
    blocks: BlocoDeOferta[];
    temLugares: boolean;
    lugaresRestantes: number;
  } | null;
  agencia: VitrinePublica['agencia'];
};

const slugSchema = z.string().trim().min(1).max(120);

export async function obterVitrinePublica(
  slug: string,
): Promise<ServiceResult<VitrinePublica | null>> {
  return comoResultado(async () => {
    const parsed = slugSchema.safeParse(slug);
    if (!parsed.success) return null;

    const linhas = await unsafeSqlWithoutTenant<{ payload: VitrinePublica }[]>`
      select payload from public.vitrine_publica(${parsed.data})
    `;
    return linhas[0]?.payload ?? null;
  });
}

export async function obterOfertaPublica(
  slug: string,
  token: string,
): Promise<ServiceResult<OfertaPublica | null>> {
  return comoResultado(async () => {
    const parsed = slugSchema.safeParse(slug);
    const tokenOk = z.string().trim().min(10).max(120).safeParse(token);
    if (!parsed.success || !tokenOk.success) return null;

    const linhas = await unsafeSqlWithoutTenant<{ payload: OfertaPublica }[]>`
      select payload from public.oferta_publica(${parsed.data}, ${tokenOk.data})
    `;
    return linhas[0]?.payload ?? null;
  });
}

/** O endereço público da vitrine — a env de domínio é a mesma do `/p/` público. */
export async function urlDaVitrine(): Promise<ServiceResult<string | null>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    return withTenant(tenantId, async (tx) => {
      const [linha] = await tx
        .select({ slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      return linha ? `/a/${linha.slug}` : null;
    });
  });
}

/** Reordenar o catálogo — TODOS os ids ativos do tenant, na ordem nova. */
export async function reordenarOfertas(
  input: { ids: string[] },
): Promise<ServiceResult<null>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(z.object({ ids: z.array(z.uuid()).max(100) }), input);

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);

      for (const [indice, id] of dados.ids.entries()) {
        await tx
          .update(offers)
          .set({ position: indice, updatedAt: new Date() })
          .where(and(eq(offers.id, id), eq(offers.tenantId, tenantId)));
      }

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'offer.reordered',
        entity: 'offer',
        entityId: dados.ids[0] ?? '',
      });
      return null;
    });
  });
}
