import { createHash, hkdfSync, timingSafeEqual } from 'node:crypto';
import { isProduction } from '../../db/env';

/**
 * Chaveiro de criptografia de PII.
 *
 * As chaves vêm do ambiente como `ENCRYPTION_KEY_V<N>` (base64 de 32 bytes). O `key_id` é
 * `v<N>` e vai gravado JUNTO do ciphertext — é isso que permite rotacionar: sobe-se
 * `ENCRYPTION_KEY_V2`, a chave ativa passa a ser a v2, e as linhas antigas continuam
 * legíveis pela v1 até um backfill reescrever.
 *
 * A chave ativa é a de maior N, ou a apontada por `ENCRYPTION_ACTIVE_KEY_ID`.
 */

const KEY_ENV_RE = /^ENCRYPTION_KEY_(V\d+)$/;
const KEY_ID_RE = /^v\d+$/;

export type KeyId = string;

type KeyRing = {
  keys: Map<KeyId, Buffer>;
  activeKeyId: KeyId;
};

let cached: KeyRing | null = null;
const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  // Aviso de configuração, não de dado. Nunca imprime material de chave nem plaintext.
  console.warn(`[crypto] ${message}`);
}

/**
 * Converte o material do ambiente em uma chave de 32 bytes.
 *
 * Se o valor já é base64 de exatamente 32 bytes, usa direto — esse é o caminho correto.
 * Se não é (o `.env.local` de desenvolvimento hoje traz um placeholder de 36 bytes),
 * deriva 32 bytes com HKDF-SHA256 **apenas fora de produção**, para que
 * `npm run db:seed` funcione numa máquina recém-clonada. Em produção isso é erro fatal:
 * chave torta em produção é incidente, não inconveniência.
 */
function materialToKey(keyId: KeyId, raw: string): Buffer {
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length === 32) return decoded;

  if (isProduction()) {
    throw new Error(
      `ENCRYPTION_KEY_${keyId.toUpperCase()} precisa ser base64 de exatamente 32 bytes ` +
        `(recebido: ${decoded.length} bytes). Gere com: openssl rand -base64 32`,
    );
  }

  warnOnce(
    `key:${keyId}`,
    `ENCRYPTION_KEY_${keyId.toUpperCase()} não é base64 de 32 bytes (${decoded.length} bytes). ` +
      `Derivando via HKDF só para desenvolvimento. Em produção isso falha. ` +
      `Gere a chave real com: openssl rand -base64 32`,
  );

  return Buffer.from(
    hkdfSync('sha256', Buffer.from(raw, 'utf8'), 'zarpa-pii-dev-salt', `zarpa-pii-${keyId}`, 32),
  );
}

function buildKeyRing(): KeyRing {
  const keys = new Map<KeyId, Buffer>();

  for (const [name, value] of Object.entries(process.env)) {
    const match = KEY_ENV_RE.exec(name);
    if (!match || !value || value.trim() === '') continue;
    const keyId = match[1]!.toLowerCase();
    keys.set(keyId, materialToKey(keyId, value.trim()));
  }

  if (keys.size === 0) {
    throw new Error(
      'Nenhuma chave de criptografia encontrada. Defina ENCRYPTION_KEY_V1 ' +
        '(base64 de 32 bytes: openssl rand -base64 32).',
    );
  }

  const explicit = process.env.ENCRYPTION_ACTIVE_KEY_ID?.trim().toLowerCase();
  if (explicit) {
    if (!keys.has(explicit)) {
      throw new Error(
        `ENCRYPTION_ACTIVE_KEY_ID=${explicit} não corresponde a nenhuma ENCRYPTION_KEY_* definida.`,
      );
    }
    return { keys, activeKeyId: explicit };
  }

  const activeKeyId = [...keys.keys()].sort(
    (a, b) => Number(b.slice(1)) - Number(a.slice(1)),
  )[0]!;

  return { keys, activeKeyId };
}

function keyRing(): KeyRing {
  cached ??= buildKeyRing();
  return cached;
}

/** Usado por teste; em runtime o chaveiro é imutável. */
export function resetKeyRingCache(): void {
  cached = null;
  warned.clear();
}

export function activeKeyId(): KeyId {
  return keyRing().activeKeyId;
}

export function keyFor(keyId: KeyId): Buffer {
  if (!KEY_ID_RE.test(keyId)) {
    throw new Error(`key_id inválido: ${JSON.stringify(keyId)}`);
  }
  const key = keyRing().keys.get(keyId);
  if (!key) {
    throw new Error(
      `Ciphertext gravado com a chave ${keyId}, que não está no ambiente. ` +
        `Defina ENCRYPTION_KEY_${keyId.toUpperCase()} para conseguir descriptografar.`,
    );
  }
  return key;
}

export function knownKeyIds(): KeyId[] {
  return [...keyRing().keys.keys()];
}

/**
 * HMAC-ish de identificador (IP, e-mail) para deduplicação sem guardar o dado em claro.
 * Determinístico de propósito: `proposal_views.ip_hash` precisa comparar visitas.
 * Não serve para PII que precise voltar ao original — para isso use `encryptPII`.
 */
export function blindIndex(value: string, scope: string): string {
  const key = keyFor(activeKeyId());
  return createHash('sha256').update(key).update('\x00').update(scope).update('\x00').update(value).digest('base64url');
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
