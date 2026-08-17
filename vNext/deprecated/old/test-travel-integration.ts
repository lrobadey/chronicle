// test-travel-integration.ts - End-to-end travel system test
// =========================================================

import { createAgentExecutor, runAgentTurn } from './agent/AgentOrchestrator.js';
import { createGTWG } from './data/GTWG.js';
import { createPagusClanisGTWG } from './data/PagusClanis.js';
import { createCanonLedger } from './data/CanonLedger.js';
import { createPKG } from './data/PKG.js';

async function testTravelIntegration() {
  console.log('🚀 Testing Travel System Integration...\n');

  // Initialize world state
  const gtwg = createPagusClanisGTWG();
  const ledger = createCanonLedger();
  const pkg = createPKG();
  
  let currentGTWG = gtwg;
  let currentLedger = ledger;
  let currentPKG = pkg;
  let tick = 0;
  const transcript: string[] = [];

  // Runtime dependencies
  const runtime = {
    getGTWG: () => currentGTWG,
    setGTWG: (g: any) => { currentGTWG = g; },
    getLedger: () => currentLedger,
    setLedger: (l: any) => { currentLedger = l; },
    getTick: () => tick,
    projectPKG: async (input: any) => {
      // Simple PKG projection for testing
      return { pkg: currentPKG };
    },
    queryGTWG: async (q: any) => {
      // Simple GTWG query for testing
      return currentGTWG;
    },
    queryPKG: async (q: any) => {
      // Simple PKG query for testing
      return currentPKG;
    },
    getConversation: async (n: number) => transcript.slice(-n),
    getPlayerId: () => 'player-1'
  };

  // Create agent executor with travel tools
  const executor = await createAgentExecutor(runtime, { maxIterations: 10 });

  // Test 1: Player asks about travel
  console.log('📍 Test 1: Player asks about travel to Mansio Vallis');
  console.log('Player Input: "I want to travel to Mansio Vallis"');
  
  const result1 = await runAgentTurn(executor, {
    playerInput: "I want to travel to Mansio Vallis",
    context: {
      playerId: 'player-1',
      tick: tick++,
      worldTime: currentGTWG.metadata?.worldTime || new Date().toISOString()
    }
  });

  transcript.push("Player: I want to travel to Mansio Vallis");
  transcript.push(`Agent: ${result1.narrative}`);

  console.log('\n📋 Agent Response:');
  console.log(result1.narrative);
  console.log('\n🛠️ Intermediate Steps:');
  console.log(JSON.stringify(result1.intermediateSteps, null, 2));

  // Test 2: Check if travel actually happened
  console.log('\n📍 Test 2: Verifying travel results');
  console.log('Current GTWG after travel:');
  console.log('- Player location:', currentGTWG.entities.find(e => e.id === 'player-1')?.properties?.current_location);
  console.log('- World time:', currentGTWG.metadata?.worldTime);
  console.log('- Ledger entries:', currentLedger.entries.length);

  // Test 3: Player asks about current location
  console.log('\n📍 Test 3: Player asks about current location');
  console.log('Player Input: "Where am I now?"');
  
  const result2 = await runAgentTurn(executor, {
    playerInput: "Where am I now?",
    context: {
      playerId: 'player-1',
      tick: tick++,
      worldTime: currentGTWG.metadata?.worldTime || new Date().toISOString()
    }
  });

  transcript.push("Player: Where am I now?");
  transcript.push(`Agent: ${result2.narrative}`);

  console.log('\n📋 Agent Response:');
  console.log(result2.narrative);

  console.log('\n✅ Travel Integration Test Complete!');
}

// Run the test
testTravelIntegration().catch(console.error);
