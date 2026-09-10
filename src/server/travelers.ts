'use server';

import { and, asc, desc, eq, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, dealContacts, deals, travelers } from '@/db/schema';
import { withTenant } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { maskDocument } from '@/lib/crypto';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { exigirContaAtiva } from './subscriptionGate';
import { registrarAuditoria } from './audit';
import { cpfValido, parseDataFlexivel } from './normalize';
import { camposCpfDoViajante, camposNascimento, hashesDeBusca, pareceCpf } from './piiFields';

/**
 * Passageiros. Mesmas quatro regras de `contacts.ts`: tenant da sessão, tudo dentro de
 * `withTenant`, `tenant_id` escrito aqui, PII fora das listagens.
 *
 * O passageiro pertence a um contato (`contact_id NOT NULL`): não existe passageiro solto,
 * sempre há alguém que comprou. Quem viaja sozinho é passageiro de si mesmo.
 *
 * `passportExpiresOn` fica EM CLARO e é `date`: validade de passaporte não é dado sensível
 * e é justamente o que o alerta consulta. Já `cpf`, `passportNumber` e `birthDate` são
 * cifrados; o CPF ganha índice cego para busca e deduplicação.
 */

const viajanteInput = z.object({
  contactId: z.uuid('Passageiro precisa estar ligado a um contato'),
  fullName: z.string().trim().min(2, 'Nome precisa de pelo menos 2 letras').max(160),
  kind: z.enum(['adult', 'child', 'infant']).optional(),
  cpf: z.string().trim().max(32).optional().or(z.literal('')),
  passportNumber: z.string().trim().max(32).optional().or(z.literal('')),
  passportExpiresOn: z.string().trim().max(20).optional().or(z.literal('')),
  birthDate: z.string().trim().max(20).optional().or(z.literal('')),
  nationality: z.string().trim().length(2, 'Use a sigla de 2 letras (BR, PT, US)').optional(),
  notes: z.string().trim().max(4000).optional().or(z.literal('')),
});

export type ViajanteInput = z.infer<typeof viajanteInput>;
export type ViajantePatch = Partial<Omit<ViajanteInput, 'contactId'>>;

/** Sem CPF e sem passaporte. Só a marca de que existem, e a validade (que não é sensível). */
export type ViajanteResumo = {
  id: string;
  contactId: string;
  fullName: string;
  kind: string;
  nationality: string;
  temCpf: boolean;
  temPassaporte: boolean;
  passportExpiresOn: string | null;
  aniversario: string | null;
  createdAt: Date;
};

const COLUNAS_RESUMO = {
  id: travelers.id,
  contactId: travelers.contactId,
  fullName: travelers.fullName,
  kind: travelers.kind,
  nationality: travelers.nationality,
  temCpf: sql<boolean>`${travelers.cpfHash} is not null`,
  temPassaporte: sql<boolean>`${travelers.passportNumber} is not null`,
  passportExpiresOn: travelers.passportExpiresOn,
  aniversario: travelers.birthMonthDay,
  createdAt: travelers.createdAt,
} as const;

function vazioParaNulo(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function validar(input: unknown, parcial: boolean): Partial<ViajanteInput> {
  const schema = parcial ? viajanteInput.omit({ contactId: true }).partial() : viajanteInput;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const primeiro = parsed.error.issues[0];
    throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
      campo: primeiro?.path.join('.'),
      correcao: 'Corrigir e salvar de novo',
    });
  }
  return parsed.data as Partial<ViajanteInput>;
}

function dataOuErro(valor: string | null, campo: string, rotulo: string): string | null {
  if (!valor) return null;
  const iso = parseDataFlexivel(valor);
  if (!iso) {
    throw new ServiceError('DADOS_INVALIDOS', `Não entendi ${rotulo}.`, {
      campo,
      correcao: 'Usar o formato DD/MM/AAAA',
    });
  }
  return iso;
}

export type FiltroViajantes = {
  contatoId?: string;
  /** Nome ou CPF. */
  busca?: string;
  limite?: number;
};

export async function listarViajantes(
  filtro?: FiltroViajantes,
): Promise<ServiceResult<ViajanteResumo[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const limite = Math.min(Math.max(filtro?.limite ?? 50, 1), 200);
    const busca = filtro?.busca?.trim();

    return withTenant(tenantId, async (tx) => {
      const condicoes = [];
      if (filtro?.contatoId) condicoes.push(eq(travelers.contactId, filtro.contatoId));

      if (busca && busca.length > 0) {
        const alternativas = [sql`${travelers.fullName} ilike ${'%' + busca + '%'}`];
        if (pareceCpf(busca)) {
          const candidatos = hashesDeBusca('travelers.cpf', tenantId, busca);
          if (candidatos.length > 0) alternativas.push(inArray(travelers.cpfHash, candidatos));
        }
        condicoes.push(or(...alternativas));
      }

      const linhas = await tx
        .select(COLUNAS_RESUMO)
        .from(travelers)
        .where(condicoes.length > 0 ? and(...condicoes) : undefined)
        .orderBy(desc(travelers.createdAt))
        .limit(limite);

      return linhas as ViajanteResumo[];
    });
  });
}

export async function obterViajante(viajanteId: string): Promise<ServiceResult<ViajanteResumo>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const [linha] = await tx
        .select(COLUNAS_RESUMO)
        .from(travelers)
        .where(eq(travelers.id, viajanteId))
        .limit(1);

      if (!linha) {
        throw new ServiceError('NAO_ENCONTRADO', 'Passageiro não encontrado.', {
          correcao: 'Voltar para o contato',
        });
      }
      return linha as ViajanteResumo;
    });
  });
}

export async function buscarViajantePorCpf(
  cpf: string,
): Promise<ServiceResult<ViajanteResumo | null>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();

    if (!pareceCpf(cpf)) {
      throw new ServiceError('DADOS_INVALIDOS', 'Digite um CPF com 11 dígitos.', {
        campo: 'cpf',
        correcao: 'Corrigir o CPF',
      });
    }
    const candidatos = hashesDeBusca('travelers.cpf', tenantId, cpf);

    return withTenant(tenantId, async (tx) => {
      const [linha] = await tx
        .select(COLUNAS_RESUMO)
        .from(travelers)
        .where(and(isNotNull(travelers.cpfHash), inArray(travelers.cpfHash, candidatos)))
        .limit(1);

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'traveler.searched_by_document',
        entity: 'traveler',
        entityId: linha?.id,
        metadata: { documento: maskDocument(cpf), encontrou: Boolean(linha) },
      });

      return (linha ?? null) as ViajanteResumo | null;
    });
  });
}

export async function criarViajante(input: ViajanteInput): Promise<ServiceResult<ViajanteResumo>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(input, false) as ViajanteInput;

    const cpf = vazioParaNulo(dados.cpf);
    if (cpf && !cpfValido(cpf)) {
      throw new ServiceError('DADOS_INVALIDOS', 'Esse CPF não é válido.', {
        campo: 'cpf',
        correcao: 'Conferir o CPF',
      });
    }

    const campos = camposCpfDoViajante(tenantId, cpf);
    const nascimento = camposNascimento(dados.birthDate);
    const validade = dataOuErro(
      vazioParaNulo(dados.passportExpiresOn),
      'passportExpiresOn',
      'a validade do passaporte',
    );

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      // O contato precisa existir NESTE tenant. Com RLS, um id de outro tenant
      // simplesmente não aparece aqui — a mensagem é a mesma de id inexistente, e é
      // assim que tem que ser: o chamador não descobre que o id existe em outro lugar.
      const [dono] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(eq(contacts.id, dados.contactId))
        .limit(1);

      if (!dono) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse contato não existe mais.', {
          campo: 'contactId',
          correcao: 'Voltar para a lista',
        });
      }

      if (campos.cpfHash) {
        const [existente] = await tx
          .select({ id: travelers.id })
          .from(travelers)
          .where(eq(travelers.cpfHash, campos.cpfHash))
          .limit(1);
        if (existente) {
          throw new ServiceError('CONFLITO', 'Já existe um passageiro com esse CPF.', {
            campo: 'cpf',
            correcao: 'Abrir o passageiro existente',
          });
        }
      }

      const [criado] = await tx
        .insert(travelers)
        .values({
          tenantId,
          contactId: dados.contactId,
          fullName: dados.fullName,
          kind: dados.kind ?? 'adult',
          ...campos,
          passportNumber: vazioParaNulo(dados.passportNumber),
          passportExpiresOn: validade,
          birthDate: nascimento.birthDate,
          birthMonthDay: nascimento.birthMonthDay,
          nationality: dados.nationality?.toUpperCase() ?? 'BR',
          notes: vazioParaNulo(dados.notes),
        })
        .returning(COLUNAS_RESUMO);

      const viajante = criado!;

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'traveler.created',
        entity: 'traveler',
        entityId: viajante.id,
        metadata: { comCpf: Boolean(campos.cpf), comPassaporte: Boolean(dados.passportNumber) },
      });

      return viajante as ViajanteResumo;
    });
  });
}

export async function atualizarViajante(
  viajanteId: string,
  patch: ViajantePatch,
): Promise<ServiceResult<ViajanteResumo>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(patch, true);

    const valores: Record<string, unknown> = { updatedAt: new Date() };
    const mudou: string[] = [];

    if (dados.fullName !== undefined) {
      valores.fullName = dados.fullName;
      mudou.push('fullName');
    }
    if (dados.kind !== undefined) {
      valores.kind = dados.kind;
      mudou.push('kind');
    }
    if (dados.nationality !== undefined) {
      valores.nationality = dados.nationality.toUpperCase();
      mudou.push('nationality');
    }
    if (dados.notes !== undefined) {
      valores.notes = vazioParaNulo(dados.notes);
      mudou.push('notes');
    }
    if (dados.passportNumber !== undefined) {
      valores.passportNumber = vazioParaNulo(dados.passportNumber);
      mudou.push('passportNumber');
    }
    if (dados.passportExpiresOn !== undefined) {
      valores.passportExpiresOn = dataOuErro(
        vazioParaNulo(dados.passportExpiresOn),
        'passportExpiresOn',
        'a validade do passaporte',
      );
      mudou.push('passportExpiresOn');
    }
    if (dados.birthDate !== undefined) {
      const nascimento = camposNascimento(dados.birthDate);
      if (vazioParaNulo(dados.birthDate) && !nascimento.birthDate) {
        throw new ServiceError('DADOS_INVALIDOS', 'Não entendi essa data de nascimento.', {
          campo: 'birthDate',
          correcao: 'Usar o formato DD/MM/AAAA',
        });
      }
      valores.birthDate = nascimento.birthDate;
      valores.birthMonthDay = nascimento.birthMonthDay;
      mudou.push('birthDate');
    }
    if (dados.cpf !== undefined) {
      const cpf = vazioParaNulo(dados.cpf);
      if (cpf && !cpfValido(cpf)) {
        throw new ServiceError('DADOS_INVALIDOS', 'Esse CPF não é válido.', {
          campo: 'cpf',
          correcao: 'Conferir o CPF',
        });
      }
      Object.assign(valores, camposCpfDoViajante(tenantId, cpf));
      mudou.push('cpf');
    }

    if (mudou.length === 0) {
      throw new ServiceError('DADOS_INVALIDOS', 'Nada para salvar.', { correcao: 'Fechar' });
    }

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const linhas = await tx
        .update(travelers)
        .set(valores)
        .where(eq(travelers.id, viajanteId))
        .returning(COLUNAS_RESUMO);

      const viajante = linhas[0];
      if (!viajante) {
        throw new ServiceError('NAO_ENCONTRADO', 'Passageiro não encontrado.', {
          correcao: 'Voltar para o contato',
        });
      }

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'traveler.updated',
        entity: 'traveler',
        entityId: viajanteId,
        metadata: { campos: mudou },
      });

      return viajante as ViajanteResumo;
    });
  });
}

export async function excluirViajante(viajanteId: string): Promise<ServiceResult<null>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const afetadas = await tx
        .delete(travelers)
        .where(eq(travelers.id, viajanteId))
        .returning({ id: travelers.id });

      if (afetadas.length === 0) {
        throw new ServiceError('NAO_ENCONTRADO', 'Passageiro não encontrado.', {
          correcao: 'Voltar para o contato',
        });
      }

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'traveler.deleted',
        entity: 'traveler',
        entityId: viajanteId,
      });

      return null;
    });
  });
}

/**
 * Leitura explícita do documento de um passageiro.
 *
 * Separada do resto porque ler CPF/passaporte é um ato que deve deixar rastro. Toda
 * chamada grava em `audit_log`. Se um dia alguém perguntar "quem viu o CPF do cliente X",
 * a resposta existe.
 */
export async function obterDocumentoDoViajante(
  viajanteId: string,
): Promise<ServiceResult<{ cpf: string | null; passaporte: string | null; nascimento: string | null }>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const [linha] = await tx
        .select({
          cpf: travelers.cpf,
          passaporte: travelers.passportNumber,
          nascimento: travelers.birthDate,
        })
        .from(travelers)
        .where(eq(travelers.id, viajanteId))
        .limit(1);

      if (!linha) {
        throw new ServiceError('NAO_ENCONTRADO', 'Passageiro não encontrado.');
      }

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'traveler.document_viewed',
        entity: 'traveler',
        entityId: viajanteId,
      });

      return linha;
    });
  });
}

/** Passaportes que vencem em até N dias — a mesma consulta que o cron de alertas usa. */
export async function listarPassaportesVencendo(
  dias = 90,
): Promise<ServiceResult<(ViajanteResumo & { contatoNome: string })[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const limite = new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    return withTenant(tenantId, async (tx) => {
      const linhas = await tx
        .select({ ...COLUNAS_RESUMO, contatoNome: contacts.name })
        .from(travelers)
        .innerJoin(contacts, eq(contacts.id, travelers.contactId))
        .where(
          and(isNotNull(travelers.passportExpiresOn), lte(travelers.passportExpiresOn, limite)),
        )
        .orderBy(asc(travelers.passportExpiresOn))
        .limit(200);

      return linhas as (ViajanteResumo & { contatoNome: string })[];
    });
  });
}

// ---------------------------------------------------------------------------
// Viajantes do NEGÓCIO (Fase 5a, `docs/FASE5_EXCURSAO.md`) — a lista que vai
// para o fornecedor e alimenta o card da ficha. Varre `deal_contacts` (0020):
// na excursão, os viajantes cadastrados nos contatos secundários são tantos
// quanto os do titular, e a lista presa a `deals.contact_id` sumia com eles.
//
// Ordem = MESMA política dos nomes da 0021 (titular primeiro, depois a ordem
// de entrada do comprador, e dentro do comprador a ordem de cadastro do
// viajante) — uma leitura só, dois consumidores (card + CSV).
// ---------------------------------------------------------------------------

export type ViajanteDoNegocio = {
  id: string;
  contactId: string;
  /** Quem comprou — o que agrupa a lista na excursão. */
  comprador: string;
  /** Titular do negócio (o primeiro da lista, por definição da ordem). */
  isTitular: boolean;
  fullName: string;
  kind: 'adult' | 'child' | 'infant';
  nationality: string;
  temCpf: boolean;
  temPassaporte: boolean;
  passportExpiresOn: string | null;
};

export async function listarViajantesDoNegocio(
  negocioId: string,
): Promise<ServiceResult<ViajanteDoNegocio[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const linhas = await tx
        .select({
          id: travelers.id,
          contactId: travelers.contactId,
          comprador: contacts.name,
          principal: dealContacts.principal,
          fullName: travelers.fullName,
          kind: travelers.kind,
          nationality: travelers.nationality,
          temCpf: sql<boolean>`${travelers.cpfHash} is not null`,
          temPassaporte: sql<boolean>`${travelers.passportNumber} is not null`,
          passportExpiresOn: travelers.passportExpiresOn,
        })
        .from(deals)
        .innerJoin(dealContacts, eq(dealContacts.dealId, deals.id))
        .innerJoin(contacts, eq(contacts.id, dealContacts.contactId))
        .innerJoin(travelers, eq(travelers.contactId, dealContacts.contactId))
        .where(eq(deals.id, negocioId))
        .orderBy(desc(dealContacts.principal), asc(dealContacts.createdAt), asc(travelers.createdAt))
        .limit(200);

      return linhas.map((l) => ({
        id: l.id,
        contactId: l.contactId,
        comprador: l.comprador,
        isTitular: l.principal,
        fullName: l.fullName,
        kind: l.kind,
        nationality: l.nationality,
        temCpf: l.temCpf,
        temPassaporte: l.temPassaporte,
        passportExpiresOn: l.passportExpiresOn,
      }));
    });
  });
}
