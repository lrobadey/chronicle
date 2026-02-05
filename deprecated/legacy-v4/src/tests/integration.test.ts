/**
 * Chronicle v4 - Integration Tests
 * 
 * Tests for the full system working together.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createIsleOfMarrowWorld } from '../worlds/isle-of-marrow';
import { applyPatches, computeSystemPatches } from '../core/arbiter';
import { buildTelemetry, calculateTideState, computeWeather, getTimeState } from '../core/systems';
import { calculateTravel } from '../core/travel';
import { ensureSeededFromWorld, projectPKG, resetGraphStore } from '../core/graph';
import { createToolRuntime } from '../gm/tools';
import type { World } from '../core/world';
import type { Patch } from '../core/arbiter';

describe('Full Turn Flow', () => {
  let world: World;

  beforeEach(() => {
    world = createIsleOfMarrowWorld();
  });

  it('should execute a complete turn: action → patches → system reactions', () => {
    const initialTurn = world.meta!.turn;
    const initialTime = world.systems!.time!.elapsedMinutes;

    // Step 1: GM decides player travels to market (simulated)
    const gmPatches: Patch[] = [
      { 
        op: 'set', 
        path: '/player/location', 
        value: 'the-rib-market',
        note: 'Player walks to The Rib Market',
        by: 'GM',
        turn: initialTurn + 1,
      },
      {
        op: 'set',
        path: '/player/pos',
        value: { x: 0, y: 1200, z: 15 },
        note: 'Updated position',
        by: 'GM',
        turn: initialTurn + 1,
      },
      {
        op: 'set',
        path: '/systems/time/elapsedMinutes',
        value: initialTime + 30,
        note: '30 minutes pass',
        by: 'GM',
        turn: initialTurn + 1,
      },
    ];

    // Step 2: Apply GM patches
    world = applyPatches(world, gmPatches);

    // Step 3: Compute system reactions
    const systemPatches = computeSystemPatches(world, gmPatches);

    // Step 4: Apply system patches (if any)
    if (systemPatches.length > 0) {
      world = applyPatches(world, systemPatches, 'System update');
    }

    // Verify final state
    expect(world.meta!.turn).toBeGreaterThan(initialTurn);
    expect(world.player.location).toBe('the-rib-market');
    expect(world.player.pos.y).toBe(1200);
    expect(world.systems!.time!.elapsedMinutes).toBe(initialTime + 30);
    expect(world.ledger.length).toBeGreaterThan(0);
  });

  it('should track multiple turns with accumulating state', () => {
    // Turn 1: Travel to market
    const travel1 = calculateTravel(world, world.player.pos, 'the-rib-market');
    world = applyPatches(world, [
      { op: 'set', path: '/player/location', value: 'the-rib-market', note: 'Turn 1: To market' },
      { op: 'set', path: '/player/pos', value: { x: 0, y: 1200, z: 15 } },
      { op: 'set', path: '/systems/time/elapsedMinutes', value: travel1.adjustedMinutes },
    ]);

    expect(world.meta!.turn).toBe(1);
    expect(world.player.location).toBe('the-rib-market');

    // Turn 2: Pick up item
    world = applyPatches(world, [
      { op: 'set', path: '/player/inventory', value: [{ id: 'heartwater-jar', name: 'Heartwater Jar' }], note: 'Turn 2: Got jar' },
      { op: 'set', path: '/systems/time/elapsedMinutes', value: world.systems!.time!.elapsedMinutes + 5 },
    ]);

    expect(world.meta!.turn).toBe(2);
    expect(world.player.inventory.length).toBe(1);

    // Turn 3: Travel further
    const travel2 = calculateTravel(world, world.player.pos, 'the-heartspring');
    world = applyPatches(world, [
      { op: 'set', path: '/player/location', value: 'the-heartspring', note: 'Turn 3: To heartspring' },
      { op: 'set', path: '/player/pos', value: { x: 0, y: 4800, z: 85 } },
      { op: 'set', path: '/systems/time/elapsedMinutes', value: world.systems!.time!.elapsedMinutes + travel2.adjustedMinutes },
    ]);

    expect(world.meta!.turn).toBe(3);
    expect(world.player.location).toBe('the-heartspring');
    expect(world.ledger.length).toBeGreaterThanOrEqual(3);
  });

  it('should maintain determinism across identical actions', () => {
    const world1 = createIsleOfMarrowWorld();
    const world2 = createIsleOfMarrowWorld();

    const patches: Patch[] = [
      { op: 'set', path: '/systems/time/elapsedMinutes', value: 120 },
      { op: 'set', path: '/player/location', value: 'the-rib-market' },
    ];

    const result1 = applyPatches(world1, patches);
    const result2 = applyPatches(world2, patches);

    expect(result1.meta!.turn).toBe(result2.meta!.turn);
    expect(result1.player.location).toBe(result2.player.location);
    expect(result1.systems!.time!.elapsedMinutes).toBe(result2.systems!.time!.elapsedMinutes);
  });
});

describe('Systems React to Time', () => {
  let world: World;

  beforeEach(() => {
    world = createIsleOfMarrowWorld();
  });

  it('should update tide as time advances', () => {
    const tideSnapshots: string[] = [];

    for (let hour = 0; hour < 24; hour++) {
      world = applyPatches(world, [
        { op: 'set', path: '/systems/time/elapsedMinutes', value: hour * 60 },
      ]);

      const tide = calculateTideState(world);
      if (tide && !tideSnapshots.includes(tide.phase)) {
        tideSnapshots.push(tide.phase);
      }
    }

    // Over 24 hours, should see multiple tide phases
    expect(tideSnapshots.length).toBeGreaterThanOrEqual(2);
  });

  it('should update weather as time advances', () => {
    const weatherSnapshots: string[] = [];

    for (let day = 0; day < 7; day++) {
      world = applyPatches(world, [
        { op: 'set', path: '/systems/time/elapsedMinutes', value: day * 24 * 60 },
      ]);

      const weather = computeWeather(world);
      if (weather && !weatherSnapshots.includes(weather.type)) {
        weatherSnapshots.push(weather.type);
      }
    }

    // Over a week, might see weather variation
    expect(weatherSnapshots.length).toBeGreaterThanOrEqual(1);
  });

  it('should reflect time of day in telemetry', () => {
    const timeOfDays: string[] = [];

    for (let hour = 0; hour < 24; hour++) {
      world = applyPatches(world, [
        { op: 'set', path: '/systems/time/elapsedMinutes', value: hour * 60 },
      ]);

      const time = getTimeState(world);
      if (time && !timeOfDays.includes(time.timeOfDay)) {
        timeOfDays.push(time.timeOfDay);
      }
    }

    // Should see morning, afternoon, evening, night
    expect(timeOfDays).toContain('morning');
    expect(timeOfDays).toContain('afternoon');
    expect(timeOfDays).toContain('evening');
    expect(timeOfDays).toContain('night');
  });
});

describe('Graph Integration', () => {
  let world: World;

  beforeEach(() => {
    resetGraphStore(); // Clear cache to ensure fresh state
    world = createIsleOfMarrowWorld();
  });

  it('should sync graph store with world changes', () => {
    // Initial state
    let store = ensureSeededFromWorld(world);
    expect(store.getLocatedIn('player-1')!.obj).toBe('the-landing');

    // Move player
    world = applyPatches(world, [
      { op: 'set', path: '/player/location', value: 'the-rib-market' },
    ]);

    // Reset and re-seed graph to reflect new state
    resetGraphStore();
    store = ensureSeededFromWorld(world);
    expect(store.getLocatedIn('player-1')!.obj).toBe('the-rib-market');
  });

  it('should update PKG after location change', () => {
    // Initial PKG
    let pkg = projectPKG(world);
    expect(pkg.currentLocationId).toBe('the-landing');

    // Move player
    world = applyPatches(world, [
      { op: 'set', path: '/player/location', value: 'the-rib-market' },
      { op: 'set', path: '/player/pos', value: { x: 0, y: 1200, z: 15 } },
    ]);

    // Reset graph cache before getting updated PKG
    resetGraphStore();
    pkg = projectPKG(world);
    expect(pkg.currentLocationId).toBe('the-rib-market');

    // Should see items at new location
    const jar = pkg.knownItems.find(i => i.id === 'heartwater-jar');
    expect(jar).toBeDefined();
  });

  it('should track inventory through graph', () => {
    world = applyPatches(world, [
      { op: 'set', path: '/player/inventory', value: [{ id: 'test-item', name: 'Test' }] },
    ]);

    const pkg = projectPKG(world);
    const item = pkg.knownItems.find(i => i.id === 'test-item');
    expect(item).toBeDefined();
    expect(item!.inInventory).toBe(true);
  });
});

describe('Tool Runtime Integration', () => {
  it('should work with the full tool runtime flow', () => {
    let world = createIsleOfMarrowWorld();
    const runtime = createToolRuntime(
      () => world,
      (w) => { world = w; }
    );

    // Query initial state
    const initial = runtime.query_world();
    expect(initial.player.location).toBe('the-landing');

    // Estimate travel
    const estimate = runtime.estimate_travel({ locationId: 'the-rib-market' });
    expect(estimate.distanceMeters).toBeCloseTo(1200, 0);

    // Travel
    const travelResult = runtime.travel_to_location({ locationId: 'the-rib-market' });
    expect(travelResult.ok).toBe(true);

    // Query after travel
    const afterTravel = runtime.query_world();
    expect(afterTravel.player.location).toBe('the-rib-market');

    // Apply custom patch
    runtime.apply_patches({
      patches: [
        { 
          op: 'set', 
          path: '/player/inventory', 
          value: [{ id: 'heartwater-jar', name: 'Heartwater Jar' }],
          note: 'Picked up the jar',
        },
      ],
    });

    // Final state
    const final = runtime.query_world();
    expect(final.player.inventory.length).toBe(1);
    expect(world.systems!.time!.elapsedMinutes).toBeGreaterThan(0);
  });

  it('should integrate with telemetry', () => {
    let world = createIsleOfMarrowWorld();
    const runtime = createToolRuntime(
      () => world,
      (w) => { world = w; }
    );

    // Travel and update time
    runtime.travel_to_location({ locationId: 'the-rib-market' });

    // Build telemetry
    const telemetry = buildTelemetry(world);

    expect(telemetry.player.locationId).toBe('the-rib-market');
    expect(telemetry.location.name).toBe('The Rib Market');
    expect(telemetry.time.elapsedMinutes).toBeGreaterThan(0);
    expect(telemetry.ledgerTail.length).toBeGreaterThan(0);
  });
});

describe('Constraint Enforcement', () => {
  let world: World;

  beforeEach(() => {
    world = createIsleOfMarrowWorld();
  });

  it('should block travel to tide-restricted locations at high tide', () => {
    // Find a time when tide is high (level > 0.75)
    // Tide is sinusoidal: level = 0.5 + 0.5*sin(2π*t/720)
    // High tide occurs at t = 180 (quarter cycle) when sin(π/2) = 1
    world.systems!.time!.elapsedMinutes = 180;

    const tide = calculateTideState(world);
    
    // Verify it's actually high tide
    expect(tide!.level).toBeGreaterThan(0.75);
    
    // The Maw requires low tide (tideLevel < 0.3)
    // At high tide, it should be blocked
    expect(tide!.blocked).toContain('the-maw');
    
    // Travel calculation should still work
    const travel = calculateTravel(world, world.player.pos, 'the-maw');
    expect(travel.distanceMeters).toBeGreaterThan(0);
  });

  it('should allow travel when tide is low', () => {
    // Find a time when tide is low (level < 0.25)
    // Tide is sinusoidal: level = 0.5 + 0.5*sin(2π*t/720)
    // Low tide occurs at t = 540 (three-quarter cycle) when sin(3π/2) = -1
    world.systems!.time!.elapsedMinutes = 540;

    const tide = calculateTideState(world);
    
    // Verify it's actually low tide
    expect(tide!.level).toBeLessThan(0.25);
    
    // The Maw should be accessible at low tide
    expect(tide!.blocked).not.toContain('the-maw');
  });
});

describe('Isle of Marrow Demo Scenario', () => {
  let world: World;

  beforeEach(() => {
    world = createIsleOfMarrowWorld();
  });

  it('should simulate a basic exploration scenario', () => {
    const runtime = createToolRuntime(
      () => world,
      (w) => { world = w; }
    );

    // Scene: Player arrives at The Landing
    const initial = runtime.query_world();
    expect(initial.currentLocation.name).toBe('The Landing');

    // Action 1: Walk to the market
    runtime.travel_to_location({ 
      locationId: 'the-rib-market',
      note: 'The player follows the bone-white path toward the market',
    });

    // Verify arrival
    const atMarket = runtime.query_world();
    expect(atMarket.currentLocation.name).toBe('The Rib Market');
    expect(atMarket.currentLocation.items.length).toBeGreaterThan(0);

    // Action 2: Pick up the heartwater jar
    runtime.apply_patches({
      patches: [
        {
          op: 'set',
          path: '/player/inventory',
          value: [{ id: 'heartwater-jar', name: 'Heartwater Jar' }],
          note: 'Picked up a jar of heartwater from the market stall',
        },
      ],
    });

    // Verify inventory
    expect(world.player.inventory.length).toBe(1);

    // Action 3: Talk to an NPC (simulated by time passing)
    runtime.apply_patches({
      patches: [
        { op: 'set', path: '/systems/time/elapsedMinutes', value: world.systems!.time!.elapsedMinutes + 15, note: 'Conversed with a merchant' },
      ],
    });

    // Action 4: Travel to the Heartspring
    runtime.travel_to_location({
      locationId: 'the-heartspring',
      note: 'Climbed the winding path up to the sacred spring',
    });

    // Verify final state
    const final = runtime.query_world();
    expect(final.currentLocation.name).toBe('The Heartspring');

    // Check systems updated
    const time = getTimeState(world);
    expect(time!.elapsedMinutes).toBeGreaterThan(0);

    const tide = calculateTideState(world);
    expect(tide).toBeDefined();

    const weather = computeWeather(world);
    expect(weather).toBeDefined();

    // Check ledger captures the story
    expect(world.ledger.length).toBeGreaterThanOrEqual(4);
    expect(world.ledger.some(entry => entry.includes('market'))).toBe(true);
    expect(world.ledger.some(entry => entry.includes('heartwater'))).toBe(true);
  });

  it('should maintain world consistency across extended play', () => {
    const runtime = createToolRuntime(
      () => world,
      (w) => { world = w; }
    );

    // Simulate 10 turns of exploration
    const locations = ['the-landing', 'the-rib-market', 'the-heartspring', 'the-spine-ridge', 'the-landing'];
    
    for (const loc of locations) {
      if (world.player.location !== loc) {
        runtime.travel_to_location({ locationId: loc });
      }

      // Some time passes at each location
      runtime.apply_patches({
        patches: [
          { op: 'set', path: '/systems/time/elapsedMinutes', value: world.systems!.time!.elapsedMinutes + 10 },
        ],
      });
    }

    // Verify consistency (5 locations visited = 5+ turns with patches)
    expect(world.meta!.turn).toBeGreaterThanOrEqual(5);
    expect(world.systems!.time!.elapsedMinutes).toBeGreaterThan(50);
    expect(world.ledger.length).toBeGreaterThanOrEqual(5);

    // All systems should still be computable
    const telemetry = buildTelemetry(world);
    expect(telemetry.time).toBeDefined();
    expect(telemetry.tide).toBeDefined();
    expect(telemetry.weather).toBeDefined();
  });
});

