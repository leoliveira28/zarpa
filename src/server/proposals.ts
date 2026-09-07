'use server';

import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  activities,
  contacts,
  deals,
  libraryItems,
  proposalBlocks,
  proposalOptions,
  proposals,
  tenants,
} from '@/db/schema';
import { withTenant, type TenantDb } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { exigirContaAtivaForaDeTransacao, exigirContaAtiva } from './subscriptionGate';
import { registrarAuditoria } from './audit';
import { sugerirComissaoCents, sugerirValorParcelaCents } from './pricing';
import { enviarImagem } from './storage';

/**
 * O construtor de proposta — proposta, opções (até 3, comparáveis) e blocos.
 *
 * Mesmas quatro regras de `contacts.ts`: tenant da sessão, tudo dentro de `withTenant`,
 * `tenant_id` escrito aqui (nunca no corpo da requisição), entrada validada com zod antes
 * de tocar no banco.
 *
 * UMA REGRA A MAIS, que não existe em nenhum outro arquivo deste diretório: os tipos
 * exportados daqui (`OpcaoEdicao`, principalmente) incluem `costCents` e `commissionCents`
 * DE PROPÓSITO — quem edita a proposta precisa ver a margem para precificar. **Isto é
 * autenticado.** A leitura pública da proposta (S7, ainda não existe) é uma função
 * `SECURITY DEFINER` própria, com sua PRÓPRIA lista de colunas, que NUNCA inclui essas
 * duas. Se um dia alguém for tentado a reaproveitar `obterPropostaParaEdicao` (ou
 * `COLUNAS_OPCAO`) para responder a rota pública: não. Ver
 * `docs/handoffs/rafa-para-nina.md` para o contrato completo.
 *
 * Autosave: toda action de atualização é granular e idempotente — chamar duas vezes com o
 * mesmo patch produz o mesmo estado final, e só os campos presentes no patch mudam (mesmo
 * padrão de `atualizarContato`). Não existe "salvar tudo de uma vez"; a interface chama uma
 * action por campo (ou por bloco) que perde o foco.
 */

// ---------------------------------------------------------------------------
// Colunas explícitas — nunca `select()` sem lista, mesmo aqui sem PII: a lista explícita é
// o que impede um `select *` acidental de um dia trazer coluna nova sem ninguém decidir.
// ---------------------------------------------------------------------------

const COLUNAS_META = {
  id: proposals.id,
  dealId: proposals.dealId,
  publicToken: proposals.publicToken,
  title: proposals.title,
  summary: proposals.summary,
  status: proposals.status,
  currency: proposals.currency,
  coverImageUrl: proposals.coverImageUrl,
  terms: proposals.terms,
  validUntil: proposals.validUntil,
  archivedAt: proposals.archivedAt,
  viewCount: proposals.viewCount,
  sentAt: proposals.sentAt,
  firstViewedAt: proposals.firstViewedAt,
  lastViewedAt: proposals.lastViewedAt,
  acceptedAt: proposals.acceptedAt,
  declinedAt: proposals.declinedAt,
  acceptedOptionId: proposals.acceptedOptionId,
  createdAt: proposals.createdAt,
  updatedAt: proposals.updatedAt,
} as const;

const COLUNAS_OPCAO = {
  id: proposalOptions.id,
  name: proposalOptions.name,
  description: proposalOptions.description,
  position: proposalOptions.position,
  priceCents: proposalOptions.priceCents,
  costCents: proposalOptions.costCents,
  commissionCents: proposalOptions.commissionCents,
  installments: proposalOptions.installments,
  installmentCents: proposalOptions.installmentCents,
  isRecommended: proposalOptions.isRecommended,
  createdAt: proposalOptions.createdAt,
  updatedAt: proposalOptions.updatedAt,
} as const;

const COLUNAS_BLOCO = {
  id: proposalBlocks.id,
  optionId: proposalBlocks.optionId,
  kind: proposalBlocks.kind,
  position: proposalBlocks.position,
  title: proposalBlocks.title,
  body: proposalBlocks.body,
  images: proposalBlocks.images,
  content: proposalBlocks.content,
  createdAt: proposalBlocks.createdAt,
  updatedAt: proposalBlocks.updatedAt,
} as const;

export type PropostaMeta = {
  id: string;
  dealId: string;
  publicToken: string;
  title: string;
  summary: string | null;
  status: string;
  currency: string;
  coverImageUrl: string | null;
  terms: string | null;
  validUntil: string | null;
  archivedAt: Date | null;
  viewCount: number;
  sentAt: Date | null;
  firstViewedAt: Date | null;
  lastViewedAt: Date | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  acceptedOptionId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OpcaoEdicao = {
  id: string;
  name: string;
  description: string | null;
  position: number;
  priceCents: number;
  costCents: number;
  commissionCents: number;
  installments: number | null;
  installmentCents: number | null;
  isRecommended: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type BlocoEdicao = {
  id: string;
  optionId: string | null;
  kind: string;
  position: number;
  title: string | null;
  body: string | null;
  images: string[];
  content: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type PropostaEdicao = PropostaMeta & {
  options: OpcaoEdicao[];
  blocks: BlocoEdicao[];
};

export type PropostaResumo = {
  id: string;
  dealId: string;
  title: string;
  status: string;
  currency: string;
  validUntil: string | null;
  viewCount: number;
  archivedAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  dealTitle: string;
  destination: string | null;
  contactName: string;
};

const BLOCK_KIND_VALUES = [
  'text',
  'image',
  'flight',
  'hotel',
  'transfer',
  'tour',
  'cruise',
  'insurance',
  'price_note',
] as const;

export type BlocoKind = (typeof BLOCK_KIND_VALUES)[number];

/** Um item de reordenação em lote — usado tanto por `reordenarOpcoes` quanto por `reordenarBlocos`. */
export type ItemReordenacao = { id: string; position: number };

function gerarTokenPublico(): string {
  // 128 bits de aleatoriedade, como o `publicToken()` de `src/db/seed.ts` — mesmo desenho,
  // arquivos diferentes: um roda em processo de seed, o outro numa Server Action, e nenhum
  // dos dois deveria importar o outro.
  return randomBytes(16).toString('base64url');
}

async function exigirProposta(tx: TenantDb, propostaId: string): Promise<{ id: string }> {
  const [proposta] = await tx
    .select({ id: proposals.id })
    .from(proposals)
    .where(eq(proposals.id, propostaId))
    .limit(1);
  if (!proposta) {
    throw new ServiceError('NAO_ENCONTRADO', 'Essa proposta não existe mais.', {
      correcao: 'Voltar para a lista',
    });
  }
  return proposta;
}

/** Confere que `optionId` é mesmo uma opção DESSA proposta — não de outra, nem de outro tenant. */
async function exigirOpcaoDaProposta(
  tx: TenantDb,
  propostaId: string,
  optionId: string,
): Promise<void> {
  const [opcao] = await tx
    .select({ id: proposalOptions.id })
    .from(proposalOptions)
    .where(and(eq(proposalOptions.id, optionId), eq(proposalOptions.proposalId, propostaId)))
    .limit(1);
  if (!opcao) {
    throw new ServiceError('DADOS_INVALIDOS', 'Essa opção não pertence a esta proposta.', {
      campo: 'optionId',
      correcao: 'Recarregar a proposta',
    });
  }
}

// ---------------------------------------------------------------------------
// Proposta
// ---------------------------------------------------------------------------

const criarPropostaInput = z.object({
  dealId: z.uuid('Escolha um negócio'),
  title: z.string().trim().min(2).max(200).optional(),
});

export type FiltroPropostas = {
  busca?: string;
  incluirArquivadas?: boolean;
  limite?: number;
  /**
   * S10: restringe a lista a um conjunto conhecido de ids — o caminho de
   * "/propostas?ids=..." que o card "propostas paradas" do dashboard usa para linkar
   * direto às propostas destacadas (`src/server/dashboard.ts`,
   * `ResumoDePropostasParadas.itens`). Sem isso, um card com N ids obrigaria a tela a
   * buscar TUDO e filtrar no cliente. Ignorado quando vazio/omitido — não filtra nada, é
   * o comportamento de sempre. `incluirArquivadas` continua valendo: se algum dos ids
   * pedidos estiver arquivado, some da lista a menos que o chamador também peça
   * `incluirArquivadas: true`.
   */
  ids?: string[];
  /**
   * Restringe a lista às propostas vinculadas a este negócio. `proposals.deal_id` é FK
   * com índice não-único (`proposals_deal_id_idx`) — pode haver mais de uma proposta por
   * negócio, por isso o retorno continua sendo `PropostaResumo[]`. O corte de tenant vem
   * do RLS (`withTenant` + `requireAuthContext`), o de arquivadas continua valendo
   * `incluirArquivadas`. Antes deste campo a ficha de um negócio (`/funil/[id]`) fazia
   * `listarPropostas({ limite: 200 })` e filtrava `p.dealId === dealId` no cliente — ver
   * `docs/handoffs/nina-para-rafa.md` item 4.1.
   */
  dealId?: string;
};

/**
 * Lista negócios disponíveis para criar uma proposta.
 *
 * Devolve resumo com id, título, destino, contato, moeda — informação suficiente
 * para um seletor (Combobox) mostrar opções por nome/destino/contato.
 *
 * Não inclui negócios que já têm uma proposta enviada (status !== 'draft'), porque
 * o "padrão" é um negócio → uma proposta. Se a agente quer segunda proposta sobre o
 * mesmo negócio, vai passar o ID diretamente (hoje é "Cole o ID"; amanhã pode virar
 * um visual no editor).
 */
export type NegocioResumo = {
  id: string;
  title: string;
  destination: string | null;
  contactName: string;
  currency: string;
};

export async function listarNegocios(
  filtro?: { busca?: string; limite?: number },
): Promise<ServiceResult<NegocioResumo[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const limite = Math.min(Math.max(filtro?.limite ?? 100, 1), 200);
    const busca = filtro?.busca?.trim();

    return withTenant(tenantId, async (tx) => {
      const condicoes = [];

      if (busca && busca.length > 0) {
        condicoes.push(
          or(
            sql`${deals.title} ilike ${'%' + busca + '%'}`,
            sql`${deals.destination} ilike ${'%' + busca + '%'}`,
            sql`${contacts.name} ilike ${'%' + busca + '%'}`,
          ),
        );
      }

      const linhas = await tx
        .select({
          id: deals.id,
          title: deals.title,
          destination: deals.destination,
          contactName: contacts.name,
          currency: deals.currency,
        })
        .from(deals)
        .innerJoin(contacts, eq(contacts.id, deals.contactId))
        .where(condicoes.length > 0 ? and(...condicoes) : undefined)
        .orderBy(desc(deals.createdAt))
        .limit(limite);

      return linhas as NegocioResumo[];
    });
  });
}

export async function listarPropostas(
  filtro?: FiltroPropostas,
): Promise<ServiceResult<PropostaResumo[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const limite = Math.min(Math.max(filtro?.limite ?? 50, 1), 200);
    const busca = filtro?.busca?.trim();

    return withTenant(tenantId, async (tx) => {
      const condicoes = [];
      if (!filtro?.incluirArquivadas) condicoes.push(isNull(proposals.archivedAt));
      if (filtro?.ids && filtro.ids.length > 0) condicoes.push(inArray(proposals.id, filtro.ids));
      if (filtro?.dealId) condicoes.push(eq(proposals.dealId, filtro.dealId));
      if (busca && busca.length > 0) {
        condicoes.push(
          or(
            sql`${proposals.title} ilike ${'%' + busca + '%'}`,
            sql`${deals.destination} ilike ${'%' + busca + '%'}`,
            sql`${contacts.name} ilike ${'%' + busca + '%'}`,
          ),
        );
      }

      const linhas = await tx
        .select({
          id: proposals.id,
          dealId: proposals.dealId,
          title: proposals.title,
          status: proposals.status,
          currency: proposals.currency,
          validUntil: proposals.validUntil,
          viewCount: proposals.viewCount,
          archivedAt: proposals.archivedAt,
          sentAt: proposals.sentAt,
          createdAt: proposals.createdAt,
          updatedAt: proposals.updatedAt,
          dealTitle: deals.title,
          destination: deals.destination,
          contactName: contacts.name,
        })
        .from(proposals)
        .innerJoin(deals, eq(deals.id, proposals.dealId))
        .innerJoin(contacts, eq(contacts.id, deals.contactId))
        .where(condicoes.length > 0 ? and(...condicoes) : undefined)
        .orderBy(desc(proposals.createdAt))
        .limit(limite);

      return linhas as PropostaResumo[];
    });
  });
}

/** Cria a proposta a partir de um negócio existente. Sempre nasce `status: 'draft'`. */
export async function criarPropostaAPartirDoNegocio(
  input: z.infer<typeof criarPropostaInput>,
): Promise<ServiceResult<PropostaEdicao>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const parsed = criarPropostaInput.safeParse(input);
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
        campo: primeiro?.path.join('.'),
        correcao: 'Corrigir e tentar de novo',
      });
    }
    const dados = parsed.data;

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      // O negócio precisa existir NESTE tenant. Com RLS, um id de outro tenant simplesmente
      // não aparece aqui — mesma mensagem de "não existe", de propósito.
      const [negocio] = await tx
        .select({
          id: deals.id,
          title: deals.title,
          destination: deals.destination,
          currency: deals.currency,
        })
        .from(deals)
        .where(eq(deals.id, dados.dealId))
        .limit(1);

      if (!negocio) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse negócio não existe mais.', {
          campo: 'dealId',
          correcao: 'Escolher outro negócio',
        });
      }

      const title = dados.title?.trim() || `Proposta — ${negocio.destination ?? negocio.title}`;

      const [criada] = await tx
        .insert(proposals)
        .values({
          tenantId,
          dealId: negocio.id,
          publicToken: gerarTokenPublico(),
          title,
          status: 'draft',
          currency: negocio.currency,
        })
        .returning(COLUNAS_META);

      const proposta = criada!;

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'proposal.created',
        entity: 'proposal',
        entityId: proposta.id,
        metadata: { dealId: negocio.id },
      });

      return { ...proposta, options: [], blocks: [] } as PropostaEdicao;
    });
  });
}

export async function obterPropostaParaEdicao(
  propostaId: string,
): Promise<ServiceResult<PropostaEdicao>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const [proposta] = await tx
        .select(COLUNAS_META)
        .from(proposals)
        .where(eq(proposals.id, propostaId))
        .limit(1);

      if (!proposta) {
        throw new ServiceError('NAO_ENCONTRADO', 'Essa proposta não existe mais.', {
          correcao: 'Voltar para a lista',
        });
      }

      const opcoes = await tx
        .select(COLUNAS_OPCAO)
        .from(proposalOptions)
        .where(eq(proposalOptions.proposalId, propostaId))
        .orderBy(asc(proposalOptions.position));

      const blocos = await tx
        .select(COLUNAS_BLOCO)
        .from(proposalBlocks)
        .where(eq(proposalBlocks.proposalId, propostaId))
        .orderBy(asc(proposalBlocks.position));

      return {
        ...proposta,
        options: opcoes as OpcaoEdicao[],
        blocks: blocos as BlocoEdicao[],
      } as PropostaEdicao;
    });
  });
}

const propostaMetaInput = z.object({
  title: z.string().trim().min(2, 'Dê um título à proposta').max(200).optional(),
  summary: z.string().trim().max(4000).optional().or(z.literal('')),
  terms: z.string().trim().max(4000).optional().or(z.literal('')),
  coverImageUrl: z.url('URL de imagem inválida').max(2000).optional().or(z.literal('')),
  currency: z.string().trim().length(3, 'Use o código de 3 letras (BRL, USD...)').optional(),
  /** `AAAA-MM-DD`, ou string vazia para limpar a validade. */
  validUntil: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD')
    .optional()
    .or(z.literal('')),
});

export type PropostaMetaPatch = z.infer<typeof propostaMetaInput>;

/** Atualiza metadados — título, validade, termos etc. Autosave: só o que veio no patch muda. */
export async function atualizarProposta(
  propostaId: string,
  patch: PropostaMetaPatch,
): Promise<ServiceResult<PropostaMeta>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const parsed = propostaMetaInput.safeParse(patch);
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
        campo: primeiro?.path.join('.'),
        correcao: 'Corrigir e salvar de novo',
      });
    }
    const dados = parsed.data;

    const valores: Record<string, unknown> = { updatedAt: new Date() };
    let mudou = 0;

    if (dados.title !== undefined) {
      valores.title = dados.title;
      mudou++;
    }
    if (dados.summary !== undefined) {
      valores.summary = dados.summary.trim() || null;
      mudou++;
    }
    if (dados.terms !== undefined) {
      valores.terms = dados.terms.trim() || null;
      mudou++;
    }
    if (dados.coverImageUrl !== undefined) {
      valores.coverImageUrl = dados.coverImageUrl.trim() || null;
      mudou++;
    }
    if (dados.currency !== undefined) {
      valores.currency = dados.currency.toUpperCase();
      mudou++;
    }
    if (dados.validUntil !== undefined) {
      valores.validUntil = dados.validUntil.trim() || null;
      mudou++;
    }

    if (mudou === 0) {
      throw new ServiceError('DADOS_INVALIDOS', 'Nada para salvar.', { correcao: 'Fechar' });
    }

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const linhas = await tx
        .update(proposals)
        .set(valores)
        .where(eq(proposals.id, propostaId))
        .returning(COLUNAS_META);

      const proposta = linhas[0];
      if (!proposta) {
        throw new ServiceError('NAO_ENCONTRADO', 'Essa proposta não existe mais.', {
          correcao: 'Voltar para a lista',
        });
      }
      return proposta as PropostaMeta;
    });
  });
}

export async function arquivarProposta(propostaId: string): Promise<ServiceResult<null>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const afetadas = await tx
        .update(proposals)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(proposals.id, propostaId), isNull(proposals.archivedAt)))
        .returning({ id: proposals.id });

      if (afetadas.length === 0) {
        throw new ServiceError('NAO_ENCONTRADO', 'Essa proposta não existe mais.', {
          correcao: 'Voltar para a lista',
        });
      }

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'proposal.archived',
        entity: 'proposal',
        entityId: propostaId,
      });

      return null;
    });
  });
}

/** O outro lado do toast com desfazer de 8s (regra do CLAUDE.md: sem modal "tem certeza?"). */
export async function restaurarProposta(propostaId: string): Promise<ServiceResult<null>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const afetadas = await tx
        .update(proposals)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(and(eq(proposals.id, propostaId), sql`${proposals.archivedAt} is not null`))
        .returning({ id: proposals.id });

      if (afetadas.length === 0) {
        throw new ServiceError('NAO_ENCONTRADO', 'Essa proposta não está arquivada.', {
          correcao: 'Voltar para a lista',
        });
      }

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'proposal.restored',
        entity: 'proposal',
        entityId: propostaId,
      });

      return null;
    });
  });
}

/**
 * Envia a proposta — o que transforma um link morto num link de verdade. É aqui, e só
 * aqui, que `brand_snapshot` é congelado: a marca do agente NO MOMENTO DO ENVIO, para que
 * a proposta que o cliente já recebeu não mude de cara se o agente trocar de logo amanhã
 * (comentário original de `proposals.ts`, agora implementado).
 *
 * `publicToken` já nasce em `criarPropostaAPartirDoNegocio` (128 bits, ver
 * `gerarTokenPublico`) — a checagem de "garantir que existe" aqui é defensiva, para uma
 * linha antiga que por algum motivo não tenha token, nunca o caminho normal.
 *
 * Reenviar uma proposta já enviada é permitido e idempotente no que importa: atualiza o
 * `brand_snapshot` (a marca pode ter mudado desde o primeiro envio) mas NUNCA regride
 * `status`/`sentAt` de um estado mais avançado (`viewed`/`accepted`/`declined`/`expired`)
 * de volta para `sent` — isso apagaria "o cliente já abriu" na cara da própria agente.
 */
export async function enviarProposta(propostaId: string): Promise<ServiceResult<PropostaMeta>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const [proposta] = await tx
        .select({
          id: proposals.id,
          dealId: proposals.dealId,
          publicToken: proposals.publicToken,
          status: proposals.status,
          sentAt: proposals.sentAt,
        })
        .from(proposals)
        .where(eq(proposals.id, propostaId))
        .limit(1);

      if (!proposta) {
        throw new ServiceError('NAO_ENCONTRADO', 'Essa proposta não existe mais.', {
          correcao: 'Voltar para a lista',
        });
      }

      const opcoes = await tx
        .select({ id: proposalOptions.id })
        .from(proposalOptions)
        .where(eq(proposalOptions.proposalId, propostaId))
        .limit(1);

      if (opcoes.length === 0) {
        throw new ServiceError(
          'DADOS_INVALIDOS',
          'Adicione ao menos uma opção antes de enviar a proposta.',
          { correcao: 'Voltar para o construtor e criar uma opção' },
        );
      }

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

      const brandSnapshot = {
        name: marca?.brandName ?? null,
        logoUrl: marca?.brandLogoUrl ?? null,
        primaryColor: marca?.brandPrimaryColor ?? null,
        secondaryColor: marca?.brandSecondaryColor ?? null,
        whatsapp: marca?.whatsapp ?? null,
        instagram: marca?.instagram ?? null,
      };

      const valores: Record<string, unknown> = { updatedAt: new Date(), brandSnapshot };
      if (!proposta.publicToken) valores.publicToken = gerarTokenPublico();
      if (proposta.status === 'draft') valores.status = 'sent';
      if (!proposta.sentAt) valores.sentAt = new Date();

      const [atualizada] = await tx
        .update(proposals)
        .set(valores)
        .where(eq(proposals.id, propostaId))
        .returning(COLUNAS_META);

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'proposal.sent',
        entity: 'proposal',
        entityId: propostaId,
      });

      await tx.insert(activities).values({
        tenantId,
        dealId: proposta.dealId,
        proposalId: propostaId,
        type: 'proposal_sent',
        occurredAt: new Date(),
      });

      return atualizada! as PropostaMeta;
    });
  });
}

/**
 * Marca uma proposta como aceita pela AGENTE — o caminho que faltava.
 *
 * Hoje a proposta só chega em `status='accepted'` por um caminho: o cliente clica
 * "Aceitar esta opção" no link público (`aceitarOpcaoPublica` → função
 * `SECURITY DEFINER`). Mas o cliente também aceita por telefone, WhatsApp fora do app,
 * e-mail — e sem esta action a agente não tem como registrar esse aceite. Sem
 * `accepted`, o botão "Gerar venda" no editor nunca aparece, e a venda nunca nasce.
 *
 * Diferente de `aceitarOpcaoPublica` (sem sessão, via `SECURITY DEFINER`), esta roda
 * autenticada: `requireAuthContext()` + `withTenant`, RLS corta o tenant, e o `actor`
 * no `audit_log`/`activities` é o `userId` da sessão — nunca `null` como no aceite
 * público. A `metadata` do `audit_log` carrega `{ origem: 'agente', optionId }` para
 * distinguir dos aceites que vêm do link (onde `actorUserId` é `null`).
 *
 * Condições:
 * - Proposta existe e é deste tenant (RLS).
 * - `status` em `['sent', 'viewed']` — não `draft`, não `expired`, não `declined`.
 * - Já `accepted`? Idempotente: devolve o estado atual sem reclamar (mesma opção ou
 *   outra — o estado já é "aceita", não vamos brigar com a agente sobre qual opção
 *   ela já tinha escolhido antes).
 * - `optionId` pertence àquela proposta (RLS já corta cross-tenant, mas valide a pertinência
 *   dentro da proposta).
 *
 * Devolve `PropostaMeta` — mesmo shape de `enviarProposta`/`atualizarProposta`, com
 * `status`, `acceptedOptionId`, `acceptedAt` reconciliados. A Nina usa isto para
 * atualizar a tela otimistamente.
 */
export async function marcarPropostaComoAceita(
  propostaId: string,
  optionId: string,
): Promise<ServiceResult<PropostaMeta>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();

    const uuidSchema = z.uuid('ID inválido');
    const idProposta = uuidSchema.safeParse(propostaId);
    const idOpcao = uuidSchema.safeParse(optionId);
    if (!idProposta.success) {
      throw new ServiceError('DADOS_INVALIDOS', idProposta.error.issues[0]?.message ?? 'Proposta inválida.', {
        campo: 'propostaId',
        correcao: 'Recarregar a proposta',
      });
    }
    if (!idOpcao.success) {
      throw new ServiceError('DADOS_INVALIDOS', idOpcao.error.issues[0]?.message ?? 'Opção inválida.', {
        campo: 'optionId',
        correcao: 'Recarregar a proposta',
      });
    }

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const [proposta] = await tx
        .select({
          id: proposals.id,
          dealId: proposals.dealId,
          status: proposals.status,
          acceptedOptionId: proposals.acceptedOptionId,
        })
        .from(proposals)
        .where(eq(proposals.id, idProposta.data))
        .limit(1);

      if (!proposta) {
        throw new ServiceError('NAO_ENCONTRADO', 'Essa proposta não existe mais.', {
          correcao: 'Voltar para a lista',
        });
      }

      // Já aceita: idempotente. Devolve o estado atual sem reclamar.
      if (proposta.status === 'accepted') {
        const [atual] = await tx
          .select(COLUNAS_META)
          .from(proposals)
          .where(eq(proposals.id, proposta.id))
          .limit(1);
        return atual! as PropostaMeta;
      }

      if (proposta.status !== 'sent' && proposta.status !== 'viewed') {
        throw new ServiceError(
          'CONFLITO',
          'Só dá para aceitar uma proposta enviada ou visualizada.',
          { correcao: 'Enviar a proposta antes de marcar como aceita' },
        );
      }

      await exigirOpcaoDaProposta(tx, proposta.id, idOpcao.data);

      const [atualizada] = await tx
        .update(proposals)
        .set({
          status: 'accepted',
          acceptedOptionId: idOpcao.data,
          acceptedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(proposals.id, proposta.id))
        .returning(COLUNAS_META);

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'proposal.accepted',
        entity: 'proposal',
        entityId: proposta.id,
        metadata: { origem: 'agente', optionId: idOpcao.data },
      });

      await tx.insert(activities).values({
        tenantId,
        dealId: proposta.dealId,
        proposalId: proposta.id,
        actorUserId: userId,
        type: 'proposal_accepted',
        body: 'Proposta marcada como aceita pela agente.',
        metadata: { origem: 'agente', optionId: idOpcao.data },
        occurredAt: new Date(),
      });

      return atualizada! as PropostaMeta;
    });
  });
}

// ---------------------------------------------------------------------------
// Opções (até 3 por proposta, comparáveis)
// ---------------------------------------------------------------------------

const opcaoInput = z.object({
  name: z.string().trim().min(1, 'Dê um nome à opção').max(120),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  position: z.number().int().min(0).optional(),
  priceCents: z.number().int().min(0).optional(),
  costCents: z.number().int().min(0).optional(),
  commissionCents: z.number().int().min(0).optional(),
  installments: z.number().int().min(1).max(24).optional(),
  installmentCents: z.number().int().min(0).optional(),
  isRecommended: z.boolean().optional(),
});

export type OpcaoInput = z.infer<typeof opcaoInput>;
export type OpcaoPatch = Partial<OpcaoInput>;

function validarOpcao(input: unknown, parcial: boolean): OpcaoInput {
  const schema = parcial ? opcaoInput.partial() : opcaoInput;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const primeiro = parsed.error.issues[0];
    throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
      campo: primeiro?.path.join('.'),
      correcao: 'Corrigir e salvar de novo',
    });
  }
  return parsed.data as OpcaoInput;
}

function proximaPosicao(existentes: { position: number }[]): number {
  return existentes.reduce((max, item) => Math.max(max, item.position), -1) + 1;
}

export async function criarOpcao(
  propostaId: string,
  input: OpcaoInput,
): Promise<ServiceResult<OpcaoEdicao>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const dados = validarOpcao(input, false);

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      await exigirProposta(tx, propostaId);

      const existentes = await tx
        .select({ position: proposalOptions.position })
        .from(proposalOptions)
        .where(eq(proposalOptions.proposalId, propostaId));

      if (existentes.length >= 3) {
        throw new ServiceError(
          'LIMITE_DO_PLANO',
          'Essa proposta já tem 3 opções — o máximo para comparação.',
          { correcao: 'Editar ou remover uma opção existente' },
        );
      }

      // Só uma opção recomendada por vez: marcar esta desmarca as outras.
      if (dados.isRecommended) {
        await tx
          .update(proposalOptions)
          .set({ isRecommended: false, updatedAt: new Date() })
          .where(eq(proposalOptions.proposalId, propostaId));
      }

      const precoVenda = dados.priceCents ?? 0;
      const precoCusto = dados.costCents ?? 0;
      const comissao = dados.commissionCents ?? sugerirComissaoCents(precoVenda, precoCusto);
      const parcelas = dados.installments ?? null;
      const valorParcela =
        dados.installmentCents ??
        (parcelas ? sugerirValorParcelaCents(precoVenda, parcelas) : null);

      const [criada] = await tx
        .insert(proposalOptions)
        .values({
          tenantId,
          proposalId: propostaId,
          name: dados.name,
          description: dados.description?.trim() || null,
          position: dados.position ?? proximaPosicao(existentes),
          priceCents: precoVenda,
          costCents: precoCusto,
          commissionCents: comissao,
          installments: parcelas,
          installmentCents: valorParcela,
          isRecommended: dados.isRecommended ?? false,
        })
        .returning(COLUNAS_OPCAO);

      return criada! as OpcaoEdicao;
    });
  });
}

export async function atualizarOpcao(
  opcaoId: string,
  patch: OpcaoPatch,
): Promise<ServiceResult<OpcaoEdicao>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const dados = validarOpcao(patch, true);

    const valores: Record<string, unknown> = { updatedAt: new Date() };
    let mudou = 0;

    if (dados.name !== undefined) {
      valores.name = dados.name;
      mudou++;
    }
    if (dados.description !== undefined) {
      valores.description = dados.description.trim() || null;
      mudou++;
    }
    if (dados.position !== undefined) {
      valores.position = dados.position;
      mudou++;
    }
    if (dados.priceCents !== undefined) {
      valores.priceCents = dados.priceCents;
      mudou++;
    }
    if (dados.costCents !== undefined) {
      valores.costCents = dados.costCents;
      mudou++;
    }
    if (dados.commissionCents !== undefined) {
      valores.commissionCents = dados.commissionCents;
      mudou++;
    }
    if (dados.installments !== undefined) {
      valores.installments = dados.installments;
      mudou++;
    }
    if (dados.installmentCents !== undefined) {
      valores.installmentCents = dados.installmentCents;
      mudou++;
    }
    if (dados.isRecommended !== undefined) {
      valores.isRecommended = dados.isRecommended;
      mudou++;
    }

    if (mudou === 0) {
      throw new ServiceError('DADOS_INVALIDOS', 'Nada para salvar.', { correcao: 'Fechar' });
    }

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const [existente] = await tx
        .select({ id: proposalOptions.id, proposalId: proposalOptions.proposalId })
        .from(proposalOptions)
        .where(eq(proposalOptions.id, opcaoId))
        .limit(1);

      if (!existente) {
        throw new ServiceError('NAO_ENCONTRADO', 'Essa opção não existe mais.', {
          correcao: 'Recarregar a proposta',
        });
      }

      if (valores.isRecommended === true) {
        await tx
          .update(proposalOptions)
          .set({ isRecommended: false, updatedAt: new Date() })
          .where(
            and(eq(proposalOptions.proposalId, existente.proposalId), ne(proposalOptions.id, opcaoId)),
          );
      }

      const linhas = await tx
        .update(proposalOptions)
        .set(valores)
        .where(eq(proposalOptions.id, opcaoId))
        .returning(COLUNAS_OPCAO);

      return linhas[0]! as OpcaoEdicao;
    });
  });
}

/**
 * Apagar a opção apaga os blocos dela junto (`ON DELETE CASCADE`) e, se ela era a
 * escolhida, `proposals.accepted_option_id` volta a `NULL` sozinho (`ON DELETE SET NULL`,
 * migration `0000`) — nenhum dos dois precisa de código aqui.
 */
export async function excluirOpcao(opcaoId: string): Promise<ServiceResult<null>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const afetadas = await tx
        .delete(proposalOptions)
        .where(eq(proposalOptions.id, opcaoId))
        .returning({ id: proposalOptions.id });

      if (afetadas.length === 0) {
        throw new ServiceError('NAO_ENCONTRADO', 'Essa opção não existe mais.', {
          correcao: 'Recarregar a proposta',
        });
      }
      return null;
    });
  });
}

const reorderOpcoesInput = z
  .array(z.object({ id: z.uuid(), position: z.number().int().min(0) }))
  .min(1)
  .max(3);

/** Reordenação em lote. Tudo ou nada: se um id não pertence a esta proposta, nada muda. */
export async function reordenarOpcoes(
  propostaId: string,
  itens: z.infer<typeof reorderOpcoesInput>,
): Promise<ServiceResult<null>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const parsed = reorderOpcoesInput.safeParse(itens);
    if (!parsed.success) {
      throw new ServiceError('DADOS_INVALIDOS', 'Lista de opções inválida.', {
        correcao: 'Recarregar a proposta',
      });
    }

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      await exigirProposta(tx, propostaId);

      let afetadas = 0;
      for (const item of parsed.data) {
        const linhas = await tx
          .update(proposalOptions)
          .set({ position: item.position, updatedAt: new Date() })
          .where(and(eq(proposalOptions.id, item.id), eq(proposalOptions.proposalId, propostaId)))
          .returning({ id: proposalOptions.id });
        afetadas += linhas.length;
      }

      if (afetadas !== parsed.data.length) {
        throw new ServiceError('CONFLITO', 'Uma das opções não existe mais nesta proposta.', {
          correcao: 'Recarregar a proposta',
        });
      }
      return null;
    });
  });
}

// ---------------------------------------------------------------------------
// Blocos (hotel, voo, transfer, passeio, seguro, texto livre)
// ---------------------------------------------------------------------------

const blocoInput = z.object({
  /** `null`/omitido = bloco da proposta inteira. Preenchido = bloco só daquela opção. */
  optionId: z.uuid().nullable().optional(),
  kind: z.enum(BLOCK_KIND_VALUES),
  position: z.number().int().min(0).optional(),
  title: z.string().trim().max(160).optional().or(z.literal('')),
  body: z.string().trim().max(8000).optional().or(z.literal('')),
  images: z.array(z.string().trim().min(1).max(2000)).max(10).optional(),
  content: z.record(z.string(), z.unknown()).optional(),
});

export type BlocoInput = z.infer<typeof blocoInput>;
export type BlocoPatch = Partial<BlocoInput>;

function validarBloco(input: unknown, parcial: boolean): BlocoInput {
  const schema = parcial ? blocoInput.partial() : blocoInput;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const primeiro = parsed.error.issues[0];
    throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
      campo: primeiro?.path.join('.'),
      correcao: 'Corrigir e salvar de novo',
    });
  }
  return parsed.data as BlocoInput;
}

function escopoDeBlocos(propostaId: string, optionId: string | null) {
  return optionId
    ? and(eq(proposalBlocks.proposalId, propostaId), eq(proposalBlocks.optionId, optionId))
    : and(eq(proposalBlocks.proposalId, propostaId), isNull(proposalBlocks.optionId));
}

export async function criarBloco(
  propostaId: string,
  input: BlocoInput,
): Promise<ServiceResult<BlocoEdicao>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const dados = validarBloco(input, false);

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      await exigirProposta(tx, propostaId);

      const optionId = dados.optionId ?? null;
      if (optionId) await exigirOpcaoDaProposta(tx, propostaId, optionId);

      const existentes = await tx
        .select({ position: proposalBlocks.position })
        .from(proposalBlocks)
        .where(escopoDeBlocos(propostaId, optionId));

      const [criado] = await tx
        .insert(proposalBlocks)
        .values({
          tenantId,
          proposalId: propostaId,
          optionId,
          kind: dados.kind,
          position: dados.position ?? proximaPosicao(existentes),
          title: dados.title?.trim() || null,
          body: dados.body?.trim() || null,
          images: dados.images ?? [],
          content: dados.content ?? {},
        })
        .returning(COLUNAS_BLOCO);

      return criado! as BlocoEdicao;
    });
  });
}

export async function atualizarBloco(
  blocoId: string,
  patch: BlocoPatch,
): Promise<ServiceResult<BlocoEdicao>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const dados = validarBloco(patch, true);

    const valores: Record<string, unknown> = { updatedAt: new Date() };
    let mudou = 0;

    if (dados.kind !== undefined) {
      valores.kind = dados.kind;
      mudou++;
    }
    if (dados.title !== undefined) {
      valores.title = dados.title.trim() || null;
      mudou++;
    }
    if (dados.body !== undefined) {
      valores.body = dados.body.trim() || null;
      mudou++;
    }
    if (dados.images !== undefined) {
      valores.images = dados.images;
      mudou++;
    }
    if (dados.content !== undefined) {
      valores.content = dados.content;
      mudou++;
    }
    if (dados.position !== undefined) {
      valores.position = dados.position;
      mudou++;
    }
    if (dados.optionId !== undefined) mudou++;

    if (mudou === 0) {
      throw new ServiceError('DADOS_INVALIDOS', 'Nada para salvar.', { correcao: 'Fechar' });
    }

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const [existente] = await tx
        .select({ id: proposalBlocks.id, proposalId: proposalBlocks.proposalId })
        .from(proposalBlocks)
        .where(eq(proposalBlocks.id, blocoId))
        .limit(1);

      if (!existente) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse bloco não existe mais.', {
          correcao: 'Recarregar a proposta',
        });
      }

      if (dados.optionId !== undefined) {
        if (dados.optionId !== null) await exigirOpcaoDaProposta(tx, existente.proposalId, dados.optionId);
        valores.optionId = dados.optionId;
      }

      const linhas = await tx
        .update(proposalBlocks)
        .set(valores)
        .where(eq(proposalBlocks.id, blocoId))
        .returning(COLUNAS_BLOCO);

      return linhas[0]! as BlocoEdicao;
    });
  });
}

export async function excluirBloco(blocoId: string): Promise<ServiceResult<null>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const afetadas = await tx
        .delete(proposalBlocks)
        .where(eq(proposalBlocks.id, blocoId))
        .returning({ id: proposalBlocks.id });

      if (afetadas.length === 0) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse bloco não existe mais.', {
          correcao: 'Recarregar a proposta',
        });
      }
      return null;
    });
  });
}

const reorderBlocosInput = z
  .array(z.object({ id: z.uuid(), position: z.number().int().min(0) }))
  .min(1)
  .max(200);

/** Mesmo desenho de `reordenarOpcoes`: tudo ou nada, dentro de uma única transação. */
export async function reordenarBlocos(
  propostaId: string,
  itens: z.infer<typeof reorderBlocosInput>,
): Promise<ServiceResult<null>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const parsed = reorderBlocosInput.safeParse(itens);
    if (!parsed.success) {
      throw new ServiceError('DADOS_INVALIDOS', 'Lista de blocos inválida.', {
        correcao: 'Recarregar a proposta',
      });
    }

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      await exigirProposta(tx, propostaId);

      let afetadas = 0;
      for (const item of parsed.data) {
        const linhas = await tx
          .update(proposalBlocks)
          .set({ position: item.position, updatedAt: new Date() })
          .where(and(eq(proposalBlocks.id, item.id), eq(proposalBlocks.proposalId, propostaId)))
          .returning({ id: proposalBlocks.id });
        afetadas += linhas.length;
      }

      if (afetadas !== parsed.data.length) {
        throw new ServiceError('CONFLITO', 'Um dos blocos não existe mais nesta proposta.', {
          correcao: 'Recarregar a proposta',
        });
      }
      return null;
    });
  });
}

/**
 * Copia um item do acervo (do próprio tenant OU global — a policy de SELECT de
 * `library_items` já resolve quais são visíveis) para dentro da proposta, como um bloco
 * novo. O item original não muda; isto é cópia, não referência — editar o bloco depois não
 * altera o item da biblioteca, e vice-versa.
 */
export async function inserirItemDaBibliotecaComoBloco(
  propostaId: string,
  libraryItemId: string,
  optionId?: string | null,
): Promise<ServiceResult<BlocoEdicao>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const alvoOpcao = optionId ?? null;

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      await exigirProposta(tx, propostaId);
      if (alvoOpcao) await exigirOpcaoDaProposta(tx, propostaId, alvoOpcao);

      const [item] = await tx
        .select({
          kind: libraryItems.kind,
          title: libraryItems.title,
          body: libraryItems.body,
          images: libraryItems.images,
          details: libraryItems.details,
        })
        .from(libraryItems)
        .where(eq(libraryItems.id, libraryItemId))
        .limit(1);

      // Zero linhas cobre dois casos ao mesmo tempo: o id não existe, OU não é visível
      // para este tenant (nem é do tenant, nem é global). Mesma resposta para os dois —
      // o chamador não descobre qual dos dois aconteceu.
      if (!item) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse item da biblioteca não existe mais.', {
          correcao: 'Escolher outro item',
        });
      }

      const existentes = await tx
        .select({ position: proposalBlocks.position })
        .from(proposalBlocks)
        .where(escopoDeBlocos(propostaId, alvoOpcao));

      const [criado] = await tx
        .insert(proposalBlocks)
        .values({
          tenantId,
          proposalId: propostaId,
          optionId: alvoOpcao,
          kind: item.kind,
          position: proximaPosicao(existentes),
          title: item.title,
          body: item.body,
          images: item.images,
          content: item.details,
        })
        .returning(COLUNAS_BLOCO);

      return criado! as BlocoEdicao;
    });
  });
}

// ---------------------------------------------------------------------------
// Upload de imagem
// ---------------------------------------------------------------------------

/**
 * Envia uma imagem para um bloco (ou para pré-visualizar antes de salvar o bloco) e
 * devolve a URL a colocar em `images[]`. Ver `src/server/storage.ts` para o
 * fallback de dev (sem `BLOB_READ_WRITE_TOKEN`, vira `data:` URL) e o caminho pronto para
 * o Vercel Blob quando a dependência existir.
 */
export async function enviarImagemDaProposta(
  arquivo: File,
): Promise<ServiceResult<{ url: string }>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    // S13a: gate de dunning — upload é etapa de edição, bloqueado também.
    await exigirContaAtivaForaDeTransacao(tenantId);
    const resultado = await enviarImagem(arquivo, tenantId);
    if (!resultado.ok) {
      throw new ServiceError('DADOS_INVALIDOS', resultado.mensagem, {
        correcao: resultado.correcao,
      });
    }
    return { url: resultado.url };
  });
}
