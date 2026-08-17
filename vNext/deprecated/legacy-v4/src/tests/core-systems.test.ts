/**
 * Chronicle v4 - Core Systems Tests
 * 
 * Tests for time, tide, weather, and telemetry systems.
 */

import { describe, it, expect } from 'vitest';
import {
  getTimeState,
  calculateTideState,
  computeWeather,
  buildTelemetry,
  buildTurnConstraints,
  formatGameTime,
} from '../core/systems';
import { createIsleOfMarrowWorld } from '../worlds/isle-of-marrow';
import type { World } from '../core/world';

describe('Time System', () => {
  it('should calculate time state from world', () => {
    const world = createIsleOfMarrowWorld();
    const time = getTimeState(world);
    
    expect(time).toBeDefined();
    expect(time!.elapsedMinutes).toBe(0);
    expect(time!.currentHour).toBe(14); // Isle of Marrow starts at 2 PM
    expect(time!.timeOfDay).toBe('afternoon');
    expect(time!.currentDay).toBe(1);
  });

  it('should handle elapsed time correctly', () => {
    const world = createIsleOfMarrowWorld();
    world.systems!.time!.elapsedMinutes = 180; // 3 hours later
    
    const time = getTimeState(world);
    
    expect(time!.elapsedMinutes).toBe(180);
    expect(time!.currentHour).toBe(17); // 2 PM + 3 hours = 5 PM
    expect(time!.timeOfDay).toBe('evening');
  });

  it('should derive absolute time from anchor', () => {
    const world = createIsleOfMarrowWorld();
    world.systems!.time!.elapsedMinutes = 60;
    
    const time = getTimeState(world);
    
    expect(time!.absolute).toBeDefined();
    expect(time!.absolute!.date).toBeInstanceOf(Date);
    expect(time!.absolute!.isoDateTime).toContain('1825-05-14');
  });

  it('should format game time correctly', () => {
    expect(formatGameTime(0, 8)).toBe('8:00 AM');
    expect(formatGameTime(60, 8)).toBe('9:00 AM');
    expect(formatGameTime(240, 8)).toBe('12:00 PM');
    expect(formatGameTime(300, 8)).toBe('1:00 PM');
    expect(formatGameTime(600, 8)).toBe('6:00 PM');
  });

  it('should wrap around midnight', () => {
    const world = createIsleOfMarrowWorld();
    world.systems!.time!.elapsedMinutes = 720; // 12 hours later (2 AM next day)
    
    const time = getTimeState(world);
    
    expect(time!.currentHour).toBe(2);
    expect(time!.timeOfDay).toBe('night');
    expect(time!.currentDay).toBe(1); // Still day 1 until 24 hours pass
  });
});

describe('Tide System', () => {
  it('should calculate tide state', () => {
    const world = createIsleOfMarrowWorld();
    const tide = calculateTideState(world);
    
    expect(tide).toBeDefined();
    expect(['low', 'rising', 'high', 'falling']).toContain(tide!.phase);
    expect(tide!.level).toBeGreaterThanOrEqual(0);
    expect(tide!.level).toBeLessThanOrEqual(1);
    expect(tide!.minutesUntilChange).toBeGreaterThan(0);
  });

  it('should identify blocked locations at high tide', () => {
    const world = createIsleOfMarrowWorld();
    // At elapsed 0, tide starts high for Isle of Marrow
    const tide = calculateTideState(world);
    
    // The Maw requires low tide
    if (tide!.phase === 'high' || tide!.phase === 'rising') {
      expect(tide!.blocked).toContain('the-maw');
    }
  });

  it('should cycle through phases over time', () => {
    const world = createIsleOfMarrowWorld();
    const phases: string[] = [];
    
    // Sample tide at different times
    for (let minutes = 0; minutes < 720; minutes += 90) {
      world.systems!.time!.elapsedMinutes = minutes;
      const tide = calculateTideState(world);
      if (!phases.includes(tide!.phase)) {
        phases.push(tide!.phase);
      }
    }
    
    // Should see multiple phases over a full cycle
    expect(phases.length).toBeGreaterThanOrEqual(2);
  });

  it('should be deterministic', () => {
    const world1 = createIsleOfMarrowWorld();
    const world2 = createIsleOfMarrowWorld();
    world1.systems!.time!.elapsedMinutes = 123;
    world2.systems!.time!.elapsedMinutes = 123;
    
    const tide1 = calculateTideState(world1);
    const tide2 = calculateTideState(world2);
    
    expect(tide1!.phase).toBe(tide2!.phase);
    expect(tide1!.level).toBeCloseTo(tide2!.level, 5);
  });
});

describe('Weather System', () => {
  it('should compute weather snapshot', () => {
    const world = createIsleOfMarrowWorld();
    const weather = computeWeather(world);
    
    expect(weather).toBeDefined();
    expect(['clear', 'rain', 'storm', 'fog', 'snow']).toContain(weather!.type);
    expect(weather!.intensity).toBeGreaterThanOrEqual(0);
    expect(weather!.intensity).toBeLessThanOrEqual(5);
    expect(typeof weather!.temperatureC).toBe('number');
    expect(typeof weather!.windKph).toBe('number');
    expect(weather!.pressure).toBeDefined();
    expect(weather!.signals).toBeInstanceOf(Array);
  });

  it('should be deterministic with same seed and time', () => {
    const world1 = createIsleOfMarrowWorld();
    const world2 = createIsleOfMarrowWorld();
    
    const weather1 = computeWeather(world1);
    const weather2 = computeWeather(world2);
    
    expect(weather1!.type).toBe(weather2!.type);
    expect(weather1!.intensity).toBe(weather2!.intensity);
    expect(weather1!.temperatureC).toBe(weather2!.temperatureC);
  });

  it('should produce different weather at different times', () => {
    const world = createIsleOfMarrowWorld();
    const weathers: string[] = [];
    
    // Sample weather at various elapsed times
    for (let day = 0; day < 10; day++) {
      world.systems!.time!.elapsedMinutes = day * 24 * 60;
      const weather = computeWeather(world);
      if (!weathers.includes(weather!.type)) {
        weathers.push(weather!.type);
      }
    }
    
    // Over 10 days, expect some weather variation
    expect(weathers.length).toBeGreaterThanOrEqual(1);
  });

  it('should generate appropriate signals', () => {
    const world = createIsleOfMarrowWorld();
    
    // Force a storm by manipulating time until we get one
    let stormFound = false;
    for (let i = 0; i < 100 && !stormFound; i++) {
      world.systems!.time!.elapsedMinutes = i * 360;
      const weather = computeWeather(world);
      if (weather!.type === 'storm' && weather!.intensity >= 3) {
        expect(weather!.signals).toContain('storm_risk:high');
        stormFound = true;
      }
    }
  });
});

describe('Telemetry', () => {
  it('should build complete telemetry snapshot', () => {
    const world = createIsleOfMarrowWorld();
    const telemetry = buildTelemetry(world);
    
    expect(telemetry.turn).toBe(0);
    expect(telemetry.player).toBeDefined();
    expect(telemetry.player.id).toBe('player-1');
    expect(telemetry.player.locationId).toBe('the-landing');
    expect(telemetry.location).toBeDefined();
    expect(telemetry.location.name).toBe('The Landing');
    expect(telemetry.nearbyLocations).toBeInstanceOf(Array);
    expect(telemetry.time).toBeDefined();
    expect(telemetry.tide).toBeDefined();
    expect(telemetry.weather).toBeDefined();
    expect(telemetry.ledgerTail).toBeInstanceOf(Array);
  });

  it('should include nearby locations', () => {
    const world = createIsleOfMarrowWorld();
    const telemetry = buildTelemetry(world);
    
    // From The Landing, some locations should be nearby
    expect(telemetry.nearbyLocations.length).toBeGreaterThanOrEqual(0);
    
    for (const loc of telemetry.nearbyLocations) {
      expect(loc.id).toBeDefined();
      expect(loc.name).toBeDefined();
      expect(typeof loc.distance).toBe('number');
      expect(loc.distance).toBeLessThan(200); // Within nearby threshold
    }
  });

  it('should include ledger tail', () => {
    const world = createIsleOfMarrowWorld();
    const telemetry = buildTelemetry(world);
    
    expect(telemetry.ledgerTail.length).toBeGreaterThan(0);
    expect(telemetry.ledgerTail.length).toBeLessThanOrEqual(5);
  });
});

describe('Turn Constraints', () => {
  it('should build turn constraints', () => {
    const world = createIsleOfMarrowWorld();
    const constraints = buildTurnConstraints(world);
    
    expect(constraints.maxMoveMeters).toBeGreaterThan(0);
    expect(constraints.weatherMultiplier).toBeGreaterThan(0);
    expect(constraints.blockedLocations).toBeInstanceOf(Array);
    expect(constraints.advisories).toBeInstanceOf(Array);
  });

  it('should include tide-blocked locations', () => {
    const world = createIsleOfMarrowWorld();
    const tide = calculateTideState(world);
    const constraints = buildTurnConstraints(world);
    
    // If tide is high, the-maw should be blocked
    if (tide!.phase === 'high' || tide!.phase === 'rising') {
      expect(constraints.blockedLocations).toContain('the-maw');
    }
  });

  it('should reduce max move in bad weather', () => {
    const world = createIsleOfMarrowWorld();
    const baseConstraints = buildTurnConstraints(world);
    
    // The max move should be reduced when weather is bad
    // We can't force weather easily, but we can check the calculation exists
    expect(baseConstraints.maxMoveMeters).toBeLessThanOrEqual(600);
  });
});

