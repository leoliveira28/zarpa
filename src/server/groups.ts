'use server';

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, deals, groupMembers, groups, receivables, sales } from '@/db/schema';
import { withTenant } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { registrarAuditoria } from './audit';
import { exigirContaAtiva } from './subscriptionGate';

/**
 * Grupos — o pacote com lugares (meta Grupos, `docs/GRUPOS_META.md`, 0025).
 *
 * A agente monta a saída antes de vender: lugares contados, preço/custo/
 * comissão/taxa POR LUGAR, e clientes/negócios ocupando. O DINHEIRO continua
 * morando em `sales` (regra da casa) — aqui não há receita, só ocupação e
 * fotografia de valores por lugar. Padrão de sempre: `requireAuthContext()` →
 * `withTenant` → zod antes do banco → `ServiceResult`; escrita passa por
 * `exigirContaAtiva`.
 */

export type GrupoStatus = 'montando' | 'vendendo' | 'encerrado';

export type GrupoResumo = {
  id: string;
  title: string;
  destination: string | null;
  departureOn: string | null;
  returnOn: string | null;
  totalSeats: number;
  /** Lugares ocupados pela soma dos membros. */
  lugaresOcupados: number;
  pricePerSeatCents: number;
  costPerSeatCents: number;
  commissionPerSeatCents: number;
  serviceFeePerSeatCents: number;
  /** Margem por lugar — o número que a agente leva na vida. */
  margemPorLugarCents: number;
  status: GrupoStatus;
  createdAt: Date;
};

export type MembroDoGrupo = {
  contactId: string;
  contactName: string;
  dealId: string | null;
  dealTitle: string | null;
  seats: number;
  createdAt: Date;
};

export type GrupoDetalhe = GrupoResumo & {
  members: MembroDoGrupo[];
};

const criarInput = z.object({
  title: z.string().trim().min(2, 'Dê um título ao grupo').max(200),
  destination: z.string().trim().max(200).optional().or(z.literal('')),
  totalSeats: z
    .number()
    .int('A quantidade de lugares tem que ser um número inteiro')
    .min(1, 'O grupo precisa de pelo menos 1 lugar')
    .max(500, 'O teto é 500 lugares — grupos maiores não cabem nesta régua'),
  pricePerSeatCents: z.number().int().min(0).optional(),
  costPerSeatCents: z.number().int().min(0).optional(),
  commissionPerSeatCents: z.number().int().min(0).optional(),
  serviceFeePerSeatCents: z.number().int().min(0).optional(),
});
export type CriarGrupoInput = z.infer<typeof criarInput>;

const atualizarInput = z.object({
  id: z.uuid('Grupo inválido'),
  title: z.string().trim().min(2).max(200).optional(),
  destination: z.string().trim().max(200).optional().or(z.literal('')),
  totalSeats: z.number().int().min(1).max(500).optional(),
  pricePerSeatCents: z.number().int().min(0).optional(),
  costPerSeatCents: z.number().int().min(0).optional(),
  commissionPerSeatCents: z.number().int().min(0).optional(),
  serviceFeePerSeatCents: z.number().int().min(0).optional(),
  status: z.enum(['montando', 'vendendo', 'encerrado']).optional(),
});
export type AtualizarGrupoInput = z.infer<typeof atualizarInput>;

const membroInput = z.object({
  groupId: z.uuid('Grupo inválido'),
  contactId: z.uuid('Escolha o cliente'),
  /** Negócio da reserva — opcional (reserva antes de negociação). */
  dealId: z.uuid('Negócio inválido').nullable().optional(),
  seats: z.number().int().min(1, 'Pelo menos 1 lugar').max(50).optional(),
});
export type MembroInput = z.infer<typeof membroInput>;

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

/** A ocupação somada — "sobram 4 lugares" é esta conta, sempre no servidor. */
async function lugaresOcupados(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  groupId: string,
): Promise<number> {
  const [linha] = await tx
    .select({ total: sql<number>`coalesce(sum(${groupMembers.seats}), 0)::int` })
    .from(groupMembers)
    .where(and(eq(groupMembers.tenantId, tenantId), eq(groupMembers.groupId, groupId)));
  return linha?.total ?? 0;
}

const COLUNAS_GRUPO = {
  id: groups.id,
  title: groups.title,
  destination: groups.destination,
  departureOn: groups.departureOn,
  returnOn: groups.returnOn,
  totalSeats: groups.totalSeats,
  pricePerSeatCents: groups.pricePerSeatCents,
  costPerSeatCents: groups.costPerSeatCents,
  commissionPerSeatCents: groups.commissionPerSeatCents,
  serviceFeePerSeatCents: groups.serviceFeePerSeatCents,
  status: groups.status,
  createdAt: groups.createdAt,
} as const;

function margemPorLugar(g: {
  pricePerSeatCents: number;
  costPerSeatCents: number;
  commissionPerSeatCents: number;
  serviceFeePerSeatCents: number;
}): number {
  return g.pricePerSeatCents - g.costPerSeatCents - g.commissionPerSeatCents - g.serviceFeePerSeatCents;
}

export async function criarGrupo(
  input: CriarGrupoInput,
): Promise<ServiceResult<GrupoResumo>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(criarInput, input);

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);

      const [criado] = await tx
        .insert(groups)
        .values({
          tenantId,
          title: dados.title,
          destination: dados.destination?.trim() || null,
          totalSeats: dados.totalSeats,
          pricePerSeatCents: dados.pricePerSeatCents ?? 0,
          costPerSeatCents: dados.costPerSeatCents ?? 0,
          commissionPerSeatCents: dados.commissionPerSeatCents ?? 0,
          serviceFeePerSeatCents: dados.serviceFeePerSeatCents ?? 0,
        })
        .returning(COLUNAS_GRUPO);

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'group.created',
        entity: 'group',
        entityId: criado!.id,
        metadata: { title: criado!.title, totalSeats: criado!.totalSeats },
      });

      return {
        ...criado!,
        lugaresOcupados: 0,
        margemPorLugarCents: margemPorLugar(criado!),
      } as GrupoResumo;
    });
  });
}

export async function listarGrupos(): Promise<ServiceResult<GrupoResumo[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const linhas = await tx
        .select(COLUNAS_GRUPO)
        .from(groups)
        .where(eq(groups.tenantId, tenantId))
        .orderBy(desc(groups.createdAt))
        .limit(100);

      return Promise.all(
        linhas.map(async (linha) => ({
          ...linha,
          lugaresOcupados: await lugaresOcupados(tx, tenantId, linha.id),
          margemPorLugarCents: margemPorLugar(linha),
        })),
      ) as Promise<GrupoResumo[]>;
    });
  });
}

export async function obterGrupo(grupoId: string): Promise<ServiceResult<GrupoDetalhe>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const [grupo] = await tx
        .select(COLUNAS_GRUPO)
        .from(groups)
        .where(and(eq(groups.id, grupoId), eq(groups.tenantId, tenantId)))
        .limit(1);
      if (!grupo) throw new ServiceError('NAO_ENCONTRADO', 'Grupo não encontrado.');

      const members = await tx
        .select({
          contactId: groupMembers.contactId,
          contactName: contacts.name,
          dealId: groupMembers.dealId,
          dealTitle: deals.title,
          seats: groupMembers.seats,
          createdAt: groupMembers.createdAt,
        })
        .from(groupMembers)
        .innerJoin(contacts, eq(contacts.id, groupMembers.contactId))
        .leftJoin(deals, eq(deals.id, groupMembers.dealId))
        .where(eq(groupMembers.groupId, grupoId))
        .orderBy(asc(groupMembers.createdAt));

      return {
        ...grupo,
        lugaresOcupados: await lugaresOcupados(tx, tenantId, grupoId),
        margemPorLugarCents: margemPorLugar(grupo),
        members,
      } as GrupoDetalhe;
    });
  });
}

/** Patch da ficha — campo a campo, como todo autosave da casa. */
export async function atualizarGrupo(
  input: AtualizarGrupoInput,
): Promise<ServiceResult<GrupoResumo>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(atualizarInput, input);

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);

      const [atual] = await tx
        .select(COLUNAS_GRUPO)
        .from(groups)
        .where(and(eq(groups.id, dados.id), eq(groups.tenantId, tenantId)))
        .limit(1);
      if (!atual) throw new ServiceError('NAO_ENCONTRADO', 'Grupo não encontrado.');

      const valores: Record<string, unknown> = { updatedAt: new Date() };
      if (dados.title !== undefined) valores.title = dados.title;
      if (dados.destination !== undefined) valores.destination = dados.destination.trim() || null;
      if (dados.totalSeats !== undefined) valores.totalSeats = dados.totalSeats;
      if (dados.pricePerSeatCents !== undefined) valores.pricePerSeatCents = dados.pricePerSeatCents;
      if (dados.costPerSeatCents !== undefined) valores.costPerSeatCents = dados.costPerSeatCents;
      if (dados.commissionPerSeatCents !== undefined) valores.commissionPerSeatCents = dados.commissionPerSeatCents;
      if (dados.serviceFeePerSeatCents !== undefined) valores.serviceFeePerSeatCents = dados.serviceFeePerSeatCents;
      if (dados.status !== undefined) valores.status = dados.status;

      // Reduzir lugares abaixo da ocupação é maquiar o que já foi vendido.
      if (dados.totalSeats !== undefined) {
        const ocupados = await lugaresOcupados(tx, tenantId, dados.id);
        if (dados.totalSeats < ocupados) {
          throw new ServiceError(
            'CONFLITO',
            `O grupo já tem ${ocupados} lugar(es) ocupado(s) — não dá para reduzir para ${dados.totalSeats}.`,
            { campo: 'totalSeats', correcao: 'Escolher um total igual ou maior que a ocupação' },
          );
        }
      }

      const [atualizado] = await tx
        .update(groups)
        .set(valores)
        .where(eq(groups.id, dados.id))
        .returning(COLUNAS_GRUPO);

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'group.updated',
        entity: 'group',
        entityId: dados.id,
        metadata: { campos: Object.keys(valores).filter((k) => k !== 'updatedAt') },
      });

      return {
        ...atualizado!,
        lugaresOcupados: await lugaresOcupados(tx, tenantId, dados.id),
        margemPorLugarCents: margemPorLugar(atualizado!),
      } as GrupoResumo;
    });
  });
}

/** Ocupa lugares: cliente (+ negócio opcional) entra no grupo. Idempotente na PK —
 * membro que já existe é recusa com a correção (mudou a quantidade, é outra ação). */
export async function adicionarMembroAoGrupo(
  input: MembroInput,
): Promise<ServiceResult<GrupoDetalhe>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(membroInput, input);

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);

      const [grupo] = await tx
        .select(COLUNAS_GRUPO)
        .from(groups)
        .where(and(eq(groups.id, dados.groupId), eq(groups.tenantId, tenantId)))
        .limit(1);
      if (!grupo) throw new ServiceError('NAO_ENCONTRADO', 'Grupo não encontrado.');
      if (grupo.status === 'encerrado') {
        throw new ServiceError('CONFLITO', 'Este grupo já encerrou — a saída passou.', {
          correcao: 'Criar um novo grupo para a próxima saída',
        });
      }

      const [contato] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.id, dados.contactId))
        .limit(1);
      if (!contato) throw new ServiceError('NAO_ENCONTRADO', 'Esse contato não existe mais.');

      if (dados.dealId) {
        const [deal] = await tx
          .select({ id: deals.id })
          .from(deals)
          .where(eq(deals.id, dados.dealId))
          .limit(1);
        if (!deal) throw new ServiceError('NAO_ENCONTRADO', 'Esse negócio não existe mais.');
      }

      const [existente] = await tx
        .select({ contactId: groupMembers.contactId })
        .from(groupMembers)
        .where(
          and(eq(groupMembers.groupId, dados.groupId), eq(groupMembers.contactId, dados.contactId)),
        )
        .limit(1);
      if (existente) {
        throw new ServiceError('CONFLITO', 'Esse cliente já ocupa lugar neste grupo.', {
          correcao: 'Atualizar a quantidade de lugares dele',
        });
      }

      const seats = dados.seats ?? 1;
      const ocupados = await lugaresOcupados(tx, tenantId, dados.groupId);
      if (ocupados + seats > grupo.totalSeats) {
        throw new ServiceError(
          'CONFLITO',
          `Só restam ${grupo.totalSeats - ocupados} lugar(es) neste grupo.`,
          {
            correcao: 'Aumentar o total de lugares ou reduzir a quantidade',
          },
        );
      }

      await tx.insert(groupMembers).values({
        tenantId,
        groupId: dados.groupId,
        contactId: dados.contactId,
        dealId: dados.dealId ?? null,
        seats,
      });

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'group.member_added',
        entity: 'group',
        entityId: dados.groupId,
        metadata: { contactId: dados.contactId, seats },
      });

      const detalhe = await tx
        .select(COLUNAS_GRUPO)
        .from(groups)
        .where(eq(groups.id, dados.groupId))
        .limit(1);
      const members = await tx
        .select({
          contactId: groupMembers.contactId,
          contactName: contacts.name,
          dealId: groupMembers.dealId,
          dealTitle: deals.title,
          seats: groupMembers.seats,
          createdAt: groupMembers.createdAt,
        })
        .from(groupMembers)
        .innerJoin(contacts, eq(contacts.id, groupMembers.contactId))
        .leftJoin(deals, eq(deals.id, groupMembers.dealId))
        .where(eq(groupMembers.groupId, dados.groupId))
        .orderBy(asc(groupMembers.createdAt));

      return {
        ...detalhe[0]!,
        lugaresOcupados: ocupados + seats,
        margemPorLugarCents: margemPorLugar(detalhe[0]!),
        members,
      } as GrupoDetalhe;
    });
  });
}

/** Libera lugares: o membro sai e a ocupação volta. Deletar é seguro aqui — a
 * ocupação não é histórico financeiro (o dinheiro mora nas vendas). */
export async function removerMembroDoGrupo(
  input: { groupId: string; contactId: string },
): Promise<ServiceResult<GrupoDetalhe>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(
      z.object({ groupId: z.uuid(), contactId: z.uuid() }),
      input,
    );

    return withTenant(tenantId, async (tx) => {
      await exigirContaAtiva(tx, tenantId);

      const apagadas = await tx
        .delete(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, dados.groupId),
            eq(groupMembers.contactId, dados.contactId),
            eq(groupMembers.tenantId, tenantId),
          ),
        )
        .returning({ contactId: groupMembers.contactId });
      if (apagadas.length === 0) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse cliente não está no grupo.');
      }

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'group.member_removed',
        entity: 'group',
        entityId: dados.groupId,
        metadata: { contactId: dados.contactId },
      });

      return obterGrupoInterno(tx, tenantId, dados.groupId);
    });
  });
}

/** Leitura interna compartilhada (mesma transação do escritor). */
async function obterGrupoInterno(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  grupoId: string,
): Promise<GrupoDetalhe> {
  const [grupo] = await tx
    .select(COLUNAS_GRUPO)
    .from(groups)
    .where(and(eq(groups.id, grupoId), eq(groups.tenantId, tenantId)))
    .limit(1);
  if (!grupo) throw new ServiceError('NAO_ENCONTRADO', 'Grupo não encontrado.');

  const members = await tx
    .select({
      contactId: groupMembers.contactId,
      contactName: contacts.name,
      dealId: groupMembers.dealId,
      dealTitle: deals.title,
      seats: groupMembers.seats,
      createdAt: groupMembers.createdAt,
    })
    .from(groupMembers)
    .innerJoin(contacts, eq(contacts.id, groupMembers.contactId))
    .leftJoin(deals, eq(deals.id, groupMembers.dealId))
    .where(eq(groupMembers.groupId, grupoId))
    .orderBy(asc(groupMembers.createdAt));

  return {
    ...grupo,
    lugaresOcupados: await lugaresOcupados(tx, tenantId, grupoId),
    margemPorLugarCents: margemPorLugar(grupo),
    members,
  } as GrupoDetalhe;
}

// ---------------------------------------------------------------------------
// Fase 6b — o grupo como lente sobre o dinheiro que JÁ existe: o chip na
// ficha/funil e as parcelas dos negócios membros. Zero escrita nova — o
// dinheiro mora em `sales`/`receivables`; aqui é só leitura com a lente.
// ---------------------------------------------------------------------------

/** O grupo de um negócio (para o chip na ficha e no card do funil). */
export async function grupoDoNegocio(
  dealId: string,
): Promise<ServiceResult<{ id: string; title: string; seats: number } | null>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const [linha] = await tx
        .select({
          id: groups.id,
          title: groups.title,
          seats: groupMembers.seats,
        })
        .from(groupMembers)
        .innerJoin(groups, eq(groups.id, groupMembers.groupId))
        .where(and(eq(groupMembers.tenantId, tenantId), eq(groupMembers.dealId, dealId)))
        .limit(1);
      return linha ?? null;
    });
  });
}

export type ParcelasDoGrupo = {
  members: Array<{
    contactId: string;
    contactName: string;
    dealId: string | null;
    dealTitle: string | null;
    /** A reserva em dinheiro: soma das parcelas dos negócios membros (null sem negócio). */
    totalCents: number | null;
    pagoCents: number;
    aPagarCents: number;
    parcelas: number;
  }>;
  /** Sem negócio vinculado não há venda, logo não há parcela — a linha é a leitura honesta. */
  semNegocio: Array<{ contactId: string; contactName: string; seats: number }>;
};

/**
 * As parcelas DA RESERVA (Fase 6b): para cada membro com negócio, a soma das
 * parcelas da(s) venda(s) daquele negócio — pago/a pagar. O parcelamento é o
 * de sempre (o da venda, com juros editáveis e etiqueta de comprador da 5a);
 * o grupo apenas LÊ. Venda sem parcelas geradas ainda conta o valor bruto
 * como a pagar — reserva fechada é compromisso, mesmo sem cronograma.
 */
export async function parcelasDoGrupo(
  groupId: string,
): Promise<ServiceResult<ParcelasDoGrupo>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const membros = await tx
        .select({
          contactId: groupMembers.contactId,
          contactName: contacts.name,
          dealId: groupMembers.dealId,
          dealTitle: deals.title,
          seats: groupMembers.seats,
        })
        .from(groupMembers)
        .innerJoin(contacts, eq(contacts.id, groupMembers.contactId))
        .leftJoin(deals, eq(deals.id, groupMembers.dealId))
        .where(and(eq(groupMembers.tenantId, tenantId), eq(groupMembers.groupId, groupId)))
        .orderBy(asc(groupMembers.createdAt));

      const members: ParcelasDoGrupo['members'] = [];
      const semNegocio: ParcelasDoGrupo['semNegocio'] = [];

      for (const membro of membros) {
        if (!membro.dealId) {
          semNegocio.push({ contactId: membro.contactId, contactName: membro.contactName, seats: membro.seats });
          continue;
        }

        const [venda] = await tx
          .select({ id: sales.id, valorBrutoCents: sales.valorBrutoCents })
          .from(sales)
          .where(eq(sales.dealId, membro.dealId))
          .orderBy(desc(sales.createdAt))
          .limit(1);

        if (!venda) {
          // Negócio sem venda: a reserva existe, o dinheiro ainda não.
          members.push({
            contactId: membro.contactId,
            contactName: membro.contactName,
            dealId: membro.dealId,
            dealTitle: membro.dealTitle,
            totalCents: null,
            pagoCents: 0,
            aPagarCents: 0,
            parcelas: 0,
          });
          continue;
        }

        const parcelas = await tx
          .select({ status: receivables.status, valorCents: receivables.valorCents })
          .from(receivables)
          .where(eq(receivables.saleId, venda.id));

        const vivas = parcelas.filter((p) => p.status !== 'cancelado');
        const pagoCents = vivas.filter((p) => p.status === 'pago').reduce((t, p) => t + p.valorCents, 0);
        const aPagarCents = vivas
          .filter((p) => p.status === 'pendente' || p.status === 'atrasado')
          .reduce((t, p) => t + p.valorCents, 0);

        members.push({
          contactId: membro.contactId,
          contactName: membro.contactName,
          dealId: membro.dealId,
          dealTitle: membro.dealTitle,
          totalCents: venda.valorBrutoCents,
          pagoCents,
          // Sem cronograma, o compromisso é o valor bruto menos o que entrou.
          aPagarCents: vivas.length > 0 ? aPagarCents : Math.max(venda.valorBrutoCents - pagoCents, 0),
          parcelas: vivas.length,
        });
      }

      return { members, semNegocio };
    });
  });
}

/**
 * O resumo de TODOS os grupos do tenant para a sub-aba de Relatórios (6b):
 * lugares, receita prevista (vendas dos negócios membros) e realizada (parcelas
 * pagas), margem por lugar do pacote. Mesma lente: nada aqui grava dinheiro.
 */
export async function resumoDosGrupos(): Promise<
  ServiceResult<
    Array<{
      id: string;
      title: string;
      status: GrupoStatus;
      totalSeats: number;
      lugaresOcupados: number;
      pricePerSeatCents: number;
      margemPorLugarCents: number;
      receitaPrevistaCents: number;
      receitaRealizadaCents: number;
      totalMembros: number;
    }>
  >
> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const linhas = await tx
        .select(COLUNAS_GRUPO)
        .from(groups)
        .where(eq(groups.tenantId, tenantId))
        .orderBy(desc(groups.createdAt))
        .limit(100);

      return Promise.all(
        linhas.map(async (grupo) => {
          const membros = await tx
            .select({ dealId: groupMembers.dealId, seats: groupMembers.seats })
            .from(groupMembers)
            .where(and(eq(groupMembers.tenantId, tenantId), eq(groupMembers.groupId, grupo.id)));

          const dealIds = membros.map((m) => m.dealId).filter((id): id is string => id !== null);

          let prevista = 0;
          let realizada = 0;
          for (const dealId of dealIds) {
            const vendas = await tx
              .select({ id: sales.id, valorBrutoCents: sales.valorBrutoCents })
              .from(sales)
              .where(eq(sales.dealId, dealId));
            for (const venda of vendas) {
              prevista += venda.valorBrutoCents;
              const [pago] = await tx
                .select({ total: sql<number>`coalesce(sum(${receivables.valorCents}), 0)::int` })
                .from(receivables)
                .where(and(eq(receivables.saleId, venda.id), eq(receivables.status, 'pago')));
              realizada += pago?.total ?? 0;
            }
          }

          const lugaresOcupados = membros.reduce((total, m) => total + m.seats, 0);

          return {
            id: grupo.id,
            title: grupo.title,
            status: grupo.status,
            totalSeats: grupo.totalSeats,
            lugaresOcupados,
            pricePerSeatCents: grupo.pricePerSeatCents,
            margemPorLugarCents: margemPorLugar(grupo),
            receitaPrevistaCents: prevista,
            receitaRealizadaCents: realizada,
            totalMembros: membros.length,
          };
        }),
      );
    });
  });
}
