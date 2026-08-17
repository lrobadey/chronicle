export type SSEEvent = { event: string; data: unknown };

export function normalizeApiBase(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  if (!normalized) return '';

  const url = new URL(normalized);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('API base must use http or https');
  }
  return normalized;
}

export function buildApiUrl(base: string, endpoint: string): string {
  const normalizedBase = normalizeApiBase(base);
  const normalizedEndpoint = `/${endpoint.replace(/^\/+/, '')}`;
  return normalizedBase ? `${normalizedBase}${normalizedEndpoint}` : normalizedEndpoint;
}

export async function streamRequest<T>(params: {
  url: string;
  body: Record<string, unknown>;
  onEvent?: (event: SSEEvent) => void;
  fetchImpl?: typeof fetch;
}): Promise<T> {
  const response = await (params.fetchImpl || fetch)(params.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params.body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    return await response.json() as T;
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Streaming response body unavailable');

  const decoder = new TextDecoder();
  let buffered = '';
  let completed: T | null = null;

  const acceptEvent = (event: SSEEvent) => {
    params.onEvent?.(event);
    if (event.event.endsWith('.completed')) completed = event.data as T;
    if (event.event === 'error') {
      throw new Error(`API stream error: ${JSON.stringify(event.data)}`);
    }
  };

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      buffered += decoder.decode();
      break;
    }
    buffered += decoder.decode(chunk.value, { stream: true });

    const parsed = parseSSEBlocks(buffered);
    buffered = parsed.remainder;
    parsed.events.forEach(acceptEvent);
  }

  if (buffered.trim()) {
    const trailing = parseSSEBlocks(`${buffered}\n\n`);
    trailing.events.forEach(acceptEvent);
  }

  if (!completed) throw new Error('Stream ended before completion event');
  return completed;
}

export function parseSSEBlocks(payload: string): { events: SSEEvent[]; remainder: string } {
  const normalized = payload.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const remainder = blocks.pop() || '';
  const events: SSEEvent[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    const eventLine = lines.find(line => line.startsWith('event:'));
    const dataLines = lines.filter(line => line.startsWith('data:'));
    if (!eventLine || !dataLines.length) continue;

    const event = eventLine.slice('event:'.length).trim();
    const raw = dataLines.map(line => line.slice('data:'.length).trimStart()).join('\n');
    let data: unknown = raw;
    try {
      data = JSON.parse(raw);
    } catch {
      // Preserve raw payload when parsing fails.
    }
    events.push({ event, data });
  }

  return { events, remainder };
}
