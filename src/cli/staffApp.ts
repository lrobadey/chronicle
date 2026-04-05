import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { CliTerminal } from './app';
import type { StaffInterviewContext } from '../engine/contextBuilders';
import type { StaffInterviewMessage, StaffInterviewResult } from '../agents/staffInterview';
import { parseCommand } from './commandParsing';

export interface StaffCliEngine {
  ensureStaffSession(params: { sessionId?: string; playerId: string }): Promise<{
    sessionId: string;
    created: boolean;
  }>;
  getStaffInterviewContext(sessionId: string, playerId: string): Promise<StaffInterviewContext>;
  runStaffInterview(input: {
    sessionId: string;
    playerId: string;
    question: string;
    apiKey?: string;
    conversation?: StaffInterviewMessage[];
  }): Promise<StaffInterviewResult>;
}

export interface StaffCliState {
  sessionId: string;
  playerId: string;
  apiKey?: string;
  conversation: StaffInterviewMessage[];
}

export interface StaffCliOptions {
  engine: StaffCliEngine;
  terminal: CliTerminal;
  sessionId?: string;
  apiKey?: string;
  allowNonTty?: boolean;
}

export interface StaffCliRunResult {
  exitCode: number;
  finalState?: StaffCliState;
}

export async function runStaffCli(options: StaffCliOptions): Promise<StaffCliRunResult> {
  const { engine, terminal, sessionId, apiKey, allowNonTty = false } = options;
  let finalState: StaffCliState | undefined;

  const write = (text: string) => {
    terminal.write(text);
  };

  try {
    if (!allowNonTty && !terminal.isTTY()) {
      write('Error: staff CLI requires an interactive terminal.\n');
      return { exitCode: 1 };
    }

    write('\n=== Chronicle Staff Interview ===\n\n');
    finalState = await openStaffSession({ engine, sessionId, playerId: 'player-1', apiKey, write });
    write('Ask the GM-staff representative about context, friction, or goals.\n');
    write('Type /help for commands.\n\n');

    while (true) {
      const line = await terminal.readLine('staff> ');
      if (line == null) {
        return { exitCode: 0, finalState };
      }
      const next = await handleStaffCliLine({
        state: finalState,
        line: line.trim(),
        engine,
        write,
      });
      finalState = next.state;
      if (next.exit) {
        return { exitCode: 0, finalState };
      }
    }
  } catch (error) {
    write(`${formatError(error)}\n`);
    return { exitCode: 1, finalState };
  } finally {
    terminal.close();
  }
}

export async function startStaffCli(
  engine: StaffCliEngine,
  options: Omit<StaffCliOptions, 'engine' | 'terminal'> = {},
): Promise<StaffCliRunResult> {
  return runStaffCli({
    ...options,
    engine,
    terminal: createReadlineTerminal(),
  });
}

export async function handleStaffCliLine(params: {
  state: StaffCliState;
  line: string;
  engine: StaffCliEngine;
  write: (text: string) => void;
}): Promise<{ state: StaffCliState; exit: boolean }> {
  const { engine, write, line } = params;
  let { state } = params;
  if (!line) return { state, exit: false };

  if (line.startsWith('/')) {
    const parsed = parseCommand(line);
    switch (parsed.name) {
      case 'help':
        write(`${helpText()}\n`);
        return { state, exit: false };
      case 'exit':
        return { state, exit: true };
      case 'session': {
        const context = await engine.getStaffInterviewContext(state.sessionId, state.playerId);
        write(`\nSession: ${state.sessionId}\n`);
        write(`Turn: ${context.telemetry.turn}\n`);
        write(`Location: ${context.telemetry.location.name}\n`);
        write(`Pending prompt: ${context.pendingPrompt ? context.pendingPrompt.kind : 'none'}\n\n`);
        return { state, exit: false };
      }
      case 'new': {
        state = await openStaffSession({
          engine,
          sessionId: parsed.args[0],
          playerId: state.playerId,
          apiKey: state.apiKey,
          write,
        });
        return { state, exit: false };
      }
      default:
        write(`\nUnknown command: ${line}\nType /help for available commands.\n\n`);
        return { state, exit: false };
    }
  }

  const result = await engine.runStaffInterview({
    sessionId: state.sessionId,
    playerId: state.playerId,
    question: line,
    apiKey: state.apiKey,
    conversation: state.conversation,
  });
  state = {
    ...state,
    conversation: [
      ...state.conversation,
      { role: 'operator', content: line },
      { role: 'employee', content: result.employeeReply },
    ],
  };
  write(formatInterviewResult(result));
  return { state, exit: false };
}

async function openStaffSession(params: {
  engine: StaffCliEngine;
  sessionId?: string;
  playerId: string;
  apiKey?: string;
  write: (text: string) => void;
}): Promise<StaffCliState> {
  const ensured = await params.engine.ensureStaffSession({
    sessionId: params.sessionId,
    playerId: params.playerId,
  });
  params.write(`Session: ${ensured.sessionId}${ensured.created ? ' (created)' : ''}\n`);
  params.write(`Mode: ${params.apiKey ? 'live' : 'fallback'}\n\n`);
  return {
    sessionId: ensured.sessionId,
    playerId: params.playerId,
    apiKey: params.apiKey,
    conversation: [],
  };
}

function formatInterviewResult(result: StaffInterviewResult): string {
  const diagnostics = result.diagnostics;
  return [
    `\nEmployee (${result.source}):`,
    result.employeeReply,
    '',
    'Diagnostics:',
    `Current understanding: ${diagnostics.currentUnderstanding}`,
    `Known goals: ${formatList(diagnostics.knownGoals)}`,
    `Missing context: ${formatList(diagnostics.missingContext)}`,
    `Friction points: ${formatList(diagnostics.frictionPoints)}`,
    `Improvement ideas: ${formatList(diagnostics.improvementIdeas)}`,
    `Suggested questions: ${formatList(diagnostics.suggestedQuestions)}`,
    `Confidence notes: ${formatList(diagnostics.confidenceNotes)}`,
    '',
  ].join('\n');
}

function formatList(values: string[]): string {
  return values.length ? values.join(' | ') : '(none)';
}

function helpText() {
  return `
Commands:
  /help                 Show this help
  /session              Show current interview session info
  /new [sessionId]      Open or create another interview session
  /exit                 Exit staff CLI
`;
}

function formatError(error: unknown): string {
  if (error instanceof Error) return `Error: ${error.message}`;
  if (error && typeof error === 'object' && typeof (error as { error?: unknown }).error === 'string') {
    return `Error: ${(error as { error: string }).error}`;
  }
  return `Error: ${String(error)}`;
}

function createReadlineTerminal(): CliTerminal {
  const rl = readline.createInterface({ input, output });
  const queuedLines: string[] = [];
  let pendingResolve: ((line: string | null) => void) | undefined;
  let closed = false;

  rl.on('line', line => {
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = undefined;
      resolve(line);
      return;
    }
    queuedLines.push(line);
  });

  rl.on('close', () => {
    closed = true;
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = undefined;
      resolve(null);
    }
  });

  return {
    isTTY: () => Boolean(input.isTTY),
    write: text => {
      output.write(text);
    },
    readLine: prompt => {
      output.write(prompt);
      if (queuedLines.length) {
        return Promise.resolve(queuedLines.shift() ?? null);
      }
      if (closed) {
        return Promise.resolve(null);
      }
      return new Promise(resolve => {
        pendingResolve = resolve;
      });
    },
    supportsTransientStatus: () => false,
    renderTransientStatus: () => {},
    clearTransientStatus: () => {},
    close: () => {
      rl.close();
    },
  };
}
