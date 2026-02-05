import type { SimpleWorld, SimpleWorldLocation, SimpleWorldPosition } from './world';

export type TravelTerrain = NonNullable<SimpleWorldLocation['terrain']>;

export interface TravelCalculation {
  distanceMeters: number;
  baseMinutes: number;
  adjustedMinutes: number;
  speedMetersPerSecond: number;
  terrainMultiplier: number;
  fromLocationId: string | null;
  toLocationId: string | null;
}

export const DEFAULT_TERRAIN_MULTIPLIERS: Record<Exclude<TravelTerrain, undefined> | 'unknown', number> = {
  road: 0.8,
  path: 1.0,
  beach: 1.2,
  forest: 1.5,
  mountain: 2.5,
  water: 3.0,
  interior: 0.9,
  cavern: 1.4,
  unknown: 1.0,
};

export interface TravelOptions {
  baseSpeedMetersPerSecond?: number;
  weatherMultiplier?: number;
}

export function calculateTravelTime(
  world: SimpleWorld,
  from: SimpleWorldPosition | string,
  to: SimpleWorldPosition | string,
  options: TravelOptions = {}
): TravelCalculation {
  const fromPosition = resolvePosition(world, from);
  const toPosition = resolvePosition(world, to);

  const fromLocationId = typeof from === 'string' ? from : findNearestLocationId(world, fromPosition);
  const toLocationId = typeof to === 'string' ? to : findNearestLocationId(world, toPosition);

  const distanceMeters = distanceBetween(fromPosition, toPosition);
  const baseSpeed = options.baseSpeedMetersPerSecond ?? 1.4; // ~5 km/h
  const baseMinutes = distanceMeters / baseSpeed / 60;

  const terrainMultiplier = calculateTerrainMultiplier(world, fromLocationId, toLocationId);
  const weatherMultiplier = options.weatherMultiplier ?? 1.0;
  const adjustedMinutes = baseMinutes * terrainMultiplier * weatherMultiplier;

  return {
    distanceMeters,
    baseMinutes,
    adjustedMinutes,
    speedMetersPerSecond: baseSpeed,
    terrainMultiplier: terrainMultiplier * weatherMultiplier,
    fromLocationId,
    toLocationId,
  };
}

export function resolvePosition(world: SimpleWorld, value: SimpleWorldPosition | string): SimpleWorldPosition {
  if (typeof value !== 'string') {
    return { x: value.x, y: value.y, ...(value.z !== undefined ? { z: value.z } : {}) };
  }
  const location = world.locations[value];
  if (location?.coords) {
    return { x: location.coords.x, y: location.coords.y, ...(location.coords.z !== undefined ? { z: location.coords.z } : {}) };
  }
  // Fall back to player position if resolving current location
  if (value === world.player.location && world.player.pos) {
    return { x: world.player.pos.x, y: world.player.pos.y, ...(world.player.pos.z !== undefined ? { z: world.player.pos.z } : {}) };
  }
  return { x: 0, y: 0, z: 0 };
}

export function findNearestLocationId(world: SimpleWorld, pos: SimpleWorldPosition): string | null {
  let nearest: { id: string; distance: number } | null = null;
  for (const location of Object.values(world.locations)) {
    if (!location.coords) continue;
    const d = distanceBetween(pos, location.coords);
    if (!nearest || d < nearest.distance) {
      nearest = { id: location.id, distance: d };
    }
  }
  return nearest?.id ?? null;
}

function distanceBetween(a: SimpleWorldPosition, b: SimpleWorldPosition): number {
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(a.x - b.x, a.y - b.y, dz);
}

function calculateTerrainMultiplier(world: SimpleWorld, fromId: string | null, toId: string | null): number {
  const fromMultiplier = getTerrainMultiplier(world.locations[fromId ?? '']);
  const toMultiplier = getTerrainMultiplier(world.locations[toId ?? '']);
  return Math.max(fromMultiplier, toMultiplier);
}

function getTerrainMultiplier(location: SimpleWorldLocation | undefined): number {
  if (!location) return DEFAULT_TERRAIN_MULTIPLIERS.unknown;
  if (typeof location.travelSpeedMultiplier === 'number' && !Number.isNaN(location.travelSpeedMultiplier)) {
    return Math.max(0.1, location.travelSpeedMultiplier);
  }
  const terrain = location.terrain ?? 'unknown';
  return DEFAULT_TERRAIN_MULTIPLIERS[terrain] ?? DEFAULT_TERRAIN_MULTIPLIERS.unknown;
}

