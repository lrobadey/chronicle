type NarratorStyle = 'lyric' | 'cinematic' | 'michener';

type Telemetry = Record<string, unknown>;

type TurnTrace = {
  toolCalls?: Array<{ tool: string; input: unknown; output: unknown }>;
  llmCalls?: Array<Record<string, unknown>>;
  mechanicsResolutions?: Array<Record<string, unknown>>;
  specialistOutputs?: Array<Record<string, unknown>>;
};

type InitResponse = {
  sessionId: string;
  created: boolean;
  initialNarration: string;
  telemetry: Telemetry;
};

type TurnResponse = {
  sessionId: string;
  turn: number;
  narration: string;
  telemetry: Telemetry;
  acceptedEvents: unknown[];
  rejectedEvents: unknown[];
  trace?: TurnTrace;
};

type SSEEvent = { event: string; data: unknown };

type AppState = {
  apiBase: string;
  sessionId: string;
  narratorStyle: NarratorStyle;
  debugTrace: boolean;
  busy: boolean;
  log: Array<{ role: 'system' | 'player' | 'narrator'; text: string }>;
  telemetry?: Telemetry;
  latestTrace?: TurnTrace;
};

const app = document.getElementById('app');
if (!app) {
  throw new Error('Missing #app');
}

const state: AppState = {
  apiBase: `${window.location.protocol}//${window.location.hostname}:3001`,
  sessionId: '',
  narratorStyle: 'michener',
  debugTrace: true,
  busy: false,
  log: [],
};

app.innerHTML = `
  <main class="layout">
    <header class="topbar card">
      <h1>Chronicle vNext</h1>
      <p class="sub">Browser runtime alongside the CLI.</p>
    </header>

    <section class="card controls">
      <label>
        API Base
        <input id="apiBase" placeholder="http://localhost:3001" />
      </label>
      <label>
        Session ID
        <input id="sessionId" placeholder="Leave blank for new" />
      </label>
      <label>
        Narrator Style
        <select id="style">
          <option value="michener">michener</option>
          <option value="cinematic">cinematic</option>
          <option value="lyric">lyric</option>
        </select>
      </label>
      <label class="check">
        <input id="trace" type="checkbox" checked />
        include trace/tool-chain
      </label>
      <div class="actions">
        <button id="newSession">Start / Resume Session</button>
        <button id="clearLog" class="ghost">Clear Log</button>
      </div>
      <p id="status" class="status">Ready.</p>
    </section>

    <section class="card transcript">
      <h2>Story</h2>
      <div id="log" class="log"></div>
      <form id="turnForm" class="turn-form">
        <input id="playerText" placeholder="What do you do?" autocomplete="off" />
        <button type="submit">Send</button>
      </form>
    </section>

    <section class="card trace">
      <h2>Tool Call Event Chain</h2>
      <div id="traceView" class="trace-view muted">No trace yet.</div>
    </section>

    <section class="card telemetry">
      <h2>Telemetry</h2>
      <pre id="telemetry" class="json muted">No telemetry yet.</pre>
    </section>
  </main>
`;

const els = {
  apiBase: byId<HTMLInputElement>('apiBase'),
  sessionId: byId<HTMLInputElement>('sessionId'),
  style: byId<HTMLSelectElement>('style'),
  trace: byId<HTMLInputElement>('trace'),
  newSession: byId<HTMLButtonElement>('newSession'),
  clearLog: byId<HTMLButtonElement>('clearLog'),
  status: byId<HTMLElement>('status'),
  log: byId<HTMLElement>('log'),
  turnForm: byId<HTMLFormElement>('turnForm'),
  playerText: byId<HTMLInputElement>('playerText'),
  telemetry: byId<HTMLElement>('telemetry'),
  traceView: byId<HTMLElement>('traceView'),
};

els.apiBase.value = state.apiBase;
els.style.value = state.narratorStyle;

els.newSession.addEventListener('click', () => {
  void startSession();
});

els.clearLog.addEventListener('click', () => {
  state.log = [];
  renderLog();
});

els.turnForm.addEventListener('submit', event => {
  event.preventDefault();
  void runTurn();
});

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element ${id}`);
  return node as T;
}

function setStatus(text: string, type: 'ok' | 'busy' | 'err' = 'ok') {
  els.status.textContent = text;
  els.status.className = `status ${type}`;
}

function setBusy(busy: boolean) {
  state.busy = busy;
  els.newSession.disabled = busy;
  els.playerText.disabled = busy;
  els.style.disabled = busy;
  els.trace.disabled = busy;
}

function renderLog() {
  els.log.innerHTML = '';
  for (const line of state.log) {
    const item = document.createElement('article');
    item.className = `line ${line.role}`;
    item.innerHTML = `<h3>${line.role}</h3><p></p>`;
    const paragraph = item.querySelector('p');
    if (paragraph) paragraph.textContent = line.text;
    els.log.appendChild(item);
  }
  els.log.scrollTop = els.log.scrollHeight;
}

function renderTelemetry() {
  if (!state.telemetry) {
    els.telemetry.textContent = 'No telemetry yet.';
    els.telemetry.classList.add('muted');
    return;
  }
  els.telemetry.textContent = JSON.stringify(state.telemetry, null, 2);
  els.telemetry.classList.remove('muted');
}

function renderTrace() {
  if (!state.latestTrace) {
    els.traceView.textContent = 'No trace yet.';
    els.traceView.classList.add('muted');
    return;
  }
  const calls = state.latestTrace.toolCalls || [];
  if (!calls.length) {
    els.traceView.textContent = 'Trace captured, but no tool calls were made this turn.';
    els.traceView.classList.remove('muted');
    return;
  }

  const wrapper = document.createElement('ol');
  wrapper.className = 'chain';
  for (const [index, call] of calls.entries()) {
    const li = document.createElement('li');
    const heading = document.createElement('h3');
    heading.textContent = `${index + 1}. ${call.tool}`;
    li.appendChild(heading);

    const input = document.createElement('pre');
    input.textContent = `input\n${JSON.stringify(call.input, null, 2)}`;
    li.appendChild(input);

    const output = document.createElement('pre');
    output.textContent = `output\n${JSON.stringify(call.output, null, 2)}`;
    li.appendChild(output);

    wrapper.appendChild(li);
  }

  els.traceView.innerHTML = '';
  els.traceView.classList.remove('muted');
  els.traceView.appendChild(wrapper);
}

async function startSession() {
  if (state.busy) return;
  setBusy(true);

  try {
    readControls();
    if (!state.apiBase) throw new Error('API base is required');

    state.log.push({ role: 'system', text: 'Starting session…' });
    renderLog();
    setStatus('Connecting…', 'busy');

    const result = await streamRequest<InitResponse>({
      url: `${state.apiBase}/api/init`,
      body: {
        sessionId: state.sessionId || undefined,
        stream: true,
      },
      onEvent: event => {
        if (event.event === 'opening.delta') {
          appendNarrationChunk((event.data as { delta?: string }).delta || '');
        }
      },
    });

    state.sessionId = result.sessionId;
    els.sessionId.value = result.sessionId;
    state.telemetry = result.telemetry;
    state.latestTrace = undefined;
    replaceLastNarration(result.initialNarration);
    renderTelemetry();
    renderTrace();
    setStatus(`Session ready: ${result.sessionId}`, 'ok');
  } catch (error) {
    setStatus(normalizeError(error), 'err');
    state.log.push({ role: 'system', text: `Error: ${normalizeError(error)}` });
    renderLog();
  } finally {
    setBusy(false);
  }
}

async function runTurn() {
  if (state.busy) return;
  const text = els.playerText.value.trim();
  if (!text) return;
  if (!els.sessionId.value.trim()) {
    setStatus('Start a session first.', 'err');
    return;
  }

  setBusy(true);
  try {
    readControls();
    state.log.push({ role: 'player', text });
    state.log.push({ role: 'narrator', text: '' });
    renderLog();
    els.playerText.value = '';

    setStatus('Resolving turn…', 'busy');
    const result = await streamRequest<TurnResponse>({
      url: `${state.apiBase}/api/turn`,
      body: {
        sessionId: state.sessionId,
        playerText: text,
        narratorStyle: state.narratorStyle,
        stream: true,
        debug: { includeTrace: state.debugTrace },
      },
      onEvent: event => {
        if (event.event === 'narration.delta') {
          appendNarrationChunk((event.data as { delta?: string }).delta || '');
        }
      },
    });

    replaceLastNarration(result.narration);
    state.telemetry = result.telemetry;
    state.latestTrace = result.trace;
    renderTelemetry();
    renderTrace();
    setStatus(`Turn ${result.turn} complete.`, 'ok');
  } catch (error) {
    setStatus(normalizeError(error), 'err');
    state.log.push({ role: 'system', text: `Error: ${normalizeError(error)}` });
    renderLog();
  } finally {
    setBusy(false);
  }
}

function appendNarrationChunk(chunk: string) {
  if (!state.log.length || state.log[state.log.length - 1].role !== 'narrator') {
    state.log.push({ role: 'narrator', text: chunk });
  } else {
    state.log[state.log.length - 1].text += chunk;
  }
  renderLog();
}

function replaceLastNarration(text: string) {
  if (!state.log.length || state.log[state.log.length - 1].role !== 'narrator') {
    state.log.push({ role: 'narrator', text });
  } else {
    state.log[state.log.length - 1].text = text;
  }
  renderLog();
}

function readControls() {
  state.apiBase = els.apiBase.value.trim();
  state.sessionId = els.sessionId.value.trim();
  state.narratorStyle = els.style.value as NarratorStyle;
  state.debugTrace = els.trace.checked;
}

function normalizeError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function streamRequest<T>(params: {
  url: string;
  body: Record<string, unknown>;
  onEvent?: (event: SSEEvent) => void;
}): Promise<T> {
  const response = await fetch(params.url, {
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

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffered += decoder.decode(chunk.value, { stream: true });

    const parsed = parseSSEBlocks(buffered);
    buffered = parsed.remainder;

    for (const evt of parsed.events) {
      params.onEvent?.(evt);
      if (evt.event.endsWith('.completed')) {
        completed = evt.data as T;
      }
      if (evt.event === 'error') {
        throw new Error(`API stream error: ${JSON.stringify(evt.data)}`);
      }
    }
  }

  if (buffered.trim()) {
    const trailing = parseSSEBlocks(`${buffered}\n\n`);
    for (const evt of trailing.events) {
      params.onEvent?.(evt);
      if (evt.event.endsWith('.completed')) {
        completed = evt.data as T;
      }
    }
  }

  if (!completed) {
    throw new Error('Stream ended before completion event');
  }
  return completed;
}

function parseSSEBlocks(payload: string): { events: SSEEvent[]; remainder: string } {
  const blocks = payload.split('\n\n');
  const remainder = blocks.pop() || '';
  const events: SSEEvent[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    const eventLine = lines.find(line => line.startsWith('event:'));
    const dataLine = lines.find(line => line.startsWith('data:'));
    if (!eventLine || !dataLine) continue;

    const event = eventLine.slice('event:'.length).trim();
    const dataRaw = dataLine.slice('data:'.length).trim();
    let data: unknown = dataRaw;
    try {
      data = JSON.parse(dataRaw);
    } catch {
      // preserve raw payload for recoverability
    }

    events.push({ event, data });
  }

  return { events, remainder };
}
