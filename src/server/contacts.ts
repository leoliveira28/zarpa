'use server';

import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, travelers, auditLog } from '@/db/schema';
import { withTenant, type TenantDb } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { ServiceError, comoResultado, type ServiceResult } from './errors';

/**
 * Serviço de contatos — o padrão que todo serviço deste projeto segue.
 *
 * As quatro regras que se repetem em todo arquivo de `src/server/`:
 *
 *  1. O `tenantId` vem de `requireAuthContext()`, ou seja, da sessão. NUNCA é parâmetro
 *     da função. Uma Server Action é um endpoint HTTP: tudo que é argumento veio do
 *     cliente e pode ser mentira.
 *  2. Toda query roda dentro de `withTenant`. O RLS é a rede de segurança, não a primeira
 *     linha de defesa — mas é ele que transforma um `where` esquecido em zero linhas em
 *     vez de vazamento.
 *  3. Nada de `tenant_id` vindo no corpo do request. O valor é escrito aqui.
 *  4. PII sai por padrão MASCARADA. Ver `listarContatos` vs `obterDocumentoDoViajante`.
 */

const contatoInput = z.object({
  name: z.string().trim().min(2, 'Nome precisa de pelo menos 2 letras').max(160),
  email: z.email('E-mail inválido').max(200).optional().or(z.literal('')),
  phone: z.string().trim().max(32).optional().or(z.literal('')),
  whatsapp: z.string().trim().max(32).optional().or(z.literal('')),
  document: z.string().trim().max(32).optional().or(z.literal('')),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD')
    .optional()
    .or(z.literal('')),
  source: z
    .enum(['whatsapp', 'instagram', 'indicacao', 'site', 'evento', 'outro'])
    .optional(),
  notes: z.string().trim().max(4000).optional().or(z.literal('')),
});

export type ContatoInput = z.infer<typeof contatoInput>;

/** O que a interface recebe. Sem CPF, sem nascimento — só a marca de que existem. */
export type ContatoResumo = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  source: string | null;
  temDocumento: boolean;
  createdAt: Date;
};

function vazioParaNulo(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Lista de contatos.
 *
 * A lista de colunas é explícita de propósito. Um `select()` sem colunas traria
 * `document` e `birthDate`, que são `encryptedText` — o Drizzle decifraria os dois em
 * memória para montar cada linha e o CPF de todo mundo viajaria até o componente. A
 * decisão de ler documento é sempre consciente, nunca efeito colateral de um `select *`.
 */
export async function listarContatos(
  filtro?: { busca?: string; limite?: number },
): Promise<ServiceResult<ContatoResumo[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const limite = Math.min(Math.max(filtro?.limite ?? 50, 1), 200);
    const busca = filtro?.busca?.trim();

    return withTenant(tenantId, async (tx) => {
      const linhas = await tx
        .select({
          id: contacts.id,
          name: contacts.name,
          email: contacts.email,
          phone: contacts.phone,
          whatsapp: contacts.whatsapp,
          source: contacts.source,
          temDocumento: sql<boolean>`${contacts.document} is not null`,
          createdAt: contacts.createdAt,
        })
        .from(contacts)
        .where(
          busca
            ? and(
                isNull(contacts.archivedAt),
                or(
                  ilike(contacts.name, `%${busca}%`),
                  ilike(contacts.email, `%${busca}%`),
                  ilike(contacts.phone, `%${busca}%`),
                ),
              )
            : isNull(contacts.archivedAt),
        )
        .orderBy(desc(contacts.createdAt))
        .limit(limite);

      return linhas as ContatoResumo[];
    });
  });
}

export async function criarContato(input: ContatoInput): Promise<ServiceResult<ContatoResumo>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();

    const parsed = contatoInput.safeParse(input);
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
        campo: primeiro?.path.join('.'),
        correcao: 'Corrigir e salvar de novo',
      });
    }
    const dados = parsed.data;

    return withTenant(tenantId, async (tx) => {
      const email = vazioParaNulo(dados.email);
      if (email) {
        // Índice único parcial em (tenant_id, lower(email)) já garante isso no banco.
        // A checagem aqui existe só para dar mensagem decente em vez de erro 23505.
        const existente = await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(sql`lower(${contacts.email}) = lower(${email})`)
          .limit(1);
        if (existente.length > 0) {
          throw new ServiceError('CONFLITO', 'Você já tem um contato com esse e-mail.', {
            campo: 'email',
            correcao: 'Abrir o contato existente',
          });
        }
      }

      const [criado] = await tx
        .insert(contacts)
        .values({
          // tenant_id escrito aqui, a partir da sessão. Nunca do input.
          tenantId,
          name: dados.name,
          email,
          phone: vazioParaNulo(dados.phone),
          whatsapp: vazioParaNulo(dados.whatsapp) ?? vazioParaNulo(dados.phone),
          document: vazioParaNulo(dados.document),
          birthDate: vazioParaNulo(dados.birthDate),
          source: dados.source,
          notes: vazioParaNulo(dados.notes),
        })
        .returning({
          id: contacts.id,
          name: contacts.name,
          email: contacts.email,
          phone: contacts.phone,
          whatsapp: contacts.whatsapp,
          source: contacts.source,
          createdAt: contacts.createdAt,
        });

      const contato = criado!;

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'contact.created',
        entity: 'contact',
        entityId: contato.id,
        // Sem PII no log. Só o fato de que veio documento.
        metadata: { comDocumento: Boolean(vazioParaNulo(dados.document)) },
      });

      return { ...contato, temDocumento: Boolean(vazioParaNulo(dados.document)) };
    });
  });
}

export async function arquivarContato(contatoId: string): Promise<ServiceResult<null>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      // Sem `where tenant_id = ...`: o RLS já restringe. Se o id for de outro tenant, a
      // linha simplesmente não existe daqui — 0 linhas afetadas, não erro de permissão,
      // e o chamador não descobre se o id existe em outro lugar.
      const afetadas = await tx
        .update(contacts)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(contacts.id, contatoId), isNull(contacts.archivedAt)))
        .returning({ id: contacts.id });

      if (afetadas.length === 0) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse contato não existe mais.', {
          correcao: 'Voltar para a lista',
        });
      }

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'contact.archived',
        entity: 'contact',
        entityId: contatoId,
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
): Promise<ServiceResult<{ cpf: string | null; passaporte: string | null }>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const [linha] = await tx
        .select({ cpf: travelers.cpf, passaporte: travelers.passportNumber })
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

type EntradaAuditoria = {
  tenantId: string;
  actorUserId: string | null;
  action: string;
  entity: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
};

async function registrarAuditoria(tx: TenantDb, entrada: EntradaAuditoria): Promise<void> {
  await tx.insert(auditLog).values({
    tenantId: entrada.tenantId,
    actorUserId: entrada.actorUserId,
    action: entrada.action,
    entity: entrada.entity,
    entityId: entrada.entityId,
    metadata: entrada.metadata ?? {},
  });
}
