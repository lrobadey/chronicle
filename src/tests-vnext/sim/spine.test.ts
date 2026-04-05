import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createIsleOfMarrowWorldVNext } from '../../worlds/isle-of-marrow.vnext';
import { applyEvent } from '../../sim/reducer';
import { getItemPlacement, setItemPlacement, syncWorldSpine, validateSpineOrThrow, type SpineRelation } from '../../sim/spine';
import { SpineIntegrityError } from '../../engine/errors';

const FIXED_ANCHOR = '2025-01-01T14:00:00Z';

describe('world spine mirror', () => {
  it('mirrors legacy actors, items, and locations into a graph-backed spine', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });

    assert.equal(world.spine.entities['player-1']?.kind, 'actor');
    assert.equal(world.spine.entities['the-rib-market']?.kind, 'location');
    assert.equal(world.spine.entities['heartwater-jar']?.kind, 'item');
    assert.equal(world.spine.relations['located_in:heartwater-jar:the-rib-market']?.type, 'located_in');
    assert.ok(world.spine.indexes.byType.item.includes('heartwater-jar'));
  });

  it('keeps canonical item placement in spine across pickup and drop', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
    world.actors['player-1'].pos = { x: 0, y: 1200, z: 15 };

    const pickedUp = applyEvent(world, {
      type: 'PickUpItem',
      actorId: 'player-1',
      itemId: 'heartwater-jar',
    });

    assert.equal(pickedUp.spine.relations['carried_by:heartwater-jar:player-1']?.type, 'carried_by');
    assert.equal(pickedUp.spine.relations['located_in:heartwater-jar:the-rib-market'], undefined);
    assert.deepEqual(pickedUp.spine.entities['heartwater-jar']?.components.location, undefined);
    const pickedPlacement = getItemPlacement(pickedUp.spine, 'heartwater-jar');
    assert.deepEqual(pickedPlacement, { type: 'carried_by', actorId: 'player-1' });
    assert.ok(pickedUp.actors['player-1']?.inventory.includes('heartwater-jar'));

    const dropped = applyEvent(pickedUp, {
      type: 'DropItem',
      actorId: 'player-1',
      itemId: 'heartwater-jar',
      at: { x: 0, y: 1200, z: 15 },
    });

    assert.equal(dropped.spine.relations['carried_by:heartwater-jar:player-1'], undefined);
    assert.equal(dropped.spine.relations['located_in:heartwater-jar:the-rib-market']?.type, 'located_in');
    const droppedPlacement = getItemPlacement(dropped.spine, 'heartwater-jar');
    assert.equal(droppedPlacement?.type, 'located_in');
    if (droppedPlacement?.type === 'located_in') {
      assert.deepEqual(droppedPlacement.anchor, { x: 0, y: 1200, z: 15 });
    }
    assert.deepEqual(dropped.actors['player-1']?.inventory, []);
  });

  it('translates item creation into spine placement and derived inventory state', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });

    const created = applyEvent(world, {
      type: 'CreateEntity',
      entity: {
        kind: 'item',
        data: {
          id: 'player-cache',
          name: 'Player Cache',
          description: 'A satchel carried for later use.',
          location: { kind: 'inventory', actorId: 'player-1' },
        },
      },
    });

    assert.equal(created.spine.relations['carried_by:player-cache:player-1']?.type, 'carried_by');
    const placement = getItemPlacement(created.spine, 'player-cache');
    assert.deepEqual(placement, { type: 'carried_by', actorId: 'player-1' });
    assert.ok(created.actors['player-1']?.inventory.includes('player-cache'));
  });

  it('transfers an existing item between actors through the spine', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });

    const stocked = applyEvent(world, {
      type: 'CreateEntity',
      entity: {
        kind: 'item',
        data: {
          id: 'aline-cup',
          name: 'Aline Cup',
          description: 'A plain ceramic cup.',
          location: { kind: 'inventory', actorId: 'aline-rua' },
        },
      },
    });

    const transferred = applyEvent(stocked, {
      type: 'TransferItem',
      itemId: 'aline-cup',
      fromActorId: 'aline-rua',
      toActorId: 'player-1',
    });

    assert.equal(transferred.spine.relations['carried_by:aline-cup:player-1']?.type, 'carried_by');
    assert.equal(transferred.spine.relations['carried_by:aline-cup:aline-rua'], undefined);
    assert.ok(transferred.actors['player-1']?.inventory.includes('aline-cup'));
    assert.deepEqual(transferred.actors['aline-rua']?.inventory, []);
  });

  it('materializes a newly served item directly into inventory', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });

    const served = applyEvent(world, {
      type: 'TransferItem',
      item: {
        id: 'dealers-choice',
        name: "Dealer's Choice",
        description: 'A quick-poured house drink.',
        tags: ['drink'],
      },
      toActorId: 'player-1',
      note: 'Aline slides over a quick-poured drink.',
    });

    assert.equal(served.spine.relations['carried_by:dealers-choice:player-1']?.type, 'carried_by');
    assert.ok(served.actors['player-1']?.inventory.includes('dealers-choice'));
    assert.equal(served.items['dealers-choice']?.name, "Dealer's Choice");
  });

  it('rejects items with multiple canonical placement relations', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });

    const duplicate: SpineRelation = {
      id: 'carried_by:heartwater-jar:player-1',
      type: 'carried_by',
      from: 'heartwater-jar',
      to: 'player-1',
    };

    world.spine.relations[duplicate.id] = duplicate;
    world.spine.indexes.byFrom['heartwater-jar'] = [...(world.spine.indexes.byFrom['heartwater-jar'] || []), duplicate.id];
    world.spine.indexes.byTo['player-1'] = [...(world.spine.indexes.byTo['player-1'] || []), duplicate.id];
    world.spine.indexes.byRelationType.carried_by = [...(world.spine.indexes.byRelationType.carried_by || []), duplicate.id];

    assert.throws(() => {
      validateSpineOrThrow(world.spine, {
        actorIds: Object.keys(world.actors),
        itemIds: Object.keys(world.items),
        locationIds: Object.keys(world.locations),
      });
    }, (error: unknown) => {
      assert.ok(error instanceof SpineIntegrityError);
      assert.equal(error.details && typeof error.details === 'object', true);
      const issues = (error as SpineIntegrityError).details as { issues: Array<{ code: string }> };
      assert.equal(issues.issues[0]?.code, 'multiple_item_placements');
      return true;
    });
  });

  it('rejects items with no canonical placement relation during spine sync', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
    const relationId = 'located_in:heartwater-jar:the-rib-market';

    delete world.spine.relations[relationId];
    world.spine.indexes.byFrom['heartwater-jar'] = [];
    world.spine.indexes.byTo['the-rib-market'] = (world.spine.indexes.byTo['the-rib-market'] || []).filter(id => id !== relationId);
    world.spine.indexes.byRelationType.located_in = (world.spine.indexes.byRelationType.located_in || []).filter(id => id !== relationId);

    assert.throws(() => syncWorldSpine(world), (error: unknown) => {
      assert.ok(error instanceof SpineIntegrityError);
      const issues = (error as SpineIntegrityError).details as { issues: Array<{ code: string }> };
      assert.equal(issues.issues[0]?.code, 'missing_item_placement');
      return true;
    });
  });

  it('rejects invalid placement targets immediately in setItemPlacement', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });

    assert.throws(() => {
      setItemPlacement(world.spine, 'heartwater-jar', { type: 'inside', containerId: 'missing-container' }, world.locations);
    }, (error: unknown) => {
      assert.ok(error instanceof SpineIntegrityError);
      const issues = (error as SpineIntegrityError).details as { issues: Array<{ code: string }> };
      assert.equal(issues.issues[0]?.code, 'missing_placement_target');
      return true;
    });
  });

  it('rejects located items with no anchor', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
    if (world.spine.entities['heartwater-jar']?.components.location) {
      delete world.spine.entities['heartwater-jar'].components.location.anchor;
    }

    assert.throws(() => {
      validateSpineOrThrow(world.spine, {
        actorIds: Object.keys(world.actors),
        itemIds: Object.keys(world.items),
        locationIds: Object.keys(world.locations),
      });
    }, (error: unknown) => {
      assert.ok(error instanceof SpineIntegrityError);
      const issues = (error as SpineIntegrityError).details as { issues: Array<{ code: string }> };
      assert.equal(issues.issues[0]?.code, 'missing_location_anchor');
      return true;
    });
  });

  it('rejects stale index buckets', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
    world.spine.indexes.byFrom['heartwater-jar'] = [];

    assert.throws(() => {
      validateSpineOrThrow(world.spine, {
        actorIds: Object.keys(world.actors),
        itemIds: Object.keys(world.items),
        locationIds: Object.keys(world.locations),
      });
    }, (error: unknown) => {
      assert.ok(error instanceof SpineIntegrityError);
      const issues = (error as SpineIntegrityError).details as { issues: Array<{ code: string }> };
      assert.equal(issues.issues.some(issue => issue.code === 'index_missing_relation'), true);
      return true;
    });
  });
});
