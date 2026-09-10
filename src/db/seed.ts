/**
 * Seed: dois tenants com cenários completos de demonstração.
 *
 *     node --import ./src/db/_register.mjs --env-file=.env.local src/db/seed.ts
 *
 * É o insumo do teste de isolamento (S1) e o dado de TRABALHO de quem clica na
 * aplicação: hoje (2026-09-09) ele conta uma história de ~4 meses até o presente,
 * com o funil inteiro habitado. No tenant A ("Volta ao Mundo", login
 * `dev@zarpa.local` / `dev12345`) vivem os cenários que o PO pediu:
 *
 *   - negócios em CADA estágio do funil (novo/cotando/proposta_enviada/
 *     negociando/ganho/perdido), incluindo proposta parada há 9 dias sem resposta;
 *   - propostas enviadas com visualizações registradas — uma ABERTA HOJE
 *     (Fernando, 3 visitas), outra aberta ONTEM (Juliana) — para alimentar
 *     "Abriram sua proposta" do /hoje;
 *   - proposta aceita e proposta RECUSADA com motivo (Ricardo, `lost_reason`);
 *   - viagem EM CURSO agora (Marina em Portugal, ida -4d / volta +11d) e
 *     futuras (Patagônia +125d) — alimentam "Em viagem";
 *   - roteiros gerados (`itineraries`, fotografia de verdade dos blocos da
 *     proposta aceita) para as viagens em curso e para uma passada;
 *   - lembretes vencidos, para hoje e futuros — inclusive os GERADOS
 *     (régua de follow-up com `dedupe_key`, alerta de passaporte e de
 *     aniversário), nos mesmos formatos de `alerts.ts`/`followups.ts`;
 *   - cliente com TRÊS compras (Marina — a recompra visível na ficha 360°);
 *   - vendas (`sales`) com comissão em três estados e parcelas do cliente
 *     (`receivables`) pagas, pendentes e atrasadas;
 *   - valores verossímeis entre R$ 3.500 e R$ 28.000.
 *
 * PII: mesma via da aplicação — `camposDocumentoDoContato`/`camposCpfDoViajante`/
 * `camposNascimento` (cifra + hash cego + key_id, sempre juntos) e `blindIndex`
 * para o `ip_hash` das visitas. Nada sensível em claro, nada em log.
 *
 * Reparar: TODA escrita de tenant passa por `withTenant`. O seed roda como
 * `zarpa` (NOSUPERUSER, NOBYPASSRLS) — se uma policy estivesse errada, o seed
 * seria o primeiro a quebrar.
 *
 * Idempotente: apaga os dois tenants de demonstração (CASCADE leva o resto) antes
 * de recriar, pelos slugs conhecidos. `npm run db:seed` pode rodar quantas vezes
 * quiser sem sujar.
 */

import { asc, desc, eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { unsafeSqlWithoutTenant as sqlSemTenant } from './client';
import { withTenant, type TenantDb } from '../lib/tenant/withTenant';
import { withPlatformContext } from '../lib/tenant/withPlatformContext';
import { uuidv7 } from './uuid';
import { activeKeyId, blindIndex } from '../lib/crypto/keyring';
import { encryptPII } from '../lib/crypto/pii';
import {
  camposCpfDoViajante,
  camposDocumentoDoContato,
  camposNascimento,
} from '../server/piiFields';
import { groupMembers, groups } from './schema/groups';
import { offers as offersTable } from './schema/offers';
// Import direto dos módulos, não do barril `../lib/auth`: o barril reexporta `session.ts`,
// que importa `next/headers` — inexistente fora do runtime do Next.js, e este seed roda
// como script Node puro.
import { auth } from '../lib/auth/auth';
import { authDb, authSql } from '../lib/auth/db';
import { withPendingTenant } from '../lib/auth/signupContext';
import {
  activities,
  auditLog,
  contacts,
  dealContacts,
  deals,
  importBatches,
  integrations,
  itineraries,
  libraryItems,
  payments,
  proposalBlocks,
  proposalOptions,
  proposalViews,
  proposals,
  receivables,
  sales,
  subscriptions,
  tasks,
  tenants,
  travelers,
  user,
  pipelineStages,
} from './schema';

const DEMO_SLUGS = ['volta-ao-mundo', 'mare-alta'];

/** Tabelas que o DELETE em cascata de `tenants` leva junto — conferência do fim. */
const PLAN_PRICE_CENTS = { solo: 4_900, pro: 9_900, studio: 19_900 } as const;

/**
 * Usuário de desenvolvimento, com senha de verdade, criado pela API do Better Auth (nunca
 * inserido à mão nas tabelas dele — é a própria API que gera o hash scrypt e grava
 * `account.password`). Vive no tenant A ("Volta ao Mundo"). Credenciais fixas e óbvias:
 * isto só existe porque `requireEmailVerification: false` e o banco é local — nunca faça
 * isto apontando para produção.
 */
const DEV_USER = {
  name: 'Dev Zarpa',
  email: 'dev@zarpa.local',
  password: 'dev12345',
} as const;

// ---------------------------------------------------------------------------
// Tempo — todo o cenário é RELATIVO a hoje, para o seed nunca "envelhecer".
// ---------------------------------------------------------------------------

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function isoDate(days: number): string {
  return daysFromNow(days).toISOString().slice(0, 10);
}

/** `days` pode ser fracionário (-0.25 = 6h atrás). Hora local do aparelho. */
function em(days: number, hour: number, minute = 0): Date {
  const base = daysFromNow(days);
  base.setHours(hour, minute, 0, 0);
  return base;
}

// ---------------------------------------------------------------------------
// Helpers de inserção — todos recebem a transação do `withTenant` corrente.
// ---------------------------------------------------------------------------

/** Token de link público. 22 chars base64url ~= 128 bits. Não é sequencial de propósito. */
function publicToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

type ContatoSeed = {
  name: string;
  email: string;
  phone: string;
  document: string;
  birthDate: string;
  source: 'whatsapp' | 'instagram' | 'indicacao' | 'site' | 'evento' | 'outro';
  notes?: string;
  tags?: string[];
  criadoEm: Date;
};

async function criarContato(
  tx: TenantDb,
  tenantId: string,
  dados: ContatoSeed,
): Promise<string> {
  // Mesma via da aplicação: cifra + hash cego + key_id andam JUNTOS (CHECK no banco),
  // e `birth_month_day` fica em claro para o alerta de aniversário enxergar.
  const documento = camposDocumentoDoContato(tenantId, dados.document);
  const nascimento = camposNascimento(dados.birthDate);

  const [linha] = await tx
    .insert(contacts)
    .values({
      tenantId,
      name: dados.name,
      email: dados.email,
      phone: dados.phone,
      whatsapp: dados.phone,
      ...documento,
      ...nascimento,
      source: dados.source,
      tags: dados.tags ?? [],
      notes: dados.notes ?? null,
      createdAt: dados.criadoEm,
      updatedAt: dados.criadoEm,
    })
    .returning({ id: contacts.id });
  return linha!.id;
}

type ViajanteSeed = {
  fullName: string;
  kind?: 'adult' | 'child' | 'infant';
  cpf?: string;
  passport?: string;
  passportExpiresOn?: string;
  birthDate?: string;
};

async function criarViajante(
  tx: TenantDb,
  tenantId: string,
  contatoId: string,
  dados: ViajanteSeed,
): Promise<string> {
  const cpf = dados.cpf ? camposCpfDoViajante(tenantId, dados.cpf) : {};
  const nascimento = dados.birthDate ? camposNascimento(dados.birthDate) : {};

  const [linha] = await tx
    .insert(travelers)
    .values({
      tenantId,
      contactId: contatoId,
      fullName: dados.fullName,
      kind: dados.kind ?? 'adult',
      ...cpf,
      passportNumber: dados.passport ?? null,
      passportExpiresOn: dados.passportExpiresOn ?? null,
      ...nascimento,
      nationality: 'BR',
    })
    .returning({ id: travelers.id });
  return linha!.id;
}

type DealStage = 'novo' | 'cotando' | 'proposta_enviada' | 'negociando' | 'ganho' | 'perdido';

type NegocioSeed = {
  title: string;
  destination: string;
  stage: DealStage;
  valueCents: number;
  costCents: number;
  paxAdults?: number;
  paxChildren?: number;
  departureOn?: string;
  returnOn?: string;
  expectedCloseOn?: string;
  lostReason?: string;
  closedAt?: Date | null;
  criadoEm: Date;
};

async function criarNegocio(
  tx: TenantDb,
  tenantId: string,
  contatoId: string,
  dados: NegocioSeed,
): Promise<string> {
  // `stage` só como enum: o trigger `deals_estagio_sync` (0016) resolve o `stage_id`
  // a partir do funil semeado — o mesmo contrato que a aplicação usa.
  const [linha] = await tx
    .insert(deals)
    .values({
      tenantId,
      contactId: contatoId,
      title: dados.title,
      destination: dados.destination,
      stage: dados.stage,
      valueCents: dados.valueCents,
      costCents: dados.costCents,
      commissionCents: dados.valueCents - dados.costCents,
      paxAdults: dados.paxAdults ?? 2,
      paxChildren: dados.paxChildren ?? 0,
      departureOn: dados.departureOn ?? null,
      returnOn: dados.returnOn ?? null,
      expectedCloseOn: dados.expectedCloseOn ?? null,
      lostReason: dados.lostReason ?? null,
      closedAt: dados.closedAt ?? (dados.stage === 'ganho' || dados.stage === 'perdido' ? dados.criadoEm : null),
      createdAt: dados.criadoEm,
      updatedAt: dados.criadoEm,
    })
    .returning({ id: deals.id });
  const dealId = linha!.id;

  // 0020 — a linha principal é o espelho de `deals.contact_id`: todo negócio nasce com
  // ela (mesma invariante que `criarNegocio` em `src/server/deals.ts` planta e que o
  // partial unique `deal_contacts_deal_principal_key` garante no banco).
  await tx.insert(dealContacts).values({
    tenantId,
    dealId,
    contactId: contatoId,
    principal: true,
    createdAt: dados.criadoEm,
  });

  return dealId;
}

/**
 * 0020 — o SEGUNDO cliente do negócio (casal, família, amigos): entra como secundário
 * na N:N `deal_contacts`, pelo mesmo caminho que `adicionarClienteAoNegocio` grava.
 * O principal (`deals.contact_id`) nunca passa por aqui.
 */
async function adicionarClienteSecundario(
  tx: TenantDb,
  tenantId: string,
  dealId: string,
  contatoId: string,
  criadoEm: Date,
): Promise<void> {
  await tx.insert(dealContacts).values({
    tenantId,
    dealId,
    contactId: contatoId,
    principal: false,
    createdAt: criadoEm,
  });
}

type OpcaoSeed = { name: string; priceCents: number; costCents: number; recommended?: boolean };
type BlocoSeed = {
  kind:
    | 'text'
    | 'image'
    | 'flight'
    | 'hotel'
    | 'transfer'
    | 'tour'
    | 'cruise'
    | 'insurance'
    | 'price_note';
  title: string;
  body?: string;
  content?: Record<string, unknown>;
  /** `null` = bloco da proposta inteira; senão, o nome da opção a que pertence. */
  optionName?: string | null;
};
type VisitaSeed = { quando: Date; durationMs: number };

type PropostaSeed = {
  title: string;
  summary: string;
  options: OpcaoSeed[];
  blocks: BlocoSeed[];
  sentAt: Date | null;
  validUntilDays?: number;
  views?: VisitaSeed[];
  acceptedOptionName?: string;
  acceptedAt?: Date | null;
  declinedAt?: Date | null;
};

type PropostaCriada = {
  id: string;
  token: string;
  opcaoPorNome: Map<string, string>;
  opcaoAceitaId: string | null;
};

/** As mesmas chaves de `proposals.brand_snapshot` e `itineraries.brand_snapshot`. */
type MarcaSeed = {
  name: string;
  primaryColor: string;
  secondaryColor: string;
  whatsapp: string;
  instagram: string;
  /** 0017 — a assinatura do agente ("Volta ao Mundo · por Carolina Vasques"). */
  agentDisplayName: string;
};

const MARCA_VOLTA_AO_MUNDO: MarcaSeed = {
  name: 'Volta ao Mundo',
  primaryColor: '#12557F',
  secondaryColor: '#0D1A24',
  whatsapp: '+5511991002000',
  instagram: 'voltaaomundo.viagens',
  agentDisplayName: 'Carolina Vasques',
};

const MARCA_MARE_ALTA: MarcaSeed = {
  name: 'Maré Alta',
  primaryColor: '#12557F',
  secondaryColor: '#0D1A24',
  whatsapp: '+5581987650001',
  instagram: 'marealta.turismo',
  agentDisplayName: 'Rodrigo Sanhudo',
};

/**
 * Proposta completa: opções + blocos + estado (sent/viewed/accepted/declined) +
 * aberturas reais em `proposal_views` — é este dado que alimenta "Abriram sua
 * proposta" do /hoje e a ficha 360° do cliente.
 */
async function criarProposta(
  tx: TenantDb,
  tenantId: string,
  dealId: string,
  marca: MarcaSeed,
  dados: PropostaSeed,
): Promise<PropostaCriada> {
  const token = publicToken();
  const opcaoPorNome = new Map<string, string>();

  const [proposta] = await tx
    .insert(proposals)
    .values({
      tenantId,
      dealId,
      publicToken: token,
      title: dados.title,
      summary: dados.summary,
      status: 'draft',
      validUntil: dados.validUntilDays !== undefined ? isoDate(dados.validUntilDays) : null,
      brandSnapshot: { ...marca, logoUrl: null },
      terms: 'Valores sujeitos a confirmação de disponibilidade e câmbio do dia.',
    })
    .returning({ id: proposals.id });
  const propostaId = proposta!.id;

  const opcoesInseridas = await tx
    .insert(proposalOptions)
    .values(
      dados.options.map((opcao, i) => ({
        tenantId,
        proposalId: propostaId,
        name: opcao.name,
        description: `Opção ${opcao.name} — montada para a viagem.`,
        position: i,
        priceCents: opcao.priceCents,
        costCents: opcao.costCents,
        commissionCents: opcao.priceCents - opcao.costCents,
        installments: 10,
        installmentCents: Math.round(opcao.priceCents / 10),
        isRecommended: opcao.recommended ?? false,
      })),
    )
    .returning({ id: proposalOptions.id, name: proposalOptions.name });
  for (const opcao of opcoesInseridas) opcaoPorNome.set(opcao.name, opcao.id);

  await tx.insert(proposalBlocks).values(
    dados.blocks.map((bloco, i) => ({
      tenantId,
      proposalId: propostaId,
      optionId: bloco.optionName ? (opcaoPorNome.get(bloco.optionName) ?? null) : null,
      kind: bloco.kind,
      position: i,
      title: bloco.title,
      body: bloco.body ?? null,
      content: bloco.content ?? {},
    })),
  );

  const status = dados.acceptedOptionName
    ? 'accepted'
    : dados.declinedAt
      ? 'declined'
      : dados.views && dados.views.length > 0
        ? 'viewed'
        : dados.sentAt
          ? 'sent'
          : 'draft';

  const visitas = [...(dados.views ?? [])].sort((a, b) => a.quando.valueOf() - b.quando.valueOf());
  if (visitas.length > 0) {
    await tx.insert(proposalViews).values(
      visitas.map((visita, i) => ({
        tenantId,
        proposalId: propostaId,
        sessionKey: `sess_${token.slice(0, 8)}_${i + 1}`,
        ipHash: blindIndex('203.0.113.10', 'proposal_view_ip'),
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
        referrer: 'https://wa.me/',
        country: 'BR',
        durationMs: visita.durationMs,
        viewedAt: visita.quando,
      })),
    );
  }

  await tx
    .update(proposals)
    .set({
      status,
      sentAt: dados.sentAt,
      firstViewedAt: visitas[0]?.quando ?? null,
      lastViewedAt: visitas.at(-1)?.quando ?? null,
      viewCount: visitas.length,
      acceptedOptionId:
        dados.acceptedOptionName ? (opcaoPorNome.get(dados.acceptedOptionName) ?? null) : null,
      acceptedAt: dados.acceptedAt ?? null,
      declinedAt: dados.declinedAt ?? null,
    })
    .where(eq(proposals.id, propostaId));

  return {
    id: propostaId,
    token,
    opcaoPorNome,
    opcaoAceitaId: dados.acceptedOptionName
      ? (opcaoPorNome.get(dados.acceptedOptionName) ?? null)
      : null,
  };
}

/**
 * A fotografia do `gerarRoteiro` (`src/server/itineraries.ts`), com a MESMA regra de
 * seleção: blocos da proposta inteira + os da opção aceita, por `position`. Sem custo,
 * sem comissão, sem preço — a página pública é lida sem login.
 */
async function fotografarBlocos(
  tx: TenantDb,
  propostaId: string,
  opcaoAceitaId: string | null,
): Promise<{ kind: string; position: number; title: string | null; body: string | null; images: string[]; content: Record<string, unknown> }[]> {
  const linhas = await tx
    .select({
      kind: proposalBlocks.kind,
      position: proposalBlocks.position,
      title: proposalBlocks.title,
      body: proposalBlocks.body,
      images: proposalBlocks.images,
      content: proposalBlocks.content,
      optionId: proposalBlocks.optionId,
    })
    .from(proposalBlocks)
    .where(eq(proposalBlocks.proposalId, propostaId))
    .orderBy(proposalBlocks.position);

  return linhas
    .filter((linha) => linha.optionId === null || linha.optionId === opcaoAceitaId)
    .map((linha) => ({
      kind: linha.kind,
      position: linha.position,
      title: linha.title,
      body: linha.body,
      images: Array.isArray(linha.images) ? linha.images.filter((i): i is string => typeof i === 'string') : [],
      content:
        typeof linha.content === 'object' && linha.content !== null
          ? (linha.content as Record<string, unknown>)
          : {},
    }));
}

async function gerarRoteiroSeed(
  tx: TenantDb,
  tenantId: string,
  dealId: string,
  propostaId: string,
  propostaTitulo: string,
  opcaoAceitaId: string | null,
  marca: MarcaSeed,
  clientName: string,
  departureOn: string | null,
  returnOn: string | null,
  criadoEm: Date,
): Promise<void> {
  const blocos = await fotografarBlocos(tx, propostaId, opcaoAceitaId);

  // 0021: a lista de clientes é FOTOGRAFIA igual ao client_name — congelada da mesma
  // fonte e na mesma ordem do `gerarRoteiro` real (titular primeiro, depois a ordem de
  // entrada). O seed semeia direto na tabela, então congela aqui para o roteiro de
  // demonstração nascer fiel ao que a action gravaria.
  const linhasClientes = await tx
    .select({ nome: contacts.name })
    .from(dealContacts)
    .innerJoin(contacts, eq(contacts.id, dealContacts.contactId))
    .where(eq(dealContacts.dealId, dealId))
    .orderBy(desc(dealContacts.principal), asc(dealContacts.createdAt));

  await tx.insert(itineraries).values({
    tenantId,
    dealId,
    proposalId: propostaId,
    publicToken: publicToken(),
    title: propostaTitulo, // o roteiro real congela o título da proposta aceita
    currency: 'BRL',
    clientName,
    clientes: linhasClientes.map((linha) => linha.nome),
    departureOn,
    returnOn,
    blocksSnapshot: blocos,
    brandSnapshot: { ...marca, logoUrl: null },
    createdAt: criadoEm,
    updatedAt: criadoEm,
  });
}

type VendaSeed = {
  fornecedor: string;
  propostaId: string;
  opcaoId: string | null;
  valorBrutoCents: number;
  custoCents: number;
  comissaoPrevistaCents: number;
  taxaServicoCents: number;
  comissaoStatus: 'prevista' | 'recebida' | 'atrasada';
  /** Parcelas do CLIENTE. `status: 'pago'` exige `pagoEm`. */
  parcelas: { venceEm: string; valorCents: number; status: 'pendente' | 'pago' | 'atrasado'; pagoEm?: Date }[];
  criadoEm: Date;
};

async function criarVenda(
  tx: TenantDb,
  tenantId: string,
  dealId: string,
  dados: VendaSeed,
): Promise<string> {
  const [venda] = await tx
    .insert(sales)
    .values({
      tenantId,
      dealId,
      proposalId: dados.propostaId,
      proposalOptionId: dados.opcaoId,
      fornecedor: dados.fornecedor,
      valorBrutoCents: dados.valorBrutoCents,
      custoCents: dados.custoCents,
      comissaoPrevistaCents: dados.comissaoPrevistaCents,
      taxaServicoCents: dados.taxaServicoCents,
      comissaoStatus: dados.comissaoStatus,
      createdAt: dados.criadoEm,
      updatedAt: dados.criadoEm,
    })
    .returning({ id: sales.id });
  const vendaId = venda!.id;

  if (dados.parcelas.length > 0) {
    await tx.insert(receivables).values(
      dados.parcelas.map((parcela) => ({
        tenantId,
        saleId: vendaId,
        venceEm: parcela.venceEm,
        valorCents: parcela.valorCents,
        status: parcela.status,
        pagoEm: parcela.status === 'pago' ? (parcela.pagoEm ?? new Date()) : null,
      })),
    );
  }
  return vendaId;
}

type TarefaSeed = {
  dealId?: string;
  contactId?: string;
  title: string;
  notes?: string;
  kind?: 'followup' | 'ligar' | 'whatsapp' | 'email' | 'outro';
  /** Tarefa GERADA: `source` + `dedupeKey` + `suggestedMessage`, nos formatos de
   * `alerts.ts` (`passaporte:<viajante>:<validade>:<janela>`,
   * `aniversario:contato:<contato>:<ano>`) e `followups.ts`
   * (`followup:proposta:<proposta>:<marco>`). */
  gerada?: { source: 'alerta_passaporte' | 'alerta_aniversario' | 'followup_proposta'; dedupeKey: string };
  suggestedMessage?: string;
  dueAt: Date;
  doneAt?: Date | null;
  ownerId: string;
};

async function criarTarefa(tx: TenantDb, tenantId: string, dados: TarefaSeed): Promise<void> {
  const gerada = dados.gerada;
  await tx.insert(tasks).values({
    tenantId,
    dealId: dados.dealId ?? null,
    contactId: dados.contactId ?? null,
    title: dados.title,
    notes: dados.notes ?? null,
    kind: gerada?.source === 'followup_proposta' ? 'followup' : (dados.kind ?? 'outro'),
    source: gerada?.source ?? 'manual',
    dedupeKey: gerada?.dedupeKey ?? null,
    suggestedMessage: dados.suggestedMessage ?? null,
    dueAt: dados.dueAt,
    doneAt: dados.doneAt ?? null,
    createdBy: gerada ? null : dados.ownerId,
  });
}

type AtividadeSeed = {
  dealId?: string;
  contactId?: string;
  proposalId?: string;
  type: 'note' | 'stage_changed' | 'proposal_sent' | 'proposal_viewed' | 'proposal_accepted' | 'task_done' | 'message' | 'contact_created';
  body: string;
  metadata?: Record<string, unknown>;
  ocorreuEm: Date;
  ownerId: string;
};

async function criarAtividade(tx: TenantDb, tenantId: string, dados: AtividadeSeed): Promise<void> {
  await tx.insert(activities).values({
    tenantId,
    dealId: dados.dealId ?? null,
    contactId: dados.contactId ?? null,
    proposalId: dados.proposalId ?? null,
    actorUserId: dados.ownerId,
    type: dados.type,
    body: dados.body,
    metadata: dados.metadata ?? {},
    occurredAt: dados.ocorreuEm,
  });
}

// ---------------------------------------------------------------------------
// Tenant A — "Volta ao Mundo" (o cenário completo; dev user entra aqui)
// ---------------------------------------------------------------------------

async function cenarioVoltaAoMundo(tx: TenantDb, tenantId: string, ownerId: string): Promise<void> {
  const tag = ['volta-ao-mundo'];

  // --- Marina: a recompra — três viagens fechadas em 4 meses -----------------
  const marina = await criarContato(tx, tenantId, {
    name: 'Marina Albuquerque',
    email: 'marina.albuquerque@exemplo.test',
    phone: '+5511991002001',
    document: '52998224725',
    birthDate: '1984-03-11',
    source: 'instagram',
    tags: [...tag, 'recompra', 'lua-de-mel'],
    notes: 'Prefere voos diretos. Aniversário de casamento em setembro — lembrar de viagem-presente.',
    criadoEm: daysFromNow(-120),
  });
  await criarViajante(tx, tenantId, marina, {
    fullName: 'Marina Albuquerque',
    cpf: '52998224725',
    passport: 'FR334415',
    passportExpiresOn: isoDate(400),
    birthDate: '1984-03-11',
  });
  const rafael = await criarViajante(tx, tenantId, marina, {
    fullName: 'Rafael Albuquerque',
    cpf: '11144477735',
    passport: 'FR334416',
    passportExpiresOn: isoDate(720),
    birthDate: '1982-11-27',
  });
  await criarViajante(tx, tenantId, marina, {
    fullName: 'Luiza Albuquerque',
    kind: 'child',
    cpf: '22255588846',
    passport: 'FR334417',
    passportExpiresOn: isoDate(380),
    birthDate: '2016-05-08',
  });

  // a) A primeira compra — voltou há 5 dias (alimenta "Retornou há N" com o CTA
  //    de depoimento no /hoje).
  const negocioNoronha = await criarNegocio(tx, tenantId, marina, {
    title: 'Fernando de Noronha em família',
    destination: 'Fernando de Noronha, PE',
    stage: 'ganho',
    valueCents: 18_400_000,
    costCents: 14_100_000,
    paxAdults: 2,
    paxChildren: 1,
    departureOn: isoDate(-15),
    returnOn: isoDate(-5),
    criadoEm: daysFromNow(-60),
    closedAt: daysFromNow(-25),
  });
  const propostaNoronha = await criarProposta(tx, tenantId, negocioNoronha, MARCA_VOLTA_AO_MUNDO, {
    title: 'Noronha — 7 noites, pousada pé na areia',
    summary: 'Sete noites na Praia do Cachorro, com passeio de barco às Ilhas e mergulho batizado.',
    options: [
      { name: 'Essencial', priceCents: 15_900_000, costCents: 12_300_000 },
      { name: 'Conforto', priceCents: 18_400_000, costCents: 14_100_000, recommended: true },
    ],
    blocks: [
      { kind: 'text', title: 'Sobre a viagem', body: 'Sete noites na Praia do Cachorro, com passeio de barco às Ilhas e mergulho batizado.' },
      { kind: 'flight', title: 'Aéreo REC × FEN', content: { cia: 'LATAM', bagagem: '1x23kg', escalas: 0 }, optionName: 'Conforto' },
      { kind: 'hotel', title: 'Pousada Maravilha', content: { noites: 7, regime: 'café da manhã', categoria: 'boutique' }, optionName: 'Conforto' },
      { kind: 'tour', title: 'Barco das Ilhas', content: { duracao: 'dia inteiro', inclui: 'almoço e equipamento de snorkel' }, optionName: 'Conforto' },
    ],
    sentAt: daysFromNow(-45),
    validUntilDays: 10,
    views: [
      { quando: daysFromNow(-44), durationMs: 96_000 },
      { quando: daysFromNow(-43), durationMs: 210_000 },
      { quando: daysFromNow(-27), durationMs: 154_000 },
    ],
    acceptedOptionName: 'Conforto',
    acceptedAt: daysFromNow(-25),
  });
  await criarVenda(tx, tenantId, negocioNoronha, {
    fornecedor: 'CVC Operadora',
    propostaId: propostaNoronha.id,
    opcaoId: propostaNoronha.opcaoAceitaId,
    valorBrutoCents: 18_400_000,
    custoCents: 14_100_000,
    comissaoPrevistaCents: 3_600_000,
    taxaServicoCents: 700_000,
    comissaoStatus: 'recebida',
    parcelas: [
      { venceEm: isoDate(-20), valorCents: 6_400_000, status: 'pago', pagoEm: daysFromNow(-21) },
      { venceEm: isoDate(-10), valorCents: 6_400_000, status: 'pago', pagoEm: daysFromNow(-10) },
      { venceEm: isoDate(0), valorCents: 6_300_000, status: 'pago', pagoEm: em(-1, 10, 12) },
    ],
    criadoEm: daysFromNow(-25),
  });
  await gerarRoteiroSeed(tx, tenantId, negocioNoronha, propostaNoronha.id, 'Noronha — 7 noites, pousada pé na areia', propostaNoronha.opcaoAceitaId, MARCA_VOLTA_AO_MUNDO, 'Marina Albuquerque', isoDate(-15), isoDate(-5), daysFromNow(-24));

  // b) A viagem EM CURSO AGORA — ida -4d, volta +11d. É o card "Em viagem até…"
  //    do /hoje e o roteiro pronto do pós-venda.
  const negocioPortugal = await criarNegocio(tx, tenantId, marina, {
    title: 'Lua de mel em Portugal',
    destination: 'Lisboa e Vale do Douro, Portugal',
    stage: 'ganho',
    valueCents: 24_900_000,
    costCents: 18_700_000,
    paxAdults: 2,
    departureOn: isoDate(-4),
    returnOn: isoDate(11),
    criadoEm: daysFromNow(-70),
    closedAt: daysFromNow(-45),
  });
  const propostaPortugal = await criarProposta(tx, tenantId, negocioPortugal, MARCA_VOLTA_AO_MUNDO, {
    title: 'Portugal — 14 noites, Lisboa + Douro + Algarve',
    summary: 'Duas semanas entre Lisboa, um cruzeiro no Douro e três dias de Algarve — aéreo, hotéis e transfers.',
    options: [
      { name: 'Essencial', priceCents: 21_800_000, costCents: 16_500_000 },
      { name: 'Conforto', priceCents: 24_900_000, costCents: 18_700_000, recommended: true },
    ],
    blocks: [
      { kind: 'text', title: 'Sobre a viagem', body: 'Duas semanas entre Lisboa, um cruzeiro no Douro e três dias de Algarve.' },
      { kind: 'flight', title: 'Aéreo GRU × LIS', content: { cia: 'TAP', bagagem: '2x23kg', escalas: 0 }, optionName: 'Conforto' },
      { kind: 'hotel', title: 'Lisboa — 5 noites', content: { noites: 5, regime: 'café da manhã', categoria: '4 estrelas' }, optionName: 'Conforto' },
      { kind: 'tour', title: 'Cruzeiro no Douro', content: { duracao: '2 noites a bordo', inclui: 'jantares e degustação' }, optionName: 'Conforto' },
      { kind: 'transfer', title: 'Transfers em Portugal', content: { trechos: 'aeroporto × hotel × estação' }, optionName: 'Conforto' },
    ],
    sentAt: daysFromNow(-56),
    validUntilDays: 21,
    views: [
      { quando: daysFromNow(-55), durationMs: 120_000 },
      { quando: daysFromNow(-54), durationMs: 260_000 },
      { quando: daysFromNow(-47), durationMs: 300_000 },
      { quando: daysFromNow(-46), durationMs: 180_000 },
    ],
    acceptedOptionName: 'Conforto',
    acceptedAt: daysFromNow(-45),
  });
  await criarVenda(tx, tenantId, negocioPortugal, {
    fornecedor: 'Decolar',
    propostaId: propostaPortugal.id,
    opcaoId: propostaPortugal.opcaoAceitaId,
    valorBrutoCents: 24_900_000,
    custoCents: 18_700_000,
    comissaoPrevistaCents: 4_300_000,
    taxaServicoCents: 900_000,
    comissaoStatus: 'recebida',
    parcelas: [
      { venceEm: isoDate(-40), valorCents: 5_160_000, status: 'pago', pagoEm: daysFromNow(-40) },
      { venceEm: isoDate(-30), valorCents: 5_160_000, status: 'pago', pagoEm: daysFromNow(-29) },
      { venceEm: isoDate(-10), valorCents: 5_160_000, status: 'pago', pagoEm: daysFromNow(-9) },
      { venceEm: isoDate(20), valorCents: 5_160_000, status: 'pendente' },
      { venceEm: isoDate(50), valorCents: 5_160_000, status: 'pendente' },
    ],
    criadoEm: daysFromNow(-45),
  });
  // O roteiro da viagem em curso — o link que a Marina abriu no aeroporto.
  await gerarRoteiroSeed(tx, tenantId, negocioPortugal, propostaPortugal.id, 'Portugal — 14 noites, Lisboa + Douro + Algarve', propostaPortugal.opcaoAceitaId, MARCA_VOLTA_AO_MUNDO, 'Marina Albuquerque', isoDate(-4), isoDate(11), daysFromNow(-44));

  // c) A recompra — fechada há 6 dias, viaja em janeiro ("Viaja em N dias").
  const negocioPatagonia = await criarNegocio(tx, tenantId, marina, {
    title: 'Patagônia em janeiro',
    destination: 'El Calafate e Ushuaia, Argentina',
    stage: 'ganho',
    valueCents: 14_200_000,
    costCents: 10_400_000,
    paxAdults: 2,
    departureOn: isoDate(125),
    returnOn: isoDate(136),
    criadoEm: daysFromNow(-30),
    closedAt: daysFromNow(-6),
  });
  const propostaPatagonia = await criarProposta(tx, tenantId, negocioPatagonia, MARCA_VOLTA_AO_MUNDO, {
    title: 'Patagônia — 11 noites, geleiras e fim do mundo',
    summary: 'El Calafate com Perito Moreno, torres de El Chaltén e Ushuaia — janeiro é verão lá.',
    options: [
      { name: 'Essencial', priceCents: 12_400_000, costCents: 9_100_000 },
      { name: 'Conforto', priceCents: 14_200_000, costCents: 10_400_000, recommended: true },
    ],
    blocks: [
      { kind: 'text', title: 'Sobre a viagem', body: 'El Calafate com Perito Moreno, El Chaltén e Ushuaia — verão patagônico.' },
      { kind: 'flight', title: 'Aéreo GRU × FTE', content: { cia: 'Aerolíneas', bagagem: '1x23kg', escalas: 1 }, optionName: 'Conforto' },
      { kind: 'hotel', title: 'El Calafate — 4 noites', content: { noites: 4, regime: 'café da manhã', categoria: '3 estrelas superior' }, optionName: 'Conforto' },
    ],
    sentAt: daysFromNow(-20),
    validUntilDays: 14,
    views: [
      { quando: daysFromNow(-19), durationMs: 140_000 },
      { quando: daysFromNow(-12), durationMs: 95_000 },
      { quando: daysFromNow(-7), durationMs: 230_000 },
    ],
    acceptedOptionName: 'Conforto',
    acceptedAt: daysFromNow(-6),
  });
  await criarVenda(tx, tenantId, negocioPatagonia, {
    fornecedor: 'Oi Viagens',
    propostaId: propostaPatagonia.id,
    opcaoId: propostaPatagonia.opcaoAceitaId,
    valorBrutoCents: 14_200_000,
    custoCents: 10_400_000,
    comissaoPrevistaCents: 2_900_000,
    taxaServicoCents: 500_000,
    comissaoStatus: 'prevista',
    parcelas: [
      { venceEm: isoDate(-5), valorCents: 4_900_000, status: 'pago', pagoEm: daysFromNow(-5) },
      { venceEm: isoDate(25), valorCents: 4_900_000, status: 'pendente' },
      { venceEm: isoDate(55), valorCents: 4_900_000, status: 'pendente' },
    ],
    criadoEm: daysFromNow(-6),
  });

  await criarAtividade(tx, tenantId, { contactId: marina, type: 'contact_created', body: 'Marina chegou pelo Instagram.', metadata: { source: 'instagram' }, ocorreuEm: daysFromNow(-120), ownerId });
  await criarAtividade(tx, tenantId, { dealId: negocioPortugal, contactId: marina, proposalId: propostaPortugal.id, type: 'proposal_accepted', body: 'Proposta aceita — Conforto.', metadata: { opcao: 'Conforto' }, ocorreuEm: daysFromNow(-45), ownerId });
  await criarAtividade(tx, tenantId, { dealId: negocioPatagonia, contactId: marina, type: 'stage_changed', body: 'Fechada — a segunda recompra do ano.', metadata: { de: 'negociando', para: 'ganho' }, ocorreuEm: daysFromNow(-6), ownerId });

  // --- Fernando: proposto ontem, ABRIU HOJE (3 visitas) — o card quente -------
  const fernando = await criarContato(tx, tenantId, {
    name: 'Fernando Costa',
    email: 'fernando.costa@exemplo.test',
    phone: '+5511991002002',
    document: '39053344705',
    birthDate: '1979-09-11', // aniversário em 2 dias — alerta que o seed planta
    source: 'indicacao',
    tags: [...tag, 'indicacao'],
    notes: 'Indicação da Marina. Viaja só em weekend extendido.',
    criadoEm: daysFromNow(-20),
  });
  const negocioSantiago = await criarNegocio(tx, tenantId, fernando, {
    title: 'Aniversário em Santiago',
    destination: 'Santiago, Chile',
    stage: 'proposta_enviada',
    valueCents: 9_800_000,
    costCents: 7_300_000,
    departureOn: isoDate(60),
    returnOn: isoDate(64),
    expectedCloseOn: isoDate(5),
    criadoEm: daysFromNow(-20),
  });
  const propostaSantiago = await criarProposta(tx, tenantId, negocioSantiago, MARCA_VOLTA_AO_MUNDO, {
    title: 'Santiago — 4 noites com vinícolas',
    summary: 'Quatro noites no centro de Santiago, dia no Vale do Casablanca e jantar de aniversário no Sky Costanera.',
    options: [
      { name: 'Essencial', priceCents: 8_400_000, costCents: 6_200_000 },
      { name: 'Conforto', priceCents: 9_800_000, costCents: 7_300_000, recommended: true },
    ],
    blocks: [
      { kind: 'text', title: 'Sobre a viagem', body: 'Quatro noites em Santiago com dia de vinícolas no Vale do Casablanca.' },
      { kind: 'flight', title: 'Aéreo GRU × SCL', content: { cia: 'LATAM', bagagem: '1x23kg', escalas: 0 }, optionName: 'Conforto' },
      { kind: 'hotel', title: 'Hotel Cumbres Vitacura', content: { noites: 4, regime: 'café da manhã', categoria: '4 estrelas' }, optionName: 'Conforto' },
    ],
    sentAt: em(0, 9, 40), // enviado HOJE de manhã
    validUntilDays: 10,
    views: [
      { quando: hoursAgo(4), durationMs: 88_000 },
      { quando: hoursAgo(1), durationMs: 175_000 },
      { quando: hoursAgo(0.25), durationMs: 240_000 },
    ],
  });
  // Régua de follow-up (S8) — os três marcos D+2/D+5/D+10, ainda futuros.
  for (const marco of ['d2', 'd5', 'd10'] as const) {
    const dias = marco === 'd2' ? 2 : marco === 'd5' ? 5 : 10;
    await criarTarefa(tx, tenantId, {
      dealId: negocioSantiago,
      contactId: fernando,
      title: 'Follow-up: Santiago — 4 noites com vinícolas',
      gerada: { source: 'followup_proposta', dedupeKey: `followup:proposta:${propostaSantiago.id}:${marco}` },
      suggestedMessage: 'Oi Fernando! Conseguiu dar uma olhada na proposta de Santiago? Qualquer ajuste, me diz que eu remonto na hora.',
      dueAt: em(dias, 10, 0),
      ownerId,
    });
  }
  // Alerta de aniversário — o contato faz anos em 2 dias (mesma via de alerts.ts).
  await criarTarefa(tx, tenantId, {
    contactId: fernando,
    title: 'Aniversário de Fernando Costa',
    notes: 'Mandar parabéns no WhatsApp — aniversário é 11/09.',
    gerada: { source: 'alerta_aniversario', dedupeKey: `aniversario:contato:${fernando}:2026` },
    dueAt: em(2, 9, 0),
    ownerId,
  });
  await criarAtividade(tx, tenantId, { dealId: negocioSantiago, contactId: fernando, proposalId: propostaSantiago.id, type: 'proposal_viewed', body: 'Fernando abriu a proposta pela terceira vez hoje.', metadata: { viewCount: 3 }, ocorreuEm: hoursAgo(0.25), ownerId });

  // --- Juliana: abriu ONTEM ---------------------------------------------------
  const juliana = await criarContato(tx, tenantId, {
    name: 'Juliana Prates',
    email: 'ju.prates@exemplo.test',
    phone: '+5511991002003',
    document: '16899535009',
    birthDate: '1993-02-08',
    source: 'instagram',
    tags: [...tag],
    criadoEm: daysFromNow(-25),
  });
  const negocioMendoza = await criarNegocio(tx, tenantId, juliana, {
    title: 'Mendoza na vindima',
    destination: 'Mendoza, Argentina',
    stage: 'proposta_enviada',
    valueCents: 7_400_000,
    costCents: 5_600_000,
    departureOn: isoDate(45),
    returnOn: isoDate(50),
    expectedCloseOn: isoDate(8),
    criadoEm: daysFromNow(-25),
  });
  const propostaMendoza = await criarProposta(tx, tenantId, negocioMendoza, MARCA_VOLTA_AO_MUNDO, {
    title: 'Mendoza — 5 noites na vindima',
    summary: 'Cinco noites em Mendoza durante a festa da vindima, com duas bodegas por dia.',
    options: [
      { name: 'Essencial', priceCents: 6_900_000, costCents: 5_200_000 },
      { name: 'Conforto', priceCents: 7_400_000, costCents: 5_600_000, recommended: true },
    ],
    blocks: [
      { kind: 'text', title: 'Sobre a viagem', body: 'Cinco noites em Mendoza durante a festa da vindima.' },
      { kind: 'flight', title: 'Aéreo GRU × MDZ', content: { cia: 'FlyEmirates/Decolar', bagagem: '1x23kg', escalas: 1 }, optionName: 'Conforto' },
      { kind: 'hotel', title: 'Cavas Wine Lodge', content: { noites: 5, regime: 'café da manhã', categoria: 'boutique' }, optionName: 'Conforto' },
    ],
    sentAt: daysFromNow(-5),
    validUntilDays: 12,
    views: [
      { quando: em(-1, 21, 15), durationMs: 130_000 },
      { quando: em(-1, 21, 42), durationMs: 60_000 },
    ],
  });
  // D+2 venceu ontem sem resposta (vencida), D+5 é HOJE, D+10 futuro.
  await criarTarefa(tx, tenantId, {
    dealId: negocioMendoza,
    contactId: juliana,
    title: 'Follow-up: Mendoza — 5 noites na vindima',
    gerada: { source: 'followup_proposta', dedupeKey: `followup:proposta:${propostaMendoza.id}:d2` },
    suggestedMessage: 'Oi Ju! A proposta de Mendoza segue de pé — quer que eu reserve a bodega do dia 3?',
    dueAt: em(-3, 10, 0),
    ownerId,
  });
  await criarTarefa(tx, tenantId, {
    dealId: negocioMendoza,
    contactId: juliana,
    title: 'Follow-up: Mendoza — 5 noites na vindima',
    gerada: { source: 'followup_proposta', dedupeKey: `followup:proposta:${propostaMendoza.id}:d5` },
    suggestedMessage: 'Ju, a vindima lota — seguro a vaga até amanhã só?',
    dueAt: em(0, 17, 30),
    ownerId,
  });
  await criarTarefa(tx, tenantId, {
    dealId: negocioMendoza,
    contactId: juliana,
    title: 'Follow-up: Mendoza — 5 noites na vindima',
    gerada: { source: 'followup_proposta', dedupeKey: `followup:proposta:${propostaMendoza.id}:d10` },
    suggestedMessage: 'Última chamada da proposta de Mendoza, Ju — posso remontar em outra data se preferir.',
    dueAt: em(5, 10, 0),
    ownerId,
  });

  // --- Camila: PARADA HÁ 9 DIAS — a proposta que está morrendo -----------------
  const camila = await criarContato(tx, tenantId, {
    name: 'Camila Rocha',
    email: 'camila.rocha@exemplo.test',
    phone: '+5511991002004',
    document: '22255588846',
    birthDate: '1988-07-19',
    source: 'site',
    tags: [...tag, 'europa'],
    criadoEm: daysFromNow(-40),
  });
  const negocioEurotrip = await criarNegocio(tx, tenantId, camila, {
    title: 'Eurotrip de verão',
    destination: 'Lisboa, Madrid e Paris',
    stage: 'proposta_enviada',
    valueCents: 27_500_000,
    costCents: 21_000_000,
    departureOn: isoDate(210),
    returnOn: isoDate(228),
    expectedCloseOn: isoDate(-3),
    criadoEm: daysFromNow(-40),
  });
  const propostaEurotrip = await criarProposta(tx, tenantId, negocioEurotrip, MARCA_VOLTA_AO_MUNDO, {
    title: 'Eurotrip — 18 noites, 3 capitais',
    summary: 'Lisboa, Madrid e Paris com trens entre capitais — verão europeu completo.',
    options: [
      { name: 'Essencial', priceCents: 24_800_000, costCents: 18_900_000 },
      { name: 'Conforto', priceCents: 27_500_000, costCents: 21_000_000, recommended: true },
    ],
    blocks: [
      { kind: 'text', title: 'Sobre a viagem', body: 'Lisboa, Madrid e Paris com trens entre capitais.' },
      { kind: 'hotel', title: 'Hotéis centrais nas 3 capitais', content: { noites: 18, regime: 'café da manhã', categoria: '4 estrelas' }, optionName: 'Conforto' },
    ],
    sentAt: daysFromNow(-12),
    validUntilDays: -2, // já venceu — pressiona a decisão
    views: [
      { quando: daysFromNow(-9), durationMs: 240_000 },
    ],
  });
  // A régua inteira passou e ela não respondeu: uma concluída, duas vencidas em aberto.
  await criarTarefa(tx, tenantId, {
    dealId: negocioEurotrip,
    contactId: camila,
    title: 'Follow-up: Eurotrip — 18 noites, 3 capitais',
    gerada: { source: 'followup_proposta', dedupeKey: `followup:proposta:${propostaEurotrip.id}:d2` },
    suggestedMessage: 'Oi Camila! Chegou a proposta da Eurotrip — qualquer dúvida me chama.',
    dueAt: em(-10, 10, 0),
    doneAt: em(-9, 14, 20),
    ownerId,
  });
  await criarTarefa(tx, tenantId, {
    dealId: negocioEurotrip,
    contactId: camila,
    title: 'Follow-up: Eurotrip — 18 noites, 3 capitais',
    gerada: { source: 'followup_proposta', dedupeKey: `followup:proposta:${propostaEurotrip.id}:d5` },
    suggestedMessage: 'Camila, quer que eu ajuste o roteiro para menos noites?',
    dueAt: em(-7, 10, 0),
    ownerId,
  });
  await criarTarefa(tx, tenantId, {
    dealId: negocioEurotrip,
    contactId: camila,
    title: 'Follow-up: Eurotrip — 18 noites, 3 capitais',
    gerada: { source: 'followup_proposta', dedupeKey: `followup:proposta:${propostaEurotrip.id}:d10` },
    suggestedMessage: 'Último toque, Camila: a tarifa do aéreo sobe na segunda.',
    dueAt: em(-2, 10, 0),
    ownerId,
  });

  // --- Ricardo: PERDIDO com motivo --------------------------------------------
  const ricardo = await criarContato(tx, tenantId, {
    name: 'Ricardo Melo',
    email: 'ricardo.melo@exemplo.test',
    phone: '+5511991002005',
    document: '12345678909',
    birthDate: '1975-04-02',
    source: 'evento',
    tags: [...tag],
    criadoEm: daysFromNow(-35),
  });
  const negocioCaribe = await criarNegocio(tx, tenantId, ricardo, {
    title: 'Cruzeiro pelo Caribe',
    destination: 'Caribe — saída de Miami',
    stage: 'perdido',
    valueCents: 21_600_000,
    costCents: 17_200_000,
    departureOn: isoDate(90),
    returnOn: isoDate(97),
    lostReason: 'Fechou com a concorrência — 8% mais barato',
    criadoEm: daysFromNow(-35),
    closedAt: daysFromNow(-18),
  });
  const propostaCaribe = await criarProposta(tx, tenantId, negocioCaribe, MARCA_VOLTA_AO_MUNDO, {
    title: 'Caribe — 7 noites, cabine varanda',
    summary: 'Miami, Cozumel, Grand Cayman e Ocho Rios, com aéreo e transfers.',
    options: [
      { name: 'Cabine interna', priceCents: 18_900_000, costCents: 15_100_000 },
      { name: 'Cabine varanda', priceCents: 21_600_000, costCents: 17_200_000, recommended: true },
    ],
    blocks: [
      { kind: 'text', title: 'Sobre a viagem', body: 'Sete noites de cruzeiro saindo de Miami, com quatro paradas no Caribe.' },
      { kind: 'cruise', title: 'Navio Symphony of the Seas', content: { noites: 7, cabine: 'varanda', linha: 'Royal Caribbean' }, optionName: 'Cabine varanda' },
    ],
    sentAt: daysFromNow(-25),
    validUntilDays: 7,
    views: [
      { quando: daysFromNow(-23), durationMs: 110_000 },
      { quando: daysFromNow(-19), durationMs: 85_000 },
    ],
    declinedAt: daysFromNow(-18),
  });
  await criarTarefa(tx, tenantId, {
    dealId: negocioCaribe,
    contactId: ricardo,
    title: 'Follow-up: Caribe — 7 noites, cabine varanda',
    gerada: { source: 'followup_proposta', dedupeKey: `followup:proposta:${propostaCaribe.id}:d2` },
    suggestedMessage: 'Oi Ricardo! Qualquer dúvida sobre o cruzeiro, me chama.',
    dueAt: em(-23, 10, 0),
    doneAt: em(-23, 15, 0),
    ownerId,
  });
  await criarAtividade(tx, tenantId, { dealId: negocioCaribe, contactId: ricardo, type: 'stage_changed', body: 'Perdida — fechou com a concorrência por preço.', metadata: { de: 'negociando', para: 'perdido' }, ocorreuEm: daysFromNow(-18), ownerId });

  // --- Paulo: NOVO (chegou ontem) ---------------------------------------------
  const paulo = await criarContato(tx, tenantId, {
    name: 'Paulo Tavares',
    email: 'paulo.tavares@exemplo.test',
    phone: '+5511991002006',
    document: '35749432803',
    birthDate: '1990-12-05',
    source: 'whatsapp',
    tags: [...tag, 'familia'],
    notes: 'Família de 4. Filhos de 7 e 11 anos. Só viaja em janeiro.',
    criadoEm: daysFromNow(-2),
  });
  const negocioDisney = await criarNegocio(tx, tenantId, paulo, {
    title: 'Disney com a família',
    destination: 'Orlando, EUA',
    stage: 'novo',
    valueCents: 28_000_000,
    costCents: 22_500_000,
    paxAdults: 2,
    paxChildren: 2,
    departureOn: isoDate(300),
    criadoEm: daysFromNow(-2),
  });
  await criarTarefa(tx, tenantId, {
    dealId: negocioDisney,
    contactId: paulo,
    title: 'Retornar mensagem do WhatsApp',
    notes: 'Perguntou sobre parcelamento em 10x sem juros.',
    kind: 'whatsapp',
    dueAt: hoursAgo(0.5),
    ownerId,
  });
  await criarTarefa(tx, tenantId, {
    dealId: negocioDisney,
    contactId: paulo,
    title: 'Ligar para entender datas da escola',
    notes: 'Só consegue viajar em janeiro — férias escolares.',
    kind: 'ligar',
    dueAt: em(1, 11, 0),
    ownerId,
  });
  await criarAtividade(tx, tenantId, { dealId: negocioDisney, contactId: paulo, type: 'contact_created', body: 'Paulo chegou pelo WhatsApp.', metadata: { source: 'whatsapp' }, ocorreuEm: daysFromNow(-2), ownerId });

  // --- Beatriz: COTANDO (lembrete vencido ontem) -------------------------------
  const beatriz = await criarContato(tx, tenantId, {
    name: 'Beatriz Linhares',
    email: 'beatriz.linhares@exemplo.test',
    phone: '+5511991002007',
    document: '71428793861',
    birthDate: '1996-10-25',
    source: 'evento',
    tags: [...tag],
    criadoEm: daysFromNow(-8),
  });
  const negocioBuenos = await criarNegocio(tx, tenantId, beatriz, {
    title: 'Buenos Aires com amigas',
    destination: 'Buenos Aires, Argentina',
    stage: 'cotando',
    valueCents: 6_200_000,
    costCents: 4_700_000,
    departureOn: isoDate(80),
    returnOn: isoDate(84),
    expectedCloseOn: isoDate(7),
    criadoEm: daysFromNow(-8),
  });
  await criarTarefa(tx, tenantId, {
    dealId: negocioBuenos,
    contactId: beatriz,
    title: 'Montar cotação de hotéis em Palermo',
    notes: 'Quatro amigas — dois quartos duplos, com pool.',
    kind: 'outro',
    dueAt: em(-1, 18, 0),
    ownerId,
  });

  // --- Helena: NEGOCIANDO (passaporte do passageiro vencendo) -------------------
  const helena = await criarContato(tx, tenantId, {
    name: 'Helena Prado',
    email: 'helena.prado@exemplo.test',
    phone: '+5511991002008',
    document: '09985535418',
    birthDate: '1968-01-30',
    source: 'indicacao',
    tags: [...tag, 'vip'],
    notes: 'Viaja todo Natal. Sensível a conexão longa.',
    criadoEm: daysFromNow(-55),
  });
  const viajanteHelena = await criarViajante(tx, tenantId, helena, {
    fullName: 'Helena Prado',
    cpf: '09985535418',
    passport: 'GB771209',
    passportExpiresOn: isoDate(25), // vence em 25 dias — alerta de passaporte
    birthDate: '1968-01-30',
  });
  const negocioNatal = await criarNegocio(tx, tenantId, helena, {
    title: 'Natal em Nova York',
    destination: 'Nova York, EUA',
    stage: 'negociando',
    valueCents: 25_400_000,
    costCents: 19_800_000,
    departureOn: isoDate(100),
    returnOn: isoDate(108),
    expectedCloseOn: isoDate(10),
    criadoEm: daysFromNow(-55),
  });
  const propostaNatal = await criarProposta(tx, tenantId, negocioNatal, MARCA_VOLTA_AO_MUNDO, {
    title: 'Nova York no Natal — 8 noites',
    summary: 'Oito noites no Midtown, com árvore do Rockefeller, patinação no Central Park e show da Broadway.',
    options: [
      { name: 'Essencial', priceCents: 22_600_000, costCents: 17_500_000 },
      { name: 'Conforto', priceCents: 25_400_000, costCents: 19_800_000, recommended: true },
    ],
    blocks: [
      { kind: 'text', title: 'Sobre a viagem', body: 'Oito noites no Midtown durante o Natal nova-iorquino.' },
      { kind: 'flight', title: 'Aéreo GRU × JFK', content: { cia: 'American', bagagem: '2x23kg', escalas: 0 }, optionName: 'Conforto' },
      { kind: 'hotel', title: 'Midtown — 8 noites', content: { noites: 8, regime: 'sem refeição', categoria: '4 estrelas' }, optionName: 'Conforto' },
      { kind: 'insurance', title: 'Seguro viagem 60 dias EUA', content: { cobertura: 'USD 60.000', covid: true }, optionName: 'Conforto' },
    ],
    sentAt: daysFromNow(-8),
    validUntilDays: 5,
    views: [
      { quando: daysFromNow(-6), durationMs: 190_000 },
      { quando: daysFromNow(-5), durationMs: 145_000 },
      { quando: daysFromNow(-3), durationMs: 260_000 },
    ],
  });
  await criarTarefa(tx, tenantId, {
    dealId: negocioNatal,
    contactId: helena,
    title: 'Ligar para fechar o upgrade do hotel',
    notes: 'Ela aceita pagar a diferença do quarto com vista — confirmar valor.',
    kind: 'ligar',
    dueAt: em(0, 17, 0),
    ownerId,
  });
  // Alerta de passaporte — MESMA chave dedupe de `alerts.ts`.
  await criarTarefa(tx, tenantId, {
    contactId: helena,
    title: 'Passaporte de Helena Prado vence em 25 dias',
    notes: 'Ela viaja em 100 dias — renovar antes do embarque.',
    gerada: {
      source: 'alerta_passaporte',
      dedupeKey: `passaporte:${viajanteHelena}:${isoDate(25)}:90`,
    },
    dueAt: em(1, 9, 0),
    ownerId,
  });

  // --- Ana e Carlos: o CASAL (0020) — um negócio, dois clientes ----------------
  // O "Preparado para Ana e Carlos": o negócio tem Ana como titular e Carlos como
  // cliente secundário (`deal_contacts`, principal=false). A proposta pública devolve
  // os dois NOMES e nenhum telefone/e-mail/documento — o teste de vazamento
  // (`tests/security/deal-contacts-rls.test.ts`) planta canários nos dois contatos.
  const ana = await criarContato(tx, tenantId, {
    name: 'Ana Beatriz Fontes',
    email: 'ana.fontes@exemplo.test',
    phone: '+5511991002008',
    document: '12312312387',
    birthDate: '1986-06-14',
    source: 'instagram',
    tags: [...tag, 'casal'],
    notes: 'Viaja com o Carlos. Ela decide, ele paga — mandar a proposta para os dois.',
    criadoEm: daysFromNow(-12),
  });
  const carlos = await criarContato(tx, tenantId, {
    name: 'Carlos Henrique Menezes',
    email: 'carlos.menezes@exemplo.test',
    phone: '+5511991002009',
    document: '98765432100',
    birthDate: '1984-10-02',
    source: 'whatsapp',
    tags: [...tag, 'casal'],
    criadoEm: daysFromNow(-12),
  });
  const negocioCasal = await criarNegocio(tx, tenantId, ana, {
    title: 'Aniversário de 10 anos em Bariloche',
    destination: 'San Carlos de Bariloche, ARG',
    stage: 'proposta_enviada',
    valueCents: 12_800_000,
    costCents: 9_600_000,
    departureOn: isoDate(75),
    returnOn: isoDate(82),
    expectedCloseOn: isoDate(7),
    criadoEm: daysFromNow(-12),
  });
  // O segundo cliente do casal — o mesmo INSERT que `adicionarClienteAoNegocio` faz.
  await adicionarClienteSecundario(tx, tenantId, negocioCasal, carlos, daysFromNow(-11));
  await criarProposta(tx, tenantId, negocioCasal, MARCA_VOLTA_AO_MUNDO, {
    title: 'Bariloche — 7 noites de neve para dois',
    summary: 'Sete noites com meia pensão no cerro Catedral, circuito chico e jantar de aniversário.',
    options: [
      { name: 'Essencial', priceCents: 11_200_000, costCents: 8_500_000 },
      { name: 'Conforto', priceCents: 12_800_000, costCents: 9_600_000, recommended: true },
    ],
    blocks: [
      { kind: 'text', title: 'Sobre a viagem', body: 'Sete noites na base do cerro Catedral, com neve garantida na temporada.' },
      { kind: 'flight', title: 'Aéreo GRU × BRC', content: { cia: 'Aerolíneas', bagagem: '1x23kg', escalas: 1 }, optionName: 'Conforto' },
      { kind: 'hotel', title: 'Hotel Nevado — 7 noites', content: { noites: 7, regime: 'meia pensão', categoria: '4 estrelas' }, optionName: 'Conforto' },
      { kind: 'tour', title: 'Cerro Tronador e cascata de los Alerces', content: { duracao: 'dia inteiro', inclui: 'guia em português' }, optionName: 'Conforto' },
    ],
    sentAt: daysFromNow(-3),
    validUntilDays: 12,
    views: [
      { quando: daysFromNow(-2), durationMs: 175_000 },
      { quando: daysFromNow(-1), durationMs: 240_000 },
    ],
  });
  await criarTarefa(tx, tenantId, {
    dealId: negocioCasal,
    contactId: ana,
    title: 'Retomar Ana e Carlos sobre Bariloche',
    notes: 'Ela quer travar a data antes do fim da validade da proposta.',
    kind: 'whatsapp',
    dueAt: em(1, 10, 0),
    ownerId,
  });

  // --- Acervo do construtor (library_items do tenant) --------------------------
  await tx.insert(libraryItems).values([
    {
      tenantId,
      isGlobal: false,
      kind: 'hotel',
      title: 'Pousada Maravilha — Noronha',
      body: 'Boutique na Praia do Cachorro. Café incluso, transfer do aeroporto.',
      details: { noites: 7, categoria: 'boutique' },
    },
    {
      tenantId,
      isGlobal: false,
      kind: 'text',
      title: 'Política de cancelamento',
      body: 'Cancelamento até 30 dias antes: reembolso integral menos taxa operacional. Entre 29 e 15 dias: 50%. Menos de 15 dias: sem reembolso.',
      details: {},
    },
    {
      tenantId,
      isGlobal: false,
      kind: 'tour',
      title: 'Passeio de barco das Ilhas',
      body: 'Dia inteiro com duas paradas para mergulho, almoço incluso.',
      details: { duracao: 'dia inteiro' },
    },
  ]);

  // --- Recibo de importação (import_batches) ------------------------------------
  await tx.insert(importBatches).values({
    tenantId,
    filename: 'base_clientes_maio.csv',
    format: 'csv',
    encoding: 'utf-8',
    delimiter: ';',
    entity: 'contacts',
    mapping: { name: 'Nome', email: 'E-mail', phone: 'Telefone', document: 'CPF' },
    totalRows: 42,
    createdRows: 38,
    updatedRows: 3,
    skippedRows: 1,
    report: [
      { linha: 17, situacao: 'atualizada', motivo: 'E-mail já existia — telefone atualizado', nome: 'R*** S***' },
      { linha: 29, situacao: 'ignorada', motivo: 'CPF duplicado da linha 4', nome: 'J*** M***' },
    ],
    createdBy: ownerId,
    createdAt: daysFromNow(-50),
    finishedAt: daysFromNow(-50),
  });

  // --- Integração de cotação (integrations) — credencial cifrada pela mesma via
  await tx.insert(integrations).values({
    tenantId,
    provider: 'wooba',
    label: 'Wooba — conta principal',
    credentialsCiphertext: encryptPII(JSON.stringify({ agencyId: '1042', user: 'demo', apiKey: 'demo-secret' })),
    keyId: activeKeyId(),
    isActive: true,
  });

  // --- Auditoria (audit_log) — o rastro de quem leu documento e enviou proposta
  await tx.insert(auditLog).values([
    {
      tenantId,
      actorUserId: ownerId,
      action: 'contact.document_viewed',
      entity: 'contact',
      entityId: marina,
      metadata: {},
      createdAt: daysFromNow(-44),
    },
    {
      tenantId,
      actorUserId: ownerId,
      action: 'proposal.sent',
      entity: 'proposal',
      entityId: propostaSantiago.id,
      metadata: { channel: 'whatsapp' },
      createdAt: em(0, 9, 40),
    },
    {
      tenantId,
      actorUserId: ownerId,
      action: 'itinerary.created',
      entity: 'itinerary',
      entityId: negocioPortugal,
      metadata: { dealId: negocioPortugal },
      createdAt: daysFromNow(-44),
    },
  ]);

  await semearVitrine(tx, tenantId);

  console.log('[seed] tenant A: 10 contatos, 11 negócios (6 estágios, um deles o casal Ana e Carlos), 9 propostas, 3 vendas, 2 roteiros, 17 lembretes, 1 grupo com 4 ofertas na vitrine.');
}

// ---------------------------------------------------------------------------
// Vitrine (Fit 7) — o grupo "Fátima 2027" com lugares + quatro ofertas públicas:
// o pacote-GRUPO (com lugares), o pacote solto, o voo e o transfer. Uma
// despublicada para o PO ver o interruptor.
// ---------------------------------------------------------------------------

async function semearVitrine(tx: TenantDb, tenantId: string): Promise<void> {
  const [fatima] = await tx
    .insert(groups)
    .values({
      tenantId,
      title: 'Fátima 2027 — Peregrinação',
      destination: 'Portugal',
      departureOn: '2027-05-12',
      returnOn: '2027-05-19',
      totalSeats: 10,
      pricePerSeatCents: 550_000,
      costPerSeatCents: 400_000,
      commissionPerSeatCents: 30_000,
      serviceFeePerSeatCents: 20_000,
      status: 'vendendo',
    })
    .returning({ id: groups.id });

  // A família da Helena ocupa 3 lugares como um bloco (6a).
  const [helena] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.name, 'Helena Prado'))
    .limit(1);
  if (helena) {
    await tx.insert(groupMembers).values({
      tenantId,
      groupId: fatima!.id,
      contactId: helena.id,
      seats: 3,
    });
  }

  // Capas: URLs estáveis do Unsplash (CDN público) — o upload próprio é a via
  // do produto (`enviarImagemDaProposta`); no seed vale referência externa.
  const capa = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=70`;

  const ofertas = [
    {
      title: 'Fátima 2027 — Peregrinação (10 lugares)',
      type: 'pacote' as const,
      priceCents: 550_000,
      summary: '7 noites com voo, hospedagem com café, transfers e acompanhamento. Restam poucos lugares.',
      coverUrl: capa('photo-1555881400-74d7acaacd8b'),
      groupId: fatima!.id,
      publicada: true,
      position: 0,
    },
    {
      title: 'Noronha — 7 noites pé na areia',
      type: 'pacote' as const,
      priceCents: 890_000,
      summary: 'Pousada pé na areia, traslados inclusos e o roteiro que a Marina levou em setembro.',
      coverUrl: capa('photo-1585208798174-6cedd86e019a'),
      groupId: null,
      publicada: true,
      position: 1,
    },
    {
      title: 'Passagem aérea — Lisboa ida e volta',
      type: 'voo' as const,
      priceCents: 412_000,
      summary: 'Voo direto GRU–LIS, bagagem de 23kg inclusa. Tarde para reservar sujeita a disponibilidade.',
      coverUrl: capa('photo-1436491865332-7a61a109cc05'),
      groupId: null,
      publicada: true,
      position: 2,
    },
    {
      title: 'Traslado privado aeroporto × hotel',
      type: 'transfer' as const,
      priceCents: 28_000,
      summary: 'Carro executivo com motorista em português. Até 4 passageiros.',
      coverUrl: capa('photo-1549317661-bd32c8ce0db2'),
      groupId: null,
      publicada: true,
      position: 3,
    },
    {
      title: 'Natal em Santiago — pacote 5 noites',
      type: 'pacote' as const,
      priceCents: 640_000,
      summary: 'Montagem para o Natal — abro as reservas em outubro.',
      coverUrl: capa('photo-1531968455001-5c5272a41129'),
      groupId: null,
      publicada: false,
      position: 4,
    },
  ];

  await tx.insert(offersTable).values(
    ofertas.map((oferta) => ({
      tenantId,
      title: oferta.title,
      type: oferta.type,
      priceCents: oferta.priceCents,
      summary: oferta.summary,
      blocks: [],
      publicToken: `seed-${oferta.position}-${uuidv7()}`,
      position: oferta.position,
      publishedAt: oferta.publicada ? new Date() : null,
      unpublishedAt: oferta.publicada ? null : new Date(),
      groupId: oferta.groupId,
    })),
  );
}

// ---------------------------------------------------------------------------
// Tenant B — "Maré Alta" (menor, mas inteiro: é o alvo do teste de isolamento)
// ---------------------------------------------------------------------------

async function cenarioMareAlta(tx: TenantDb, tenantId: string, ownerId: string): Promise<void> {
  // Tereza: ganho, EM VIAGEM AGORA (ida -2d, volta +5d), com roteiro e venda —
  // inclusive uma parcela ATRASADA (o fluxo de cobrança do /cobranca).
  const tereza = await criarContato(tx, tenantId, {
    name: 'Tereza Nunes de Albuquerque',
    email: 'tereza.albuquerque@exemplo.test',
    phone: '+5581987650003',
    document: '19100000000',
    birthDate: '1965-07-21',
    source: 'whatsapp',
    tags: ['mare-alta', 'cruzeiro'],
    criadoEm: daysFromNow(-90),
  });
  const negocioCruzeiro = await criarNegocio(tx, tenantId, tereza, {
    title: 'Cruzeiro pelo Caribe',
    destination: 'Caribe — saída de Miami',
    stage: 'ganho',
    valueCents: 21_600_000,
    costCents: 17_200_000,
    departureOn: isoDate(-2),
    returnOn: isoDate(5),
    criadoEm: daysFromNow(-70),
    closedAt: daysFromNow(-35),
  });
  const propostaCruzeiro = await criarProposta(tx, tenantId, negocioCruzeiro, MARCA_MARE_ALTA, {
    title: 'Caribe — 7 noites, cabine varanda',
    summary: 'Miami, Cozumel, Grand Cayman e Ocho Rios. Aéreo e transfers inclusos.',
    options: [
      { name: 'Cabine interna', priceCents: 18_900_000, costCents: 15_100_000 },
      { name: 'Cabine varanda', priceCents: 21_600_000, costCents: 17_200_000, recommended: true },
    ],
    blocks: [
      { kind: 'text', title: 'Sobre a viagem', body: 'Sete noites saindo de Miami, quatro paradas no Caribe.' },
      { kind: 'cruise', title: 'Symphony of the Seas', content: { noites: 7, cabine: 'varanda', linha: 'Royal Caribbean' }, optionName: 'Cabine varanda' },
    ],
    sentAt: daysFromNow(-50),
    validUntilDays: 20,
    views: [
      { quando: daysFromNow(-49), durationMs: 120_000 },
      { quando: daysFromNow(-36), durationMs: 200_000 },
    ],
    acceptedOptionName: 'Cabine varanda',
    acceptedAt: daysFromNow(-35),
  });
  await criarVenda(tx, tenantId, negocioCruzeiro, {
    fornecedor: 'Royal Caribbean',
    propostaId: propostaCruzeiro.id,
    opcaoId: propostaCruzeiro.opcaoAceitaId,
    valorBrutoCents: 21_600_000,
    custoCents: 17_200_000,
    comissaoPrevistaCents: 3_200_000,
    taxaServicoCents: 800_000,
    comissaoStatus: 'atrasada',
    parcelas: [
      { venceEm: isoDate(-30), valorCents: 5_600_000, status: 'pago', pagoEm: daysFromNow(-30) },
      { venceEm: isoDate(-20), valorCents: 5_600_000, status: 'pago', pagoEm: daysFromNow(-19) },
      { venceEm: isoDate(-6), valorCents: 5_600_000, status: 'atrasado' },
      { venceEm: isoDate(10), valorCents: 5_600_000, status: 'pendente' },
    ],
    criadoEm: daysFromNow(-35),
  });
  await gerarRoteiroSeed(tx, tenantId, negocioCruzeiro, propostaCruzeiro.id, 'Caribe — 7 noites, cabine varanda', propostaCruzeiro.opcaoAceitaId, MARCA_MARE_ALTA, 'Tereza Nunes de Albuquerque', isoDate(-2), isoDate(5), daysFromNow(-34));

  const wagner = await criarContato(tx, tenantId, {
    name: 'Wagner D’Ávila Pontes',
    email: 'wagner.pontes@exemplo.test',
    phone: '+5581987650004',
    document: '12345678909',
    birthDate: '1988-01-30',
    source: 'site',
    tags: ['mare-alta'],
    criadoEm: daysFromNow(-15),
  });
  const negocioNoronhaB = await criarNegocio(tx, tenantId, wagner, {
    title: 'Noronha a dois',
    destination: 'Fernando de Noronha, PE',
    stage: 'cotando',
    valueCents: 4_750_000,
    costCents: 3_600_000,
    departureOn: isoDate(65),
    returnOn: isoDate(70),
    expectedCloseOn: isoDate(9),
    criadoEm: daysFromNow(-15),
  });
  await criarTarefa(tx, tenantId, {
    dealId: negocioNoronhaB,
    contactId: wagner,
    title: 'Enviar cotação revisada do aéreo',
    kind: 'email',
    dueAt: em(-2, 12, 0),
    ownerId,
  });

  const sonia = await criarContato(tx, tenantId, {
    name: 'Sônia Lima',
    email: 'sonia.lima@exemplo.test',
    phone: '+5581987650005',
    document: '22233344456',
    birthDate: '1972-09-20',
    source: 'instagram',
    tags: ['mare-alta'],
    criadoEm: daysFromNow(-4),
  });
  const negocioLençois = await criarNegocio(tx, tenantId, sonia, {
    title: 'Lençóis Maranhenses',
    destination: 'Barreirinhas, MA',
    stage: 'novo',
    valueCents: 3_500_000,
    costCents: 2_700_000,
    departureOn: isoDate(40),
    criadoEm: daysFromNow(-4),
  });
  await criarTarefa(tx, tenantId, {
    dealId: negocioLençois,
    contactId: sonia,
    title: 'Retornar áudio do WhatsApp',
    kind: 'whatsapp',
    dueAt: em(0, 18, 0),
    ownerId,
  });
  await criarAtividade(tx, tenantId, { dealId: negocioLençois, contactId: sonia, type: 'contact_created', body: 'Sônia chegou pelo Instagram.', metadata: { source: 'instagram' }, ocorreuEm: daysFromNow(-4), ownerId });

  // --- Cecília e Jorge: o CASAL do tenant B (0020) — isolamento provado nos dois lados
  // (o teste de vazamento da pública roda contra o tenant B e espera os nomes DELE).
  const cecilia = await criarContato(tx, tenantId, {
    name: 'Cecília Prado Meireles',
    email: 'cecilia.meireles@exemplo.test',
    phone: '+5581987650006',
    document: '45645645600',
    birthDate: '1979-02-18',
    source: 'indicacao',
    tags: ['mare-alta', 'casal'],
    criadoEm: daysFromNow(-9),
  });
  const jorge = await criarContato(tx, tenantId, {
    name: 'Jorge Amâncio Salles',
    email: 'jorge.salles@exemplo.test',
    phone: '+5581987650007',
    document: '78978978932',
    birthDate: '1977-08-25',
    source: 'whatsapp',
    tags: ['mare-alta', 'casal'],
    criadoEm: daysFromNow(-9),
  });
  const negocioCasalB = await criarNegocio(tx, tenantId, cecilia, {
    title: 'Lua de prata em Bonito',
    destination: 'Bonito, MS',
    stage: 'proposta_enviada',
    valueCents: 7_900_000,
    costCents: 5_900_000,
    departureOn: isoDate(45),
    returnOn: isoDate(49),
    expectedCloseOn: isoDate(6),
    criadoEm: daysFromNow(-9),
  });
  await adicionarClienteSecundario(tx, tenantId, negocioCasalB, jorge, daysFromNow(-8));
  await criarProposta(tx, tenantId, negocioCasalB, MARCA_MARE_ALTA, {
    title: 'Bonito — 4 noites para dois',
    summary: 'Quatro noites com flutuação na Lagoa Misteriosa e gruta do Lago Azul.',
    options: [
      { name: 'Essencial', priceCents: 6_800_000, costCents: 5_100_000 },
      { name: 'Completa', priceCents: 7_900_000, costCents: 5_900_000, recommended: true },
    ],
    blocks: [
      { kind: 'text', title: 'Sobre a viagem', body: 'Quatro noites no centro de Bonito, com os dois passeios mais pedidos.' },
      { kind: 'hotel', title: 'Pousada Águas de Bonito', content: { noites: 4, regime: 'café da manhã', categoria: '3 estrelas' }, optionName: 'Completa' },
      { kind: 'tour', title: 'Flutuação na Lagoa Misteriosa', content: { duracao: 'meio período', inclui: 'equipamento e guia' }, optionName: 'Completa' },
    ],
    sentAt: daysFromNow(-2),
    validUntilDays: 10,
    views: [{ quando: daysFromNow(-1), durationMs: 130_000 }],
  });
  await criarTarefa(tx, tenantId, {
    dealId: negocioCasalB,
    contactId: cecilia,
    title: 'Retomar Cecília e Jorge sobre Bonito',
    kind: 'whatsapp',
    dueAt: em(0, 17, 30),
    ownerId,
  });

  await tx.insert(libraryItems).values({
    tenantId,
    isGlobal: false,
    kind: 'text',
    title: 'O que levar para o cruzeiro',
    body: 'Documento com 6 meses de validade, tomada adaptadora US, remédio de enjoo.',
    details: {},
  });

  console.log('[seed] tenant B: 5 contatos, 4 negócios (3 estágios), 1 proposta aceita e 1 enviada (casal Cecília e Jorge), 1 venda, 1 roteiro, 1 parcela atrasada, 2 lembretes.');
}

// ---------------------------------------------------------------------------
// Infra de tenant (igual para os dois) + montagem
// ---------------------------------------------------------------------------

async function criarTenant(
  slug: string,
  spec: {
    name: string;
    marca: MarcaSeed;
    plan: 'solo' | 'pro' | 'studio';
    ownerEmail: string;
    ownerName: string;
    document: string;
  },
): Promise<string> {
  // O id nasce aqui, na aplicação: a policy de `tenants` compara `id` com `app.tenant_id`,
  // então precisamos saber o id ANTES do INSERT para poder abrir o contexto.
  const tenantId = uuidv7();

  await withTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: spec.name,
      slug,
      plan: spec.plan,
      status: 'active',
      brandName: spec.marca.name,
      brandPrimaryColor: spec.marca.primaryColor,
      brandSecondaryColor: spec.marca.secondaryColor,
      contactEmail: spec.ownerEmail,
      whatsapp: spec.marca.whatsapp,
      // CPF do MEI: cifrado em trânsito pelo tipo `encryptedText` (envelope `zp1.…`).
      document: spec.document,
      trialEndsAt: daysFromNow(-30),
      instagram: spec.marca.instagram,
      // 0017 — a assinatura sai do MESMO objeto da marca: cadastro e snapshots nunca
      // divergem no seed.
      agentDisplayName: spec.marca.agentDisplayName,
    });

    // 0016 — funil de fábrica ANTES de qualquer negócio: o trigger `deals_estagio_sync`
    // resolve `stage_id` a partir de `stage` e precisa das linhas do funil para isso.
    await tx.execute(sql`select public.semear_estagios_padrao(${tenantId}::uuid)`);

    const ownerId = `usr_${slug.replace(/-/g, '_')}`;
    await tx.insert(user).values({
      id: ownerId,
      tenantId,
      name: spec.ownerName,
      email: spec.ownerEmail,
      emailVerified: true,
      role: 'owner',
    });

    const [assinatura] = await tx
      .insert(subscriptions)
      .values({
        tenantId,
        plan: spec.plan,
        status: 'active',
        amountCents: PLAN_PRICE_CENTS[spec.plan],
        billingCycle: 'monthly',
        currentPeriodStart: isoDate(-5),
        currentPeriodEnd: isoDate(25),
        asaasCustomerId: `cus_demo_${slug}`,
        asaasSubscriptionId: `sub_demo_${slug}`,
      })
      .returning({ id: subscriptions.id });

    // Três mensalidades pagas — histórico de assinatura com mais de 3 meses.
    await tx.insert(payments).values(
      [-65, -35, -5].map((dias, i) => ({
        tenantId,
        subscriptionId: assinatura!.id,
        provider: 'asaas',
        asaasPaymentId: `pay_demo_${slug}_${i + 1}`,
        amountCents: PLAN_PRICE_CENTS[spec.plan],
        status: 'received' as const,
        method: 'pix' as const,
        dueOn: isoDate(dias),
        paidAt: daysFromNow(dias),
      })),
    );

    if (slug === 'volta-ao-mundo') {
      await cenarioVoltaAoMundo(tx, tenantId, ownerId);
    } else {
      await cenarioMareAlta(tx, tenantId, ownerId);
    }
  });

  console.log(`[seed] tenant criado: ${spec.name} (${tenantId})`);
  return tenantId;
}

async function limparDemo(): Promise<void> {
  // O DELETE em `tenants` é a única operação do seed que NÃO cabe em `withTenant`:
  // são dois tenants diferentes numa tacada, e a policy (corretamente) só deixa apagar
  // o tenant do contexto.
  //
  // O SELECT que acha os alvos NÃO pode ser em `unsafeDbWithoutTenant`: `tenants` nasce
  // com FORCE ROW LEVEL SECURITY e só tem duas policies — `tenants_isolation` (exige
  // `app.tenant_id` == id, que ainda não sabemos) e `tenants_auth_service` (exige
  // `app.auth_context = 'on'`). Sem nenhum dos dois GUCs setados, `unsafeDbWithoutTenant`
  // vê ZERO linhas em `tenants`, sempre — silencioso, sem erro. Rodar o seed uma segunda
  // vez faria `limparDemo` "não achar nada para apagar" e o INSERT seguinte estourar
  // `tenants_slug_key`. É por isso que aqui usamos `authDb`: é o único cliente que liga
  // `app.auth_context=on` (ver `src/lib/auth/db.ts`), e é exatamente o cenário que essa
  // policy existe para atender — resolver/gerenciar tenant antes de haver um contexto.
  const alvos = await authDb
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(inArray(tenants.slug, DEMO_SLUGS));

  for (const alvo of alvos) {
    await withTenant(alvo.id, async (tx) => {
      await tx.delete(tenants).where(eq(tenants.id, alvo.id));
    });
    console.log(`[seed] tenant anterior removido: ${alvo.slug}`);
  }
}

/**
 * Acervo GLOBAL do construtor (`library_items.is_global = true`) — a única escrita fora
 * de tenant, pela porta que existe para isso (`withPlatformContext`, GUC local à
 * transação). `ON CONFLICT` não existe aqui; global é idempotente por recriação: o
 * CASCADE do tenant não apaga linha global, então consultamos antes de inserir.
 */
async function semearAcervoGlobal(): Promise<void> {
  await withPlatformContext(async (tx) => {
    const existentes = await tx
      .select({ title: libraryItems.title })
      .from(libraryItems)
      .where(eq(libraryItems.isGlobal, true));
    const titulos = new Set(existentes.map((item) => item.title));

    const itens = [
      {
        isGlobal: true,
        tenantId: null,
        kind: 'text' as const,
        title: 'Modelo — o que levar na mala de mão',
        body: 'Documentos, carregador, remédios de uso contínuo com receita, uma muda de roupa.',
        images: [],
        details: {},
      },
      {
        isGlobal: true,
        tenantId: null,
        kind: 'insurance' as const,
        title: 'Modelo — seguro viagem cobertura 60.000 USD',
        body: 'Cobertura médica hospitalar, bagagem e cancelamento por qualquer motivo.',
        images: [],
        details: { cobertura: 'USD 60.000', covid: true },
      },
    ];

    for (const item of itens) {
      if (!titulos.has(item.title)) {
        await tx.insert(libraryItems).values(item);
      }
    }
  });
  console.log('[seed] acervo global de biblioteca conferido.');
}

/**
 * Cria o usuário dev pela API do Better Auth — nunca por INSERT direto — para que a senha
 * nasça com o hash de verdade e o login funcione ponta a ponta. `withPendingTenant` é o
 * único jeito de `tenantId` chegar em `user`: ver `src/lib/auth/signupContext.ts`.
 */
async function criarUsuarioDev(tenantId: string): Promise<void> {
  await withPendingTenant(tenantId, async () => {
    await auth.api.signUpEmail({
      body: {
        name: DEV_USER.name,
        email: DEV_USER.email,
        password: DEV_USER.password,
      },
    });
  });
  console.log(
    `[seed] usuário dev pronto: ${DEV_USER.email} / ${DEV_USER.password} (tenant ${tenantId})`,
  );
}

async function main(): Promise<void> {
  await limparDemo();
  await semearAcervoGlobal();

  const tenantAId = await criarTenant('volta-ao-mundo', {
    name: 'Volta ao Mundo Viagens',
    marca: MARCA_VOLTA_AO_MUNDO,
    plan: 'pro',
    ownerEmail: 'carol@voltaaomundo.test',
    ownerName: 'Carolina Vasques',
    document: '11122233344',
  });
  const tenantBId = await criarTenant('mare-alta', {
    name: 'Maré Alta Turismo',
    marca: MARCA_MARE_ALTA,
    plan: 'solo',
    ownerEmail: 'rodrigo@marealta.test',
    ownerName: 'Rodrigo Sanhudo',
    document: '55566677788',
  });

  await criarUsuarioDev(tenantAId);

  // Conferência de sanidade: cada tenant só enxerga o que é dele. Não substitui o teste
  // do Téo, mas se isto falhar não vale a pena nem abrir o psql.
  const contagem = async (tenantId: string) =>
    withTenant(tenantId, async (tx) => ({
      contatos: (await tx.select({ id: contacts.id }).from(contacts)).length,
      negocios: (await tx.select({ id: deals.id }).from(deals)).length,
      // 0020 — principais + secundários. Tem que ser `negocios + secundários` exatamente:
      // 12 no tenant A (11 principais + Carlos), 5 no B (4 principais + Jorge).
      linhasDeClientes: (await tx.select({ dealId: dealContacts.dealId }).from(dealContacts)).length,
      propostas: (await tx.select({ id: proposals.id }).from(proposals)).length,
      visitas: (await tx.select({ id: proposalViews.id }).from(proposalViews)).length,
      roteiros: (await tx.select({ id: itineraries.id }).from(itineraries)).length,
      lembretes: (await tx.select({ id: tasks.id }).from(tasks)).length,
      vendas: (await tx.select({ id: sales.id }).from(sales)).length,
      estagios: (await tx.select({ id: pipelineStages.id }).from(pipelineStages)).length,
      tenantsVisiveis: (await tx.select({ id: tenants.id }).from(tenants)).length,
    }));

  console.log('[seed] tenant A', tenantAId, await contagem(tenantAId));
  console.log('[seed] tenant B', tenantBId, await contagem(tenantBId));
  console.log('[seed] pronto.');
  console.log(`[seed] TENANT_A_ID=${tenantAId}`);
  console.log(`[seed] TENANT_B_ID=${tenantBId}`);
}

main()
  .catch((error: unknown) => {
    console.error('[seed] erro:', error);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([sqlSemTenant.end(), authSql.end()]));
