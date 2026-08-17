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
import { buildApiUrl, normalizeApiBase, streamRequest } from './apiClient';

type NarratorStyle = 'lyric' | 'cinematic' | 'michener';
type WorldId = 'isle-of-marrow' | 'tel-mora';
type DrawerKind = 'world' | 'trace' | 'session' | null;
type RuntimeState = 'booting' | 'ready' | 'sending' | 'error';

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
const API_BASE_STORAGE_KEY = 'chronicle.web.apiBase';
const DEFAULT_API_BASE = resolveDefaultApiBase();

function resolveDefaultApiBase() {
  if (typeof window === 'undefined') return 'http://127.0.0.1:3001';
  const stored = readStoredValue(API_BASE_STORAGE_KEY)?.trim();
  return stored || window.location.origin;
}

export default function App() {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [apiKey, setApiKey] = useState('');
  const [apiBaseDraft, setApiBaseDraft] = useState(DEFAULT_API_BASE);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [runtimeState, setRuntimeState] = useState<RuntimeState>('booting');
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sessionId, setSessionId] = useState(() => readStoredSessionId());
  const [narratorStyle, setNarratorStyle] = useState<NarratorStyle>('michener');
  const [startupWorldId, setStartupWorldId] = useState<WorldId>('isle-of-marrow');
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
  const [headerCondensed, setHeaderCondensed] = useState(false);
  const initialBootStartedRef = useRef(false);
  const bootRequestIdRef = useRef(0);
  const turnRequestIdRef = useRef(0);
  const sessionEpochRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

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
        setMenuOpen(false);
        setDrawer(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!menuOpen) return;
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [menuOpen]);

  useEffect(() => {
    const onScroll = () => {
      setHeaderCondensed(window.scrollY > 28);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  async function bootSession(
    forceFresh = false,
    runtimeOverride?: { apiBase: string; apiKey: string },
  ) {
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
      const requestApiBase = runtimeOverride?.apiBase ?? apiBase;
      const requestApiKey = runtimeOverride?.apiKey ?? apiKey;
      const result = await streamRequest<InitResponse>({
        url: buildApiUrl(requestApiBase, '/api/init'),
        body: {
          sessionId: forceFresh ? undefined : storedSessionId || undefined,
          worldId: forceFresh ? startupWorldId : undefined,
          apiKey: requestApiKey.trim() || undefined,
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
      if (result.world.id === 'isle-of-marrow' || result.world.id === 'tel-mora') {
        setStartupWorldId(result.world.id);
      }
      setRuntimeState('ready');
      setSessionId(result.sessionId);
      writeStoredSessionId(result.sessionId);
      setBootOpening('');
      setSelectedTurn(null);
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
        url: buildApiUrl(apiBase, '/api/turn'),
        body: {
          sessionId,
          playerText,
          apiKey: apiKey.trim() || undefined,
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
      setInputValue(current => current || playerText);
      setErrorMessage('The turn could not be resolved.');
      setErrorDetails(normalizeError(error));
    }
  }

  const bootingVisible = runtimeState === 'booting';
  const isBusy = runtimeState === 'booting' || runtimeState === 'sending';
  const headerTime = telemetry ? formatWorldTime(telemetry) : 'Gathering time';

  function openSecondarySurface(nextDrawer: Exclude<DrawerKind, null>) {
    setMenuOpen(false);
    setDrawer(nextDrawer);
  }

  function handleWorldTitleClick() {
    setMenuOpen(false);
    setDrawer(selectedTurn != null ? 'trace' : 'world');
  }

  function applyRuntimeSettings() {
    let nextApiBase: string;
    try {
      nextApiBase = normalizeApiBase(apiBaseDraft);
    } catch (error) {
      setErrorMessage('The API base is not a valid URL.');
      setErrorDetails(normalizeError(error));
      return;
    }

    const nextApiKey = apiKeyDraft.trim();
    setApiBase(nextApiBase);
    setApiKey(nextApiKey);
    setApiBaseDraft(nextApiBase);
    writeStoredValue(API_BASE_STORAGE_KEY, nextApiBase || null);
    setDrawer(null);
    void bootSession(true, { apiBase: nextApiBase, apiKey: nextApiKey });
  }

  return (
    <div className="chronicle-app">
      <div className="chronicle-backdrop" />
      <header className={`app-header${headerCondensed ? ' compact' : ''}`}>
        <button type="button" className="world-link" onClick={handleWorldTitleClick}>
          <span className="eyebrow">Chronicle</span>
          <h1>{formatWorldTitle(world)}</h1>
        </button>
        <div className="header-meta">
          <span className="detail-label">Time</span>
          <strong>{headerTime}</strong>
        </div>
        <div className="header-actions" ref={menuRef}>
          <button
            type="button"
            className={`header-action gear-trigger${menuOpen ? ' open' : ''}`}
            onClick={() => setMenuOpen(open => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Open story controls"
          >
            <span className="gear-glyph" aria-hidden="true" />
          </button>
          <div className={`gear-menu${menuOpen ? ' open' : ''}`} role="menu" aria-label="Secondary surfaces">
            <button type="button" role="menuitem" className="gear-menu-item" onClick={() => openSecondarySurface('world')}>
              <span>World</span>
              <small>Current state</small>
            </button>
            <button type="button" role="menuitem" className="gear-menu-item" onClick={() => openSecondarySurface('trace')}>
              <span>Trace</span>
              <small>{selectedTurn != null ? `Turn ${selectedTurn}` : 'Latest turn'}</small>
            </button>
            <button type="button" role="menuitem" className="gear-menu-item" onClick={() => openSecondarySurface('session')}>
              <span>Session</span>
              <small>{sessionId ? 'Runtime controls' : 'Startup controls'}</small>
            </button>
          </div>
        </div>
      </header>

      <main className="app-main">
        <section className="story-column">
          {runtimeState === 'error' && entries.length === 0 ? (
            <BootErrorScreen
              details={errorDetails}
              onRetry={() => void bootSession()}
              onFresh={() => void bootSession(true)}
            />
          ) : (
            <div className="transcript-shell">
              {bootingVisible && entries.length === 0 ? (
                <BootTranscript preview={bootOpening} />
              ) : (
                <Transcript
                  entries={entries}
                  selectedTurn={selectedTurn}
                  onSelectTurn={turn => setSelectedTurn(turn)}
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
              aria-label="Describe what you do next"
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
        subtitle="State beneath the story"
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
        subtitle="Story controls and runtime"
        onClose={() => setDrawer(null)}
      >
        <SessionDrawer
          sessionId={sessionId}
          narratorStyle={narratorStyle}
          startupWorldId={startupWorldId}
          debugTrace={debugTrace}
          apiBaseDraft={apiBaseDraft}
          apiKeyDraft={apiKeyDraft}
          advancedOpen={advancedSessionOpen}
          busy={isBusy}
          onNarratorStyleChange={value => setNarratorStyle(value)}
          onStartupWorldChange={value => setStartupWorldId(value)}
          onDebugTraceChange={value => setDebugTrace(value)}
          onApiBaseChange={value => setApiBaseDraft(value)}
          onApiKeyChange={value => setApiKeyDraft(value)}
          onApplyRuntime={applyRuntimeSettings}
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
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          props.onSelect();
        }
      }}
      role="button"
      tabIndex={0}
      aria-pressed={props.selected}
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
        <TurnOutcomeBadge tone="quiet" label="Resolving" detail="Chronicle is resolving the turn." />
      ) : entry.summary ? (
        <TurnOutcomeBadge tone={entry.summary.outcome} label={entry.summary.headline} />
      ) : null}
    </article>
  );
}

function TurnOutcomeBadge(props: { tone: WebTurnSummary['outcome']; label: string; detail?: string }) {
  return (
    <div className={`outcome-badge ${props.tone}`}>
      <span className="strip-kicker">{props.label}</span>
      {props.detail ? <small>{props.detail}</small> : null}
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
      <button
        type="button"
        className={`drawer-backdrop${props.open ? ' open' : ''}`}
        onClick={props.onClose}
        aria-label="Close panel"
        tabIndex={props.open ? 0 : -1}
      />
      <aside
        className={`drawer${props.open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!props.open}
        inert={!props.open}
      >
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
  const toolCalls = trace?.toolCalls || [];
  const llmCalls = trace?.llmCalls || [];

  if (!props.turn) {
    return <p className="drawer-empty">Choose a turn to inspect its chain of decisions.</p>;
  }

  if (!toolCalls.length && !llmCalls.length) {
    return (
      <div className="drawer-empty">
        <p>No trace was captured for turn {props.turn.turn}.</p>
        <p>Enable trace capture in Session if you want per-step payloads.</p>
      </div>
    );
  }

  return (
    <div className="trace-stack">
      {llmCalls.map((call, index) => (
        <details key={`${call.agent}-${call.responseId || index}`} className="trace-step">
          <summary>
            <span className="trace-index">{index + 1}</span>
            <div>
              <strong>{call.agent}</strong>
              <span>{summarizeLLMTraceCall(call)}</span>
            </div>
          </summary>
          {call.reasoningHeadings?.length ? (
            <div className="trace-reasoning">
              <span className="detail-label">Reasoning</span>
              <ul>
                {call.reasoningHeadings.map(heading => <li key={heading}>{heading}</li>)}
              </ul>
            </div>
          ) : null}
        </details>
      ))}
      {toolCalls.map((call, index) => (
        <details key={`${call.tool}-${index}`} className="trace-step">
          <summary>
            <span className="trace-index">{llmCalls.length + index + 1}</span>
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
  startupWorldId: WorldId;
  debugTrace: boolean;
  apiBaseDraft: string;
  apiKeyDraft: string;
  advancedOpen: boolean;
  busy: boolean;
  onNarratorStyleChange: (value: NarratorStyle) => void;
  onStartupWorldChange: (value: WorldId) => void;
  onDebugTraceChange: (value: boolean) => void;
  onApiBaseChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onApplyRuntime: () => void;
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
      <DrawerSection title="World for new sessions">
        <div className="segmented-control">
          {([
            ['isle-of-marrow', 'Isle of Marrow'],
            ['tel-mora', 'Tel Mora'],
          ] as Array<[WorldId, string]>).map(([worldId, label]) => (
            <button
              key={worldId}
              type="button"
              className={worldId === props.startupWorldId ? 'active' : ''}
              onClick={() => props.onStartupWorldChange(worldId)}
              disabled={props.busy}
            >
              {label}
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
          <div className="advanced-fields">
            <label className="field-stack">
              <span className="detail-label">API base</span>
              <input
                value={props.apiBaseDraft}
                onChange={event => props.onApiBaseChange(event.target.value)}
                inputMode="url"
                spellCheck={false}
                disabled={props.busy}
              />
              <small>Use this when the Chronicle API is hosted on a different origin.</small>
            </label>
            <label className="field-stack">
              <span className="detail-label">OpenAI API key (optional)</span>
              <input
                type="password"
                value={props.apiKeyDraft}
                onChange={event => props.onApiKeyChange(event.target.value)}
                placeholder="Uses the server key when empty"
                autoComplete="off"
                spellCheck={false}
                disabled={props.busy}
              />
              <small>Kept only in this tab and sent to the Chronicle API for new sessions and turns.</small>
            </label>
            <button
              type="button"
              className="primary-button"
              onClick={props.onApplyRuntime}
              disabled={props.busy}
            >
              Apply and reconnect
            </button>
          </div>
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

function BootErrorScreen(props: { details: string | null; onRetry: () => void; onFresh: () => void }) {
  return (
    <section className="boot-error">
      <span className="eyebrow">Recovery</span>
      <h2>The shoreline is quiet.</h2>
      <p>Chronicle could not reach the local runtime. Retry when the API is available.</p>
      <div className="boot-error-actions">
        <button type="button" className="primary-button" onClick={props.onRetry}>Retry connection</button>
        <button type="button" className="text-button" onClick={props.onFresh}>Start a new session</button>
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

function readStoredSessionId(): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredSessionId(sessionId: string | null) {
  try {
    if (sessionId) window.sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    else window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Best effort only.
  }
}

function readStoredValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredValue(key: string, value: string | null) {
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Best effort only.
  }
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function summarizeLLMTraceCall(call: NonNullable<TurnTrace['llmCalls']>[number]): string {
  const parts = [
    call.status || 'completed',
    typeof call.toolCalls === 'number' ? `${call.toolCalls} tool calls` : null,
    typeof call.durationMs === 'number' ? `${call.durationMs}ms` : null,
  ].filter(Boolean);
  return parts.join(' · ');
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
