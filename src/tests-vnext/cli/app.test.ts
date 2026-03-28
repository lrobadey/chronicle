import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CliEngine, CliState, CliTranscriptEvent } from '../../cli/app';
import { handleCliLine, initCliSession, resolveApiKey, resolveCliApiMode, runCli } from '../../cli/app';
import type { DebugSink } from '../../engine/debug';
import { ScriptedTerminal } from './scriptedTerminal';

class StubCliEngine implements CliEngine {
  readonly initCalls: Array<{
    sessionId?: string;
    apiKey?: string;
    debugEnabled?: boolean;
    stream?: {
      onOpeningStart?: (telemetry: Awaited<ReturnType<StubCliEngine['getTelemetry']>>) => void;
      onOpeningDelta?: (delta: string) => void;
    };
  }> = [];
  readonly turnCalls: Array<{ apiKey?: string; playerText: string; includeTrace?: boolean; debugEnabled?: boolean }> = [];
  initCounter = 0;

  async initSession(params: {
    sessionId?: string;
    apiKey?: string;
    debug?: { onEvent?: DebugSink };
    stream?: {
      onOpeningStart?: (telemetry: Awaited<ReturnType<StubCliEngine['getTelemetry']>>) => void;
      onOpeningDelta?: (delta: string) => void;
    };
  }) {
    this.initCalls.push({
      sessionId: params.sessionId,
      apiKey: params.apiKey,
      debugEnabled: Boolean(params.debug?.onEvent),
      stream: params.stream,
    });
    if (params.apiKey === 'bad-key') {
      throw { status: 429, code: 'insufficient_quota', name: 'RateLimitError' };
    }
    this.initCounter += 1;
    const opening = `opening-${params.sessionId || `session-${this.initCounter}`}`;
    params.debug?.onEvent?.({ type: 'init.started', sessionId: params.sessionId });
    params.debug?.onEvent?.({
      type: 'init.session_ready',
      sessionId: params.sessionId || `session-${this.initCounter}`,
      created: true,
    });
    params.debug?.onEvent?.({ type: 'narrator.started', phase: 'opening', style: 'cinematic' });
    const telemetry = await this.getTelemetry(params.sessionId || `session-${this.initCounter}`, 'player-1');
    params.stream?.onOpeningStart?.(telemetry);
    params.stream?.onOpeningDelta?.(opening);
    params.debug?.onEvent?.({ type: 'narrator.completed', phase: 'opening', text: opening });
    return {
      sessionId: params.sessionId || `session-${this.initCounter}`,
      created: true,
      telemetry,
      opening,
    };
  }

  async getTelemetry(_sessionId: string, _playerId: string) {
    return {
      turn: 0,
      player: { id: 'player-1', name: 'You', pos: { x: 0, y: 0 }, inventory: [] },
      location: { id: 'the-landing', name: 'The Landing', description: 'desc' },
      nearbyLocations: [],
      nearbyActors: [],
      time: { elapsedMinutes: 0, currentHour: 14, currentDay: 1, timeOfDay: 'afternoon' as const, absoluteIso: '1825-05-14T14:00:00.000Z' },
      tide: { phase: 'rising' as const, level: 0.5, minutesUntilChange: 180, blockedLocationIds: ['the-maw'] },
      weather: {
        type: 'clear' as const,
        intensity: 1,
        temperatureC: 20,
        windKph: 12,
        pressure: { system: 'high' as const, hPa: 1035, trend: 'rising' as const },
        signals: [],
      },
      ledgerTail: ['init'],
      knowledge: { seenLocations: ['the-landing'], seenActors: ['player-1'], seenItems: [] },
    };
  }

  async runTurn(input: {
    sessionId: string;
    playerId: string;
    playerText: string;
    apiKey?: string;
    narratorStyle?: 'lyric' | 'cinematic' | 'michener';
    debug?: { includeTrace?: boolean; onEvent?: DebugSink };
    stream?: {
      onNarrationStart?: (telemetry: Awaited<ReturnType<StubCliEngine['getTelemetry']>>) => void;
      onNarrationDelta?: (delta: string) => void;
    };
  }) {
    this.turnCalls.push({
      apiKey: input.apiKey,
      playerText: input.playerText,
      includeTrace: input.debug?.includeTrace,
      debugEnabled: Boolean(input.debug?.onEvent),
    });
    if (input.apiKey === 'bad-key') {
      throw { status: 429, code: 'insufficient_quota', name: 'RateLimitError' };
    }
    const narration = `narration-${input.playerText}`;
    input.debug?.onEvent?.({ type: 'turn.started', sessionId: input.sessionId, turn: 1, playerText: input.playerText });
    input.debug?.onEvent?.({ type: 'gm.iteration.started', iteration: 1 });
    input.debug?.onEvent?.({ type: 'tool.called', tool: 'observe_world', input: { perspective: 'player' } });
    input.debug?.onEvent?.({ type: 'tool.result', tool: 'observe_world', output: { ok: true } });
    input.debug?.onEvent?.({ type: 'narrator.started', phase: 'turn', style: input.narratorStyle });
    const telemetry = await this.getTelemetry(input.sessionId, input.playerId);
    input.stream?.onNarrationStart?.(telemetry);
    input.stream?.onNarrationDelta?.(narration);
    input.debug?.onEvent?.({ type: 'narrator.completed', phase: 'turn', text: narration });
    input.debug?.onEvent?.({ type: 'turn.persisted', sessionId: input.sessionId, turn: 1 });
    return {
      sessionId: input.sessionId,
      turn: 1,
      acceptedEvents: [],
      rejectedEvents: [],
      telemetry,
      narration,
      trace: input.debug?.includeTrace
        ? { toolCalls: [{ tool: 'observe_world', input: { perspective: 'player' }, output: { ok: true } }] }
        : undefined,
    };
  }
}

function baseState(overrides: Partial<CliState> = {}): CliState {
  return {
    sessionId: 'session-1',
    playerId: 'player-1',
    narratorStyle: 'michener',
    apiKey: 'test-key',
    debugEnabled: true,
    debugDetail: 'summary',
    apiMode: 'auto',
    ...overrides,
  };
}

describe('CLI app', () => {
  it('resolves API key with OPENAI_API_KEY precedence', () => {
    const key = resolveApiKey({ OPENAI_API_KEY: 'primary', VITE_OPENAI_API_KEY: 'secondary' });
    assert.equal(key, 'primary');
  });

  it('parses CLI api mode and rejects invalid values', () => {
    assert.equal(resolveCliApiMode(undefined), 'auto');
    assert.equal(resolveCliApiMode('fallback'), 'fallback');
    assert.equal(resolveCliApiMode('LIVE'), 'live');
    assert.throws(() => resolveCliApiMode('weird'));
  });

  it('falls back to deterministic mode when init LLM call fails in auto mode', async () => {
    const engine = new StubCliEngine();
    const writes: string[] = [];
    const state = await initCliSession({
      engine,
      sessionId: undefined,
      apiKey: 'bad-key',
      narratorStyle: 'michener',
      debugEnabled: true,
      debugDetail: 'summary',
      apiMode: 'auto',
      write: text => writes.push(text),
    });

    assert.equal(state.apiKey, undefined);
    assert.equal(state.apiMode, 'fallback');
    assert.equal(engine.initCalls.length, 2);
    assert.equal(engine.initCalls[0]?.apiKey, 'bad-key');
    assert.equal(engine.initCalls[1]?.apiKey, undefined);
    assert.ok(writes.join('').includes('switched to deterministic fallback mode'));
    assert.ok(writes.join('').includes('[init] starting'));
    assert.ok(writes.join('').includes('Opening:\n[Day 1, 14:00] opening-session-1'));
  });

  it('defaults to debug-first output and buffers narration after live steps', async () => {
    const engine = new StubCliEngine();
    const writes: string[] = [];
    let state = baseState({ apiKey: 'bad-key' });

    ({ state } = await handleCliLine({ state, line: '/style lyric', engine, write: text => writes.push(text) }));
    assert.equal(state.narratorStyle, 'lyric');

    ({ state } = await handleCliLine({ state, line: 'look around', engine, write: text => writes.push(text) }));
    assert.equal(state.apiKey, undefined);
    assert.equal(state.apiMode, 'fallback');
    assert.equal(engine.turnCalls.length, 2);
    assert.equal(engine.turnCalls[0]?.apiKey, 'bad-key');
    assert.equal(engine.turnCalls[1]?.apiKey, undefined);
    assert.equal(engine.turnCalls[1]?.includeTrace, true);
    assert.equal(engine.turnCalls[1]?.debugEnabled, true);
    const output = writes.join('');
    assert.ok(output.includes('[turn] #1 "look around"'));
    assert.ok(output.includes('[tool] observe_world perspective=player'));
    assert.ok(output.includes('Narration:\n[Day 1, 14:00] narration-look around'));
    assert.ok(output.indexOf('[tool] observe_world perspective=player') < output.indexOf('Narration:\n[Day 1, 14:00] narration-look around'));
  });

  it('streams timestamped narration once when debug is off', async () => {
    const engine = new StubCliEngine();
    const writes: string[] = [];
    const state = baseState({ debugEnabled: false });

    await handleCliLine({ state, line: 'look around', engine, write: text => writes.push(text) });

    const output = writes.join('');
    assert.ok(output.includes('\n[Day 1, 14:00] narration-look around\n\n'));
    assert.equal(output.match(/\[Day 1, 14:00\]/g)?.length, 1);
  });

  it('supports debug toggles, raw detail, and /trace alias', async () => {
    const engine = new StubCliEngine();
    const writes: string[] = [];
    let state = baseState();

    ({ state } = await handleCliLine({ state, line: '/trace off', engine, write: text => writes.push(text) }));
    assert.equal(state.debugEnabled, false);

    ({ state } = await handleCliLine({ state, line: '/debug on', engine, write: text => writes.push(text) }));
    assert.equal(state.debugEnabled, true);

    ({ state } = await handleCliLine({ state, line: '/detail raw', engine, write: text => writes.push(text) }));
    assert.equal(state.debugDetail, 'raw');

    ({ state } = await handleCliLine({ state, line: '/session', engine, write: text => writes.push(text) }));
    const output = writes.join('');
    assert.ok(output.includes('Debug mode: on'));
    assert.ok(output.includes('Debug detail: raw'));
  });

  it('runs a scripted session through startup, commands, and clean exit', async () => {
    const engine = new StubCliEngine();
    const terminal = new ScriptedTerminal(['/help', '/state', '/session', '/exit']);
    const result = await runCli({
      engine,
      terminal,
      apiMode: 'fallback',
      env: { OPENAI_API_KEY: 'live-key' },
    });

    assert.equal(result.exitCode, 0);
    assert.ok(result.finalState);
    assert.equal(result.finalState?.apiKey, undefined);
    assert.equal(engine.initCalls.length, 1);
    assert.equal(engine.initCalls[0]?.apiKey, undefined);
    assert.deepEqual(terminal.prompts, ['> ', '> ', '> ', '> ']);
    const output = terminal.output();
    assert.ok(output.includes('=== Chronicle vNext - Isle of Marrow ==='));
    assert.ok(output.includes('(Fallback mode - deterministic runtime)'));
    assert.ok(output.includes('Opening:\n[Day 1, 14:00] opening-session-1'));
    assert.ok(output.includes('Commands:'));
    assert.ok(output.includes('Location: The Landing'));
    assert.ok(output.includes('Session: session-1'));
    assert.ok(output.includes('Goodbye!'));
    assert.equal(terminal.closed, true);
  });

  it('treats EOF as a normal exit path', async () => {
    const engine = new StubCliEngine();
    const terminal = new ScriptedTerminal([]);
    const result = await runCli({
      engine,
      terminal,
      apiMode: 'fallback',
    });

    assert.equal(result.exitCode, 0);
    assert.equal(terminal.closed, true);
    assert.ok(terminal.output().includes('Goodbye!'));
  });

  it('rejects non-tty terminals by default', async () => {
    const engine = new StubCliEngine();
    const terminal = new ScriptedTerminal([], false);
    const result = await runCli({
      engine,
      terminal,
      apiMode: 'fallback',
    });

    assert.equal(result.exitCode, 1);
    assert.equal(engine.initCalls.length, 0);
    assert.equal(terminal.output(), 'Error: CLI requires an interactive terminal.\n');
    assert.equal(terminal.closed, true);
  });

  it('allows non-tty harness runs and records transcript ordering', async () => {
    const engine = new StubCliEngine();
    const terminal = new ScriptedTerminal(['/help', '/exit'], false);
    const transcript: CliTranscriptEvent[] = [];
    const result = await runCli({
      engine,
      terminal,
      apiMode: 'fallback',
      allowNonTty: true,
      env: { OPENAI_API_KEY: 'live-key' },
      transcript: event => transcript.push(event),
    });

    assert.equal(result.exitCode, 0);
    assert.equal(engine.initCalls[0]?.apiKey, undefined);
    const promptIndex = transcript.findIndex(event => event.type === 'prompt');
    const helpInputIndex = transcript.findIndex(event => event.type === 'input' && event.text === '/help');
    const helpOutputIndex = transcript.findIndex(event => event.type === 'output' && event.text.includes('Commands:'));
    const exitInputIndex = transcript.findIndex(event => event.type === 'input' && event.text === '/exit');
    assert.ok(promptIndex >= 0);
    assert.ok(helpInputIndex > promptIndex);
    assert.ok(helpOutputIndex > helpInputIndex);
    assert.ok(exitInputIndex > helpOutputIndex);
  });

  it('fails fast in live mode when no API key is available', async () => {
    const engine = new StubCliEngine();
    const terminal = new ScriptedTerminal([]);
    const result = await runCli({
      engine,
      terminal,
      apiMode: 'live',
      env: {},
    });

    assert.equal(result.exitCode, 1);
    assert.equal(engine.initCalls.length, 0);
    const output = terminal.output();
    assert.ok(output.includes('Live mode requires OPENAI_API_KEY or VITE_OPENAI_API_KEY'));
    assert.ok(output.includes('Goodbye!'));
  });

  it('passes through the discovered API key in auto mode', async () => {
    const engine = new StubCliEngine();
    const terminal = new ScriptedTerminal(['/exit']);
    const result = await runCli({
      engine,
      terminal,
      apiMode: 'auto',
      env: { OPENAI_API_KEY: 'live-key' },
    });

    assert.equal(result.exitCode, 0);
    assert.equal(engine.initCalls.length, 1);
    assert.equal(engine.initCalls[0]?.apiKey, 'live-key');
  });
});
