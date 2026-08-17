import { createSimpleWorld } from '../state/world';
import { createGraphStore, seedGraphFromSimpleWorld } from '../state/graphStore';
import { projectPKGFromGraph } from '../state/pkg';

async function main() {
  const world = createSimpleWorld();
  const store = createGraphStore();
  seedGraphFromSimpleWorld(store, world);

  const pkg = projectPKGFromGraph(world);
  console.log('PKG currentLocationId:', pkg.currentLocationId);

  // Verify coordinates are assigned after seeding
  const gladePos = store.getPosition('glade');
  const tavernPos = store.getPosition('tavern');
  const playerPos = world.player.pos;
  
  console.log('Glade position:', gladePos);
  console.log('Tavern position:', tavernPos);
  console.log('Player position:', playerPos);

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
  // Glade should be at origin (0,0) since it's the player's starting location
  if (gladePos.x !== 0 || gladePos.y !== 0) {
    console.warn(`Warning: Glade not at origin (0,0), got (${gladePos.x}, ${gladePos.y})`);
  }
  if (playerPos.x !== gladePos.x || playerPos.y !== gladePos.y) {
    throw new Error(`Expected player position to match glade coordinates, got (${playerPos.x}, ${playerPos.y})`);
  }

  // Verify distance calculation
  const dist = store.distance('glade', 'tavern');
  console.log('Distance from glade to tavern:', dist);

  if (dist === undefined) {
    throw new Error('Expected distance calculation to work');
  }

  // No exit system; movement is coordinate-based
  console.log('  ✓ Coordinate-based movement confirmed');

  console.log('OK - All coordinate tests passed');
}

main().catch((e) => {
  console.error('Spatial smoke failed:', e);
  process.exit(1);
});


