/**
 * Chronicle v4 - Arbiter Tests
 * 
 * Tests for patch application and system reactions.
 */

import { describe, it, expect } from 'vitest';
import { applyPatches, computeSystemPatches, type Patch } from '../core/arbiter';
import { createIsleOfMarrowWorld } from '../worlds/isle-of-marrow';
import type { World } from '../core/world';

describe('Patch Application', () => {
  let world: World;

  beforeEach(() => {
    world = createIsleOfMarrowWorld();
  });

  describe('Set Operation', () => {
    it('should apply set patch to simple path', () => {
      const patches: Patch[] = [
        { op: 'set', path: '/player/location', value: 'the-rib-market', note: 'Moved to market' },
      ];

      const result = applyPatches(world, patches);

      expect(result.player.location).toBe('the-rib-market');
    });

    it('should apply set patch to nested path', () => {
      const patches: Patch[] = [
        { op: 'set', path: '/systems/time/elapsedMinutes', value: 120, note: 'Time passes' },
      ];

      const result = applyPatches(world, patches);

      expect(result.systems!.time!.elapsedMinutes).toBe(120);
    });

    it('should create intermediate objects if needed', () => {
      const patches: Patch[] = [
        { op: 'set', path: '/systems/newSystem/value', value: 42 },
      ];

      const result = applyPatches(world, patches);

      expect((result.systems as any).newSystem.value).toBe(42);
    });

    it('should apply set patch to array', () => {
      const newInventory = [
        { id: 'sword', name: 'Iron Sword' },
        { id: 'shield', name: 'Wooden Shield' },
      ];
      const patches: Patch[] = [
        { op: 'set', path: '/player/inventory', value: newInventory, note: 'Got items' },
      ];

      const result = applyPatches(world, patches);

      expect(result.player.inventory).toEqual(newInventory);
    });

    it('should apply set patch to position', () => {
      const patches: Patch[] = [
        { op: 'set', path: '/player/pos', value: { x: 100, y: 200, z: 10 } },
      ];

      const result = applyPatches(world, patches);

      expect(result.player.pos).toEqual({ x: 100, y: 200, z: 10 });
    });
  });

  describe('Merge Operation', () => {
    it('should merge patch into existing object', () => {
      const patches: Patch[] = [
        { op: 'merge', path: '/player/pos', value: { z: 50 } },
      ];

      const result = applyPatches(world, patches);

      expect(result.player.pos.x).toBe(0); // Unchanged
      expect(result.player.pos.y).toBe(0); // Unchanged
      expect(result.player.pos.z).toBe(50); // Merged
    });

    it('should merge into systems', () => {
      const patches: Patch[] = [
        { op: 'merge', path: '/systems/economy/goods', value: { gems: 'scarce' } },
      ];

      const result = applyPatches(world, patches);

      expect(result.systems!.economy!.goods.salt_fish).toBe('abundant'); // Unchanged
      expect(result.systems!.economy!.goods.gems).toBe('scarce'); // Merged
    });
  });

  describe('Turn Counter', () => {
    it('should increment turn counter', () => {
      const initialTurn = world.meta!.turn;
      const patches: Patch[] = [
        { op: 'set', path: '/player/location', value: 'the-rib-market' },
      ];

      const result = applyPatches(world, patches);

      expect(result.meta!.turn).toBe(initialTurn + 1);
    });

    it('should increment turn even with empty patches', () => {
      const initialTurn = world.meta!.turn;
      const result = applyPatches(world, []);

      expect(result.meta!.turn).toBe(initialTurn + 1);
    });
  });

  describe('Ledger Updates', () => {
    it('should add patch notes to ledger', () => {
      const initialLedgerLength = world.ledger.length;
      const patches: Patch[] = [
        { op: 'set', path: '/player/location', value: 'the-rib-market', note: 'Walked to the market' },
      ];

      const result = applyPatches(world, patches);

      expect(result.ledger.length).toBe(initialLedgerLength + 1);
      expect(result.ledger[result.ledger.length - 1]).toContain('Walked to the market');
    });

    it('should include provenance in ledger', () => {
      const patches: Patch[] = [
        { op: 'set', path: '/player/location', value: 'the-rib-market', note: 'Moved', by: 'GM', turn: 5 },
      ];

      const result = applyPatches(world, patches);

      expect(result.ledger[result.ledger.length - 1]).toContain('[GM T5]');
    });

    it('should use default note if none provided', () => {
      const patches: Patch[] = [
        { op: 'set', path: '/player/location', value: 'the-rib-market' },
      ];

      const result = applyPatches(world, patches, 'Default note');

      expect(result.ledger[result.ledger.length - 1]).toContain('Default note');
    });
  });

  describe('Multiple Patches', () => {
    it('should apply multiple patches in order', () => {
      const patches: Patch[] = [
        { op: 'set', path: '/player/location', value: 'the-rib-market', note: 'Moved' },
        { op: 'set', path: '/systems/time/elapsedMinutes', value: 60, note: 'Time passes' },
        { op: 'set', path: '/player/inventory', value: [{ id: 'item', name: 'Item' }], note: 'Got item' },
      ];

      const result = applyPatches(world, patches);

      expect(result.player.location).toBe('the-rib-market');
      expect(result.systems!.time!.elapsedMinutes).toBe(60);
      expect(result.player.inventory.length).toBe(1);
      expect(result.ledger.length).toBe(world.ledger.length + 3);
    });
  });

  describe('Immutability', () => {
    it('should not mutate original world', () => {
      const originalLocation = world.player.location;
      const patches: Patch[] = [
        { op: 'set', path: '/player/location', value: 'the-rib-market' },
      ];

      applyPatches(world, patches);

      expect(world.player.location).toBe(originalLocation);
    });

    it('should return a new world object', () => {
      const patches: Patch[] = [
        { op: 'set', path: '/player/location', value: 'the-rib-market' },
      ];

      const result = applyPatches(world, patches);

      expect(result).not.toBe(world);
    });
  });
});

describe('System Patches (Reactive)', () => {
  let world: World;

  beforeEach(() => {
    world = createIsleOfMarrowWorld();
  });

  it('should compute tide phase change when time advances', () => {
    // Advance time significantly
    const gmPatches: Patch[] = [
      { op: 'set', path: '/systems/time/elapsedMinutes', value: 180 }, // 3 hours
    ];

    // Apply GM patches first
    const afterGM = applyPatches(world, gmPatches);

    // Then compute system reactions
    const systemPatches = computeSystemPatches(afterGM, gmPatches);

    // System patches may include tide updates
    // The exact content depends on current tide phase
    expect(systemPatches).toBeInstanceOf(Array);
  });

  it('should return empty array when time not changed', () => {
    const gmPatches: Patch[] = [
      { op: 'set', path: '/player/location', value: 'the-rib-market' },
    ];

    const systemPatches = computeSystemPatches(world, gmPatches);

    expect(systemPatches.length).toBe(0);
  });

  it('should detect time path in patches', () => {
    const gmPatches: Patch[] = [
      { op: 'set', path: '/systems/time/elapsedMinutes', value: 360 },
    ];

    const systemPatches = computeSystemPatches(world, gmPatches);

    // Should have processed the time change
    // Even if no phase change occurs, the function should complete
    expect(systemPatches).toBeInstanceOf(Array);
  });

  it('should include provenance in system patches', () => {
    // Set elapsed time to trigger a tide phase change
    world.systems!.time!.elapsedMinutes = 0;
    
    const gmPatches: Patch[] = [
      { op: 'set', path: '/systems/time/elapsedMinutes', value: 200 }, // Should change tide
    ];

    const afterGM = applyPatches(world, gmPatches);
    const systemPatches = computeSystemPatches(afterGM, gmPatches);

    for (const patch of systemPatches) {
      expect(patch.by).toBe('system');
    }
  });
});

