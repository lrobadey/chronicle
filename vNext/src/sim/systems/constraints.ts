import type { WorldState } from '../state';
import { deriveTide } from './tide';
import { deriveWeather, weatherTravelMultiplier } from './weather';

export interface TurnConstraints {
  maxMoveMeters: number;
  weatherMultiplier: number;
  blockedLocationIds: string[];
  advisories: string[];
}

export function deriveConstraints(state: WorldState): TurnConstraints {
  const baseMoveMeters = 600;
  const weather = deriveWeather(state);
  const tide = deriveTide(state);

  const weatherMultiplier = weatherTravelMultiplier(weather);
  const maxMoveMeters = Math.max(150, Math.round(baseMoveMeters * weatherMultiplier));
  const advisories: string[] = [];
  if (weatherMultiplier < 0.8) advisories.push('Severe weather slowing travel');
  if (tide.blockedLocationIds.length) advisories.push(`Tide blocks: ${tide.blockedLocationIds.join(', ')}`);

  return {
    maxMoveMeters,
    weatherMultiplier,
    blockedLocationIds: tide.blockedLocationIds,
    advisories,
  };
}
