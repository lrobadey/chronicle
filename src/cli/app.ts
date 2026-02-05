import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { TurnEngine } from '../engine/turnEngine';
import type { InitResult, RunTurnOutput } from '../engine/turnEngine';
import { isChronicleError } from '../engine/errors';
import type { NarratorStyle } from '../agents/narrator/narratorAgent';

export interface CliState {
  sessionId: string;
  playerId: string;
  narratorStyle: NarratorStyle;
  apiKey?: string;
  includeTrace: boolean;
}

export interface CliEngine {
  initSession(params: { sessionId?: string; apiKey?: string }): Promise<InitResult>;
  getTelemetry(sessionId: string, playerId: string): Promise<RunTurnOutput['telemetry']>;
  runTurn(input: {
    sessionId: string;
    playerId: string;
    playerText: string;
    apiKey?: string;
    narratorStyle?: NarratorStyle;
    debug?: { includeTrace?: boolean };
  }): Promise<RunTurnOutput>;
}

export interface CliOptions {
  engine: CliEngine;
  write?: (text: string) => void;
  readLine?: (prompt: string) => Promise<string>;
  close?: () => void;
  isTTY?: boolean;
}

export interface CliStepResult {
  state: CliState;
  exit: boolean;
}

export function resolveApiKey(env: NodeJS.ProcessEnv): string | undefined {
  return env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY || undefined;
}

export async function startCli(engine: TurnEngine): Promise<void> {
  const ioWrite = (text: string) => output.write(text);

  if (!input.isTTY) {
    ioWrite('Error: CLI requires an interactive terminal.\n');
    process.exit(1);
  }

  const rl = readline.createInterface({ input, output });
  const readLine = async (prompt: string) => rl.question(prompt);

  ioWrite('\n=== Chronicle vNext - Isle of Marrow ===\n\n');

  try {
    let state = await initCliSession({
      engine,
      sessionId: undefined,
      apiKey: resolveApiKey(process.env),
      write: ioWrite,
      narratorStyle: 'michener',
      includeTrace: false,
    });

    ioWrite('Type /help for commands, or enter your action.\n\n');

    while (true) {
      const line = (await readLine('> ')).trim();
      const step = await handleCliLine({
        state,
        line,
        engine,
        write: ioWrite,
      });
      state = step.state;
      if (step.exit) break;
    }
  } finally {
    rl.close();
    ioWrite('Goodbye!\n');
  }
}

export async function initCliSession(params: {
  engine: CliEngine;
  sessionId?: string;
  apiKey?: string;
  narratorStyle: NarratorStyle;
  includeTrace: boolean;
  write: (text: string) => void;
}): Promise<CliState> {
  const { engine, sessionId, apiKey, narratorStyle, includeTrace, write } = params;
  const { result, usedFallback } = await initWithFallback(engine, sessionId, apiKey);

  if (!apiKey) {
    write('(No API key - running in deterministic fallback mode)\n\n');
  } else if (usedFallback) {
    write('(API unavailable - switched to deterministic fallback mode)\n\n');
  }

  write(`${result.opening}\n\n`);
  return {
    sessionId: result.sessionId,
    playerId: 'player-1',
    narratorStyle,
    apiKey: usedFallback ? undefined : apiKey,
    includeTrace,
  };
}

export async function handleCliLine(params: {
  state: CliState;
  line: string;
  engine: CliEngine;
  write: (text: string) => void;
}): Promise<CliStepResult> {
  const { line, engine, write } = params;
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
      case 'session':
        write(`\nSession: ${state.sessionId}\n`);
        write(`Narrator style: ${state.narratorStyle}\n`);
        write(`Trace mode: ${state.includeTrace ? 'on' : 'off'}\n`);
        write(`API mode: ${state.apiKey ? 'live' : 'fallback'}\n\n`);
        return { state, exit: false };
      case 'style': {
        const next = parsed.args[0]?.toLowerCase();
        if (!isNarratorStyle(next)) {
          write('\nUsage: /style <lyric|cinematic|michener>\n\n');
          return { state, exit: false };
        }
        state = { ...state, narratorStyle: next };
        write(`\nNarrator style: ${next}\n\n`);
        return { state, exit: false };
      }
      case 'trace': {
        const token = parsed.args[0]?.toLowerCase();
        const nextValue = parseToggle(token, !state.includeTrace);
        state = { ...state, includeTrace: nextValue };
        write(`\nTrace mode: ${state.includeTrace ? 'on' : 'off'}\n\n`);
        return { state, exit: false };
      }
      case 'state':
        try {
          const telemetry = await engine.getTelemetry(state.sessionId, state.playerId);
          write(`${formatTelemetry(telemetry)}\n`);
        } catch (error) {
          write(`\nState error: ${formatError(error)}\n\n`);
        }
        return { state, exit: false };
      case 'new': {
        const requestedSession = parsed.args[0];
        state = await initCliSession({
          engine,
          sessionId: requestedSession,
          apiKey: state.apiKey,
          write,
          narratorStyle: state.narratorStyle,
          includeTrace: state.includeTrace,
        });
        return { state, exit: false };
      }
      default:
        write(`\nUnknown command: ${line}\nType /help for available commands.\n\n`);
        return { state, exit: false };
    }
  }

  const turn = await runTurnWithFallback(engine, state, line);
  if (turn.usedFallback) {
    state = { ...state, apiKey: undefined };
    write('\n(API request failed - switched to deterministic fallback mode)\n');
  }

  state = { ...state, sessionId: turn.result.sessionId };
  write(`\n${turn.result.narration}\n`);

  if (state.includeTrace) {
    const tools = turn.result.trace?.toolCalls?.map(call => call.tool) ?? [];
    write(`\nTrace: ${tools.length ? tools.join(', ') : '(no tool calls)'}\n`);
  }

  write('\n');
  return { state, exit: false };
}

function parseCommand(line: string): { name: string; args: string[] } {
  const [name, ...args] = line.slice(1).trim().split(/\s+/);
  return { name: (name || '').toLowerCase(), args };
}

function helpText() {
  return `
Commands:
  /help                 Show this help
  /state                Show current state snapshot
  /session              Show session and mode info
  /style <name>         Set narrator style (lyric|cinematic|michener)
  /trace [on|off]       Toggle trace printing (default toggles)
  /new [sessionId]      Start or resume a session
  /exit                 Exit CLI
`;
}

function parseToggle(token: string | undefined, fallback: boolean): boolean {
  if (!token) return fallback;
  if (token === 'on' || token === 'true' || token === '1') return true;
  if (token === 'off' || token === 'false' || token === '0') return false;
  return fallback;
}

function isNarratorStyle(value: string | undefined): value is NarratorStyle {
  return value === 'lyric' || value === 'cinematic' || value === 'michener';
}

export function formatTelemetry(telemetry: RunTurnOutput['telemetry']): string {
  const inventory = telemetry.player.inventory.map(item => item.name).join(', ') || '(empty)';
  return `
Location: ${telemetry.location.name}
Position: (${telemetry.player.pos.x}, ${telemetry.player.pos.y}${telemetry.player.pos.z != null ? `, ${telemetry.player.pos.z}` : ''})
Time: Day ${telemetry.time.currentDay}, Hour ${telemetry.time.currentHour}
Weather: ${telemetry.weather.type}, wind ${telemetry.weather.windKph}kph
Inventory: ${inventory}
Turn: ${telemetry.turn}
`.trimEnd();
}

async function initWithFallback(engine: CliEngine, sessionId: string | undefined, apiKey: string | undefined) {
  if (!apiKey) {
    return { result: await engine.initSession({ sessionId }), usedFallback: false };
  }
  try {
    return { result: await engine.initSession({ sessionId, apiKey }), usedFallback: false };
  } catch (error) {
    if (!isRecoverableLLMError(error)) throw error;
    return { result: await engine.initSession({ sessionId }), usedFallback: true };
  }
}

async function runTurnWithFallback(engine: CliEngine, state: CliState, playerText: string) {
  const payload = {
    sessionId: state.sessionId,
    playerId: state.playerId,
    playerText,
    narratorStyle: state.narratorStyle,
    debug: state.includeTrace ? { includeTrace: true } : undefined,
  };

  if (!state.apiKey) {
    return { result: await engine.runTurn(payload), usedFallback: false };
  }

  try {
    return { result: await engine.runTurn({ ...payload, apiKey: state.apiKey }), usedFallback: false };
  } catch (error) {
    if (!isRecoverableLLMError(error)) throw error;
    return { result: await engine.runTurn(payload), usedFallback: true };
  }
}

function isRecoverableLLMError(error: unknown): boolean {
  if (isChronicleError(error)) return false;
  if (!error || typeof error !== 'object') return false;
  const maybe = error as { status?: unknown; code?: unknown; type?: unknown; name?: unknown };
  if (maybe.code === 'insufficient_quota') return true;
  if (maybe.type === 'insufficient_quota') return true;
  if (typeof maybe.status === 'number' && [401, 402, 403, 429, 500, 502, 503, 504].includes(maybe.status)) return true;
  if (typeof maybe.name === 'string' && maybe.name.endsWith('Error') && typeof maybe.status === 'number') return true;
  return false;
}

function formatError(error: unknown): string {
  if (isChronicleError(error)) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}
