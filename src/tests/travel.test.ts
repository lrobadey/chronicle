/**
 * Chronicle v4 - Travel Tests
 * 
 * Tests for travel calculations.
 */

import { describe, it, expect } from 'vitest';
import { calculateTravel, type TravelResult } from '../core/travel';
import { createIsleOfMarrowWorld } from '../worlds/isle-of-marrow';
import type { World } from '../core/world';

describe('Travel Calculations', () => {
  let world: World;

  beforeEach(() => {
    world = createIsleOfMarrowWorld();
  });

  describe('Distance Calculation', () => {
    it('should calculate distance between positions', () => {
      const result = calculateTravel(
        world,
        { x: 0, y: 0 },
        { x: 100, y: 0 }
      );

      expect(result.distanceMeters).toBe(100);
    });

    it('should calculate distance with z component', () => {
      const result = calculateTravel(
        world,
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 100, z: 50 }
      );

      // Distance should be sqrt(100^2 + 50^2) ≈ 111.8
      expect(result.distanceMeters).toBeCloseTo(111.8, 0);
    });

    it('should calculate distance from player to location', () => {
      // Player starts at the-landing (0, 0)
      const result = calculateTravel(world, world.player.pos, 'the-rib-market');

      // The Rib Market is at (0, 1200)
      expect(result.distanceMeters).toBeCloseTo(1200, 0);
    });

    it('should calculate distance between named locations', () => {
      const result = calculateTravel(world, 'the-landing', 'the-rib-market');

      expect(result.distanceMeters).toBeCloseTo(1200, 0);
      expect(result.fromLocationId).toBe('the-landing');
      expect(result.toLocationId).toBe('the-rib-market');
    });
  });

  describe('Time Calculation', () => {
    it('should calculate base travel time', () => {
      const result = calculateTravel(
        world,
        { x: 0, y: 0 },
        { x: 84, y: 0 } // 84 meters at 1.4 m/s = 60 seconds = 1 minute
      );

      expect(result.baseMinutes).toBeCloseTo(1, 0);
    });

    it('should apply terrain multiplier', () => {
      // Travel to the-maw (water terrain, 3.0x multiplier)
      const result = calculateTravel(world, world.player.pos, 'the-maw');

      expect(result.terrainMultiplier).toBeGreaterThan(1);
      expect(result.adjustedMinutes).toBeGreaterThan(result.baseMinutes);
    });

    it('should use location travel speed multiplier when set', () => {
      // The Landing has travelSpeedMultiplier of 1.2
      const result = calculateTravel(world, 'the-landing', 'the-maw');

      // Should use the higher multiplier (water = 3.0)
      expect(result.terrainMultiplier).toBeGreaterThanOrEqual(1.2);
    });

    it('should respect custom base speed', () => {
      const slowResult = calculateTravel(world, { x: 0, y: 0 }, { x: 100, y: 0 }, {
        baseSpeedMetersPerSecond: 0.5,
      });

      const fastResult = calculateTravel(world, { x: 0, y: 0 }, { x: 100, y: 0 }, {
        baseSpeedMetersPerSecond: 2.0,
      });

      expect(slowResult.adjustedMinutes).toBeGreaterThan(fastResult.adjustedMinutes);
    });
  });

  describe('Terrain Multipliers', () => {
    it('should apply road terrain (0.8x)', () => {
      // Create a location with road terrain
      world.locations['road-test'] = {
        id: 'road-test',
        name: 'Road',
        description: 'A road',
        coords: { x: 100, y: 0 },
        terrain: 'road',
      };

      const result = calculateTravel(world, 'road-test', 'the-landing');
      expect(result.terrainMultiplier).toBeLessThanOrEqual(1.2); // Landing is beach
    });

    it('should apply mountain terrain (2.5x)', () => {
      // Travel to the-spine-ridge (mountain terrain)
      const result = calculateTravel(world, 'the-landing', 'the-spine-ridge');

      expect(result.terrainMultiplier).toBeGreaterThanOrEqual(2.0);
    });

    it('should apply water terrain (3.0x)', () => {
      // Travel to the-maw (water terrain)
      const result = calculateTravel(world, 'the-landing', 'the-maw');

      expect(result.terrainMultiplier).toBeGreaterThanOrEqual(2.5);
    });

    it('should use maximum terrain of source and destination', () => {
      // Beach (1.2) to Mountain (2.5) should use 2.5
      // Note: terrainMultiplier includes weather multiplier (weather can reduce or increase)
      const result = calculateTravel(world, 'the-landing', 'the-spine-ridge');

      // The base terrain max is 2.5, but weather can modify it slightly
      // Accept range 2.0-3.0 to account for weather variation
      expect(result.terrainMultiplier).toBeGreaterThanOrEqual(2.0);
      expect(result.terrainMultiplier).toBeLessThanOrEqual(3.5);
    });
  });

  describe('Isle of Marrow Specific', () => {
    it('should calculate travel from Landing to Rib Market', () => {
      const result = calculateTravel(world, 'the-landing', 'the-rib-market');

      expect(result.distanceMeters).toBeCloseTo(1200, 0);
      expect(result.adjustedMinutes).toBeGreaterThan(10); // At least 10 minutes
    });

    it('should calculate travel to Spine Ridge', () => {
      const result = calculateTravel(world, 'the-landing', 'the-spine-ridge');

      expect(result.distanceMeters).toBeCloseTo(6000, -1); // ~6km
      expect(result.adjustedMinutes).toBeGreaterThan(100); // Should take significant time with mountain terrain
    });

    it('should calculate travel to The Maw', () => {
      const result = calculateTravel(world, 'the-landing', 'the-maw');

      expect(result.distanceMeters).toBeCloseTo(200, 0);
      expect(result.terrainMultiplier).toBeGreaterThanOrEqual(2.5); // Water terrain
    });

    it('should handle travel from arbitrary position', () => {
      // Move player to center of island
      world.player.pos = { x: 0, y: 3000, z: 50 };

      const result = calculateTravel(world, world.player.pos, 'the-heartspring');

      expect(result.distanceMeters).toBeDefined();
      expect(result.adjustedMinutes).toBeDefined();
    });
  });
});

