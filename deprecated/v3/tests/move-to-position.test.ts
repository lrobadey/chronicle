import { createSimpleWorld } from '../state/world';
import { createToolRuntime } from '../tools/index';
import { ensureSeededFromWorld } from '../state/graphContext';

async function main() {
  console.log('🧭 move_to_position tool tests');

  let world = createSimpleWorld();
  const runtime = createToolRuntime(() => world, (w) => {
    world = w;
  });

  const initialQuery = await runtime.query_world({});
  if (initialQuery.player.location !== 'glade') {
    throw new Error(`Expected player to start in glade, got ${initialQuery.player.location}`);
  }
  if (!initialQuery.player.position || initialQuery.player.position.x !== 0 || initialQuery.player.position.y !== 0) {
    throw new Error(`Expected player position (0,0), got ${JSON.stringify(initialQuery.player.position)}`);
  }
  console.log('  ✓ Initial state has canonical player position at origin');

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

  console.log('\n✅ move_to_position tool tests passed');
}

main().catch((err) => {
  console.error('move_to_position tool tests failed:', err);
  process.exit(1);
});


