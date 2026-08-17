/**
 * Local Weather Effects Interpreter
 * 
 * Translates global weather snapshot into location-specific effects.
 * Pure function - no side effects, deterministic.
 */

import type { ChronicleWeatherSnapshot } from './types';
import type { LocationWeatherMetadata, LocalWeatherEffects } from './types';

/**
 * Derive local weather effects from global snapshot + location metadata
 * 
 * This function interprets how the global weather "feels" at a specific location
 * based on that location's physical characteristics.
 */
export function deriveLocalWeather(
  globalSnapshot: ChronicleWeatherSnapshot,
  locationMetadata: LocationWeatherMetadata
): LocalWeatherEffects {
  const effects: LocalWeatherEffects = {
    visibility: 'normal',
    footing: 'normal',
    comfort: 'exposed',
    travelMultiplier: 1.0,
    localSignals: [],
  };

  // Compute visibility
  effects.visibility = computeVisibility(globalSnapshot, locationMetadata);

  // Compute footing
  effects.footing = computeFooting(globalSnapshot, locationMetadata);

  // Compute comfort
  effects.comfort = computeComfort(globalSnapshot, locationMetadata);

  // Compute travel multiplier
  effects.travelMultiplier = computeTravelMultiplier(globalSnapshot, locationMetadata);

  // Generate location-specific signals
  effects.localSignals = generateLocalSignals(globalSnapshot, locationMetadata);

  return effects;
}

/**
 * Compute visibility level at this location
 */
function computeVisibility(
  snapshot: ChronicleWeatherSnapshot,
  metadata: LocationWeatherMetadata
): 'normal' | 'low' | 'very_low' {
  // Indoors locations are always normal visibility (protected)
  if (metadata.indoors) {
    return 'normal';
  }

  // Fog reduces visibility
  if (snapshot.type === 'fog') {
    if (metadata.fogProne) {
      return 'very_low'; // Fog-prone locations get worse visibility
    }
    if (metadata.elevation === 'high') {
      return 'low'; // High elevation might be above fog line
    }
    return 'very_low';
  }

  // Storm reduces visibility
  if (snapshot.type === 'storm') {
    if (metadata.elevation === 'high' && metadata.windExposure === 'high') {
      return 'low'; // High exposed areas: wind clears some visibility
    }
    return 'very_low';
  }

  // Rain reduces visibility slightly
  if (snapshot.type === 'rain' && snapshot.intensity >= 3) {
    return 'low';
  }

  return 'normal';
}

/**
 * Compute footing conditions
 */
function computeFooting(
  snapshot: ChronicleWeatherSnapshot,
  metadata: LocationWeatherMetadata
): 'normal' | 'slippery' | 'dangerous' {
  // Indoors locations generally have better footing
  if (metadata.indoors) {
    if (snapshot.type === 'rain' && snapshot.intensity >= 3) {
      return 'slippery'; // Even indoors can get slippery in heavy rain
    }
    return 'normal';
  }

  // Poor drainage + rain/storm = dangerous
  if (metadata.drainage === 'poor' && (snapshot.type === 'rain' || snapshot.type === 'storm')) {
    if (snapshot.intensity >= 4) {
      return 'dangerous';
    }
    return 'slippery';
  }

  // High elevation + storm + high wind exposure = dangerous
  if (
    metadata.elevation === 'high' &&
    metadata.windExposure === 'high' &&
    snapshot.type === 'storm' &&
    snapshot.intensity >= 3
  ) {
    return 'dangerous';
  }

  // Rain makes things slippery
  if (snapshot.type === 'rain' && snapshot.intensity >= 2) {
    return 'slippery';
  }

  // Snow makes things slippery
  if (snapshot.type === 'snow') {
    return 'slippery';
  }

  return 'normal';
}

/**
 * Compute comfort level
 */
function computeComfort(
  snapshot: ChronicleWeatherSnapshot,
  metadata: LocationWeatherMetadata
): 'cozy' | 'exposed' | 'miserable' {
  // Indoors locations are cozy
  if (metadata.indoors && metadata.enclosed === 'high') {
    return 'cozy';
  }

  // High wind exposure + storm = miserable
  if (
    metadata.windExposure === 'high' &&
    (snapshot.type === 'storm' || snapshot.windKph >= 40)
  ) {
    return 'miserable';
  }

  // Low temperature + high exposure = miserable
  if (snapshot.temperatureC < 5 && metadata.windExposure !== 'low') {
    return 'miserable';
  }

  // Storm + high coastal exposure = miserable
  if (snapshot.type === 'storm' && metadata.coastalExposure === 'high') {
    return 'miserable';
  }

  // Moderate conditions = exposed
  if (snapshot.type === 'rain' || snapshot.type === 'fog') {
    return 'exposed';
  }

  // Clear weather = exposed (not miserable, but not cozy either)
  return 'exposed';
}

/**
 * Compute travel speed multiplier
 */
function computeTravelMultiplier(
  snapshot: ChronicleWeatherSnapshot,
  metadata: LocationWeatherMetadata
): number {
  let multiplier = 1.0;

  // Base multiplier from weather type
  switch (snapshot.type) {
    case 'clear':
      multiplier = 1.0;
      break;
    case 'rain':
      multiplier = snapshot.intensity <= 2 ? 0.9 : 0.8;
      break;
    case 'storm':
      multiplier = snapshot.intensity <= 3 ? 0.75 : 0.6;
      break;
    case 'fog':
      multiplier = snapshot.intensity <= 2 ? 0.85 : 0.7;
      break;
    case 'snow':
      multiplier = snapshot.intensity <= 2 ? 0.7 : 0.5;
      break;
  }

  // Location-specific adjustments

  // Poor drainage + rain = slower
  if (metadata.drainage === 'poor' && (snapshot.type === 'rain' || snapshot.type === 'storm')) {
    multiplier *= 0.8;
  }

  // High wind exposure + high wind = slower
  if (metadata.windExposure === 'high' && snapshot.windKph >= 40) {
    multiplier *= 0.85;
  }

  // Dangerous footing = much slower
  const footing = computeFooting(snapshot, metadata);
  if (footing === 'dangerous') {
    multiplier *= 0.6;
  } else if (footing === 'slippery') {
    multiplier *= 0.8;
  }

  return Math.max(0.3, Math.min(1.0, multiplier));
}

/**
 * Generate location-specific signals
 */
function generateLocalSignals(
  snapshot: ChronicleWeatherSnapshot,
  metadata: LocationWeatherMetadata
): string[] {
  const signals: string[] = [];

  // Cliff risk: high elevation + high wind exposure + storm
  if (
    metadata.elevation === 'high' &&
    metadata.windExposure === 'high' &&
    snapshot.type === 'storm' &&
    snapshot.intensity >= 3
  ) {
    signals.push('cliff_risk:high');
  }

  // Flood risk: low elevation + poor drainage + storm/rain + near ocean
  if (
    metadata.elevation === 'low' &&
    metadata.drainage === 'poor' &&
    metadata.nearOcean &&
    (snapshot.type === 'storm' || (snapshot.type === 'rain' && snapshot.intensity >= 4))
  ) {
    signals.push('flood_risk:extreme');
  } else if (
    metadata.elevation === 'low' &&
    metadata.drainage === 'poor' &&
    snapshot.type === 'rain' &&
    snapshot.intensity >= 3
  ) {
    signals.push('flood_risk:high');
  }

  // Access unsafe: flood risk + high tide (would need tide info, but we'll add signal anyway)
  if (signals.includes('flood_risk:extreme')) {
    signals.push('access:unsafe');
  }

  // Wind risk: high wind exposure + high wind speed
  if (metadata.windExposure === 'high' && snapshot.windKph >= 50) {
    signals.push('wind_risk:extreme');
  } else if (metadata.windExposure === 'high' && snapshot.windKph >= 35) {
    signals.push('wind_risk:high');
  }

  // Fog signal: fog-prone locations
  if (snapshot.type === 'fog' && metadata.fogProne) {
    signals.push('fog:dense');
  }

  // Visibility signal: very low visibility locations
  const visibility = computeVisibility(snapshot, metadata);
  if (visibility === 'very_low') {
    signals.push('visibility:very_low');
  }

  return signals;
}

