/**
 * Chronicle vNext - CLI
 */

import { TurnEngine } from './engine/turnEngine';
import { startCli } from './cli/app';

async function main() {
  const engine = new TurnEngine();
  await startCli(engine);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
