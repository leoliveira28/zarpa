import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { activeKeyId, keyFor, knownKeyIds, type KeyId } from './keyring';

/**
 * Índice cego (*blind index*) — como buscar por CPF sem guardar CPF em claro.
 *
 * O problema: `document_encrypted` é AES-256-GCM com IV aleatório por operação. Dois
 * registros com o MESMO CPF geram ciphertexts DIFERENTES. Isso é o que se quer de uma
 * cifra (do contrário o banco vira um dicionário: linhas iguais aparecem iguais), mas
 * significa que `WHERE document_encrypted = <cifra do que digitei>` nunca casa, e que
 * deduplicar por CPF na importação é impossível.
 *
 * A solução: uma segunda coluna, `document_hash`, com um valor DETERMINÍSTICO derivado do
 * mesmo dado — um HMAC. Igual entra, igual sai; então dá para indexar, dá para
 * `UNIQUE (tenant_id, document_hash)`, e dá para procurar em O(log n).
 *
 * O material é derivado assim:
 *
 *     k_tenant = HKDF-SHA256(chave_do_chaveiro, salt = tenant_id, info = "zarpa-bi:<campo>")
 *     hash     = base64url( HMAC-SHA256(k_tenant, digitos_normalizados) )
 *
 * Três decisões e o motivo de cada uma:
 *
 * 1. **HMAC, não SHA-256 puro.** CPF tem 11 dígitos: o espaço inteiro são 10^11 valores,
 *    e menos ainda com o dígito verificador (10^9 válidos). Um hash sem chave é
 *    enumerável em minutos num laptop — publicar `sha256(cpf)` equivale a publicar o CPF.
 *    Com HMAC, quem tem só o banco não consegue enumerar: falta a chave, que mora no
 *    ambiente do processo, nunca no Postgres.
 *
 * 2. **Sal por tenant.** O `tenant_id` entra como sal do HKDF, então cada agente tem uma
 *    chave de índice própria. Consequência prática: o mesmo CPF em dois tenants produz
 *    hashes DIFERENTES. Sem isso, quem lesse a tabela inteira poderia cruzar clientes
 *    entre agentes ("essa pessoa é cliente de 4 agências") sem quebrar nada — vazamento
 *    de correlação, mesmo com a cifra intacta.
 *
 * 3. **`key_id` gravado junto** (coluna `*_hash_key_id`). O índice depende da chave; se a
 *    chave rotaciona, os hashes antigos deixam de casar com os novos. Guardando o `key_id`
 *    da linha, (a) o backfill sabe exatamente o que reescrever e (b) a busca continua
 *    funcionando durante a rotação, porque ela procura pelos candidatos de TODAS as chaves
 *    conhecidas (`candidatesFor`). Rotação sem downtime e sem resultado errado no meio.
 *
 * O QUE ISSO CUSTA, escrito por extenso porque é uma decisão de segurança:
 * o índice cego vaza **igualdade**. Quem tiver o dump do banco sabe quais linhas têm o
 * mesmo CPF, e quem tiver o dump **mais a chave** pode enumerar o espaço de CPFs e
 * recuperar todos eles — HMAC não protege domínio pequeno contra quem tem a chave. Ou
 * seja: a confidencialidade do CPF passa a depender de a chave e o banco nunca vazarem
 * JUNTOS. É o mesmo pressuposto do `encryptPII`, com a diferença de que ali o ataque exige
 * a chave e aqui também — mas aqui o ataque é offline e paralelizável. Por isso o índice
 * cego existe só para CPF (`contacts.document`, `travelers.cpf`), que é o que precisa
 * deduplicar e buscar. Passaporte e nascimento NÃO têm índice cego: não há caso de uso que
 * pague esse risco.
 */

export type BlindIndexField = 'contacts.document' | 'travelers.cpf';

export type BlindIndexValue = {
  hash: string;
  keyId: KeyId;
};

const DERIVED_BYTES = 32;

/**
 * Normalização — dois registros só deduplicam se normalizarem igual. "529.982.247-25" e
 * "52998224725" são o mesmo CPF; a planilha do cliente traz os dois formatos na mesma
 * coluna. Sem isto, a deduplicação por CPF simplesmente não acontece.
 */
export function normalizeDocumentForIndex(value: string): string {
  return value.replace(/\D/g, '');
}

function tenantKey(field: BlindIndexField, tenantId: string, keyId: KeyId): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      keyFor(keyId),
      // Sal = tenant. É isto que impede cruzar o mesmo CPF entre dois agentes.
      Buffer.from(tenantId, 'utf8'),
      `zarpa-bi:${field}`,
      DERIVED_BYTES,
    ),
  );
}

function hashWith(field: BlindIndexField, tenantId: string, digits: string, keyId: KeyId): string {
  return createHmac('sha256', tenantKey(field, tenantId, keyId))
    .update(digits, 'utf8')
    .digest('base64url');
}

/**
 * O valor a GRAVAR. Devolve `null` para entrada vazia ou sem dígito — coluna nula não
 * entra no índice único parcial, então contato sem CPF não colide com outro sem CPF.
 */
export function blindIndexFor(
  field: BlindIndexField,
  tenantId: string,
  value: string | null | undefined,
): BlindIndexValue | null {
  if (value === null || value === undefined) return null;
  const digits = normalizeDocumentForIndex(value);
  if (digits === '') return null;

  const keyId = activeKeyId();
  return { hash: hashWith(field, tenantId, digits, keyId), keyId };
}

/**
 * Os valores a PROCURAR. Durante uma rotação convivem linhas indexadas com v1 e com v2;
 * a busca precisa achar as duas, então ela compara contra todos os candidatos.
 *
 * O custo é um `IN` com N elementos, N = número de chaves no ambiente (hoje 1, durante
 * rotação 2). O índice B-tree continua sendo usado.
 */
export function blindIndexCandidates(
  field: BlindIndexField,
  tenantId: string,
  value: string | null | undefined,
): string[] {
  if (value === null || value === undefined) return [];
  const digits = normalizeDocumentForIndex(value);
  if (digits === '') return [];

  return knownKeyIds().map((keyId) => hashWith(field, tenantId, digits, keyId));
}

/**
 * Comparação em tempo constante entre dois hashes de índice cego. Usada quando a
 * comparação acontece na aplicação (deduplicação dentro de um lote de importação, onde as
 * linhas ainda não estão no banco) em vez de no `WHERE`.
 */
export function blindIndexEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
