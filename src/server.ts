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

function sendSSEHeaders(res: http.ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
}

function writeSSE(res: http.ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
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

function asOptionalBoolean(value: unknown): boolean | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'boolean') throw new InputValidationError('Expected boolean value');
  return value;
}

function asNarratorStyle(value: unknown): 'lyric' | 'cinematic' | 'michener' | undefined {
  if (value == null) return undefined;
  if (value === 'lyric' || value === 'cinematic' || value === 'michener') return value;
  throw new InputValidationError('narratorStyle must be one of lyric|cinematic|michener');
}

function asDebug(value: unknown): { includeTrace?: boolean; metaMode?: boolean } | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputValidationError('debug must be an object');
  }
  const includeTrace = (value as Record<string, unknown>).includeTrace;
  const metaMode = (value as Record<string, unknown>).metaMode;
  if (includeTrace != null && typeof includeTrace !== 'boolean') {
    throw new InputValidationError('debug.includeTrace must be a boolean');
  }
  if (metaMode != null && typeof metaMode !== 'boolean') {
    throw new InputValidationError('debug.metaMode must be a boolean');
  }
  return { includeTrace: includeTrace as boolean | undefined, metaMode: metaMode as boolean | undefined };
}

function normalizeError(err: unknown): { status: number; code: string; error: string; details?: unknown } {
  if (isChronicleError(err)) {
    return {
      status: err.status,
      code: err.code,
      error: err.message,
      details: err.details,
    };
  }
  return {
    status: 500,
    code: 'internal_error',
    error: err instanceof Error ? err.message : 'Internal error',
  };
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
        const stream = asOptionalBoolean(body.stream) === true;

        if (!stream) {
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

        sendSSEHeaders(res);
        let connectionClosed = false;
        req.on('close', () => {
          connectionClosed = true;
        });
        writeSSE(res, 'init.started', { sessionId: sessionId || undefined });
        const result = await engine.initSession({
          sessionId,
          apiKey: apiKey || process.env.OPENAI_API_KEY,
          stream: {
            onOpeningDelta: delta => {
              if (!connectionClosed) {
                writeSSE(res, 'opening.delta', { delta });
              }
            },
          },
        });
        writeSSE(res, 'init.completed', {
          sessionId: result.sessionId,
          created: result.created,
          initialNarration: result.opening,
          telemetry: result.telemetry,
          runtime: 'vnext',
        });
        res.end();
        return;
      }

      if (path === '/api/turn' && method === 'POST') {
        const body = await parseBody(req);
        assertObject(body);

        const sessionId = asOptionalString(body.sessionId);
        const playerText = asOptionalString(body.playerText);
        const stream = asOptionalBoolean(body.stream) === true;
        if (!sessionId?.trim()) throw new InputValidationError('sessionId is required');
        if (!playerText?.trim()) throw new InputValidationError('playerText is required');

        if (!stream) {
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

        sendSSEHeaders(res);
        let connectionClosed = false;
        req.on('close', () => {
          connectionClosed = true;
        });
        writeSSE(res, 'turn.started', { sessionId });
        const result = await engine.runTurn({
          sessionId,
          playerId: 'player-1',
          playerText,
          apiKey: asOptionalString(body.apiKey) || process.env.OPENAI_API_KEY,
          narratorStyle: asNarratorStyle(body.narratorStyle),
          debug: asDebug(body.debug),
          stream: {
            onNarrationDelta: delta => {
              if (!connectionClosed) {
                writeSSE(res, 'narration.delta', { delta });
              }
            },
          },
        });
        writeSSE(res, 'turn.completed', result);
        res.end();
        return;
      }

      if (path === '/health' && method === 'GET') {
        sendJSON(res, 200, { status: 'ok', runtime: 'vnext' });
        return;
      }

      sendError(res, 404, 'not_found', 'Not found');
    } catch (err) {
      const normalized = normalizeError(err);
      if (res.getHeader('Content-Type') === 'text/event-stream') {
        writeSSE(res, 'error', {
          code: normalized.code,
          error: normalized.error,
          details: normalized.details,
        });
        res.end();
        return;
      }
      if (normalized.status === 500) {
        console.error('Server error:', err);
      }
      sendError(res, normalized.status, normalized.code, normalized.error, normalized.details);
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
