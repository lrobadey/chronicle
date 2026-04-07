import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TurnEngine } from '../../engine/turnEngine';
import { JsonlSessionStore } from '../../engine/session/jsonlStore';
import { replayFromLog } from '../../engine/session/replay';
import { QueueLLM } from '../helpers/queueLLM';
import { IncompatibleSessionError, SpineIntegrityError } from '../../engine/errors';
import type { DebugEvent } from '../../engine/debug';
import { buildInitialSpine, getItemPlacement } from '../../sim/spine';
import { createIsleOfMarrowWorldVNext } from '../../worlds/isle-of-marrow.vnext';

const FIXED_ANCHOR = '2025-01-01T14:00:00Z';

async function createStore() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chronicle-vnext-'));
  return { rootDir, store: new JsonlSessionStore(rootDir) };
}

async function removeDir(rootDir: string) {
  await fs.rm(rootDir, { recursive: true, force: true });
}

function createSpineAuthoritativePlacementWorld() {
  const world = createIsleOfMarrowWorldVNext({ anchorIso: '2025-01-01T14:00:00Z' });

  // Override the initial spine so that heartwater-jar is carried by player-1
  // instead of on the ground. This tests that loading/replay preserves
  // spine-authoritative placement.
  const baseSpine = buildInitialSpine(world, {
    'heartwater-jar': { kind: 'inventory', actorId: 'player-1' },
  });
  world.spine = baseSpine;
  // Derive actor inventory to match spine
  world.actors['player-1'] = {
    ...world.actors['player-1'],
    inventory: ['heartwater-jar'],
  };

  return world;
}

describe('TurnEngine', () => {
  it('commits each turn once and stamps accepted event metadata', async () => {
    const { rootDir, store } = await createStore();
    try {
      const llm = new QueueLLM([
        {
          output: [{ type: 'function_call', name: 'observe_world', arguments: '{"perspective":"gm"}', call_id: 'c1' }],
          output_text: '',
        },
        {
          output: [{ type: 'function_call', name: 'propose_events', arguments: '{"events":[{"type":"MoveActor","actorId":"player-1","to":{"x":10,"y":0,"z":0}}]}', call_id: 'c2' }],
          output_text: '',
        },
        {
          output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 'c3' }],
          output_text: '',
        },
      ]);
      const engine = new TurnEngine({ store, llm });
      const openingDeltas: string[] = [];
      const debugEvents: DebugEvent[] = [];
      const init = await engine.initSession({
        debug: { onEvent: event => debugEvents.push(event) },
        stream: { onOpeningDelta: delta => openingDeltas.push(delta) },
      });
      assert.equal(openingDeltas.length > 0, true);

      const narrationDeltas: string[] = [];
      const turn = await engine.runTurn({
        sessionId: init.sessionId,
        playerId: 'player-1',
        playerText: 'Move east',
        apiKey: 'test-key',
        debug: { onEvent: event => debugEvents.push(event) },
        stream: { onNarrationDelta: delta => narrationDeltas.push(delta) },
      });

      assert.equal(turn.turn, 1);
      assert.equal(turn.acceptedEvents.length, 1);
      assert.equal(turn.acceptedEvents[0]?.meta?.turn, 1);
      assert.equal(turn.acceptedEvents[0]?.meta?.by, 'gm');
      assert.equal(narrationDeltas.length > 0, true);
      assert.ok(debugEvents.some(event => event.type === 'init.started'));
      assert.ok(debugEvents.some(event => event.type === 'turn.started'));
      assert.ok(debugEvents.some(event => event.type === 'event.accepted'));
      assert.ok(debugEvents.some(event => event.type === 'turn.persisted'));

      const persisted = await store.loadSession(init.sessionId);
      assert.equal(persisted?.meta.turn, 1);
    } finally {
      await removeDir(rootDir);
    }
  });

  it('logs NPC consult output without direct state mutation', async () => {
    const { rootDir, store } = await createStore();
    try {
      const llm = new QueueLLM([
        {
          output: [{ type: 'function_call', name: 'observe_world', arguments: '{"perspective":"gm"}', call_id: 'gm0' }],
          output_text: '',
        },
        {
          output: [{ type: 'function_call', name: 'consult_npc', arguments: '{"npcId":"mira-salt"}', call_id: 'gm1' }],
          output_text: '',
        },
        {
          output: [
            {
              type: 'function_call',
              name: 'emit_npc_turn',
              arguments: '{"publicUtterance":"Storm coming.","privateIntent":"warn_player","emotionalTone":"grim"}',
              call_id: 'npc1',
            },
          ],
          output_text: '',
        },
        {
          output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 'gm2' }],
          output_text: '',
        },
      ]);
      const engine = new TurnEngine({ store, llm });
      const init = await engine.initSession({});
      const before = await store.loadSession(init.sessionId);

      const turn = await engine.runTurn({
        sessionId: init.sessionId,
        playerId: 'player-1',
        playerText: 'Ask Mira what she sees',
        apiKey: 'test-key',
        debug: { includeTrace: true },
      });

      assert.equal(turn.acceptedEvents.length, 0);
      assert.deepEqual(turn.telemetry.player.pos, before?.actors['player-1']?.pos);

      const log = await store.loadTurnLog(init.sessionId);
      assert.equal(log.length, 1);
      assert.equal(log[0]?.npcOutputs?.[0]?.npcId, 'mira-salt');
      assert.equal(log[0]?.npcOutputs?.[0]?.privateIntent, 'warn_player');
    } finally {
      await removeDir(rootDir);
    }
  });

  it('injects full player-facing conversation history into NPC context without leaking internal fields', async () => {
    const { rootDir, store } = await createStore();
    try {
      const llm = new QueueLLM([
        {
          id: 'gm-1',
          output: [{ type: 'function_call', name: 'consult_npc', arguments: '{"npcId":"mira-salt"}', call_id: 'gm1' }],
          output_text: '',
        },
        {
          id: 'npc-1',
          output: [
            {
              type: 'function_call',
              name: 'emit_npc_turn',
              arguments: '{"publicUtterance":"I was watching the tide-line.","privateIntent":"answer","emotionalTone":"measured"}',
              call_id: 'npc1',
            },
          ],
          output_text: '',
        },
        {
          id: 'gm-2',
          output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 'gm2' }],
          output_text: '',
        },
        {
          id: 'narr-1',
          output: [],
          output_text: 'Mira glances back toward the docks.',
        },
      ]);
      const engine = new TurnEngine({ store, llm });
      const init = await engine.initSession({});
      const state = await store.loadSession(init.sessionId);
      assert.ok(state);
      state.meta.turn = 1;
      await store.saveSnapshot(init.sessionId, state);
      await store.appendTurn(init.sessionId, {
        sessionId: init.sessionId,
        turn: 1,
        atIso: new Date().toISOString(),
        playerId: 'player-1',
        playerText: 'Ask Tamar about the weed-line',
        acceptedEvents: [],
        rejectedEvents: [],
        npcOutputs: [
          {
            npcId: 'tamar-vane',
            publicUtterance: 'Fresh drag marks. Not from this tide.',
            privateIntent: 'warn_player',
          },
        ],
        specialistOutputs: [
          {
            specialistType: 'scene',
            question: 'hidden',
            output: {
              specialistType: 'scene',
              summary: 'secret specialist note',
              recommendations: [],
              candidateEvents: [],
              risks: [],
            },
            usedSuggestion: false,
            usedCandidateEvents: [],
          },
        ],
        narration: 'Tamar points at the higher pilings.',
        trace: {
          toolCalls: [{ tool: 'consult_specialist', input: { note: 'internal trace detail' }, output: {} }],
          llmCalls: [],
        },
      });

      await engine.runTurn({
        sessionId: init.sessionId,
        playerId: 'player-1',
        playerText: 'What did you see after that?',
        apiKey: 'test-key',
      });

      const npcCall = llm.calls[1];
      const npcPayloadRaw = String(npcCall?.input);
      const npcPayload = JSON.parse(npcPayloadRaw);

      assert.deepEqual(npcPayload.conversationHistory, [
        {
          turn: 0,
          role: 'opening',
          speakerName: 'Narrator',
          text: init.opening,
          source: 'openingNarration',
        },
        {
          turn: 1,
          role: 'player',
          speakerId: 'player-1',
          speakerName: 'You',
          text: 'Ask Tamar about the weed-line',
          source: 'playerText',
        },
        {
          turn: 1,
          role: 'npc',
          speakerId: 'tamar-vane',
          speakerName: 'Tamar Vane',
          text: 'Fresh drag marks. Not from this tide.',
          source: 'npcPublicUtterance',
        },
        {
          turn: 1,
          role: 'narrator',
          speakerName: 'Narrator',
          text: 'Tamar points at the higher pilings.',
          source: 'turnNarration',
        },
        {
          turn: 2,
          role: 'player',
          speakerId: 'player-1',
          speakerName: 'You',
          text: 'What did you see after that?',
          source: 'playerText',
        },
      ]);
      assert.equal(npcPayload.currentTurn.turn, 2);
      assert.equal(npcPayloadRaw.includes('warn_player'), false);
      assert.equal(npcPayloadRaw.includes('secret specialist note'), false);
      assert.equal(npcPayloadRaw.includes('internal trace detail'), false);
    } finally {
      await removeDir(rootDir);
    }
  });

  it('persists specialist consultations, agenda updates, and rich entity creation', async () => {
    const { rootDir, store } = await createStore();
    try {
      const llm = new QueueLLM([
        {
          id: 'gm-1',
          output: [
            {
              type: 'function_call',
              name: 'consult_specialist',
              arguments:
                '{"specialistType":"scene","question":"Who should notice the player?","focus":"the landing"}',
              call_id: 'gm-specialist',
            },
          ],
          output_text: '',
        },
        {
          id: 'specialist-1',
          output: [
            {
              type: 'function_call',
              name: 'emit_specialist_advice',
              arguments:
                '{"summary":"Introduce a dock witness.","recommendations":["Add one local witness with a concrete voice."],"candidateEvents":[{"type":"CreateEntity","actorId":null,"to":null,"toLocationId":null,"mode":null,"itemId":null,"at":null,"text":null,"toActorId":null,"minutes":null,"entity":{"kind":"npc","data":{"id":"dock-eye","name":"Dock Eye","description":null,"location":null,"pos":{"x":3,"y":0,"z":0},"anchor":null,"facing":"west","inventory":null,"stats":{"caution":3},"tags":["dockworker","witness"],"persona":{"tagline":"A dockworker with a long memory.","background":"Keeps tally on who comes and goes at the Landing.","voice":"Dry and suspicious.","goals":["stay employed","avoid smugglers"]},"relationships":{"player-1":{"trust":0,"fear":1,"affinity":0}},"radiusCells":null,"tideAccess":null,"terrain":null}},"key":null,"value":null,"locationId":null,"pace":null,"confirmId":null,"area":null,"direction":null,"subject":null,"note":"A dockworker notices the new arrival."}],"creationIntent":{"kind":"npc","purpose":"Introduce a witness who can react to the player later."},"risks":["Too many introductions would dilute the opening."]}',
              call_id: 'specialist-call',
            },
          ],
          output_text: '',
        },
        {
          id: 'gm-2',
          output: [
            {
              type: 'function_call',
              name: 'propose_events',
              arguments:
                '{"events":[{"type":"CreateEntity","actorId":null,"to":null,"toLocationId":null,"mode":null,"itemId":null,"at":null,"text":null,"toActorId":null,"minutes":null,"entity":{"kind":"npc","data":{"id":"dock-eye","name":"Dock Eye","description":null,"location":null,"pos":{"x":3,"y":0,"z":0},"anchor":null,"facing":"west","inventory":null,"stats":{"caution":3},"tags":["dockworker","witness"],"persona":{"tagline":"A dockworker with a long memory.","background":"Keeps tally on who comes and goes at the Landing.","voice":"Dry and suspicious.","goals":["stay employed","avoid smugglers"]},"relationships":{"player-1":{"trust":0,"fear":1,"affinity":0}},"radiusCells":null,"tideAccess":null,"terrain":null}},"key":null,"value":null,"locationId":null,"pace":null,"confirmId":null,"area":null,"direction":null,"subject":null,"note":"A dockworker notices the new arrival."}]}',
              call_id: 'gm-propose',
            },
          ],
          output_text: '',
        },
        {
          id: 'gm-3',
          output: [
            {
              type: 'function_call',
              name: 'finish_turn',
              arguments:
                '{"summary":"done","agendaUpdates":{"scene":{"currentFocus":"A new witness at the Landing","pressures":["A dockworker now watches the player closely."],"unresolvedBeats":["Decide whether to engage Dock Eye."],"immediateTensions":["The player is no longer unnoticed."]},"world":{"activeThreads":["New arrivals are noticed and remembered at the Landing."],"introductionOpportunities":["Dock Eye can connect the player to local rumors."],"escalationHooks":["Suspicion at the docks may spread if the player draws attention."]}}}',
              call_id: 'gm-finish',
            },
          ],
          output_text: '',
        },
        {
          id: 'narr-1',
          output: [],
          output_text: 'A dockworker narrows his eyes and quietly marks your arrival.',
        },
      ]);
      const engine = new TurnEngine({ store, llm });
      const init = await engine.initSession({});

      const turn = await engine.runTurn({
        sessionId: init.sessionId,
        playerId: 'player-1',
        playerText: 'look around carefully',
        apiKey: 'test-key',
        debug: { includeTrace: true },
      });

      assert.equal(turn.acceptedEvents.length, 1);
      assert.equal(turn.acceptedEvents[0]?.type, 'CreateEntity');
      assert.equal(turn.trace?.specialistOutputs?.length, 1);
      assert.equal(turn.trace?.specialistOutputs?.[0]?.usedSuggestion, true);

      const state = await store.loadSession(init.sessionId);
      assert.equal(state?.actors['dock-eye']?.persona?.voice, 'Dry and suspicious.');
      assert.deepEqual(state?.actors['dock-eye']?.tags, ['dockworker', 'witness']);
      assert.equal(state?.agendas.scene.currentFocus, 'A new witness at the Landing');
      assert.equal(state?.agendas.world.activeThreads[0], 'New arrivals are noticed and remembered at the Landing.');

      const log = await store.loadTurnLog(init.sessionId);
      assert.equal(log[0]?.specialistOutputs?.length, 1);
      assert.equal(log[0]?.specialistOutputs?.[0]?.usedSuggestion, true);
    } finally {
      await removeDir(rootDir);
    }
  });

  it('injects the persisted opening, recent turn digests, and bounded player transcript tail into GM and narrator context', async () => {
    const { rootDir, store } = await createStore();
    try {
      const llm = new QueueLLM([
        {
          id: 'gm-1',
          output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 'g1' }],
          output_text: '',
        },
        {
          id: 'narr-1',
          output: [],
          output_text: 'Turn one narration',
        },
        {
          id: 'gm-2',
          output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 'g2' }],
          output_text: '',
        },
        {
          id: 'narr-2',
          output: [],
          output_text: 'Turn two narration',
        },
      ]);
      const engine = new TurnEngine({ store, llm });
      const init = await engine.initSession({});

      await engine.runTurn({
        sessionId: init.sessionId,
        playerId: 'player-1',
        playerText: 'I sit',
        apiKey: 'test-key',
      });
      await engine.runTurn({
        sessionId: init.sessionId,
        playerId: 'player-1',
        playerText: 'I stand',
        apiKey: 'test-key',
      });

      const firstGMInput = llm.calls[0]?.input as Array<Record<string, unknown>>;
      const secondGMInput = llm.calls[2]?.input as Array<Record<string, unknown>>;
      const firstContext = JSON.parse(String(firstGMInput[0]?.content));
      const secondContext = JSON.parse(String(secondGMInput[0]?.content));
      const secondNarratorInput = JSON.parse(String(llm.calls[3]?.input));

      assert.equal(firstGMInput[0]?.role, 'system');
      assert.equal(secondGMInput[0]?.role, 'system');
      assert.equal(firstContext.world.opening.narration, init.opening);
      assert.equal(firstContext.world.opening.focalActorId, 'tamar-vane');
      assert.equal(firstContext.world.opening.focusLocationId, 'the-landing');
      assert.deepEqual(firstContext.world.recentTurns, []);
      assert.deepEqual(firstContext.world.playerTranscriptTail, []);
      assert.deepEqual(secondContext.world.opening, firstContext.world.opening);
      assert.deepEqual(secondContext.world.recentTurns, [
        {
          turn: 1,
          playerText: 'I sit',
          narration: 'Turn one narration',
          accepted: [],
          rejected: [],
        },
      ]);
      assert.deepEqual(secondContext.world.playerTranscriptTail, [
        { turn: 1, playerId: 'player-1', playerText: 'I sit' },
      ]);
      assert.deepEqual(secondNarratorInput.opening, firstContext.world.opening);
      assert.deepEqual(secondNarratorInput.recentTurns, secondContext.world.recentTurns);
    } finally {
      await removeDir(rootDir);
    }
  });

  it('limits recent turn digests to the last 10 completed turns and excludes the current turn', async () => {
    const { rootDir, store } = await createStore();
    try {
      const queue = [];
      for (let turn = 1; turn <= 12; turn += 1) {
        queue.push({
          id: `gm-${turn}`,
          output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: `g${turn}` }],
          output_text: '',
        });
        queue.push({
          id: `narr-${turn}`,
          output: [],
          output_text: `Turn ${turn} narration`,
        });
      }

      const llm = new QueueLLM(queue);
      const engine = new TurnEngine({ store, llm });
      const init = await engine.initSession({});

      for (let turn = 1; turn <= 12; turn += 1) {
        await engine.runTurn({
          sessionId: init.sessionId,
          playerId: 'player-1',
          playerText: `Action ${turn}`,
          apiKey: 'test-key',
        });
      }

      const twelfthGMInput = llm.calls[22]?.input as Array<Record<string, unknown>>;
      const twelfthContext = JSON.parse(String(twelfthGMInput[0]?.content));
      const recentTurns = twelfthContext.world.recentTurns as Array<Record<string, unknown>>;

      assert.equal(recentTurns.length, 10);
      assert.deepEqual(
        recentTurns.map(turn => turn.turn),
        [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      );
      assert.equal(recentTurns.some(turn => turn.turn === 12), false);
    } finally {
      await removeDir(rootDir);
    }
  });

  it('builds recent turn digests from legacy turn records without narration', async () => {
    const { rootDir, store } = await createStore();
    try {
      const llm = new QueueLLM([
        {
          id: 'gm-1',
          output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 'g1' }],
          output_text: '',
        },
        {
          id: 'narr-1',
          output: [],
          output_text: 'Turn two narration',
        },
      ]);
      const engine = new TurnEngine({ store, llm });
      const init = await engine.initSession({});
      const state = await store.loadSession(init.sessionId);

      assert.ok(state);
      state.meta.turn = 1;
      await store.saveSnapshot(init.sessionId, state);
      await store.appendTurn(init.sessionId, {
        sessionId: init.sessionId,
        turn: 1,
        atIso: new Date().toISOString(),
        playerId: 'player-1',
        playerText: 'legacy turn',
        acceptedEvents: [],
        rejectedEvents: [],
      });

      await engine.runTurn({
        sessionId: init.sessionId,
        playerId: 'player-1',
        playerText: 'new turn',
        apiKey: 'test-key',
      });

      const gmInput = llm.calls[0]?.input as Array<Record<string, unknown>>;
      const context = JSON.parse(String(gmInput[0]?.content));
      assert.deepEqual(context.world.recentTurns, [
        {
          turn: 1,
          playerText: 'legacy turn',
          narration: null,
          accepted: [],
          rejected: [],
        },
      ]);
    } finally {
      await removeDir(rootDir);
    }
  });

  it('persists pending GM prompts and injects them into next-turn context', async () => {
    const { rootDir, store } = await createStore();
    try {
      const llm = new QueueLLM([
        {
          id: 'gm-1',
          output: [
            {
              type: 'function_call',
              name: 'finish_turn',
              arguments:
                '{"summary":"need confirmation","playerPrompt":{"pending":{"id":"confirm-rib-market","kind":"confirm_travel","question":"The Rib Market is a longer walk. Set out now?","options":[{"key":"yes","label":"Yes, go now"},{"key":"no","label":"Not yet"}],"data":{"locationId":"the-rib-market","estimatedMinutes":24},"createdTurn":1},"clear":false}}',
              call_id: 'g1',
            },
          ],
          output_text: '',
        },
        {
          id: 'gm-2',
          output: [
            {
              type: 'function_call',
              name: 'finish_turn',
              arguments: '{"summary":"confirmation received","playerPrompt":{"pending":null,"clear":true}}',
              call_id: 'g2',
            },
          ],
          output_text: '',
        },
        {
          id: 'narr-2',
          output: [],
          output_text: 'You set out north across the dark sand.',
        },
      ]);
      const engine = new TurnEngine({ store, llm });
      const init = await engine.initSession({});

      const turnOne = await engine.runTurn({
        sessionId: init.sessionId,
        playerId: 'player-1',
        playerText: 'go to the rib market',
        apiKey: 'test-key',
      });

      assert.equal(turnOne.narration, 'The Rib Market is a longer walk. Set out now?');
      const afterTurnOne = await store.loadSession(init.sessionId);
      const turnLogAfterTurnOne = await store.loadTurnLog(init.sessionId);
      assert.equal(afterTurnOne?.meta.pendingPrompt?.id, 'confirm-rib-market');
      assert.equal(turnLogAfterTurnOne[0]?.pendingPrompt?.id, 'confirm-rib-market');
      assert.equal(turnLogAfterTurnOne[0]?.trace, undefined);

      await engine.runTurn({
        sessionId: init.sessionId,
        playerId: 'player-1',
        playerText: 'yes',
        apiKey: 'test-key',
      });

      const afterTurnTwo = await store.loadSession(init.sessionId);
      assert.equal(afterTurnTwo?.meta.pendingPrompt, undefined);
      const turnLogAfterTurnTwo = await store.loadTurnLog(init.sessionId);
      assert.equal(turnLogAfterTurnTwo[1]?.pendingPrompt, undefined);
      assert.equal(llm.calls.length, 2);
    } finally {
      await removeDir(rootDir);
    }
  });

  it('clips historical player text in recent turn digests and transcript tails', async () => {
    const { rootDir, store } = await createStore();
    try {
      const longPlayerText = 'x'.repeat(260);
      const clippedPlayerText = `${'x'.repeat(239)}…`;
      const llm = new QueueLLM([
        {
          id: 'gm-1',
          output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 'g1' }],
          output_text: '',
        },
        {
          id: 'narr-1',
          output: [],
          output_text: 'Turn one narration',
        },
        {
          id: 'gm-2',
          output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 'g2' }],
          output_text: '',
        },
        {
          id: 'narr-2',
          output: [],
          output_text: 'Turn two narration',
        },
      ]);
      const engine = new TurnEngine({ store, llm });
      const init = await engine.initSession({});

      await engine.runTurn({
        sessionId: init.sessionId,
        playerId: 'player-1',
        playerText: longPlayerText,
        apiKey: 'test-key',
      });

      await engine.runTurn({
        sessionId: init.sessionId,
        playerId: 'player-1',
        playerText: 'continue',
        apiKey: 'test-key',
      });

      const secondGMInput = llm.calls[2]?.input as Array<Record<string, unknown>>;
      const secondContext = JSON.parse(String(secondGMInput[0]?.content));
      const secondNarratorInput = JSON.parse(String(llm.calls[3]?.input));

      assert.equal(secondContext.world.recentTurns[0]?.playerText, clippedPlayerText);
      assert.equal(secondContext.world.playerTranscriptTail[0]?.playerText, clippedPlayerText);
      assert.equal(secondNarratorInput.recentTurns[0]?.playerText, clippedPlayerText);

      const storedTurnLog = await store.loadTurnLog(init.sessionId);
      assert.equal(storedTurnLog[0]?.playerText, longPlayerText);
    } finally {
      await removeDir(rootDir);
    }
  });

  it('replays initial snapshot + JSONL log to current snapshot deterministically', async () => {
    const { rootDir, store } = await createStore();
    try {
      const llm = new QueueLLM([
        {
          output: [{ type: 'function_call', name: 'observe_world', arguments: '{"perspective":"gm"}', call_id: 't1a' }],
          output_text: '',
        },
        {
          output: [{ type: 'function_call', name: 'propose_events', arguments: '{"events":[{"type":"MoveActor","actorId":"player-1","to":{"x":10,"y":0,"z":0},"toLocationId":null,"mode":"walk","note":null}]}', call_id: 't1b' }],
          output_text: '',
        },
        {
          output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 't1c' }],
          output_text: '',
        },
        {
          output: [],
          output_text: 'The shoreline shifts under your boots.',
        },
        {
          output: [{ type: 'function_call', name: 'observe_world', arguments: '{"perspective":"gm"}', call_id: 't2a' }],
          output_text: '',
        },
        {
          output: [{ type: 'function_call', name: 'propose_events', arguments: '{"events":[{"type":"MoveActor","actorId":"player-1","to":{"x":20,"y":0,"z":0},"toLocationId":null,"mode":"walk","note":null}]}', call_id: 't2b' }],
          output_text: '',
        },
        {
          output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 't2c' }],
          output_text: '',
        },
        {
          output: [],
          output_text: '',
        },
      ]);
      const engine = new TurnEngine({ store, llm });
      const init = await engine.initSession({});

      await engine.runTurn({
        sessionId: init.sessionId,
        playerId: 'player-1',
        playerText: 'Walk east',
        apiKey: 'test-key',
      });
      await engine.runTurn({
        sessionId: init.sessionId,
        playerId: 'player-1',
        playerText: 'Walk east again',
        apiKey: 'test-key',
      });

      const initial = await store.loadInitialState(init.sessionId);
      const records = await store.loadTurnLog(init.sessionId);
      const replayed = replayFromLog(initial, records.map(record => JSON.stringify(record)));
      const snapshot = await store.loadSession(init.sessionId);

      assert.equal(JSON.stringify(replayed), JSON.stringify(snapshot));
    } finally {
      await removeDir(rootDir);
    }
  });

  it('derives legacy placement from spine-authoritative snapshots and replay state', async () => {
    const { rootDir, store } = await createStore();
    try {
      const sessionId = 'spine-authoritative-session';
      const sessionDir = path.join(rootDir, sessionId);
      await fs.mkdir(sessionDir, { recursive: true });

      const world = createSpineAuthoritativePlacementWorld();
      await fs.writeFile(path.join(sessionDir, 'snapshot.json'), JSON.stringify(world, null, 2));
      await fs.writeFile(path.join(sessionDir, 'initial.json'), JSON.stringify(world, null, 2));

      const loaded = await store.loadSession(sessionId);
      const loadedPlacement = getItemPlacement(loaded!.spine, 'heartwater-jar');
      assert.deepEqual(loadedPlacement, { type: 'carried_by', actorId: 'player-1' });
      assert.ok(loaded?.actors['player-1']?.inventory.includes('heartwater-jar'));
      assert.equal(loaded?.spine.relations['carried_by:heartwater-jar:player-1']?.type, 'carried_by');

      const replayed = replayFromLog(world, [
        JSON.stringify({
          turn: 1,
          acceptedEvents: [{ type: 'AdvanceTime', minutes: 1 }],
        }),
      ]);

      const replayedPlacement = getItemPlacement(replayed.spine, 'heartwater-jar');
      assert.deepEqual(replayedPlacement, { type: 'carried_by', actorId: 'player-1' });
      assert.ok(replayed.actors['player-1']?.inventory.includes('heartwater-jar'));
      assert.equal(replayed.spine.relations['carried_by:heartwater-jar:player-1']?.type, 'carried_by');
    } finally {
      await removeDir(rootDir);
    }
  });

  it('rejects spine commit failures with structured details', async () => {
    const { rootDir, store } = await createStore();
    try {
      const debugEvents: DebugEvent[] = [];
      const llm = new QueueLLM([
        {
          output: [{
            type: 'function_call',
            name: 'propose_events',
            arguments: '{"events":[{"type":"CreateEntity","entity":{"kind":"item","data":{"id":"hidden-cache","name":"Hidden Cache","location":{"kind":"container","containerId":"missing-container"}}}}]}',
            call_id: 'gm-propose',
          }],
          output_text: '',
        },
        {
          output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 'gm-finish' }],
          output_text: '',
        },
        {
          output: [],
          output_text: 'Nothing changes.',
        },
      ]);
      const engine = new TurnEngine({ store, llm });
      const init = await engine.initSession({});

      const turn = await engine.runTurn({
        sessionId: init.sessionId,
        playerId: 'player-1',
        playerText: 'stash a cache somewhere',
        apiKey: 'test-key',
        debug: { onEvent: event => debugEvents.push(event) },
      });

      assert.equal(turn.acceptedEvents.length, 0);
      assert.equal(turn.rejectedEvents.length, 1);
      assert.equal(turn.rejectedEvents[0]?.reason.startsWith('spine_integrity:'), true);
      const details = turn.rejectedEvents[0]?.details as { issues: Array<{ code: string }> } | undefined;
      assert.equal(details?.issues[0]?.code, 'missing_placement_target');

      const rejectedDebug = debugEvents.find(event => event.type === 'event.rejected');
      assert.ok(rejectedDebug && rejectedDebug.type === 'event.rejected');
      if (rejectedDebug?.type === 'event.rejected') {
        const debugDetails = rejectedDebug.details as { issues: Array<{ code: string }> } | undefined;
        assert.equal(debugDetails?.issues[0]?.code, 'missing_placement_target');
      }
    } finally {
      await removeDir(rootDir);
    }
  });

  it('fails loading persisted invalid spine state through the spine integrity path', async () => {
    const { rootDir, store } = await createStore();
    try {
      const sessionId = 'invalid-spine-session';
      const sessionDir = path.join(rootDir, sessionId);
      await fs.mkdir(sessionDir, { recursive: true });

      const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
      delete world.spine.relations['located_in:heartwater-jar:the-rib-market'];
      world.spine.indexes.byFrom['heartwater-jar'] = [];
      world.spine.indexes.byTo['the-rib-market'] = (world.spine.indexes.byTo['the-rib-market'] || []).filter(id => id !== 'located_in:heartwater-jar:the-rib-market');
      world.spine.indexes.byRelationType.located_in = (world.spine.indexes.byRelationType.located_in || []).filter(id => id !== 'located_in:heartwater-jar:the-rib-market');

      await fs.writeFile(path.join(sessionDir, 'snapshot.json'), JSON.stringify(world, null, 2));

      await assert.rejects(async () => store.loadSession(sessionId), SpineIntegrityError);
    } finally {
      await removeDir(rootDir);
    }
  });

  it('fails replaying invalid spine state through the same typed error path', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
    delete world.spine.relations['located_in:heartwater-jar:the-rib-market'];
    world.spine.indexes.byFrom['heartwater-jar'] = [];
    world.spine.indexes.byTo['the-rib-market'] = (world.spine.indexes.byTo['the-rib-market'] || []).filter(id => id !== 'located_in:heartwater-jar:the-rib-market');
    world.spine.indexes.byRelationType.located_in = (world.spine.indexes.byRelationType.located_in || []).filter(id => id !== 'located_in:heartwater-jar:the-rib-market');

    assert.throws(() => replayFromLog(world, []), SpineIntegrityError);
  });

  it('rejects incompatible legacy session versions', async () => {
    const { rootDir, store } = await createStore();
    try {
      const sessionId = 'legacy-session';
      const sessionDir = path.join(rootDir, sessionId);
      await fs.mkdir(sessionDir, { recursive: true });
      await fs.writeFile(
        path.join(sessionDir, 'snapshot.json'),
        JSON.stringify({
          meta: { worldId: 'old', seed: 'old', version: 'v4', turn: 0 },
          map: { minX: 0, minY: 0, maxX: 1, maxY: 1, cellSizeMeters: 1 },
          actors: {},
          items: {},
          locations: {},
          systems: {
            time: { elapsedMinutes: 0 },
            timeConfig: { anchorIso: '2025-01-01T00:00:00Z', startHour: 0 },
            tideConfig: { cycleMinutes: 720 },
            weatherConfig: { climate: 'temperate', seed: 'x', cadenceMinutes: 60 },
          },
          ledger: [],
          knowledge: {},
        }),
      );

      await assert.rejects(async () => store.loadSession(sessionId), IncompatibleSessionError);
    } finally {
      await removeDir(rootDir);
    }
  });

  it('seeds new sessions from the injected clock', async () => {
    const { rootDir, store } = await createStore();
    try {
      const fixedNow = new Date('2030-06-01T08:37:00.000Z');
      const expectedAnchor = '2030-06-01T06:00:00.000Z';
      const engine = new TurnEngine({
        store,
        llm: new QueueLLM([]),
        clock: () => fixedNow,
      });

      const init = await engine.initSession({});
      const state = await store.loadSession(init.sessionId);

      assert.equal(state?.systems.timeConfig.anchorIso, expectedAnchor);
      assert.equal(init.telemetry.time.absoluteIso, expectedAnchor);
      assert.equal(init.telemetry.time.currentHour, 6);
      assert.equal(init.telemetry.time.currentDay, 1);
    } finally {
      await removeDir(rootDir);
    }
  });

  it('keeps the stored world anchor when resuming an existing session', async () => {
    const { rootDir, store } = await createStore();
    try {
      const firstNow = new Date('2030-06-01T08:37:00.000Z');
      const laterNow = new Date('2031-07-02T19:12:00.000Z');
      const expectedAnchor = '2030-06-01T06:00:00.000Z';
      const firstEngine = new TurnEngine({
        store,
        llm: new QueueLLM([]),
        clock: () => firstNow,
      });

      const init = await firstEngine.initSession({});
      const resumed = await new TurnEngine({
        store,
        llm: new QueueLLM([]),
        clock: () => laterNow,
      }).initSession({ sessionId: init.sessionId });
      const state = await store.loadSession(init.sessionId);

      assert.equal(resumed.created, false);
      assert.equal(state?.systems.timeConfig.anchorIso, expectedAnchor);
      assert.equal(resumed.telemetry.time.absoluteIso, expectedAnchor);
    } finally {
      await removeDir(rootDir);
    }
  });

  it('uses first-world opening context only when creating a new session', async () => {
    const { rootDir, store } = await createStore();
    try {
      const llm = new QueueLLM([
        { id: 'open-1', output: [], output_text: 'First opener.' },
        { id: 'open-2', output: [], output_text: 'Resume opener.' },
      ]);
      const engine = new TurnEngine({ store, llm });

      const init = await engine.initSession({ apiKey: 'test-key' });
      const resumed = await engine.initSession({ sessionId: init.sessionId, apiKey: 'test-key' });

      assert.equal(init.created, true);
      assert.equal(resumed.created, false);

      const firstInput = JSON.parse(String(llm.calls[0]?.input));
      const resumedInput = JSON.parse(String(llm.calls[1]?.input));

      assert.equal(firstInput.openingMode, 'first-world');
      assert.equal(firstInput.openingContext.isFirstWorldMessage, true);
      assert.equal(firstInput.openingContext.focalLocal.name, 'Tamar Vane');
      assert.equal(firstInput.openingContext.focusLocation.id, 'the-landing');
      assert.equal(resumedInput.openingMode, 'resume');
      assert.equal(resumedInput.openingContext, null);

      const state = await store.loadSession(init.sessionId);
      assert.equal(state?.meta.openingNarration, 'First opener.');
    } finally {
      await removeDir(rootDir);
    }
  });

  it('authors first-message opener state into the live world seed', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });

    assert.equal(world.systems.timeConfig.anchorIso, '2025-01-01T06:00:00.000Z');
    assert.equal(world.systems.timeConfig.startHour, 6);
    assert.equal(world.meta.openingSpec?.focalActorId, 'tamar-vane');
    assert.equal(world.meta.openingSpec?.focusLocationId, 'the-landing');
    assert.ok(world.meta.openingSpec?.hookText.includes('weed-line'));
    assert.ok(world.meta.openingSpec?.playerQuestion.includes('Why has Tamar Vane'));
    assert.equal(world.actors['tamar-vane']?.tags?.includes('dockhand'), true);
    assert.equal(world.agendas.scene.currentFocus, 'Dawn arrival at the Landing');
    assert.equal(
      world.agendas.world.introductionOpportunities[0],
      'Tamar Vane can explain why the tide-mark on the pilings has the dockhands unsettled.',
    );
    assert.equal(
      world.ledger[1]?.text,
      'You arrive at first light at the Landing, where dark sand meets ancient bone.',
    );
    assert.equal(
      world.ledger[2]?.text,
      'Tamar Vane halts the dawn rope-check, staring at a weed-line wrapped too high on the outer pilings.',
    );
  });

  it('can resolve mechanics and apply approved candidate events through review_mechanics_resolution', async () => {
    const { rootDir, store } = await createStore();
    try {
      const llm = new QueueLLM([
        {
          id: 'gm-1',
          output: [
            {
              type: 'function_call',
              name: 'resolve_mechanics',
              arguments: '{"objective":"resolve the player inspecting the mug"}',
              call_id: 'gm-mechanics',
            },
          ],
          output_text: '',
        },
        {
          id: 'mechanics-1',
          output: [
            {
              type: 'function_call',
              name: 'emit_mechanics_resolution',
              arguments:
                '{"interpretation":"inspect","summary":"inspect the mug","actions":[{"type":"inspect","actorId":"player-1","subject":"mug","note":"Inspect the mug."}],"pendingPrompt":null,"touchedEntities":["player-1","mug"],"confidence":0.92,"warnings":[]}',
              call_id: 'mechanics-tool',
            },
          ],
          output_text: '',
        },
        {
          id: 'gm-2',
          output: [
            {
              type: 'function_call',
              name: 'review_mechanics_resolution',
              arguments: '{"resolutionId":"11111111-1111-4111-8111-111111111111","action":"approve","feedback":null}',
              call_id: 'gm-review',
            },
          ],
          output_text: '',
        },
        {
          id: 'gm-3',
          output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 'gm-finish' }],
          output_text: '',
        },
        {
          id: 'narr-1',
          output: [],
          output_text: 'You inspect the mug.',
        },
      ]);

      const originalUUID = globalThis.crypto.randomUUID;
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: (() => '11111111-1111-4111-8111-111111111111') as typeof globalThis.crypto.randomUUID,
        configurable: true,
      });
      try {
        const engine = new TurnEngine({ store, llm });
        const init = await engine.initSession({});
        const before = await store.loadSession(init.sessionId);

        const turn = await engine.runTurn({
          sessionId: init.sessionId,
          playerId: 'player-1',
          playerText: 'I inspect the mug',
          apiKey: 'test-key',
          debug: { includeTrace: true },
        });

        assert.equal(turn.acceptedEvents.length, 1);
        assert.equal(turn.acceptedEvents[0]?.type, 'Inspect');
        assert.deepEqual(turn.telemetry.player.pos, before?.actors['player-1']?.pos);
        assert.ok(llm.calls.some(call => call.model === 'gpt-5.4-mini'));
      } finally {
        Object.defineProperty(globalThis.crypto, 'randomUUID', {
          value: originalUUID,
          configurable: true,
        });
      }
    } finally {
      await removeDir(rootDir);
    }
  });

  it('can resolve a deterministic pickup draft and apply it through mechanics review', async () => {
    const { rootDir, store } = await createStore();
    try {
      const llm = new QueueLLM([
        {
          id: 'gm-pickup-1',
          output: [
            {
              type: 'function_call',
              name: 'resolve_mechanics',
              arguments: '{"objective":"resolve the player picking up the heartwater jar"}',
              call_id: 'gm-pickup-resolve',
            },
          ],
          output_text: '',
        },
        {
          id: 'gm-pickup-2',
          output: [
            {
              type: 'function_call',
              name: 'review_mechanics_resolution',
              arguments: '{"resolutionId":"abababab-abab-4bab-8bab-abababababab","action":"approve","feedback":null}',
              call_id: 'gm-pickup-review',
            },
          ],
          output_text: '',
        },
        {
          id: 'gm-pickup-3',
          output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 'gm-pickup-finish' }],
          output_text: '',
        },
        {
          id: 'narr-pickup-1',
          output: [],
          output_text: 'You scoop up the sealed jar.',
        },
      ]);

      const originalUUID = globalThis.crypto.randomUUID;
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: (() => 'abababab-abab-4bab-8bab-abababababab') as typeof globalThis.crypto.randomUUID,
        configurable: true,
      });
      try {
        const engine = new TurnEngine({ store, llm });
        const init = await engine.initSession({});
        const state = await store.loadSession(init.sessionId);
        if (!state) throw new Error('expected session state');
        state.actors['player-1'].pos = { x: 0, y: 1200, z: 15 };
        state.items['heartwater-jar'].name = 'Heartwater Jar';
        await store.saveSnapshot(init.sessionId, state);

        const turn = await engine.runTurn({
          sessionId: init.sessionId,
          playerId: 'player-1',
          playerText: 'pick up the heartwater jar',
          apiKey: 'test-key',
          debug: { includeTrace: true },
        });

        assert.equal(turn.acceptedEvents.length, 1);
        assert.equal(turn.acceptedEvents[0]?.type, 'AffectItem');
        assert.equal(turn.telemetry.player.inventory.some(item => item.id === 'heartwater-jar'), true);
        const resolution = turn.trace?.mechanicsResolutions?.[0];
        assert.equal(resolution?.debug?.selectedModel, 'deterministic');
      } finally {
        Object.defineProperty(globalThis.crypto, 'randomUUID', {
          value: originalUUID,
          configurable: true,
        });
      }
    } finally {
      await removeDir(rootDir);
    }
  });

  it('resolves obvious fuzzy travel commands deterministically before falling back to the mechanics model', async () => {
    const { rootDir, store } = await createStore();
    try {
      const llm = new QueueLLM([
        {
          id: 'gm-1',
          output: [
            {
              type: 'function_call',
              name: 'resolve_mechanics',
              arguments: '{"objective":"resolve the player traveling to the tavern"}',
              call_id: 'gm-mechanics',
            },
          ],
          output_text: '',
        },
        {
          id: 'gm-2',
          output: [
            {
              type: 'function_call',
              name: 'review_mechanics_resolution',
              arguments: '{"resolutionId":"12121212-1212-4212-8212-121212121212","action":"approve","feedback":null}',
              call_id: 'gm-review',
            },
          ],
          output_text: '',
        },
        {
          id: 'gm-3',
          output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 'gm-finish' }],
          output_text: '',
        },
        {
          id: 'narr-1',
          output: [],
          output_text: 'You head for the tavern.',
        },
      ]);

      const originalUUID = globalThis.crypto.randomUUID;
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: (() => '12121212-1212-4212-8212-121212121212') as typeof globalThis.crypto.randomUUID,
        configurable: true,
      });
      try {
        const engine = new TurnEngine({ store, llm });
        const init = await engine.initSession({});

        const turn = await engine.runTurn({
          sessionId: init.sessionId,
          playerId: 'player-1',
          playerText: 'i go the tavern',
          apiKey: 'test-key',
          debug: { includeTrace: true },
        });

        assert.equal(turn.acceptedEvents.length, 1);
        assert.equal(turn.acceptedEvents[0]?.type, 'TravelToLocation');
        assert.equal((turn.acceptedEvents[0] as { locationId?: string }).locationId, 'the-drunken-vertebra');
        assert.equal(llm.calls.some(call => call.model === 'gpt-5.4-mini'), false);
        const resolution = turn.trace?.mechanicsResolutions?.[0];
        assert.equal(resolution?.debug?.selectedModel, 'deterministic');
      } finally {
        Object.defineProperty(globalThis.crypto, 'randomUUID', {
          value: originalUUID,
          configurable: true,
        });
      }
    } finally {
      await removeDir(rootDir);
    }
  });

  it('can revise or reject a mechanics draft without applying world changes', async () => {
    const { rootDir, store } = await createStore();
    try {
      const llm = new QueueLLM([
        {
          id: 'gm-1',
          output: [{ type: 'function_call', name: 'resolve_mechanics', arguments: '{}', call_id: 'gm-mechanics' }],
          output_text: '',
        },
        {
          id: 'mechanics-1',
          output: [
            {
              type: 'function_call',
              name: 'emit_mechanics_resolution',
              arguments:
                '{"interpretation":"inspect","summary":"inspect the mug","actions":[{"type":"inspect","actorId":"player-1","subject":"mug","note":"Inspect the mug."}],"pendingPrompt":null,"touchedEntities":["player-1","mug"],"confidence":0.71,"warnings":[]}',
              call_id: 'mechanics-tool-1',
            },
          ],
          output_text: '',
        },
        {
          id: 'gm-2',
          output: [
            {
              type: 'function_call',
              name: 'review_mechanics_resolution',
              arguments: '{"resolutionId":"22222222-2222-4222-8222-222222222222","action":"revise","feedback":"It should wait, not inspect."}',
              call_id: 'gm-review',
            },
          ],
          output_text: '',
        },
        {
          id: 'mechanics-2',
          output: [
            {
              type: 'function_call',
              name: 'emit_mechanics_resolution',
              arguments:
                '{"interpretation":"wait","summary":"wait for one minute","actions":[{"type":"wait","minutes":1,"note":"One minute passes."}],"pendingPrompt":null,"touchedEntities":["player-1"],"confidence":0.89,"warnings":[]}',
              call_id: 'mechanics-tool-2',
            },
          ],
          output_text: '',
        },
        {
          id: 'gm-3',
          output: [
            {
              type: 'function_call',
              name: 'review_mechanics_resolution',
              arguments: '{"resolutionId":"33333333-3333-4333-8333-333333333333","action":"reject","feedback":null}',
              call_id: 'gm-reject',
            },
          ],
          output_text: '',
        },
        {
          id: 'gm-4',
          output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 'gm-finish' }],
          output_text: '',
        },
        {
          id: 'narr-1',
          output: [],
          output_text: 'Nothing changes.',
        },
      ]);

      const ids = [
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
      ];
      const originalUUID = globalThis.crypto.randomUUID;
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: (() => ids.shift() || '44444444-4444-4444-8444-444444444444') as typeof globalThis.crypto.randomUUID,
        configurable: true,
      });
      try {
        const engine = new TurnEngine({ store, llm });
        const init = await engine.initSession({});
        const before = await store.loadSession(init.sessionId);

        const turn = await engine.runTurn({
          sessionId: init.sessionId,
          playerId: 'player-1',
          playerText: 'I look at the mug',
          apiKey: 'test-key',
          debug: { includeTrace: true },
        });

        assert.equal(turn.acceptedEvents.length, 0);
        assert.deepEqual(turn.telemetry.player.pos, before?.actors['player-1']?.pos);
        const reviewCalls = turn.trace?.toolCalls.filter(call => call.tool === 'review_mechanics_resolution') || [];
        assert.equal(reviewCalls.length, 2);
        const revised = reviewCalls[0]?.output as Record<string, unknown>;
        assert.equal(revised.status, 'revised');
      } finally {
        Object.defineProperty(globalThis.crypto, 'randomUUID', {
          value: originalUUID,
          configurable: true,
        });
      }
    } finally {
      await removeDir(rootDir);
    }
  });

  it('requires the GM to review an active mechanics draft before manual mechanics events or finish_turn', async () => {
    const { rootDir, store } = await createStore();
    try {
      const llm = new QueueLLM([
        {
          id: 'gm-1',
          output: [{ type: 'function_call', name: 'resolve_mechanics', arguments: '{}', call_id: 'gm-mechanics' }],
          output_text: '',
        },
        {
          id: 'mechanics-1',
          output: [
            {
              type: 'function_call',
              name: 'emit_mechanics_resolution',
              arguments:
                '{"interpretation":"none","summary":"no safe action found","actions":[],"pendingPrompt":null,"touchedEntities":[],"confidence":0.2,"warnings":[]}',
              call_id: 'mechanics-tool',
            },
          ],
          output_text: '',
        },
        {
          id: 'gm-2',
          output: [
            {
              type: 'function_call',
              name: 'propose_events',
              arguments:
                '{"events":[{"type":"MoveActor","actorId":"player-1","to":{"x":35,"y":45,"z":0},"toLocationId":null,"mode":"walk","itemId":null,"item":null,"fromActorId":null,"at":null,"text":null,"toActorId":null,"minutes":null,"entity":null,"key":null,"value":null,"locationId":null,"pace":null,"confirmId":null,"area":null,"direction":null,"subject":null,"note":"Head toward the market."}]}',
              call_id: 'gm-propose-blocked',
            },
          ],
          output_text: '',
        },
        {
          id: 'gm-3',
          output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done too early"}', call_id: 'gm-finish-blocked' }],
          output_text: '',
        },
        {
          id: 'gm-4',
          output: [
            {
              type: 'function_call',
              name: 'review_mechanics_resolution',
              arguments: '{"resolutionId":"55555555-5555-4555-8555-555555555555","action":"reject","feedback":null}',
              call_id: 'gm-review',
            },
          ],
          output_text: '',
        },
        {
          id: 'gm-5',
          output: [
            {
              type: 'function_call',
              name: 'propose_events',
              arguments:
                '{"events":[{"type":"MoveActor","actorId":"player-1","to":{"x":35,"y":45,"z":0},"toLocationId":null,"mode":"walk","itemId":null,"item":null,"fromActorId":null,"at":null,"text":null,"toActorId":null,"minutes":null,"entity":null,"key":null,"value":null,"locationId":null,"pace":null,"confirmId":null,"area":null,"direction":null,"subject":null,"note":"Head toward the market."}]}',
              call_id: 'gm-propose-accepted',
            },
          ],
          output_text: '',
        },
        {
          id: 'gm-6',
          output: [{ type: 'function_call', name: 'finish_turn', arguments: '{"summary":"done"}', call_id: 'gm-finish' }],
          output_text: '',
        },
        {
          id: 'narr-1',
          output: [],
          output_text: 'You head toward the market.',
        },
      ]);

      const originalUUID = globalThis.crypto.randomUUID;
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: (() => '55555555-5555-4555-8555-555555555555') as typeof globalThis.crypto.randomUUID,
        configurable: true,
      });
      try {
        const engine = new TurnEngine({ store, llm });
        const init = await engine.initSession({});

        const turn = await engine.runTurn({
          sessionId: init.sessionId,
          playerId: 'player-1',
          playerText: 'i got to the rib market',
          apiKey: 'test-key',
          debug: { includeTrace: true },
        });

        assert.equal(turn.acceptedEvents.length, 1);
        assert.equal(turn.acceptedEvents[0]?.type, 'MoveActor');
        const proposeCalls = turn.trace?.toolCalls.filter(call => call.tool === 'propose_events') || [];
        const firstPropose = proposeCalls[0]?.output as Record<string, unknown>;
        assert.equal(firstPropose.error, 'mechanics_review_required');
        const finishCalls = turn.trace?.toolCalls.filter(call => call.tool === 'finish_turn') || [];
        const blockedFinish = finishCalls[0]?.output as Record<string, unknown>;
        assert.equal(blockedFinish.error, 'mechanics_review_required');
      } finally {
        Object.defineProperty(globalThis.crypto, 'randomUUID', {
          value: originalUUID,
          configurable: true,
        });
      }
    } finally {
      await removeDir(rootDir);
    }
  });

  it('consumes confirm_travel replies deterministically and travels on yes without invoking the GM', async () => {
    const { rootDir, store } = await createStore();
    try {
      const llm = new QueueLLM([
        {
          id: 'narr-1',
          output: [],
          output_text: 'You set out for the Heartspring.',
        },
      ]);
      const engine = new TurnEngine({ store, llm });
      const init = await engine.initSession({});
      const state = await store.loadSession(init.sessionId);
      assert.ok(state);
      state.meta.pendingPrompt = {
        id: 'confirm-heartspring',
        kind: 'confirm_travel',
        question: 'Travel to The Heartspring?',
        options: [{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }],
        data: { locationId: 'the-heartspring', estimatedMinutes: 42 },
        createdTurn: 1,
      };
      await store.saveSnapshot(init.sessionId, state);

      const debugEvents: DebugEvent[] = [];
      const turn = await engine.runTurn({
        sessionId: init.sessionId,
        playerId: 'player-1',
        playerText: 'yes',
        apiKey: 'test-key',
        debug: { includeTrace: true, onEvent: event => debugEvents.push(event) },
      });

      assert.equal(turn.acceptedEvents.length, 1);
      assert.equal(turn.acceptedEvents[0]?.type, 'TravelToLocation');
      assert.equal((turn.acceptedEvents[0] as { locationId?: string }).locationId, 'the-heartspring');
      assert.equal((turn.acceptedEvents[0] as { confirmId?: string }).confirmId, 'confirm-heartspring');
      assert.equal(turn.telemetry.location.id, 'the-heartspring');
      assert.equal(debugEvents.some(event => event.type === 'gm.iteration.started'), false);
      const persisted = await store.loadSession(init.sessionId);
      assert.equal(persisted?.meta.pendingPrompt, undefined);
      const pendingTrace = turn.trace?.toolCalls.find(call => call.tool === 'resolve_pending_prompt');
      assert.equal((pendingTrace?.output as { handled?: string } | undefined)?.handled, 'confirm_travel_yes');
    } finally {
      await removeDir(rootDir);
    }
  });

  it('consumes confirm_travel replies deterministically and clears the prompt on no', async () => {
    const { rootDir, store } = await createStore();
    try {
      const llm = new QueueLLM([
        {
          id: 'narr-1',
          output: [],
          output_text: 'You decide not to make the trip.',
        },
      ]);
      const engine = new TurnEngine({ store, llm });
      const init = await engine.initSession({});
      const before = await store.loadSession(init.sessionId);
      assert.ok(before);
      before.meta.pendingPrompt = {
        id: 'confirm-heartspring',
        kind: 'confirm_travel',
        question: 'Travel to The Heartspring?',
        options: [{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }],
        data: { locationId: 'the-heartspring', estimatedMinutes: 42 },
        createdTurn: 1,
      };
      await store.saveSnapshot(init.sessionId, before);

      const debugEvents: DebugEvent[] = [];
      const turn = await engine.runTurn({
        sessionId: init.sessionId,
        playerId: 'player-1',
        playerText: 'no',
        apiKey: 'test-key',
        debug: { includeTrace: true, onEvent: event => debugEvents.push(event) },
      });

      assert.equal(turn.acceptedEvents.length, 0);
      assert.deepEqual(turn.telemetry.player.pos, before.actors['player-1']?.pos);
      assert.equal(debugEvents.some(event => event.type === 'gm.iteration.started'), false);
      const persisted = await store.loadSession(init.sessionId);
      assert.equal(persisted?.meta.pendingPrompt, undefined);
      const pendingTrace = turn.trace?.toolCalls.find(call => call.tool === 'resolve_pending_prompt');
      assert.equal((pendingTrace?.output as { handled?: string } | undefined)?.handled, 'confirm_travel_no');
    } finally {
      await removeDir(rootDir);
    }
  });
});
