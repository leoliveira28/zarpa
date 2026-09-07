'use server';

import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, deals } from '@/db/schema';
import { withTenant } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { maskDocument } from '@/lib/crypto';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { exigirContaAtiva } from './subscriptionGate';
import { registrarAuditoria } from './audit';
import { cpfValido, normalizarTelefone } from './normalize';
import { camposDocumentoDoContato, camposNascimento, hashesDeBusca, pareceCpf } from './piiFields';

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
    .trim()
    .max(20)
    .optional()
    .or(z.literal('')),
  source: z.enum(['whatsapp', 'instagram', 'indicacao', 'site', 'evento', 'outro']).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  notes: z.string().trim().max(4000).optional().or(z.literal('')),
});

export type ContatoInput = z.infer<typeof contatoInput>;
/** Na edição tudo é opcional: a tela salva campo a campo (não há botão Salvar grande). */
export type ContatoPatch = Partial<ContatoInput>;

/** O que a interface recebe. Sem CPF, sem nascimento — só a marca de que existem. */
export type ContatoResumo = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  source: string | null;
  tags: string[];
  temDocumento: boolean;
  arquivado: boolean;
  createdAt: Date;
};

export type ContatoDetalhe = ContatoResumo & {
  notes: string | null;
  /** `MM-DD`. O ano só sai por `obterNascimentoDoContato`, que grava auditoria. */
  aniversario: string | null;
  updatedAt: Date;
  totalViajantes: number;
  totalNegocios: number;
};

export type FiltroContatos = {
  /** Nome, e-mail, telefone OU CPF. O serviço decide sozinho o que o termo parece. */
  busca?: string;
  limite?: number;
  incluirArquivados?: boolean;
};

const COLUNAS_RESUMO = {
  id: contacts.id,
  name: contacts.name,
  email: contacts.email,
  phone: contacts.phone,
  whatsapp: contacts.whatsapp,
  source: contacts.source,
  tags: contacts.tags,
  temDocumento: sql<boolean>`${contacts.documentHash} is not null`,
  arquivado: sql<boolean>`${contacts.archivedAt} is not null`,
  createdAt: contacts.createdAt,
} as const;

function vazioParaNulo(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function validar(input: unknown, parcial: boolean): ContatoInput {
  const schema = parcial ? contatoInput.partial() : contatoInput;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const primeiro = parsed.error.issues[0];
    throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
      campo: primeiro?.path.join('.'),
      correcao: 'Corrigir e salvar de novo',
    });
  }
  return parsed.data as ContatoInput;
}

/**
 * Lista de contatos, com busca por nome, e-mail, telefone e CPF.
 *
 * A lista de colunas é explícita de propósito. Um `select()` sem colunas traria
 * `document` e `birthDate`, que são `encryptedText` — o Drizzle decifraria os dois em
 * memória para montar cada linha e o CPF de todo mundo viajaria até o componente. A
 * decisão de ler documento é sempre consciente, nunca efeito colateral de um `select *`.
 *
 * A busca por CPF não compara o ciphertext (que é diferente a cada gravação): ela calcula
 * o índice cego do termo digitado e compara hash com hash. Ver
 * `src/lib/crypto/blindIndex.ts`.
 */
export async function listarContatos(
  filtro?: FiltroContatos,
): Promise<ServiceResult<ContatoResumo[]>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const limite = Math.min(Math.max(filtro?.limite ?? 50, 1), 200);
    const busca = filtro?.busca?.trim();

    return withTenant(tenantId, async (tx) => {
      const condicoes = [];
      if (!filtro?.incluirArquivados) condicoes.push(isNull(contacts.archivedAt));

      if (busca && busca.length > 0) {
        const alternativas = [
          sql`${contacts.name} ilike ${'%' + busca + '%'}`,
          sql`${contacts.email} ilike ${'%' + busca + '%'}`,
        ];

        // Telefone: compara só dígitos dos dois lados. "(11) 98888-7777" na base tem que
        // casar com "11988887777" digitado, e vice-versa.
        const telefone = normalizarTelefone(busca);
        if (telefone && telefone.length >= 4) {
          alternativas.push(
            sql`regexp_replace(coalesce(${contacts.phone}, ''), '\\D', '', 'g') like ${'%' + telefone + '%'}`,
            sql`regexp_replace(coalesce(${contacts.whatsapp}, ''), '\\D', '', 'g') like ${'%' + telefone + '%'}`,
          );
        }

        // CPF: só entra na busca quando o termo é um CPF inteiro. Índice cego compara
        // igualdade exata — não existe "CPF que começa com", e é bom que não exista.
        if (pareceCpf(busca)) {
          const candidatos = hashesDeBusca('contacts.document', tenantId, busca);
          if (candidatos.length > 0) {
            alternativas.push(inArray(contacts.documentHash, candidatos));
          }
        }

        condicoes.push(or(...alternativas));
      }

      const linhas = await tx
        .select(COLUNAS_RESUMO)
        .from(contacts)
        .where(condicoes.length > 0 ? and(...condicoes) : undefined)
        .orderBy(desc(contacts.createdAt))
        .limit(limite);

      return linhas as ContatoResumo[];
    });
  });
}

/**
 * Busca exata por CPF. Existe separada da listagem porque é a chamada que a importação e
 * a tela de "esse cliente já existe?" fazem, e porque ela grava auditoria: procurar por
 * CPF é usar um documento que veio de fora, e isso deixa rastro.
 */
export async function buscarContatoPorCpf(cpf: string): Promise<ServiceResult<ContatoResumo | null>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();

    if (!pareceCpf(cpf)) {
      throw new ServiceError('DADOS_INVALIDOS', 'Digite um CPF com 11 dígitos.', {
        campo: 'cpf',
        correcao: 'Corrigir o CPF',
      });
    }

    const candidatos = hashesDeBusca('contacts.document', tenantId, cpf);

    return withTenant(tenantId, async (tx) => {
      const [linha] = await tx
        .select(COLUNAS_RESUMO)
        .from(contacts)
        .where(and(isNotNull(contacts.documentHash), inArray(contacts.documentHash, candidatos)))
        .limit(1);

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'contact.searched_by_document',
        entity: 'contact',
        entityId: linha?.id,
        // Mascarado. O log registra que houve busca por CPF, não qual CPF.
        metadata: { documento: maskDocument(cpf), encontrou: Boolean(linha) },
      });

      return (linha ?? null) as ContatoResumo | null;
    });
  });
}

export async function obterContato(contatoId: string): Promise<ServiceResult<ContatoDetalhe>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const [linha] = await tx
        .select({
          ...COLUNAS_RESUMO,
          notes: contacts.notes,
          aniversario: contacts.birthMonthDay,
          updatedAt: contacts.updatedAt,
          // Nomes de coluna LITERAIS (`travelers.contact_id`, não `${travelers.contactId}`)
          // são de propósito, não descuido — comprovado contra o Postgres de teste ao
          // escrever `src/server/deals.ts` (S4): quando um `sql<>` é usado como VALOR de
          // `.select({...})`, o Drizzle renderiza `${coluna}` SEM qualificar a tabela
          // (`"id"`, não `"contacts"."id"`). Como `travelers`/`deals` também têm coluna
          // `id`, `${travelers.contactId} = ${contacts.id}` virava `"contact_id" = "id"` —
          // e dentro do escopo da subquery (`from travelers`), `"id"` desambiguava para
          // `travelers.id`, não para o `contacts.id` de fora. A condição comparava
          // `travelers.contact_id = travelers.id` (quase sempre falso) e estas duas colunas
          // voltavam SEMPRE ZERO, silenciosamente, para todo contato. Ver
          // `docs/status/rafa.md` (S4) para o traço completo do bug.
          totalViajantes: sql<number>`(select count(*)::int from travelers where travelers.contact_id = contacts.id)`,
          totalNegocios: sql<number>`(select count(*)::int from deals where deals.contact_id = contacts.id)`,
        })
        .from(contacts)
        .where(eq(contacts.id, contatoId))
        .limit(1);

      if (!linha) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse contato não existe mais.', {
          correcao: 'Voltar para a lista',
        });
      }
      return linha as ContatoDetalhe;
    });
  });
}

export async function criarContato(input: ContatoInput): Promise<ServiceResult<ContatoResumo>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(input, false);

    const documento = vazioParaNulo(dados.document);
    if (documento && !cpfValido(documento)) {
      throw new ServiceError('DADOS_INVALIDOS', 'Esse CPF não é válido.', {
        campo: 'document',
        correcao: 'Conferir o CPF',
      });
    }

    const email = vazioParaNulo(dados.email)?.toLowerCase() ?? null;
    const campos = camposDocumentoDoContato(tenantId, documento);
    const nascimento = camposNascimento(dados.birthDate);

    if (vazioParaNulo(dados.birthDate) && !nascimento.birthDate) {
      throw new ServiceError('DADOS_INVALIDOS', 'Não entendi essa data de nascimento.', {
        campo: 'birthDate',
        correcao: 'Usar o formato DD/MM/AAAA',
      });
    }

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
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

      if (campos.documentHash) {
        const existente = await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(eq(contacts.documentHash, campos.documentHash))
          .limit(1);
        if (existente.length > 0) {
          throw new ServiceError('CONFLITO', 'Você já tem um contato com esse CPF.', {
            campo: 'document',
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
          ...campos,
          ...nascimento,
          source: dados.source,
          tags: dados.tags ?? [],
          notes: vazioParaNulo(dados.notes),
        })
        .returning(COLUNAS_RESUMO);

      const contato = criado!;

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'contact.created',
        entity: 'contact',
        entityId: contato.id,
        // Sem PII no log. Só o fato de que veio documento.
        metadata: { comDocumento: Boolean(campos.document) },
      });

      return contato as ContatoResumo;
    });
  });
}

export async function atualizarContato(
  contatoId: string,
  patch: ContatoPatch,
): Promise<ServiceResult<ContatoResumo>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();
    const dados = validar(patch, true);

    const valores: Record<string, unknown> = { updatedAt: new Date() };
    const mudou: string[] = [];

    if (dados.name !== undefined) {
      valores.name = dados.name;
      mudou.push('name');
    }
    if (dados.email !== undefined) {
      valores.email = vazioParaNulo(dados.email)?.toLowerCase() ?? null;
      mudou.push('email');
    }
    if (dados.phone !== undefined) {
      valores.phone = vazioParaNulo(dados.phone);
      mudou.push('phone');
    }
    if (dados.whatsapp !== undefined) {
      valores.whatsapp = vazioParaNulo(dados.whatsapp);
      mudou.push('whatsapp');
    }
    if (dados.source !== undefined) {
      valores.source = dados.source;
      mudou.push('source');
    }
    if (dados.tags !== undefined) {
      valores.tags = dados.tags;
      mudou.push('tags');
    }
    if (dados.notes !== undefined) {
      valores.notes = vazioParaNulo(dados.notes);
      mudou.push('notes');
    }
    if (dados.birthDate !== undefined) {
      const nascimento = camposNascimento(dados.birthDate);
      if (vazioParaNulo(dados.birthDate) && !nascimento.birthDate) {
        throw new ServiceError('DADOS_INVALIDOS', 'Não entendi essa data de nascimento.', {
          campo: 'birthDate',
          correcao: 'Usar o formato DD/MM/AAAA',
        });
      }
      Object.assign(valores, nascimento);
      mudou.push('birthDate');
    }
    if (dados.document !== undefined) {
      const documento = vazioParaNulo(dados.document);
      if (documento && !cpfValido(documento)) {
        throw new ServiceError('DADOS_INVALIDOS', 'Esse CPF não é válido.', {
          campo: 'document',
          correcao: 'Conferir o CPF',
        });
      }
      // As três colunas (cifra, hash, key_id) sempre juntas — ver `piiFields.ts`.
      Object.assign(valores, camposDocumentoDoContato(tenantId, documento));
      mudou.push('document');
    }

    if (mudou.length === 0) {
      throw new ServiceError('DADOS_INVALIDOS', 'Nada para salvar.', { correcao: 'Fechar' });
    }

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const linhas = await tx
        .update(contacts)
        .set(valores)
        .where(eq(contacts.id, contatoId))
        .returning(COLUNAS_RESUMO);

      const contato = linhas[0];
      if (!contato) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse contato não existe mais.', {
          correcao: 'Voltar para a lista',
        });
      }

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'contact.updated',
        entity: 'contact',
        entityId: contatoId,
        // Só os NOMES dos campos alterados. Nunca os valores.
        metadata: { campos: mudou },
      });

      return contato as ContatoResumo;
    });
  });
}

export async function arquivarContato(contatoId: string): Promise<ServiceResult<null>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
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

/** O outro lado do toast com desfazer de 8s (regra do CLAUDE.md: sem modal "tem certeza?"). */
export async function restaurarContato(contatoId: string): Promise<ServiceResult<null>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const afetadas = await tx
        .update(contacts)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(and(eq(contacts.id, contatoId), isNotNull(contacts.archivedAt)))
        .returning({ id: contacts.id });

      if (afetadas.length === 0) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse contato não está arquivado.', {
          correcao: 'Voltar para a lista',
        });
      }

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'contact.restored',
        entity: 'contact',
        entityId: contatoId,
      });

      return null;
    });
  });
}

/**
 * Exclusão de verdade (LGPD: o titular pede e a agente tem que conseguir apagar).
 *
 * Recusa quando existe negócio ligado — a FK de `deals.contact_id` é RESTRICT de propósito
 * (apagar contato não pode sumir com histórico de venda). Nesse caso a resposta oferece o
 * caminho certo, que é arquivar. Passageiros vão junto (CASCADE): eles não existem fora do
 * contato.
 */
export async function excluirContato(contatoId: string): Promise<ServiceResult<null>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada (subscriptionGate.ts).
      await exigirContaAtiva(tx, tenantId);
      const [negocio] = await tx
        .select({ id: deals.id })
        .from(deals)
        .where(eq(deals.contactId, contatoId))
        .limit(1);

      if (negocio) {
        throw new ServiceError(
          'CONFLITO',
          'Esse contato tem negócio no funil e não pode ser apagado.',
          { correcao: 'Arquivar em vez de apagar' },
        );
      }

      const afetadas = await tx
        .delete(contacts)
        .where(eq(contacts.id, contatoId))
        .returning({ id: contacts.id });

      if (afetadas.length === 0) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse contato não existe mais.', {
          correcao: 'Voltar para a lista',
        });
      }

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'contact.deleted',
        entity: 'contact',
        entityId: contatoId,
      });

      return null;
    });
  });
}

/**
 * Leitura explícita do CPF do contato — a mesma regra do documento de passageiro: sai do
 * banco só quando alguém pede, e a leitura fica gravada em `audit_log`.
 */
export async function obterDocumentoDoContato(
  contatoId: string,
): Promise<ServiceResult<{ cpf: string | null; nascimento: string | null }>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();

    return withTenant(tenantId, async (tx) => {
      const [linha] = await tx
        .select({ cpf: contacts.document, nascimento: contacts.birthDate })
        .from(contacts)
        .where(eq(contacts.id, contatoId))
        .limit(1);

      if (!linha) throw new ServiceError('NAO_ENCONTRADO', 'Contato não encontrado.');

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'contact.document_viewed',
        entity: 'contact',
        entityId: contatoId,
      });

      return linha;
    });
  });
}
