/**
 * Registra o hook de resolução. Use com `--import`:
 *
 *     node --import ./src/db/_register.mjs --env-file=.env.local src/db/migrate.ts
 *
 * Ver `_node-resolver.mjs` para o porquê.
 */
import { register } from 'node:module';

register('./_node-resolver.mjs', import.meta.url);
