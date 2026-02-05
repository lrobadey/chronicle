import type { SimpleWorld } from './world';
import { createGraphStore, type GraphStore, seedGraphFromSimpleWorld } from './graphStore';

let store: GraphStore | null = null;
let seededSignature: string | null = null;

function worldSignature(world: SimpleWorld): string {
  // Simple signature; can be improved later
  return JSON.stringify({
    player: world.player.id,
    locs: Object.keys(world.locations).sort(),
    edges: Object.entries(world.locations).flatMap(([id, l]) => Object.entries(l.exits || {}).map(([d, to]) => `${id}:${d}:${to}`)).sort(),
  });
}

export function ensureSeededFromWorld(world: SimpleWorld): GraphStore {
  if (!store) {
    store = createGraphStore();
    seedGraphFromSimpleWorld(store, world);
    seededSignature = worldSignature(world);
    return store;
  }
  const sig = worldSignature(world);
  if (seededSignature !== sig) {
    // Re-seed only if topology changed; for now re-create store
    store = createGraphStore();
    seedGraphFromSimpleWorld(store, world);
    seededSignature = sig;
  }
  return store!;
}

export function getGraphStore(): GraphStore {
  if (!store) throw new Error('Graph store not initialized. Call ensureSeededFromWorld first.');
  return store;
}


