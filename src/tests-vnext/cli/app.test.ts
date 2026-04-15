import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CliEngine, CliState, CliTerminal, CliTranscriptEvent } from '../../cli/app';
import { handleCliLine, initCliSession, renderDebugEvent, resolveApiKey, resolveCliApiMode, runCli } from '../../cli/app';
import type { DebugSink } from '../../engine/debug';
import { ThinkingAnimation } from '../../cli/thinkingAnimation';
import { ScriptedTerminal } from './scriptedTerminal';

class StubCliEngine implements CliEngine {
  readonly initCalls: Array<{
    sessionId?: string;
    worldId?: string;
    apiKey?: string;
    debugEnabled?: boolean;
    stream?: {
      onOpeningStart?: (telemetry: Awaited<ReturnType<StubCliEngine['getTelemetry']>>) => void;
      onOpeningDelta?: (delta: string) => void;
    };
  }> = [];
  readonly turnCalls: Array<{ apiKey?: string; playerText: string; gmReasoningEffort?: 'low' | 'medium' | 'high'; includeTrace?: boolean; debugEnabled?: boolean }> = [];
  initCounter = 0;

  async initSession(params: {
    sessionId?: string;
    worldId?: string;
    apiKey?: string;
    debug?: { onEvent?: DebugSink };
    stream?: {
      onOpeningStart?: (telemetry: Awaited<ReturnType<StubCliEngine['getTelemetry']>>) => void;
      onOpeningDelta?: (delta: string) => void;
    };
  }) {
    this.initCalls.push({
      sessionId: params.sessionId,
      worldId: params.worldId,
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
    const effectiveWorldId = params.worldId ?? (params.sessionId === 'persisted-tel-mora' ? 'tel-mora' : undefined);
    return {
      sessionId: params.sessionId || `session-${this.initCounter}`,
      created: params.sessionId === 'persisted-tel-mora' ? false : true,
      telemetry,
      opening,
      world: worldInfoFor(effectiveWorldId),
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
      scheduledProcesses: {
        count: 0,
        upcoming: [],
      },
      knowledge: { seenLocations: ['the-landing'], seenActors: ['player-1'], seenItems: [], notes: [] },
    };
  }

  async runTurn(input: {
    sessionId: string;
    playerId: string;
    playerText: string;
    apiKey?: string;
    gmReasoningEffort?: 'low' | 'medium' | 'high';
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
      gmReasoningEffort: input.gmReasoningEffort,
      includeTrace: input.debug?.includeTrace,
      debugEnabled: Boolean(input.debug?.onEvent),
    });
    if (input.apiKey === 'bad-key') {
      throw { status: 429, code: 'insufficient_quota', name: 'RateLimitError' };
    }
    const narration = `narration-${input.playerText}`;
    input.debug?.onEvent?.({ type: 'turn.started', sessionId: input.sessionId, turn: 1, playerText: input.playerText });
    input.debug?.onEvent?.({ type: 'gm.iteration.started', iteration: 1 });
    input.debug?.onEvent?.({
      type: 'gm.response.received',
      iteration: 1,
      toolCalls: 1,
      toolCallCount: 1,
      toolCallNames: ['observe_world'],
      responseId: 'resp-stub-1',
      status: 'completed',
    });
    input.debug?.onEvent?.({
      type: 'tool.called',
      iteration: 1,
      tool: 'observe_world',
      callId: 'stub-call-1',
      callIndex: 1,
      callCount: 1,
      input: { perspective: 'player' },
    });
    input.debug?.onEvent?.({
      type: 'tool.result',
      iteration: 1,
      tool: 'observe_world',
      callId: 'stub-call-1',
      callIndex: 1,
      callCount: 1,
      output: { ok: true },
      ok: true,
    });
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
    startupWorldId: 'isle-of-marrow',
    worldId: 'isle-of-marrow',
    worldDisplayName: 'Isle of Marrow',
    narratorStyle: 'michener',
    gmReasoningEffort: 'low',
    apiKey: 'test-key',
    debugEnabled: true,
    debugDetail: 'summary',
    apiMode: 'auto',
    ...overrides,
  };
}

function worldInfoFor(worldId?: string) {
  if (worldId === 'tel-mora') {
    return {
      id: 'tel-mora',
      displayName: 'Tel Mora — The Dead Junction',
      cliTheme: {
        eyebrow: 'Chronicle vNext',
        banner: 'The junction is quiet, but no one trusts it.',
        intro: 'A recommendation is coming, and everyone is listening for it.',
      },
      metadata: {},
    };
  }

  return {
    id: 'isle-of-marrow',
    displayName: 'Isle of Marrow',
    cliTheme: {
      eyebrow: 'Chronicle vNext',
      banner: 'The tide keeps its own counsel at first light.',
      intro: 'The landing is already awake when you arrive.',
    },
    metadata: {},
  };
}

function createThinkingAnimation(terminal: CliTerminal) {
  return new ThinkingAnimation({ terminal, intervalMs: 1000 });
}

class AnimatedTerminal extends ScriptedTerminal {
  readonly transientEvents: string[] = [];

  override supportsTransientStatus(): boolean {
    return true;
  }

  override renderTransientStatus(text: string): void {
    this.transientEvents.push(`render:${text}`);
  }

  override clearTransientStatus(): void {
    this.transientEvents.push('clear');
  }
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
      gmReasoningEffort: 'low',
      narratorStyle: 'michener',
      debugEnabled: true,
      debugDetail: 'summary',
      apiMode: 'auto',
      write: text => writes.push(text),
      thinkingAnimation: createThinkingAnimation(new ScriptedTerminal([])),
    });

    assert.equal(state.apiKey, undefined);
    assert.equal(state.apiMode, 'fallback');
    assert.equal(state.worldId, 'isle-of-marrow');
    assert.equal(state.worldDisplayName, 'Isle of Marrow');
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

    const thinkingAnimation = createThinkingAnimation(new ScriptedTerminal([]));

    ({ state } = await handleCliLine({ state, line: '/style lyric', engine, write: text => writes.push(text), thinkingAnimation }));
    assert.equal(state.narratorStyle, 'lyric');

    ({ state } = await handleCliLine({ state, line: '/reasoning medium', engine, write: text => writes.push(text), thinkingAnimation }));
    assert.equal(state.gmReasoningEffort, 'medium');

    ({ state } = await handleCliLine({ state, line: 'look around', engine, write: text => writes.push(text), thinkingAnimation }));
    assert.equal(state.apiKey, undefined);
    assert.equal(state.apiMode, 'fallback');
    assert.equal(engine.turnCalls.length, 2);
    assert.equal(engine.turnCalls[0]?.apiKey, 'bad-key');
    assert.equal(engine.turnCalls[1]?.apiKey, undefined);
    assert.equal(engine.turnCalls[1]?.gmReasoningEffort, 'medium');
    assert.equal(engine.turnCalls[1]?.includeTrace, true);
    assert.equal(engine.turnCalls[1]?.debugEnabled, true);
    const output = writes.join('');
    assert.ok(output.includes('[turn] #1 "look around"'));
    assert.ok(output.includes('[gm] iteration 1 chose 1 next step: checking the world'));
    assert.ok(output.includes('[tool] checking the world'));
    assert.ok(output.includes('[tool] checking the world complete'));
    assert.ok(output.includes('[narrator] "narration-look around"'));
    assert.equal(output.includes('call=stub-call-1'), false);
    assert.ok(output.includes('Narration:\n[Day 1, 14:00] narration-look around'));
    assert.ok(output.indexOf('[tool] checking the world') < output.indexOf('Narration:\n[Day 1, 14:00] narration-look around'));
  });

  it('streams timestamped narration once when debug is off', async () => {
    const engine = new StubCliEngine();
    const writes: string[] = [];
    const state = baseState({ debugEnabled: false });

    await handleCliLine({
      state,
      line: 'look around',
      engine,
      write: text => writes.push(text),
      thinkingAnimation: createThinkingAnimation(new ScriptedTerminal([])),
    });

    const output = writes.join('');
    assert.ok(output.includes('\n[Day 1, 14:00] narration-look around\n\n'));
    assert.equal(output.match(/\[Day 1, 14:00\]/g)?.length, 1);
  });

  it('animates startup on tty terminals and clears before durable opening output', async () => {
    const engine = new StubCliEngine();
    const terminal = new AnimatedTerminal(['/exit']);

    const result = await runCli({
      engine,
      terminal,
      apiMode: 'fallback',
      startupWorldId: 'isle-of-marrow',
    });

    assert.equal(result.exitCode, 0);
    assert.ok(terminal.transientEvents.some(event => event.includes('sounding the tide')));
    assert.ok(terminal.transientEvents.some(event => event.includes('a voice gathers')));
    assert.equal(terminal.transientEvents.at(-1), 'clear');
    assert.ok(terminal.output().includes('Opening:\n[Day 1, 14:00] opening-session-1'));
  });

  it('clears transient status around durable writes and switches from thinking to narrator phases', async () => {
    const engine = new StubCliEngine();
    const terminal = new AnimatedTerminal(['look around', '/exit']);

    const result = await runCli({
      engine,
      terminal,
      apiMode: 'fallback',
      startupWorldId: 'isle-of-marrow',
    });

    assert.equal(result.exitCode, 0);
    const marrowIndex = terminal.transientEvents.findIndex(event => event.includes('the marrow listens'));
    const voiceIndex = terminal.transientEvents.findIndex((event, index) => index > marrowIndex && event.includes('a voice gathers'));
    assert.ok(marrowIndex >= 0);
    assert.ok(voiceIndex > marrowIndex);

    const clearAfterMarrow = terminal.transientEvents.findIndex((event, index) => index > marrowIndex && event === 'clear');
    const renderAfterClear = terminal.transientEvents.findIndex((event, index) => index > clearAfterMarrow && event.startsWith('render:'));
    assert.ok(clearAfterMarrow > marrowIndex);
    assert.ok(renderAfterClear > clearAfterMarrow);
    assert.ok(terminal.output().includes('[turn] #1 "look around"'));
    assert.ok(terminal.output().includes('Narration:\n[Day 1, 14:00] narration-look around'));
  });

  it('supports debug toggles, raw detail, and /trace alias', async () => {
    const engine = new StubCliEngine();
    const writes: string[] = [];
    let state = baseState();

    const thinkingAnimation = createThinkingAnimation(new ScriptedTerminal([]));

    ({ state } = await handleCliLine({ state, line: '/trace off', engine, write: text => writes.push(text), thinkingAnimation }));
    assert.equal(state.debugEnabled, false);

    ({ state } = await handleCliLine({ state, line: '/debug on', engine, write: text => writes.push(text), thinkingAnimation }));
    assert.equal(state.debugEnabled, true);

    ({ state } = await handleCliLine({ state, line: '/detail raw', engine, write: text => writes.push(text), thinkingAnimation }));
    assert.equal(state.debugDetail, 'raw');

    ({ state } = await handleCliLine({ state, line: '/reasoning high', engine, write: text => writes.push(text), thinkingAnimation }));
    assert.equal(state.gmReasoningEffort, 'high');

    ({ state } = await handleCliLine({ state, line: '/session', engine, write: text => writes.push(text), thinkingAnimation }));
    const output = writes.join('');
    assert.ok(output.includes('GM reasoning: high'));
    assert.ok(output.includes('Debug mode: on'));
    assert.ok(output.includes('Debug detail: raw'));
  });

  it('shows usage for invalid reasoning input and leaves state unchanged', async () => {
    const engine = new StubCliEngine();
    const writes: string[] = [];
    let state = baseState({ gmReasoningEffort: 'medium' });

    ({ state } = await handleCliLine({
      state,
      line: '/reasoning extreme',
      engine,
      write: text => writes.push(text),
      thinkingAnimation: createThinkingAnimation(new ScriptedTerminal([])),
    }));

    assert.equal(state.gmReasoningEffort, 'medium');
    assert.ok(writes.join('').includes('Usage: /reasoning <low|medium|high>'));
  });

  it('preserves GM reasoning across /new within one CLI process', async () => {
    const engine = new StubCliEngine();
    const writes: string[] = [];
    let state = baseState({ gmReasoningEffort: 'high' });

    ({ state } = await handleCliLine({
      state,
      line: '/new session-2',
      engine,
      write: text => writes.push(text),
      thinkingAnimation: createThinkingAnimation(new ScriptedTerminal([])),
    }));

    assert.equal(state.sessionId, 'session-2');
    assert.equal(state.worldId, 'isle-of-marrow');
    assert.equal(state.worldDisplayName, 'Isle of Marrow');
    assert.equal(state.gmReasoningEffort, 'high');
  });

  it('adopts the resumed session world as the new-session default', async () => {
    const engine = new StubCliEngine();

    const state = await initCliSession({
      engine,
      sessionId: 'persisted-tel-mora',
      apiKey: undefined,
      gmReasoningEffort: 'low',
      narratorStyle: 'michener',
      debugEnabled: false,
      debugDetail: 'summary',
      apiMode: 'fallback',
      write: () => {},
      thinkingAnimation: createThinkingAnimation(new ScriptedTerminal([])),
    });

    assert.equal(state.sessionId, 'persisted-tel-mora');
    assert.equal(state.worldId, 'tel-mora');
    assert.equal(state.worldDisplayName, 'Tel Mora — The Dead Junction');
    assert.equal(state.startupWorldId, 'tel-mora');
  });

  it('uses the resumed session world for /new when starting another session', async () => {
    const engine = new StubCliEngine();
    let state = await initCliSession({
      engine,
      sessionId: 'persisted-tel-mora',
      apiKey: undefined,
      gmReasoningEffort: 'low',
      narratorStyle: 'michener',
      debugEnabled: false,
      debugDetail: 'summary',
      apiMode: 'fallback',
      write: () => {},
      thinkingAnimation: createThinkingAnimation(new ScriptedTerminal([])),
    });

    ({ state } = await handleCliLine({
      state,
      line: '/new session-2',
      engine,
      write: () => {},
      thinkingAnimation: createThinkingAnimation(new ScriptedTerminal([])),
    }));

    assert.equal(engine.initCalls.at(-1)?.sessionId, 'session-2');
    assert.equal(engine.initCalls.at(-1)?.worldId, 'tel-mora');
    assert.equal(state.sessionId, 'session-2');
    assert.equal(state.worldId, 'tel-mora');
    assert.equal(state.startupWorldId, 'tel-mora');
  });

  it('renders planned tool names and raw payloads for tool timeline events', () => {
    const planned = renderDebugEvent({
      type: 'gm.response.received',
      iteration: 2,
      toolCalls: 2,
      toolCallCount: 2,
      toolCallNames: ['observe_world', 'propose_events'],
      responseId: 'resp-2',
      status: 'completed',
    }, 'summary');
    assert.equal(planned, '[gm] iteration 2 chose 2 next steps: checking the world, considering world changes\n');

    const raw = renderDebugEvent({
      type: 'tool.called',
      iteration: 2,
      tool: 'propose_events',
      callId: 'call-2',
      callIndex: 2,
      callCount: 2,
      input: { events: [{ type: 'Explore', actorId: 'player-1', area: 'around_here' }] },
    }, 'raw');
    assert.ok(raw.includes('[tool] 2/2 propose_events call=call-2 events=1'));
    assert.ok(raw.includes('"callId": "call-2"'));
    assert.ok(raw.includes('"input"'));
  });

  it('renders finish_turn summary details inline', () => {
    const clearPrompt = renderDebugEvent({
      type: 'tool.called',
      iteration: 3,
      tool: 'finish_turn',
      callId: 'finish-1',
      callIndex: 1,
      callCount: 1,
      input: {
        summary: 'done',
        playerPrompt: { clear: true },
        agendaUpdates: { scene: { currentFocus: 'Arrival', pressures: [], unresolvedBeats: [], immediateTensions: [] } },
      },
    }, 'summary');
    assert.equal(clearPrompt, '[tool] finalizing reply: "done"\n');

    const pendingPrompt = renderDebugEvent({
      type: 'tool.called',
      iteration: 4,
      tool: 'finish_turn',
      callId: 'finish-2',
      callIndex: 1,
      callCount: 1,
      input: {
        summary: 'need confirmation',
        playerPrompt: {
          pending: { kind: 'confirm_travel' },
        },
      },
    }, 'summary');
    assert.equal(pendingPrompt, '[tool] asking for confirmation\n');
  });

  it('renders mechanics tool summaries and raw payloads compactly', () => {
    const resolveSummary = renderDebugEvent({
      type: 'tool.called',
      iteration: 2,
      tool: 'resolve_mechanics',
      callId: 'mech-1',
      callIndex: 1,
      callCount: 2,
      input: { objective: 'resolve travel to the docks' },
    }, 'summary');
    assert.equal(resolveSummary, '[tool] mechanics: resolving the action\n');

    const resolveResult = renderDebugEvent({
      type: 'tool.result',
      iteration: 2,
      tool: 'resolve_mechanics',
      callId: 'mech-1',
      callIndex: 1,
      callCount: 2,
      output: {
        resolutionId: 'res-1',
        status: 'ok',
        interpretation: 'travel',
        summary: 'travel to Dock Approach',
        candidateEvents: [{ type: 'TravelToLocation' }],
        confidence: 0.93,
        debug: { selectedModel: 'gpt-5.4-mini', usedFallback: false },
      },
      ok: true,
    }, 'summary');
    assert.equal(resolveResult, '[tool] mechanics: drafted travel to Dock Approach (high confidence)\n');

    const failedMechanics = renderDebugEvent({
      type: 'tool.result',
      iteration: 2,
      tool: 'resolve_mechanics',
      callId: 'mech-failed',
      callIndex: 1,
      callCount: 1,
      output: {
        resolutionId: 'res-2',
        status: 'worker_contract_failed',
        interpretation: 'none',
        summary: 'worker failed to produce a valid draft',
        candidateEvents: [],
        confidence: 0,
        debug: { selectedModel: 'gpt-5.4', usedFallback: true, failureReason: 'invalid_function_output' },
      },
      ok: true,
    }, 'summary');
    assert.equal(failedMechanics, '[tool] mechanics: worker failed to produce a valid draft\n');

    const resolveRaw = renderDebugEvent({
      type: 'tool.result',
      iteration: 2,
      tool: 'resolve_mechanics',
      callId: 'mech-raw',
      callIndex: 1,
      callCount: 1,
      output: {
        resolutionId: 'res-3',
        status: 'worker_contract_failed',
        interpretation: 'none',
        summary: 'worker failed to produce a valid draft',
        candidateEvents: [],
        confidence: 0,
        debug: { selectedModel: 'gpt-5.4', usedFallback: true, failureReason: 'invalid_function_output' },
      },
      ok: true,
    }, 'raw');
    assert.ok(resolveRaw.includes('status=worker_contract_failed'));
    assert.ok(resolveRaw.includes('model=gpt-5.4'));
    assert.ok(resolveRaw.includes('fallback_used=true'));
    assert.ok(resolveRaw.includes('invalid_function_output'));

    const reviewRaw = renderDebugEvent({
      type: 'tool.called',
      iteration: 2,
      tool: 'review_mechanics_resolution',
      callId: 'mech-2',
      callIndex: 2,
      callCount: 2,
      input: { resolutionId: 'res-1', action: 'revise', feedback: 'Make it wait instead.' },
    }, 'raw');
    assert.ok(reviewRaw.includes('resolution=res-1'));
    assert.ok(reviewRaw.includes('action=revise'));
    assert.ok(reviewRaw.includes('Make it wait instead.'));
  });

  it('renders summary mode outcomes in plain language while keeping raw mode exact', () => {
    const summaryResult = renderDebugEvent({
      type: 'tool.result',
      iteration: 1,
      tool: 'propose_events',
      callId: 'call-9',
      callIndex: 1,
      callCount: 1,
      output: { ok: true, accepted: 1, rejected: 0 },
      ok: true,
    }, 'summary');
    assert.equal(summaryResult, '[tool] world updated: 1 event accepted\n');

    const noChanges = renderDebugEvent({
      type: 'tool.result',
      iteration: 1,
      tool: 'propose_events',
      callId: 'call-10',
      callIndex: 1,
      callCount: 1,
      output: { ok: true, accepted: 0, rejected: 0 },
      ok: true,
    }, 'summary');
    assert.equal(noChanges, '[tool] no world changes\n');

    const rawCalled = renderDebugEvent({
      type: 'tool.called',
      iteration: 3,
      tool: 'finish_turn',
      callId: 'finish-raw',
      callIndex: 1,
      callCount: 1,
      input: {
        summary: 'done',
        playerPrompt: { clear: true },
      },
    }, 'raw');
    assert.ok(rawCalled.includes('call=finish-raw'));
    assert.ok(rawCalled.includes('clear_prompt=true'));
  });

  it('renders rejected RecordClue events with a readable summary', () => {
    const rejected = renderDebugEvent({
      type: 'event.rejected',
      event: {
        type: 'RecordClue',
        actorId: 'player-1',
        text: '',
        subject: 'outer pilings',
      },
      reason: 'clue_text_required',
    }, 'summary');

    assert.equal(rejected, '[event] rejected record clue about outer pilings reason=clue_text_required\n');
  });

  it('renders narrator summary preview with truncation', () => {
    const preview = renderDebugEvent({
      type: 'narrator.completed',
      phase: 'turn',
      text: 'From the Landing, you can head north beneath the ribs or east along the jawline toward the docks.',
    }, 'summary');
    assert.ok(preview.startsWith('[narrator] "From the Landing'));
    assert.ok(preview.includes('..."'));
  });

  it('renders finish-turn-only turn output in a natural timeline', async () => {
    class FinishTurnOnlyEngine extends StubCliEngine {
      override async runTurn(input: {
        sessionId: string;
        playerId: string;
        playerText: string;
        apiKey?: string;
        gmReasoningEffort?: 'low' | 'medium' | 'high';
        narratorStyle?: 'lyric' | 'cinematic' | 'michener';
        debug?: { includeTrace?: boolean; onEvent?: DebugSink };
        stream?: {
          onNarrationStart?: (telemetry: Awaited<ReturnType<StubCliEngine['getTelemetry']>>) => void;
          onNarrationDelta?: (delta: string) => void;
        };
      }) {
        const narration = 'From the Landing, you can head toward Under the Ribs, Dock Approach, or Jawline Walk.';
        input.debug?.onEvent?.({ type: 'turn.started', sessionId: input.sessionId, turn: 2, playerText: input.playerText });
        input.debug?.onEvent?.({ type: 'gm.iteration.started', iteration: 1 });
        input.debug?.onEvent?.({
          type: 'gm.response.received',
          iteration: 1,
          toolCalls: 1,
          toolCallCount: 1,
          toolCallNames: ['finish_turn'],
          responseId: 'resp-finish-only',
          status: 'completed',
        });
        input.debug?.onEvent?.({
          type: 'tool.called',
          iteration: 1,
          tool: 'finish_turn',
          callId: 'finish-only-call',
          callIndex: 1,
          callCount: 1,
          input: { summary: 'Answer available destinations from current position' },
        });
        input.debug?.onEvent?.({
          type: 'tool.result',
          iteration: 1,
          tool: 'finish_turn',
          callId: 'finish-only-call',
          callIndex: 1,
          callCount: 1,
          output: { ok: true },
          ok: true,
        });
        input.debug?.onEvent?.({ type: 'narrator.started', phase: 'turn', style: input.narratorStyle });
        const telemetry = await this.getTelemetry(input.sessionId, input.playerId);
        input.stream?.onNarrationStart?.(telemetry);
        input.stream?.onNarrationDelta?.(narration);
        input.debug?.onEvent?.({ type: 'narrator.completed', phase: 'turn', text: narration });
        input.debug?.onEvent?.({ type: 'turn.persisted', sessionId: input.sessionId, turn: 2 });
        return {
          sessionId: input.sessionId,
          turn: 2,
          acceptedEvents: [],
          rejectedEvents: [],
          telemetry,
          narration,
          trace: input.debug?.includeTrace ? { toolCalls: [] } : undefined,
        };
      }
    }

    const engine = new FinishTurnOnlyEngine();
    const writes: string[] = [];
    const state = baseState({ apiKey: undefined, apiMode: 'fallback' });

    await handleCliLine({
      state,
      line: 'where can i go',
      engine,
      write: text => writes.push(text),
      thinkingAnimation: createThinkingAnimation(new ScriptedTerminal([])),
    });

    const output = writes.join('');
    assert.ok(output.includes('[gm] iteration 1 chose 1 next step: finalizing reply'));
    assert.ok(output.includes('[tool] finalizing reply: "Answer available destinations from current position"'));
    assert.ok(output.includes('[tool] reply ready'));
    assert.ok(output.includes('[narrator] "From the Landing, you can head toward Under the Ribs, Dock Approach'));
    assert.equal(output.includes('call=finish-only-call'), false);
  });

  it('runs a scripted session through startup, commands, and clean exit', async () => {
    const engine = new StubCliEngine();
    const terminal = new ScriptedTerminal(['/help', '/state', '/session', '/exit']);
    const result = await runCli({
      engine,
      terminal,
      apiMode: 'fallback',
      env: { OPENAI_API_KEY: 'live-key' },
      startupWorldId: 'isle-of-marrow',
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
    assert.ok(output.includes('World: Isle of Marrow (isle-of-marrow)'));
    assert.ok(output.includes('Location: The Landing'));
    assert.ok(output.includes('Session: session-1'));
    assert.ok(output.includes('Goodbye!'));
    assert.equal(terminal.closed, true);
  });

  it('prompts for a startup world when no dedicated world is provided', async () => {
    const engine = new StubCliEngine();
    const terminal = new ScriptedTerminal(['2', '/exit']);
    const result = await runCli({
      engine,
      terminal,
      apiMode: 'fallback',
    });

    assert.equal(result.exitCode, 0);
    assert.equal(engine.initCalls[0]?.worldId, 'tel-mora');
    assert.deepEqual(terminal.prompts, ['world> ', '> ']);
    const output = terminal.output();
    assert.ok(output.includes('Choose a world:'));
    assert.ok(output.includes('  1. Isle of Marrow - A coastal settlement carved from leviathan bones, where salvage and survival shape every bargain.'));
    assert.ok(output.includes('  2. Tel Mora — The Dead Junction - A dead canal junction where restoration, housing, and water scarcity collide.'));
    assert.ok(!output.includes('Press Enter for Isle of Marrow.'));
    assert.ok(output.includes('Starting in Tel Mora — The Dead Junction.'));
    assert.ok(output.includes('=== Chronicle vNext - Tel Mora — The Dead Junction ==='));
    assert.ok(output.includes('The junction is quiet, but no one trusts it.'));
    assert.ok(output.includes('A recommendation is coming, and everyone is listening for it.'));
  });

  it('reprompts after blank startup world input without initializing the engine', async () => {
    const engine = new StubCliEngine();
    const terminal = new ScriptedTerminal(['', '1', '/exit']);
    const result = await runCli({
      engine,
      terminal,
      apiMode: 'fallback',
    });

    assert.equal(result.exitCode, 0);
    assert.equal(engine.initCalls.length, 1);
    assert.equal(engine.initCalls[0]?.worldId, 'isle-of-marrow');
    assert.deepEqual(terminal.prompts, ['world> ', 'world> ', '> ']);
    const output = terminal.output();
    assert.ok(output.includes('Choose a world to continue.'));
    assert.ok(output.includes('Starting in Isle of Marrow.'));
    assert.ok(output.includes('=== Chronicle vNext - Isle of Marrow ==='));
  });

  it('treats EOF at the startup world prompt as a normal exit path', async () => {
    const engine = new StubCliEngine();
    const terminal = new ScriptedTerminal([]);
    const result = await runCli({
      engine,
      terminal,
      apiMode: 'fallback',
    });

    assert.equal(result.exitCode, 0);
    assert.equal(engine.initCalls.length, 0);
    assert.deepEqual(terminal.prompts, ['world> ']);
    assert.ok(terminal.output().includes('Choose a world:'));
    assert.ok(terminal.output().includes('Goodbye!'));
  });

  it('reprompts after an invalid startup world selection', async () => {
    const engine = new StubCliEngine();
    const terminal = new ScriptedTerminal(['3', 'tel-mora', '/exit']);
    const result = await runCli({
      engine,
      terminal,
      apiMode: 'fallback',
    });

    assert.equal(result.exitCode, 0);
    assert.equal(engine.initCalls[0]?.worldId, 'tel-mora');
    assert.deepEqual(terminal.prompts, ['world> ', 'world> ', '> ']);
    assert.ok(terminal.output().includes('Unknown world selection: 3. Try again.'));
    assert.ok(terminal.output().includes('Starting in Tel Mora — The Dead Junction.'));
  });

  it('treats EOF as a normal exit path', async () => {
    const engine = new StubCliEngine();
    const terminal = new ScriptedTerminal([]);
    const result = await runCli({
      engine,
      terminal,
      apiMode: 'fallback',
      startupWorldId: 'isle-of-marrow',
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
      startupWorldId: 'isle-of-marrow',
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
      startupWorldId: 'isle-of-marrow',
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
      startupWorldId: 'isle-of-marrow',
    });

    assert.equal(result.exitCode, 0);
    assert.equal(engine.initCalls.length, 1);
    assert.equal(engine.initCalls[0]?.apiKey, 'live-key');
  });
});
