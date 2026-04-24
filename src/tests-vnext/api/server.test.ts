import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { TurnEngine } from '../../engine/turnEngine';
import { JsonlSessionStore } from '../../engine/session/jsonlStore';
import { pathToFileURL } from 'node:url';
import { createChronicleServer, resolveStaticDir } from '../../server';
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

function parseSSE(payload: string): Array<{ event: string; data: unknown }> {
  const blocks = payload.split('\n\n').map(block => block.trim()).filter(Boolean);
  return blocks.map(block => {
    const lines = block.split('\n');
    const eventLine = lines.find(line => line.startsWith('event: '));
    const dataLine = lines.find(line => line.startsWith('data: '));
    const event = eventLine ? eventLine.slice('event: '.length) : 'message';
    const data = dataLine ? JSON.parse(dataLine.slice('data: '.length)) as unknown : undefined;
    return { event, data };
  });
}

describe('vNext API compatibility', () => {
  it('resolves the static directory from the server module path instead of cwd', () => {
    const fakeModulePath = path.join(os.tmpdir(), 'chronicle-static-path', 'src', 'server.ts');
    const fakeModuleUrl = pathToFileURL(fakeModulePath).href;

    assert.equal(
      resolveStaticDir(fakeModuleUrl),
      path.join(os.tmpdir(), 'chronicle-static-path', 'src', 'dist'),
    );
  });

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
    assert.deepEqual(initBody.world, {
      id: 'isle-of-marrow',
      displayName: 'Isle of Marrow',
      cliTheme: {
        eyebrow: 'Chronicle vNext',
        banner: 'The tide keeps its own counsel at first light.',
        intro: 'The landing is already awake when you arrive.',
      },
      metadata: {
        summary: 'A coastal settlement carved from leviathan bones, where salvage and survival shape every bargain.',
        settlement: 'The Landing',
        tone: 'coastal, resource-pressured, grounded',
      },
    });
    assert.deepEqual(initBody.history, {
      totalTurns: 0,
      recentTurns: [],
    });

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
    assert.deepEqual(turnBody.summary, {
      headline: 'No major changes',
      accepted: [],
      rejected: [],
      outcome: 'quiet',
    });
  });

  it('accepts worldId on /api/init and returns matching world metadata', async () => {
    const { baseUrl } = await createRunningServer();

    const initResponse = await fetch(`${baseUrl}/api/init`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ worldId: 'tel-mora' }),
    });

    assert.equal(initResponse.status, 200);
    const initBody = await initResponse.json() as Record<string, unknown>;
    assert.deepEqual(initBody.world, {
      id: 'tel-mora',
      displayName: 'Tel Mora — The Dead Junction',
      cliTheme: {
        eyebrow: 'Chronicle vNext',
        banner: 'The junction is quiet, but no one trusts it.',
        intro: 'A recommendation is coming, and everyone is listening for it.',
      },
      metadata: {
        summary: 'A dead canal junction where restoration, housing, and water scarcity collide.',
        settlement: 'Tel Mora',
        tone: 'political, compact, resource-pressured',
        economy: {
          copper: 'scarce',
          reedCloth: 'common',
          driedFish: 'adequate',
          cleanWater: 'rationed',
          clayMudbrick: 'abundant',
        },
      },
    });
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

  it('rejects path-like session ids on /api/init', async () => {
    const { baseUrl } = await createRunningServer();

    const initResponse = await fetch(`${baseUrl}/api/init`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: '../escaped' }),
    });

    assert.equal(initResponse.status, 400);
    const body = await initResponse.json() as Record<string, unknown>;
    assert.equal(body.code, 'invalid_input');
  });

  it('rejects path-like session ids on /api/turn', async () => {
    const { baseUrl } = await createRunningServer();

    const turnResponse = await fetch(`${baseUrl}/api/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'a/b', playerText: 'Look around' }),
    });

    assert.equal(turnResponse.status, 400);
    const body = await turnResponse.json() as Record<string, unknown>;
    assert.equal(body.code, 'invalid_input');
  });

  it('streams /api/init with SSE domain events', async () => {
    const { baseUrl } = await createRunningServer();
    const response = await fetch(`${baseUrl}/api/init`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stream: true }),
    });

    assert.equal(response.status, 200);
    assert.equal((response.headers.get('content-type') || '').includes('text/event-stream'), true);
    const payload = await response.text();
    const events = parseSSE(payload);
    assert.deepEqual(events.map(event => event.event), [
      'init.started',
      'opening.delta',
      'init.completed',
    ]);
    const completed = events[2]?.data as Record<string, unknown>;
    assert.equal(typeof completed.sessionId, 'string');
    assert.equal(typeof completed.initialNarration, 'string');
    assert.deepEqual(completed.world, {
      id: 'isle-of-marrow',
      displayName: 'Isle of Marrow',
      cliTheme: {
        eyebrow: 'Chronicle vNext',
        banner: 'The tide keeps its own counsel at first light.',
        intro: 'The landing is already awake when you arrive.',
      },
      metadata: {
        summary: 'A coastal settlement carved from leviathan bones, where salvage and survival shape every bargain.',
        settlement: 'The Landing',
        tone: 'coastal, resource-pressured, grounded',
      },
    });
    assert.deepEqual(completed.history, {
      totalTurns: 0,
      recentTurns: [],
    });
  });

  it('streams /api/turn with SSE domain events', async () => {
    const { baseUrl } = await createRunningServer();
    const initResponse = await fetch(`${baseUrl}/api/init`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const initBody = await initResponse.json() as Record<string, unknown>;

    const response = await fetch(`${baseUrl}/api/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: initBody.sessionId,
        playerText: 'Look around',
        stream: true,
      }),
    });
    assert.equal(response.status, 200);
    assert.equal((response.headers.get('content-type') || '').includes('text/event-stream'), true);
    const payload = await response.text();
    const events = parseSSE(payload);
    assert.deepEqual(events.map(event => event.event), [
      'turn.started',
      'narration.delta',
      'turn.completed',
    ]);
    const completed = events[2]?.data as Record<string, unknown>;
    assert.equal(typeof completed.sessionId, 'string');
    assert.equal(typeof completed.narration, 'string');
    assert.equal(typeof completed.turn, 'number');
    assert.deepEqual(completed.summary, {
      headline: 'No major changes',
      accepted: [],
      rejected: [],
      outcome: 'quiet',
    });
  });
});
