import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { TurnEngine } from '../engine/turnEngine';
import type { InitResult, RunTurnOutput } from '../engine/turnEngine';
import type { DebugEvent, DebugSink } from '../engine/debug';
import { isChronicleError } from '../engine/errors';
import type { NarratorStyle } from '../agents/narrator/narratorAgent';
import type { WorldEvent } from '../sim/events';

export type DebugDetail = 'summary' | 'raw';

export interface CliState {
  sessionId: string;
  playerId: string;
  narratorStyle: NarratorStyle;
  apiKey?: string;
  debugEnabled: boolean;
  debugDetail: DebugDetail;
}

export interface CliEngine {
  initSession(params: {
    sessionId?: string;
    apiKey?: string;
    debug?: { onEvent?: DebugSink };
    stream?: { onOpeningDelta?: (delta: string) => void };
  }): Promise<InitResult>;
  getTelemetry(sessionId: string, playerId: string): Promise<RunTurnOutput['telemetry']>;
  runTurn(input: {
    sessionId: string;
    playerId: string;
    playerText: string;
    apiKey?: string;
    narratorStyle?: NarratorStyle;
    debug?: { includeTrace?: boolean; onEvent?: DebugSink };
    stream?: { onNarrationDelta?: (delta: string) => void };
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
      debugEnabled: true,
      debugDetail: 'summary',
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
  debugEnabled: boolean;
  debugDetail: DebugDetail;
  write: (text: string) => void;
}): Promise<CliState> {
  const { engine, sessionId, apiKey, narratorStyle, debugEnabled, debugDetail, write } = params;
  const debugSink = debugEnabled ? createDebugWriter(write, debugDetail) : undefined;
  const openingChunks: string[] = [];
  let openingStreamed = false;

  const { result, usedFallback } = await initWithFallback(
    engine,
    sessionId,
    apiKey,
    delta => {
      if (debugEnabled) {
        openingChunks.push(delta);
        return;
      }
      openingStreamed = true;
      write(delta);
    },
    debugSink,
  );

  if (!apiKey) {
    write('(No API key - running in deterministic fallback mode)\n\n');
  } else if (usedFallback) {
    write('(API unavailable - switched to deterministic fallback mode)\n\n');
  }

  if (debugEnabled) {
    const openingText = openingChunks.join('') || result.opening;
    write(`Opening:\n${openingText}\n\n`);
  } else if (openingStreamed) {
    write('\n\n');
  } else {
    write(`${result.opening}\n\n`);
  }

  return {
    sessionId: result.sessionId,
    playerId: 'player-1',
    narratorStyle,
    apiKey: usedFallback ? undefined : apiKey,
    debugEnabled,
    debugDetail,
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
        write(`Debug mode: ${state.debugEnabled ? 'on' : 'off'}\n`);
        write(`Debug detail: ${state.debugDetail}\n`);
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
      case 'trace':
      case 'debug': {
        const token = parsed.args[0]?.toLowerCase();
        const nextValue = parseToggle(token, !state.debugEnabled);
        state = { ...state, debugEnabled: nextValue };
        write(`\nDebug mode: ${state.debugEnabled ? 'on' : 'off'}\n\n`);
        return { state, exit: false };
      }
      case 'detail': {
        const next = parsed.args[0]?.toLowerCase();
        if (!isDebugDetail(next)) {
          write('\nUsage: /detail <summary|raw>\n\n');
          return { state, exit: false };
        }
        state = { ...state, debugDetail: next };
        write(`\nDebug detail: ${next}\n\n`);
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
          debugEnabled: state.debugEnabled,
          debugDetail: state.debugDetail,
        });
        return { state, exit: false };
      }
      default:
        write(`\nUnknown command: ${line}\nType /help for available commands.\n\n`);
        return { state, exit: false };
    }
  }

  const narrationChunks: string[] = [];
  const debugSink = state.debugEnabled ? createDebugWriter(write, state.debugDetail) : undefined;
  let narrationStreamed = false;
  const turn = await runTurnWithFallback(
    engine,
    state,
    line,
    delta => {
      if (state.debugEnabled) {
        narrationChunks.push(delta);
        return;
      }
      narrationStreamed = true;
      write(delta);
    },
    debugSink,
  );
  if (turn.usedFallback) {
    state = { ...state, apiKey: undefined };
    write('\n(API request failed - switched to deterministic fallback mode)\n');
  }

  state = { ...state, sessionId: turn.result.sessionId };
  if (state.debugEnabled) {
    const narration = narrationChunks.join('') || turn.result.narration;
    write(`\nNarration:\n${narration}\n\n`);
  } else if (narrationStreamed) {
    write('\n\n');
  } else {
    write(`\n${turn.result.narration}\n\n`);
  }

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
  /debug [on|off]       Toggle live debug timeline (default toggles)
  /trace [on|off]       Alias for /debug
  /detail <mode>        Set debug detail (summary|raw)
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

function isDebugDetail(value: string | undefined): value is DebugDetail {
  return value === 'summary' || value === 'raw';
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

function createDebugWriter(write: (text: string) => void, detail: DebugDetail): DebugSink {
  return event => {
    write(renderDebugEvent(event, detail));
  };
}

export function renderDebugEvent(event: DebugEvent, detail: DebugDetail): string {
  const summary = renderDebugSummary(event);
  if (!summary) return '';
  if (detail === 'summary') return `${summary}\n`;

  const payload = extractDebugPayload(event);
  if (payload == null) return `${summary}\n`;
  return `${summary}\n${formatRawPayload(payload)}\n`;
}

function renderDebugSummary(event: DebugEvent): string {
  switch (event.type) {
    case 'init.started':
      return '[init] starting';
    case 'init.session_ready':
      return `[init] session ${event.sessionId} ${event.created ? 'created' : 'resumed'}`;
    case 'turn.started':
      return `[turn] #${event.turn} ${JSON.stringify(event.playerText)}`;
    case 'gm.iteration.started':
      return `[gm] iteration ${event.iteration}`;
    case 'gm.response.received':
      return `[gm] iteration ${event.iteration} received ${event.toolCalls} tool call(s)`;
    case 'tool.called':
      return `[tool] ${event.tool} ${summarizeToolInput(event.tool, event.input)}`.trimEnd();
    case 'tool.result':
      return `[tool] result ${event.tool} ${summarizeToolOutput(event.tool, event.output)}`.trimEnd();
    case 'event.accepted':
      return `[event] accepted ${summarizeWorldEvent(event.event)}`;
    case 'event.rejected':
      return `[event] rejected ${summarizeWorldEvent(event.event)} reason=${event.reason}`;
    case 'event.rollback':
      return `[event] rollback ${event.events.length} event(s) reason=${event.reason}`;
    case 'npc.started':
      return `[npc] ${event.npcId} consulting`;
    case 'npc.completed':
      return `[npc] ${event.npcId} responded`;
    case 'narrator.started':
      return `[narrator] ${event.phase === 'opening' ? 'opening' : 'rendering'}`;
    case 'narrator.completed':
      return '';
    case 'turn.persisted':
      return `[persist] turn ${event.turn} saved`;
    case 'error':
      return `[error] ${event.stage} ${event.message}`;
    default:
      return '';
  }
}

function extractDebugPayload(event: DebugEvent): unknown {
  switch (event.type) {
    case 'gm.response.received':
      return {
        responseId: event.responseId,
        status: event.status,
        toolCalls: event.toolCalls,
        error: event.error,
      };
    case 'tool.called':
      return event.input;
    case 'tool.result':
      return event.output;
    case 'event.accepted':
      return event.event;
    case 'event.rejected':
      return { event: event.event, reason: event.reason };
    case 'event.rollback':
      return { events: event.events, reason: event.reason };
    case 'npc.completed':
      return event.output;
    case 'narrator.completed':
      return { phase: event.phase, text: event.text };
    case 'error':
      return { stage: event.stage, message: event.message };
    default:
      return null;
  }
}

function summarizeToolInput(tool: string, input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return '';
  const record = input as Record<string, unknown>;
  if (tool === 'observe_world' && typeof record.perspective === 'string') {
    return `perspective=${record.perspective}`;
  }
  if (tool === 'consult_npc' && typeof record.npcId === 'string') {
    return `npc=${record.npcId}`;
  }
  if (tool === 'propose_events' && Array.isArray(record.events)) {
    return `${record.events.length} event(s)`;
  }
  if (tool === 'finish_turn') {
    const pending = record.playerPrompt && typeof record.playerPrompt === 'object'
      ? (record.playerPrompt as Record<string, unknown>).pending
      : undefined;
    if (pending && typeof pending === 'object') {
      const kind = typeof (pending as Record<string, unknown>).kind === 'string'
        ? String((pending as Record<string, unknown>).kind)
        : 'pending';
      return `pending=${kind}`;
    }
    if (record.playerPrompt && typeof record.playerPrompt === 'object' && (record.playerPrompt as Record<string, unknown>).clear === true) {
      return 'clear_prompt=true';
    }
  }
  return '';
}

function summarizeToolOutput(tool: string, output: unknown): string {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return '';
  const record = output as Record<string, unknown>;
  if (typeof record.error === 'string') {
    return `error=${record.error}`;
  }
  if (tool === 'propose_events') {
    const accepted = typeof record.accepted === 'number' ? record.accepted : 0;
    const rejected = typeof record.rejected === 'number' ? record.rejected : 0;
    return `accepted=${accepted} rejected=${rejected}`;
  }
  if (typeof record.ok === 'boolean') {
    return record.ok ? 'ok' : 'failed';
  }
  return '';
}

function summarizeWorldEvent(event: WorldEvent): string {
  switch (event.type) {
    case 'MoveActor':
      return `MoveActor to=${formatGridPos(event.to)}`;
    case 'TravelToLocation':
      return `TravelToLocation location=${event.locationId}`;
    case 'PickUpItem':
      return `PickUpItem item=${event.itemId}`;
    case 'DropItem':
      return `DropItem item=${event.itemId}`;
    case 'Speak':
      return `Speak actor=${event.actorId}`;
    case 'AdvanceTime':
      return `AdvanceTime minutes=${event.minutes}`;
    case 'CreateEntity':
      return `CreateEntity kind=${event.entity.kind}`;
    case 'SetFlag':
      return `SetFlag key=${event.key}`;
    case 'Explore':
      return `Explore area=${event.area}`;
    case 'Inspect':
      return `Inspect subject=${event.subject}`;
  }
}

function formatGridPos(pos: { x: number; y: number; z?: number }) {
  return `(${pos.x},${pos.y},${pos.z ?? 0})`;
}

function formatRawPayload(value: unknown): string {
  const raw = safeJSONStringify(value);
  const truncated = raw.length > 2400 ? `${raw.slice(0, 2400)}\n... truncated` : raw;
  return `${indentBlock(truncated)}`;
}

function safeJSONStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return JSON.stringify({ error: 'non_serializable_payload' }, null, 2);
  }
}

function indentBlock(text: string): string {
  return text
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n');
}

async function initWithFallback(
  engine: CliEngine,
  sessionId: string | undefined,
  apiKey: string | undefined,
  onOpeningDelta?: (delta: string) => void,
  onDebugEvent?: DebugSink,
) {
  if (!apiKey) {
    return {
      result: await engine.initSession({
        sessionId,
        debug: onDebugEvent ? { onEvent: onDebugEvent } : undefined,
        stream: onOpeningDelta ? { onOpeningDelta } : undefined,
      }),
      usedFallback: false,
    };
  }
  try {
    return {
      result: await engine.initSession({
        sessionId,
        apiKey,
        debug: onDebugEvent ? { onEvent: onDebugEvent } : undefined,
        stream: onOpeningDelta ? { onOpeningDelta } : undefined,
      }),
      usedFallback: false,
    };
  } catch (error) {
    if (!isRecoverableLLMError(error)) throw error;
    return {
      result: await engine.initSession({
        sessionId,
        debug: onDebugEvent ? { onEvent: onDebugEvent } : undefined,
        stream: onOpeningDelta ? { onOpeningDelta } : undefined,
      }),
      usedFallback: true,
    };
  }
}

async function runTurnWithFallback(
  engine: CliEngine,
  state: CliState,
  playerText: string,
  onNarrationDelta?: (delta: string) => void,
  onDebugEvent?: DebugSink,
) {
  const payload = {
    sessionId: state.sessionId,
    playerId: state.playerId,
    playerText,
    narratorStyle: state.narratorStyle,
    debug: (state.debugEnabled || onDebugEvent)
      ? { includeTrace: state.debugEnabled, onEvent: onDebugEvent }
      : undefined,
    stream: onNarrationDelta ? { onNarrationDelta } : undefined,
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
