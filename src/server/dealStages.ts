import type { EstagioDeFunil } from './deals';

/**
 * Fonte única do rótulo e da ordem das colunas do quadro. Vive fora de `deals.ts`
 * (que é `'use server'`) porque um arquivo de Server Actions só pode exportar
 * função assíncrona — uma constante como esta quebra o build do Next
 * ("A 'use server' file can only export async functions, found object").
 *
 * S16 — ESTA LISTA ESTÁ COM OS DIAS CONTADOS. Desde `drizzle/0016_negocio_aponta_para_estagio.sql`
 * a fonte de verdade das colunas é `pipeline_stages` (por tenant, renomeável, reordenável),
 * e `listarEstagios()` devolve exatamente o que o quadro precisa. Enquanto `/funil` ainda
 * ler daqui, negócio que estiver numa coluna criada pela agente aparece sob "Negociando"
 * (é o espelho que o banco dá a `deals.stage` para uma coluna sem `legacy_stage`). Trocar
 * `COLUNAS_DO_FUNIL` por `listarEstagios()` é a rodada da UI.
 *
 * A Nina importa isto direto (via `@/server`) em vez de manter uma segunda lista
 * (`STAGES` em `src/lib/ui/sample-data.ts`, já removido) que um dia fica
 * desalinhada com o enum do banco — foi exatamente essa divergência (5 colunas
 * de exemplo vs. 6 valores de `deals.stage`) que motivou este arquivo existir.
 */
export const COLUNAS_DO_FUNIL: { estagio: EstagioDeFunil; label: string }[] = [
  { estagio: 'novo', label: 'Novo contato' },
  { estagio: 'cotando', label: 'Montando' },
  { estagio: 'proposta_enviada', label: 'Enviada' },
  { estagio: 'negociando', label: 'Negociando' },
  { estagio: 'ganho', label: 'Fechada' },
];
