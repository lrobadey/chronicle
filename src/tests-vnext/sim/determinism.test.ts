import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createIsleOfMarrowWorldVNext } from '../../worlds/isle-of-marrow.vnext';
import { deriveWeather } from '../../sim/systems/weather';
import { deriveTime } from '../../sim/systems/time';
import { validateEvent } from '../../sim/validate';
import { applyEvent } from '../../sim/reducer';
import { distance } from '../../sim/utils';
import { buildTelemetry } from '../../sim/views/telemetry';
import { computeTurnDiff } from '../../sim/views/diff';

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
});
