// time-advancement-demo.ts - Test the new time advancement tool
// =============================================================

import 'dotenv/config';
import { createAgentExecutor } from '../agent/AgentOrchestrator.js';
import { createEmptyCanonLedger } from '../data/CanonLedger.js';
import type { AgentInputs } from '../agent/types.js';
import { createPagusClanisGTWG, createPagusClanisQueryAdapter } from '../data/PagusClanis.js';

async function main() {
  console.log('=== Time Advancement Tool Demo ===\n');

  // In-memory world state
  let gtwg = createPagusClanisGTWG();
  let ledger = createEmptyCanonLedger();
  let tick = 0;

  // Set initial world time
  gtwg = {
    ...gtwg,
    metadata: {
      ...gtwg.metadata,
      worldTime: '2024-03-15T08:00:00.000Z' // 8:00 AM
    }
  };

  // Seed a minimal PKG: player knows the origin and destination locations
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

  // Runtime deps
  const runtime = {
    getGTWG: () => gtwg,
    setGTWG: (g: any) => { gtwg = g; },
    getLedger: () => ledger,
    setLedger: (l: any) => { ledger = l; },
    getTick: () => tick,
    projectPKG: async ({ playerId, gtwg: _ }: { playerId: string; gtwg: any }) => ({ pkg }),
    queryGTWG: createPagusClanisQueryAdapter(gtwg),
    queryPKG: async (query: Record<string, any>): Promise<any> => {
      const queryStr = typeof query === 'string' ? query : JSON.stringify(query);
      
      let requestedType = 'any';
      if (typeof query === 'object' && query.type) {
        requestedType = query.type;
      }
      
      const discoveredEntities = pkg.discoveredFacts.map((fact: any) => {
        const entity = gtwg.entities.find((e: any) => e.id === fact.entityId);
        return entity;
      }).filter(Boolean);
      
      let filteredEntities = discoveredEntities;
      if (requestedType !== 'any') {
        if (requestedType === 'location' || requestedType === 'region') {
          filteredEntities = discoveredEntities.filter((e: any) => e?.type === 'region');
        } else if (requestedType === 'character' || requestedType === 'person') {
          filteredEntities = discoveredEntities.filter((e: any) => e?.type === 'character');
        }
      }
      
      return {
        data: {
          entities: filteredEntities
        }
      };
    },
    getConversation: async (_n: number) => [],
    getPlayerId: () => 'player-1',
  };

  // Show initial state
  console.log('Initial world time:', gtwg.metadata?.worldTime);
  console.log('Current time:', new Date(gtwg.metadata?.worldTime).toLocaleString());
  console.log('');

  // Test 1: Simple time advancement
  console.log('=== Test 1: Simple Time Advancement ===');
  const inputs1: any = {
    playerInput: 'I wait for four hours',
    context: {
      playerId: 'player-1',
      tick,
      conversation: [],
      pkg: pkg,
    },
  };

  if (!process.env.OPENAI_API_KEY) {
    console.log('Skipping agent execution (OPENAI_API_KEY not set). Running tool test only...');
    
    // Test the tool directly
    const { createAdvanceTimeTool } = await import('../agent/tools.js');
    const advanceTimeTool = createAdvanceTimeTool(runtime as any);
    
    console.log('\n--- Direct Tool Test ---');
    const result = await advanceTimeTool.call({ minutes: 240, reason: 'Player waiting' });
    console.log('Tool result:', JSON.stringify(result, null, 2));
    
    if (result.success) {
      console.log('\nPatches generated:', result.patches);
      console.log('Time advanced by:', result.timeAdvanced.timeDescription);
      console.log('New time would be:', result.timeAdvanced.newTime);
    }
    
    return;
  }

  const executor = await createAgentExecutor(runtime, { maxIterations: 6 });

  console.log('Running agent with input:', inputs1.playerInput);
  const result1 = await executor.call({
    input: inputs1.playerInput,
    conversation: inputs1.context.conversation.join('\n'),
    context: inputs1.context
  } as any);
  console.log('\n=== Agent Output ===');
  console.log(result1.output);

  // Test 2: Time advancement with other actions
  console.log('\n=== Test 2: Time Advancement with Search ===');
  const inputs2: any = {
    playerInput: 'I thoroughly search the villa for any hidden compartments or secret passages',
    context: {
      playerId: 'player-1',
      tick,
      conversation: [],
      pkg: pkg,
    },
  };

  console.log('Running agent with input:', inputs2.playerInput);
  const result2 = await executor.call({
    input: inputs2.playerInput,
    conversation: inputs2.context.conversation.join('\n'),
    context: inputs2.context
  } as any);
  console.log('\n=== Agent Output ===');
  console.log(result2.output);

  // Show final state
  console.log('\n=== Final State ===');
  console.log('Final world time:', gtwg.metadata?.worldTime);
  console.log('Final time:', new Date(gtwg.metadata?.worldTime).toLocaleString());
}

main().catch(console.error);
