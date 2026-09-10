'use server';

import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { contacts, dealContacts, deals, itineraries, pipelineStages, proposals } from '@/db/schema';
import { withTenant } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { maskDocument } from '@/lib/crypto';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { exigirContaAtiva } from './subscriptionGate';
import { registrarAuditoria } from './audit';
import { cnpjValido, cpfValido, normalizarTelefone } from './normalize';
import {
  camposDocumentoDoContato,
  camposNascimento,
  hashesDeBusca,
  pareceCpf,
  pareceDocumento,
} from './piiFields';

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
  /**
   * Física (padrão) ou jurídica — a empresa (Fase 4a). Não é campo de texto livre:
   * o TIPO decide a régua do `document` (CPF 11 dígitos × CNPJ 14).
   */
  personType: z.enum(['fisica', 'juridica']).optional(),
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
  /** `fisica` (cliente de sempre) ou `juridica` — a empresa que paga (Fase 4a). */
  personType: 'fisica' | 'juridica';
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
  personType: contacts.personType,
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

/**
 * A régua do documento depende do TIPO do contato (Fase 4a): PF valida por `cpfValido`,
 * PJ por `cnpjValido`. Um CPF numa empresa (ou um CNPJ numa pessoa) recusa na entrada —
 * documento inválido compete por unicidade no índice cego com alguém que existe de
 * verdade, e a recusa com o campo culpado é a mensageria da casa.
 */
function validarDocumentoPorTipo(
  personType: 'fisica' | 'juridica',
  documento: string | null,
): void {
  if (!documento) return;
  if (personType === 'juridica') {
    if (!cnpjValido(documento)) {
      throw new ServiceError('DADOS_INVALIDOS', 'Esse CNPJ não é válido.', {
        campo: 'document',
        correcao: 'Conferir o CNPJ (14 dígitos)',
      });
    }
    return;
  }
  if (!cpfValido(documento)) {
    throw new ServiceError('DADOS_INVALIDOS', 'Esse CPF não é válido.', {
      campo: 'document',
      correcao: 'Conferir o CPF',
    });
  }
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

        // Documento: só entra na busca quando o termo é um documento inteiro — CPF (11)
        // ou CNPJ (14, Fase 4a). Índice cego compara igualdade exata — não existe "CPF
        // que começa com", e é bom que não exista.
        if (pareceDocumento(busca)) {
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
    // Ausente = pessoa física: o contato de sempre não muda de forma porque a Fase 4a
    // existe. `.optional()` no zod de propósito — `.default()` viraria campo OBRIGATÓRIO
    // no tipo de saída e quebraria todo chamador que cria contato sem saber do PJ.
    const personType = dados.personType ?? 'fisica';
    validarDocumentoPorTipo(personType, documento);

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
          throw new ServiceError(
            'CONFLITO',
            `Você já tem um contato com esse ${personType === 'juridica' ? 'CNPJ' : 'CPF'}.`,
            {
              campo: 'document',
              correcao: 'Abrir o contato existente',
            },
          );
        }
      }

      const [criado] = await tx
        .insert(contacts)
        .values({
          // tenant_id escrito aqui, a partir da sessão. Nunca do input.
          tenantId,
          name: dados.name,
          personType,
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
    /** Documento do patch aguardando validação por tipo (dentro do `withTenant`). */
    let documentoParaValidar: string | null | undefined;

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
    if (dados.personType !== undefined) {
      valores.personType = dados.personType;
      mudou.push('personType');
    }
    if (dados.document !== undefined) {
      const documento = vazioParaNulo(dados.document);
      // A validação por tipo fica para DENTRO do `withTenant`: quando o patch traz só o
      // documento, o tipo efetivo é o que está no banco — e lê-lo sem o GUC do tenant
      // seria ignorar o RLS (FORCE recusa, com razão).
      documentoParaValidar = documento;
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
      if (documentoParaValidar !== undefined) {
        let tipo = dados.personType;
        if (!tipo) {
          const [atual] = await tx
            .select({ personType: contacts.personType })
            .from(contacts)
            .where(eq(contacts.id, contatoId))
            .limit(1);
          tipo = atual?.personType;
        }
        validarDocumentoPorTipo(tipo ?? 'fisica', documentoParaValidar);
      }
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

// ---------------------------------------------------------------------------
// Histórico 360° do contato — a ficha que responde, de cima para baixo:
// quem é o cliente, onde ele está agora (proposta aberta? em viagem?), quanto
// ele já comprou e o histórico (negócios, propostas, roteiros).
//
// Leitura — não passa pelo gate de assinatura, mesmo desenho de `obterContato`.
// Tudo sai de tabelas que JÁ EXISTEM: `deals` + `pipeline_stages` (o estágio e
// o ganho/perda, 0016), `proposals` (via `deal_id`) e `itineraries` (via
// `deal_id`). Zero tabela nova, zero migration. Nenhuma PII: CPF e nascimento
// continuam saindo só por `obterDocumentoDoContato`, com auditoria.
// ---------------------------------------------------------------------------

/** Um negócio do contato, no vocabulário da ficha. */
export type NegocioDoContato = {
  id: string;
  title: string;
  destination: string | null;
  /** Rótulo ATUAL da coluna do funil — o agente pode ter renomeado (0015). */
  stageLabel: string;
  /** Vêm da COLUNA do funil (`pipeline_stages`), não do enum (S16, 0016). */
  isWon: boolean;
  isLost: boolean;
  valueCents: number;
  commissionCents: number;
  /** `AAAA-MM-DD` ou null — mesmo formato de `deals.departure_on`. */
  departureOn: string | null;
  returnOn: string | null;
  /** Só faz sentido quando `isLost`. */
  lostReason: string | null;
  closedAt: Date | null;
  createdAt: Date;
};

export type PropostaDoContato = {
  id: string;
  dealId: string;
  dealTitle: string;
  title: string;
  status: 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired';
  viewCount: number;
  sentAt: Date | null;
  lastViewedAt: Date | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  /** `AAAA-MM-DD` ou null. */
  validUntil: string | null;
  archivedAt: Date | null;
};

export type RoteiroDoContato = {
  id: string;
  dealId: string;
  /** Token do link público `/r/<token>` — o link que o cliente recebeu. */
  publicToken: string;
  title: string;
  departureOn: string | null;
  returnOn: string | null;
  createdAt: Date;
};

/** A viagem (negócio ganho com data de ida) nos dois estados de "agora". */
export type ViagemDoContato = {
  dealId: string;
  title: string;
  destination: string | null;
  departureOn: string;
  returnOn: string | null;
  valueCents: number;
};

export type HistoricoDoContato = {
  /** Mais recente primeiro. Teto de 100 — volume de MEI cobre anos. */
  negocios: NegocioDoContato[];
  /** Mais recente primeiro (por criação). */
  propostas: PropostaDoContato[];
  /** Mais recente primeiro (por criação). */
  roteiros: RoteiroDoContato[];
  /** Soma dos negócios fechados como ganho — o "quanto ele já comprou". */
  totalCompradoCents: number;
  /** Comissão dos negócios ganhos — o que o cliente já rendeu ao agente. */
  comissaoGanhaCents: number;
  totalViagens: number;
  /** Negócio ganho com `departureOn <= hoje` e volta não terminada. */
  viagemEmCurso: ViagemDoContato | null;
  /** Negócio ganho com `departureOn > hoje`, a mais próxima. */
  proximaViagem: ViagemDoContato | null;
  /** Proposta `sent`/`viewed` não arquivada, a mais recente — o link que está com ele. */
  propostaAberta: PropostaDoContato | null;
};

/**
 * O histórico completo do contato numa chamada só — a ficha 360° faz três
 * queries paralelas dentro da MESMA transação (mesmo snapshot de leitura) e o
 * agregado (totais, viagem em curso, proposta aberta) é calculado em memória:
 * são no máximo 3 × 100 linhas — somar em SQL economizaria nada enquanto
 * triplicaria o código.
 *
 * Fuso: "hoje" é a data UTC — MESMA convenção de `viagens.ts`/`dashboard.ts`
 * (`departure_on`/`return_on` são `date` sem fuso; diferença máxima de 3h,
 * aceita e documentada lá).
 *
 * Participação (0021, furo da nina): o contato entra no histórico como TITULAR
 * (`deals.contact_id`) OU como cliente adicional (`deal_contacts`, 0020) — a viagem do
 * casal aparece na ficha 360° dos DOIS, e os totais (comprado, comissão, viagens)
 * incluem o negócio nos dois lados. Decisão consciente: para o SECUNDÁRIO, o valor do
 * negócio aparece inteiro (não rateado) — a ficha responde "o que este cliente já
 * fez com a agência", e a viagem do casal é dele também; ratear inventaria uma
 * política de divisão que o produto não pediu. Nomes de coluna LITERAIS no `exists`
 * (`deals.id` sem alias) porque `deals` nunca é apelidado nas três queries.
 */
/** Predicado comum às três queries do histórico (mesmo sentido, três fontes). */
const doTitularOuDaLista = (contatoId: string) =>
  or(
    eq(deals.contactId, contatoId),
    sql`exists (select 1 from deal_contacts dc where dc.deal_id = deals.id and dc.contact_id = ${contatoId})`,
  );

export async function obterHistoricoDoContato(
  contatoId: string,
): Promise<ServiceResult<HistoricoDoContato>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const hoje = new Date().toISOString().slice(0, 10);

    return withTenant(tenantId, async (tx) => {
      const linhasNegocios = await tx
        .select({
          id: deals.id,
          title: deals.title,
          destination: deals.destination,
          stageLabel: pipelineStages.label,
          isWon: pipelineStages.isWon,
          isLost: pipelineStages.isLost,
          valueCents: deals.valueCents,
          commissionCents: deals.commissionCents,
          departureOn: deals.departureOn,
          returnOn: deals.returnOn,
          lostReason: deals.lostReason,
          closedAt: deals.closedAt,
          createdAt: deals.createdAt,
        })
        .from(deals)
        .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
        .where(doTitularOuDaLista(contatoId))
        .orderBy(desc(deals.createdAt))
        .limit(100);

      const linhasPropostas = await tx
        .select({
          id: proposals.id,
          dealId: proposals.dealId,
          dealTitle: deals.title,
          title: proposals.title,
          status: proposals.status,
          viewCount: proposals.viewCount,
          sentAt: proposals.sentAt,
          lastViewedAt: proposals.lastViewedAt,
          acceptedAt: proposals.acceptedAt,
          declinedAt: proposals.declinedAt,
          validUntil: proposals.validUntil,
          archivedAt: proposals.archivedAt,
        })
        .from(proposals)
        .innerJoin(deals, eq(deals.id, proposals.dealId))
        .where(doTitularOuDaLista(contatoId))
        .orderBy(desc(proposals.createdAt))
        .limit(100);

      const linhasRoteiros = await tx
        .select({
          id: itineraries.id,
          dealId: itineraries.dealId,
          publicToken: itineraries.publicToken,
          title: itineraries.title,
          departureOn: itineraries.departureOn,
          returnOn: itineraries.returnOn,
          createdAt: itineraries.createdAt,
        })
        .from(itineraries)
        .innerJoin(deals, eq(deals.id, itineraries.dealId))
        .where(doTitularOuDaLista(contatoId))
        .orderBy(desc(itineraries.createdAt))
        .limit(100);

      const negocios: NegocioDoContato[] = linhasNegocios.map((linha) => ({
        ...linha,
        departureOn: linha.departureOn ?? null,
        returnOn: linha.returnOn ?? null,
        lostReason: linha.lostReason ?? null,
        closedAt: linha.closedAt ?? null,
      }));
      const propostas: PropostaDoContato[] = linhasPropostas.map((linha) => ({
        ...linha,
        sentAt: linha.sentAt ?? null,
        lastViewedAt: linha.lastViewedAt ?? null,
        acceptedAt: linha.acceptedAt ?? null,
        declinedAt: linha.declinedAt ?? null,
        validUntil: linha.validUntil ?? null,
        archivedAt: linha.archivedAt ?? null,
      }));
      const roteiros: RoteiroDoContato[] = linhasRoteiros;

      let totalCompradoCents = 0;
      let comissaoGanhaCents = 0;
      let totalViagens = 0;
      const viagens: ViagemDoContato[] = [];

      for (const negocio of negocios) {
        if (!negocio.isWon) continue;
        totalCompradoCents += negocio.valueCents;
        comissaoGanhaCents += negocio.commissionCents;
        if (negocio.departureOn) {
          totalViagens += 1;
          viagens.push({
            dealId: negocio.id,
            title: negocio.title,
            destination: negocio.destination,
            departureOn: negocio.departureOn,
            returnOn: negocio.returnOn,
            valueCents: negocio.valueCents,
          });
        }
      }

      const viagemEmCurso =
        viagens.find(
          (v) =>
            v.departureOn <= hoje && (v.returnOn === null || hoje <= v.returnOn),
        ) ?? null;
      const proximaViagem =
        viagens
          .filter((v) => v.departureOn > hoje)
          .sort((a, b) => a.departureOn.localeCompare(b.departureOn))[0] ?? null;

      // "Aberta" = enviada (ou já aberta) e ainda sem desfecho, não arquivada.
      // A mais recente por `sentAt` — é o link que está na mão do cliente AGORA.
      const propostaAberta =
        propostas
          .filter(
            (p) =>
              !p.archivedAt &&
              (p.status === 'sent' || p.status === 'viewed') &&
              p.sentAt !== null,
          )
          .sort(
            (a, b) => (b.sentAt?.valueOf() ?? 0) - (a.sentAt?.valueOf() ?? 0),
          )[0] ?? null;

      return {
        negocios,
        propostas,
        roteiros,
        totalCompradoCents,
        comissaoGanhaCents,
        totalViagens,
        viagemEmCurso,
        proximaViagem,
        propostaAberta,
      };
    });
  });
}
