import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createIsleOfMarrowWorld } from '../state/world';
import { ensureWeatherSnapshot } from '../state/weather';
import { buildTurnTelemetry } from '../state/telemetry';

describe('Weather System', () => {
  it('produces deterministic snapshots for the same turn', () => {
    const world = createIsleOfMarrowWorld();
    const first = ensureWeatherSnapshot(world);
    const second = ensureWeatherSnapshot(world);

    assert.ok(first);
    assert.deepStrictEqual(second, first);
  });

  it('updates snapshot when turn advances', () => {
    const world = createIsleOfMarrowWorld();
    const initial = ensureWeatherSnapshot(world);
    assert.ok(initial);

    world.meta = { ...(world.meta || {}), turn: (world.meta?.turn ?? 0) + 1 };
    if (world.systems?.time) {
      world.systems.time.elapsedMinutes += 60;
    }

    const updated = ensureWeatherSnapshot(world);
    assert.ok(updated);
    assert.notStrictEqual(updated.lastComputedTurn, initial.lastComputedTurn);
    assert.notDeepStrictEqual(updated, initial);
  });

  it('exposes weather data via telemetry', () => {
    const world = createIsleOfMarrowWorld();
    const telemetry = buildTurnTelemetry(world);

    assert.ok(telemetry.systems?.weather);
    assert.ok(typeof telemetry.systems?.weather?.type === 'string');
    assert.ok(typeof telemetry.systems?.weather?.temperatureC === 'number');
  });
});

