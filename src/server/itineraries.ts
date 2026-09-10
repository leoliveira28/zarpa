'use server';

import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  contacts,
  dealContacts,
  deals,
  itineraries,
  pipelineStages,
  proposalBlocks,
  proposals,
  tenants,
  type NewItinerary,
} from '@/db/schema';
import { withTenant, type TenantDb } from '@/lib/tenant/withTenant';
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
 * Desde o editor de roteiro: `atualizarConteudoDoRoteiro` reescreve SÓ O CONTEÚDO
 * (`blocks_snapshot`) de um roteiro JÁ GERADO — `public_token`, `proposal_id`, título,
 * cliente, datas e `brand_snapshot` são intocáveis, então o link que já foi pelo WhatsApp
 * continua válido: o cliente recarrega a MESMA URL e vê o conteúdo novo. "Sem
 * regeneração" continua de pé — o que muda é o conteúdo, nunca a fotografia comercial
 * (título/marca/datas continuam sendo as da proposta aceita que o cliente viu).
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
// Editor de conteúdo — guardas de entrada
// ---------------------------------------------------------------------------

/**
 * Os mesmos `kind` do CHECK `proposal_blocks_kind_check` (`src/db/schema/proposals.ts`,
 * nascido na 0003). O snapshot fotografa blocos que nasceram lá — e o editor de conteúdo
 * não cria vocabulário novo: semântica nova ("dica local", "dia da viagem") viaja DENTRO
 * do `content` (jsonb), reusando um `kind` existente; `kind` NOVO é migration alterando o
 * CHECK, decisão de schema e não parâmetro de tela.
 */
const KINDS_DE_BLOCO = [
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

/**
 * A PORTARIA da escrita: nome de chave que nunca entra no snapshot. Espelha
 * `FORBIDDEN_KEY_PATTERNS` (`tests/security/leak-scanner.ts`) — `src` não importa `tests`,
 * então a lista vive aqui também, com a mesma forma — MAIS a família `preço`, que é
 * ESTRITEZ DAQUI: o scanner não pode banir preço em geral (a proposta pública é cotação e
 * mostra preço de opção legitimamente), mas a página pública do roteiro NÃO é cotação
 * (§4: preço é da opção). A divisão do trabalho: o scanner é a REDE (varre o payload
 * público DEPOIS, na suíte); isto aqui é a portaria (não deixa o dado ENTRAR, com
 * mensagem que a agente entende na hora de salvar).
 *
 * O vocabulário real de `content` que existe hoje (`CONTENT_FIELDS`
 * em `src/lib/ui/blockContent.ts`, `details` da biblioteca, blocos do seed) não colide com
 * nenhuma família — checado antes de endurecer, para não recusar re-salva de snapshot
 * vivo.
 */
const CHAVES_PROIBIDAS: { label: string; re: RegExp }[] = [
  { label: 'preço', re: /(^|_)(pre[çc]o|price|valor|amount|montante|tarifa|rate|diaria)($|_)/i },
  { label: 'custo', re: /(^|_)(cost|custo|net_?rate|net_?price|tarifa_?net|supplier_?price|preco_?de_?custo|valor_?de_?custo|buy_?price)($|_)/i },
  { label: 'comissão / margem', re: /(^|_)(commission|comissao|comissão|markup|margin|margem|profit|lucro|spread|rav|over)($|_)/i },
  { label: 'CPF / documento', re: /(^|_)(cpf|rg|documento|document(_?number)?|doc_?num|tax_?id)($|_)/i },
  { label: 'passaporte', re: /(^|_)(passport|passaporte|passport_?number|passport_?expiry)($|_)/i },
  { label: 'e-mail', re: /(^|_)(email|e_?mail|mail)($|_)/i },
  { label: 'telefone', re: /(^|_)(phone|telefone|tel|celular|mobile|whatsapp|wpp|msisdn)($|_)/i },
  { label: 'nascimento', re: /(^|_)(birth(date|day)?|nascimento|data_?nasc|dob)($|_)/i },
];

/**
 * Percorre `content` em qualquer profundidade (objetos e arrays) e devolve a PRIMEIRA
 * chave proibida, com o rótulo humano e o caminho até ela — o `campo` do erro aponta o
 * bloco exato, para o editor abrir o campo certo.
 */
function acharChaveProibida(
  valor: unknown,
  caminho: string,
): { chave: string; label: string; caminho: string } | null {
  if (Array.isArray(valor)) {
    for (const [indice, item] of valor.entries()) {
      const achado = acharChaveProibida(item, `${caminho}[${indice}]`);
      if (achado) return achado;
    }
    return null;
  }
  if (typeof valor !== 'object' || valor === null) return null;
  for (const [chave, sub] of Object.entries(valor as Record<string, unknown>)) {
    // As regexes são espelho do scanner e as famílias terminam em fronteira `_`/fim —
    // `custoTransfer` em camelCase escorregaria ("custo" seguido de "T"). Testar a chave
    // crua E repartida em snake_case deixa a portaria MAIS estrita que a rede (a rede
    // continua pegando o que escapa, no payload público). `flightNumber` → `flight_Number`
    // não casa com ninguém: vocabulário legítimo segue passando.
    const formas = [chave, chave.replace(/([a-zà-ú])([A-Z])/g, '$1_$2')];
    const proibida = CHAVES_PROIBIDAS.find((p) => formas.some((f) => p.re.test(f)));
    if (proibida) return { chave, label: proibida.label, caminho: `${caminho}.${chave}` };
    const achado = acharChaveProibida(sub, `${caminho}.${chave}`);
    if (achado) return achado;
  }
  return null;
}

/**
 * JSON com chaves em ordem estável. O jsonb do Postgres NÃO preserva a ordem das chaves
 * (reordena por comprimento e depois byte a byte), então "o agente mandou o mesmo
 * conteúdo que já está lá" só se prova comparando sem depender de ordem — é o que torna o
 * no-op do autosave barato SEM gravar igual duas vezes.
 */
function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  if (typeof valor === 'object' && valor !== null) {
    const pares = Object.entries(valor as Record<string, unknown>)
      .map(([chave, v]) => `${JSON.stringify(chave)}:${canonico(v)}`)
      .sort();
    return `{${pares.join(',')}}`;
  }
  return JSON.stringify(valor) ?? 'null';
}

const blocoConteudoSchema = z.object({
  kind: z.enum(KINDS_DE_BLOCO),
  position: z.number().int('Posição inválida').min(0).max(10_000),
  title: z.string().trim().max(160).nullable().default(null),
  body: z.string().trim().max(8000).nullable().default(null),
  images: z.array(z.string().trim().min(1).max(2000)).max(10).default([]),
  content: z.record(z.string(), z.unknown()).default({}),
});

const conteudoDoRoteiroInput = z.object({
  dealId: z.uuid('Negócio inválido'),
  blocos: z.array(blocoConteudoSchema).max(100, 'O roteiro suporta até 100 blocos.'),
});

// ---------------------------------------------------------------------------
// Gerar roteiro (escrita)
// ---------------------------------------------------------------------------

const roteiroInput = z.object({ dealId: z.uuid('Negócio inválido') });

export type GerarRoteiroInput = z.infer<typeof roteiroInput>;

/**
 * A proposta ACEITA mais recente do negócio — A regra de escolha, num lugar só: a
 * `accepted` com o aceite mais recente por `accepted_at`, e só vale se tiver
 * `accepted_option_id` preenchido (aceite sem opção escolhida não fotografia nada).
 * `gerarRoteiro` (quem FOTOGRAFA) e `obterPropostaAceitaDoNegocio` (quem só APONTA a
 * proposta certa para a tela) não podem discordar sobre qual proposta é a verdade — por
 * isso os dois passam por aqui. `null` nos dois casos de vazio (sem aceita, aceita sem
 * opção): para quem pergunta, "não há o que fotografar" é uma resposta só.
 *
 * Exportada desde a rodada de dinheiro do Monde (fase 2): `resultadoDaViagem`
 * (`src/server/resultado.ts`) usa a MESMA proposta como fonte do "previsto" — venda sem
 * lançamento cai na opção aceita, e a opção aceita tem de ser A MESMA nos dois lugares.
 * Uso interno entre módulos de servidor; NÃO é reexportada pelo barril `@/server`.
 */
export async function propostaAceitaRecente(
  tx: TenantDb,
  dealId: string,
): Promise<{
  id: string;
  title: string;
  currency: string;
  acceptedOptionId: string;
  brandSnapshot: unknown;
} | null> {
  const [proposta] = await tx
    .select({
      id: proposals.id,
      title: proposals.title,
      currency: proposals.currency,
      acceptedOptionId: proposals.acceptedOptionId,
      brandSnapshot: proposals.brandSnapshot,
    })
    .from(proposals)
    .where(and(eq(proposals.dealId, dealId), eq(proposals.status, 'accepted')))
    .orderBy(desc(proposals.acceptedAt))
    .limit(1);

  if (!proposta?.acceptedOptionId) return null;
  return { ...proposta, acceptedOptionId: proposta.acceptedOptionId };
}

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
          // S16: quem diz "fechou como ganho" é a coluna do funil (`is_won`), não o
          // literal 'ganho' — o enum continua sendo espelho dela (0016).
          isWon: pipelineStages.isWon,
          departureOn: deals.departureOn,
          returnOn: deals.returnOn,
          contactId: deals.contactId,
          contactName: contacts.name,
        })
        .from(deals)
        .innerJoin(contacts, eq(contacts.id, deals.contactId))
        .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
        .where(eq(deals.id, dealId))
        .limit(1);

      if (!negocio) {
        throw new ServiceError('NAO_ENCONTRADO', 'Esse negócio não existe mais.', {
          correcao: 'Voltar para o funil',
        });
      }

      if (!negocio.isWon) {
        throw new ServiceError(
          'CONFLITO',
          'Só dá para gerar roteiro de negócio fechado como ganho.',
          { correcao: 'Mover o negócio para Fechada antes' },
        );
      }

      // A proposta ACEITA mais recente do negócio — a regra vive em
      // `propostaAceitaRecente`, compartilhada com `obterPropostaAceitaDoNegocio`.
      const proposta = await propostaAceitaRecente(tx, dealId);

      if (!proposta) {
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
          // 0017: a assinatura entra na mesma cadeia das outras chaves — vem do snapshot
          // da proposta aceita e cai para o cadastro do tenant quando a proposta é antiga
          // (enviada antes de o agente configurar o nome).
          agentDisplayName: tenants.agentDisplayName,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);

      // Nomes de TODOS os clientes do negócio, congelados na MESMA política da proposta
      // (0020): titular primeiro, depois a ordem em que cada cliente entrou. É
      // FOTOGRAFIA — adicionar/remover cliente do negócio depois de gerar não muda o
      // roteiro que já foi pelo WhatsApp (mesmo racional do `clientName` ao lado). Só
      // nomes: a lista explícita da query é a proteção de coluna (0021).
      const linhasClientes = await tx
        .select({ nome: contacts.name })
        .from(dealContacts)
        .innerJoin(contacts, eq(contacts.id, dealContacts.contactId))
        .where(eq(dealContacts.dealId, dealId))
        .orderBy(desc(dealContacts.principal), asc(dealContacts.createdAt));

      const nova: NewItinerary = {
        tenantId,
        dealId,
        proposalId: proposta.id,
        publicToken: gerarTokenPublico(),
        title: proposta.title,
        currency: proposta.currency,
        clientName: negocio.contactName,
        clientes: linhasClientes.map((linha) => linha.nome),
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
          agentDisplayName:
            textoDoSnapshot(proposta.brandSnapshot, 'agentDisplayName') ??
            marca?.agentDisplayName ??
            null,
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

// ---------------------------------------------------------------------------
// Editor de roteiro — leitura apontada e escrita de SÓ conteúdo
// ---------------------------------------------------------------------------

/**
 * Qual proposta seria fotografada — o estado "ANTES de gerar". Para o card convidar
 * "Montar o roteiro" com atalho à proposta certa em vez de deixar a agente adivinhar.
 * A MESMA regra de escolha do `gerarRoteiro` (via `propostaAceitaRecente`): se esta
 * leitura aponta uma proposta, gerar fotografa ESTA; se devolve `null`, gerar recusaria
 * com "não tem proposta aceita". As duas respostas nunca se contradizem.
 *
 * LEITURA — sem gate de dunning, como toda leitura. Negócio de outro tenant devolve
 * `null` (o RLS some com a linha; "não existe" e "não é seu" são a mesma resposta).
 */
export async function obterPropostaAceitaDoNegocio(
  dealId: string,
): Promise<ServiceResult<PropostaAceitaDoNegocio | null>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const parsed = z.uuid('Negócio inválido').safeParse(dealId);
    if (!parsed.success) {
      throw new ServiceError('DADOS_INVALIDOS', parsed.error.issues[0]?.message ?? 'Dados inválidos', {
        campo: 'dealId',
        correcao: 'Abrir o negócio de novo',
      });
    }

    return withTenant(tenantId, async (tx) => {
      const proposta = await propostaAceitaRecente(tx, parsed.data);
      return proposta ? { proposalId: proposta.id, title: proposta.title } : null;
    });
  });
}

export type PropostaAceitaDoNegocio = {
  proposalId: string;
  title: string;
};

/** O roteiro DE UM negócio — o `RoteiroCard` para de carregar `listarRoteiros()` (teto 200) e filtrar no cliente. */
export async function listarRoteiroDoNegocio(
  dealId: string,
): Promise<ServiceResult<RoteiroResumo | null>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const parsed = z.uuid('Negócio inválido').safeParse(dealId);
    if (!parsed.success) {
      throw new ServiceError('DADOS_INVALIDOS', parsed.error.issues[0]?.message ?? 'Dados inválidos', {
        campo: 'dealId',
        correcao: 'Abrir o negócio de novo',
      });
    }

    return withTenant(tenantId, async (tx) => {
      const [roteiro] = await tx
        .select(COLUNAS_ROTEIRO)
        .from(itineraries)
        .where(eq(itineraries.dealId, parsed.data))
        .limit(1);

      return (roteiro as RoteiroResumo) ?? null;
    });
  });
}

/**
 * O conteúdo atual do snapshot — o que o editor abre para editar. Sem isso a tela teria
 * que ler o payload PÚBLICO (`obterRoteiroPublico`) para montar um formulário
 * autenticado, o que trocaria o dono do dado de lugar. `null` = o negócio ainda não tem
 * roteiro; os blocos vêm na MESMA forma que a escrita aceita de volta (`BlocoDoRoteiro`),
 * então o editor faz load → edit → save sem reshape nenhum.
 */
export async function obterConteudoDoRoteiro(
  dealId: string,
): Promise<ServiceResult<BlocoDoRoteiro[] | null>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const parsed = z.uuid('Negócio inválido').safeParse(dealId);
    if (!parsed.success) {
      throw new ServiceError('DADOS_INVALIDOS', parsed.error.issues[0]?.message ?? 'Dados inválidos', {
        campo: 'dealId',
        correcao: 'Abrir o negócio de novo',
      });
    }

    return withTenant(tenantId, async (tx) => {
      const [linha] = await tx
        .select({ blocksSnapshot: itineraries.blocksSnapshot })
        .from(itineraries)
        .where(eq(itineraries.dealId, parsed.data))
        .limit(1);

      if (!linha) return null;
      const snapshot = linha.blocksSnapshot;
      return Array.isArray(snapshot) ? snapshot.map(paraSnapshotDeBloco) : [];
    });
  });
}

/**
 * Reescreve SÓ O CONTEÚDO do roteiro já gerado — os blocos do snapshot. É a superfície de
 * escrita que faltava: a agente gerou o link, mandou no WhatsApp e esqueceu o contato de
 * emergência; hoje não havia caminho nenhum.
 *
 * O que NUNCA muda aqui (e é o ponto do contrato): `public_token` (o link que já foi pelo
 * WhatsApp continua válido — o cliente recarrega a MESMA URL), `proposal_id`, `title`,
 * `client_name`, `currency`, datas e `brand_snapshot`. Sem regeneração, sem nova
 * fotografia: a origem comercial do roteiro continua sendo a proposta aceita.
 *
 * Guardas, na ordem em que custam menos:
 *   1. zod — forma de bloco idêntica à do snapshot (`kind/position/title/body/images/
 *      content`), máx. 100 blocos; `kind` fica no vocabulário do CHECK de
 *      `proposal_blocks` (semântica nova viaja no `content`);
 *   2. gate de dunning na primeira linha da transação, como toda escrita;
 *   3. IDEMPOTÊNCIA barata — o autosave da tela vai martelar: mesmo conteúdo (comparação
 *      canônica, imune à reordenação de chaves do jsonb) é no-op, sem UPDATE e sem audit
 *      novo, para não sujar o histórico com "a mesma foto" dezenas de vezes;
 *   4. PORTARIA do §4 — qualquer chave de `content`, em qualquer profundidade, que cheire
 *      a preço/custo/comissão/documento é recusada antes do UPDATE (o leak-scanner
 *      continua sendo a rede que varre o payload público; isto é o portão). Ela vem
 *      DEPOIS do no-op de propósito: snapshot legado fotografado com chave proibida
 *      (`content` de bloco de proposta é `record` livre) re-salvo IGUAL não introduz
 *      nada — recusá-lo seria tijolar o editor de um roteiro que já está público;
 *      mudança REAL com chave proibida segue recusada com o campo exato.
 *
 * Nota de seleção (a portaria é o ESPELHO das famílias do scanner MAIS UMA): preço. O
 * scanner não pode banir preço em geral — a proposta pública é cotação e mostra preço de
 * opção; o roteiro NÃO é cotação (§4: preço é da opção), então a família `preco` só
 * existe aqui.
 *
 * Auditoria: `itinerary.updated` com `dealId` no metadata — mesmo formato do
 * `itinerary.created`.
 */
export async function atualizarConteudoDoRoteiro(
  dealId: string,
  blocos: BlocoDoRoteiro[],
): Promise<ServiceResult<RoteiroResumo>> {
  return comoResultado(async () => {
    const { tenantId, userId } = await requireAuthContext();

    const parsed = conteudoDoRoteiroInput.safeParse({ dealId, blocos });
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw new ServiceError('DADOS_INVALIDOS', primeiro?.message ?? 'Dados inválidos', {
        campo: primeiro?.path.join('.'),
        correcao: 'Corrigir o bloco e salvar de novo',
      });
    }
    const { dealId: negocio, blocos: novos } = parsed.data;

    return withTenant(tenantId, async (tx) => {
      // S13a: gate de dunning — recusa escrita se a conta está bloqueada.
      await exigirContaAtiva(tx, tenantId);

      const [atual] = await tx
        .select({ id: itineraries.id, blocksSnapshot: itineraries.blocksSnapshot })
        .from(itineraries)
        .where(eq(itineraries.dealId, negocio))
        .limit(1);

      if (!atual) {
        throw new ServiceError('NAO_ENCONTRADO', 'Este negócio ainda não tem roteiro gerado.', {
          correcao: 'Gerar o roteiro antes de editar o conteúdo',
        });
      }

      // Autosave que repete o mesmo conteúdo: no-op honesto — nada gravado, nada no
      // histórico. A comparação é canônica (ordem de chave irrelevante; o jsonb reordena).
      // VEM ANTES da portaria: re-salvar igual um snapshot legado que já nasceu com chave
      // proibida não introduz nada de novo (e recusá-lo travaria o editor); é MUDANÇA
      // com chave proibida que a portaria abaixo recusa.
      if (canonico(atual.blocksSnapshot) === canonico(novos)) {
        const [roteiro] = await tx
          .select(COLUNAS_ROTEIRO)
          .from(itineraries)
          .where(eq(itineraries.dealId, negocio))
          .limit(1);
        return roteiro as RoteiroResumo;
      }

      // A PORTARIA do §4, na porta do UPDATE. O `campo` aponta o bloco e a chave exatos
      // (`blocos[2].content.preco`), para o editor abrir o campo certo.
      for (const [indice, bloco] of novos.entries()) {
        const achado = acharChaveProibida(bloco.content, `blocos[${indice}].content`);
        if (achado) {
          throw new ServiceError(
            'DADOS_INVALIDOS',
            `O roteiro não pode guardar "${achado.chave}" — ${achado.label} não vai para a página do cliente.`,
            { campo: achado.caminho, correcao: 'Remover esse campo do bloco e salvar de novo' },
          );
        }
      }

      const gravado = await tx
        .update(itineraries)
        .set({ blocksSnapshot: novos, updatedAt: new Date() })
        .where(eq(itineraries.dealId, negocio))
        .returning({ id: itineraries.id });

      if (gravado.length === 0) {
        // Sumiu entre o select e o update — só com concorrência externa; o envelope
        // importa mais que o estouro de tipo.
        throw new ServiceError('NAO_ENCONTRADO', 'Este negócio ainda não tem roteiro gerado.', {
          correcao: 'Gerar o roteiro antes de editar o conteúdo',
        });
      }

      await registrarAuditoria(tx, {
        tenantId,
        actorUserId: userId,
        action: 'itinerary.updated',
        entity: 'itinerary',
        entityId: atual.id,
        metadata: { dealId: negocio },
      });

      // Estado PERSISTIDO, não o patch — o `RoteiroResumo` reconciliado é o que a tela
      // guarda (mesma doutrina de `atualizarNegocio`).
      const [roteiro] = await tx
        .select(COLUNAS_ROTEIRO)
        .from(itineraries)
        .where(eq(itineraries.dealId, negocio))
        .limit(1);

      return roteiro as RoteiroResumo;
    });
  });
}
