/**
 * setupFiles do vitest: roda antes de cada arquivo de teste.
 * Só carrega ambiente. Nada de mock global — mock global é como teste passa
 * a testar o próprio mock.
 */
import { loadEnv } from './env'

loadEnv()
