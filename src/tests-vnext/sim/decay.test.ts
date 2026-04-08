import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createIsleOfMarrowWorldVNext } from '../../worlds/isle-of-marrow.vnext';
import { applyEvent } from '../../sim/reducer';
import {
  getItemLifecycleState,
  getItemPlacement,
  isItemInteractable,
  isItemVisible,
  summarizeItemComponents,
  syncWorldSpine,
} from '../../sim/spine';
import { runDecayCatchUp } from '../../sim/systems/decay';
import { deriveWeather } from '../../sim/systems/weather';

const FIXED_ANCHOR = '2025-01-01T14:00:00Z';

/** Helper: create a world with an iron longsword placed on the ground at a given location. */
function worldWithSwordAt(locationId: string, pos: { x: number; y: number; z?: number }) {
  const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
  const created = applyEvent(world, {
    type: 'CreateEntity',
    entity: {
      kind: 'item',
      data: {
        id: 'test-sword',
        name: 'Iron Longsword',
        archetype: 'item.weapon.iron_longsword',
        location: { kind: 'ground', pos },
      },
    },
  });
  return created;
}

/** Helper: create a world with a leather glove placed on the ground. */
function worldWithGloveAt(pos: { x: number; y: number; z?: number }) {
  const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
  const created = applyEvent(world, {
    type: 'CreateEntity',
    entity: {
      kind: 'item',
      data: {
        id: 'test-glove',
        name: 'Leather Glove',
        archetype: 'item.clothing.leather_glove',
        location: { kind: 'ground', pos },
      },
    },
  });
  return created;
}

describe('decay catch-up system', () => {
  it('no time elapsed = no decay', () => {
    const world = worldWithSwordAt('the-landing', { x: 0, y: 0, z: 0 });
    const entityBefore = world.spine.entities['test-sword'];
    const durBefore = entityBefore?.components.condition?.durability ?? 100;
    const wearBefore = entityBefore?.components.condition?.wear ?? 0;
    const rustBefore = entityBefore?.components.condition?.rust ?? 0;

    runDecayCatchUp(world);

    const entityAfter = world.spine.entities['test-sword'];
    assert.equal(entityAfter?.components.condition?.durability, durBefore);
    assert.equal(entityAfter?.components.condition?.wear ?? 0, wearBefore);
    assert.equal(entityAfter?.components.condition?.rust ?? 0, rustBefore);
  });

  it('outdoor iron sword rusts over time on beach', () => {
    // The Landing is a beach location
    const world = worldWithSwordAt('the-landing', { x: 0, y: 0, z: 0 });
    const entityBefore = world.spine.entities['test-sword'];
    const durBefore = entityBefore?.components.condition?.durability ?? 100;

    // Advance 1 day = 1440 minutes
    world.systems.time.elapsedMinutes = 1440;
    runDecayCatchUp(world);

    const entity = world.spine.entities['test-sword'];
    assert.ok(entity);
    assert.ok((entity.components.condition?.rust ?? 0) > 0, 'rust should increase');
    assert.ok((entity.components.condition?.wear ?? 0) > 0, 'wear should increase');
    assert.ok((entity.components.condition?.durability ?? 100) < durBefore, 'durability should decrease');
  });

  it('indoor item decays slowly', () => {
    // The Drunken Vertebra is interior terrain
    const worldIndoor = worldWithSwordAt('the-drunken-vertebra', { x: -150, y: 600, z: 8 });
    const worldOutdoor = worldWithSwordAt('the-landing', { x: 0, y: 0, z: 0 });

    worldIndoor.systems.time.elapsedMinutes = 1440;
    worldOutdoor.systems.time.elapsedMinutes = 1440;

    runDecayCatchUp(worldIndoor);
    runDecayCatchUp(worldOutdoor);

    const indoorEntity = worldIndoor.spine.entities['test-sword'];
    const outdoorEntity = worldOutdoor.spine.entities['test-sword'];

    const indoorWear = indoorEntity?.components.condition?.wear ?? 0;
    const outdoorWear = outdoorEntity?.components.condition?.wear ?? 0;
    const indoorRust = indoorEntity?.components.condition?.rust ?? 0;
    const outdoorRust = outdoorEntity?.components.condition?.rust ?? 0;

    assert.ok(indoorWear < outdoorWear, `indoor wear (${indoorWear}) should be less than outdoor wear (${outdoorWear})`);
    assert.ok(indoorRust < outdoorRust, `indoor rust (${indoorRust}) should be less than outdoor rust (${outdoorRust})`);
  });

  it('organic rot for leather is significant', () => {
    // Place leather glove outdoors at the landing (beach)
    const world = worldWithGloveAt({ x: 0, y: 0, z: 0 });

    world.systems.time.elapsedMinutes = 1440;
    runDecayCatchUp(world);

    const entity = world.spine.entities['test-glove'];
    assert.ok(entity);
    const rot = entity.components.condition?.rot ?? 0;
    const rust = entity.components.condition?.rust ?? 0;
    assert.ok(rot > 0, 'rot should increase for leather');
    // Leather is not rustable, so rust should be 0
    assert.equal(rust, 0, 'leather should not rust');
    assert.ok(rot > (entity.components.condition?.wear ?? 0), 'rot should exceed wear for organic_rot class');
  });

  it('carried items do not decay', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });

    const created = applyEvent(world, {
      type: 'CreateEntity',
      entity: {
        kind: 'item',
        data: {
          id: 'carried-sword',
          name: 'Iron Longsword',
          archetype: 'item.weapon.iron_longsword',
          location: { kind: 'inventory', actorId: 'player-1' },
        },
      },
    });

    created.systems.time.elapsedMinutes = 1440;
    runDecayCatchUp(created);

    const entity = created.spine.entities['carried-sword'];
    assert.ok(entity);
    // Should still be at initial durability since carried items are skipped
    assert.equal(entity.components.condition?.durability, 100);
    assert.equal(entity.components.condition?.wear ?? 0, 0);
    assert.equal(entity.components.condition?.rust ?? 0, 0);
  });

  it('weather accelerates decay', () => {
    // Create two worlds with different weather seeds to get different weather types
    const worldA = worldWithSwordAt('the-landing', { x: 0, y: 0, z: 0 });
    const worldB = worldWithSwordAt('the-landing', { x: 0, y: 0, z: 0 });

    // Both advance 1 day
    worldA.systems.time.elapsedMinutes = 1440;
    worldB.systems.time.elapsedMinutes = 1440;

    // Search for a seed that produces a different weather type than worldA
    const weatherA = deriveWeather(worldA);
    let weatherB = deriveWeather(worldB);
    let seedAttempt = 0;
    while (weatherB.type === weatherA.type && seedAttempt < 100) {
      worldB.systems.weatherConfig.seed = `decay-test-seed-${seedAttempt++}`;
      weatherB = deriveWeather(worldB);
    }

    // Only assert difference if we found distinct weather types
    if (weatherA.type !== weatherB.type) {
      runDecayCatchUp(worldA);
      runDecayCatchUp(worldB);

      const rustA = worldA.spine.entities['test-sword']?.components.condition?.rust ?? 0;
      const rustB = worldB.spine.entities['test-sword']?.components.condition?.rust ?? 0;
      assert.notEqual(rustA, rustB, `different weather (${weatherA.type} vs ${weatherB.type}) should produce different rust values`);
    } else {
      // Unable to produce different weather - verify both are equal as a sanity check
      runDecayCatchUp(worldA);
      runDecayCatchUp(worldB);
      assert.equal(
        worldA.spine.entities['test-sword']?.components.condition?.rust ?? 0,
        worldB.spine.entities['test-sword']?.components.condition?.rust ?? 0,
      );
    }
  });

  it('item becomes unusable at durability 0', () => {
    const world = worldWithSwordAt('the-landing', { x: 0, y: 0, z: 0 });

    // Set low starting durability — use own object (not shared preset reference)
    const entity = world.spine.entities['test-sword'];
    assert.ok(entity);
    entity.components.condition = { durability: 2 };
    world.items['test-sword']!.components = world.items['test-sword']!.components || {};
    world.items['test-sword']!.components!.condition = { durability: 2 };

    // Advance enough time for durability to hit 0 (even minimal decay over 1 day exceeds 2)
    world.systems.time.elapsedMinutes = 1440;
    runDecayCatchUp(world);

    const updatedEntity = world.spine.entities['test-sword'];
    assert.ok(updatedEntity);
    assert.equal(updatedEntity.components.condition?.durability, 0);
    assert.equal(getItemLifecycleState(world.spine, 'test-sword'), 'unusable');
    assert.equal(isItemInteractable(world.spine, 'test-sword'), false);
    assert.equal(isItemVisible(world.spine, 'test-sword'), true);

    // state.items should also reflect unusable
    assert.equal(world.items['test-sword']?.components?.lifecycle?.state, 'unusable');
  });

  it('decay is idempotent at same elapsed time', () => {
    const world = worldWithSwordAt('the-landing', { x: 0, y: 0, z: 0 });

    world.systems.time.elapsedMinutes = 1440;
    runDecayCatchUp(world);

    const rustAfterFirst = world.spine.entities['test-sword']?.components.condition?.rust ?? 0;
    const wearAfterFirst = world.spine.entities['test-sword']?.components.condition?.wear ?? 0;
    const durAfterFirst = world.spine.entities['test-sword']?.components.condition?.durability;

    // Run again at the same elapsed time
    runDecayCatchUp(world);

    assert.equal(world.spine.entities['test-sword']?.components.condition?.rust, rustAfterFirst);
    assert.equal(world.spine.entities['test-sword']?.components.condition?.wear, wearAfterFirst);
    assert.equal(world.spine.entities['test-sword']?.components.condition?.durability, durAfterFirst);
  });

  it('decay catch-up computes correctly for large time gaps', () => {
    const world = worldWithSwordAt('the-landing', { x: 0, y: 0, z: 0 });

    // ~1 week = 10080 minutes
    world.systems.time.elapsedMinutes = 10080;
    runDecayCatchUp(world);

    const entity = world.spine.entities['test-sword'];
    assert.ok(entity);
    const rust = entity.components.condition?.rust ?? 0;
    const wear = entity.components.condition?.wear ?? 0;
    assert.ok(rust > 0, 'rust should accumulate over a week');
    assert.ok(wear > 0, 'wear should accumulate over a week');
    // Values should be clamped to 0-100
    assert.ok(rust <= 100, 'rust should be clamped to 100');
    assert.ok(wear <= 100, 'wear should be clamped to 100');
    assert.ok((entity.components.condition?.durability ?? 0) >= 0, 'durability should not go below 0');
  });

  it('syncWorldSpine triggers eager catch-up for all items', () => {
    const world = worldWithSwordAt('the-rib-market', { x: 0, y: 1200, z: 15 });

    // Advance time then run syncWorldSpine (the eager decay path)
    world.systems.time.elapsedMinutes = 1440;
    syncWorldSpine(world);

    // The entity should now have decayed values from the eager catch-up
    const entity = world.spine.entities['test-sword'];
    assert.ok(entity);
    assert.ok((entity.components.condition?.wear ?? 0) > 0, 'wear should have increased via eager catch-up');
    assert.ok((entity.components.condition?.rust ?? 0) > 0, 'rust should have increased via eager catch-up');
  });

  it('summarizeItemComponents reflects decay', () => {
    const world = worldWithSwordAt('the-landing', { x: 0, y: 0, z: 0 });

    // Manually set some decay values to test summary output
    const entity = world.spine.entities['test-sword'];
    assert.ok(entity);
    entity.components.condition = entity.components.condition || {};
    entity.components.condition.durability = 60;
    entity.components.condition.rust = 35;

    const summary = summarizeItemComponents(world.spine, 'test-sword');
    assert.ok(summary);
    assert.ok(summary.condition?.includes('rusty'), `condition "${summary.condition}" should include "rusty"`);
    assert.ok(summary.condition?.includes('worn'), `condition "${summary.condition}" should include "worn" for durability 60`);
  });
});
