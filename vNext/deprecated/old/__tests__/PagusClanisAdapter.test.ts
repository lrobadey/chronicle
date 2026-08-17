// PagusClanisAdapter.test.ts - Non-network tests for query adapter
import { createPagusClanisGTWG, createPagusClanisQueryAdapter } from '../data/PagusClanis.js';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`TEST FAILED: ${message}`);
}

async function run() {
  console.log('Starting PagusClanis adapter tests...');
  const gtwg = createPagusClanisGTWG();
  const adapter = createPagusClanisQueryAdapter(gtwg);

  try {
    const regions = await adapter({ type: 'entities_by_type', entityType: 'region' });
    console.log('regions length:', Array.isArray(regions) ? regions.length : 'not array');
    assert(Array.isArray(regions) && regions.length >= 5, 'Should return at least 5 regions');
  } catch (e) {
    console.error('regions test failed:', e);
    throw e;
  }

  try {
    const villa = await adapter({ type: 'entity', id: 'villa-aelia' });
    console.log('villa:', villa?.name);
    assert(villa && villa.name === 'Villa Aelia', 'Should retrieve Villa Aelia entity');
  } catch (e) {
    console.error('villa test failed:', e);
    throw e;
  }

  try {
    const trades = await adapter({ type: 'connected', id: 'villa-aelia', relationType: 'trades_with', direction: 'out' });
    console.log('trades length:', Array.isArray(trades) ? trades.length : 'not array');
    assert(Array.isArray(trades) && trades.length >= 1, 'Villa should trade with at least one location');
  } catch (e) {
    console.error('trades test failed:', e);
    throw e;
  }

  try {
    const owns = await adapter({ type: 'relations_of', fromId: 'aelia-tertia', relationType: 'owns' });
    console.log('owns length:', Array.isArray(owns) ? owns.length : 'not array');
    assert(Array.isArray(owns) && owns.length >= 1, 'Aelia Tertia should own something');
  } catch (e) {
    console.error('owns test failed:', e);
    throw e;
  }

  console.log('✅ PagusClanis adapter tests passed');
}

run().catch((e) => {
  console.error('❌ PagusClanis adapter tests failed:', e);
  process.exit(1);
});


