'use server';

import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { contacts, deals } from '@/db/schema';
import { withTenant } from '@/lib/tenant/withTenant';
import { requireAuthContext } from '@/lib/auth/session';
import { comoResultado, type ServiceResult } from './errors';

/**
 * §3 de `docs/PROPOSTAS_PRODUTO.md` — "Em viagem": o pós-venda que sustenta a recompra.
 *
 * A venda fecha e o cliente desaparece do produto. Para quem vive de confiança, a viagem
 * em curso é o momento de maior risco (emergência, problema no hotel) e maior
 * oportunidade (depoimento, próxima venda). Tudo aqui reusa dados que JÁ EXISTEM:
 * `deals.departure_on`/`return_on` de negócios `ganho` — zero tabela nova, zero migration.
 *
 * Mesmas regras de `dashboard.ts`/`deals.ts`: `tenantId` vem de `requireAuthContext()`,
 * toda query dentro de `withTenant`, leitura NÃO passa pelo gate de assinatura
 * (`subscriptionGate.ts`), erro volta como `ServiceResult`.
 *
 * FUSO: "hoje" é a data UTC (`toISOString().slice(0, 10)`) — a mesma convenção de
 * `dashboard.ts` desde o S10. `departure_on`/`return_on` são `date` (sem hora, sem fuso —
 * mesmo desenho de `receivables.vence_em`), então a comparação é entre strings `AAAA-MM-DD`
 * e a aritmética é em dias inteiros. Um cliente que voltou "ontem" às 23h de São Paulo
 * ainda é "hoje" em UTC: diferença máxima de 3h, aceita e documentada.
 */

// ---------------------------------------------------------------------------
// Formas de saída — contrato da seção "Em viagem" do /hoje
// ---------------------------------------------------------------------------

export type ViagemEmCurso = {
  id: string;
  title: string;
  destination: string | null;
  contactId: string;
  contactName: string;
  /**
   * WhatsApp do CONTATO, como foi digitado no cadastro (não normalizado, não é link).
   * Serve para o único CTA desta seção — "pedir depoimento" — na linha `retornou`.
   * Autenticado e do próprio tenant; nunca aparece em superfície pública.
   */
  contactWhatsapp: string | null;
  /** Valor do NEGÓCIO (`deals.valueCents`) — contexto, não destaque. */
  valueCents: number;
  /** `AAAA-MM-DD`. Sempre preenchido — sem data de ida não há como classificar. */
  departureOn: string;
  /** `AAAA-MM-DD`, ou `null` quando o agente não registrou a volta. */
  returnOn: string | null;
};

/** "Viaja em N dias" — prompt discreto de última chamada (documentos, check-in). */
export type PartidaProxima = ViagemEmCurso & {
  /** 0 = viaja hoje. Nunca negativo. */
  diasRestantes: number;
};

/** "Em viagem até dd/mm" — uma linha, sem CTA. Presença, não ruído. */
export type ViagemAndamento = ViagemEmCurso;

/** "Retornou há N dias" — o único CTA da seção: pedir depoimento. */
export type RetornoRecente = ViagemEmCurso & {
  /** Dias desde a volta. 1 = voltou ontem. Nunca negativo. */
  diasDesdeRetorno: number;
};

export type EmViagemGrupos = {
  /** `departureOn >= hoje`, mais próxima primeiro (viaja hoje vem primeiro, com 0). */
  partindo: PartidaProxima[];
  /**
   * `hoje > departureOn` e a viagem ainda não terminou. `returnOn: null` = em curso sem
   * data de volta registrada (o produto não obriga) — a tela mostra "Em viagem" sem o
   * "até dd/mm". Em curso com `returnOn >= hoje` entra aqui também.
   */
  emViagem: ViagemAndamento[];
  /** `returnOn != null` e `hoje > returnOn`, retorno mais RECENTE primeiro. */
  retornou: RetornoRecente[];
};

// ---------------------------------------------------------------------------
// A action
// ---------------------------------------------------------------------------

function inicioDoDiaUTC(iso: string): number {
  const [ano, mes, dia] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(ano, mes - 1, dia);
}

/** Dias inteiros entre duas datas `AAAA-MM-DD` (`de` → `ate`). */
function diasEntre(de: string, ate: string): number {
  return Math.round((inicioDoDiaUTC(ate) - inicioDoDiaUTC(de)) / 86_400_000);
}

/**
 * Classificação EXCLUSIVA — todo negócio cai em no máximo um grupo:
 *
 *   1. `hoje <= departureOn`                    → `partindo`   (0 dias = viaja hoje;
 *      "última chamada" vale também para o mesmo dia);
 *   2. `hoje > departureOn` e viagem em curso   → `emViagem`   (returnOn null OU hoje <= returnOn);
 *   3. `returnOn` no passado                    → `retornou`.
 *
 * Negócio `ganho` sem `departureOn` fica fora de propósito: sem a data de ida não existe
 * "em viagem" para dizer — inventar grupo "sem data" seria o ruído que o §3 manda evitar.
 *
 * Busca ordenada por `departureOn DESC` com limite de 200: no volume esperado (MEI,
 * 10–15 vendas/mês) isso cobre anos de histórico; o corte protege o tenant que importou
 * base antiga cheia de negócio ganho sem data. Se um dia isso morder, o próximo passo é
 * a seção ganhar paginação — não o limite crescer.
 */
export async function listarEmViagem(): Promise<ServiceResult<EmViagemGrupos>> {
  return comoResultado(async () => {
    const { tenantId } = await requireAuthContext();
    const hoje = new Date().toISOString().slice(0, 10);

    return withTenant(tenantId, async (tx) => {
      const linhas = await tx
        .select({
          id: deals.id,
          title: deals.title,
          destination: deals.destination,
          valueCents: deals.valueCents,
          departureOn: deals.departureOn,
          returnOn: deals.returnOn,
          contactId: deals.contactId,
          contactName: contacts.name,
          contactWhatsapp: contacts.whatsapp,
        })
        .from(deals)
        .innerJoin(contacts, eq(contacts.id, deals.contactId))
        .where(and(eq(deals.stage, 'ganho'), isNotNull(deals.departureOn)))
        .orderBy(desc(deals.departureOn))
        .limit(200);

      const partindo: PartidaProxima[] = [];
      const emViagem: ViagemAndamento[] = [];
      const retornou: RetornoRecente[] = [];

      for (const linha of linhas) {
        // `isNotNull` no WHERE garante a string; o Drizzle infere `string | null` porque
        // a coluna é anulável — este é o único lugar que conhece o invariante.
        const departureOn = linha.departureOn as string;
        const base: ViagemEmCurso = {
          id: linha.id,
          title: linha.title,
          destination: linha.destination,
          contactId: linha.contactId,
          contactName: linha.contactName,
          contactWhatsapp: linha.contactWhatsapp,
          valueCents: linha.valueCents,
          departureOn,
          returnOn: linha.returnOn,
        };

        if (hoje <= departureOn) {
          partindo.push({ ...base, diasRestantes: Math.max(0, diasEntre(hoje, departureOn)) });
        } else if (linha.returnOn === null || hoje <= linha.returnOn) {
          emViagem.push(base);
        } else {
          retornou.push({
            ...base,
            diasDesdeRetorno: Math.max(0, diasEntre(linha.returnOn, hoje)),
          });
        }
      }

      // "Ordenados por proximidade" (`docs/PROPOSTAS_PRODUTO.md` §3): quem viaja logo
      // primeiro, quem volta logo primeiro, quem voltou há menos tempo primeiro.
      partindo.sort((a, b) => a.departureOn.localeCompare(b.departureOn));
      emViagem.sort((a, b) => {
        if (a.returnOn === null && b.returnOn === null) return 0;
        if (a.returnOn === null) return 1; // sem volta registrada vai para o fim
        if (b.returnOn === null) return -1;
        return a.returnOn.localeCompare(b.returnOn);
      });
      retornou.sort((a, b) => a.diasDesdeRetorno - b.diasDesdeRetorno);

      return { partindo, emViagem, retornou };
    });
  });
}
