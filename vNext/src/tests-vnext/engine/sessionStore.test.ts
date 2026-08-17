import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InputValidationError } from '../../engine/errors';
import { JsonlSessionStore } from '../../engine/session/jsonlStore';
import { createIsleOfMarrowWorldVNext } from '../../worlds/isle-of-marrow.vnext';

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

describe('JsonlSessionStore session id boundary', () => {
  it('rejects path traversal ids without creating files outside the session root', async () => {
    const parentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chronicle-session-boundary-'));
    const rootDir = path.join(parentDir, 'sessions');
    const store = new JsonlSessionStore(rootDir);

    try {
      await assert.rejects(
        () => store.ensureSession('../escaped', { createWorld: () => createIsleOfMarrowWorldVNext() }),
        InputValidationError,
      );

      assert.equal(await pathExists(path.join(parentDir, 'escaped', 'snapshot.json')), false);
      assert.equal(await pathExists(path.join(parentDir, 'escaped')), false);
    } finally {
      await fs.rm(parentDir, { recursive: true, force: true });
    }
  });

  it('accepts simple slug ids and loads them through the same boundary', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chronicle-session-boundary-'));
    const store = new JsonlSessionStore(rootDir);

    try {
      const ensured = await store.ensureSession('session-custom_1', {
        createWorld: () => createIsleOfMarrowWorldVNext(),
      });
      const loaded = await store.loadSession('session-custom_1');

      assert.equal(ensured.sessionId, 'session-custom_1');
      assert.equal(ensured.created, true);
      assert.equal(loaded?.meta.worldId, 'isle-of-marrow');
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
