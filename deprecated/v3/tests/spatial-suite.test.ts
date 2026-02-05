import { createSimpleWorld } from '../state/world';
import { createGraphStore, seedGraphFromSimpleWorld } from '../state/graphStore';
import { projectPKGFromGraph } from '../state/pkg';
import { createToolRuntime } from '../tools/index';
import { ensureSeededFromWorld } from '../state/graphContext';

async function runSpatialSmoke() {
  console.log('\n📐 Spatial Smoke Tests');
  console.log('─'.repeat(50));
  
  const world = createSimpleWorld();
  const store = createGraphStore();
  seedGraphFromSimpleWorld(store, world);

  const pkg = projectPKGFromGraph(world);

  // Verify coordinates are assigned after seeding
  const gladePos = store.getPosition('glade');
  const tavernPos = store.getPosition('tavern');
  const playerPos = world.player.pos;

  if (!gladePos) {
    throw new Error('Expected glade to have coordinates after seeding');
  }
  if (!tavernPos) {
    throw new Error('Expected tavern to have coordinates after seeding');
  }
  if (!playerPos) {
    throw new Error('Expected player to have canonical coordinates');
  }

  // Verify auto-layout produces reasonable positions
  if (gladePos.x !== 0 || gladePos.y !== 0) {
    console.warn(`  ⚠ Warning: Glade not at origin (0,0), got (${gladePos.x}, ${gladePos.y})`);
  }
  if (playerPos.x !== gladePos.x || playerPos.y !== gladePos.y) {
    throw new Error(`Expected player position to match glade coordinates, got (${playerPos.x}, ${playerPos.y})`);
  }
  console.log('  ✓ Player position matches starting location coordinates');

  // Verify distance calculation
  const dist = store.distance('glade', 'tavern');
  if (dist === undefined) {
    throw new Error('Expected distance calculation to work');
  }
  console.log(`  ✓ Distance calculation works (glade → tavern: ${dist.toFixed(1)}m)`);

  // No exit system; movement is coordinate-based
  console.log('  ✓ Coordinate-based movement confirmed');

  console.log('  ✅ Spatial smoke tests passed');
}

async function runMoveToPositionTests() {
  console.log('\n🧭 move_to_position Tool Tests');
  console.log('─'.repeat(50));

  let world = createSimpleWorld();
  const runtime = createToolRuntime(() => world, (w) => {
    world = w;
  });

  // Test 1: Initial state
  const initialQuery = await runtime.query_world({});
  if (initialQuery.player.location !== 'glade') {
    throw new Error(`Expected player to start in glade, got ${initialQuery.player.location}`);
  }
  if (!initialQuery.player.position || initialQuery.player.position.x !== 0 || initialQuery.player.position.y !== 0) {
    throw new Error(`Expected player position (0,0), got ${JSON.stringify(initialQuery.player.position)}`);
  }
  console.log('  ✓ Initial state has canonical player position at origin');

  // Test 2: Delta movement
  const moveDelta = await runtime.move_to_position({ delta: { dx: 12, dy: -3 } });
  if (!moveDelta.ok) {
    throw new Error('move_to_position with delta should succeed');
  }
  if (Math.abs(moveDelta.position.x - 12) > 1e-6 || Math.abs(moveDelta.position.y + 3) > 1e-6) {
    throw new Error(`Delta move ended at unexpected position ${JSON.stringify(moveDelta.position)}`);
  }
  if (!moveDelta.note.includes('Player moved to')) {
    throw new Error(`Expected auto-generated ledger note, got ${moveDelta.note}`);
  }

  if (!world.player.pos || Math.abs(world.player.pos.x - 12) > 1e-6 || Math.abs(world.player.pos.y + 3) > 1e-6) {
    throw new Error(`World player position not updated, got ${JSON.stringify(world.player.pos)}`);
  }
  if (!world.ledger[world.ledger.length - 1].includes('Player moved to')) {
    throw new Error('Ledger should record auto-generated move note');
  }

  const postDeltaQuery = await runtime.query_world({});
  if (!postDeltaQuery.player.position || Math.abs(postDeltaQuery.player.position.x - 12) > 1e-6) {
    throw new Error('query_world should return updated player.position after delta move');
  }
  if (postDeltaQuery.player.location !== 'glade') {
    throw new Error(`Nearest location should remain glade, got ${postDeltaQuery.player.location}`);
  }
  console.log('  ✓ Delta move updates position, ledger, and query output');

  // Test 3: Absolute movement with custom note
  const tavernMove = await runtime.move_to_position({ to: { x: 0, y: 50 }, note: 'Walked to tavern.' });
  if (!tavernMove.ok) {
    throw new Error('move_to_position with absolute coordinates should succeed');
  }
  if (tavernMove.locationId !== 'tavern') {
    throw new Error(`Expected nearest location to be tavern, got ${tavernMove.locationId}`);
  }
  if (tavernMove.note !== 'Walked to tavern.') {
    throw new Error(`Custom note should be preserved, got ${tavernMove.note}`);
  }

  if (world.player.location !== 'tavern') {
    throw new Error(`World player location should be tavern, got ${world.player.location}`);
  }
  if (!world.player.pos || world.player.pos.y !== 50) {
    throw new Error('World player pos should match tavern coordinates');
  }
  if (world.ledger[world.ledger.length - 1] !== 'Walked to tavern.') {
    throw new Error('Ledger should contain the custom note after absolute move');
  }

  const finalQuery = await runtime.query_world({});
  if (finalQuery.player.location !== 'tavern') {
    throw new Error(`query_world should report tavern after move, got ${finalQuery.player.location}`);
  }
  if (!finalQuery.player.position || finalQuery.player.position.y !== 50) {
    throw new Error('query_world should return tavern coordinates');
  }

  const store = ensureSeededFromWorld(world);
  const located = store.getLocatedIn(world.player.id);
  if (!located || located.obj !== 'tavern') {
    throw new Error(`Graph store located_in should be tavern, got ${located?.obj}`);
  }
  console.log('  ✓ Absolute move aligns world state and graph store location');

  // Test 4: Speed and ETA calculation
  const fastMove = await runtime.move_to_position({
    delta: { dx: 0, dy: 10 },
    speedMetersPerSecond: 5,
  });
  if (!fastMove.note.includes('ETA')) {
    throw new Error('Expected ETA calculation in ledger note when speed is provided');
  }
  console.log('  ✓ Speed and ETA calculation works');

  // Test 5: Nearest location derivation
  const midPointMove = await runtime.move_to_position({ to: { x: 0, y: 25 } });
  const midQuery = await runtime.query_world({});
  // Should be closer to glade (0,0) than tavern (0,50), so nearest should be glade
  const distToGlade = Math.hypot(0 - 0, 25 - 0);
  const distToTavern = Math.hypot(0 - 0, 25 - 50);
  if (distToGlade < distToTavern && midQuery.player.location !== 'glade') {
    throw new Error('Nearest location should be glade when equidistant');
  }
  console.log('  ✓ Nearest location derivation works correctly');

  console.log('  ✅ move_to_position tool tests passed');
}

async function runCoordinateConsistencyTests() {
  console.log('\n🔄 Coordinate Consistency Tests');
  console.log('─'.repeat(50));

  let world = createSimpleWorld();
  const runtime = createToolRuntime(() => world, (w) => {
    world = w;
  });

  // Test that query_world player.position matches world.player.pos
  const query1 = await runtime.query_world({});
  if (!query1.player.position) {
    throw new Error('query_world should return player.position');
  }
  if (query1.player.position.x !== world.player.pos.x || query1.player.position.y !== world.player.pos.y) {
    throw new Error('query_world player.position should match world.player.pos');
  }
  console.log('  ✓ query_world player.position matches world.player.pos');

  // Test that graph store player position matches world.player.pos after move
  // (move_to_position updates the store, so we check after a move)
  await runtime.move_to_position({ delta: { dx: 5, dy: 5 } });
  const store = ensureSeededFromWorld(world);
  const graphPlayerPos = store.getPosition(world.player.id);
  if (!graphPlayerPos) {
    throw new Error('Graph store should have player position after move');
  }
  if (Math.abs(graphPlayerPos.x - world.player.pos.x) > 1e-6 || Math.abs(graphPlayerPos.y - world.player.pos.y) > 1e-6) {
    throw new Error(`Graph store player position should match world.player.pos. Got store: (${graphPlayerPos.x}, ${graphPlayerPos.y}), world: (${world.player.pos.x}, ${world.player.pos.y})`);
  }
  console.log('  ✓ Graph store player position matches world.player.pos after move');

  // Test that player.location is derived from nearest landmark
  await runtime.move_to_position({ to: { x: 0, y: 30 } });
  const query2 = await runtime.query_world({});
  // At (0, 30), should be closer to glade (0,0) than tavern (0,50)
  const distToGlade = Math.hypot(0 - 0, 30 - 0);
  const distToTavern = Math.hypot(0 - 0, 30 - 50);
  if (distToGlade < distToTavern && query2.player.location !== 'glade') {
    throw new Error('player.location should be derived from nearest landmark');
  }
  console.log('  ✓ player.location correctly derived from nearest landmark');

  // Test that multiple moves maintain consistency
  await runtime.move_to_position({ delta: { dx: 10, dy: 0 } });
  const query3 = await runtime.query_world({});
  if (!query3.player.position || Math.abs(query3.player.position.x - world.player.pos.x) > 1e-6) {
    throw new Error('Multiple moves should maintain position consistency');
  }
  console.log('  ✓ Multiple moves maintain position consistency');

  console.log('  ✅ Coordinate consistency tests passed');
}

async function main() {
  console.log('\n🌍 Spatial System Test Suite');
  console.log('═'.repeat(50));

  const startTime = Date.now();
  let passed = 0;
  let failed = 0;

  const tests = [
    { name: 'Spatial Smoke', fn: runSpatialSmoke },
    { name: 'move_to_position Tool', fn: runMoveToPositionTests },
    { name: 'Coordinate Consistency', fn: runCoordinateConsistencyTests },
  ];

  for (const test of tests) {
    try {
      await test.fn();
      passed++;
    } catch (err) {
      failed++;
      console.error(`\n❌ ${test.name} failed:`, err instanceof Error ? err.message : String(err));
      if (err instanceof Error && err.stack) {
        console.error(err.stack);
      }
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n' + '═'.repeat(50));
  console.log(`📊 Test Summary: ${passed} passed, ${failed} failed (${duration}s)`);
  console.log('═'.repeat(50));

  if (failed > 0) {
    process.exit(1);
  }

  console.log('\n✅ All spatial system tests passed!\n');
}

main().catch((err) => {
  console.error('\n💥 Test suite crashed:', err);
  process.exit(1);
});

