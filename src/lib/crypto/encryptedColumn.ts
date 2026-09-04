import { customType } from 'drizzle-orm/pg-core';
import { decryptPII, encryptPII, isEncryptedEnvelope } from './pii';

/**
 * Tipo Drizzle que cifra na escrita e decifra na leitura, de forma transparente.
 *
 *     cpf: encryptedText('cpf_encrypted')
 *
 * O tipo TypeScript da coluna é `string` (o plaintext); o que trafega para o driver é o
 * envelope `zp1.<key_id>....`.
 *
 * LIMITE CONSCIENTE: este tipo não usa AAD com contexto (tenant/coluna), porque `toDriver`
 * não recebe a linha nem o tenant corrente — é uma função pura de um valor. Onde amarrar o
 * ciphertext ao tenant importa mais do que a conveniência, chame `encryptPII(valor,
 * { context })` na mão e declare a coluna como `text()`.
 *
 * SEGUNDO LIMITE: `fromDriver` decifra TUDO que for lido. Um `select *` traz CPF em claro
 * para a memória do processo — e daí para um `console.log(row)` distraído. Por isso os
 * SELECTs de PII devem ser explícitos na lista de colunas. O tipo tolera valor já em claro
 * na leitura (linha legada, importação) devolvendo-o como está, mas nunca grava em claro.
 */
export const encryptedText = customType<{
  data: string;
  driverData: string;
  notNull: false;
}>({
  dataType() {
    return 'text';
  },
  toDriver(value: string): string {
    return encryptPII(value);
  },
  fromDriver(value: string): string {
    if (!isEncryptedEnvelope(value)) return value;
    return decryptPII(value);
  },
});
