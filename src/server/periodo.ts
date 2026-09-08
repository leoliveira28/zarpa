import { z } from 'zod';
import { ServiceError } from './errors';

/**
 * Período de leitura — §1 de `docs/PROPOSTAS_PRODUTO.md`.
 *
 * As telas de leitura (/hoje, hub Dinheiro) mostravam "este mês" FIXO. O agente que
 * fecha 12 numa vidinha de dezembro e nada em março não conseguia olhar para trás.
 * A partir de agora as actions de leitura aceitam um período opcional:
 *
 *     { mes: '2026-09' }                      // um mês civil
 *     { de: '2026-01-01', ate: '2026-03-31' } // faixa de datas, pontas inclusivas
 *     undefined / {}                          // mês corrente — comportamento atual
 *
 * O período é ESTADO DA URL no lado da Nina (`?periodo=2026-09`), não memória escondida.
 * Aqui só validamos e resolvemos para o intervalo que a query usa.
 *
 * Este arquivo NÃO é `'use server'`: é helper puro (mesmo motivo de `normalize.ts`/
 * `dealStages.ts` — arquivo `'use server'` só pode exportar função async, e validação de
 * entrada precisa morar num módulo comum para as actions de leitura compartilharem a
 * MESMA regra, não três cópias que divergem).
 *
 * FUSO: tudo em UTC, como `dashboard.ts`/`deals.ts` já fazem desde o S10. A fronteira
 * UTC difere de America/Sao_Paulo só entre 00:00 e 03:00 do primeiro dia do período;
 * trocar a convenção aqui mudaria os números que já estão no ar sem uma decisão de
 * produto explícita.
 */

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

export const periodoInput = z.object({
  /** Mês civil `AAAA-MM` (ex.: `2026-09`). */
  mes: z.string().trim().regex(MES_RE, 'Mês inválido — use AAAA-MM, como 2026-09.').optional(),
  /** Primeiro dia da faixa, `AAAA-MM-DD`, inclusivo. */
  de: z.string().trim().regex(DIA_RE, 'Data inicial inválida — use AAAA-MM-DD.').optional(),
  /** Último dia da faixa, `AAAA-MM-DD`, inclusivo. */
  ate: z.string().trim().regex(DIA_RE, 'Data final inválida — use AAAA-MM-DD.').optional(),
});

export type PeriodoInput = z.infer<typeof periodoInput>;

/** Período resolvido, pronto para virar `WHERE col >= inicio AND col < fimExclusivo`. */
export type Periodo = {
  /** Rótulo curto: `AAAA-MM` para mês, `AAAA-MM-DD..AAAA-MM-DD` para faixa. */
  rotulo: string;
  /** Primeiro dia, `AAAA-MM-DD` (inclusivo). */
  de: string;
  /** Último dia, `AAAA-MM-DD` (inclusivo). */
  ate: string;
  /** UTC 00:00 do primeiro dia. */
  inicio: Date;
  /** UTC 00:00 do dia SEGUINTE ao último — meio exclusivo, como todo intervalo deste schema. */
  fimExclusivo: Date;
};

function isoDeUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** `2026-02-30` não existe — o Date normaliza para 03/03 e o mês deixa de bater. */
function diaValido(iso: string): boolean {
  const [ano, mes, dia] = iso.split('-').map(Number) as [number, number, number];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

function inicioDoDiaUTC(iso: string): Date {
  const [ano, mes, dia] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function erroDePeriodo(mensagem: string, campo: string): ServiceError {
  return new ServiceError('DADOS_INVALIDOS', mensagem, {
    campo,
    correcao: 'Corrigir o período',
  });
}

/**
 * Valida a entrada de período e resolve para o intervalo. `undefined`, `null` e `{}` —
 * e também `{ mes: undefined, de: undefined, ate: undefined }` — significam MÊS CORRENTE
 * (UTC), preservando o comportamento que as telas já tinham antes do §1.
 *
 * Lança `ServiceError('DADOS_INVALIDOS')` com mensagem pronta para a interface — dentro
 * de uma action envolta em `comoResultado`, isso chega à Nina como `{ ok: false, ... }`,
 * nunca como 500.
 */
export function resolverPeriodo(agora: Date, input?: PeriodoInput | null): Periodo {
  if (!input || (input.mes === undefined && input.de === undefined && input.ate === undefined)) {
    const inicio = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
    const de = isoDeUTC(inicio);
    // Dia 0 do mês seguinte = último dia do mês corrente.
    const fim = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + 1, 0));
    const ate = isoDeUTC(fim);
    return {
      rotulo: `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, '0')}`,
      de,
      ate,
      inicio,
      fimExclusivo: new Date(fim.getTime() + 86_400_000),
    };
  }

  const temMes = input.mes !== undefined;
  const temFaixa = input.de !== undefined || input.ate !== undefined;

  if (temMes && temFaixa) {
    throw erroDePeriodo(
      'Informe o mês OU o intervalo de datas — não os dois juntos.',
      'periodo',
    );
  }

  if (temMes) {
    const parsed = periodoInput.safeParse(input);
    if (!parsed.success) {
      const primeiro = parsed.error.issues[0];
      throw erroDePeriodo(primeiro?.message ?? 'Período inválido.', primeiro?.path.join('.') ?? 'periodo');
    }
    const [ano, mes] = (parsed.data.mes as string).split('-').map(Number) as [number, number];
    const inicio = new Date(Date.UTC(ano, mes - 1, 1));
    const ultimoDia = new Date(Date.UTC(ano, mes, 0));
    return {
      rotulo: parsed.data.mes as string,
      de: isoDeUTC(inicio),
      ate: isoDeUTC(ultimoDia),
      inicio,
      fimExclusivo: new Date(ultimoDia.getTime() + 86_400_000),
    };
  }

  // Faixa: as duas pontas são obrigatórias JUNTAS — metade de um intervalo é um
  // provável bug de quem chamou, não uma escolha.
  if (input.de === undefined || input.ate === undefined) {
    throw erroDePeriodo(
      'Informe as duas datas do intervalo ("de" e "ate").',
      input.de === undefined ? 'periodo.de' : 'periodo.ate',
    );
  }

  const parsed = periodoInput.safeParse(input);
  if (!parsed.success) {
    const primeiro = parsed.error.issues[0];
    throw erroDePeriodo(primeiro?.message ?? 'Período inválido.', primeiro?.path.join('.') ?? 'periodo');
  }
  const { de, ate } = parsed.data as { de: string; ate: string };

  if (!diaValido(de)) {
    throw erroDePeriodo(`A data ${de} não existe no calendário.`, 'periodo.de');
  }
  if (!diaValido(ate)) {
    throw erroDePeriodo(`A data ${ate} não existe no calendário.`, 'periodo.ate');
  }
  if (de > ate) {
    throw erroDePeriodo('A data final é antes da inicial.', 'periodo.ate');
  }

  const inicio = inicioDoDiaUTC(de);
  const ultimoDia = inicioDoDiaUTC(ate);
  return {
    rotulo: `${de}..${ate}`,
    de,
    ate,
    inicio,
    fimExclusivo: new Date(ultimoDia.getTime() + 86_400_000),
  };
}
