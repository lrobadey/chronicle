import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApiUrl, normalizeApiBase, streamRequest } from '../../web/apiClient';

function streamingResponse(chunks: Uint8Array[]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(chunk));
      controller.close();
    },
  }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('browser API client', () => {
  it('normalizes API bases before joining endpoint paths', () => {
    assert.equal(normalizeApiBase('  http://localhost:3001///  '), 'http://localhost:3001');
    assert.equal(buildApiUrl('http://localhost:3001/', '/api/init'), 'http://localhost:3001/api/init');
    assert.equal(buildApiUrl('', 'api/turn'), '/api/turn');
    assert.throws(() => normalizeApiBase('file:///tmp/chronicle'), /http or https/);
  });

  it('parses completed SSE events across arbitrary chunks and split UTF-8 bytes', async () => {
    const payload = [
      'event: turn.started\ndata: {"turn":1}\n\n',
      'event: narration.delta\ndata: {"delta":"café"}\n\n',
      'event: turn.completed\ndata: {"turn":1,"narration":"café"}\n\n',
    ].join('');
    const bytes = new TextEncoder().encode(payload);
    const chunks = [bytes.slice(0, 7), bytes.slice(7, 63), bytes.slice(63, 66), bytes.slice(66)];
    const seen: string[] = [];

    const result = await streamRequest<{ turn: number; narration: string }>({
      url: '/api/turn',
      body: {},
      onEvent: event => seen.push(event.event),
      fetchImpl: async () => streamingResponse(chunks),
    });

    assert.deepEqual(seen, ['turn.started', 'narration.delta', 'turn.completed']);
    assert.deepEqual(result, { turn: 1, narration: 'café' });
  });

  it('surfaces a trailing SSE error event', async () => {
    const bytes = new TextEncoder().encode('event: error\ndata: {"error":"bad key"}');
    await assert.rejects(
      streamRequest({
        url: '/api/init',
        body: {},
        fetchImpl: async () => streamingResponse([bytes]),
      }),
      /API stream error.*bad key/,
    );
  });

  it('rejects streams that end without a completion event', async () => {
    const bytes = new TextEncoder().encode('event: turn.started\ndata: {}\n\n');
    await assert.rejects(
      streamRequest({
        url: '/api/turn',
        body: {},
        fetchImpl: async () => streamingResponse([bytes]),
      }),
      /before completion/,
    );
  });
});
