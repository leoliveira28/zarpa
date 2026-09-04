import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { activeKeyId, keyFor, type KeyId } from './keyring';

/**
 * AES-256-GCM para CPF, passaporte e data de nascimento.
 *
 * Formato do ciphertext (string, cabe numa coluna `text`):
 *
 *     zp1.<key_id>.<iv_b64url>.<tag_b64url>.<ciphertext_b64url>
 *
 *   zp1      prefixo de formato. Se um dia o envelope mudar, vira zp2 e os dois convivem.
 *   key_id   qual chave cifrou esta linha. É o que torna rotação possível sem downtime.
 *   iv       12 bytes aleatórios por operação. NUNCA reutilizado — repetir IV com a mesma
 *            chave em GCM quebra a confidencialidade e permite forjar autenticação.
 *   tag      16 bytes de autenticação. É o que faz `decryptPII` detectar adulteração no
 *            banco em vez de devolver lixo silenciosamente.
 *
 * O cabeçalho (`zp1.<key_id>`) entra como AAD: ele não é secreto, mas fica autenticado.
 * Assim ninguém troca o key_id do registro para induzir o uso de outra chave.
 *
 * `context` opcional acrescenta escopo ao AAD (ex.: `travelers.cpf:<tenant_id>`). Ligar o
 * ciphertext ao lugar onde ele mora impede copiar um CPF de uma linha para outra e ainda
 * assim descriptografar. Quem usa `context` na escrita PRECISA usar o mesmo na leitura.
 */

const FORMAT = 'zp1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type EncryptOptions = { context?: string };

function aad(keyId: KeyId, context?: string): Buffer {
  return Buffer.from(context ? `${FORMAT}.${keyId}|${context}` : `${FORMAT}.${keyId}`, 'utf8');
}

export function encryptPII(plaintext: string, options: EncryptOptions = {}): string {
  if (typeof plaintext !== 'string') {
    throw new TypeError('encryptPII recebe string');
  }
  const keyId = activeKeyId();
  const key = keyFor(keyId);
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(keyId, options.context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    FORMAT,
    keyId,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptPII(envelope: string, options: EncryptOptions = {}): string {
  const parsed = parseEnvelope(envelope);
  const key = keyFor(parsed.keyId);

  const decipher = createDecipheriv('aes-256-gcm', key, parsed.iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad(parsed.keyId, options.context));
  decipher.setAuthTag(parsed.tag);

  try {
    return Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // A mensagem NUNCA repete conteúdo — nem parcial, nem tamanho do plaintext.
    throw new Error(
      `Falha ao descriptografar PII (key_id=${parsed.keyId}): autenticação inválida. ` +
        `Chave errada, ciphertext adulterado, ou o "context" usado na leitura difere do da escrita.`,
    );
  }
}

/** Versões toleráveis a nulo — a maioria das colunas de PII é nullable. */
export function encryptPIINullable(
  plaintext: string | null | undefined,
  options: EncryptOptions = {},
): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  return encryptPII(plaintext, options);
}

export function decryptPIINullable(
  envelope: string | null | undefined,
  options: EncryptOptions = {},
): string | null {
  if (envelope === null || envelope === undefined || envelope === '') return null;
  return decryptPII(envelope, options);
}

export function isEncryptedEnvelope(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(`${FORMAT}.`) && value.split('.').length === 5;
}

/** Qual chave cifrou esta linha — o que um job de rotação usa para achar o que reescrever. */
export function envelopeKeyId(envelope: string): KeyId {
  return parseEnvelope(envelope).keyId;
}

function parseEnvelope(envelope: string): {
  keyId: KeyId;
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
} {
  if (typeof envelope !== 'string') {
    throw new TypeError('decryptPII recebe string');
  }
  const parts = envelope.split('.');
  if (parts.length !== 5 || parts[0] !== FORMAT) {
    throw new Error(
      `Ciphertext em formato desconhecido. Esperado "${FORMAT}.<key_id>.<iv>.<tag>.<ct>".`,
    );
  }
  const [, keyId, ivB64, tagB64, ctB64] = parts as [string, string, string, string, string];
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  if (iv.length !== IV_BYTES) throw new Error(`IV com tamanho inválido (${iv.length} bytes).`);
  if (tag.length !== TAG_BYTES) throw new Error(`Tag com tamanho inválido (${tag.length} bytes).`);

  return { keyId, iv, tag, ciphertext: Buffer.from(ctB64, 'base64url') };
}

/**
 * Máscara para exibição e log. CPF vira `***.***.789-01`.
 * Regra do CLAUDE.md: PII nunca vai para log. Se PRECISAR aparecer, aparece assim.
 */
export function maskDocument(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}
