// pagus-web-server.ts - Minimal HTTP server exposing Pagus agent over REST
// ========================================================================

import 'dotenv/config';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { createAgentExecutor } from '../agent/AgentOrchestrator.js';
import { createEmptyCanonLedger } from '../data/CanonLedger.js';
import { createPagusClanisGTWG, createPagusClanisQueryAdapter } from '../data/PagusClanis.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, 'pagus-web-client.html');
const port = Number(process.env.PORT) || 3000;

interface HistoryEntry {
  role: 'player' | 'agent';
  text: string;
}

interface RuntimeState {
  gtwg: any;
  ledger: any;
  tick: number;
  pkg: any;
  history: HistoryEntry[];
}

async function main() {
  const html = await readFile(htmlPath, 'utf8');

  // Shared in-memory world state (mirrors CLI demo)
  const state: RuntimeState = {
    gtwg: createPagusClanisGTWG(),
    ledger: createEmptyCanonLedger(),
    tick: 0,
    pkg: {
      discoveredFacts: [
        { entityId: 'gaius-aelius-secundus', discoveredAt: new Date().toISOString(), source: 'backstory' },
        { entityId: 'villa-aelia', discoveredAt: new Date().toISOString(), source: 'map' },
        { entityId: 'mansio-vallis', discoveredAt: new Date().toISOString(), source: 'map' },
      ],
      rumors: [],
      metadata: { version: '1.0.0', createdAt: new Date().toISOString(), lastModified: new Date().toISOString(), playerId: 'player-1' },
    },
    history: [],
  };

  const runtime = {
    getGTWG: () => state.gtwg,
    setGTWG: (g: any) => { state.gtwg = g; },
    getLedger: () => state.ledger,
    setLedger: (l: any) => { state.ledger = l; },
    getTick: () => state.tick,
    projectPKG: async ({ playerId }: { playerId: string; gtwg: any }) => {
      state.pkg.metadata.playerId = playerId;
      state.pkg.metadata.lastModified = new Date().toISOString();
      return { pkg: state.pkg };
    },
    queryGTWG: async (query: Record<string, any>) => {
      const adapter = createPagusClanisQueryAdapter(state.gtwg);
      return adapter(query);
    },
    queryPKG: async (query: Record<string, any>) => {
      const requestedType = typeof query === 'object' && (query as any)?.type ? (query as any).type : 'any';
      const discoveredEntities = (state.pkg.discoveredFacts || [])
        .map((f: any) => (state.gtwg.entities as any[]).find((e) => e.id === f.entityId))
        .filter(Boolean);
      let filtered = discoveredEntities;
      if (requestedType !== 'any') {
        if (requestedType === 'location' || requestedType === 'region') filtered = discoveredEntities.filter((e: any) => e.type === 'region');
        else if (requestedType === 'character' || requestedType === 'person') filtered = discoveredEntities.filter((e: any) => e.type === 'character');
      }
      return { data: { entities: filtered } };
    },
    getConversation: async (n: number) =>
      state.history.slice(-n).map((m) => `${m.role === 'player' ? 'Player' : 'Agent'}: ${m.text}`),
    getPlayerId: () => 'player-1',
    getPKG: () => state.pkg,
    setPKG: (pkg: any) => { state.pkg = pkg; },
  } as const;

  const status = {
    ready: Boolean(process.env.OPENAI_API_KEY),
    missingApiKey: !process.env.OPENAI_API_KEY,
  };

  const executor = status.ready ? await createAgentExecutor(runtime as any, { maxIterations: 12 }) : null;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!req.url) {
        res.writeHead(400).end('Bad Request');
        return;
      }
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      if (req.method === 'GET' && req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
        return;
      }
      if (req.method === 'POST' && req.url === '/api/message') {
        if (!executor) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Agent unavailable. Set OPENAI_API_KEY.' }));
          return;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        let message = '';
        try {
          const parsed = JSON.parse(raw);
          message = typeof parsed?.message === 'string' ? parsed.message.trim() : '';
        } catch {
          // fallthrough
        }
        if (!message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Missing message' }));
          return;
        }

        state.history.push({ role: 'player', text: message });
        const conversation = await runtime.getConversation(10);
        const context = { playerId: runtime.getPlayerId(), tick: state.tick, conversation, pkg: state.pkg };
        const transcript = conversation.join('\n');
        const composed = transcript ? `${transcript}\nPlayer: ${message}` : message;

        let result: any;
        try {
          result = await executor.invoke({ input: composed, context } as any);
        } catch (error: unknown) {
          state.history.pop(); // rollback player message on failure
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Agent error' }));
          return;
        }

        const text = typeof result?.output === 'string' ? result.output : JSON.stringify(result);
        state.history.push({ role: 'agent', text });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          reply: text,
          steps: result?.intermediateSteps ?? [],
          history: state.history,
        }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    } catch (error) {
      console.error('Server error:', error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  });

  server.listen(port, () => {
    console.log(`Pagus web demo listening on http://localhost:${port}`);
    if (!status.ready) {
      console.log('Note: OPENAI_API_KEY not set; POST /api/message will return an error.');
    }
  });
}

main().catch((err) => {
  console.error('Failed to start web demo:', err);
  process.exit(1);
});
