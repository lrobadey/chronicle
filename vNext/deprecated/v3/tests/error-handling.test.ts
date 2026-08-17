import { createSimpleWorld } from '../state/world';
import { createToolRuntime } from '../tools/index';
import { ensureSeededFromWorld } from '../state/graphContext';

async function main() {
  console.log('🧪 Error Handling & Edge Cases Test\n');

  let world = createSimpleWorld();
  const runtime = createToolRuntime(() => world, (w) => { world = w; });
  const store = ensureSeededFromWorld(world);

  // Test 1: Invalid exit_to (missing direction)
  console.log('1. Testing exit_to without direction (should fail)...');
  try {
    await runtime.create_relation({
      subj: 'glade',
      pred: 'exit_to',
      obj: 'tavern',
      props: {},
    });
    throw new Error('Should have failed');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('direction')) {
      console.log('   ✓ Correctly rejected exit_to without direction');
    } else {
      throw err;
    }
  }

  // Test 2: Invalid relation (wrong entity types)
  console.log('\n2. Testing invalid relation types (should fail)...');
  try {
    await runtime.create_relation({
      subj: 'player-1',
      pred: 'exit_to',
      obj: 'tavern',
      props: { direction: 'north' },
    });
    throw new Error('Should have failed');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('subject type') || msg.includes('location')) {
      console.log('   ✓ Correctly rejected exit_to with non-location subject');
    } else {
      throw err;
    }
  }

  // Test 3: Duplicate entity (should fail or handle gracefully)
  console.log('\n3. Testing duplicate entity creation...');
  const { id: existingId } = await runtime.create_entity({
    type: 'location',
    props: { name: 'Test Room' },
  });
  try {
    await runtime.create_entity({
      type: 'location',
      props: { name: 'Test Room' },
      id: existingId,
    });
    throw new Error('Should have failed');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already exists')) {
      console.log('   ✓ Correctly rejected duplicate entity');
    } else {
      throw err;
    }
  }

  // Test 4: Move without exit (should fail)
  console.log('\n4. Testing moveEntity without exit (should fail)...');
  const { id: isolatedLocId } = await runtime.create_entity({
    type: 'location',
    props: { name: 'Isolated Room' },
  });
  try {
    store.moveEntity({ entityId: 'player-1', toLocationId: isolatedLocId });
    throw new Error('Should have failed');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('No exit_to')) {
      console.log('   ✓ Correctly blocked move without exit');
    } else {
      throw err;
    }
  }

  // Test 5: Transfer item that doesn't exist (should fail)
  console.log('\n5. Testing transferItem with non-existent item (should fail)...');
  try {
    store.transferItem({
      itemId: 'nonexistent-item',
      fromEntityId: 'glade',
      toEntityId: 'player-1',
    });
    throw new Error('Should have failed');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('does not contain')) {
      console.log('   ✓ Correctly rejected transfer of non-existent item');
    } else {
      throw err;
    }
  }

  // Test 6: Create relation with non-existent entities (should fail)
  console.log('\n6. Testing create_relation with non-existent entities (should fail)...');
  try {
    await runtime.create_relation({
      subj: 'nonexistent-a',
      pred: 'exit_to',
      obj: 'nonexistent-b',
      props: { direction: 'north' },
    });
    throw new Error('Should have failed');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not found')) {
      console.log('   ✓ Correctly rejected relation with non-existent entities');
    } else {
      throw err;
    }
  }

  console.log('\n✅ All error handling tests passed! Validation works correctly.');
}

main().catch((e) => {
  console.error('❌ Error handling test failed:', e);
  process.exit(1);
});

