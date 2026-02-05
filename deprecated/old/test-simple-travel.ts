// test-simple-travel.ts - Simplified travel system test
// ===================================================

import { createAgentExecutor, runAgentTurn } from './agent/AgentOrchestrator.js';
import { createPagusClanisGTWG } from './data/PagusClanis.js';
import { createEmptyCanonLedger } from './data/CanonLedger.js';
import { createPKG } from './data/PKG.js';

async function testSimpleTravel() {
  console.log('🚀 Testing Simple Travel System...\n');

  // Initialize world state
  const gtwg = createPagusClanisGTWG();
  const ledger = createEmptyCanonLedger();
  const pkg = createPKG([], []);
  
  let currentGTWG = gtwg;
  let currentLedger = ledger;
  let currentPKG = pkg;
  let tick = 0;

  // Runtime dependencies
  const runtime = {
    getGTWG: () => currentGTWG,
    setGTWG: (g: any) => { currentGTWG = g; },
    getLedger: () => currentLedger,
    setLedger: (l: any) => { currentLedger = l; },
    getTick: () => tick,
    projectPKG: async (input: any) => {
      return { pkg: currentPKG };
    },
    queryGTWG: async (q: any) => {
      return currentGTWG;
    },
    queryPKG: async (q: any) => {
      return currentPKG;
    },
    getConversation: async (n: number) => [],
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

  console.log('\n✅ Simple Travel Test Complete!');
}

// Run the test
testSimpleTravel().catch(console.error);
