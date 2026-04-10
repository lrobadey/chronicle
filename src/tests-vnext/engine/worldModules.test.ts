import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { TurnEngine } from '../../engine/turnEngine';
import { JsonlSessionStore } from '../../engine/session/jsonlStore';
import { QueueLLM } from '../helpers/queueLLM';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0, roots.length)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function createEngine(clock?: () => Date) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chronicle-world-modules-'));
  roots.push(rootDir);
  const store = new JsonlSessionStore(rootDir);
  return {
    store,
    engine: new TurnEngine({
      store,
      llm: new QueueLLM([]),
      clock,
    }),
  };
}

describe('TurnEngine world modules', () => {
  it('creates Tel Mora when requested at new-session init', async () => {
    const { store, engine } = await createEngine(() => new Date('2030-06-01T08:37:00.000Z'));

    const init = await engine.initSession({ worldId: 'tel-mora' });
    const state = await store.loadSession(init.sessionId);

    assert.equal(init.world.id, 'tel-mora');
    assert.equal(init.world.displayName, 'Tel Mora — The Dead Junction');
    assert.equal(state?.meta.worldId, 'tel-mora');
    assert.equal(state?.systems.timeConfig.anchorIso, '2030-06-01T06:00:00.000Z');
    assert.equal(init.telemetry.location.id, 'the-assessors-shade');
  });

  it('defaults omitted worldId to Isle of Marrow', async () => {
    const { store, engine } = await createEngine();

    const init = await engine.initSession({});
    const state = await store.loadSession(init.sessionId);

    assert.equal(init.world.id, 'isle-of-marrow');
    assert.equal(state?.meta.worldId, 'isle-of-marrow');
  });

  it('ignores conflicting requested worldId when resuming a persisted session', async () => {
    const { store, engine } = await createEngine();

    const created = await engine.initSession({ worldId: 'tel-mora' });
    const resumed = await engine.initSession({
      sessionId: created.sessionId,
      worldId: 'isle-of-marrow',
    });
    const state = await store.loadSession(created.sessionId);

    assert.equal(resumed.created, false);
    assert.equal(resumed.world.id, 'tel-mora');
    assert.equal(state?.meta.worldId, 'tel-mora');
  });
});
