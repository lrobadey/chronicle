import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createIsleOfMarrowWorldVNext } from '../../worlds/isle-of-marrow.vnext';
import { deriveWeather } from '../../sim/systems/weather';
import { deriveTime } from '../../sim/systems/time';
import { validateEvent } from '../../sim/validate';
import { applyEvent } from '../../sim/reducer';
import { distance } from '../../sim/utils';
import { buildTelemetry } from '../../sim/views/telemetry';
import { buildObservation } from '../../sim/views/observe';
import { computeTurnDiff } from '../../sim/views/diff';
import { getItemPlacement, setItemPlacement } from '../../sim/spine';

const FIXED_ANCHOR = '2025-01-01T14:00:00Z';

describe('sim determinism', () => {
  it('derives weather/time deterministically from state seed and elapsed minutes', () => {
    const worldA = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
    const worldB = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
    worldA.systems.time.elapsedMinutes = 180;
    worldB.systems.time.elapsedMinutes = 180;

    assert.deepEqual(deriveTime(worldA), deriveTime(worldB));
    assert.deepEqual(deriveWeather(worldA), deriveWeather(worldB));
  });

  it('rejects movement into tide-blocked location', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
    const result = validateEvent(world, {
      type: 'MoveActor',
      actorId: 'player-1',
      to: { x: 0, y: -200, z: 0 },
      toLocationId: 'the-maw',
    });

    assert.equal(result.ok, false);
    assert.ok(result.reason?.includes('tide_blocks_the-maw'));
  });

  it('requires confirmation for long TravelToLocation intents', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
    const noConfirm = validateEvent(world, {
      type: 'TravelToLocation',
      actorId: 'player-1',
      locationId: 'the-spine-ridge',
      pace: 'walk',
    });
    assert.equal(noConfirm.ok, false);
    assert.equal(noConfirm.reason, 'travel_requires_confirmation');

    const withConfirm = validateEvent(world, {
      type: 'TravelToLocation',
      actorId: 'player-1',
      locationId: 'the-spine-ridge',
      pace: 'walk',
      confirmId: 'confirm-spine',
    }, {
      id: 'confirm-spine',
      kind: 'confirm_travel',
      question: 'Set out for Spine Ridge?',
      createdTurn: 1,
      data: { locationId: 'the-spine-ridge' },
    });
    assert.equal(withConfirm.ok, true);
  });

  it('moves to the edge when destination is tide-blocked at arrival', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
    const result = applyEvent(world, {
      type: 'TravelToLocation',
      actorId: 'player-1',
      locationId: 'the-maw',
      pace: 'walk',
    });

    const playerPos = result.actors['player-1']?.pos;
    const maw = result.locations['the-maw'];
    assert.ok(playerPos);
    assert.ok(maw);
    assert.ok(distance(playerPos, maw.anchor) > (maw.radiusCells ?? 20));
    assert.ok(result.systems.time.elapsedMinutes > world.systems.time.elapsedMinutes);
    assert.ok(result.ledger[result.ledger.length - 1]?.text.includes('tide blocks entry'));
  });

  it('applies deterministic Explore and Inspect changes', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
    const explored = applyEvent(world, {
      type: 'Explore',
      actorId: 'player-1',
      area: 'shoreline',
      direction: 'east',
    });
    assert.notEqual(explored.actors['player-1']?.pos.x, world.actors['player-1']?.pos.x);
    assert.equal(explored.systems.time.elapsedMinutes, world.systems.time.elapsedMinutes + 5);

    const inspected = applyEvent(explored, {
      type: 'Inspect',
      actorId: 'player-1',
      subject: 'dock pilings',
    });
    assert.deepEqual(inspected.actors['player-1']?.pos, explored.actors['player-1']?.pos);
    assert.equal(inspected.systems.time.elapsedMinutes, explored.systems.time.elapsedMinutes + 2);
  });

  it('persists newly learned clues and surfaces them in the turn diff', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
    const before = buildTelemetry(world, 'player-1');

    const validation = validateEvent(world, {
      type: 'RecordClue',
      actorId: 'player-1',
      subject: 'outer pilings',
      text: 'There is no fresh hull scrape beneath the weed-line.',
    });
    assert.equal(validation.ok, true);

    const updated = applyEvent(world, {
      type: 'RecordClue',
      actorId: 'player-1',
      subject: 'outer pilings',
      text: 'There is no fresh hull scrape beneath the weed-line.',
    });
    const after = buildTelemetry(updated, 'player-1');
    const diff = computeTurnDiff(before, after, [
      {
        type: 'RecordClue',
        actorId: 'player-1',
        subject: 'outer pilings',
        text: 'There is no fresh hull scrape beneath the weed-line.',
      },
    ]);

    assert.deepEqual(after.knowledge.notes, ['There is no fresh hull scrape beneath the weed-line.']);
    assert.deepEqual(diff.newClues, ['There is no fresh hull scrape beneath the weed-line.']);
    assert.match(diff.summary, /Learned There is no fresh hull scrape beneath the weed-line\./);

    const duplicate = validateEvent(updated, {
      type: 'RecordClue',
      actorId: 'player-1',
      subject: 'outer pilings',
      text: 'There is no fresh hull scrape beneath the weed-line.',
    });
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.reason, 'clue_already_known');
  });

  it('validates TransferItem destinations and source ownership', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });

    const missingDestination = validateEvent(world, {
      type: 'TransferItem',
      item: {
        id: 'fresh-pour',
        name: 'Fresh Pour',
      },
    });
    assert.equal(missingDestination.ok, false);
    assert.equal(missingDestination.reason, 'transfer_destination_required');

    const wrongSource = applyEvent(world, {
      type: 'CreateEntity',
      entity: {
        kind: 'item',
        data: {
          id: 'aline-token',
          name: 'Aline Token',
          location: { kind: 'inventory', actorId: 'aline-rua' },
        },
      },
    });
    const sourceMismatch = validateEvent(wrongSource, {
      type: 'TransferItem',
      itemId: 'aline-token',
      fromActorId: 'player-1',
      toActorId: 'aline-rua',
    });
    assert.equal(sourceMismatch.ok, false);
    assert.equal(sourceMismatch.reason, 'item_not_held_by_source_actor');

    const servedToPlayer = validateEvent(world, {
      type: 'TransferItem',
      item: {
        id: 'fresh-pour',
        name: 'Fresh Pour',
      },
      toActorId: 'player-1',
    });
    assert.equal(servedToPlayer.ok, true);
  });

  it('keeps break effects coherent across lifecycle, placement, telemetry, and observation', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
    world.actors['player-1'].pos = { x: 0, y: 1200, z: 15 };

    const held = applyEvent(world, {
      type: 'AffectItem',
      actorId: 'player-1',
      itemId: 'heartwater-jar',
      effect: 'pick_up',
    });

    const broken = applyEvent(held, {
      type: 'AffectItem',
      actorId: 'player-1',
      itemId: 'heartwater-jar',
      effect: 'break',
      at: { x: 0, y: 1200, z: 15 },
    });

    assert.equal(broken.items['heartwater-jar']?.components?.lifecycle?.state, 'broken');
    assert.equal(broken.items['heartwater-jar']?.components?.condition?.broken, true);

    const placement = getItemPlacement(broken.spine, 'heartwater-jar');
    assert.equal(placement?.type, 'located_in');
    if (placement?.type === 'located_in') {
      assert.deepEqual(placement.anchor, { x: 0, y: 1200, z: 15 });
    }

    const telemetry = buildTelemetry(broken, 'player-1');
    const observation = buildObservation(broken, 'player-1');
    assert.equal(telemetry.player.inventory.some(item => item.id === 'heartwater-jar'), false);
    const observedJar = observation.nearbyItems.find(item => item.id === 'heartwater-jar');
    assert.ok(observedJar);
    assert.equal(observedJar?.components?.condition, 'broken');
  });

  it('uses the most specific containing POI for affect-item ground placement in overlaps', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
    world.actors['player-1'].pos = { x: 15, y: 20, z: 0 };
    setItemPlacement(world.spine, 'heartwater-jar', { type: 'carried_by', actorId: 'player-1' }, world.locations);

    const broken = applyEvent(world, {
      type: 'AffectItem',
      actorId: 'player-1',
      itemId: 'heartwater-jar',
      effect: 'break',
      at: { x: 15, y: 20, z: 0 },
    });

    const placement = getItemPlacement(broken.spine, 'heartwater-jar');
    assert.deepEqual(placement, {
      type: 'located_in',
      locationId: 'dock-approach',
      anchor: { x: 15, y: 20, z: 0 },
    });
  });

  it('throws when breaking a held item outside every location radius', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
    world.actors['player-1'].pos = { x: 400, y: 400, z: 0 };
    setItemPlacement(world.spine, 'heartwater-jar', { type: 'carried_by', actorId: 'player-1' }, world.locations);

    assert.throws(() => {
      applyEvent(world, {
        type: 'AffectItem',
        actorId: 'player-1',
        itemId: 'heartwater-jar',
        effect: 'break',
        at: { x: 400, y: 400, z: 0 },
      });
    }, /item_location_out_of_bounds/);
  });

  it('rejects open, fill, and empty on broken or ruined items', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
    world.actors['player-1'].pos = { x: 0, y: 1200, z: 15 };

    const held = applyEvent(world, {
      type: 'AffectItem',
      actorId: 'player-1',
      itemId: 'heartwater-jar',
      effect: 'pick_up',
    });
    const broken = applyEvent(held, {
      type: 'AffectItem',
      actorId: 'player-1',
      itemId: 'heartwater-jar',
      effect: 'break',
      at: { x: 0, y: 1200, z: 15 },
    });

    const openBroken = validateEvent(broken, {
      type: 'AffectItem',
      actorId: 'player-1',
      itemId: 'heartwater-jar',
      effect: 'open',
    });
    assert.equal(openBroken.ok, false);
    assert.equal(openBroken.reason, 'item_cannot_be_opened');

    const fillBroken = validateEvent(broken, {
      type: 'AffectItem',
      actorId: 'player-1',
      itemId: 'heartwater-jar',
      effect: 'fill',
    });
    assert.equal(fillBroken.ok, false);
    assert.equal(fillBroken.reason, 'item_cannot_be_filled');

    const emptyBroken = validateEvent(broken, {
      type: 'AffectItem',
      actorId: 'player-1',
      itemId: 'heartwater-jar',
      effect: 'empty',
    });
    assert.equal(emptyBroken.ok, false);
    assert.equal(emptyBroken.reason, 'item_cannot_be_emptied');

    const ruined = applyEvent(broken, {
      type: 'AffectItem',
      actorId: 'player-1',
      itemId: 'heartwater-jar',
      effect: 'ruin',
    });

    const fillRuined = validateEvent(ruined, {
      type: 'AffectItem',
      actorId: 'player-1',
      itemId: 'heartwater-jar',
      effect: 'fill',
    });
    assert.equal(fillRuined.ok, false);
    assert.equal(fillRuined.reason, 'item_cannot_be_filled');
  });

  it('hides consumed items from telemetry and observation after affect_item consume', () => {
    const world = createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });

    const stocked = applyEvent(world, {
      type: 'CreateEntity',
      entity: {
        kind: 'item',
        data: {
          id: 'sample-bread',
          name: 'Sample Bread',
          location: { kind: 'inventory', actorId: 'player-1' },
          tags: ['food'],
        },
      },
    });

    const consumed = applyEvent(stocked, {
      type: 'AffectItem',
      actorId: 'player-1',
      itemId: 'sample-bread',
      effect: 'consume',
      at: { x: 0, y: 0, z: 0 },
    });

    assert.equal(consumed.items['sample-bread']?.components?.lifecycle?.state, 'consumed');
    const telemetry = buildTelemetry(consumed, 'player-1');
    const observation = buildObservation(consumed, 'player-1');
    assert.equal(telemetry.player.inventory.some(item => item.id === 'sample-bread'), false);
    assert.equal(observation.nearbyItems.some(item => item.id === 'sample-bread'), false);
  });
});
