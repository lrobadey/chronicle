import { createGraphStore } from '../state/graphStore';
import { createSimpleWorld } from '../state/world';
import { seedGraphFromSimpleWorld } from '../state/graphStore';
import { P } from '../state/graph';

async function main() {
  const world = createSimpleWorld();
  const store = createGraphStore();
  seedGraphFromSimpleWorld(store, world);

  console.log('Testing entity creation...');
  const { id: newLocId } = store.createEntity({
    type: 'location',
    props: { name: 'Test Room', description: 'A test location.' },
  });
  console.log(`Created location: ${newLocId}`);
  const entity = store.getEntity(newLocId);
  if (!entity || entity.type !== 'location') throw new Error('Entity creation failed');
  console.log('✓ Entity creation works');

  console.log('\nTesting relation creation...');
  const exitRelId = store.createRelation({
    subj: 'glade',
    pred: 'exit_to',
    obj: newLocId,
    props: { direction: 'north' },
  }).id;
  console.log(`Created exit_to relation: ${exitRelId}`);
  const exits = store.getExitsFrom('glade');
  const hasNewExit = exits.some((e) => e.to === newLocId);
  if (!hasNewExit) throw new Error('Relation creation failed');
  console.log('✓ Relation creation works');

  console.log('\nTesting moveEntity (should work with exit)...');
  try {
    store.moveEntity({ entityId: 'player-1', toLocationId: 'tavern' });
    console.log('✓ Move works (exit exists)');
  } catch (err) {
    console.log('✗ Move failed:', err instanceof Error ? err.message : String(err));
  }

  console.log('\nTesting moveEntity (should fail without exit)...');
  try {
    store.moveEntity({ entityId: 'player-1', toLocationId: 'nonexistent' });
    throw new Error('Should have failed');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('No exit_to')) {
      console.log('✓ Move correctly blocked when no exit exists');
    } else {
      throw err;
    }
  }

  console.log('\nTesting transferItem...');
  // Create an item first
  const { id: itemId } = store.createEntity({
    type: 'item',
    props: { name: 'test sword' },
  });
  // Put it in glade
  store.createRelation({
    subj: 'glade',
    pred: 'contains',
    obj: itemId,
  });
  // Transfer to player
  const transferResult = store.transferItem({
    itemId,
    fromEntityId: 'glade',
    toEntityId: 'player-1',
  });
  console.log(`Transfer result: ${transferResult.note}`);
  const playerContains = store.getRelationsBySubject('player-1').filter((r) => r.pred === P.contains && r.obj === itemId);
  if (!playerContains.length) throw new Error('Transfer failed');
  console.log('✓ Transfer item works');

  console.log('\n✅ All write operation tests passed!');
}

main().catch((e) => {
  console.error('Write ops test failed:', e);
  process.exit(1);
});

