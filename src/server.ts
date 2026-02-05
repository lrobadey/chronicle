/**
 * Chronicle v4 - API Server
 * 
 * Simplified HTTP API for web UI integration.
 */

import 'dotenv/config';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';

import { createIsleOfMarrowWorld } from './worlds/isle-of-marrow';
import { runGMTurn, createGMRuntime } from './gm';
import { narrate, generateInitialNarration, type NarratorStyle } from './narrator';
import { applyPatches, computeSystemPatches, type Patch } from './core/arbiter';
import { buildTelemetry, type Telemetry } from './core/systems';
import { projectPKG, type PKG } from './core/graph';
import type { World } from './core/world';

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

interface Session {
  world: World;
  style: NarratorStyle;
}

const sessions = new Map<string, Session>();

function getOrCreateSession(sessionId?: string): { session: Session; id: string; created: boolean } {
  if (sessionId && sessions.has(sessionId)) {
    return { session: sessions.get(sessionId)!, id: sessionId, created: false };
  }

  const id = sessionId || `session-${randomUUID()}`;
  const session: Session = {
    world: createIsleOfMarrowWorld(),
    style: 'michener',
  };
  sessions.set(id, session);
  return { session, id, created: true };
}

// ============================================================================
// API HANDLERS
// ============================================================================

interface InitResponse {
  sessionId: string;
  created: boolean;
  initialNarration: string;
  telemetry: Telemetry;
  pkg: PKG;
}

async function handleInit(body: { sessionId?: string; apiKey?: string }): Promise<InitResponse> {
  const apiKey = body.apiKey || process.env.OPENAI_API_KEY;
  const { session, id, created } = getOrCreateSession(body.sessionId);

  const initialNarration = await generateInitialNarration({
    apiKey,
    world: session.world,
  });

  return {
    sessionId: id,
    created,
    initialNarration,
    telemetry: buildTelemetry(session.world),
    pkg: projectPKG(session.world),
  };
}

interface TurnResponse {
  narration: string;
  telemetry: Telemetry;
  pkg: PKG;
  patches: Patch[];
}

async function handleTurn(body: { sessionId?: string; playerText: string; apiKey?: string }): Promise<TurnResponse> {
  if (!body.playerText?.trim()) {
    throw new Error('playerText is required');
  }

  const apiKey = body.apiKey || process.env.OPENAI_API_KEY;
  const { session, id } = getOrCreateSession(body.sessionId);

  const { runtime, getWorld } = createGMRuntime(session.world);

  // Run GM
  const gm = await runGMTurn({
    apiKey,
    world: session.world,
    playerText: body.playerText,
    runtime,
  });

  // Get final world state
  let finalWorld = getWorld();

  // Apply system patches
  if (gm.result.patches.length) {
    const systemPatches = computeSystemPatches(finalWorld, gm.result.patches);
    if (systemPatches.length) {
      finalWorld = applyPatches(finalWorld, systemPatches, 'System reaction');
    }
  }

  session.world = finalWorld;

  // Generate narration
  const telemetry = buildTelemetry(finalWorld);
  const narration = await narrate({
    apiKey,
    world: finalWorld,
    playerText: body.playerText,
    patches: gm.result.patches as Patch[],
    style: session.style,
    telemetry,
  });

  return {
    narration,
    telemetry,
    pkg: projectPKG(finalWorld),
    patches: gm.result.patches as Patch[],
  };
}

function handleReset(body: { sessionId?: string }): { ok: true } {
  if (body.sessionId) {
    sessions.delete(body.sessionId);
  }
  return { ok: true };
}

// ============================================================================
// HTTP SERVER
// ============================================================================

async function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function sendError(res: http.ServerResponse, status: number, message: string) {
  sendJSON(res, status, { error: message });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  // CORS preflight
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
    if (path === '/api/init' && method === 'POST') {
      const body = await parseBody(req) as { sessionId?: string; apiKey?: string };
      const result = await handleInit(body);
      sendJSON(res, 200, result);
    } 
    else if (path === '/api/turn' && method === 'POST') {
      const body = await parseBody(req) as { sessionId?: string; playerText: string; apiKey?: string };
      const result = await handleTurn(body);
      sendJSON(res, 200, result);
    } 
    else if (path === '/api/reset' && method === 'POST') {
      const body = await parseBody(req) as { sessionId?: string };
      const result = handleReset(body);
      sendJSON(res, 200, result);
    } 
    else if (path === '/health' && method === 'GET') {
      sendJSON(res, 200, { status: 'ok', sessions: sessions.size });
    } 
    else {
      sendError(res, 404, 'Not found');
    }
  } catch (err) {
    console.error('Server error:', err);
    sendError(res, 500, err instanceof Error ? err.message : 'Internal error');
  }
});

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

server.listen(PORT, () => {
  console.log(`Chronicle v4 API running on http://localhost:${PORT}`);
  console.log('Endpoints: POST /api/init, POST /api/turn, POST /api/reset, GET /health');
});

