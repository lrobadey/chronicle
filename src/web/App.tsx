import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { TurnTrace, WebHistorySummary, WebTranscriptHistory, WebTurnSummary } from '../engine/session/types';
import type { Telemetry } from '../sim/views/telemetry';
import type { WorldSurfaceInfo } from '../worlds';
import {
  buildTranscriptEntries,
  createPendingTurnEntry,
  finalizeTurnCard,
  findTurnEntry,
  latestTurnEntry,
  replaceTurnEntry,
  type TranscriptEntry,
  type TurnEntry,
  updatePendingNarration,
} from './model';

type NarratorStyle = 'lyric' | 'cinematic' | 'michener';
type DrawerKind = 'world' | 'trace' | 'session' | null;
type RuntimeState = 'booting' | 'ready' | 'sending' | 'error';
type SSEEvent = { event: string; data: unknown };

interface InitResponse {
  sessionId: string;
  created: boolean;
  initialNarration: string;
  telemetry: Telemetry;
  history: WebTranscriptHistory;
  world: WorldSurfaceInfo;
  runtime: string;
}

interface TurnResponse {
  sessionId: string;
  turn: number;
  acceptedEvents: unknown[];
  rejectedEvents: unknown[];
  telemetry: Telemetry;
  narration: string;
  summary: WebTurnSummary;
  trace?: TurnTrace;
}

const SESSION_STORAGE_KEY = 'chronicle.web.sessionId';
const DEFAULT_API_BASE = typeof window === 'undefined'
  ? 'http://127.0.0.1:3001'
  : `${window.location.protocol}//${window.location.hostname}:3001`;

export default function App() {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [runtimeState, setRuntimeState] = useState<RuntimeState>('booting');
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [sessionId, setSessionId] = useState(() => readStoredSessionId());
  const [narratorStyle, setNarratorStyle] = useState<NarratorStyle>('michener');
  const [debugTrace, setDebugTrace] = useState(true);
  const [inputValue, setInputValue] = useState('');
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [telemetry, setTelemetry] = useState<Telemetry | undefined>();
  const [world, setWorld] = useState<WorldSurfaceInfo | null>(null);
  const [selectedTurn, setSelectedTurn] = useState<number | null>(null);
  const [bootOpening, setBootOpening] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [advancedSessionOpen, setAdvancedSessionOpen] = useState(false);
  const initialBootStartedRef = useRef(false);
  const bootRequestIdRef = useRef(0);
  const turnRequestIdRef = useRef(0);
  const sessionEpochRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const activeTurn = useMemo(() => {
    const current = findTurnEntry(entries, selectedTurn);
    return current || latestTurnEntry(entries);
  }, [entries, selectedTurn]);

  useEffect(() => {
    if (initialBootStartedRef.current) return;
    initialBootStartedRef.current = true;
    void bootSession();
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [entries, bootOpening, runtimeState]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawer(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  async function bootSession(forceFresh = false) {
    const bootRequestId = ++bootRequestIdRef.current;
    const storedSessionId = forceFresh ? null : readStoredSessionId();
    const shouldShowOpeningStream = !storedSessionId;
    setRuntimeState('booting');
    setErrorMessage(null);
    setErrorDetails(null);
    setBootOpening('');
    if (forceFresh) {
      sessionEpochRef.current += 1;
      turnRequestIdRef.current += 1;
      setEntries([]);
      setSelectedTurn(null);
      setSessionId(null);
      setTelemetry(undefined);
      setWorld(null);
      writeStoredSessionId(null);
    }

    try {
      const result = await streamRequest<InitResponse>({
        url: `${apiBase}/api/init`,
        body: {
          sessionId: forceFresh ? undefined : storedSessionId || undefined,
          stream: true,
        },
        onEvent: event => {
          if (bootRequestId !== bootRequestIdRef.current) return;
          if (event.event === 'opening.delta' && shouldShowOpeningStream) {
            const delta = String((event.data as { delta?: string })?.delta || '');
            setBootOpening(current => current + delta);
          }
        },
      });

      if (bootRequestId !== bootRequestIdRef.current) return;

      const nextEntries = buildTranscriptEntries({
        initialNarration: result.initialNarration,
        history: result.history,
      });

      setEntries(nextEntries);
      setTelemetry(result.telemetry);
      setWorld(result.world);
      setRuntimeState('ready');
      setSessionId(result.sessionId);
      writeStoredSessionId(result.sessionId);
      setBootOpening('');
      const latest = latestTurnEntry(nextEntries);
      setSelectedTurn(latest?.turn || null);
    } catch (error) {
      if (bootRequestId !== bootRequestIdRef.current) return;
      setRuntimeState('error');
      setErrorMessage('The Chronicle server did not answer.');
      setErrorDetails(normalizeError(error));
    }
  }

  async function submitTurn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const playerText = inputValue.trim();
    if (!playerText || runtimeState === 'booting' || runtimeState === 'sending' || !sessionId || !telemetry) return;

    const pendingTurn = telemetry.turn + 1;
    const sessionEpoch = sessionEpochRef.current;
    const turnRequestId = ++turnRequestIdRef.current;
    const pending = createPendingTurnEntry({
      turn: pendingTurn,
      playerText,
      atIso: new Date().toISOString(),
    });

    setEntries(current => [...current, pending]);
    setSelectedTurn(pendingTurn);
    setRuntimeState('sending');
    setErrorMessage(null);
    setErrorDetails(null);
    setInputValue('');

    try {
      const result = await streamRequest<TurnResponse>({
        url: `${apiBase}/api/turn`,
        body: {
          sessionId,
          playerText,
          narratorStyle,
          stream: true,
          debug: { includeTrace: debugTrace },
        },
        onEvent: event => {
          if (sessionEpoch !== sessionEpochRef.current || turnRequestId !== turnRequestIdRef.current) return;
          if (event.event === 'narration.delta') {
            const delta = String((event.data as { delta?: string })?.delta || '');
            setEntries(current => {
              const entry = findTurnEntry(current, pendingTurn);
              return updatePendingNarration(current, pendingTurn, `${entry?.narration || ''}${delta}`);
            });
          }
        },
      });

      if (sessionEpoch !== sessionEpochRef.current || turnRequestId !== turnRequestIdRef.current) return;

      const finalized = finalizeTurnCard({
        turn: result.turn,
        atIso: new Date().toISOString(),
        playerText,
        narration: result.narration,
        summary: result.summary,
        telemetry: result.telemetry,
        trace: result.trace,
      });

      setEntries(current => replaceTurnEntry(current, finalized));
      setTelemetry(result.telemetry);
      setSelectedTurn(result.turn);
      setRuntimeState('ready');
    } catch (error) {
      if (sessionEpoch !== sessionEpochRef.current || turnRequestId !== turnRequestIdRef.current) return;
      setRuntimeState('ready');
      setEntries(current => current.filter(entry => entry.kind !== 'turn' || entry.turn !== pendingTurn));
      setErrorMessage('The turn could not be resolved.');
      setErrorDetails(normalizeError(error));
    }
  }

  const bootingVisible = runtimeState === 'booting';
  const isBusy = runtimeState === 'booting' || runtimeState === 'sending';

  return (
    <div className="chronicle-app">
      <div className="chronicle-backdrop" />
      <header className="app-header">
        <div className="brand-block">
          <span className="eyebrow">Chronicle vNext</span>
          <h1>{formatWorldTitle(world)}</h1>
        </div>
        <div className="header-center">
          <span className="session-pill">
            <span className="status-dot" />
            {sessionId ? shortSessionId(sessionId) : 'opening a new session'}
          </span>
        </div>
        <div className="header-actions">
          <button type="button" className="header-action" onClick={() => setDrawer('world')}>World</button>
          <button type="button" className="header-action" onClick={() => setDrawer('trace')}>Trace</button>
          <button type="button" className="header-action" onClick={() => setDrawer('session')}>Session</button>
        </div>
      </header>

      <main className="app-main">
        <section className="story-column">
          <CompactWorldCard telemetry={telemetry} onOpenWorld={() => setDrawer('world')} />

          {runtimeState === 'error' && entries.length === 0 ? (
            <BootErrorScreen details={errorDetails} onRetry={() => void bootSession()} />
          ) : (
            <div className="transcript-shell">
              {bootingVisible && entries.length === 0 ? (
                <BootTranscript preview={bootOpening} />
              ) : (
                <Transcript
                  entries={entries}
                  selectedTurn={selectedTurn}
                  onSelectTurn={turn => {
                    setSelectedTurn(turn);
                    setDrawer('trace');
                  }}
                />
              )}
              <div ref={logEndRef} />
            </div>
          )}

          {errorMessage && entries.length > 0 ? (
            <div className="inline-error" role="alert">
              <div>
                <strong>{errorMessage}</strong>
                {errorDetails ? <p>{errorDetails}</p> : null}
              </div>
              <button type="button" className="text-button" onClick={() => {
                setErrorMessage(null);
                setErrorDetails(null);
              }}>
                Dismiss
              </button>
            </div>
          ) : null}

          <form className="composer" onSubmit={submitTurn}>
            <input
              value={inputValue}
              onChange={event => setInputValue(event.target.value)}
              placeholder={isBusy ? 'The tower listens…' : 'What do you do?'}
              disabled={isBusy || runtimeState === 'error'}
              autoComplete="off"
            />
            <button type="submit" disabled={!inputValue.trim() || isBusy || runtimeState === 'error'}>
              {runtimeState === 'sending' ? 'Sending…' : 'Send'}
            </button>
          </form>
        </section>
      </main>

      <Drawer
        open={drawer === 'world'}
        title="World"
        subtitle="Current state around the player"
        onClose={() => setDrawer(null)}
      >
        <WorldDrawer telemetry={telemetry} />
      </Drawer>

      <Drawer
        open={drawer === 'trace'}
        title="Trace"
        subtitle={activeTurn ? `Turn ${activeTurn.turn}` : 'No turn selected'}
        onClose={() => setDrawer(null)}
      >
        <TraceDrawer turn={activeTurn} />
      </Drawer>

      <Drawer
        open={drawer === 'session'}
        title="Session"
        subtitle="Hidden runtime controls"
        onClose={() => setDrawer(null)}
      >
        <SessionDrawer
          sessionId={sessionId}
          narratorStyle={narratorStyle}
          debugTrace={debugTrace}
          apiBase={apiBase}
          advancedOpen={advancedSessionOpen}
          busy={isBusy}
          onNarratorStyleChange={value => setNarratorStyle(value)}
          onDebugTraceChange={value => setDebugTrace(value)}
          onApiBaseChange={value => setApiBase(value)}
          onToggleAdvanced={() => setAdvancedSessionOpen(value => !value)}
          onStartFresh={() => {
            setDrawer(null);
            void bootSession(true);
          }}
        />
      </Drawer>
    </div>
  );
}

function CompactWorldCard(props: { telemetry?: Telemetry; onOpenWorld: () => void }) {
  const telemetry = props.telemetry;
  const inventory = telemetry?.player.inventory || [];
  const nearbyActors = telemetry?.nearbyActors.slice(0, 3) || [];
  const nearbyLocations = telemetry?.nearbyLocations.slice(0, 3) || [];

  return (
    <section className="world-card">
      <div className="world-card-heading">
        <div>
          <span className="eyebrow">Present Tense</span>
          <h2>{telemetry?.location.name || 'Finding the shoreline'}</h2>
        </div>
        <button type="button" className="text-button" onClick={props.onOpenWorld}>Open world view</button>
      </div>
      <p className="world-description">{telemetry?.location.description || 'The tide is still pulling its shape together.'}</p>
      <div className="world-grid">
        <div>
          <span className="detail-label">Time</span>
          <strong>{telemetry ? formatWorldTime(telemetry) : 'Loading'}</strong>
        </div>
        <div>
          <span className="detail-label">Weather</span>
          <strong>{telemetry ? `${titleCase(telemetry.weather.type)}, ${telemetry.weather.windKph} kph wind` : 'Loading'}</strong>
        </div>
        <div>
          <span className="detail-label">Nearby actors</span>
          <strong>{nearbyActors.length ? nearbyActors.map(actor => actor.name).join(', ') : 'No one nearby'}</strong>
        </div>
        <div>
          <span className="detail-label">Nearby places</span>
          <strong>{nearbyLocations.length ? nearbyLocations.map(location => `${location.name} (${formatDistance(location.distance)})`).join(', ') : 'No marked destination'}</strong>
        </div>
        <div>
          <span className="detail-label">Inventory</span>
          <strong>{inventory.length ? inventory.map(item => item.name).join(', ') : 'Empty-handed'}</strong>
        </div>
      </div>
    </section>
  );
}

function Transcript(props: {
  entries: TranscriptEntry[];
  selectedTurn: number | null;
  onSelectTurn: (turn: number) => void;
}) {
  return (
    <>
      {props.entries.map(entry => {
        if (entry.kind === 'opening') {
          return (
            <article key={entry.id} className="opening-entry">
              <span className="eyebrow">Opening</span>
              <Prose text={entry.text} />
            </article>
          );
        }

        if (entry.kind === 'older-summary') {
          return <OlderSummaryCard key={entry.id} summary={entry.summary} />;
        }

        return (
          <TurnCard
            key={entry.id}
            entry={entry}
            selected={props.selectedTurn === entry.turn}
            onSelect={() => props.onSelectTurn(entry.turn)}
          />
        );
      })}
    </>
  );
}

function OlderSummaryCard(props: { summary: WebHistorySummary }) {
  return (
    <details className="older-summary" open={false}>
      <summary>
        <span className="eyebrow">Earlier</span>
        <strong>{props.summary.headline}</strong>
      </summary>
      <div className="older-summary-body">
        <p>
          Turns {props.summary.fromTurn} to {props.summary.toTurn}.
        </p>
        <ul>
          {props.summary.highlights.map(highlight => <li key={highlight}>{highlight}</li>)}
        </ul>
      </div>
    </details>
  );
}

function TurnCard(props: { entry: TurnEntry; selected: boolean; onSelect: () => void }) {
  const { entry } = props;
  return (
    <article
      className={`turn-card${props.selected ? ' selected' : ''}${entry.pending ? ' pending' : ''}`}
      onClick={props.onSelect}
    >
      <div className="turn-meta">
        <span>Turn {entry.turn}</span>
        <span>{formatTurnStamp(entry)}</span>
      </div>
      <div className="player-line">
        <span className="detail-label">You</span>
        <p>{entry.playerText}</p>
      </div>
      <div className="narration-block">
        {entry.narration ? <Prose text={entry.narration} /> : <p className="pending-copy">Resolving the world state…</p>}
      </div>
      {entry.pending ? (
        <div className="result-strip quiet">
          <span className="strip-kicker">Pending</span>
          <span>Chronicle is resolving the turn.</span>
        </div>
      ) : entry.summary ? (
        <ResultStrip summary={entry.summary} traceAvailable={Boolean(entry.trace?.toolCalls?.length)} />
      ) : null}
    </article>
  );
}

function ResultStrip(props: { summary: WebTurnSummary; traceAvailable: boolean }) {
  return (
    <div className={`result-strip ${props.summary.outcome}`}>
      <div className="result-main">
        <span className="strip-kicker">Result</span>
        <strong>{props.summary.headline}</strong>
      </div>
      <div className="result-detail">
        {props.summary.accepted.slice(0, 2).map(item => (
          <span key={item} className="result-chip accepted">{item}</span>
        ))}
        {props.summary.rejected.slice(0, 2).map(item => (
          <span key={item} className="result-chip rejected">{item}</span>
        ))}
        {props.traceAvailable ? <span className="result-chip neutral">Trace available</span> : null}
      </div>
    </div>
  );
}

function Prose(props: { text: string }) {
  return (
    <>
      {props.text.split(/\n{2,}/).map((paragraph, index) => (
        <p key={`${index}-${paragraph.slice(0, 16)}`}>{paragraph}</p>
      ))}
    </>
  );
}

function Drawer(props: {
  open: boolean;
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className={`drawer-backdrop${props.open ? ' open' : ''}`} onClick={props.onClose} />
      <aside className={`drawer${props.open ? ' open' : ''}`}>
        <div className="drawer-header">
          <div>
            <span className="eyebrow">{props.title}</span>
            <h3>{props.subtitle}</h3>
          </div>
          <button type="button" className="header-action" onClick={props.onClose}>Close</button>
        </div>
        <div className="drawer-content">{props.children}</div>
      </aside>
    </>
  );
}

function WorldDrawer(props: { telemetry?: Telemetry }) {
  const telemetry = props.telemetry;
  return (
    <div className="drawer-stack">
      <DrawerSection title="Current location">
        <h4>{telemetry?.location.name || 'Unknown coast'}</h4>
        <p>{telemetry?.location.description || 'No stable observation yet.'}</p>
      </DrawerSection>
      <DrawerSection title="Nearby actors">
        <ul className="plain-list">
          {(telemetry?.nearbyActors || []).map(actor => (
            <li key={actor.id}>
              <strong>{actor.name}</strong>
              <span>{formatDistance(actor.distance)}</span>
            </li>
          ))}
          {!telemetry?.nearbyActors.length ? <li>None visible.</li> : null}
        </ul>
      </DrawerSection>
      <DrawerSection title="Nearby places">
        <ul className="plain-list">
          {(telemetry?.nearbyLocations || []).map(location => (
            <li key={location.id}>
              <strong>{location.name}</strong>
              <span>{formatDistance(location.distance)}</span>
            </li>
          ))}
          {!telemetry?.nearbyLocations.length ? <li>No nearby landmarks.</li> : null}
        </ul>
      </DrawerSection>
      <DrawerSection title="Inventory">
        <ul className="plain-list">
          {(telemetry?.player.inventory || []).map(item => (
            <li key={item.id}>
              <strong>{item.name}</strong>
              <span>{formatItemComponents(item.components) || 'carried'}</span>
            </li>
          ))}
          {!telemetry?.player.inventory.length ? <li>Empty-handed.</li> : null}
        </ul>
      </DrawerSection>
      <DrawerSection title="Ledger">
        <ul className="ledger-list">
          {(telemetry?.ledgerTail || []).map(line => <li key={line}>{line}</li>)}
          {!telemetry?.ledgerTail.length ? <li>No recent world notes.</li> : null}
        </ul>
      </DrawerSection>
    </div>
  );
}

function TraceDrawer(props: { turn?: TurnEntry }) {
  const trace = props.turn?.trace;

  if (!props.turn) {
    return <p className="drawer-empty">Choose a turn to inspect its chain of decisions.</p>;
  }

  if (!trace?.toolCalls?.length) {
    return (
      <div className="drawer-empty">
        <p>No trace was captured for turn {props.turn.turn}.</p>
        <p>Enable trace capture in Session if you want per-step payloads.</p>
      </div>
    );
  }

  return (
    <div className="trace-stack">
      {trace.toolCalls.map((call, index) => (
        <details key={`${call.tool}-${index}`} className="trace-step">
          <summary>
            <span className="trace-index">{index + 1}</span>
            <div>
              <strong>{call.tool}</strong>
              <span>{summarizeTraceCall(call.tool, call.output)}</span>
            </div>
          </summary>
          <div className="trace-payloads">
            <div>
              <span className="detail-label">Input</span>
              <pre>{JSON.stringify(call.input, null, 2)}</pre>
            </div>
            <div>
              <span className="detail-label">Output</span>
              <pre>{JSON.stringify(call.output, null, 2)}</pre>
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

function SessionDrawer(props: {
  sessionId: string | null;
  narratorStyle: NarratorStyle;
  debugTrace: boolean;
  apiBase: string;
  advancedOpen: boolean;
  busy: boolean;
  onNarratorStyleChange: (value: NarratorStyle) => void;
  onDebugTraceChange: (value: boolean) => void;
  onApiBaseChange: (value: string) => void;
  onToggleAdvanced: () => void;
  onStartFresh: () => void;
}) {
  return (
    <div className="drawer-stack">
      <DrawerSection title="Active session">
        <p>{props.sessionId || 'No active session yet.'}</p>
      </DrawerSection>
      <DrawerSection title="Narrator style">
        <div className="segmented-control">
          {(['michener', 'cinematic', 'lyric'] as NarratorStyle[]).map(style => (
            <button
              key={style}
              type="button"
              className={style === props.narratorStyle ? 'active' : ''}
              onClick={() => props.onNarratorStyleChange(style)}
            >
              {style}
            </button>
          ))}
        </div>
      </DrawerSection>
      <DrawerSection title="Trace capture">
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={props.debugTrace}
            onChange={event => props.onDebugTraceChange(event.target.checked)}
          />
          <span>Include tool-call trace in future turns</span>
        </label>
      </DrawerSection>
      <DrawerSection title="Fresh start">
        <button type="button" className="primary-button" onClick={props.onStartFresh} disabled={props.busy}>
          Start a new session
        </button>
      </DrawerSection>
      <DrawerSection title="Advanced">
        <button type="button" className="text-button" onClick={props.onToggleAdvanced}>
          {props.advancedOpen ? 'Hide runtime settings' : 'Show runtime settings'}
        </button>
        {props.advancedOpen ? (
          <label className="field-stack">
            <span className="detail-label">API base</span>
            <input value={props.apiBase} onChange={event => props.onApiBaseChange(event.target.value)} />
          </label>
        ) : null}
      </DrawerSection>
    </div>
  );
}

function DrawerSection(props: { title: string; children: ReactNode }) {
  return (
    <section className="drawer-section">
      <span className="eyebrow">{props.title}</span>
      {props.children}
    </section>
  );
}

function BootTranscript(props: { preview: string }) {
  return (
    <article className="opening-entry loading">
      <span className="eyebrow">Opening</span>
      {props.preview ? <Prose text={props.preview} /> : <p>The tide gathers itself beyond the glass.</p>}
    </article>
  );
}

function BootErrorScreen(props: { details: string | null; onRetry: () => void }) {
  return (
    <section className="boot-error">
      <span className="eyebrow">Recovery</span>
      <h2>The shoreline is quiet.</h2>
      <p>Chronicle could not reach the local runtime. Retry when the API is available.</p>
      <div className="boot-error-actions">
        <button type="button" className="primary-button" onClick={props.onRetry}>Retry connection</button>
      </div>
      {props.details ? (
        <details>
          <summary>Technical details</summary>
          <pre>{props.details}</pre>
        </details>
      ) : null}
    </section>
  );
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

    for (const event of parsed.events) {
      params.onEvent?.(event);
      if (event.event.endsWith('.completed')) {
        completed = event.data as T;
      }
      if (event.event === 'error') {
        throw new Error(`API stream error: ${JSON.stringify(event.data)}`);
      }
    }
  }

  if (buffered.trim()) {
    const trailing = parseSSEBlocks(`${buffered}\n\n`);
    for (const event of trailing.events) {
      params.onEvent?.(event);
      if (event.event.endsWith('.completed')) {
        completed = event.data as T;
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
    const raw = dataLine.slice('data:'.length).trim();
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

function readStoredSessionId(): string | null {
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredSessionId(sessionId: string | null) {
  try {
    if (sessionId) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Best effort only.
  }
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shortSessionId(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 14)}…`;
}

export function formatWorldTitle(world: WorldSurfaceInfo | null): string {
  return world?.displayName || 'Loading world…';
}

function formatDistance(distance: number): string {
  return `${Math.round(distance)}m`;
}

function formatWorldTime(telemetry: Telemetry): string {
  const absolute = new Date(telemetry.time.absoluteIso);
  const hours = String(absolute.getUTCHours()).padStart(2, '0');
  const minutes = String(absolute.getUTCMinutes()).padStart(2, '0');
  return `Day ${telemetry.time.currentDay}, ${hours}:${minutes}`;
}

function formatTurnStamp(entry: TurnEntry): string {
  if (entry.telemetry) {
    return formatWorldTime(entry.telemetry);
  }
  const fallback = new Date(entry.atIso);
  return `${String(fallback.getUTCHours()).padStart(2, '0')}:${String(fallback.getUTCMinutes()).padStart(2, '0')}`;
}

function summarizeTraceCall(tool: string, output: unknown): string {
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    if ('error' in output) {
      return 'returned an error';
    }
    if ('ok' in output) {
      return (output as { ok?: boolean }).ok ? 'completed successfully' : 'returned a non-ok result';
    }
  }
  return `${tool.replace(/_/g, ' ')} completed`;
}

function titleCase(value: string): string {
  return value.split(/[_\s-]+/).filter(Boolean).map(part => part[0]!.toUpperCase() + part.slice(1)).join(' ');
}

function formatItemComponents(components: Telemetry['player']['inventory'][number]['components']): string {
  if (!components) return '';
  return Object.entries(components)
    .filter(([, value]) => value != null && value !== false)
    .map(([key, value]) => typeof value === 'boolean' ? titleCase(key) : `${titleCase(key)}: ${value}`)
    .join(', ');
}
