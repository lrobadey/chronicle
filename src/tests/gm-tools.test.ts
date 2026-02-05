/**
 * Chronicle v4 - GM Tools Tests
 * 
 * Tests for GM tool runtime.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createToolRuntime, type ToolRuntime } from '../gm/tools';
import { createIsleOfMarrowWorld } from '../worlds/isle-of-marrow';
import type { World } from '../core/world';

describe('GM Tool Runtime', () => {
  let world: World;
  let runtime: ToolRuntime;
  let getWorld: () => World;
  let setWorld: (w: World) => void;

  beforeEach(() => {
    world = createIsleOfMarrowWorld();
    
    getWorld = () => world;
    setWorld = (w) => { world = w; };
    runtime = createToolRuntime(getWorld, setWorld);
  });

  describe('query_world', () => {
    it('should return player state', () => {
      const result = runtime.query_world();

      expect(result.player).toBeDefined();
      expect(result.player.id).toBe('player-1');
      expect(result.player.location).toBe('the-landing');
      expect(result.player.position).toEqual({ x: 0, y: 0 });
      expect(result.player.inventory).toEqual([]);
    });

    it('should return current location info', () => {
      const result = runtime.query_world();

      expect(result.currentLocation).toBeDefined();
      expect(result.currentLocation.id).toBe('the-landing');
      expect(result.currentLocation.name).toBe('The Landing');
      expect(result.currentLocation.description).toContain('dark sand');
    });

    it('should include items at location', () => {
      // Move to Rib Market which has an item
      world.player.location = 'the-rib-market';
      world.player.pos = { x: 0, y: 1200, z: 15 };

      const result = runtime.query_world();

      expect(result.currentLocation.items).toBeInstanceOf(Array);
      const jar = result.currentLocation.items.find(i => i.id === 'heartwater-jar');
      expect(jar).toBeDefined();
    });
  });

  describe('travel_to_location', () => {
    it('should move player to destination', () => {
      const result = runtime.travel_to_location({ locationId: 'the-rib-market' });

      expect(result.ok).toBe(true);
      expect(result.locationId).toBe('the-rib-market');
      expect(world.player.location).toBe('the-rib-market');
    });

    it('should update player position', () => {
      runtime.travel_to_location({ locationId: 'the-rib-market' });

      expect(world.player.pos.x).toBe(0);
      expect(world.player.pos.y).toBe(1200);
      expect(world.player.pos.z).toBe(15);
    });

    it('should advance time', () => {
      const initialTime = world.systems!.time!.elapsedMinutes;
      
      runtime.travel_to_location({ locationId: 'the-rib-market' });

      expect(world.systems!.time!.elapsedMinutes).toBeGreaterThan(initialTime);
    });

    it('should return travel metrics', () => {
      const result = runtime.travel_to_location({ locationId: 'the-rib-market' });

      expect(result.distance).toBeCloseTo(1200, 0);
      expect(result.travelTimeMinutes).toBeGreaterThan(0);
      expect(result.position).toEqual({ x: 0, y: 1200, z: 15 });
    });

    it('should add ledger entry', () => {
      const initialLedgerLength = world.ledger.length;
      
      runtime.travel_to_location({ locationId: 'the-rib-market' });

      expect(world.ledger.length).toBe(initialLedgerLength + 1);
      expect(world.ledger[world.ledger.length - 1]).toContain('Rib Market');
    });

    it('should use custom note', () => {
      runtime.travel_to_location({ 
        locationId: 'the-rib-market',
        note: 'Hurried to the market to trade',
      });

      expect(world.ledger[world.ledger.length - 1]).toContain('Hurried to the market');
    });

    it('should throw for unknown location', () => {
      expect(() => {
        runtime.travel_to_location({ locationId: 'nonexistent' });
      }).toThrow();
    });
  });

  describe('apply_patches', () => {
    it('should apply patches to world', () => {
      const result = runtime.apply_patches({
        patches: [
          { op: 'set', path: '/player/location', value: 'the-rib-market', note: 'Moved' },
        ],
      });

      expect(result.ok).toBe(true);
      expect(world.player.location).toBe('the-rib-market');
    });

    it('should handle inventory updates', () => {
      runtime.apply_patches({
        patches: [
          { 
            op: 'set', 
            path: '/player/inventory', 
            value: [{ id: 'sword', name: 'Iron Sword' }],
            note: 'Got sword',
          },
        ],
      });

      expect(world.player.inventory.length).toBe(1);
      expect(world.player.inventory[0].name).toBe('Iron Sword');
    });

    it('should handle time advancement', () => {
      runtime.apply_patches({
        patches: [
          { op: 'set', path: '/systems/time/elapsedMinutes', value: 60, note: 'An hour passes' },
        ],
      });

      expect(world.systems!.time!.elapsedMinutes).toBe(60);
    });

    it('should handle multiple patches', () => {
      runtime.apply_patches({
        patches: [
          { op: 'set', path: '/player/location', value: 'the-rib-market' },
          { op: 'set', path: '/systems/time/elapsedMinutes', value: 30 },
        ],
      });

      expect(world.player.location).toBe('the-rib-market');
      expect(world.systems!.time!.elapsedMinutes).toBe(30);
    });
  });

  describe('create_entity', () => {
    it('should create a new entity', () => {
      const result = runtime.create_entity({
        type: 'item',
        props: { name: 'Magic Staff' },
      });

      expect(result.id).toBeDefined();
      expect(result.id).toContain('item-');
    });

    it('should use provided ID', () => {
      const result = runtime.create_entity({
        type: 'item',
        props: { name: 'Custom Item' },
        id: 'my-custom-item',
      });

      expect(result.id).toBe('my-custom-item');
    });

    it('should add location to world.locations', () => {
      const result = runtime.create_entity({
        type: 'location',
        props: { 
          name: 'Hidden Cave',
          description: 'A mysterious cave',
          pos: { x: 500, y: 500 },
        },
      });

      expect(world.locations[result.id]).toBeDefined();
      expect(world.locations[result.id].name).toBe('Hidden Cave');
    });
  });

  describe('estimate_travel', () => {
    it('should return distance without moving', () => {
      const initialLocation = world.player.location;
      const initialPos = { ...world.player.pos };

      const result = runtime.estimate_travel({ locationId: 'the-rib-market' });

      expect(result.distanceMeters).toBeCloseTo(1200, 0);
      expect(result.etaMinutes).toBeGreaterThan(0);
      
      // Player should not have moved
      expect(world.player.location).toBe(initialLocation);
      expect(world.player.pos).toEqual(initialPos);
    });

    it('should include terrain multiplier', () => {
      const result = runtime.estimate_travel({ locationId: 'the-spine-ridge' });

      expect(result.terrainMultiplier).toBeGreaterThan(1);
    });

    it('should return from and to positions', () => {
      const result = runtime.estimate_travel({ locationId: 'the-rib-market' });

      expect(result.from).toEqual({ x: 0, y: 0 });
      expect(result.to).toEqual({ x: 0, y: 1200, z: 15 });
    });

    it('should throw for unknown location', () => {
      expect(() => {
        runtime.estimate_travel({ locationId: 'nonexistent' });
      }).toThrow();
    });
  });
});

describe('Tool Runtime State Management', () => {
  it('should maintain world state across tool calls', () => {
    let world = createIsleOfMarrowWorld();
    const runtime = createToolRuntime(
      () => world,
      (w) => { world = w; }
    );

    // Multiple operations
    runtime.travel_to_location({ locationId: 'the-rib-market' });
    runtime.apply_patches({
      patches: [{ op: 'set', path: '/systems/time/elapsedMinutes', value: 100 }],
    });

    const query = runtime.query_world();

    expect(query.player.location).toBe('the-rib-market');
    expect(world.systems!.time!.elapsedMinutes).toBe(100);
  });

  it('should not affect original world without setWorld', () => {
    const original = createIsleOfMarrowWorld();
    let shadow = JSON.parse(JSON.stringify(original));
    
    const runtime = createToolRuntime(
      () => shadow,
      (w) => { shadow = w; }
    );

    runtime.travel_to_location({ locationId: 'the-rib-market' });

    expect(original.player.location).toBe('the-landing');
    expect(shadow.player.location).toBe('the-rib-market');
  });
});

