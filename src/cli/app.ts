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
export type CliApiMode = 'auto' | 'fallback' | 'live';

export interface CliState {
  sessionId: string;
  playerId: string;
  narratorStyle: NarratorStyle;
  apiKey?: string;
  debugEnabled: boolean;
  debugDetail: DebugDetail;
  apiMode: CliApiMode;
}

export interface CliEngine {
  initSession(params: {
    sessionId?: string;
    apiKey?: string;
    debug?: { onEvent?: DebugSink };
    stream?: {
      onOpeningStart?: (telemetry: InitResult['telemetry']) => void;
      onOpeningDelta?: (delta: string) => void;
    };
  }): Promise<InitResult>;
  getTelemetry(sessionId: string, playerId: string): Promise<RunTurnOutput['telemetry']>;
  runTurn(input: {
    sessionId: string;
    playerId: string;
    playerText: string;
    apiKey?: string;
    narratorStyle?: NarratorStyle;
    debug?: { includeTrace?: boolean; onEvent?: DebugSink };
    stream?: {
      onNarrationStart?: (telemetry: RunTurnOutput['telemetry']) => void;
      onNarrationDelta?: (delta: string) => void;
    };
  }): Promise<RunTurnOutput>;
}

export interface CliTerminal {
  isTTY(): boolean;
  write(text: string): void;
  readLine(prompt: string): Promise<string | null>;
  close(): void;
}

export interface CliTranscriptEvent {
  type: 'prompt' | 'input' | 'output';
  text: string;
}

export interface CliOptions {
  engine: CliEngine;
  terminal: CliTerminal;
  sessionId?: string;
  narratorStyle?: NarratorStyle;
  debugEnabled?: boolean;
  debugDetail?: DebugDetail;
  apiMode?: CliApiMode;
  allowNonTty?: boolean;
  env?: NodeJS.ProcessEnv;
  transcript?: (event: CliTranscriptEvent) => void;
}

export interface CliStepResult {
  state: CliState;
  exit: boolean;
}

export interface CliRunResult {
  exitCode: number;
  finalState?: CliState;
}

export function resolveApiKey(env: NodeJS.ProcessEnv): string | undefined {
  return env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY || undefined;
}

export function resolveCliApiMode(raw: string | undefined): CliApiMode {
  if (!raw) return 'auto';
  const normalized = raw.toLowerCase();
  if (normalized === 'auto' || normalized === 'fallback' || normalized === 'live') return normalized;
  throw new Error('CHRONICLE_API_MODE must be one of auto|fallback|live');
}

export async function runCli(options: CliOptions): Promise<CliRunResult> {
  const {
    engine,
    terminal,
    sessionId,
    transcript,
    env = process.env,
    narratorStyle = 'michener',
    debugEnabled = true,
    debugDetail = 'summary',
    apiMode = 'auto',
    allowNonTty = false,
  } = options;
  let finalState: CliState | undefined;
  let shouldPrintGoodbye = false;

  const write = (text: string) => {
    transcript?.({ type: 'output', text });
    terminal.write(text);
  };

  const readLine = async (prompt: string) => {
    transcript?.({ type: 'prompt', text: prompt });
    const line = await terminal.readLine(prompt);
    if (line != null) {
      transcript?.({ type: 'input', text: line });
    }
    return line;
  };

  try {
    if (!allowNonTty && !terminal.isTTY()) {
      write('Error: CLI requires an interactive terminal.\n');
      return { exitCode: 1 };
    }

    shouldPrintGoodbye = true;
    write('\n=== Chronicle vNext - Isle of Marrow ===\n\n');

    const resolvedApiKey = resolveStartupApiKey(apiMode, env);
    finalState = await initCliSession({
      engine,
      sessionId,
      apiKey: resolvedApiKey,
      narratorStyle,
      debugEnabled,
      debugDetail,
      apiMode,
      write,
    });

    write('Type /help for commands, or enter your action.\n\n');

    while (true) {
      const line = await readLine('> ');
      if (line == null) {
        return { exitCode: 0, finalState };
      }
      const step = await handleCliLine({
        state: finalState,
        line: line.trim(),
        engine,
        write,
      });
      finalState = step.state;
      if (step.exit) {
        return { exitCode: 0, finalState };
      }
    }
  } catch (error) {
    write(`${formatError(error)}\n`);
    return { exitCode: 1, finalState };
  } finally {
    if (shouldPrintGoodbye) {
      write('Goodbye!\n');
    }
    terminal.close();
  }
}

export async function startCli(
  engine: TurnEngine,
  options: Omit<CliOptions, 'engine' | 'terminal'> = {},
): Promise<CliRunResult> {
  const terminal = createReadlineTerminal();
  return runCli({ ...options, engine, terminal });
}

export async function initCliSession(params: {
  engine: CliEngine;
  sessionId?: string;
  apiKey?: string;
  narratorStyle: NarratorStyle;
  debugEnabled: boolean;
  debugDetail: DebugDetail;
  apiMode: CliApiMode;
  write: (text: string) => void;
}): Promise<CliState> {
  const { engine, sessionId, apiKey, narratorStyle, debugEnabled, debugDetail, apiMode, write } = params;
  const debugSink = debugEnabled ? createDebugWriter(write, debugDetail) : undefined;
  const openingChunks: string[] = [];
  let openingStreamed = false;
  let openingPrefixWritten = false;

  const { result, usedFallback } = await initWithFallback(
    engine,
    sessionId,
    apiKey,
    apiMode,
    telemetry => {
      if (debugEnabled || openingPrefixWritten) return;
      write(`${formatNarrationTimestamp(telemetry)} `);
      openingPrefixWritten = true;
    },
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

  if (apiMode === 'fallback') {
    write('(Fallback mode - deterministic runtime)\n\n');
  } else if (!apiKey) {
    write('(No API key - running in deterministic fallback mode)\n\n');
  } else if (usedFallback) {
    write('(API unavailable - switched to deterministic fallback mode)\n\n');
  }

  if (debugEnabled) {
    const openingText = openingChunks.join('') || result.opening;
    write(`Opening:\n${prefixNarration(openingText, result.telemetry)}\n\n`);
  } else if (openingStreamed) {
    write('\n\n');
  } else {
    write(`${prefixNarration(result.opening, result.telemetry)}\n\n`);
  }

  return {
    sessionId: result.sessionId,
    playerId: 'player-1',
    narratorStyle,
    apiKey: usedFallback ? undefined : apiKey,
    debugEnabled,
    debugDetail,
    apiMode: usedFallback ? 'fallback' : apiMode,
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
          apiMode: state.apiMode,
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
  let narrationPrefixWritten = false;
  const turn = await runTurnWithFallback(
    engine,
    state,
    line,
    telemetry => {
      if (state.debugEnabled || narrationPrefixWritten) return;
      write(`\n${formatNarrationTimestamp(telemetry)} `);
      narrationPrefixWritten = true;
    },
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
    state = { ...state, apiKey: undefined, apiMode: 'fallback' };
    write('\n(API request failed - switched to deterministic fallback mode)\n');
  }

  state = { ...state, sessionId: turn.result.sessionId };
  if (state.debugEnabled) {
    const narration = narrationChunks.join('') || turn.result.narration;
    write(`\nNarration:\n${prefixNarration(narration, turn.result.telemetry)}\n\n`);
  } else if (narrationStreamed) {
    write('\n\n');
  } else {
    write(`\n${prefixNarration(turn.result.narration, turn.result.telemetry)}\n\n`);
  }

  return { state, exit: false };
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
    close: () => {
      rl.close();
    },
  };
}

function resolveStartupApiKey(apiMode: CliApiMode, env: NodeJS.ProcessEnv): string | undefined {
  if (apiMode === 'fallback') return undefined;
  const apiKey = resolveApiKey(env);
  if (apiMode === 'live' && !apiKey) {
    throw new Error('Live mode requires OPENAI_API_KEY or VITE_OPENAI_API_KEY');
  }
  return apiKey;
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

function formatNarrationTimestamp(telemetry: InitResult['telemetry'] | RunTurnOutput['telemetry']): string {
  const absolute = new Date(telemetry.time.absoluteIso);
  const hours = String(absolute.getUTCHours()).padStart(2, '0');
  const minutes = String(absolute.getUTCMinutes()).padStart(2, '0');
  return `[Day ${telemetry.time.currentDay}, ${hours}:${minutes}]`;
}

function prefixNarration(text: string, telemetry: InitResult['telemetry'] | RunTurnOutput['telemetry']): string {
  const body = text.trim();
  return body ? `${formatNarrationTimestamp(telemetry)} ${body}` : formatNarrationTimestamp(telemetry);
}

function createDebugWriter(write: (text: string) => void, detail: DebugDetail): DebugSink {
  return event => {
    write(renderDebugEvent(event, detail));
  };
}

export function renderDebugEvent(event: DebugEvent, detail: DebugDetail): string {
  const summary = detail === 'raw' ? renderRawDebugSummary(event) : renderDebugSummary(event);
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
      return `[gm] iteration ${event.iteration} planned ${event.toolCallCount} tool call${event.toolCallCount === 1 ? '' : 's'}: ${formatToolCallNames(event.toolCallNames)}`;
    case 'tool.called':
      return `[tool] ${event.callIndex}/${event.callCount} ${event.tool} call=${event.callId} ${summarizeToolInput(event.tool, event.input)}`.trimEnd();
    case 'tool.result':
      return `[tool] ${event.callIndex}/${event.callCount} result ${event.tool} call=${event.callId} ${summarizeToolOutput(event.tool, event.output)}`.trimEnd();
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

function renderRawDebugSummary(event: DebugEvent): string {
  if (event.type === 'narrator.completed') {
    return `[narrator] ${event.phase === 'opening' ? 'opening complete' : 'rendering complete'}`;
  }
  return renderDebugSummary(event);
}

function extractDebugPayload(event: DebugEvent): unknown {
  switch (event.type) {
    case 'gm.response.received':
      return {
        responseId: event.responseId,
        status: event.status,
        toolCalls: event.toolCalls,
        toolCallCount: event.toolCallCount,
        toolCallNames: event.toolCallNames,
        error: event.error,
      };
    case 'tool.called':
      return {
        iteration: event.iteration,
        tool: event.tool,
        callId: event.callId,
        callIndex: event.callIndex,
        callCount: event.callCount,
        input: event.input,
      };
    case 'tool.result':
      return {
        iteration: event.iteration,
        tool: event.tool,
        callId: event.callId,
        callIndex: event.callIndex,
        callCount: event.callCount,
        ok: event.ok,
        output: event.output,
      };
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
  if (tool === 'consult_specialist' && typeof record.specialistType === 'string') {
    const focus = typeof record.focus === 'string' && record.focus.trim()
      ? ` focus=${JSON.stringify(record.focus)}`
      : '';
    return `specialist=${record.specialistType}${focus}`;
  }
  if (tool === 'propose_events' && Array.isArray(record.events)) {
    return `events=${record.events.length}`;
  }
  if (tool === 'finish_turn') {
    const parts: string[] = [];
    const pending = record.playerPrompt && typeof record.playerPrompt === 'object'
      ? (record.playerPrompt as Record<string, unknown>).pending
      : undefined;
    if (pending && typeof pending === 'object') {
      const kind = typeof (pending as Record<string, unknown>).kind === 'string'
        ? String((pending as Record<string, unknown>).kind)
        : 'pending';
      parts.push(`pending=${kind}`);
    }
    if (record.playerPrompt && typeof record.playerPrompt === 'object' && (record.playerPrompt as Record<string, unknown>).clear === true) {
      parts.push('clear_prompt=true');
    }
    if (record.agendaUpdates && typeof record.agendaUpdates === 'object') {
      parts.push('agenda_updates=true');
    }
    return parts.join(' ');
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
  if (tool === 'finish_turn') {
    if (typeof record.ok === 'boolean') {
      return record.ok ? 'ok' : 'failed';
    }
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

function formatToolCallNames(names: string[]): string {
  return names.length ? names.join(', ') : 'none';
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
  apiMode: CliApiMode,
  onOpeningStart?: (telemetry: InitResult['telemetry']) => void,
  onOpeningDelta?: (delta: string) => void,
  onDebugEvent?: DebugSink,
) {
  if (apiMode === 'fallback' || !apiKey) {
    return {
      result: await engine.initSession({
        sessionId,
        debug: onDebugEvent ? { onEvent: onDebugEvent } : undefined,
        stream: onOpeningStart || onOpeningDelta ? { onOpeningStart, onOpeningDelta } : undefined,
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
        stream: onOpeningStart || onOpeningDelta ? { onOpeningStart, onOpeningDelta } : undefined,
      }),
      usedFallback: false,
    };
  } catch (error) {
    if (apiMode !== 'auto' || !isRecoverableLLMError(error)) throw error;
    return {
      result: await engine.initSession({
        sessionId,
        debug: onDebugEvent ? { onEvent: onDebugEvent } : undefined,
        stream: onOpeningStart || onOpeningDelta ? { onOpeningStart, onOpeningDelta } : undefined,
      }),
      usedFallback: true,
    };
  }
}

async function runTurnWithFallback(
  engine: CliEngine,
  state: CliState,
  playerText: string,
  onNarrationStart?: (telemetry: RunTurnOutput['telemetry']) => void,
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
    stream: onNarrationStart || onNarrationDelta ? { onNarrationStart, onNarrationDelta } : undefined,
  };

  if (state.apiMode === 'fallback' || !state.apiKey) {
    return { result: await engine.runTurn(payload), usedFallback: false };
  }

  try {
    return { result: await engine.runTurn({ ...payload, apiKey: state.apiKey }), usedFallback: false };
  } catch (error) {
    if (state.apiMode !== 'auto' || !isRecoverableLLMError(error)) throw error;
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
