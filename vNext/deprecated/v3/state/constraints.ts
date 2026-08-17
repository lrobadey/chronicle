import type { SimpleWorld } from './world';
import type { TurnTelemetry } from './telemetry';
import type { Patch } from '../tools/types';
import { getWeatherTravelMultiplier } from './weather';

export interface TurnConstraints {
  maxMoveMeters: number;
  weatherMultiplier: number;
  blockedLocations: string[];
  advisories: string[];
}

export function buildTurnConstraints(world: SimpleWorld, telemetry: TurnTelemetry): TurnConstraints {
  const baseMoveMeters = 600;
  const weatherData = telemetry.systems?.weather;
  
  // Use local weather effects travelMultiplier if available, otherwise fall back to global
  let weatherMultiplier = 1.0;
  if (weatherData?.local?.travelMultiplier !== undefined) {
    weatherMultiplier = weatherData.local.travelMultiplier;
  } else if (weatherData) {
    weatherMultiplier = getWeatherTravelMultiplier(weatherData as any);
  }
  
  const maxMoveMeters = Math.max(150, Math.round(baseMoveMeters * weatherMultiplier));
  
  // Start with tide-blocked locations
  const blockedLocations = [...(telemetry.systems?.tide?.blocked ?? [])];
  
  // Add weather-blocked locations (flood_risk:extreme + access:unsafe)
  if (weatherData?.local?.localSignals) {
    for (const [locationId, location] of Object.entries(world.locations)) {
      const locationMetadata = location.weatherMetadata;
      if (locationMetadata) {
        // Check if this location would have flood_risk:extreme or access:unsafe
        // We need to check the location's metadata against current weather
        // For now, we'll check if the current location has these signals and apply to similar locations
        const hasFloodRisk = weatherData.local.localSignals.some(
          (s) => s === 'flood_risk:extreme' || s === 'access:unsafe'
        );
        if (hasFloodRisk && locationMetadata.elevation === 'low' && locationMetadata.drainage === 'poor') {
          // Only block if it's also near ocean (like the Maw)
          if (locationMetadata.nearOcean && !blockedLocations.includes(locationId)) {
            blockedLocations.push(locationId);
          }
        }
      }
    }
  }

  const advisories: string[] = [];
  if (weatherMultiplier < 0.8) {
    advisories.push('Severe weather slowing travel — prefer short moves');
  }
  if (blockedLocations.length) {
    advisories.push(`Tide blocks: ${blockedLocations.join(', ')}`);
  }
  
  // Add local weather advisories
  if (weatherData?.local?.localSignals) {
    const localAdvisories: string[] = [];
    if (weatherData.local.localSignals.includes('cliff_risk:high')) {
      localAdvisories.push('High cliff risk in storms');
    }
    if (weatherData.local.localSignals.includes('flood_risk:extreme')) {
      localAdvisories.push('Extreme flood risk — avoid low-lying areas');
    }
    if (weatherData.local.localSignals.includes('wind_risk:extreme')) {
      localAdvisories.push('Extreme wind risk — avoid exposed areas');
    }
    if (weatherData.local.localSignals.includes('visibility:very_low')) {
      localAdvisories.push('Very low visibility — travel carefully');
    }
    if (localAdvisories.length) {
      advisories.push(...localAdvisories);
    }
  }

  return {
    maxMoveMeters,
    weatherMultiplier,
    blockedLocations,
    advisories,
  };
}

export function formatTurnConstraints(constraints: TurnConstraints): string {
  return [
    `Max travel distance: ${constraints.maxMoveMeters}m this turn`,
    `Weather multiplier: x${constraints.weatherMultiplier.toFixed(2)}`,
    constraints.blockedLocations.length ? `Blocked locations: ${constraints.blockedLocations.join(', ')}` : null,
    constraints.advisories.length ? `Advisories: ${constraints.advisories.join(' | ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export function validatePatchesAgainstConstraints(
  patches: Patch[],
  constraints: TurnConstraints,
  world: SimpleWorld
): string[] {
  const violations: string[] = [];
  const origin = world.player.pos;

  for (const patch of patches) {
    if (patch.path === '/player/location' && typeof (patch as any).value === 'string') {
      const targetLocation = (patch as any).value;
      if (constraints.blockedLocations.includes(targetLocation)) {
        violations.push(`Attempted to move to blocked location "${targetLocation}" (tide or weather hazard).`);
      }
    }

    if (patch.path === '/player/pos' && patch.op === 'set' && typeof (patch as any).value === 'object') {
      const target = (patch as any).value;
      if (origin && typeof target?.x === 'number' && typeof target?.y === 'number') {
        const dx = target.x - origin.x;
        const dy = target.y - origin.y;
        const dz = (target.z ?? 0) - (origin.z ?? 0);
        const distance = Math.hypot(dx, dy, dz);
        if (distance > constraints.maxMoveMeters + 5) {
          violations.push(
            `Player move of ${Math.round(distance)}m exceeds limit of ${constraints.maxMoveMeters}m.`
          );
        }
      }
    }
  }

  return violations;
}

