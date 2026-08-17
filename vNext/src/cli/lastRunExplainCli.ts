import path from 'node:path';
import { TurnEngine } from '../engine/turnEngine';
import { JsonlSessionStore } from '../engine/session/jsonlStore';
import { OperatorCliEngine, type OperatorViewMode } from './operatorEngine';
import { renderLastRunExplain } from './operatorRender';

interface CliOptions {
  sessionId?: string;
  json: boolean;
  view: OperatorViewMode;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sessionRoot = process.env.CHRONICLE_SESSION_ROOT
    ? path.resolve(process.env.CHRONICLE_SESSION_ROOT)
    : path.resolve(process.cwd(), 'data/sessions');
  const store = new JsonlSessionStore(sessionRoot);
  const engine = new TurnEngine({ store });
  const operator = new OperatorCliEngine({ engine, store });
  const report = await operator.getLastRunExplainReport({
    sessionId: options.sessionId,
    playerId: 'player-1',
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${renderLastRunExplain(report, { view: options.view })}\n`);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    view: 'summary',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--session') {
      options.sessionId = expectValue(argv[++index], '--session');
      continue;
    }
    if (arg === '--view') {
      options.view = parseView(expectValue(argv[++index], '--view'));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function expectValue(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function parseView(value: string): OperatorViewMode {
  if (value === 'summary' || value === 'operator' || value === 'full' || value === 'raw') return value;
  throw new Error('--view must be one of summary|operator|full|raw');
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
