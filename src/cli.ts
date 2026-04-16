import fs from 'node:fs';
import path from 'node:path';
import { TurnEngine } from './engine/turnEngine';
import { JsonlSessionStore } from './engine/session/jsonlStore';
import { runOperatorCli } from './cli/operatorCli';
import type { CliTranscriptEvent } from './cli/app';

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
    : path.resolve(process.cwd(), 'data/sessions');
  const store = new JsonlSessionStore(sessionRoot);
  const engine = new TurnEngine({ store });
  const exitCode = await runOperatorCli({
    argv: process.argv.slice(2),
    env: process.env,
    engine,
    store,
    transcript: createTranscriptSink(process.env.CHRONICLE_CLI_TRANSCRIPT),
  });
  process.exit(exitCode);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
