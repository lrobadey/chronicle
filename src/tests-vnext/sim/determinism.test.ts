import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createIsleOfMarrowWorldVNext } from '../../worlds/isle-of-marrow.vnext';
import { deriveWeather } from '../../sim/systems/weather';
import { deriveTime } from '../../sim/systems/time';
import { validateEvent } from '../../sim/validate';
import { applyEvent } from '../../sim/reducer';
import { distance } from '../../sim/utils';

describe('sim determinism', () => {
  it('derives weather/time deterministically from state seed and elapsed minutes', () => {
    const worldA = createIsleOfMarrowWorldVNext();
    const worldB = createIsleOfMarrowWorldVNext();
    worldA.systems.time.elapsedMinutes = 180;
    worldB.systems.time.elapsedMinutes = 180;

    assert.deepEqual(deriveTime(worldA), deriveTime(worldB));
    assert.deepEqual(deriveWeather(worldA), deriveWeather(worldB));
  });

  it('rejects movement into tide-blocked location', () => {
    const world = createIsleOfMarrowWorldVNext();
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
    const world = createIsleOfMarrowWorldVNext();
    const noConfirm = validateEvent(world, {
      type: 'TravelToLocation',
      actorId: 'player-1',
      locationId: 'the-spine-ridge',
      pace: 'walk',
    });
    assert.equal(noConfirm.ok, false);
    assert.equal(noConfirm.reason, 'travel_requires_confirmation');

    world.meta.pendingPrompt = {
      id: 'confirm-spine',
      kind: 'confirm_travel',
      question: 'Set out for Spine Ridge?',
      createdTurn: 1,
      data: { locationId: 'the-spine-ridge' },
    };
    const withConfirm = validateEvent(world, {
      type: 'TravelToLocation',
      actorId: 'player-1',
      locationId: 'the-spine-ridge',
      pace: 'walk',
      confirmId: 'confirm-spine',
    });
    assert.equal(withConfirm.ok, true);
  });

  it('moves to the edge when destination is tide-blocked at arrival', () => {
    const world = createIsleOfMarrowWorldVNext();
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
    const world = createIsleOfMarrowWorldVNext();
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
});
