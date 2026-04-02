import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createIsleOfMarrowWorldVNext } from '../../worlds/isle-of-marrow.vnext';
import { applyEvent } from '../../sim/reducer';
import { checkInvariants } from '../../sim/invariants';
import { getItemPlacement, type SpineRelation } from '../../sim/spine';

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

    const issues = checkInvariants(world);
    assert.ok(issues.some(issue => issue.message.includes('Expected exactly one item placement relation')));
  });

  it('rejects items with no canonical placement relation', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
    const relationId = 'located_in:heartwater-jar:the-rib-market';

    delete world.spine.relations[relationId];
    world.spine.indexes.byFrom['heartwater-jar'] = [];
    world.spine.indexes.byTo['the-rib-market'] = (world.spine.indexes.byTo['the-rib-market'] || []).filter(id => id !== relationId);
    world.spine.indexes.byRelationType.located_in = (world.spine.indexes.byRelationType.located_in || []).filter(id => id !== relationId);

    const issues = checkInvariants(world);
    assert.ok(issues.some(issue => issue.message.includes('Expected exactly one item placement relation')));
  });
});
