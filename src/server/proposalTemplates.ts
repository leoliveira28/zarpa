'use server';

import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { deals, proposalBlocks, proposalTemplates, proposals } from '@/db/schema';
import { withTenant } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { exigirContaAtiva } from './subscriptionGate';
import { registrarAuditoria } from './audit';

/**
 * Modelos de proposta — fase 1 do roadmap, o último 10% da página Orçamentos.
 *
 * Duas direções, a mesma tabela (`proposal_templates`, migration `0018`):
 *   - `criarTemplateDeProposta`: fotografa os blocos ATUAIS de uma proposta;
 *   - `criarPropostaDeTemplate`: nasce proposta draft com aqueles blocos por cima.
 *
 * A fotografia (não referência) é a decisão central: a proposta de origem pode ser
 * apagada, arquivada ou editada — o modelo sobrevive intacta. O comentário da migration
 * traz o desenho completo; aqui ficam as regras de superfície:
 *
 *   - `is_default` é UMA por tenant (partial unique no banco). Criar modelo NÃO torna ele
 *     padrão — `definirTemplatePadrao` existe porque sem ela o flag é inalcançável pela
 *     aplicação. É action EXTRA ao contrato travado: o contrato diz "a NovaPropostaSheet
 *     pré-seleciona o default", e alguém precisa poder escolher qual é.
 *   - Blocos de opção específica são achatados para o nível da proposta (sem `option_id`):
 *     a opção "econômico" de uma proposta antiga não significa nada numa proposta nova.
 *     `content` (nº do voo, diárias) entra inteiro de propósito — cortar chaves dele seria
 *     corromper conteúdo deliberado. Preço nunca esteve em bloco (é da opção) e segue fora.
 *   - Escritas passam pelo gate de dunning e por auditoria (`proposal_template.*`) —
 *     metadata sem conteúdo de bloco, que é grande e não é fato de auditoria.
 */

export type TemplateResumo = {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: Date;
};

/** A forma do bloco fotografado — a de `proposal_blocks` sem `option_id` e sem ids. */
export type BlocoDeTemplate = {
  kind: BlocoKindTemplate;
  position: number;
  title: string | null;
  body: string | null;
  images: string[];
  content: Record<string, unknown>;
};

/** Os MESMOS nove kinds de `proposal_blocks` — união literal, o que o insert do Drizzle exige. */
const KINDS = [
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

export type BlocoKindTemplate = (typeof KINDS)[number];

// ---------------------------------------------------------------------------
// Colunas explícitas — mesma disciplina de `proposals.ts`: a lista é o que impede um
// `select *` de um dia vazar coluna nova sem decisão.
// ---------------------------------------------------------------------------

const COLUNAS_TEMPLATE = {
  id: proposalTemplates.id,
  name: proposalTemplates.name,
  isDefault: proposalTemplates.isDefault,
  createdAt: proposalTemplates.createdAt,
} as const;

const COLUNAS_CONTEUDO = {
  name: proposalTemplates.name,
  blocks: proposalTemplates.blocks,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gerarTokenPublico(): string {
  // Mesmo desenho do `gerarTokenPublico` de `proposals.ts` e do `publicToken()` do seed:
  // 128 bits. Três cópias de propósito — Server Actions de arquivos diferentes não
  // compartilham helper não exportado, e o token é três linhas.
  return randomBytes(16).toString('base64url');
}

const KINDS_VALIDOS = new Set<string>(KINDS);

/**
 * Saneia um bloco vindo de jsonb (`proposal_templates.blocks` não tem CHECK de elemento —
 * jsonb mutável não promete forma). `kind` desconhecido vira `'text'`: o modelo não pode
 * falhar ao copiar por causa de um bloco escrito por outra versão do sistema.
 */
function paraBlocoDeTemplate(bruto: unknown, position: number): BlocoDeTemplate {
  const bloco = (typeof bruto === 'object' && bruto !== null ? bruto : {}) as Record<
    string,
    unknown
  >;
  const images = Array.isArray(bloco.images)
    ? bloco.images.filter((item): item is string => typeof item === 'string')
    : [];
  const content =
    typeof bloco.content === 'object' && bloco.content !== null
      ? (bloco.content as Record<string, unknown>)
      : {};
  const kind: BlocoKindTemplate =
    typeof bloco.kind === 'string' && KINDS_VALIDOS.has(bloco.kind)
      ? (bloco.kind as BlocoKindTemplate)
      : 'text';
  return {
    kind,
    position,
    title: typeof bloco.title === 'string' ? bloco.title : null,
    body: typeof bloco.body === 'string' ? bloco.body : null,
    images,
    content,
  };
}

function blocosDoTemplate(bruto: unknown): BlocoDeTemplate[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map(paraBlocoDeTemplate);
}

function erroZod(erro: z.ZodError): ServiceError {
  const primeiro = erro.issues[0];
  return new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
    campo: primeiro?.path.join('.'),
    correcao: 'Corrigir e tentar de novo',
  });
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** Modelos do tenant — o padrão primeiro, depois o mais recente. Leitura: sem gate. */
export async function listarTemplates(): Promise<ServiceResult<TemplateResumo[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      return tx
        .select(COLUNAS_TEMPLATE)
        .from(proposalTemplates)
        .orderBy(desc(proposalTemplates.isDefault), desc(proposalTemplates.createdAt));
    });
  });
}

/** O conteúdo (blocos) de um modelo — para pré-visualizar ou copiar na ponta da UI. */
export async function obterConteudoDoTemplate(
  templateId: string,
): Promise<ServiceResult<BlocoDeTemplate[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const parsed = z.uuid('Modelo inválido.').safeParse(templateId);
    if (!parsed.success) throw erroZod(parsed.error);

    return withTenant(tenantId, async (tx) => {
      const [modelo] = await tx
        .select(COLUNAS_CONTEUDO)
        .from(proposalTemplates)
        .where(eq(proposalTemplates.id, parsed.data))
        .limit(1);
      if (!modelo) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse modelo não existe mais.', {
          correcao: 'Voltar para a lista de modelos',
        });
      }
      return blocosDoTemplate(modelo.blocks);
    });
  });
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

const criarTemplateInput = z.object({
  proposalId: z.uuid('Escolha uma proposta'),
  name: z.string().trim().min(2, 'Dê um nome ao modelo — pelo menos 2 letras.').max(200),
});

/** Resumo do modelo recém-criado — a UI o coloca na lista na hora. */
export async function criarTemplateDeProposta(input: {
  proposalId: string;
  name: string;
}): Promise<ServiceResult<TemplateResumo>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const parsed = criarTemplateInput.safeParse(input);
    if (!parsed.success) throw erroZod(parsed.error);
    const { proposalId, name } = parsed.data;

    return withTenant(tenantId, async (tx) => {
      // Gate de dunning — toda escrita da casa começa por aqui.
      await exigirContaAtiva(tx, tenantId);

      const [proposta] = await tx
        .select({ id: proposals.id })
        .from(proposals)
        .where(eq(proposals.id, proposalId))
        .limit(1);
      if (!proposta) {
        throw new ServiceError('NAO_ENCONTRADO', 'Essa proposta não existe mais.', {
          campo: 'proposalId',
          correcao: 'Voltar para a lista de propostas',
        });
      }

      // Fotografia: lê os blocos como estão AGORA. Blocos de opção específica entram
      // achatados (sem option_id) — e a posição é renumerada 0..n-1 porque a numeração
      // original pode ter buracos de opções excluídas.
      const linhas = await tx
        .select({
          kind: proposalBlocks.kind,
          title: proposalBlocks.title,
          body: proposalBlocks.body,
          images: proposalBlocks.images,
          content: proposalBlocks.content,
        })
        .from(proposalBlocks)
        .where(eq(proposalBlocks.proposalId, proposalId))
        .orderBy(asc(proposalBlocks.position));

      if (linhas.length === 0) {
        throw new ServiceError(
          'CONFLITO',
          'Essa proposta não tem blocos para virar modelo.',
          { correcao: 'Montar a proposta antes de salvar como modelo' },
        );
      }

      const blocos: BlocoDeTemplate[] = linhas.map((linha, indice) =>
        paraBlocoDeTemplate(linha, indice),
      );

      const [criado] = await tx
        .insert(proposalTemplates)
        .values({ tenantId, name, blocks: blocos })
        .returning(COLUNAS_TEMPLATE);

      const modelo = criado!;

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'proposal_template.created',
        entity: 'proposal_template',
        entityId: modelo.id,
        // O fato, não o conteúdo: os blocos estão na própria tabela.
        metadata: { proposalId, totalBlocos: blocos.length },
      });

      return modelo;
    });
  });
}

const removerTemplateInput = z.object({ id: z.uuid('Modelo inválido.') });

export async function removerTemplate(id: string): Promise<ServiceResult<null>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const parsed = removerTemplateInput.safeParse({ id });
    if (!parsed.success) throw erroZod(parsed.error);

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);

      const [removido] = await tx
        .delete(proposalTemplates)
        .where(eq(proposalTemplates.id, parsed.data.id))
        .returning({ id: proposalTemplates.id });

      if (!removido) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse modelo não existe mais.', {
          correcao: 'Atualizar a lista de modelos',
        });
      }

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'proposal_template.deleted',
        entity: 'proposal_template',
        entityId: removido.id,
        metadata: {},
      });

      return null;
    });
  });
}

const templateIdInput = z.object({ templateId: z.uuid('Modelo inválido.') });

/**
 * Torna este modelo o padrão do tenant (o que a NovaPropostaSheet pré-seleciona).
 * Uma transação só: desliga os outros e liga este — o partial unique
 * `proposal_templates_tenant_default_key` é o cinto de segurança, não a regra.
 */
export async function definirTemplatePadrao(
  templateId: string,
): Promise<ServiceResult<TemplateResumo>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const parsed = templateIdInput.safeParse({ templateId });
    if (!parsed.success) throw erroZod(parsed.error);

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);

      await tx
        .update(proposalTemplates)
        .set({ isDefault: false })
        .where(
          and(eq(proposalTemplates.tenantId, tenantId), eq(proposalTemplates.isDefault, true)),
        );

      const [ligado] = await tx
        .update(proposalTemplates)
        .set({ isDefault: true })
        .where(eq(proposalTemplates.id, parsed.data.templateId))
        .returning(COLUNAS_TEMPLATE);

      if (!ligado) {
        // O throw derruba a transação inteira: os outros modelos NÃO ficam desligados.
        throw new ServiceError('NAO_ENCONTRADO', 'Esse modelo não existe mais.', {
          correcao: 'Atualizar a lista de modelos',
        });
      }

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'proposal_template.default_set',
        entity: 'proposal_template',
        entityId: ligado.id,
        metadata: {},
      });

      return ligado;
    });
  });
}

const criarDeTemplateInput = z.object({
  templateId: z.uuid('Escolha um modelo'),
  /**
   * O contrato travado traz `dealId?` opcional — mas `proposals.deal_id` é NOT NULL
   * (toda proposta nasce de um negócio, ver `criarPropostaAPartirDoNegocio`). O campo
   * continua opcional no tipo para o chamador não quebrar; em runtime a ausência vira
   * recusa com a correção certa, não um erro de banco. Divergência registrada no §12 do
   * handoff para a Nina.
   */
  dealId: z.uuid('Escolha um negócio').optional(),
});

export async function criarPropostaDeTemplate(input: {
  templateId: string;
  dealId?: string;
}): Promise<ServiceResult<{ proposalId: string }>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const parsed = criarDeTemplateInput.safeParse(input);
    if (!parsed.success) throw erroZod(parsed.error);
    const { templateId, dealId } = parsed.data;

    if (!dealId) {
      throw new ServiceError('DADOS_INVALIDOS', 'Escolha o negócio desta proposta.', {
        campo: 'dealId',
        correcao: 'Escolher o negócio e tentar de novo',
      });
    }

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);

      const [modelo] = await tx
        .select(COLUNAS_CONTEUDO)
        .from(proposalTemplates)
        .where(eq(proposalTemplates.id, templateId))
        .limit(1);
      if (!modelo) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse modelo não existe mais.', {
          campo: 'templateId',
          correcao: 'Escolher outro modelo',
        });
      }

      const blocos = blocosDoTemplate(modelo.blocks);
      if (blocos.length === 0) {
        throw new ServiceError('CONFLITO', 'Este modelo está vazio.', {
          correcao: 'Escolher outro modelo',
        });
      }

      // O negócio precisa existir NESTE tenant — com RLS, id de outro tenant não aparece.
      const [negocio] = await tx
        .select({ id: deals.id, title: deals.title, destination: deals.destination, currency: deals.currency })
        .from(deals)
        .where(eq(deals.id, dealId))
        .limit(1);
      if (!negocio) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse negócio não existe mais.', {
          campo: 'dealId',
          correcao: 'Escolher outro negócio',
        });
      }

      // Mesma regra de título do `criarPropostaAPartirDoNegocio` — criar de modelo é o
      // mesmo nascimento, só muda a origem dos blocos.
      const [criada] = await tx
        .insert(proposals)
        .values({
          tenantId,
          dealId: negocio.id,
          publicToken: gerarTokenPublico(),
          title: `Proposta — ${negocio.destination ?? negocio.title}`,
          status: 'draft',
          currency: negocio.currency,
        })
        .returning({ id: proposals.id });

      const proposta = criada!;

      await tx.insert(proposalBlocks).values(
        blocos.map((bloco) => ({
          tenantId,
          proposalId: proposta.id,
          // Sem option_id: numa proposta recém-nascida não há opção para apontar.
          optionId: null,
          kind: bloco.kind,
          position: bloco.position,
          title: bloco.title,
          body: bloco.body,
          images: bloco.images,
          content: bloco.content,
        })),
      );

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'proposal.created',
        entity: 'proposal',
        entityId: proposta.id,
        metadata: { dealId: negocio.id, templateId, origem: 'template' },
      });

      return { proposalId: proposta.id };
    });
  });
}
