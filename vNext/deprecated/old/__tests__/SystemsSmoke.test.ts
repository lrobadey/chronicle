// SystemsSmoke.test.ts - Full-system preflight before running demos
// ================================================================

import { createPagusClanisGTWG } from '../data/PagusClanis.js';
import { createEmptyCanonLedger } from '../data/CanonLedger.js';
import { createRunTravelSystemTool, createApplyPatchesTool, createAdvanceTimeTool, createProjectPKGTool, createDiscoverEntityTool, createConversationHistoryTool, createCalcTravelTool } from '../agent/tools.js';
import type { PatchLike } from '../agent/types.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
}

interface RuntimeState {
  gtwg: any;
  ledger: any;
  tick: number;
  pkg: any;
  history: string[];
}

function buildRuntime(): { state: RuntimeState; runtime: any } {
  const gtwg = createPagusClanisGTWG();
  const ledger = createEmptyCanonLedger();
  const pkg = {
    discoveredFacts: [
      { entityId: 'villa-aelia', discoveredAt: new Date().toISOString(), source: 'test' },
      { entityId: 'mansio-vallis', discoveredAt: new Date().toISOString(), source: 'test' },
    ],
    rumors: [],
    metadata: { version: '1.0.0', createdAt: new Date().toISOString(), lastModified: new Date().toISOString(), playerId: 'player-1' },
  };
  const state: RuntimeState = {
    gtwg,
    ledger,
    tick: 0,
    pkg,
    history: ['Player: Greetings', 'Agent: Salve'],
  };

  const runtime = {
    getGTWG: () => state.gtwg,
    setGTWG: (gtwg: any) => {
      state.gtwg = gtwg;
    },
    getLedger: () => state.ledger,
    setLedger: (ledger: any) => {
      state.ledger = ledger;
    },
    getTick: () => state.tick,
    projectPKG: async ({ playerId }: { playerId: string }) => {
      state.pkg.metadata.playerId = playerId;
      state.pkg.metadata.lastModified = new Date().toISOString();
      return { pkg: state.pkg };
    },
    queryGTWG: async () => ({ entities: state.gtwg.entities }),
    queryPKG: async () => ({ entities: state.pkg.discoveredFacts }),
    getConversation: async (n: number) => state.history.slice(-n),
    getPKG: () => state.pkg,
    setPKG: (pkg: any) => {
      state.pkg = pkg;
    },
    getPlayerId: () => 'player-1',
  };

  return { state, runtime };
}

async function run() {
  console.log('Starting Chronicle V2 systems smoke test...');
  const { state, runtime } = buildRuntime();

  const travelTool = createRunTravelSystemTool(runtime);
  const calcTool = createCalcTravelTool(runtime);
  const patchTool = createApplyPatchesTool(runtime);
  const timeTool = createAdvanceTimeTool(runtime);
  const projectTool = createProjectPKGTool(runtime);
  const discoverTool = createDiscoverEntityTool(runtime);
  const convoTool = createConversationHistoryTool(runtime);

  console.log('1) Calculating travel preview...');
  const calcResult = await calcTool.call({ fromLocationId: 'villa-aelia', toLocationId: 'mansio-vallis' });
  console.log('   Distance meters:', calcResult.distanceMeters, 'ETA minutes:', calcResult.etaMinutes);
  assert(calcResult.ok !== false, 'calc_travel should succeed');

  console.log('2) Running travel system...');
  const travelResult = await travelTool.call({ fromLocationId: 'villa-aelia', toLocationId: 'mansio-vallis' });
  console.log('   Travel success:', travelResult.success, 'ETA:', travelResult.route?.etaMinutes);
  assert(travelResult.success === true, 'Travel system should succeed');
  assert(Array.isArray(travelResult.patches) && travelResult.patches.length > 0, 'Travel system should emit patches');

  console.log('3) Applying patches via Arbiter...');
  const applyResult = await patchTool.call({ patches: travelResult.patches as PatchLike[] });
  assert(applyResult.gtwg !== undefined, 'GTWG should return after applying patches');
  const player = applyResult.gtwg.entities.find((e: any) => e.id === 'player-1');
  assert(player?.properties?.current_location === 'mansio-vallis', 'Player location should update after travel');
  assert(state.ledger.entries.length === 1, 'Ledger should record travel commit');

  console.log('4) Advancing time for non-travel action...');
  const advanceResult = await timeTool.call({ minutes: 45, reason: 'post-travel scouting' });
  assert(advanceResult.success === true, 'advance_time should succeed');
  await patchTool.call({ patches: advanceResult.patches as PatchLike[] });
  assert(state.ledger.entries.length === 2, 'Ledger should include time advancement');

  console.log('5) Projecting PKG and discovering new entity...');
  const projection = await projectTool.call({ playerId: runtime.getPlayerId(), gtwg: state.gtwg });
  assert(projection.pkg === state.pkg, 'Projected PKG should match runtime PKG');
  const discover = await discoverTool.call({ entityId: 'figlinae-clanis' });
  assert(discover.ok === true, 'discover_entity should succeed');
  assert(state.pkg.discoveredFacts.some((f: any) => f.entityId === 'figlinae-clanis'), 'PKG should include discovered entity');

  console.log('6) Conversation history retrieval...');
  state.history.push('Player: What now?');
  state.history.push('Agent: Consider visiting the kilns.');
  const convoRaw = await convoTool.call({ n: 3 });
  assert(Array.isArray(convoRaw.messages) && convoRaw.messages.length === 3, 'Conversation tool should return requested messages');

  console.log('✅ Systems smoke test passed!');
}

run().catch((error) => {
  console.error('❌ Systems smoke test failed:', error);
  process.exit(1);
});
