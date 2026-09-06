/**
 * Propriedades da cifra de PII, isoladas do harness (mesmo motivo de
 * `tests/security/isolation-checks.ts`): rodam no vitest e no runner de
 * `scripts/check/`, sem duas implementações para divergirem com o tempo.
 */
export type CryptoCheck = { rule: string; ok: boolean; detail: string }

export type CryptoModule = {
  encrypt: (plaintext: string, options?: { context?: string }) => string
  decrypt: (stored: string, options?: { context?: string }) => string
  activeKeyId?: () => string
  envelopeKeyId?: (stored: string) => string | null
  source: string
}

export const SEGREDO = '529.982.247-25' // CPF válido, com formatação real

const CANDIDATE_MODULES = ['../../src/lib/crypto/index', '../../src/lib/crypto/pii']
const ENCRYPT_NAMES = ['encryptPII', 'encryptPii', 'encrypt', 'encryptField', 'seal']
const DECRYPT_NAMES = ['decryptPII', 'decryptPii', 'decrypt', 'decryptField', 'open']

export async function loadCrypto(): Promise<CryptoModule | { error: string }> {
  const tried: string[] = []
  for (const path of CANDIDATE_MODULES) {
    let mod: Record<string, unknown>
    try {
      mod = (await import(/* @vite-ignore */ path)) as Record<string, unknown>
    } catch (e) {
      tried.push(`${path}: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
      continue
    }
    const encName = ENCRYPT_NAMES.find((n) => typeof mod[n] === 'function')
    const decName = DECRYPT_NAMES.find((n) => typeof mod[n] === 'function')
    if (encName && decName) {
      return {
        encrypt: mod[encName] as CryptoModule['encrypt'],
        decrypt: mod[decName] as CryptoModule['decrypt'],
        activeKeyId: mod.activeKeyId as CryptoModule['activeKeyId'],
        envelopeKeyId: mod.envelopeKeyId as CryptoModule['envelopeKeyId'],
        source: `${path} → ${encName}/${decName}`,
      }
    }
    tried.push(`${path}: importou, mas não achei o par encrypt/decrypt`)
  }
  return {
    error:
      `não encontrei o módulo de cifra de PII. Tentei:\n` +
      tried.map((t) => `  - ${t}`).join('\n') +
      `\nDono: Rafa (src/lib/crypto/**).`,
  }
}

function throws(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

/**
 * Corrompe UM caractere do envelope, de um jeito que garante byte decodificado
 * diferente — não só caractere diferente.
 *
 * A versão anterior desta função trocava o ÚLTIMO caractere alfanumérico do
 * envelope inteiro, que quase sempre é o último caractere do segmento de
 * ciphertext em base64url. Quando o ciphertext (ou a tag) não tem comprimento
 * múltiplo de 3 bytes — aqui SEMPRE não tem: `SEGREDO` tem 14 bytes, a tag do
 * GCM tem 16 — o último caractere de base64 carrega só 2 dos 6 bits em dado
 * de verdade; os outros 4 bits são padding, descartados na decodificação.
 * Descoberto rodando este arquivo em loop: em ~1 a cada 3 execuções o
 * caractere sorteado (o resultado do IV aleatório) caía inteiramente na zona
 * de padding e o `decrypt` do ciphertext "adulterado" tinha os MESMOS bytes de
 * antes — passava batido, tag do GCM intacta, teste ficava verde por sorte.
 * Isso é exatamente o tipo de teste de segurança que eu não quero: verde sem
 * garantir nada, ~33% do tempo.
 *
 * A correção: mutar um caractere no MEIO do maior segmento do envelope
 * (afastado de qualquer borda de grupo incompleto de base64), e substituí-lo
 * por um caractere de valor bem diferente (não um "+1" que pode cair só no
 * bit de padding). No meio de um segmento longo, todo grupo de base64 está
 * completo — os 6 bits do caractere são todos dado real, então qualquer
 * caractere diferente produz byte(s) decodificado(s) diferente(s), e a tag do
 * GCM (que autentica CADA byte do ciphertext, não só a borda) sempre rejeita.
 */
export function tamperEnvelope(s: string): string {
  const parts = s.split('.')
  let targetIndex = 0
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].length > parts[targetIndex].length) targetIndex = i
  }
  const target = parts[targetIndex]

  if (target.length === 0) {
    parts[targetIndex] = 'X'
    return parts.join('.')
  }

  // Fica pelo menos 2 caracteres longe de qualquer borda (início ou fim do
  // segmento) quando o segmento é comprido o bastante; em segmento curto,
  // cai no meio mesmo — ainda assim longe da borda mais do que um flip no
  // último caractere estaria.
  const margin = target.length > 4 ? 2 : 0
  const pos = Math.min(
    Math.max(margin, Math.floor(target.length / 2)),
    target.length - 1 - margin,
  )
  const original = target[pos]
  // 'Z' é um valor de 6 bits bem afastado da maioria dos caracteres de
  // base64/base64url (A–Z, a–z, 0–9, -, _); se o original já for 'Z', usa 'A'
  // (o outro extremo do alfabeto) — o que importa é NUNCA repetir o valor.
  const replacement = original === 'Z' ? 'A' : 'Z'
  parts[targetIndex] = target.slice(0, pos) + replacement + target.slice(pos + 1)
  return parts.join('.')
}

export function runCryptoChecks(mod: CryptoModule): CryptoCheck[] {
  const checks: CryptoCheck[] = []
  const add = (rule: string, ok: boolean, detail: string): void => {
    checks.push({ rule, ok, detail })
  }

  // chave
  const key = process.env.ENCRYPTION_KEY_V1 ?? ''
  const keyBytes = Buffer.from(key, 'base64').length
  add(
    'chave-256-bits',
    keyBytes === 32,
    keyBytes === 32
      ? 'ENCRYPTION_KEY_V1 tem 32 bytes'
      : `ENCRYPTION_KEY_V1 decodifica para ${keyBytes} bytes; AES-256-GCM precisa de 32`,
  )

  // round-trip
  try {
    add(
      'round-trip',
      mod.decrypt(mod.encrypt(SEGREDO)) === SEGREDO,
      'cifra e decifra devolvem o texto original',
    )
  } catch (e) {
    add('round-trip', false, `explodiu: ${e instanceof Error ? e.message : String(e)}`)
  }

  const stored = mod.encrypt(SEGREDO)

  // key_id
  if (typeof mod.envelopeKeyId === 'function') {
    const kid = mod.envelopeKeyId(stored)
    const active = typeof mod.activeKeyId === 'function' ? mod.activeKeyId() : null
    add(
      'key-id-no-envelope',
      Boolean(kid) && (active === null || kid === active),
      kid
        ? `key_id gravado: ${kid}${active !== null && kid !== active ? ` (≠ chave ativa ${active})` : ''}`
        : 'envelopeKeyId não achou key_id no valor armazenado',
    )
  } else {
    const has = /(^|[:.$|])v?\d+([:.$|]|$)/i.test(stored) || /"?key_?id"?\s*[:=]/i.test(stored)
    add(
      'key-id-no-envelope',
      has,
      has ? 'há identificador de chave no armazenado' : `sem key_id: ${stored.slice(0, 80)}`,
    )
  }

  // texto claro ausente
  const b64 = Buffer.from(SEGREDO, 'utf8').toString('base64').replace(/=+$/, '')
  const b64url = Buffer.from(SEGREDO, 'utf8').toString('base64url')
  const hex = Buffer.from(SEGREDO, 'utf8').toString('hex')
  const digits = SEGREDO.replace(/\D/g, '')
  const leaked = [
    ['literal', stored.includes(SEGREDO)],
    ['base64', stored.includes(b64)],
    ['base64url', stored.includes(b64url)],
    ['hex', stored.toLowerCase().includes(hex)],
    ['sem pontuação', stored.includes(digits)],
  ].filter(([, hit]) => hit === true)
  add(
    'texto-claro-ausente',
    leaked.length === 0,
    leaked.length === 0
      ? 'o texto claro não aparece no valor armazenado'
      : `texto claro presente como: ${leaked.map(([k]) => k).join(', ')}`,
  )

  // IV aleatório
  const a = mod.encrypt(SEGREDO)
  const b = mod.encrypt(SEGREDO)
  add(
    'iv-aleatorio',
    a !== b,
    a !== b
      ? 'duas cifragens do mesmo texto produzem valores diferentes'
      : 'cifragem determinística: IV fixo ou reutilizado — em GCM isso quebra a ' +
        'confidencialidade e permite forjar a tag',
  )

  // adulteração
  const tampered = tamperEnvelope(stored)
  add(
    'adulteracao-detectada',
    throws(() => mod.decrypt(tampered)),
    throws(() => mod.decrypt(tampered))
      ? 'ciphertext adulterado é rejeitado'
      : 'decifrou ciphertext adulterado sem erro — a tag do GCM não está sendo verificada',
  )

  // cabeçalho autenticado (key_id no AAD)
  const parts = stored.split('.')
  if (parts.length >= 3) {
    const swapped = [...parts]
    swapped[1] = `${swapped[1]}x`
    add(
      'cabecalho-autenticado',
      throws(() => mod.decrypt(swapped.join('.'))),
      throws(() => mod.decrypt(swapped.join('.')))
        ? 'trocar o key_id do envelope é rejeitado'
        : 'trocar o key_id passou — o cabeçalho não entra como AAD',
    )
  }

  // lixo
  const garbage = ['', 'nao-e-envelope', 'zp1.v1.AAAA.BBBB.CCCC']
  const silent = garbage.filter((g) => !throws(() => mod.decrypt(g)))
  add(
    'lixo-rejeitado',
    silent.length === 0,
    silent.length === 0
      ? 'valores inválidos são rejeitados'
      : `decifrou silenciosamente: ${silent.map((g) => JSON.stringify(g)).join(', ')}`,
  )

  // context / AAD
  try {
    const scoped = mod.encrypt(SEGREDO, { context: 'travelers.cpf:tenant-A' })
    const sameOk = mod.decrypt(scoped, { context: 'travelers.cpf:tenant-A' }) === SEGREDO
    const crossBlocked = throws(() => mod.decrypt(scoped, { context: 'travelers.cpf:tenant-B' }))
    const nakedBlocked = throws(() => mod.decrypt(scoped))
    add(
      'context-amarra-escopo',
      sameOk && crossBlocked && nakedBlocked,
      sameOk && crossBlocked && nakedBlocked
        ? 'envelope com context só decifra no mesmo context'
        : `context não amarra escopo (mesmo context: ${sameOk ? 'ok' : 'falhou'}, ` +
          `outro tenant: ${crossBlocked ? 'bloqueou' : 'DECIFROU'}, ` +
          `sem context: ${nakedBlocked ? 'bloqueou' : 'DECIFROU'}). ` +
          `Sem isso, dá para copiar um CPF de uma linha para outra e ainda decifrar.`,
    )
  } catch (e) {
    add('context-amarra-escopo', false, `explodiu: ${e instanceof Error ? e.message : String(e)}`)
  }

  return checks
}
