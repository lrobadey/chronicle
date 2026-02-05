// RunTravelSystemTool.test.ts - Validate travel tool player resolution and patching
// ================================================================================

import { createRunTravelSystemTool } from '../agent/tools.js';
import type { PatchLike } from '../agent/types.js';
import { createPagusClanisGTWG } from '../data/PagusClanis.js';

type RuntimeOptions = {
  playerId?: string;
  exposeGetter?: boolean;
  pkgMetadataPlayerId?: string;
  discoveredFacts?: string[];
};

interface TestRuntime {
  getGTWG: () => any;
  setGTWG: (g: any) => void;
  getLedger: () => any;
  setLedger: (l: any) => void;
  getTick: () => number;
  projectPKG: (input: any) => Promise<{ pkg: any }>;
  queryGTWG: (q: Record<string, any>) => Promise<any>;
  queryPKG: (q: Record<string, any>) => Promise<any>;
  getConversation: (n: number) => Promise<string[]>;
  getPKG: () => any;
  setPKG: (pkg: any) => void;
  getPlayerId?: () => string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`TEST FAILED: ${message}`);
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function addPlayer(gtwg: any, playerId: string, locationId: string) {
  const basePlayer = gtwg.entities.find((e: any) => e.id === 'player-1');
  assert(basePlayer, 'Base player entity missing in GTWG seed');
  const newPlayer = clone(basePlayer);
  newPlayer.id = playerId;
  newPlayer.name = `Test Avatar ${playerId}`;
  newPlayer.properties.current_location = locationId;
  gtwg.entities.push(newPlayer);
  gtwg.relations.push({
    id: `rel-${playerId}-in-${locationId}`,
    type: 'contained_in',
    from: playerId,
    to: locationId,
  });
}

function createPkg(discovered: string[], metadataPlayerId?: string) {
  const baseIso = new Date().toISOString();
  return {
    discoveredFacts: discovered.map((entityId) => ({
      entityId,
      discoveredAt: baseIso,
      source: 'test',
    })),
    rumors: [],
    metadata: {
      version: '1.0.0',
      createdAt: baseIso,
      lastModified: baseIso,
      ...(metadataPlayerId ? { playerId: metadataPlayerId } : {}),
    },
  };
}

function createRuntime(gtwgInput: any, options: RuntimeOptions = {}): TestRuntime {
  const gtwg = gtwgInput;
  const playerId = options.playerId ?? 'player-1';
  const discoveredFacts = options.discoveredFacts ?? ['villa-aelia', 'mansio-vallis'];
  const pkg = createPkg(discoveredFacts, options.pkgMetadataPlayerId);
  let ledger: any = { entries: [] };

  const runtime: TestRuntime = {
    getGTWG: () => gtwg,
    setGTWG: () => {},
    getLedger: () => ledger,
    setLedger: (l: any) => {
      ledger = l;
    },
    getTick: () => 0,
    projectPKG: async () => ({ pkg }),
    queryGTWG: async () => gtwg,
    queryPKG: async () => pkg,
    getConversation: async () => [],
    getPKG: () => pkg,
    setPKG: () => {},
    ...(options.exposeGetter
      ? {
          getPlayerId: () => playerId,
        }
      : {}),
  };

  return runtime;
}

function logResult(label: string, result: any) {
  console.log(`\n${label}`);
  console.log('success:', result.success);
  if (result.error) console.log('error:', result.error);
  console.log('route:', result.route);
  console.log('patches:', result.patches);
}

function expectPatchesForPlayer(patches: PatchLike[], playerId: string, toLocation: string, hadExistingRelation: boolean) {
  const setPatch = patches.find((p) => p.entity === playerId && p.op === 'set');
  assert(setPatch, `Expected set patch for ${playerId}`);
  assert((setPatch as any).value.current_location === toLocation, 'Player location should update to destination');

  const relationPatch = patches.find((p) => p.op === 'create_relation');
  assert(relationPatch, 'Expected create_relation patch');
  assert(
    relationPatch.entity === (playerId === 'player-1' ? `rel-player-in-${toLocation}` : `rel-${playerId}-in-${toLocation}`),
    'Relation id should be player-specific',
  );
  assert(
    (relationPatch as any).value.from === playerId && (relationPatch as any).value.to === toLocation,
    'Relation should link player to destination',
  );

  const deleteRelation = patches.find((p) => p.op === 'delete_relation');
  if (hadExistingRelation) {
    assert(deleteRelation, 'Expected delete_relation patch when prior containment exists');
    if (playerId === 'player-1') {
      assert(deleteRelation.entity.startsWith('rel-player-in-'), 'Default relation id should follow rel-player-in-* pattern');
    } else {
      assert(deleteRelation.entity.includes(playerId), 'Old relation id should reference player');
    }
  } else {
    assert(!deleteRelation, 'Should not delete relation when none existed');
  }

  const timePatch = patches.find((p) => p.entity === '__meta__' && p.field === 'worldTime');
  assert(timePatch, 'World time patch should be present');
}

async function testDefaultFallback() {
  console.log('\n--- Test: Default fallback to player-1 ---');
  const gtwg = createPagusClanisGTWG();
  const runtime = createRuntime(gtwg, { discoveredFacts: ['villa-aelia', 'mansio-vallis'] });
  const tool = createRunTravelSystemTool(runtime as any);
  const result = await tool.call({ fromLocationId: 'villa-aelia', toLocationId: 'mansio-vallis' });
  logResult('Default fallback result', result);

  assert(result.success === true, 'Travel should succeed for default player');
  expectPatchesForPlayer(result.patches, 'player-1', 'mansio-vallis', true);
}

async function testRuntimeGetterFallback() {
  console.log('\n--- Test: Runtime getter supplies player id ---');
  const gtwg = createPagusClanisGTWG();
  addPlayer(gtwg, 'player-2', 'villa-aelia');
  const runtime = createRuntime(gtwg, { playerId: 'player-2', exposeGetter: true });
  const tool = createRunTravelSystemTool(runtime as any);
  const result = await tool.call({ fromLocationId: 'villa-aelia', toLocationId: 'mansio-vallis' });
  logResult('Runtime getter result', result);

  assert(result.success === true, 'Travel should succeed for runtime-provided player');
  expectPatchesForPlayer(result.patches, 'player-2', 'mansio-vallis', true);
}

async function testExplicitPlayerOverride() {
  console.log('\n--- Test: Explicit playerId overrides runtime getter ---');
  const gtwg = createPagusClanisGTWG();
  addPlayer(gtwg, 'player-3', 'villa-aelia');
  const runtime = createRuntime(gtwg, { playerId: 'player-2', exposeGetter: true });
  const tool = createRunTravelSystemTool(runtime as any);
  const result = await tool.call({
    fromLocationId: 'villa-aelia',
    toLocationId: 'mansio-vallis',
    playerId: 'player-3',
  });
  logResult('Explicit player override result', result);

  assert(result.success === true, 'Travel should succeed for explicit player override');
  expectPatchesForPlayer(result.patches, 'player-3', 'mansio-vallis', true);
}

async function testPkgMetadataFallback() {
  console.log('\n--- Test: PKG metadata player id fallback ---');
  const gtwg = createPagusClanisGTWG();
  addPlayer(gtwg, 'player-4', 'villa-aelia');
  const runtime = createRuntime(gtwg, { pkgMetadataPlayerId: 'player-4' });
  const tool = createRunTravelSystemTool(runtime as any);
  const result = await tool.call({ fromLocationId: 'villa-aelia', toLocationId: 'mansio-vallis' });
  logResult('PKG metadata fallback result', result);

  assert(result.success === true, 'Travel should succeed using PKG metadata player id');
  expectPatchesForPlayer(result.patches, 'player-4', 'mansio-vallis', true);
}

async function testMissingPlayerFailure() {
  console.log('\n--- Test: Missing player entity returns error ---');
  const gtwg = createPagusClanisGTWG();
  const runtime = createRuntime(gtwg, { playerId: 'ghost-player', exposeGetter: true });
  const tool = createRunTravelSystemTool(runtime as any);
  const result = await tool.call({ fromLocationId: 'villa-aelia', toLocationId: 'mansio-vallis' });
  logResult('Missing player result', result);

  assert(result.success === false, 'Travel should fail when player is missing');
  assert(result.error.includes('ghost-player'), 'Error message should reference missing player id');
  assert(result.patches.length === 0, 'No patches should be produced on failure');
}

async function run() {
  console.log('Starting RunTravelSystemTool tests...');
  await testDefaultFallback();
  await testRuntimeGetterFallback();
  await testExplicitPlayerOverride();
  await testPkgMetadataFallback();
  await testMissingPlayerFailure();
  console.log('\n✅ All RunTravelSystemTool tests passed!');
}

run().catch((error) => {
  console.error('❌ RunTravelSystemTool tests failed:', error);
  process.exit(1);
});
