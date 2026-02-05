/**
 * Chronicle v4 - Travel Calculations
 * 
 * Deterministic travel time calculations based on distance, terrain, and weather.
 */

import type { World, Position, Terrain } from './world';
import { computeWeather, getWeatherTravelMultiplier } from './systems';

// ============================================================================
// TERRAIN MULTIPLIERS
// ============================================================================

const TERRAIN_MULTIPLIERS: Record<Terrain, number> = {
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

// ============================================================================
// TRAVEL CALCULATION
// ============================================================================

export interface TravelResult {
  distanceMeters: number;
  baseMinutes: number;
  adjustedMinutes: number;
  terrainMultiplier: number;
  speedMetersPerSecond: number;
  fromLocationId: string | null;
  toLocationId: string | null;
}

export interface TravelOptions {
  baseSpeedMetersPerSecond?: number;
  weatherMultiplier?: number;
}

export function calculateTravel(
  world: World,
  from: Position | string,
  to: Position | string,
  options: TravelOptions = {}
): TravelResult {
  const fromPosition = resolvePosition(world, from);
  const toPosition = resolvePosition(world, to);
  const fromLocationId = typeof from === 'string' ? from : findNearestLocationId(world, fromPosition);
  const toLocationId = typeof to === 'string' ? to : findNearestLocationId(world, toPosition);

  const distanceMeters = distance(fromPosition, toPosition);
  const baseSpeed = options.baseSpeedMetersPerSecond ?? 1.4; // ~5 km/h walking
  const baseMinutes = distanceMeters / baseSpeed / 60;

  // Terrain multiplier (use destination terrain)
  const terrainMultiplier = getTerrainMultiplier(world, fromLocationId, toLocationId);
  
  // Weather multiplier
  let weatherMultiplier = options.weatherMultiplier ?? 1.0;
  if (weatherMultiplier === 1.0) {
    const weather = computeWeather(world);
    if (weather) weatherMultiplier = getWeatherTravelMultiplier(weather);
  }

  const adjustedMinutes = baseMinutes * terrainMultiplier * weatherMultiplier;

  return {
    distanceMeters,
    baseMinutes,
    adjustedMinutes,
    terrainMultiplier: terrainMultiplier * weatherMultiplier,
    speedMetersPerSecond: baseSpeed,
    fromLocationId,
    toLocationId,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function resolvePosition(world: World, value: Position | string): Position {
  if (typeof value !== 'string') return value;
  
  const location = world.locations[value];
  if (location?.coords) return location.coords;
  
  // Fall back to player position if resolving current location
  if (value === world.player.location && world.player.pos) return world.player.pos;
  
  return { x: 0, y: 0 };
}

function findNearestLocationId(world: World, pos: Position): string | null {
  let nearest: { id: string; dist: number } | null = null;
  
  for (const loc of Object.values(world.locations)) {
    if (!loc.coords) continue;
    const d = distance(pos, loc.coords);
    if (!nearest || d < nearest.dist) {
      nearest = { id: loc.id, dist: d };
    }
  }
  
  return nearest?.id ?? null;
}

function distance(a: Position, b: Position): number {
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(a.x - b.x, a.y - b.y, dz);
}

function getTerrainMultiplier(world: World, fromId: string | null, toId: string | null): number {
  const getMultiplier = (locId: string | null): number => {
    if (!locId) return TERRAIN_MULTIPLIERS.unknown;
    const loc = world.locations[locId];
    if (!loc) return TERRAIN_MULTIPLIERS.unknown;
    if (typeof loc.travelSpeedMultiplier === 'number') return Math.max(0.1, loc.travelSpeedMultiplier);
    return TERRAIN_MULTIPLIERS[loc.terrain ?? 'unknown'];
  };

  // Use the harder terrain of the two
  return Math.max(getMultiplier(fromId), getMultiplier(toId));
}

