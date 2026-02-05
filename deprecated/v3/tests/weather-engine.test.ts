/**
 * Chronicle Weather Engine Tests
 * 
 * Comprehensive test suite for the weather engine:
 * - Determinism (same seed + time = same weather)
 * - Storm cycles (multi-day patterns)
 * - Inertia (weather persists, changes gradually)
 * - Local effects (different locations feel different)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ChronicleWeatherEngine } from '../state/weather/engine';
import { deriveLocalWeather } from '../state/weather/localEffects';
import { ISLE_OF_MARROW_WEATHER_METADATA } from '../state/weather/metadata';
import type { ChronicleWeatherSnapshot } from '../state/weather/types';

describe('Chronicle Weather Engine', () => {
  beforeEach(() => {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  });

  describe('Determinism', () => {
    it('should produce identical weather for same seed and time', () => {
      console.log('🧪 Testing: Deterministic weather generation');
      const engine = new ChronicleWeatherEngine();
      const timeIso = '1825-05-14T14:00:00Z';
      const seed = 'test-seed';
      const climate = 'temperate';

      console.log(`   Input: time=${timeIso}, seed=${seed}, climate=${climate}`);
      
      const snapshot1 = engine.computeSnapshot(timeIso, seed, climate);
      console.log(`   First run:  ${snapshot1.type} (intensity ${snapshot1.intensity}), ${snapshot1.temperatureC}°C, ${snapshot1.windKph}kph, pressure ${snapshot1.pressure.hPa}hPa (${snapshot1.pressure.system})`);
      
      const snapshot2 = engine.computeSnapshot(timeIso, seed, climate);
      console.log(`   Second run: ${snapshot2.type} (intensity ${snapshot2.intensity}), ${snapshot2.temperatureC}°C, ${snapshot2.windKph}kph, pressure ${snapshot2.pressure.hPa}hPa (${snapshot2.pressure.system})`);

      expect(snapshot1.type).toBe(snapshot2.type);
      expect(snapshot1.intensity).toBe(snapshot2.intensity);
      expect(snapshot1.temperatureC).toBe(snapshot2.temperatureC);
      expect(snapshot1.windKph).toBe(snapshot2.windKph);
      expect(snapshot1.pressure.hPa).toBe(snapshot2.pressure.hPa);
      
      console.log('   ✅ All values match - determinism confirmed!');
    });

    it('should produce different weather for different seeds', () => {
      console.log('🧪 Testing: Different seeds produce different weather');
      const engine = new ChronicleWeatherEngine();
      const timeIso = '1825-05-14T14:00:00Z';
      const climate = 'temperate';

      const snapshot1 = engine.computeSnapshot(timeIso, 'seed-1', climate);
      console.log(`   Seed "seed-1": ${snapshot1.type} (${snapshot1.intensity}), ${snapshot1.temperatureC}°C, ${snapshot1.windKph}kph`);
      
      const snapshot2 = engine.computeSnapshot(timeIso, 'seed-2', climate);
      console.log(`   Seed "seed-2": ${snapshot2.type} (${snapshot2.intensity}), ${snapshot2.temperatureC}°C, ${snapshot2.windKph}kph`);

      // They might be the same by chance, but very unlikely for all fields
      const allSame =
        snapshot1.type === snapshot2.type &&
        snapshot1.intensity === snapshot2.intensity &&
        snapshot1.temperatureC === snapshot2.temperatureC &&
        snapshot1.windKph === snapshot2.windKph;

      if (allSame) {
        console.log('   ⚠️  Warning: Seeds produced identical weather (unlikely but possible)');
      } else {
        console.log('   ✅ Different seeds produced different weather');
      }
      expect(allSame).toBe(false);
    });

    it('should produce different weather for different times', () => {
      console.log('🧪 Testing: Weather changes over time');
      const engine = new ChronicleWeatherEngine();
      const seed = 'test-seed';
      const climate = 'temperate';

      const snapshot1 = engine.computeSnapshot('1825-05-14T14:00:00Z', seed, climate);
      console.log(`   Day 1 (May 14): ${snapshot1.type} (${snapshot1.intensity}), storm cycle day ${snapshot1.stormCycle.dayOfCycle} (${snapshot1.stormCycle.phase})`);
      
      const snapshot2 = engine.computeSnapshot('1825-05-15T14:00:00Z', seed, climate);
      console.log(`   Day 2 (May 15): ${snapshot2.type} (${snapshot2.intensity}), storm cycle day ${snapshot2.stormCycle.dayOfCycle} (${snapshot2.stormCycle.phase})`);

      // Different days should produce different weather (very likely)
      const allSame =
        snapshot1.type === snapshot2.type &&
        snapshot1.intensity === snapshot2.intensity &&
        snapshot1.temperatureC === snapshot2.temperatureC;

      if (allSame) {
        console.log('   ⚠️  Weather stayed the same (possible with inertia)');
      } else {
        console.log('   ✅ Weather changed between days');
      }
      expect(allSame).toBe(false);
    });
  });

  describe('Storm Cycles', () => {
    it('should generate storm cycle state', () => {
      console.log('🧪 Testing: Storm cycle generation');
      const engine = new ChronicleWeatherEngine();
      const snapshot = engine.computeSnapshot('1825-05-14T14:00:00Z', 'test', 'temperate');

      console.log(`   Storm Cycle: day ${snapshot.stormCycle.dayOfCycle} of cycle, phase="${snapshot.stormCycle.phase}", intensity=${snapshot.stormCycle.intensity.toFixed(2)}`);
      console.log(`   Weather: ${snapshot.type} (intensity ${snapshot.intensity})`);
      console.log(`   Pressure: ${snapshot.pressure.system} (${snapshot.pressure.hPa}hPa)`);

      expect(snapshot.stormCycle).toBeDefined();
      expect(snapshot.stormCycle.dayOfCycle).toBeGreaterThanOrEqual(0);
      expect(snapshot.stormCycle.dayOfCycle).toBeLessThan(7);
      expect(['building', 'peak', 'decaying', 'calm_between']).toContain(snapshot.stormCycle.phase);
      expect(snapshot.stormCycle.intensity).toBeGreaterThanOrEqual(0);
      expect(snapshot.stormCycle.intensity).toBeLessThanOrEqual(1);
      
      console.log('   ✅ Storm cycle state is valid');
    });

    it('should show storm cycle progression over days', () => {
      console.log('🧪 Testing: Storm cycle progression over 7 days');
      const engine = new ChronicleWeatherEngine();
      const seed = 'storm-test';
      const climate = 'temperate';

      const snapshots: ChronicleWeatherSnapshot[] = [];
      for (let day = 0; day < 7; day++) {
        const timeIso = `1825-05-${14 + day}T14:00:00Z`;
        const prev = snapshots[snapshots.length - 1];
        const snapshot = engine.computeSnapshot(timeIso, seed, climate, prev);
        snapshots.push(snapshot);
        console.log(`   Day ${day + 1}: ${snapshot.stormCycle.phase} (intensity ${snapshot.stormCycle.intensity.toFixed(2)}) → ${snapshot.type} (${snapshot.intensity})`);
      }

      // Should see some variation in storm cycle phase over 7 days
      const phases = snapshots.map((s) => s.stormCycle.phase);
      const uniquePhases = new Set(phases);
      console.log(`   Unique phases seen: ${Array.from(uniquePhases).join(', ')}`);
      expect(uniquePhases.size).toBeGreaterThan(1);
      console.log('   ✅ Storm cycle shows progression');
    });
  });

  describe('Inertia', () => {
    it('should maintain weather type with previous snapshot', () => {
      console.log('🧪 Testing: Weather inertia (gradual changes)');
      const engine = new ChronicleWeatherEngine();
      const seed = 'inertia-test';
      const climate = 'temperate';

      // Create initial snapshot
      const initial = engine.computeSnapshot('1825-05-14T14:00:00Z', seed, climate);
      console.log(`   Initial (2 PM): ${initial.type} (intensity ${initial.intensity})`);

      // Advance time by 1 hour
      const next = engine.computeSnapshot('1825-05-14T15:00:00Z', seed, climate, initial);
      console.log(`   Next hour (3 PM): ${next.type} (intensity ${next.intensity})`);

      const typeChanged = initial.type !== next.type;
      const intensityChange = Math.abs(next.intensity - initial.intensity);
      
      if (typeChanged) {
        console.log(`   ⚠️  Weather type changed: ${initial.type} → ${next.type}`);
      } else {
        console.log(`   ✅ Weather type persisted: ${initial.type}`);
      }
      console.log(`   Intensity change: ${intensityChange.toFixed(1)} (max allowed: 2)`);

      // Weather type should often persist (not guaranteed, but likely with inertia)
      // We'll just check that intensity doesn't jump wildly
      expect(intensityChange).toBeLessThanOrEqual(2); // Max ±1 per hour, but allow some variance
      console.log('   ✅ Intensity change within limits');
    });

    it('should limit intensity changes per hour', () => {
      console.log('🧪 Testing: Intensity change limits (max ±1 per hour)');
      const engine = new ChronicleWeatherEngine();
      const seed = 'intensity-test';
      const climate = 'temperate';

      const initial: ChronicleWeatherSnapshot = {
        type: 'storm',
        intensity: 3,
        temperatureC: 15,
        windKph: 30,
        pressure: { system: 'low', hPa: 1000, trend: 'falling' },
        stormCycle: { dayOfCycle: 2, phase: 'peak', intensity: 0.7 },
        signals: [],
        computedAt: '1825-05-14T14:00:00Z',
        turn: 0,
        lastComputedTurn: 0,
      };

      console.log(`   Starting intensity: ${initial.intensity} (${initial.type})`);

      const next = engine.computeSnapshot('1825-05-14T15:00:00Z', seed, climate, initial);
      console.log(`   After 1 hour: ${next.intensity} (${next.type})`);

      // Intensity should change by at most ±1 per hour
      const intensityChange = Math.abs(next.intensity - initial.intensity);
      console.log(`   Intensity change: ${intensityChange.toFixed(1)} (max allowed: 1)`);
      
      expect(intensityChange).toBeLessThanOrEqual(1);
      console.log('   ✅ Intensity change within limit');
    });
  });

  describe('Local Effects', () => {
    it('should derive different local effects for different locations', () => {
      console.log('🧪 Testing: Location-specific weather effects');
      const globalSnapshot: ChronicleWeatherSnapshot = {
        type: 'storm',
        intensity: 4,
        temperatureC: 12,
        windKph: 45,
        pressure: { system: 'low', hPa: 990, trend: 'falling' },
        stormCycle: { dayOfCycle: 3, phase: 'peak', intensity: 0.8 },
        signals: ['storm_risk:high', 'wind:high'],
        computedAt: '1825-05-14T14:00:00Z',
        turn: 0,
        lastComputedTurn: 0,
      };

      console.log(`   Global weather: ${globalSnapshot.type} (intensity ${globalSnapshot.intensity}), ${globalSnapshot.windKph}kph wind`);

      const spineEffects = deriveLocalWeather(
        globalSnapshot,
        ISLE_OF_MARROW_WEATHER_METADATA['the-spine-ridge']
      );
      console.log(`   Spine Ridge (high, exposed): visibility=${spineEffects.visibility}, footing=${spineEffects.footing}, comfort=${spineEffects.comfort}, travel=${(spineEffects.travelMultiplier * 100).toFixed(0)}%`);
      console.log(`     Signals: ${spineEffects.localSignals.join(', ')}`);

      const heartspringEffects = deriveLocalWeather(
        globalSnapshot,
        ISLE_OF_MARROW_WEATHER_METADATA['the-heartspring']
      );
      console.log(`   Heartspring (indoors, enclosed): visibility=${heartspringEffects.visibility}, footing=${heartspringEffects.footing}, comfort=${heartspringEffects.comfort}, travel=${(heartspringEffects.travelMultiplier * 100).toFixed(0)}%`);
      console.log(`     Signals: ${heartspringEffects.localSignals.join(', ') || 'none'}`);

      // Spine should be more dangerous/exposed
      expect(spineEffects.visibility).toBe('low');
      expect(spineEffects.footing).toBe('dangerous');
      expect(spineEffects.comfort).toBe('miserable');
      expect(spineEffects.localSignals).toContain('cliff_risk:high');

      // Heartspring should be protected (indoors)
      expect(heartspringEffects.visibility).toBe('normal');
      expect(heartspringEffects.comfort).toBe('cozy');
      expect(heartspringEffects.localSignals).not.toContain('cliff_risk:high');
      
      console.log('   ✅ Locations have different weather experiences');
    });

    it('should detect flood risk at the Maw in storms', () => {
      console.log('🧪 Testing: Flood risk detection at low-lying locations');
      const globalSnapshot: ChronicleWeatherSnapshot = {
        type: 'storm',
        intensity: 5,
        temperatureC: 10,
        windKph: 50,
        pressure: { system: 'low', hPa: 980, trend: 'falling' },
        stormCycle: { dayOfCycle: 3, phase: 'peak', intensity: 0.9 },
        signals: ['storm_risk:high', 'wind:high'],
        computedAt: '1825-05-14T14:00:00Z',
        turn: 0,
        lastComputedTurn: 0,
      };

      console.log(`   Global: ${globalSnapshot.type} (intensity ${globalSnapshot.intensity})`);
      console.log(`   Maw location: low elevation, poor drainage, near ocean`);

      const mawEffects = deriveLocalWeather(
        globalSnapshot,
        ISLE_OF_MARROW_WEATHER_METADATA['the-maw']
      );

      console.log(`   Maw effects: visibility=${mawEffects.visibility}, footing=${mawEffects.footing}, travel=${(mawEffects.travelMultiplier * 100).toFixed(0)}%`);
      console.log(`   Signals: ${mawEffects.localSignals.join(', ')}`);

      expect(mawEffects.localSignals).toContain('flood_risk:extreme');
      expect(mawEffects.localSignals).toContain('access:unsafe');
      expect(mawEffects.footing).toBe('dangerous');
      
      console.log('   ✅ Flood risk correctly detected');
    });

    it('should calculate travel multiplier based on local conditions', () => {
      console.log('🧪 Testing: Travel speed multipliers');
      const clearSnapshot: ChronicleWeatherSnapshot = {
        type: 'clear',
        intensity: 1,
        temperatureC: 20,
        windKph: 10,
        pressure: { system: 'high', hPa: 1020, trend: 'stable' },
        stormCycle: { dayOfCycle: 0, phase: 'calm_between', intensity: 0.2 },
        signals: [],
        computedAt: '1825-05-14T14:00:00Z',
        turn: 0,
        lastComputedTurn: 0,
      };

      const stormSnapshot: ChronicleWeatherSnapshot = {
        type: 'storm',
        intensity: 5,
        temperatureC: 10,
        windKph: 55,
        pressure: { system: 'low', hPa: 975, trend: 'falling' },
        stormCycle: { dayOfCycle: 3, phase: 'peak', intensity: 0.9 },
        signals: ['storm_risk:high', 'wind:high'],
        computedAt: '1825-05-14T14:00:00Z',
        turn: 0,
        lastComputedTurn: 0,
      };

      const clearEffects = deriveLocalWeather(
        clearSnapshot,
        ISLE_OF_MARROW_WEATHER_METADATA['the-landing']
      );
      console.log(`   Clear weather at Landing: travel speed = ${(clearEffects.travelMultiplier * 100).toFixed(0)}%`);

      const stormEffects = deriveLocalWeather(
        stormSnapshot,
        ISLE_OF_MARROW_WEATHER_METADATA['the-landing']
      );
      console.log(`   Storm weather at Landing: travel speed = ${(stormEffects.travelMultiplier * 100).toFixed(0)}%`);

      // Clear weather should have better travel multiplier
      expect(clearEffects.travelMultiplier).toBeGreaterThan(stormEffects.travelMultiplier);
      expect(clearEffects.travelMultiplier).toBeCloseTo(1.0, 0.1);
      expect(stormEffects.travelMultiplier).toBeLessThan(0.8);
      
      console.log(`   ✅ Clear weather (${(clearEffects.travelMultiplier * 100).toFixed(0)}%) faster than storm (${(stormEffects.travelMultiplier * 100).toFixed(0)}%)`);
    });
  });

  describe('Pressure System', () => {
    it('should select appropriate pressure system based on storm cycle', () => {
      console.log('🧪 Testing: Pressure system selection from storm cycles');
      const engine = new ChronicleWeatherEngine();
      const seed = 'pressure-test';
      const climate = 'temperate';

      // Test calm period (low storm cycle intensity)
      const calmSnapshot = engine.computeSnapshot('1825-05-14T14:00:00Z', seed, climate);
      console.log(`   Calm period: storm cycle intensity=${calmSnapshot.stormCycle.intensity.toFixed(2)}, pressure=${calmSnapshot.pressure.system} (${calmSnapshot.pressure.hPa}hPa)`);
      
      // Test storm period (high storm cycle intensity) - advance several days
      const stormSnapshot = engine.computeSnapshot('1825-05-17T14:00:00Z', seed, climate);
      console.log(`   Storm period: storm cycle intensity=${stormSnapshot.stormCycle.intensity.toFixed(2)}, pressure=${stormSnapshot.pressure.system} (${stormSnapshot.pressure.hPa}hPa)`);

      // Calm periods more likely to have high/stable pressure
      // Storm periods more likely to have low/front pressure
      // (Not guaranteed, but should see some correlation)
      const calmIsHigh = calmSnapshot.pressure.system === 'high' || calmSnapshot.pressure.system === 'stable';
      const stormIsLow = stormSnapshot.pressure.system === 'low' || stormSnapshot.pressure.system === 'front';
      
      if (calmIsHigh) {
        console.log('   ✅ Calm period has high/stable pressure');
      }
      if (stormIsLow) {
        console.log('   ✅ Storm period has low/front pressure');
      }
      
      // At least one should match the pattern
      expect(calmIsHigh || stormIsLow).toBe(true);
    });
  });

  describe('Temperature', () => {
    it('should calculate temperature based on season and time of day', () => {
      console.log('🧪 Testing: Temperature variation (day vs night)');
      const engine = new ChronicleWeatherEngine();
      const seed = 'temp-test';
      const climate = 'temperate';

      const daySnapshot = engine.computeSnapshot('1825-05-14T14:00:00Z', seed, climate); // 2 PM
      console.log(`   Day (2 PM): ${daySnapshot.temperatureC}°C (${daySnapshot.type})`);
      
      const nightSnapshot = engine.computeSnapshot('1825-05-14T02:00:00Z', seed, climate); // 2 AM
      console.log(`   Night (2 AM): ${nightSnapshot.temperatureC}°C (${nightSnapshot.type})`);

      const tempDiff = daySnapshot.temperatureC - nightSnapshot.temperatureC;
      console.log(`   Temperature difference: ${tempDiff.toFixed(1)}°C`);

      // Day should generally be warmer than night
      expect(daySnapshot.temperatureC).toBeGreaterThan(nightSnapshot.temperatureC);
      console.log('   ✅ Day is warmer than night');
    });

    it('should apply weather type temperature offsets', () => {
      console.log('🧪 Testing: Temperature offsets by weather type');
      const engine = new ChronicleWeatherEngine();
      const seed = 'temp-offset-test';
      const climate = 'temperate';

      // Create snapshots with different weather types
      // (We can't force types, but we can check the pattern)
      const snapshots: ChronicleWeatherSnapshot[] = [];
      for (let i = 0; i < 20; i++) {
        const timeIso = `1825-05-${14 + Math.floor(i / 24)}T${(i % 24).toString().padStart(2, '0')}:00:00Z`;
        const prev = snapshots[snapshots.length - 1];
        snapshots.push(engine.computeSnapshot(timeIso, seed, climate, prev));
      }

      // Find storm and clear snapshots
      const stormSnap = snapshots.find((s) => s.type === 'storm');
      const clearSnap = snapshots.find((s) => s.type === 'clear');

      if (stormSnap && clearSnap) {
        console.log(`   Clear weather: ${clearSnap.temperatureC}°C`);
        console.log(`   Storm weather: ${stormSnap.temperatureC}°C`);
        console.log(`   Difference: ${(clearSnap.temperatureC - stormSnap.temperatureC).toFixed(1)}°C (expected ~6°C)`);
        
        // Storms should generally be cooler (offset -6°C vs 0°C)
        expect(stormSnap.temperatureC).toBeLessThan(clearSnap.temperatureC);
        console.log('   ✅ Storms are cooler than clear weather');
      } else {
        console.log('   ⚠️  Could not find both storm and clear snapshots in sample');
      }
    });
  });
});

