import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CliEngine, CliState } from '../../cli/app';
import { handleCliLine, initCliSession, resolveApiKey } from '../../cli/app';
import type { DebugSink } from '../../engine/debug';

class StubCliEngine implements CliEngine {
  readonly initCalls: Array<{
    sessionId?: string;
    apiKey?: string;
    debugEnabled?: boolean;
    stream?: { onOpeningDelta?: (delta: string) => void };
  }> = [];
  readonly turnCalls: Array<{ apiKey?: string; playerText: string; includeTrace?: boolean; debugEnabled?: boolean }> = [];
  initCounter = 0;

  async initSession(params: {
    sessionId?: string;
    apiKey?: string;
    debug?: { onEvent?: DebugSink };
    stream?: { onOpeningDelta?: (delta: string) => void };
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
    params.stream?.onOpeningDelta?.(opening);
    params.debug?.onEvent?.({ type: 'narrator.completed', phase: 'opening', text: opening });
    return {
      sessionId: params.sessionId || `session-${this.initCounter}`,
      created: true,
      telemetry: await this.getTelemetry(params.sessionId || `session-${this.initCounter}`, 'player-1'),
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
    stream?: { onNarrationDelta?: (delta: string) => void };
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
    input.stream?.onNarrationDelta?.(narration);
    input.debug?.onEvent?.({ type: 'narrator.completed', phase: 'turn', text: narration });
    input.debug?.onEvent?.({ type: 'turn.persisted', sessionId: input.sessionId, turn: 1 });
    return {
      sessionId: input.sessionId,
      turn: 1,
      acceptedEvents: [],
      rejectedEvents: [],
      telemetry: await this.getTelemetry(input.sessionId, input.playerId),
      narration,
      trace: input.debug?.includeTrace
        ? { toolCalls: [{ tool: 'observe_world', input: { perspective: 'player' }, output: { ok: true } }] }
        : undefined,
    };
  }
}

describe('CLI app', () => {
  it('resolves API key with OPENAI_API_KEY precedence', () => {
    const key = resolveApiKey({ OPENAI_API_KEY: 'primary', VITE_OPENAI_API_KEY: 'secondary' });
    assert.equal(key, 'primary');
  });

  it('falls back to deterministic mode when init LLM call fails', async () => {
    const engine = new StubCliEngine();
    const writes: string[] = [];
    const state = await initCliSession({
      engine,
      sessionId: undefined,
      apiKey: 'bad-key',
      narratorStyle: 'michener',
      debugEnabled: true,
      debugDetail: 'summary',
      write: text => writes.push(text),
    });

    assert.equal(state.apiKey, undefined);
    assert.equal(engine.initCalls.length, 2);
    assert.equal(engine.initCalls[0]?.apiKey, 'bad-key');
    assert.equal(engine.initCalls[1]?.apiKey, undefined);
    assert.ok(writes.join('').includes('switched to deterministic fallback mode'));
    assert.ok(writes.join('').includes('[init] starting'));
    assert.ok(writes.join('').includes('Opening:\nopening-session-1'));
  });

  it('defaults to debug-first output and buffers narration after live steps', async () => {
    const engine = new StubCliEngine();
    const writes: string[] = [];
    let state: CliState = {
      sessionId: 'session-1',
      playerId: 'player-1',
      narratorStyle: 'michener',
      apiKey: 'bad-key',
      debugEnabled: true,
      debugDetail: 'summary',
    };

    ({ state } = await handleCliLine({ state, line: '/style lyric', engine, write: text => writes.push(text) }));
    assert.equal(state.narratorStyle, 'lyric');

    ({ state } = await handleCliLine({ state, line: 'look around', engine, write: text => writes.push(text) }));
    assert.equal(state.apiKey, undefined);
    assert.equal(engine.turnCalls.length, 2);
    assert.equal(engine.turnCalls[0]?.apiKey, 'bad-key');
    assert.equal(engine.turnCalls[1]?.apiKey, undefined);
    assert.equal(engine.turnCalls[1]?.includeTrace, true);
    assert.equal(engine.turnCalls[1]?.debugEnabled, true);
    const output = writes.join('');
    assert.ok(output.includes('[turn] #1 "look around"'));
    assert.ok(output.includes('[tool] observe_world perspective=player'));
    assert.ok(output.includes('Narration:\nnarration-look around'));
    assert.ok(output.indexOf('[tool] observe_world perspective=player') < output.indexOf('Narration:\nnarration-look around'));
  });

  it('supports debug toggles, raw detail, and /trace alias', async () => {
    const engine = new StubCliEngine();
    const writes: string[] = [];
    let state: CliState = {
      sessionId: 'session-1',
      playerId: 'player-1',
      narratorStyle: 'michener',
      apiKey: 'test-key',
      debugEnabled: true,
      debugDetail: 'summary',
    };

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
});
