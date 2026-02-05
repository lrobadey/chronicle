import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { TurnEngine } from '../../engine/turnEngine';
import { JsonlSessionStore } from '../../engine/session/jsonlStore';
import { createChronicleServer } from '../../server';
import { QueueLLM } from '../helpers/queueLLM';

interface RunningServer {
  server: http.Server;
  baseUrl: string;
}

const resources: Array<{ rootDir: string; server?: http.Server }> = [];

afterEach(async () => {
  for (const resource of resources.splice(0, resources.length)) {
    if (resource.server) {
      await new Promise<void>(resolve => resource.server!.close(() => resolve()));
    }
    await fs.rm(resource.rootDir, { recursive: true, force: true });
  }
});

async function createRunningServer(): Promise<RunningServer> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chronicle-server-'));
  const store = new JsonlSessionStore(rootDir);
  const engine = new TurnEngine({ store, llm: new QueueLLM([]) });
  const server = createChronicleServer(engine);
  await new Promise<void>(resolve => server.listen(0, () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind test server');

  resources.push({ rootDir, server });
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe('vNext API compatibility', () => {
  it('returns compatible shape for /api/init and /api/turn', async () => {
    const { baseUrl } = await createRunningServer();

    const initResponse = await fetch(`${baseUrl}/api/init`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(initResponse.status, 200);
    const initBody = await initResponse.json() as Record<string, unknown>;
    assert.equal(typeof initBody.sessionId, 'string');
    assert.equal(typeof initBody.created, 'boolean');
    assert.equal(typeof initBody.initialNarration, 'string');
    assert.ok(initBody.telemetry);

    const turnResponse = await fetch(`${baseUrl}/api/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: initBody.sessionId,
        playerText: 'Look around',
      }),
    });
    assert.equal(turnResponse.status, 200);
    const turnBody = await turnResponse.json() as Record<string, unknown>;
    assert.equal(typeof turnBody.sessionId, 'string');
    assert.equal(typeof turnBody.turn, 'number');
    assert.equal(Array.isArray(turnBody.acceptedEvents), true);
    assert.equal(Array.isArray(turnBody.rejectedEvents), true);
    assert.equal(typeof turnBody.narration, 'string');
    assert.ok(turnBody.telemetry);
  });

  it('returns deterministic 400 errors for invalid input', async () => {
    const { baseUrl } = await createRunningServer();

    const turnResponse = await fetch(`${baseUrl}/api/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1' }),
    });

    assert.equal(turnResponse.status, 400);
    const body = await turnResponse.json() as Record<string, unknown>;
    assert.equal(body.code, 'invalid_input');
    assert.equal(typeof body.error, 'string');
  });
});
