/**
 * Chronicle vNext - CLI
 */

import fs from 'node:fs';
import path from 'node:path';
import { TurnEngine } from './engine/turnEngine';
import { JsonlSessionStore } from './engine/session/jsonlStore';
import { resolveCliApiMode, startCli, type CliTranscriptEvent } from './cli/app';

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function createTranscriptSink(transcriptPath: string | undefined): ((event: CliTranscriptEvent) => void) | undefined {
  if (!transcriptPath) return undefined;
  const resolvedPath = path.resolve(transcriptPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, '');
  return event => {
    fs.appendFileSync(resolvedPath, JSON.stringify(event) + '\n');
  };
}

async function main() {
  const sessionRoot = process.env.CHRONICLE_SESSION_ROOT
    ? path.resolve(process.env.CHRONICLE_SESSION_ROOT)
    : undefined;
  const engine = new TurnEngine({
    store: sessionRoot ? new JsonlSessionStore(sessionRoot) : undefined,
  });
  const result = await startCli(engine, {
    env: process.env,
    startupWorldId: process.env.CHRONICLE_STARTUP_WORLD_ID || undefined,
    skipWorldPrompt: isTruthyEnv(process.env.CHRONICLE_SKIP_WORLD_PROMPT),
    apiMode: resolveCliApiMode(process.env.CHRONICLE_API_MODE),
    allowNonTty: isTruthyEnv(process.env.CHRONICLE_ALLOW_NON_TTY),
    transcript: createTranscriptSink(process.env.CHRONICLE_CLI_TRANSCRIPT),
  });
  process.exit(result.exitCode);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
