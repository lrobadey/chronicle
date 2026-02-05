import type { Actor, ActorId, GridPos, LocationPOI, WorldState } from './state';

export function distance(a: GridPos, b: GridPos): number {
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(a.x - b.x, a.y - b.y, dz);
}

export function isWithinBounds(state: WorldState, pos: GridPos): boolean {
  const { minX, minY, maxX, maxY } = state.map;
  return pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY;
}

export function findNearestLocation(state: WorldState, pos: GridPos): LocationPOI | null {
  let nearest: { loc: LocationPOI; dist: number } | null = null;
  for (const loc of Object.values(state.locations)) {
    const d = distance(loc.anchor, pos);
    if (!nearest || d < nearest.dist) nearest = { loc, dist: d };
  }
  return nearest?.loc ?? null;
}

export function locationsWithinRadius(state: WorldState, pos: GridPos, radius: number): LocationPOI[] {
  const out: LocationPOI[] = [];
  for (const loc of Object.values(state.locations)) {
    if (distance(loc.anchor, pos) <= radius) out.push(loc);
  }
  return out;
}

export function actorsWithinRadius(state: WorldState, pos: GridPos, radius: number): Actor[] {
  const out: Actor[] = [];
  for (const actor of Object.values(state.actors)) {
    if (distance(actor.pos, pos) <= radius) out.push(actor);
  }
  return out;
}

export function getActor(state: WorldState, id: ActorId): Actor | null {
  return state.actors[id] ?? null;
}
