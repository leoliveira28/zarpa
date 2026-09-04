/**
 * Hook de resolução para rodar os scripts de banco direto no Node.
 *
 * Por que existe: o Node 22 executa TypeScript nativamente (type stripping), mas resolve
 * módulos com as regras do ESM — exige extensão explícita e não conhece o alias `@/` do
 * `tsconfig.json`. O `tsconfig.json` é do PO e `drizzle-kit`/`tsx` não estão instalados,
 * então em vez de mexer em arquivo alheio ou pedir dependência só para rodar dois scripts,
 * este hook faz as duas traduções:
 *
 *     '@/db/client'  -> <raiz>/src/db/client.ts
 *     './client'     -> ./client.ts  (ou ./client/index.ts)
 *
 * Some no dia em que `tsx` entrar no projeto. Não é usado em runtime de aplicação — o
 * Next resolve tudo sozinho.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..');

function firstExisting(basePath) {
  for (const candidate of [
    `${basePath}.ts`,
    `${basePath}.mts`,
    `${basePath}/index.ts`,
    `${basePath}/index.mts`,
  ]) {
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const found = firstExisting(resolvePath(projectRoot, 'src', specifier.slice(2)));
    if (found) return { url: found, shortCircuit: true };
  }

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const parentPath = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : projectRoot;
    const found = firstExisting(resolvePath(parentPath, specifier));
    if (found) return { url: found, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}
