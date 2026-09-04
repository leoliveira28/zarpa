import { randomBytes } from 'node:crypto';

/**
 * UUID v7 (RFC 9562): 48 bits de timestamp Unix em ms + versão + aleatório.
 *
 * Por que v7 e não v4: o id vira a ordem física de inserção no índice B-tree. Com v4 cada
 * INSERT cai numa página aleatória do índice (write amplification, cache frio); com v7 os
 * ids nascem ordenados no tempo, o que também deixa `ORDER BY id` valer como `ORDER BY
 * created_at` sem índice extra.
 *
 * Gerado na aplicação porque o role `zarpa` não tem como instalar `pg_uuidv7` e o Postgres 16
 * só oferece `gen_random_uuid()` (v4) nativo. O default v4 no schema é rede de segurança para
 * INSERT feito na mão em psql; o caminho da aplicação sempre passa por aqui.
 *
 * Layout:
 *   0..5   unix_ts_ms  (48 bits, big-endian)
 *   6      0111 | rand_a[11:8]
 *   7      rand_a[7:0]
 *   8      10 | rand_b[61:56]
 *   9..15  rand_b
 */

let lastTimestamp = -1;
let sequence = 0;

export function uuidv7(): string {
  let now = Date.now();

  if (now === lastTimestamp) {
    // Mais de um id no mesmo milissegundo: incrementa o contador guardado em rand_a
    // para manter a ordenação. Se estourar os 12 bits, espera o próximo ms.
    sequence += 1;
    if (sequence > 0xfff) {
      while (now === lastTimestamp) now = Date.now();
      lastTimestamp = now;
      sequence = 0;
    }
  } else {
    lastTimestamp = now;
    sequence = 0;
  }

  const bytes = randomBytes(16);

  // 48 bits de timestamp. `Number` aguenta ms até o ano 287396, então o shift é seguro
  // desde que feito com divisão e não com `<<` (que trunca em 32 bits).
  bytes[0] = Math.floor(now / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(now / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(now / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(now / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  // versão 7 + contador de sequência nos 12 bits de rand_a
  bytes[6] = 0x70 | ((sequence >> 8) & 0x0f);
  bytes[7] = sequence & 0xff;

  // variante RFC 4122 (10xxxxxx)
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Guarda de entrada para tudo que vai virar `app.tenant_id`. Uma string que não é uuid
 * derruba o cast na policy e transforma "zero linhas" em erro 500 — melhor barrar antes.
 */
export function assertUuid(value: string, label = 'uuid'): string {
  if (!UUID_RE.test(value)) {
    throw new TypeError(`${label} inválido: esperado UUID, recebido ${JSON.stringify(value)}`);
  }
  return value;
}
