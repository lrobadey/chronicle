/**
 * Chronicle vNext - API Server
 */

import 'dotenv/config';
import http from 'node:http';
import { URL } from 'node:url';
import { TurnEngine } from './engine/turnEngine';
import { InputValidationError, isChronicleError } from './engine/errors';

async function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new InputValidationError('Invalid JSON body'));
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

function sendError(res: http.ServerResponse, status: number, code: string, message: string, details?: unknown) {
  sendJSON(res, status, { error: message, code, details });
}

function assertObject(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputValidationError('Request body must be a JSON object');
  }
}

function asOptionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new InputValidationError('Expected string value');
  return value;
}

function asNarratorStyle(value: unknown): 'lyric' | 'cinematic' | 'michener' | undefined {
  if (value == null) return undefined;
  if (value === 'lyric' || value === 'cinematic' || value === 'michener') return value;
  throw new InputValidationError('narratorStyle must be one of lyric|cinematic|michener');
}

function asDebug(value: unknown): { includeTrace?: boolean } | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputValidationError('debug must be an object');
  }
  const includeTrace = (value as Record<string, unknown>).includeTrace;
  if (includeTrace != null && typeof includeTrace !== 'boolean') {
    throw new InputValidationError('debug.includeTrace must be a boolean');
  }
  return { includeTrace: includeTrace as boolean | undefined };
}

export function createChronicleServer(engine = new TurnEngine()) {
  return http.createServer(async (req, res) => {
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
      if (path === '/api/init' && method === 'POST') {
        const body = await parseBody(req);
        assertObject(body);
        const sessionId = asOptionalString(body.sessionId);
        const apiKey = asOptionalString(body.apiKey);

        const result = await engine.initSession({ sessionId, apiKey: apiKey || process.env.OPENAI_API_KEY });
        sendJSON(res, 200, {
          sessionId: result.sessionId,
          created: result.created,
          initialNarration: result.opening,
          telemetry: result.telemetry,
          runtime: 'vnext',
        });
        return;
      }

      if (path === '/api/turn' && method === 'POST') {
        const body = await parseBody(req);
        assertObject(body);

        const sessionId = asOptionalString(body.sessionId);
        const playerText = asOptionalString(body.playerText);
        if (!sessionId?.trim()) throw new InputValidationError('sessionId is required');
        if (!playerText?.trim()) throw new InputValidationError('playerText is required');

        const result = await engine.runTurn({
          sessionId,
          playerId: 'player-1',
          playerText,
          apiKey: asOptionalString(body.apiKey) || process.env.OPENAI_API_KEY,
          narratorStyle: asNarratorStyle(body.narratorStyle),
          debug: asDebug(body.debug),
        });
        sendJSON(res, 200, result);
        return;
      }

      if (path === '/health' && method === 'GET') {
        sendJSON(res, 200, { status: 'ok', runtime: 'vnext' });
        return;
      }

      sendError(res, 404, 'not_found', 'Not found');
    } catch (err) {
      if (isChronicleError(err)) {
        sendError(res, err.status, err.code, err.message, err.details);
        return;
      }
      console.error('Server error:', err);
      sendError(res, 500, 'internal_error', err instanceof Error ? err.message : 'Internal error');
    }
  });
}

export function startServer(port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001) {
  const server = createChronicleServer();
  server.listen(port, () => {
    console.log(`Chronicle vNext API running on http://localhost:${port}`);
    console.log('Endpoints: POST /api/init, POST /api/turn, GET /health');
  });
  return server;
}

const isDirectExecution = !!process.argv[1] && /(^|\/)server\.(ts|js)$/.test(process.argv[1]);
if (isDirectExecution) {
  startServer();
}
