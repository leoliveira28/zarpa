import { desc, eq, sql } from 'drizzle-orm';
import { subscriptions } from '@/db/schema';
import { withTenant, type TenantDb } from '@/lib/tenant/withTenant';
import { ServiceError } from './errors';
import { registrarAuditoria } from './audit';

/**
 * S13a — Gate de dunning: `exigirContaAtiva(tx, tenantId)`.
 *
 * Decisão de produto (travada pelo PO, não rediscutir): quando a assinatura está
 * `past_due`, cancelada, expirada ou com trial vencido, o app fica READ-ONLY — a
 * agente VÊ tudo, mas não CRIA/EDITA/EXCLUI nada. Leituras NUNCA passam por aqui:
 * bloquear leitura é perder o cliente para sempre; bloquear escrita é cobrar.
 *
 * Como usar — PRIMEIRA linha de dentro do `withTenant` de toda Server Action de
 * ESCRITA (criar/editar/excluir de propostas, opções, blocos, negócios, contatos,
 * viajantes, vendas, parcelas, tarefas, integrações, marca, biblioteca, importação):
 *
 *     return withTenant(tenantId, async (tx) => {
 *       await exigirContaAtiva(tx, tenantId);
 *       // ... escrita de verdade
 *     });
 *
 * Quem NÃO recebe o gate:
 *   - `billing.ts` inteiro (`trocarPlano`/`cancelarAssinatura`/`listarFaturas`) —
 *     é justamente quando a conta está bloqueada que a agente precisa conseguir
 *     regularizar a cobrança;
 *   - leituras de qualquer natureza;
 *   - `criarTenant` (`tenants.ts`) — cria a assinatura que o gate avalia;
 *   - os runners de sistema (`rodarFilaDeFollowups`, `gerarAlertas*`) — a régua de
 *     follow-up e os alertas não são ação da agente; dunning não pode parar o
 *     motor de retenção de quem já é cliente;
 *   - a proposta pública (`publicProposals.ts`) — quem lê é o CLIENTE da agente,
 *     sem sessão; bloquear a proposta pública seria punir quem não deve nada.
 *
 * Este arquivo NÃO é `'use server'`: é helper interno (mesmo motivo de `audit.ts`/
 * `dealStages.ts` — e aqui nem faria sentido, não é action).
 */

/** Recusa do gate: `correcao` é o rótulo do botão; o destino é sempre `/cobranca`. */
export const CORRECAO_COBRANCA = 'Ir para Cobrança';

export type MotivoBloqueio = 'trial_expirado' | 'past_due' | 'canceled' | 'expired';

export type Veredito =
  | { permite: true }
  | { permite: false; motivo: MotivoBloqueio; mensagem: string };

/** Mensagem por motivo — pronta para a interface (mesma doutrina de `errors.ts`). */
function mensagemDeBloqueio(motivo: MotivoBloqueio): string {
  switch (motivo) {
    case 'past_due':
      return 'Sua assinatura está em atraso — o app está em modo somente leitura.';
    case 'canceled':
      return 'Sua assinatura está cancelada — o app está em modo somente leitura.';
    case 'trial_expirado':
    case 'expired':
      return 'Seu teste gratuito acabou.';
  }
}

/**
 * Função PURA do veredito — separada do banco para o Téo testar a tabela de decisão
 * sem plantar linha nenhuma. Regras:
 *
 *   - assinatura inexistente  → PASSA (agente pode estar antes do primeiro registro);
 *   - 'trialing' sem `trialEndsAt` → PASSA (fail-open: trial sem data é dado
 *     incompleto, e a punição de bloqueio nunca deve nascer de dado faltando);
 *   - 'trialing' com `trialEndsAt` no futuro → PASSA;
 *   - 'trialing' com `trialEndsAt` no passado → RECUSA ('trial_expirado');
 *   - 'active' → PASSA; 'past_due'/'canceled'/'expired' → RECUSA.
 */
export function vereditoDaAssinatura(
  assinatura: { status: string; trialEndsAt: Date | null } | null,
  agora: Date = new Date(),
): Veredito {
  if (!assinatura) return { permite: true };

  if (assinatura.status === 'trialing') {
    if (!assinatura.trialEndsAt) return { permite: true };
    if (assinatura.trialEndsAt.getTime() > agora.getTime()) return { permite: true };
    return { permite: false, motivo: 'trial_expirado', mensagem: mensagemDeBloqueio('trial_expirado') };
  }

  if (assinatura.status === 'active') return { permite: true };

  if (assinatura.status === 'past_due' || assinatura.status === 'canceled' || assinatura.status === 'expired') {
    const motivo = assinatura.status as MotivoBloqueio;
    return { permite: false, motivo, mensagem: mensagemDeBloqueio(motivo) };
  }

  // Status desconhecido (o enum do banco já impede, mas o gate é uma cerca — cerca
  // que erra do lado de deixar passar nesta arvore de decisão é só para dado novo).
  return { permite: true };
}

/**
 * Lê a assinatura viva MAIS RECENTE do tenant e recusa a escrita se a conta estiver
 * bloqueada. Roda dentro da transação da própria action (o `tx` que `withTenant`
 * entregou), ANTES de qualquer escrita — se recusar, a transação sobe vazio e nada
 * é gravado.
 *
 * Quando o veredito é `trial_expirado`, PROMOVE a assinatura para 'expired' antes de
 * recusar (idempotente, guardado por `WHERE status = 'trialing'`). A promoção roda
 * numa transação PRÓPRIA (`withTenant` novo) de propósito: a transação chamadora
 * vai fazer rollback quando o `ServiceError` subir, e promoção dentro dela morreria
 * no rollback — o banco nunca aprenderia que o trial acabou e `obterAssinaturaAtual`
 * continuaria dizendo 'trialing' para sempre. Custo: enquanto a transação chamadora
 * está aberta, a promoção segura uma SEGUNDA conexão do pool por um instante — só
 * acontece uma vez por tenant (depois a linha já é 'expired'), então não é caminho
 * quente. Nenhum risco de deadlock: a transação chamadora ainda não tocou em linha
 * nenhuma — o gate é a primeira coisa que ela faz.
 *
 * `tenants.status` NÃO é promovido: o CHECK `tenants_status_check` não tem o valor
 * 'expired' (enum de `tenants.ts`) e migrar enum de estado de conta é outra rodada —
 * a fonte de verdade do dunning aqui é `subscriptions`.
 */
export async function exigirContaAtiva(tx: TenantDb, tenantId: string): Promise<void> {
  const [assinatura] = await tx
    .select({
      id: subscriptions.id,
      status: subscriptions.status,
      trialEndsAt: subscriptions.trialEndsAt,
    })
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  const veredito = vereditoDaAssinatura(assinatura ?? null);
  if (veredito.permite) return;

  if (veredito.motivo === 'trial_expirado' && assinatura) {
    await promoverParaExpirada(tenantId, assinatura.id);
  }

  throw new ServiceError('ASSINATURA_INATIVA', veredito.mensagem, {
    correcao: CORRECAO_COBRANCA,
  });
}

/**
 * Variante para action de escrita que NÃO abre `withTenant` próprio (hoje só o upload
 * de imagem de proposta, `enviarImagemDaProposta`, que não toca tabela). Abre a
 * transação só para o cheque. Não use nas demais: dentro de `withTenant`, prefira
 * `exigirContaAtiva(tx, tenantId)` — evita uma transação inteira por chamada.
 */
export async function exigirContaAtivaForaDeTransacao(tenantId: string): Promise<void> {
  await withTenant(tenantId, (tx) => exigirContaAtiva(tx, tenantId));
}

/**
 * `trialing` → 'expired', idempotente. Transação própria (`withTenant`), fora da
 * transação chamadora — ver o porquê em `exigirContaAtiva`. O `WHERE status =
 * 'trialing'` é a guarda de corrida: duas actions simultâneas acham o trial vencido,
 * a primeira promove, a segunda afeta zero linhas e tenta promover de novo — sem
 * efeito, sem erro.
 */
async function promoverParaExpirada(tenantId: string, subscriptionId: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const promovidas = await tx
      .update(subscriptions)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(sql`${subscriptions.id} = ${subscriptionId} and ${subscriptions.status} = 'trialing'`)
      .returning({ id: subscriptions.id });

    if (promovidas.length === 0) return; // já promovida por outra chamada — idempotente

    await registrarAuditoria(tx, {
      tenantId,
      actorUserId: null,
      action: 'subscription.expired',
      entity: 'subscription',
      entityId: subscriptionId,
      metadata: { motivo: 'trial_expirado', origem: 'gate_dunning' },
    });
  });
}
