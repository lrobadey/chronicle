/**
 * Weather System - Backward Compatible API
 * 
 * This module maintains the existing WeatherSnapshot API while using
 * the new ChronicleWeatherEngine under the hood.
 */

import type { SimpleWorld } from './world';
import { deriveAbsoluteTime, ensureTimeAnchor, getTimeState } from './time';
import { ChronicleWeatherEngine } from './weather/engine';
import type { ChronicleWeatherSnapshot } from './weather/types';

// Re-export types for backward compatibility
export type WeatherType = 'clear' | 'rain' | 'storm' | 'fog' | 'snow';
export type PressureSystem = 'high' | 'low' | 'front' | 'stable';
export type ClimateZone =
  | 'tropical'
  | 'desert'
  | 'temperate'
  | 'cold'
  | 'arctic'
  | 'mediterranean'
  | 'high_altitude';

/**
 * WeatherSnapshot - backward compatible interface
 * This is a subset of ChronicleWeatherSnapshot for existing code
 */
export interface WeatherSnapshot {
  type: WeatherType;
  intensity: number; // 0-5 scale
  temperatureC: number;
  windKph: number;
  pressure: {
    system: PressureSystem;
    hPa: number;
    trend: 'rising' | 'falling' | 'stable';
  };
  signals: string[];
  lastComputedTurn: number;
}

export interface WeatherSystemState {
  climate: ClimateZone;
  seed?: string;
  cache?: {
    lastTurn: number;
    snapshot: WeatherSnapshot;
  };
}

/**
 * Convert ChronicleWeatherSnapshot to WeatherSnapshot (backward compatibility)
 */
function toWeatherSnapshot(chronicle: ChronicleWeatherSnapshot): WeatherSnapshot {
  return {
    type: chronicle.type,
    intensity: chronicle.intensity,
    temperatureC: chronicle.temperatureC,
    windKph: chronicle.windKph,
    pressure: chronicle.pressure,
    signals: chronicle.signals,
    lastComputedTurn: chronicle.lastComputedTurn,
  };
}

/**
 * Ensure weather snapshot exists and is up to date
 * Uses ChronicleWeatherEngine under the hood
 */
export function ensureWeatherSnapshot(world: SimpleWorld): WeatherSnapshot | undefined {
  const weatherConfig = ensureWeatherSystem(world);
  const currentTurn = world.meta?.turn ?? 0;

  // Check cache
  if (weatherConfig.cache && weatherConfig.cache.lastTurn === currentTurn) {
    return weatherConfig.cache.snapshot;
  }

  // Resolve absolute time
  const absoluteIso = resolveAbsoluteTime(world);
  if (!absoluteIso) {
    return undefined;
  }

  // Use ChronicleWeatherEngine
  const engine = new ChronicleWeatherEngine();
  const seed = weatherConfig.seed ?? world.meta?.seed ?? 'chronicle';
  const previousSnapshot = weatherConfig.cache?.snapshot
    ? {
        ...weatherConfig.cache.snapshot,
        stormCycle: { dayOfCycle: 0, phase: 'calm_between', intensity: 0.5 },
        computedAt: absoluteIso,
        turn: currentTurn,
        humidity: 0.5,
        windDirectionDeg: 255,
      }
    : undefined;

  const chronicleSnapshot = engine.computeSnapshot(
    absoluteIso,
    seed,
    weatherConfig.climate,
    previousSnapshot
  );

  // Convert to backward-compatible format
  const snapshot = toWeatherSnapshot(chronicleSnapshot);
  snapshot.lastComputedTurn = currentTurn;

  // Update cache
  weatherConfig.cache = { lastTurn: currentTurn, snapshot };
  return snapshot;
}

/**
 * Get travel multiplier from weather (unchanged)
 */
export function getWeatherTravelMultiplier(weather: WeatherSnapshot): number {
  switch (weather.type) {
    case 'clear':
      return 1.0;
    case 'rain':
      return weather.intensity <= 2 ? 0.9 : 0.8;
    case 'storm':
      return weather.intensity <= 3 ? 0.75 : 0.6;
    case 'fog':
      return weather.intensity <= 2 ? 0.85 : 0.7;
    case 'snow':
      return weather.intensity <= 2 ? 0.7 : 0.5;
    default:
      return 1.0;
  }
}

/**
 * Ensure weather system exists in world
 */
function ensureWeatherSystem(world: SimpleWorld): WeatherSystemState {
  if (!world.systems) {
    (world as any).systems = {};
  }
  if (!world.systems!.weather) {
    world.systems!.weather = {
      climate: 'temperate',
      seed: world.meta?.seed,
    };
  }
  return world.systems!.weather!;
}

/**
 * Resolve absolute time from world state
 */
function resolveAbsoluteTime(world: SimpleWorld): string | undefined {
  const timeState = getTimeState(world);
  if (timeState) {
    const anchored = ensureTimeAnchor(timeState, world.meta);
    const rich = deriveAbsoluteTime(anchored, world.meta?.turn);
    if (rich.absolute?.isoDateTime) {
      return rich.absolute.isoDateTime;
    }
  }
  return world.meta?.startedAt;
}

