import { createSimpleWorld } from '../state/world';
import { createToolRuntime } from '../tools/index';

async function main() {
  console.log('🩹 apply_patches tool tests');

  let world = createSimpleWorld();
  const runtime = createToolRuntime(
    () => world,
    (next) => {
      world = next;
    }
  );

  const initialMinutes = world.systems?.time?.elapsedMinutes ?? 0;
  const setResult = await runtime.apply_patches({
    patches: [
      {
        op: 'set',
        path: '/systems/time/elapsedMinutes',
        value: initialMinutes + 5,
        note: 'time advance test',
      },
    ],
  });
  if (!setResult?.ok) {
    throw new Error('apply_patches should return ok for valid patches');
  }
  if ((world.systems?.time?.elapsedMinutes ?? 0) !== initialMinutes + 5) {
    throw new Error('World time should advance after valid patch');
  }
  console.log('  ✓ Valid patches update world state');

  const ledgerBeforeNoop = world.ledger.slice();
  const timeBeforeNoop = world.systems?.time?.elapsedMinutes ?? 0;
  const noopResult = await runtime.apply_patches({ patches: [] });
  if (!noopResult?.ok) {
    throw new Error('apply_patches should resolve ok for empty patch list');
  }
  if ((world.systems?.time?.elapsedMinutes ?? 0) !== timeBeforeNoop) {
    throw new Error('Empty patch list should leave world unchanged');
  }
  if (world.ledger.length !== ledgerBeforeNoop.length) {
    throw new Error('Empty patch list should not add ledger entries');
  }
  console.log('  ✓ Empty patch list is treated as a no-op');

  const ledgerBeforeMalformed = world.ledger.slice();
  const timeBeforeMalformed = world.systems?.time?.elapsedMinutes ?? 0;
  const malformedResult = await runtime.apply_patches({ defaultNote: 'malformed' } as any);
  if (!malformedResult?.ok) {
    throw new Error('apply_patches should resolve ok when patches field is missing');
  }
  if ((world.systems?.time?.elapsedMinutes ?? 0) !== timeBeforeMalformed) {
    throw new Error('Missing patches array should leave world unchanged');
  }
  if (world.ledger.length !== ledgerBeforeMalformed.length) {
    throw new Error('Missing patches array should not append ledger entries');
  }
  console.log('  ✓ Missing patches array is coerced to safe no-op');

  console.log('\n✅ apply_patches tool tests passed');
}

main().catch((err) => {
  console.error('apply_patches tool tests failed:', err);
  process.exit(1);
});


