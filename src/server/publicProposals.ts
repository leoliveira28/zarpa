'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { activities, contacts, deals, proposals, tenants } from '@/db/schema';
import { withTenant, type TenantDb } from '@/lib/tenant/withTenant';
import { unsafeSqlWithoutTenant } from '@/db/client';
import { blindIndex } from '@/lib/crypto';
import { ServiceError, comoResultado, type ServiceResult } from './errors';
import { registrarAuditoria } from './audit';
import { notificarAberturaDeProposta } from './notifications';

/**
 * A proposta pública — lida SEM login. S7, a superfície mais exposta do sistema.
 *
 * Este módulo NUNCA importa `withTenant` para ler a proposta em si (não existe
 * `tenantId` de sessão aqui — o slug é anônimo), e NUNCA faz `select` direto nas tabelas
 * `proposals`/`proposal_options`/`proposal_blocks` pelo cliente cru
 * (`unsafeSqlWithoutTenant`): com `FORCE ROW LEVEL SECURITY`, isso devolveria zero linhas
 * (o esperado — RLS falha fechado) e, se algum dia alguém "consertasse" isso soltando a
 * policy, abriria a tabela inteira para qualquer conexão sem tenant. O único caminho de
 * leitura é a função `SECURITY DEFINER` `public.proposta_publica`
 * (`drizzle/0004_proposta_publica.sql`), que já filtra linha (status publicável) E coluna
 * (nunca `cost_cents`/`commission_cents`, nunca PII de `contacts`/`travelers` — a marca
 * vem de `proposals.brand_snapshot`, não de `tenants`). Ver o comentário no topo daquela
 * migration para o "por quê" completo, e `docs/status/rafa.md` para o histórico da
 * decisão.
 *
 * `registrarVisitaProposta` É legítimo usar `withTenant` na SEGUNDA metade (depois de já
 * ter resolvido `tenantId` através da função `SECURITY DEFINER`): naquele ponto o
 * `tenantId` veio do BANCO, nunca do navegador do cliente, então abrir contexto de tenant
 * para escrever `activities`/`audit_log` é o caminho normal, não uma exceção.
 */

export type PropostaPublicaBrand = {
  name: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  /** Link `https://wa.me/<dígitos>`, pronto para clicar — nunca o número cru. Ver o
   * comentário de `'brand'` em `drizzle/0004_proposta_publica.sql` sobre por que o NOME
   * do campo (não só o valor) foi escolhido de propósito. */
  whatsappLink: string | null;
  instagram: string | null;
  /**
   * 0017 — a assinatura: "[name] · por [agentDisplayName]" + "via {APP_NAME}"
   * (`src/lib/assinatura.ts` monta; a página só exibe). OPCIONAL de propósito: a função
   * pública só emite a chave QUANDO o `brand_snapshot` traz assinatura — proposta
   * enviada antes de o agente configurar o nome não ganha a chave, e o payload dela não
   * muda um byte (fotografia; ver o cabeçalho da `drizzle/0017_assinatura_do_agente.sql`).
   * Ausente, `null` e `''` são a mesma coisa para quem exibe.
   */
  agentDisplayName?: string | null;
};

export type PropostaPublicaMeta = {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  currency: string;
  coverImageUrl: string | null;
  terms: string | null;
  validUntil: string | null;
  acceptedOptionId: string | null;
  sentAt: string | null;
};

export type PropostaPublicaOpcao = {
  id: string;
  name: string;
  description: string | null;
  position: number;
  priceCents: number;
  installments: number | null;
  installmentCents: number | null;
  isRecommended: boolean;
};

export type PropostaPublicaBloco = {
  id: string;
  optionId: string | null;
  kind: string;
  position: number;
  title: string | null;
  body: string | null;
  images: string[];
  content: Record<string, unknown>;
};

export type PropostaPublica = {
  proposal: PropostaPublicaMeta;
  brand: PropostaPublicaBrand;
  options: PropostaPublicaOpcao[];
  blocks: PropostaPublicaBloco[];
  /**
   * 0020 — os NOMES de todos os clientes do negócio ("Preparado para Ana e Carlos"),
   * principal primeiro, depois a ordem de entrada. Nome e só nome: telefone, e-mail e
   * documento de cliente (principal ou secundário) não têm caminho para o payload — a
   * função pública seleciona `contacts.name` explicitamente, e o teste de vazamento
   * (`tests/security/deal-contacts-rls.test.ts`) prova com canários plantados nos DOIS
   * contatos. Ver o comentário de `'clientes'` na `drizzle/0020_negocio_varios_clientes.sql`.
   */
  clientes: string[];
};

/**
 * `public_token` tem 128 bits gerados como base64url de 16 bytes (~22 caracteres) — a
 * validação aqui é só uma cerca de bom senso (tamanho plausível, sem espaço/barra), não
 * segurança: a segurança é a própria imprevisibilidade dos 128 bits mais a função
 * `SECURITY DEFINER` devolvendo zero linhas para o que não bater.
 */
const slugSchema = z
  .string()
  .trim()
  .min(10, 'Link inválido')
  .max(80, 'Link inválido')
  .regex(/^[A-Za-z0-9_-]+$/, 'Link inválido');

/** O que a página pública (`/p/[slug]`, fora da minha fronteira) chama para renderizar. */
export async function obterPropostaPublica(
  slug: string,
): Promise<ServiceResult<PropostaPublica | null>> {
  return comoResultado(async () => {
    const parsed = slugSchema.safeParse(slug);
    if (!parsed.success) return null;

    const linhas = await unsafeSqlWithoutTenant<{ payload: PropostaPublica }[]>`
      select payload from public.proposta_publica(${parsed.data})
    `;
    return linhas[0]?.payload ?? null;
  });
}

const registrarVisitaInput = z.object({
  slug: slugSchema,
  /** Segundos, não milissegundos — a conversão para `duration_ms` acontece no banco. */
  durationSeconds: z.number().int().min(0).max(24 * 60 * 60).optional(),
  focusedOptionId: z.uuid().optional(),
  /** Gerado no cliente (ex.: `crypto.randomUUID()` guardado em `sessionStorage`) para
   * distinguir "voltou a olhar" de "abriu de novo do zero" sem exigir cookie de sessão. */
  sessionKey: z.string().trim().max(200).optional(),
});

export type RegistrarVisitaInput = z.infer<typeof registrarVisitaInput>;

function extrairIp(cabecalhos: Headers): string | null {
  // Atrás de proxy (Vercel), o IP real vem em `x-forwarded-for` — primeiro da lista é o
  // cliente. `x-real-ip` é o fallback de outros proxies. Nenhum dos dois é confiável ao
  // ponto de travar lógica de negócio nele; aqui só vira insumo de um HASH de analytics,
  // então o pior caso de um cabeçalho forjado é um `ip_hash` sem sentido, não um bypass.
  const forwarded = cabecalhos.get('x-forwarded-for');
  if (forwarded) {
    const primeiro = forwarded.split(',')[0]?.trim();
    if (primeiro) return primeiro;
  }
  const real = cabecalhos.get('x-real-ip');
  return real?.trim() || null;
}

type LinhaVisita = {
  is_first_view: boolean;
  tenant_id: string | null;
  proposal_id: string | null;
  deal_id: string | null;
};

/**
 * Registra uma abertura do link público. Chamado pela página pública ao montar (e,
 * opcionalmente, de novo ao desmontar/trocar de aba, com `durationSeconds` preenchido).
 *
 * DUAS CHAMADAS, UMA VISITA. A página chama esta action duas vezes por abertura
 * (entrada no mount + saída no `visibilitychange`/`pagehide`). Quem deduplica é o BANCO,
 * não esta action: `public.registrar_visita_proposta` trata a mesma
 * `(proposal_id, session_key)` dentro da janela como a MESMA visita — a primeira chamada
 * insere e incrementa `view_count`, a segunda só completa `duration_ms`/`focused_option_id`
 * na linha que já existe. Ver `drizzle/0014_visita_deduplicada.sql` (o "contador em dobro"
 * que o PO reportou) para o desenho, as janelas e o caso sem `sessionKey`.
 *
 * `sessionKey` é, portanto, o que separa "visita nova" de "continuação". Sem ela (modo
 * privado sem `sessionStorage`) não há como deduplicar e o comportamento antigo vale:
 * conta as duas. Se um dia a UI mudar, MANDAR a mesma `sessionKey` nas duas chamadas
 * continua sendo o contrato.
 *
 * Nunca lança para o chamador por "proposta não existe" — devolve `{ ok: true, data:
 * null }` tanto para slug errado quanto para proposta em rascunho/arquivada. A página
 * pública não deveria distinguir os dois casos (nenhuma pista sobre qual dos dois
 * aconteceu, mesmo racional de `NAO_ENCONTRADO` em `src/server/proposals.ts`).
 */
export async function registrarVisitaProposta(
  input: RegistrarVisitaInput,
): Promise<ServiceResult<null>> {
  return comoResultado(async () => {
    const parsed = registrarVisitaInput.safeParse(input);
    if (!parsed.success) {
      throw new ServiceError('DADOS_INVALIDOS', 'Dados de visita inválidos.', {
        correcao: 'Recarregar a página',
      });
    }
    const dados = parsed.data;

    const cabecalhos = await headers();
    const ipBruto = extrairIp(cabecalhos);
    // IP NUNCA em claro no banco (CLAUDE.md) — vira hash antes de qualquer INSERT.
    const ipHash = ipBruto ? blindIndex(ipBruto, 'proposal_view_ip') : null;
    const userAgent = cabecalhos.get('user-agent');
    const referrer = cabecalhos.get('referer');

    const linhas = await unsafeSqlWithoutTenant<LinhaVisita[]>`
      select is_first_view, tenant_id, proposal_id, deal_id
      from public.registrar_visita_proposta(
        ${dados.slug},
        ${ipHash},
        ${dados.durationSeconds ?? null},
        ${dados.focusedOptionId ?? null},
        ${dados.sessionKey ?? null},
        ${userAgent},
        ${referrer}
      )
    `;
    const linha = linhas[0];

    // Slug não bateu (ou proposta não publicável): nada a registrar, nada a notificar.
    if (!linha || !linha.tenant_id || !linha.proposal_id) return null;

    if (linha.is_first_view) {
      await avisarPrimeiraAbertura(linha.tenant_id, linha.proposal_id, linha.deal_id);
    }

    return null;
  });
}

/**
 * "Seu cliente abriu": sinal in-app (uma `activities` do tipo `proposal_viewed`, o mesmo
 * enum que já existia para a timeline do negócio — não inventei tabela nova) + trilha de
 * auditoria + e-mail (com fallback de dev, `src/server/notifications.ts`).
 *
 * Roda DEPOIS de já termos um `tenantId` vindo do banco (via a função `SECURITY
 * DEFINER`), então `withTenant` aqui é o caminho normal — nunca um `tenantId` de
 * argumento de rota chegando direto.
 */
async function avisarPrimeiraAbertura(
  tenantId: string,
  proposalId: string,
  dealId: string | null,
): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx.insert(activities).values({
      tenantId,
      dealId,
      proposalId,
      type: 'proposal_viewed',
      body: 'O cliente abriu a proposta pela primeira vez.',
      occurredAt: new Date(),
    });

    await registrarAuditoria(tx, {
      tenantId,
      actorUserId: null,
      action: 'proposal.viewed',
      entity: 'proposal',
      entityId: proposalId,
    });

    const contexto = await obterContextoDeNotificacao(tx, proposalId);
    if (!contexto) return;

    await notificarAberturaDeProposta({
      toEmail: contexto.toEmail,
      proposalTitle: contexto.proposalTitle,
      contactName: contexto.contactName,
      appUrl: `${baseUrl()}/propostas`,
    });
  });
}

function baseUrl(): string {
  return process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
}

type ContextoNotificacao = {
  toEmail: string | null;
  proposalTitle: string;
  contactName: string;
};

async function obterContextoDeNotificacao(
  tx: TenantDb,
  proposalId: string,
): Promise<ContextoNotificacao | null> {
  const [linha] = await tx
    .select({
      proposalTitle: proposals.title,
      contactName: contacts.name,
      toEmail: tenants.contactEmail,
    })
    .from(proposals)
    .innerJoin(deals, eq(deals.id, proposals.dealId))
    .innerJoin(contacts, eq(contacts.id, deals.contactId))
    .innerJoin(tenants, eq(tenants.id, proposals.tenantId))
    .where(eq(proposals.id, proposalId))
    .limit(1);

  if (!linha) return null;
  return {
    toEmail: linha.toEmail,
    proposalTitle: linha.proposalTitle,
    contactName: linha.contactName,
  };
}

/**
 * Cliente final aceita uma opção SEM login, via link público.
 *
 * Segue o padrão de `registrarVisitaProposta`: usa a função `SECURITY DEFINER`
 * `public.aceitar_opcao_proposta` (drizzle/0005_aceitar_opcao.sql) para validar
 * e registrar o aceite. A função confere que a proposta está publicável
 * (status 'sent'/'viewed') e que a opção pertence mesmo a ela, antes de
 * gravar. Nunca confia em IDs vindo do navegador.
 *
 * Devolve `{ ok: true, data: null }` tanto para slug errado quanto para
 * tentativa de aceitar opção que não pertence à proposta (mesma estratégia
 * de `registrarVisitaProposta` — não da pistas sobre qual falha aconteceu).
 */
const aceitarOpcaoInput = z.object({
  slug: slugSchema,
  optionId: z.uuid('ID da opção inválido'),
});

export type AceitarOpcaoInput = z.infer<typeof aceitarOpcaoInput>;

export async function aceitarOpcaoPublica(
  input: AceitarOpcaoInput,
): Promise<ServiceResult<null>> {
  return comoResultado(async () => {
    const parsed = aceitarOpcaoInput.safeParse(input);
    if (!parsed.success) {
      throw new ServiceError('DADOS_INVALIDOS', 'Dados de aceite inválidos.', {
        correcao: 'Recarregar a página',
      });
    }
    const dados = parsed.data;

    const linhas = await unsafeSqlWithoutTenant<{ success: boolean }[]>`
      select success
      from public.aceitar_opcao_proposta(${dados.slug}, ${dados.optionId})
    `;
    const linha = linhas[0];

    // Slug não bateu, proposta não publicável, ou opção não pertence à proposta:
    // nada a registrar, nada a notificar.
    if (!linha?.success) return null;

    return null;
  });
}
