import path from 'node:path';
import { TurnEngine } from './engine/turnEngine';
import { JsonlSessionStore } from './engine/session/jsonlStore';
import { startStaffCli } from './cli/staffApp';
import { resolveApiKey } from './cli/app';

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

async function main() {
  const sessionRoot = process.env.CHRONICLE_SESSION_ROOT
    ? path.resolve(process.env.CHRONICLE_SESSION_ROOT)
    : undefined;
  const engine = new TurnEngine({
    store: sessionRoot ? new JsonlSessionStore(sessionRoot) : undefined,
  });
  const result = await startStaffCli(engine, {
    sessionId: process.argv[2],
    apiKey: resolveApiKey(process.env),
    allowNonTty: isTruthyEnv(process.env.CHRONICLE_ALLOW_NON_TTY),
  });
  process.exit(result.exitCode);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
