import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TurnEngine } from '../../engine/turnEngine';
import { JsonlSessionStore } from '../../engine/session/jsonlStore';
import { replayFromLog } from '../../engine/session/replay';
import { QueueLLM } from '../helpers/queueLLM';
import { IncompatibleSessionError } from '../../engine/errors';
import type { DebugEvent } from '../../engine/debug';
import { buildSpineFromLegacyWorld } from '../../sim/spine';
import { createIsleOfMarrowWorldVNext } from '../../worlds/isle-of-marrow.vnext';

async function createStore() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chronicle-vnext-'));
  return { rootDir, store: new JsonlSessionStore(rootDir) };
}

async function removeDir(rootDir: string) {
  await fs.rm(rootDir, { recursive: true, force: true });
}

function createSpineAuthoritativePlacementWorld() {
  const world = createIsleOfMarrowWorldVNext({ anchorIso: '2025-01-01T14:00:00Z' });
  const baseSpine = buildSpineFromLegacyWorld(world);
  const carriedId = 'carried_by:heartwater-jar:player-1';

  world.items['heartwater-jar'] = {
    ...world.items['heartwater-jar'],
    location: { kind: 'ground', pos: { x: 0, y: 1200, z: 15 } },
  };
  world.actors['player-1'] = {
    ...world.actors['player-1'],
    inventory: [],
  };
  world.spine = {
    ...baseSpine,
    entities: {
      ...baseSpine.entities,
      'heartwater-jar': {
        ...baseSpine.entities['heartwater-jar']!,
        components: {
          ...baseSpine.entities['heartwater-jar']!.components,
          location: undefined,
        },
      },
    },
    relations: {
      [carriedId]: {
        id: carriedId,
        type: 'carried_by',
        from: 'heartwater-jar',
        to: 'player-1',
      },
    },
    indexes: {
      ...baseSpine.indexes,
      byFrom: {
        ...baseSpine.indexes.byFrom,
        'heartwater-jar': [carriedId],
      },
      byTo: {
        ...baseSpine.indexes.byTo,
        'player-1': [carriedId],
      },
      byRelationType: {
        ...baseSpine.indexes.byRelationType,
        carried_by: [carriedId],
      },
    },
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

  it('injects full player transcript into GM world context each turn', async () => {
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

      assert.equal(firstGMInput[0]?.role, 'system');
      assert.equal(secondGMInput[0]?.role, 'system');
      assert.deepEqual(firstContext.world.playerTranscript, [
        { turn: 1, playerId: 'player-1', playerText: 'I sit' },
      ]);
      assert.deepEqual(secondContext.world.playerTranscript, [
        { turn: 1, playerId: 'player-1', playerText: 'I sit' },
        { turn: 2, playerId: 'player-1', playerText: 'I stand' },
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
      assert.equal(afterTurnOne?.meta.pendingPrompt?.id, 'confirm-rib-market');

      await engine.runTurn({
        sessionId: init.sessionId,
        playerId: 'player-1',
        playerText: 'yes',
        apiKey: 'test-key',
      });

      const secondGMInput = llm.calls[1]?.input as Array<Record<string, unknown>>;
      const secondContext = JSON.parse(String(secondGMInput[0]?.content));
      assert.equal(secondContext.world.pendingPrompt?.id, 'confirm-rib-market');

      const afterTurnTwo = await store.loadSession(init.sessionId);
      assert.equal(afterTurnTwo?.meta.pendingPrompt, undefined);
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
      assert.deepEqual(loaded?.items['heartwater-jar']?.location, {
        kind: 'inventory',
        actorId: 'player-1',
      });
      assert.ok(loaded?.actors['player-1']?.inventory.includes('heartwater-jar'));
      assert.equal(loaded?.spine.relations['carried_by:heartwater-jar:player-1']?.type, 'carried_by');

      const replayed = replayFromLog(world, [
        JSON.stringify({
          turn: 1,
          acceptedEvents: [{ type: 'AdvanceTime', minutes: 1 }],
        }),
      ]);

      assert.deepEqual(replayed.items['heartwater-jar']?.location, {
        kind: 'inventory',
        actorId: 'player-1',
      });
      assert.ok(replayed.actors['player-1']?.inventory.includes('heartwater-jar'));
      assert.equal(replayed.spine.relations['carried_by:heartwater-jar:player-1']?.type, 'carried_by');
    } finally {
      await removeDir(rootDir);
    }
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
      const engine = new TurnEngine({
        store,
        llm: new QueueLLM([]),
        clock: () => fixedNow,
      });

      const init = await engine.initSession({});
      const state = await store.loadSession(init.sessionId);

      assert.equal(state?.systems.timeConfig.anchorIso, fixedNow.toISOString());
      assert.equal(init.telemetry.time.absoluteIso, fixedNow.toISOString());
      assert.equal(init.telemetry.time.currentHour, 8);
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
      assert.equal(state?.systems.timeConfig.anchorIso, firstNow.toISOString());
      assert.equal(resumed.telemetry.time.absoluteIso, firstNow.toISOString());
    } finally {
      await removeDir(rootDir);
    }
  });
});
