/**
 * Chronicle v4 - World Setup Tests
 * 
 * Tests for Isle of Marrow world configuration.
 */

import { describe, it, expect } from 'vitest';
import { createIsleOfMarrowWorld } from '../worlds/isle-of-marrow';
import type { World } from '../core/world';

describe('Isle of Marrow World', () => {
  let world: World;

  beforeEach(() => {
    world = createIsleOfMarrowWorld();
  });

  describe('World Structure', () => {
    it('should have all required top-level fields', () => {
      expect(world.player).toBeDefined();
      expect(world.locations).toBeDefined();
      expect(world.npcs).toBeDefined();
      expect(world.ledger).toBeDefined();
      expect(world.systems).toBeDefined();
      expect(world.meta).toBeDefined();
    });

    it('should have valid player configuration', () => {
      expect(world.player.id).toBe('player-1');
      expect(world.player.location).toBe('the-landing');
      expect(world.player.pos).toBeDefined();
      expect(world.player.inventory).toBeInstanceOf(Array);
    });

    it('should have time system configured', () => {
      expect(world.systems?.time).toBeDefined();
      expect(world.systems!.time!.elapsedMinutes).toBe(0);
      expect(world.systems!.time!.startHour).toBe(14);
      expect(world.systems!.time!.anchor).toBeDefined();
      expect(world.systems!.time!.anchor!.isoDateTime).toContain('1825');
    });

    it('should have tide system configured', () => {
      expect(world.systems?.tide).toBeDefined();
      expect(world.systems!.tide!.cycleMinutes).toBeGreaterThan(0);
    });

    it('should have economy system configured', () => {
      expect(world.systems?.economy).toBeDefined();
      expect(world.systems!.economy!.goods).toBeDefined();
      expect(world.systems!.economy!.goods.salt_fish).toBe('abundant');
    });

    it('should have weather system configured', () => {
      expect(world.systems?.weather).toBeDefined();
      expect(world.systems!.weather!.climate).toBe('temperate');
      expect(world.systems!.weather!.seed).toBeDefined();
    });

    it('should have meta initialized', () => {
      expect(world.meta?.turn).toBe(0);
      expect(world.meta!.seed).toBeDefined();
    });
  });

  describe('Locations', () => {
    it('should have expected locations', () => {
      const expectedLocations = [
        'the-landing',
        'the-rib-market',
        'the-heartspring',
        'the-maw',
        'the-spine-ridge',
      ];

      for (const locId of expectedLocations) {
        expect(world.locations[locId]).toBeDefined();
        expect(world.locations[locId].id).toBe(locId);
        expect(world.locations[locId].name).toBeDefined();
        expect(world.locations[locId].description).toBeDefined();
      }
    });

    it('should have coordinates for all locations', () => {
      for (const loc of Object.values(world.locations)) {
        expect(loc.coords).toBeDefined();
        expect(typeof loc.coords!.x).toBe('number');
        expect(typeof loc.coords!.y).toBe('number');
      }
    });

    it('should have terrain types', () => {
      const terrains = new Set<string>();
      for (const loc of Object.values(world.locations)) {
        if (loc.terrain) terrains.add(loc.terrain);
      }
      
      // Should have multiple terrain types
      expect(terrains.size).toBeGreaterThan(1);
    });

    it('should have The Maw as tide-restricted', () => {
      const maw = world.locations['the-maw'];
      expect(maw.tideAccess).toBe('low');
    });

    it('should have items at locations', () => {
      const ribMarket = world.locations['the-rib-market'];
      expect(ribMarket.items).toBeDefined();
      expect(ribMarket.items!.length).toBeGreaterThan(0);
      
      const jar = ribMarket.items!.find(i => i.id === 'heartwater-jar');
      expect(jar).toBeDefined();
    });
  });

  describe('NPCs', () => {
    it('should have expected NPCs', () => {
      const expectedNPCs = [
        'mira-salt',
        'ledger-pike',
        'father-kel',
      ];

      for (const npcId of expectedNPCs) {
        expect(world.npcs![npcId]).toBeDefined();
        expect(world.npcs![npcId].name).toBeDefined();
        expect(world.npcs![npcId].location).toBeDefined();
      }
    });

    it('should have NPCs at valid locations', () => {
      for (const npc of Object.values(world.npcs!)) {
        expect(world.locations[npc.location]).toBeDefined();
      }
    });

    it('should have system functions defined', () => {
      const mira = world.npcs!['mira-salt'];
      expect(mira.systemFunction).toBe('weather-watcher');

      const pike = world.npcs!['ledger-pike'];
      expect(pike.systemFunction).toBe('economy-tracker');
    });
  });

  describe('Ledger', () => {
    it('should have initial ledger entries', () => {
      expect(world.ledger.length).toBeGreaterThan(0);
    });

    it('should mention The Landing', () => {
      const text = world.ledger.join(' ').toLowerCase();
      expect(text.includes('landing')).toBe(true);
    });
  });
});

describe('World Consistency', () => {
  it('should create identical worlds', () => {
    const world1 = createIsleOfMarrowWorld();
    const world2 = createIsleOfMarrowWorld();

    expect(world1.player.id).toBe(world2.player.id);
    expect(world1.player.location).toBe(world2.player.location);
    expect(Object.keys(world1.locations).sort()).toEqual(Object.keys(world2.locations).sort());
    expect(Object.keys(world1.npcs!).sort()).toEqual(Object.keys(world2.npcs!).sort());
    expect(world1.meta!.seed).toBe(world2.meta!.seed);
  });

  it('should have all location references valid', () => {
    const world = createIsleOfMarrowWorld();
    const locationIds = Object.keys(world.locations);

    // Player location must exist
    expect(locationIds).toContain(world.player.location);

    // All NPC locations must exist
    for (const npc of Object.values(world.npcs!)) {
      expect(locationIds).toContain(npc.location);
    }
  });

  it('should have reasonable geographic layout', () => {
    const world = createIsleOfMarrowWorld();
    
    // The Landing should be at origin or near it
    const landing = world.locations['the-landing'];
    expect(Math.abs(landing.coords!.x)).toBeLessThan(100);
    expect(Math.abs(landing.coords!.y)).toBeLessThan(100);

    // The Maw (sea cave) should be near The Landing
    const maw = world.locations['the-maw'];
    const distanceToMaw = Math.hypot(
      maw.coords!.x - landing.coords!.x,
      maw.coords!.y - landing.coords!.y
    );
    expect(distanceToMaw).toBeLessThan(500); // Within 500m

    // Spine Ridge should be far from coast
    const spineRidge = world.locations['the-spine-ridge'];
    expect(spineRidge.coords!.y).toBeGreaterThan(3000);
  });
});

