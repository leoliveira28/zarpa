/**
 * Constantes legais do produto — Termos de uso e Política de privacidade.
 *
 * Este arquivo NÃO tem `'use server'` de propósito: precisa ser importável por
 * Server Component (as páginas /termos e /privacidade) e por Server Action
 * (`criarConta`) — e arquivo `'use server'` só exporta função async.
 *
 * REGRA DE BUMP: qualquer mudança de TEXTO nas duas páginas muda
 * `TERMS_VERSION` na MESMA commit. O valor gravado no consentimento
 * (`tenants.terms_version`) aponta para o texto que a pessoa LEU — se o texto
 * muda sem bump, os registros antigos passam a citar um documento que nunca
 * existiu naquela forma. Versão é data ("AAAA-MM-DD"): a data em que o texto
 * passou a valer.
 */

export const TERMS_VERSION = '2026-09-07';

/**
 * Canal para o titular exercer direitos (LGPD, art. 18) — citado nas duas
 * páginas. Mesmo domínio já usado como remetente transacional
 * (`nao-responda@zarpa.app` em `src/lib/auth/delivery.ts`).
 *
 * ATENÇÃO AO PO: esta caixa precisa existir de verdade antes de publicar em
 * produção — o texto promete resposta por ela. Se o endereço final for outro,
 * muda aqui e faz bump da versão.
 */
export const CANAL_DE_PRIVACIDADE = 'privacidade@zarpa.app';
