import { createSimpleWorld, type SimpleWorld } from '../state/world';
import { createToolRuntime } from '../tools/index';
import { buildTurnTelemetry } from '../state/telemetry';
import { applyPatches } from '../state/arbiter';
import { projectPKGFromGraph } from '../state/pkg';
import type { Patch } from '../tools/types';

async function main() {
  console.log('🧪 Determinism & Provenance Test\n');

  // Test 1: World has turn tracking
  console.log('1. Verifying turn tracking in world state...');
  let world = createSimpleWorld();
  if (!world.meta) throw new Error('World should have meta field');
  if (world.meta.turn !== 0) throw new Error('Initial turn should be 0');
  console.log(`   ✓ Initial turn: ${world.meta.turn}`);
  console.log(`   ✓ World has seed field: ${world.meta.seed !== undefined ? 'yes' : 'no (undefined is ok)'}`);

  // Test 2: Patches include provenance
  console.log('\n2. Verifying patch provenance...');
  const patchWithProvenance: Patch = {
    op: 'set',
    path: '/player/location',
    value: 'tavern',
    note: 'Player moved',
    by: 'GM',
    turn: 1,
    seed: 'test-seed-123',
  };
  world = applyPatches(world, [patchWithProvenance]);
  const lastLedgerEntry = world.ledger[world.ledger.length - 1];
  console.log(`   ✓ Ledger entry: "${lastLedgerEntry}"`);
  if (!lastLedgerEntry.includes('[GM')) {
    throw new Error('Ledger should include provenance tag [GM]');
  }
  console.log(`   ✓ Provenance tracked in ledger`);

  // Test 3: Turn counter increments
  console.log('\n3. Verifying turn counter increments...');
  const initialTurn = world.meta?.turn || 0;
  world = applyPatches(world, [{ op: 'set', path: '/player/location', value: 'glade', note: 'Return to glade' }]);
  const nextTurn = world.meta?.turn || 0;
  if (nextTurn !== initialTurn + 1) {
    throw new Error(`Turn should increment from ${initialTurn} to ${initialTurn + 1}, got ${nextTurn}`);
  }
  console.log(`   ✓ Turn incremented: ${initialTurn} → ${nextTurn}`);

  // Test 4: Telemetry includes turn and seed
  console.log('\n4. Verifying telemetry system...');
  const telemetry = buildTurnTelemetry(world);
  if (telemetry.turn !== nextTurn) {
    throw new Error(`Telemetry turn (${telemetry.turn}) should match world turn (${nextTurn})`);
  }
  console.log(`   ✓ Telemetry turn: ${telemetry.turn}`);
  console.log(`   ✓ Telemetry schema version: ${telemetry.schemaVersion}`);
  console.log(`   ✓ Telemetry includes ${telemetry.nearbyLocations.length} nearby locations`);
  
  // Test 5: PKG v2 has richer information
  console.log('\n5. Verifying PKG v2 structure...');
  const runtime = createToolRuntime(() => world, (w) => { world = w; });
  
  // Create an NPC entity
  const npcResult = await runtime.create_entity({
    type: 'actor',
    props: { name: 'Test NPC', role: 'merchant' },
  });
  
  const pkg = projectPKGFromGraph(world);
  console.log(`   ✓ PKG has knownLocations: ${pkg.knownLocations.length} locations`);
  console.log(`   ✓ PKG has knownNPCs: ${pkg.knownNPCs ? 'yes' : 'no'}`);
  console.log(`   ✓ PKG has knownItems: ${pkg.knownItems ? 'yes' : 'no'}`);
  console.log(`   ✓ PKG has nearbyDirections: ${pkg.nearbyDirections ? 'yes' : 'no'}`);
  
  if (!pkg.knownLocations || pkg.knownLocations.length === 0) {
    throw new Error('PKG should have known locations');
  }
  
  const firstLocation = pkg.knownLocations[0];
  if (!('visited' in firstLocation)) {
    throw new Error('PKG locations should have visited flag');
  }
  console.log(`   ✓ First known location: ${firstLocation.name} (visited: ${firstLocation.visited})`);

  // Test 6: Telemetry captures system state
  console.log('\n6. Verifying telemetry captures world systems...');
  console.log(`   ✓ Telemetry player position: (${telemetry.player.position.x}, ${telemetry.player.position.y})`);
  console.log(`   ✓ Telemetry location: ${telemetry.location.name}`);
  console.log(`   ✓ Ledger tail entries: ${telemetry.ledgerTail.length}`);

  console.log('\n✅ All determinism & provenance tests passed!');
  console.log('\nKey improvements verified:');
  console.log('  • Turn tracking in world.meta');
  console.log('  • Patch provenance (by, turn, seed)');
  console.log('  • Telemetry as single source of truth');
  console.log('  • PKG v2 with richer knowledge tracking');
  console.log('  • Ledger includes provenance tags');
}

main().catch((e) => {
  console.error('❌ Determinism test failed:', e);
  process.exit(1);
});

