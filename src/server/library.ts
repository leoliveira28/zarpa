'use server';

import { and, desc, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { libraryItems } from '@/db/schema';
import { withTenant } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { ServiceError, comoResultado, type ServiceResult } from './errors';

/**
 * Acervo reutilizável do construtor de proposta (`library_items`).
 *
 * Regra que este arquivo NUNCA quebra: toda escrita feita por uma Server Action é de um
 * item do PRÓPRIO tenant (`isGlobal` nunca é `true` aqui — nem que o chamador mande
 * `isGlobal: true` no input, o campo é ignorado na escrita). O acervo GLOBAL é só leitura
 * por este caminho; escrevê-lo é responsabilidade de `withPlatformContext`
 * (`src/lib/tenant/withPlatformContext.ts`), que nenhuma Server Action chama hoje — não
 * existe tela de admin no v1. Ver `drizzle/0003_construtor_de_proposta.sql` para a policy
 * que faz valer isso no banco, não só aqui.
 *
 * Tentar atualizar ou apagar um item que é global (ou de outro tenant) dá zero linhas
 * afetadas — a mesma resposta genérica "não encontrado" de `contacts.ts`, de propósito: o
 * chamador não descobre que o id existe em outro lugar.
 */

const KIND_VALUES = [
  'text',
  'image',
  'flight',
  'hotel',
  'transfer',
  'tour',
  'cruise',
  'insurance',
] as const;

export type ItemBibliotecaKind = (typeof KIND_VALUES)[number];

const itemInput = z.object({
  kind: z.enum(KIND_VALUES),
  title: z.string().trim().min(1, 'Dê um título ao item').max(160),
  body: z.string().trim().max(4000).optional().or(z.literal('')),
  images: z.array(z.string().trim().min(1).max(2000)).max(10).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ItemBibliotecaInput = z.infer<typeof itemInput>;
export type ItemBibliotecaPatch = Partial<ItemBibliotecaInput>;

export type ItemBibliotecaResumo = {
  id: string;
  tenantId: string | null;
  isGlobal: boolean;
  kind: string;
  title: string;
  body: string | null;
  images: string[];
  details: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

const COLUNAS = {
  id: libraryItems.id,
  tenantId: libraryItems.tenantId,
  isGlobal: libraryItems.isGlobal,
  kind: libraryItems.kind,
  title: libraryItems.title,
  body: libraryItems.body,
  images: libraryItems.images,
  details: libraryItems.details,
  createdAt: libraryItems.createdAt,
  updatedAt: libraryItems.updatedAt,
} as const;

function validar(input: unknown, parcial: boolean): ItemBibliotecaInput {
  const schema = parcial ? itemInput.partial() : itemInput;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const primeiro = parsed.error.issues[0];
    throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
      campo: primeiro?.path.join('.'),
      correcao: 'Corrigir e salvar de novo',
    });
  }
  return parsed.data as ItemBibliotecaInput;
}

export type FiltroBiblioteca = {
  kind?: ItemBibliotecaKind;
  /** 'tenant' = só o meu acervo. 'global' = só o modelo da plataforma. 'todos' (default). */
  origem?: 'tenant' | 'global' | 'todos';
  busca?: string;
};

/**
 * Lê o acervo do tenant, o acervo global, ou os dois juntos (default). Item global vem com
 * `tenantId: null` e `isGlobal: true` — a interface decide como separar visualmente; o
 * contrato aqui é só "o que existe e é visível".
 */
export async function listarBiblioteca(
  filtro?: FiltroBiblioteca,
): Promise<ServiceResult<ItemBibliotecaResumo[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const origem = filtro?.origem ?? 'todos';
    const busca = filtro?.busca?.trim();

    return withTenant(tenantId, async (tx) => {
      const condicoes = [];

      if (origem === 'tenant') condicoes.push(eq(libraryItems.isGlobal, false));
      else if (origem === 'global') condicoes.push(eq(libraryItems.isGlobal, true));
      // 'todos': a policy de SELECT já devolve só (próprio tenant) OU (global) — nada a
      // filtrar aqui além disso.

      if (filtro?.kind) condicoes.push(eq(libraryItems.kind, filtro.kind));
      if (busca && busca.length > 0) {
        condicoes.push(
          or(
            sql`${libraryItems.title} ilike ${'%' + busca + '%'}`,
            sql`${libraryItems.body} ilike ${'%' + busca + '%'}`,
          ),
        );
      }

      const linhas = await tx
        .select(COLUNAS)
        .from(libraryItems)
        .where(condicoes.length > 0 ? and(...condicoes) : undefined)
        .orderBy(desc(libraryItems.isGlobal), desc(libraryItems.createdAt))
        .limit(200);

      return linhas as ItemBibliotecaResumo[];
    });
  });
}

export async function obterItemDaBiblioteca(
  itemId: string,
): Promise<ServiceResult<ItemBibliotecaResumo>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const [linha] = await tx.select(COLUNAS).from(libraryItems).where(eq(libraryItems.id, itemId)).limit(1);
      if (!linha) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse item não existe mais.', {
          correcao: 'Voltar para o acervo',
        });
      }
      return linha as ItemBibliotecaResumo;
    });
  });
}

export async function criarItemNaBiblioteca(
  input: ItemBibliotecaInput,
): Promise<ServiceResult<ItemBibliotecaResumo>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const dados = validar(input, false);

    return withTenant(tenantId, async (tx) => {
      const [criado] = await tx
        .insert(libraryItems)
        .values({
          tenantId,
          isGlobal: false, // sempre — ver o comentário no topo do arquivo
          kind: dados.kind,
          title: dados.title,
          body: dados.body?.trim() || null,
          images: dados.images ?? [],
          details: dados.details ?? {},
        })
        .returning(COLUNAS);

      return criado! as ItemBibliotecaResumo;
    });
  });
}

export async function atualizarItemDaBiblioteca(
  itemId: string,
  patch: ItemBibliotecaPatch,
): Promise<ServiceResult<ItemBibliotecaResumo>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const dados = validar(patch, true);

    const valores: Record<string, unknown> = { updatedAt: new Date() };
    let mudou = 0;

    if (dados.kind !== undefined) {
      valores.kind = dados.kind;
      mudou++;
    }
    if (dados.title !== undefined) {
      valores.title = dados.title;
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
    if (dados.details !== undefined) {
      valores.details = dados.details;
      mudou++;
    }

    if (mudou === 0) {
      throw new ServiceError('DADOS_INVALIDOS', 'Nada para salvar.', { correcao: 'Fechar' });
    }

    return withTenant(tenantId, async (tx) => {
      // Sem `and(isGlobal = false)` explícito: a policy de UPDATE já recusa qualquer linha
      // com `is_global = true` (ver a migration). Um item global aqui dá 0 linhas, igual a
      // um id de outro tenant — mesma resposta, de propósito.
      const linhas = await tx
        .update(libraryItems)
        .set(valores)
        .where(eq(libraryItems.id, itemId))
        .returning(COLUNAS);

      const item = linhas[0];
      if (!item) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse item não existe mais.', {
          correcao: 'Voltar para o acervo',
        });
      }
      return item as ItemBibliotecaResumo;
    });
  });
}

export async function excluirItemDaBiblioteca(itemId: string): Promise<ServiceResult<null>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const afetadas = await tx
        .delete(libraryItems)
        .where(eq(libraryItems.id, itemId))
        .returning({ id: libraryItems.id });

      if (afetadas.length === 0) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse item não existe mais.', {
          correcao: 'Voltar para o acervo',
        });
      }
      return null;
    });
  });
}
