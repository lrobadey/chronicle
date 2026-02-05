import { createSimpleWorld } from '../state/world';
import { createToolRuntime } from '../tools/index';
import { ensureSeededFromWorld } from '../state/graphContext';
import { projectPKGFromGraph } from '../state/pkg';
import { P } from '../state/graph';

async function main() {
  console.log('🧪 Integration Test: Graph Writes via Tools → PKG → Query\n');

  // Setup
  let world = createSimpleWorld();
  const runtime = createToolRuntime(() => world, (w) => { world = w; });

  // Test 1: Create entity via tool
  console.log('1. Creating new location via create_entity tool...');
  const createResult = await runtime.create_entity({
    type: 'location',
    props: { name: 'Mysterious Cave', description: 'A dark cave entrance.' },
  });
  console.log(`   Result: ${JSON.stringify(createResult)}`);
  const newLocId = createResult.id;
  if (!newLocId || !createResult.ok) throw new Error('Entity creation via tool failed');

  // Test 2: Assign coordinates to the new location for spatial tests
  console.log('\n2. Assigning coordinates to new location...');
  const store = ensureSeededFromWorld(world);
  store.updateEntityProps(newLocId, { pos: { x: -40, y: 0 } });
  console.log(`   ✓ Location ${newLocId} has coordinates (-40, 0)`);

  // Test 3: Verify PKG projection
  console.log('\n3. Verifying PKG projection...');
  const pkg = projectPKGFromGraph(world);
  if (pkg.currentLocationId !== 'glade') throw new Error('PKG should show player at glade');
  console.log(`   ✓ PKG shows current location: ${pkg.currentLocationId}`);

  // Test 4: Verify query_world output
  console.log('\n4. Verifying query_world output...');
  const queryResult = await runtime.query_world({});
  if (queryResult.currentLocation.id !== 'glade') {
    throw new Error(`query_world should show glade, got: ${queryResult.currentLocation.id}`);
  }
  console.log(`   ✓ query_world shows current location: ${queryResult.currentLocation.id}`);

  // Test 5: Create item and verify contains relation
  console.log('\n6. Creating item and placing it in new location...');
  const itemResult = await runtime.create_entity({
    type: 'item',
    props: { name: 'ancient scroll' },
  });
  const itemId = itemResult.id;
  console.log(`   Created item: ${itemId}`);

  const containsResult = await runtime.create_relation({
    subj: newLocId,
    pred: 'contains',
    obj: itemId,
  });
  console.log(`   Created contains relation: ${containsResult.id}`);

  // Test 6: Verify item appears in query_world when player moves there
  console.log('\n7. Moving player to new location and verifying items...');
  const moveResult = await runtime.move_to_position({ to: { x: -40, y: 0 } });
  console.log(`   move_to_position result: ${JSON.stringify(moveResult)}`);
  if (!moveResult.ok || moveResult.locationId !== newLocId) {
    throw new Error(`move_to_position should land at ${newLocId}`);
  }
  const queryAfterMove = await runtime.query_world({});
  if (queryAfterMove.currentLocation.id !== newLocId) {
    throw new Error(`Player should be at ${newLocId}, got ${queryAfterMove.currentLocation.id}`);
  }
  const items = queryAfterMove.currentLocation.items || [];
  const hasItem = items.some((i) => i.id === itemId);
  if (!hasItem) {
    throw new Error(`Item ${itemId} should be visible at ${newLocId}`);
  }
  console.log(`   ✓ Player at ${newLocId}, items: ${items.map((i) => i.name).join(', ')}`);

  console.log('\n✅ All integration tests passed! Graph writes → PKG → Query all work together.');
}

main().catch((e) => {
  console.error('❌ Integration test failed:', e);
  process.exit(1);
});

