/**
 * Portão de CI para a suíte do vitest, sem baixar a régua.
 *
 * Hoje 3 testes ficam vermelhos DE PROPÓSITO, todos em `public-proposal.test.ts`:
 * a leitura pública da proposta é trabalho da S7 (função SECURITY DEFINER ainda
 * não existe). Ver `docs/handoffs/rafa-para-teo.md`, item 5.
 *
 * (Havia uma 4ª entrada aqui — `pii.test.ts` reclamando de `ENCRYPTION_KEY_V1`
 * sem 32 bytes. A chave de desenvolvimento foi corrigida e o teste ficou verde;
 * a entrada foi removida no dia em que este script apontou ela como OBSOLETA.
 * Isto é o script funcionando como projetado — ver regra 2 abaixo.)
 *
 * A escolha aqui NÃO é `.todo`/`.skip`: isso pararia de rodar a asserção, e
 * o dia em que alguém quebrar a função por engano ninguém saberia — o teste
 * simplesmente não existiria mais para o CI. A escolha é uma ALLOWLIST
 * NOMEADA: os 4 nomes exatos abaixo, cada um com dono e motivo. O script:
 *
 *   1. roda a suíte inteira via `vitest run --reporter=json`;
 *   2. falha se QUALQUER teste fora da lista estiver vermelho — regressão
 *      real continua parando o CI, sem exceção;
 *   3. falha se um teste DA lista virar verde — allowlist que sobrevive ao
 *      código que ela tolerava é a mesma "entrada morta" que
 *      `deviations.test.ts` já não aceita para os guardas visuais. Aqui é o
 *      sinal de "a S7 chegou, tire a entrada e apague `.todo` nenhum".
 *
 *   npx tsx scripts/check/known-failures.ts
 *
 * Sai 1 se o contrato acima não se sustentar. É o portão, não o relatório.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type KnownFailure = { fullName: string; owner: string; reason: string }

/**
 * Vazia de propósito. As 3 entradas da S7 (função SECURITY DEFINER da proposta
 * pública) ficaram verdes: a função existe (`drizzle/0004_proposta_publica.sql`),
 * tem `search_path` fixo, e `public-proposal.test.ts` agora semeia sua própria
 * fixture (`seedPublicProposalFixture`, proposta em status `sent` com opção com
 * custo/comissão preenchidos) em vez de depender de `tenant-isolation.test.ts`
 * rodar antes — ver docs/handoffs/rafa-para-teo.md, seção S7.
 */
export const KNOWN_FAILURES: readonly KnownFailure[] = [] as const

type AssertionResult = { fullName: string; status: string }
type TestResult = { name: string; assertionResults: AssertionResult[] }
type VitestJson = { testResults: TestResult[]; numTotalTests: number }

const RESET = '\x1b[0m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const BOLD = '\x1b[1m'

function runVitest(): VitestJson {
  const dir = mkdtempSync(join(tmpdir(), 'zarpa-vitest-'))
  const outFile = join(dir, 'result.json')
  const res = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vitest', 'run', '--reporter=json', `--outputFile=${outFile}`],
    { cwd: join(__dirname, '..', '..'), stdio: ['ignore', 'inherit', 'inherit'], encoding: 'utf8' },
  )
  if (res.error) throw res.error
  let json: VitestJson
  try {
    json = JSON.parse(readFileSync(outFile, 'utf8')) as VitestJson
  } catch (e) {
    throw new Error(
      `[known-failures] não consegui ler o relatório JSON do vitest (código de saída ${res.status}). ` +
        `Isso normalmente é a suíte quebrando ANTES de rodar teste nenhum (erro de import, DB fora do ar). ` +
        `Rode "npx vitest run" direto para ver o erro real.\n${String(e)}`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return json
}

function main(): void {
  console.log(`${BOLD}Portão de CI — vitest com allowlist nomeada de vermelhos${RESET}`)
  const json = runVitest()

  const failed = new Map<string, string>() // fullName -> file
  for (const tf of json.testResults) {
    for (const a of tf.assertionResults) {
      if (a.status === 'failed') failed.set(a.fullName, tf.name)
    }
  }

  const allowedNames = new Set(KNOWN_FAILURES.map((k) => k.fullName))

  const unexpectedFailures = [...failed.entries()].filter(([name]) => !allowedNames.has(name))
  const staleAllowlist = KNOWN_FAILURES.filter((k) => !failed.has(k.fullName))
  const confirmedKnown = KNOWN_FAILURES.filter((k) => failed.has(k.fullName))

  console.log(`\n${json.numTotalTests} teste(s) no total.`)

  console.log(`\n${BOLD}Allowlist (${KNOWN_FAILURES.length}):${RESET}`)
  for (const k of confirmedKnown) {
    console.log(`  ${YELLOW}vermelho esperado${RESET}  ${k.fullName}`)
    console.log(`      dono: ${k.owner} · ${k.reason}`)
  }

  let failures = 0

  if (unexpectedFailures.length > 0) {
    failures++
    console.log(`\n${BOLD}${RED}Vermelho FORA da allowlist — regressão real:${RESET}`)
    for (const [name, file] of unexpectedFailures) {
      console.log(`  ${RED}FALHA${RESET}  ${file}\n         ${name}`)
    }
  }

  if (staleAllowlist.length > 0) {
    failures++
    console.log(
      `\n${BOLD}${RED}Entrada da allowlist ficou verde — tire daqui, o CI ficou mais rígido de graça:${RESET}`,
    )
    for (const k of staleAllowlist) {
      console.log(`  ${RED}OBSOLETA${RESET}  ${k.fullName}\n            (dono: ${k.owner})`)
    }
  }

  if (failures === 0) {
    console.log(
      `\n${GREEN}Portão ok${RESET}: só os ${KNOWN_FAILURES.length} vermelho(s) esperado(s) estão vermelhos, e mais nenhum.`,
    )
  }

  process.exit(failures === 0 ? 0 : 1)
}

main()
