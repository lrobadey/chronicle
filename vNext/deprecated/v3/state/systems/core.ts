/**
 * Core Systems Implementation
 * 
 * Implements the standard reactive systems (Tide, Weather) using the SystemSpec framework.
 */

import { registerSystem, type SystemSpec } from './framework';
import { calculateTideState } from '../systems';
import type { Patch } from '../../tools/types';
import { ChronicleWeatherEngine } from '../weather/engine';
import { deriveAbsoluteTime, ensureTimeAnchor, getTimeState } from '../time';
import type { ChronicleWeatherSnapshot } from '../weather/types';

/**
 * Tide System
 * 
 * Reacts to time changes by recalculating the tide phase.
 * Updates /systems/tide/phase in the world state.
 */
const tideSystem: SystemSpec = {
  id: 'tide-system',
  description: 'Updates tide phase based on elapsed time',
  tickRate: 'hourly',
  ownership: ['/systems/tide'],
  reducer: (world, delta) => {
    // If the world doesn't have a tide system, do nothing
    if (!world.systems?.tide || !world.systems.time) return [];

    const elapsed = world.systems.time.elapsedMinutes;
    const cycle = world.systems.tide.cycleMinutes || 720;
    
    // Calculate the *new* tide state based on the time *after* GM updates
    const newState = calculateTideState(elapsed, cycle);
    const currentPhase = world.systems.tide.phase;

    // Only patch if the phase has actually changed
    if (newState.phase !== currentPhase) {
      return [{
        op: 'set',
        path: '/systems/tide/phase',
        value: newState.phase,
        note: `Tide changed to ${newState.phase} (auto-system)`
      }];
    }

    return [];
  }
};

/**
 * Weather System - Chronicle Weather Engine
 * 
 * Reacts to time changes by computing deterministic weather using the ChronicleWeatherEngine.
 * Updates /systems/weather/cache with new snapshot on hourly ticks.
 */
const weatherSystem: SystemSpec = {
  id: 'weather-system',
  description: 'Updates weather based on season and time using Chronicle Weather Engine',
  tickRate: 'hourly',
  ownership: ['/systems/weather'],
  reducer: (world, delta) => {
    // If the world doesn't have a weather system, do nothing
    if (!world.systems?.weather || !world.systems.time) return [];

    // Resolve absolute time
    const timeState = getTimeState(world);
    if (!timeState) return [];

    const anchored = ensureTimeAnchor(timeState, world.meta);
    const rich = deriveAbsoluteTime(anchored, world.meta?.turn);
    const timeIso = rich.absolute?.isoDateTime || world.meta?.startedAt;
    if (!timeIso) return [];

    // Get weather config
    const weatherConfig = world.systems.weather;
    const seed = weatherConfig.seed ?? world.meta?.seed ?? 'chronicle';
    const climate = weatherConfig.climate ?? 'temperate';

    // Get previous snapshot for inertia
    const previousSnapshot: ChronicleWeatherSnapshot | undefined = weatherConfig.cache?.snapshot
      ? {
          ...weatherConfig.cache.snapshot,
          stormCycle: { dayOfCycle: 0, phase: 'calm_between', intensity: 0.5 },
          computedAt: timeIso,
          turn: world.meta?.turn ?? 0,
          humidity: 0.5,
          windDirectionDeg: 255,
        }
      : undefined;

    // Compute new snapshot using ChronicleWeatherEngine
    const engine = new ChronicleWeatherEngine();
    const snapshot = engine.computeSnapshot(timeIso, seed, climate, previousSnapshot);

    // Convert to cache format (backward compatible with WeatherSnapshot)
    const cacheSnapshot = {
      type: snapshot.type,
      intensity: snapshot.intensity,
      temperatureC: snapshot.temperatureC,
      windKph: snapshot.windKph,
      pressure: snapshot.pressure,
      signals: snapshot.signals,
      lastComputedTurn: world.meta?.turn ?? 0,
    };

    // Always update cache (weather changes every hour)
    return [
      {
        op: 'set',
        path: '/systems/weather/cache',
        value: {
          lastTurn: world.meta?.turn ?? 0,
          snapshot: cacheSnapshot,
        },
        note: `Weather updated to ${snapshot.type} (intensity ${snapshot.intensity}) (auto-system)`,
      },
    ];
  },
};

// Register core systems
export function registerCoreSystems() {
  registerSystem(tideSystem);
  registerSystem(weatherSystem);
}

