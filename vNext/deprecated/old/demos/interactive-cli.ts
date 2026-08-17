// interactive-cli.ts - Simple interactive CLI for Chronicle agent
import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createAgentExecutor } from '../agent/AgentOrchestrator.js';
import { createPagusClanisGTWG, createPagusClanisQueryAdapter } from '../data/PagusClanis.js';
import { createEmptyCanonLedger } from '../data/CanonLedger.js';

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not set. Export it and re-run.');
    process.exit(1);
  }

  // In-memory world state
  let gtwg = createPagusClanisGTWG();
  let ledger = createEmptyCanonLedger();
  let tick = 0;

  // Seed minimal PKG with origin/destination
  const knownCharacterId = 'gaius-aelius-secundus';
  const knownOriginId = 'villa-aelia';
  const knownDestinationId = 'mansio-vallis';
  let pkg = {
    discoveredFacts: [
      { entityId: knownCharacterId, discoveredAt: new Date().toISOString(), source: 'backstory' },
      { entityId: knownOriginId, discoveredAt: new Date().toISOString(), source: 'map' },
      { entityId: knownDestinationId, discoveredAt: new Date().toISOString(), source: 'map' },
    ],
    rumors: [],
    metadata: { version: '1.0.0', createdAt: new Date().toISOString(), lastModified: new Date().toISOString() },
  } as any;

  const conversation: string[] = []; // Fresh conversation for each run

  // Runtime deps
  function getCurrentLocationEntity(gtwgAny: any) {
    const player = (gtwgAny.entities || []).find((e: any) => e.id === 'player-1');
    const locId = player?.properties?.current_location;
    if (!locId) return null;
    return (gtwgAny.entities || []).find((e: any) => e.id === locId) || null;
  }

  const runtime = {
    getGTWG: () => gtwg,
    setGTWG: (g: any) => { gtwg = g; },
    getLedger: () => ledger,
    setLedger: (l: any) => { ledger = l; },
    getTick: () => tick,
    projectPKG: async ({ playerId, gtwg: _ }: { playerId: string; gtwg: any }) => {
      const locEntity = getCurrentLocationEntity(gtwg);
      if (locEntity && !pkg.discoveredFacts.some((f: any) => f.entityId === locEntity.id)) {
        pkg = {
          ...pkg,
          discoveredFacts: [
            ...pkg.discoveredFacts,
            { entityId: locEntity.id, discoveredAt: new Date().toISOString(), source: 'observation' }
          ],
          metadata: { ...(pkg.metadata || {}), lastModified: new Date().toISOString() }
        } as any;
      }
      return { pkg };
    },
    queryGTWG: createPagusClanisQueryAdapter(gtwg),
    getPKG: () => pkg,
    setPKG: (p: any) => { pkg = p; },
    queryPKG: async (query: Record<string, any>) => {
      // Return only entities the player knows, with fuzzy name search support
      const discovered = pkg.discoveredFacts
        .map((f: any) => gtwg.entities.find((e: any) => e.id === f.entityId))
        .filter(Boolean) as any[];
      // Special handling: resolve current location
      const resolveCurrentLocation = () => {
        const loc = getCurrentLocationEntity(gtwg);
        return loc ? { data: { entities: [loc] } } : { data: { entities: [] } };
      };
      if (typeof query === 'string') {
        const q = query.toLowerCase().trim();
        if (q === 'current location' || q.includes('where am i') || (q.includes('current') && q.includes('location'))) {
          return resolveCurrentLocation();
        }
        const exact = discovered.find(e => e.name.toLowerCase() === q || e.id === q);
        if (exact) return { data: { entities: [exact] } };
        const tokens = q.split(/[^a-z0-9]+/).filter(t => t.length >= 3);
        const scored = discovered
          .map(e => ({ e, score: tokens.filter(t => e.name.toLowerCase().includes(t)).length }))
          .filter(s => s.score > 0)
          .sort((a, b) => b.score - a.score);
        return { data: { entities: scored.length ? [scored[0].e] : [] } };
      }
      if (query && typeof query.search === 'string') {
        const q = String(query.search).toLowerCase().trim();
        if (q === 'current location' || q.includes('where am i') || (q.includes('current') && q.includes('location'))) {
          return resolveCurrentLocation();
        }
        const exact = discovered.find(e => e.name.toLowerCase() === q || e.id === q);
        if (exact) return { data: { entities: [exact] } };
        const tokens = q.split(/[^a-z0-9]+/).filter(t => t.length >= 3);
        const scored = discovered
          .map(e => ({ e, score: tokens.filter(t => e.name.toLowerCase().includes(t)).length }))
          .filter(s => s.score > 0)
          .sort((a, b) => b.score - a.score);
        return { data: { entities: scored.length ? [scored[0].e] : [] } };
      }
      return { data: { entities: discovered } };
    },
    getConversation: async (n: number) => conversation.slice(-n),
    getPlayerId: () => 'player-1',
  };

  const executor = await createAgentExecutor(runtime as any, { maxIterations: 8 });

  const rl = readline.createInterface({ input, output });
  console.log('Chronicle CLI ready. Type prompts. Type "exit" to quit.');
  console.log('Example: "Can I travel from Villa Aelia to Mansio Vallis?"');
  console.log('Starting fresh with knowledge of Villa Aelia and Mansio Vallis only.');

  while (true) {
    const userInput = await rl.question('> ');
    if (!userInput) continue;
    if (userInput.trim().toLowerCase() === 'exit') break;

    try {
      const recentConversation = await runtime.getConversation(10);
      const ctx = {
        playerId: runtime.getPlayerId(),
        tick,
        conversation: recentConversation,
        pkg,
      };
      const res = await executor.invoke({
        input: userInput,
        context: ctx,
        conversation: conversation.slice(-10).join('\n')
      } as any);
      const text = typeof res?.output === 'string' ? res.output : JSON.stringify(res);
      console.log(text);
      // Append to simple conversation log
      conversation.push(`User: ${userInput}`);
      conversation.push(`Assistant: ${text}`);
      tick += 1;
    } catch (err) {
      console.error('Error:', err);
    }
  }

  await rl.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

