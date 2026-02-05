import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createIsleOfMarrowWorldVNext } from '../../worlds/isle-of-marrow.vnext';
import { deriveWeather } from '../../sim/systems/weather';
import { deriveTime } from '../../sim/systems/time';
import { validateEvent } from '../../sim/validate';

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
});
