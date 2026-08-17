import type { GridPos, Terrain, WorldState } from '../state';
import { deriveWeather, weatherTravelMultiplier } from './weather';
import { distance, findNearestLocation } from '../utils';

export const LONG_TRAVEL_MINUTES = 20;

export type TravelPace = 'walk' | 'run';

export interface TravelEstimate {
  distanceMeters: number;
  minutes: number;
  weatherMultiplier: number;
  terrainMultiplier: number;
}

export function estimateTravel(state: WorldState, from: GridPos, to: GridPos, pace: TravelPace = 'walk'): TravelEstimate {
  const distanceMeters = distance(from, to) * state.map.cellSizeMeters;
  const weather = deriveWeather(state);
  const weatherMultiplier = weatherTravelMultiplier(weather);
  const terrainMultiplier = terrainMultiplierAtPos(state, to);
  const baseSpeedMps = pace === 'run' ? 2.0 : 1.4;
  const minutes = Math.max(1, Math.round((distanceMeters / baseSpeedMps / 60) * terrainMultiplier * weatherMultiplier));
  return { distanceMeters, minutes, weatherMultiplier, terrainMultiplier };
}

export function terrainMultiplierAtPos(state: WorldState, pos: GridPos): number {
  const nearest = findNearestLocation(state, pos);
  return terrainMultiplierForTerrain(nearest?.terrain ?? 'unknown');
}

export function terrainMultiplierForTerrain(terrain: Terrain): number {
  switch (terrain) {
    case 'road': return 0.8;
    case 'path': return 1.0;
    case 'beach': return 1.2;
    case 'forest': return 1.5;
    case 'mountain': return 2.5;
    case 'water': return 3.0;
    case 'interior': return 0.9;
    case 'cavern': return 1.4;
    case 'unknown':
    default:
      return 1.0;
  }
}

export function positionToward(from: GridPos, to: GridPos, maxDistanceCells: number): GridPos {
  const totalDistance = distance(from, to);
  if (totalDistance <= maxDistanceCells || totalDistance === 0) return { ...to };
  const ratio = maxDistanceCells / totalDistance;
  return {
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio,
    z: (from.z ?? 0) + ((to.z ?? 0) - (from.z ?? 0)) * ratio,
  };
}
