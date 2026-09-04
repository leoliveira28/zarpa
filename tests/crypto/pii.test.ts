/**
 * Regra 3 do CLAUDE.md: CPF, passaporte e nascimento vão para o banco em
 * AES-256-GCM feito na aplicação, com o `key_id` gravado junto do ciphertext.
 *
 * As propriedades ficam em `pii-checks.ts` porque também rodam pelo runner de
 * `scripts/check/` — uma implementação só, dois harnesses. Aqui é só o veredito.
 */
import { describe, expect, it } from 'vitest'
import { loadEnv } from '../setup/env'
import { loadCrypto, runCryptoChecks, type CryptoModule } from './pii-checks'

loadEnv()

const loaded = await loadCrypto()
const available = !('error' in loaded)
const mod = available ? (loaded as CryptoModule) : null
const checks = mod ? runCryptoChecks(mod) : []

const check = (rule: string): { ok: boolean; detail: string } =>
  checks.find((c) => c.rule === rule) ?? {
    ok: false,
    detail: `checagem "${rule}" não executou (módulo de cifra indisponível)`,
  }

describe('módulo de cifra de PII', () => {
  it('existe e expõe encrypt/decrypt', () => {
    expect(available, available ? '' : (loaded as { error: string }).error).toBe(true)
  })

  it('a chave configurada tem 32 bytes (AES-256, não AES-128 silencioso)', () => {
    const c = check('chave-256-bits')
    expect(c.ok, c.detail).toBe(true)
  })
})

describe.skipIf(!available)('AES-256-GCM', () => {
  const cases: [string, string][] = [
    ['round-trip devolve exatamente o texto original', 'round-trip'],
    ['o valor armazenado carrega o key_id da chave ativa', 'key-id-no-envelope'],
    ['o texto claro nunca aparece no armazenado', 'texto-claro-ausente'],
    ['duas cifragens do mesmo texto diferem (IV aleatório)', 'iv-aleatorio'],
    ['ciphertext adulterado FALHA ao decifrar', 'adulteracao-detectada'],
    ['trocar o key_id do envelope FALHA (cabeçalho autenticado)', 'cabecalho-autenticado'],
    ['lixo não decifra silenciosamente', 'lixo-rejeitado'],
    ['envelope de um context não decifra em outro', 'context-amarra-escopo'],
  ]

  it.each(cases)('%s', (_label, rule) => {
    const c = check(rule)
    expect(c.ok, c.detail).toBe(true)
  })
})
