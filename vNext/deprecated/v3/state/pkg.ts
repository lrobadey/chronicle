import type { SimpleWorld } from './world';
import { ensureSeededFromWorld } from './graphContext';
import { P } from './graph';

export interface ProjectedPKG {
  playerId: string;
  currentLocationId: string;
  knownLocations: Array<{
    id: string;
    name: string;
    visited: boolean;
    lastVisitedTurn?: number;
  }>;
  knownNPCs: Array<{
    id: string;
    name: string;
    lastSeenLocationId?: string;
    lastSeenTurn?: number;
  }>;
  knownItems: Array<{
    id: string;
    name: string;
    lastSeenLocationId?: string;
    inInventory: boolean;
  }>;
  nearbyDirections: Array<{
    direction: string; // 'north', 'south', etc.
    locationId?: string;
    locationName?: string;
    distance?: number;
  }>;
}

// Simple heuristic: player knows about their current location, 
// locations they've been to (tracked in ledger mentions), 
// and nearby locations (within perception range)
export function projectPKGFromGraph(world: SimpleWorld): ProjectedPKG {
  const store = ensureSeededFromWorld(world);
  const playerId = world.player.id;
  const located = store.getLocatedIn(playerId);
  const currentLocationId = located?.obj || world.player.location;
  
  // Parse ledger to find visited locations
  const visitedLocations = new Set<string>([currentLocationId]);
  const ledgerText = world.ledger.join(' ').toLowerCase();
  for (const [id, loc] of Object.entries(world.locations)) {
    if (ledgerText.includes(loc.name.toLowerCase()) || ledgerText.includes(id.toLowerCase())) {
      visitedLocations.add(id);
    }
  }

  // Known locations: visited + nearby (within 100m perception)
  const knownLocations: ProjectedPKG['knownLocations'] = [];
  const playerPos = world.player.pos || world.locations[currentLocationId]?.coords || { x: 0, y: 0 };
  
  for (const [id, loc] of Object.entries(world.locations)) {
    const visited = visitedLocations.has(id);
    const locPos = loc.coords || store.getPosition(id);
    
    // Add if visited or if nearby
    let isNearby = false;
    if (locPos && id !== currentLocationId) {
      const dist = Math.hypot(locPos.x - playerPos.x, locPos.y - playerPos.y, (locPos.z ?? 0) - (playerPos.z ?? 0));
      isNearby = dist < 100;
    }
    
    if (visited || isNearby || id === currentLocationId) {
      knownLocations.push({
        id,
        name: loc.name,
        visited,
        lastVisitedTurn: visited ? world.meta?.turn : undefined,
      });
    }
  }

  // Known NPCs: mentioned in ledger or in current location
  const knownNPCs: ProjectedPKG['knownNPCs'] = [];
  if (world.npcs) {
    for (const [id, npc] of Object.entries(world.npcs)) {
      if (npc.location === currentLocationId || ledgerText.includes(npc.name.toLowerCase())) {
        knownNPCs.push({
          id,
          name: npc.name,
          lastSeenLocationId: npc.location,
          lastSeenTurn: world.meta?.turn,
        });
      }
    }
  }

  // Known items: in inventory or in current location
  const knownItems: ProjectedPKG['knownItems'] = [];
  const currentLocEntity = store.getEntity(currentLocationId);
  const contains = store.getRelationsBySubject(currentLocationId).filter((r) => r.pred === P.contains);
  const itemsHere = contains.map((r) => store.getEntity(r.obj)).filter(Boolean);
  
  for (const item of world.player.inventory) {
    knownItems.push({
      id: item.id,
      name: item.name,
      inInventory: true,
    });
  }
  
  for (const entity of itemsHere) {
    if (entity) {
      knownItems.push({
        id: entity.id,
        name: String(entity.props?.name || entity.id),
        lastSeenLocationId: currentLocationId,
        inInventory: false,
      });
    }
  }

  // Nearby directions (cardinal directions to nearby locations)
  const nearbyDirections: ProjectedPKG['nearbyDirections'] = [];
  for (const [id, loc] of Object.entries(world.locations)) {
    if (id === currentLocationId) continue;
    const locPos = loc.coords || store.getPosition(id);
    if (!locPos) continue;
    
    const dx = locPos.x - playerPos.x;
    const dy = locPos.y - playerPos.y;
    const dist = Math.hypot(dx, dy, (locPos.z ?? 0) - (playerPos.z ?? 0));
    
    if (dist < 150 && dist > 0.1) {
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      let direction: string;
      if (angle >= -45 && angle < 45) direction = 'east';
      else if (angle >= 45 && angle < 135) direction = 'north';
      else if (angle >= 135 || angle < -135) direction = 'west';
      else direction = 'south';
      
      nearbyDirections.push({
        direction,
        locationId: id,
        locationName: loc.name,
        distance: Math.round(dist),
      });
    }
  }

  return {
    playerId,
    currentLocationId,
    knownLocations,
    knownNPCs,
    knownItems,
    nearbyDirections,
  };
}

// Backward compatibility
export function projectPKG(world: SimpleWorld): { playerId: string; currentLocationId: string; knownLocations: string[] } {
  const full = projectPKGFromGraph(world);
  return {
    playerId: full.playerId,
    currentLocationId: full.currentLocationId,
    knownLocations: full.knownLocations.map((l) => l.id),
  };
}


