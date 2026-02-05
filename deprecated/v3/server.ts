import 'dotenv/config';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { createIsleOfMarrowWorld, type SimpleWorld } from './state/world';
import { createToolRuntime } from './tools/index';
import type { Patch } from './tools/types';
import { applyPatches } from './state/arbiter';
import { runGMAgentTurn, type GMEvent } from './agents/gm';
import { runNarratorTurn, type ConversationHistoryEntry, generateInitialNarration } from './agents/narrator';
import { projectPKGFromGraph } from './state/pkg';
import type { ProjectedPKG } from './state/pkg';
import { buildTurnTelemetry, type TurnTelemetry } from './state/telemetry';
import { computeSystemPatches } from './state/systems/scheduler';
import { registerCoreSystems } from './state/systems/core';
import { NARRATOR_DEFAULT_STYLE, GM_MODEL } from './config';

// Initialize systems
registerCoreSystems();

interface Session {
  world: SimpleWorld;
  conversationHistory: ConversationHistoryEntry[];
  latent: { label: string; dir?: 'north' | 'south' | 'east' | 'west'; ttl: number }[];
  lastStateSummary: any;
  narratorStyle: 'lyric' | 'cinematic' | 'michener';
}

const sessions = new Map<string, Session>();

function createSession(sessionId: string): Session {
  const session: Session = {
    world: createIsleOfMarrowWorld(),
    conversationHistory: [],
    latent: [],
    lastStateSummary: null,
    narratorStyle: NARRATOR_DEFAULT_STYLE,
  };
  sessions.set(sessionId, session);
  return session;
}

function getSession(sessionId: string): Session {
  let session = sessions.get(sessionId);
  if (!session) {
    session = createSession(sessionId);
  }
  return session;
}

function resolveSession(options?: { sessionId?: string; reset?: boolean; forceNew?: boolean }) {
  const trimmed = options?.sessionId?.trim();
  let sessionId = trimmed && trimmed.length ? trimmed : '';

  if ((options?.reset || options?.forceNew) && sessionId) {
    sessions.delete(sessionId);
  }

  if (!sessionId || options?.forceNew) {
    sessionId = makeSessionId();
    const session = createSession(sessionId);
    return { sessionId, session, created: true };
  }

  const existed = sessions.has(sessionId);
  const session = getSession(sessionId);
  return { sessionId, session, created: !existed };
}

function cloneWorld(world: SimpleWorld): SimpleWorld {
  return JSON.parse(JSON.stringify(world)) as SimpleWorld;
}

function summarizeWorld(world: SimpleWorld) {
  const locId = world.player.location;
  const location = world.locations[locId];
  return {
    location: locId,
    locationName: location?.name || locId,
    position: world.player.pos,
    inventory: world.player.inventory || [],
  };
}

function makeSessionId(): string {
  return `session-${randomUUID()}`;
}

function resolveApiKey(requestKey?: string): string | undefined {
  return requestKey || process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || undefined;
}

type TurnPhase = 'gm_start' | 'gm_complete' | 'narrator_start' | 'narrator_complete';

interface ExecuteTurnOptions {
  session: Session;
  playerText: string;
  apiKey?: string;
  onPhaseChange?: (phase: TurnPhase) => void;
  onGmEvent?: (event: GMEvent) => void;
}

interface ExecuteTurnResult extends TurnResponse {
  usedFallback: boolean;
}

async function buildInitPayload(session: Session, apiKey?: string): Promise<InitResponse> {
  const effectiveApiKey = resolveApiKey(apiKey);
  const initialNarration = await generateInitialNarration({
    apiKey: effectiveApiKey,
    world: session.world,
  });

  const telemetry = buildTurnTelemetry(session.world);
  const pkg = projectPKGFromGraph(session.world);

  return {
    initialNarration,
    world: summarizeWorld(session.world),
    telemetry,
    pkg,
  };
}

async function executeTurn(options: ExecuteTurnOptions): Promise<ExecuteTurnResult> {
  const { session, playerText, apiKey, onPhaseChange, onGmEvent } = options;
  const effectiveApiKey = resolveApiKey(apiKey);

  let shadowWorld = cloneWorld(session.world);
  const runtime = createToolRuntime(() => shadowWorld, (w) => {
    shadowWorld = w;
  });
  const gmConversationHistory = session.conversationHistory
    .slice(-5)
    .map((entry) => ({ playerInput: entry.playerInput, gmOutput: entry.gmOutput }));

  onPhaseChange?.('gm_start');
  const gm = await runGMAgentTurn({
    apiKey: effectiveApiKey,
    model: GM_MODEL,
    runtime,
    playerText,
    world: session.world,
    latent: session.latent.map((h) => ({ label: h.label, dir: h.dir })),
    conversationHistory: gmConversationHistory,
    onEvent: (event) => onGmEvent?.(event),
  });
  onPhaseChange?.('gm_complete');

  let finalWorld = session.world;
  if (gm.usedFallback) {
    if (gm.result.patches.length) {
      finalWorld = applyPatches(session.world, gm.result.patches as Patch[], 'GM fallback patch');
    }
  } else {
    // REFACTOR: Reactive Systems Integration
    // Instead of just using the shadowWorld (which only has GM patches),
    // we re-apply GM patches + computed system patches to the *original* world.
    // This ensures system reactions (like tide changes) are included in the final state.

    // 1. Get GM patches
    const gmPatches = gm.result.patches as Patch[];

    // 2. Compute system patches (reacting to GM's time changes)
    const systemPatches = computeSystemPatches(session.world, gmPatches);
    
    // 3. Combine all patches
    // GM patches come first (cause), System patches come second (effect)
    const allPatches = [...gmPatches, ...systemPatches];

    // 4. Apply everything to produce the final authoritative world
    // Note: 'shadowWorld' from the runtime is discarded in favor of this clean re-application
    finalWorld = applyPatches(session.world, allPatches, 'Turn Update');
  }

  session.world = finalWorld;
  session.lastStateSummary = gm.result.stateSummary ?? null;

  const telemetry = buildTurnTelemetry(finalWorld);
  const pkg = projectPKGFromGraph(finalWorld);

  const conversationHistory: ConversationHistoryEntry[] = session.conversationHistory
    .slice(-5)
    .map((entry) => ({
      playerInput: entry.playerInput,
      gmOutput: entry.gmOutput,
      patches: entry.patches,
      timestamp: entry.timestamp,
    }));

  onPhaseChange?.('narrator_start');
  const narration = await runNarratorTurn({
    apiKey: effectiveApiKey,
    playerText,
    world: finalWorld,
    patches: gm.result.patches as Patch[],
    stateSummary: gm.result.stateSummary,
    pkg,
    conversationHistory,
    style: session.narratorStyle,
    telemetry,
  });
  onPhaseChange?.('narrator_complete');

  session.conversationHistory.push({
    playerInput: playerText,
    gmOutput: narration,
    patches: gm.result.patches as Patch[],
    timestamp: new Date(),
  });
  if (session.conversationHistory.length > 20) {
    session.conversationHistory.splice(0, session.conversationHistory.length - 20);
  }

  return {
    narration,
    world: summarizeWorld(finalWorld),
    patches: gm.result.patches as Patch[],
    stateSummary: gm.result.stateSummary,
    telemetry,
    pkg,
    usedFallback: gm.usedFallback,
  };
}

interface TurnRequest {
  playerText: string;
  apiKey?: string;
  sessionId?: string;
}

interface TurnResponse {
  narration: string;
  world: {
    location: string;
    locationName: string;
    position: { x: number; y: number; z?: number };
    inventory: { id: string; name: string }[];
  };
  patches: Patch[];
  stateSummary: any;
  telemetry: TurnTelemetry;
  pkg: ProjectedPKG;
}

async function handleTurn(req: TurnRequest): Promise<TurnResponse> {
  if (!req.playerText || !req.playerText.trim()) {
    throw new Error('playerText is required');
  }
  const sessionId = req.sessionId || 'default';
  const session = getSession(sessionId);
  const result = await executeTurn({
    session,
    playerText: req.playerText,
    apiKey: req.apiKey,
  });
  return result;
}

interface InitRequest {
  apiKey?: string;
  sessionId?: string;
}

interface InitResponse {
  initialNarration: string;
  world: {
    location: string;
    locationName: string;
    position: { x: number; y: number; z?: number };
  };
  telemetry: TurnTelemetry;
  pkg: ProjectedPKG;
}

interface SessionInitResponse extends InitResponse {
  sessionId: string;
  created: boolean;
}

interface SessionRequestBody {
  sessionId?: string;
  apiKey?: string;
  reset?: boolean;
}

async function handleInit(req: InitRequest): Promise<InitResponse> {
  const sessionId = req.sessionId || 'default';
  const session = getSession(sessionId);
  return buildInitPayload(session, req.apiKey);
}

async function handleSessionRequest(body: SessionRequestBody): Promise<SessionInitResponse> {
  const wantsReset = Boolean(body?.reset);
  const resolved = resolveSession({
    sessionId: body?.sessionId,
    reset: wantsReset,
    forceNew: !body?.sessionId,
  });
  const init = await buildInitPayload(resolved.session, body?.apiKey);
  return {
    sessionId: resolved.sessionId,
    created: resolved.created,
    ...init,
  };
}

async function handleChatStream(
  body: TurnRequest & { resetSession?: boolean },
  req: http.IncomingMessage,
  res: http.ServerResponse
) {
  const playerText = (body.playerText || '').trim();
  if (!playerText) {
    sendError(res, 400, 'playerText is required');
    return;
  }

  const resolved = resolveSession({
    sessionId: body?.sessionId,
    reset: Boolean(body?.resetSession),
    forceNew: !body?.sessionId && Boolean(body?.resetSession),
  });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  const sendEvent = (event: string, data: any) => {
    if (closed || res.writableEnded) return;
    const chunk = [`event: ${event}`, `data: ${JSON.stringify(data)}`, '\n'].join('\n');
    res.write(chunk);
  };

  sendEvent('session', { sessionId: resolved.sessionId, created: resolved.created });

  try {
    const result = await executeTurn({
      session: resolved.session,
      playerText,
      apiKey: body.apiKey,
      onPhaseChange: (phase) => sendEvent('phase', { phase }),
      onGmEvent: (event) => {
        if (event.type === 'llm_token') {
          sendEvent('gm_token', { token: event.token });
        } else {
          sendEvent('gm_event', event);
        }
      },
    });

    sendEvent('result', result);
    sendEvent('complete', { ok: true });
  } catch (err) {
    sendEvent('error', { message: err instanceof Error ? err.message : 'Unknown error' });
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
}

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function sendError(res: http.ServerResponse, status: number, message: string) {
  sendJSON(res, status, { error: message });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  try {
    if (path === '/api/session' && method === 'POST') {
      const body = await parseBody(req);
      const result = await handleSessionRequest(body);
      sendJSON(res, 200, result);
    } else if (path === '/api/chat' && method === 'POST') {
      const body = await parseBody(req);
      await handleChatStream(body, req, res);
    } else if (path === '/api/turn' && method === 'POST') {
      const body = await parseBody(req);
      const result = await handleTurn(body);
      sendJSON(res, 200, result);
    } else if (path === '/api/init' && method === 'POST') {
      const body = await parseBody(req);
      const result = await handleInit(body);
      sendJSON(res, 200, result);
    } else if (path === '/api/reset' && method === 'POST') {
      const body = await parseBody(req);
      const sessionId = body.sessionId || 'default';
      sessions.delete(sessionId);
      sendJSON(res, 200, { ok: true });
    } else if (path === '/health' && method === 'GET') {
      sendJSON(res, 200, { status: 'ok', sessions: sessions.size });
    } else {
      sendError(res, 404, 'Not found');
    }
  } catch (err) {
    console.error('Server error:', err);
    sendError(res, 500, err instanceof Error ? err.message : 'Internal server error');
  }
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

server.listen(PORT, () => {
  console.log(`Chronicle v3 API server running on http://localhost:${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  POST /api/init - Initialize a new session`);
  console.log(`  POST /api/turn - Process a player turn`);
  console.log(`  POST /api/reset - Reset a session`);
  console.log(`  GET  /health - Health check`);
});
