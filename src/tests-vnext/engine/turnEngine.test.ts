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

async function createStore() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chronicle-vnext-'));
  return { rootDir, store: new JsonlSessionStore(rootDir) };
}

async function removeDir(rootDir: string) {
  await fs.rm(rootDir, { recursive: true, force: true });
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
      const init = await engine.initSession({
        stream: { onOpeningDelta: delta => openingDeltas.push(delta) },
      });
      assert.equal(openingDeltas.length > 0, true);

      const narrationDeltas: string[] = [];
      const turn = await engine.runTurn({
        sessionId: init.sessionId,
        playerId: 'player-1',
        playerText: 'Move east',
        apiKey: 'test-key',
        stream: { onNarrationDelta: delta => narrationDeltas.push(delta) },
      });

      assert.equal(turn.turn, 1);
      assert.equal(turn.acceptedEvents.length, 1);
      assert.equal(turn.acceptedEvents[0]?.meta?.turn, 1);
      assert.equal(turn.acceptedEvents[0]?.meta?.by, 'gm');
      assert.equal(narrationDeltas.length > 0, true);

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
});
