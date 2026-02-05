// server.ts - Minimal HTTP server exposing the V2 agent via POST /agent
// =====================================================================

import 'dotenv/config';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createAgentExecutor, runAgentTurn } from './agent/AgentOrchestrator.js';
import { createPagusClanisGTWG, createPagusClanisQueryAdapter } from './data/PagusClanis.js';
import { createEmptyCanonLedger } from './data/CanonLedger.js';

type HistoryEntry = { role: 'player' | 'agent'; text: string };

const PORT = Number(process.env.AGENT_SERVER_PORT || 8787);

// In-memory demo state (per-process)
const state = {
  gtwg: createPagusClanisGTWG(),
  ledger: createEmptyCanonLedger(),
  tick: 0,
  pkg: {
    discoveredFacts: [
      { entityId: 'villa-aelia', discoveredAt: new Date().toISOString(), source: 'demo-seed' },
      { entityId: 'mansio-vallis', discoveredAt: new Date().toISOString(), source: 'demo-seed' },
      { entityId: 'gaius-aelius-secundus', discoveredAt: new Date().toISOString(), source: 'demo-seed' },
    ],
    rumors: [],
    metadata: { version: '1.0.0', createdAt: new Date().toISOString(), lastModified: new Date().toISOString(), playerId: 'player-1' },
  } as any,
  history: [] as HistoryEntry[],
};

const runtime = {
  getGTWG: () => state.gtwg,
  setGTWG: (g: any) => { state.gtwg = g; },
  getLedger: () => state.ledger,
  setLedger: (l: any) => { state.ledger = l; },
  getTick: () => state.tick,
  projectPKG: async ({ playerId }: { playerId: string }) => {
    state.pkg.metadata.playerId = playerId;
    state.pkg.metadata.lastModified = new Date().toISOString();
    return { pkg: state.pkg };
  },
  queryGTWG: async (query: Record<string, any>) => {
    const adapter = createPagusClanisQueryAdapter(state.gtwg);
    return adapter(query);
  },
  queryPKG: async (_query: Record<string, any>) => ({ data: { entities: state.pkg.discoveredFacts } }),
  getPKG: () => state.pkg,
  setPKG: (pkg: any) => { state.pkg = pkg; },
  getConversation: async (n: number) => state.history.slice(-n).map((m) => `${m.role === 'player' ? 'Player' : 'Agent'}: ${m.text}`),
  getPlayerId: () => 'player-1',
};

let executorPromise: Promise<ReturnType<typeof createAgentExecutor>> | null = null;
function getExecutor() {
  if (!executorPromise) {
    if (!process.env.OPENAI_API_KEY) {
      // Defer error to request time; allow the server to boot
      executorPromise = Promise.reject(new Error('OPENAI_API_KEY not set'));
    } else {
      executorPromise = createAgentExecutor(runtime as any, { maxIterations: 10 });
    }
  }
  return executorPromise;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    });
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/agent/stream') {
    // Server-Sent Events streaming endpoint
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', async () => {
      const write = (data: string) => {
        res.write(`data: ${data}\n\n`);
      };
      try {
        const parsed = raw ? JSON.parse(raw) : {};
        const message = String(parsed?.message || '').trim();
        if (!message) {
          write(JSON.stringify({ error: 'Missing message' }));
          res.end();
          return;
        }
        let exec: Awaited<ReturnType<typeof createAgentExecutor>>;
        try {
          exec = await getExecutor();
        } catch {
          write(JSON.stringify({ error: 'Agent unavailable. Set OPENAI_API_KEY and restart.' }));
          res.end();
          return;
        }
        state.history.push({ role: 'player', text: message });
        const context = {
          playerId: runtime.getPlayerId?.() || 'player-1',
          tick: state.tick,
          conversation: await runtime.getConversation(10),
          pkg: state.pkg,
          gtwg: state.gtwg,
        };
        // For now, stream only the final narrative once available; LangChain ReAct tool output
        // is verbose, so we avoid streaming intermediate tokens until we add filtering.
        const result = await runAgentTurn(exec, { playerInput: message, context });
        const narrative = result.narrative || '';
        state.history.push({ role: 'agent', text: narrative });
        state.tick += 1;
        write(JSON.stringify({ narrative }));
      } catch (err: any) {
        write(JSON.stringify({ error: err?.message || String(err) }));
      } finally {
        res.write('event: end\n');
        res.write('data: end\n\n');
        res.end();
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url && req.url === '/agent') {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', async () => {
      try {
        const parsed = raw ? JSON.parse(raw) : {};
        const message = String(parsed?.message || '').trim();
        if (!message) {
          sendJson(res, 400, { error: 'Missing message' });
          return;
        }

        // Initialize executor (or surface helpful error)
        let exec: Awaited<ReturnType<typeof createAgentExecutor>>;
        try {
          exec = await getExecutor();
        } catch (e: any) {
          sendJson(res, 503, { error: 'Agent unavailable. Set OPENAI_API_KEY in environment and restart server.' });
          return;
        }

        state.history.push({ role: 'player', text: message });
        const context = {
          playerId: runtime.getPlayerId?.() || 'player-1',
          tick: state.tick,
          conversation: await runtime.getConversation(10),
          pkg: state.pkg,
          gtwg: state.gtwg,
        };
        const result = await runAgentTurn(exec, { playerInput: message, context });
        const narrative = result.narrative || '';
        state.history.push({ role: 'agent', text: narrative });
        state.tick += 1;
        sendJson(res, 200, { narrative, intermediateSteps: result.intermediateSteps });
      } catch (err: any) {
        sendJson(res, 500, { error: err?.message || String(err) });
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/') {
    sendJson(res, 200, { ok: true, service: 'chronicle-v2-agent', endpoints: ['POST /agent'] });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end('Not found');
});

server.listen(PORT, () => {
  const addr = server.address() as AddressInfo | null;
  const port = addr?.port ?? PORT;
  // eslint-disable-next-line no-console
  console.log(`V2 agent server listening on http://localhost:${port}`);
});


