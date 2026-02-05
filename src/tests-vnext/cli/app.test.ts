import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CliEngine, CliState } from '../../cli/app';
import { handleCliLine, initCliSession, resolveApiKey } from '../../cli/app';

class StubCliEngine implements CliEngine {
  readonly initCalls: Array<{ sessionId?: string; apiKey?: string }> = [];
  readonly turnCalls: Array<{ apiKey?: string; playerText: string; includeTrace?: boolean }> = [];
  initCounter = 0;

  async initSession(params: { sessionId?: string; apiKey?: string }) {
    this.initCalls.push(params);
    if (params.apiKey === 'bad-key') {
      throw { status: 429, code: 'insufficient_quota', name: 'RateLimitError' };
    }
    this.initCounter += 1;
    return {
      sessionId: params.sessionId || `session-${this.initCounter}`,
      created: true,
      telemetry: await this.getTelemetry(params.sessionId || `session-${this.initCounter}`, 'player-1'),
      opening: `opening-${params.sessionId || `session-${this.initCounter}`}`,
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
    debug?: { includeTrace?: boolean };
  }) {
    this.turnCalls.push({
      apiKey: input.apiKey,
      playerText: input.playerText,
      includeTrace: input.debug?.includeTrace,
    });
    if (input.apiKey === 'bad-key') {
      throw { status: 429, code: 'insufficient_quota', name: 'RateLimitError' };
    }
    return {
      sessionId: input.sessionId,
      turn: 1,
      acceptedEvents: [],
      rejectedEvents: [],
      telemetry: await this.getTelemetry(input.sessionId, input.playerId),
      narration: `narration-${input.playerText}`,
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
      includeTrace: false,
      write: text => writes.push(text),
    });

    assert.equal(state.apiKey, undefined);
    assert.equal(engine.initCalls.length, 2);
    assert.equal(engine.initCalls[0]?.apiKey, 'bad-key');
    assert.equal(engine.initCalls[1]?.apiKey, undefined);
    assert.ok(writes.join('').includes('switched to deterministic fallback mode'));
  });

  it('handles trace, style, and turn fallback robustly', async () => {
    const engine = new StubCliEngine();
    const writes: string[] = [];
    let state: CliState = {
      sessionId: 'session-1',
      playerId: 'player-1',
      narratorStyle: 'michener',
      apiKey: 'bad-key',
      includeTrace: false,
    };

    ({ state } = await handleCliLine({ state, line: '/trace on', engine, write: text => writes.push(text) }));
    assert.equal(state.includeTrace, true);

    ({ state } = await handleCliLine({ state, line: '/style lyric', engine, write: text => writes.push(text) }));
    assert.equal(state.narratorStyle, 'lyric');

    ({ state } = await handleCliLine({ state, line: 'look around', engine, write: text => writes.push(text) }));
    assert.equal(state.apiKey, undefined);
    assert.equal(engine.turnCalls.length, 2);
    assert.equal(engine.turnCalls[0]?.apiKey, 'bad-key');
    assert.equal(engine.turnCalls[1]?.apiKey, undefined);
    assert.equal(engine.turnCalls[1]?.includeTrace, true);
    assert.ok(writes.join('').includes('Trace: observe_world'));
  });
});
