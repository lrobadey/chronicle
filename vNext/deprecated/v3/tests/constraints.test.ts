import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createIsleOfMarrowWorld } from '../state/world';
import { buildTurnTelemetry } from '../state/telemetry';
import { buildTurnConstraints, validatePatchesAgainstConstraints } from '../state/constraints';
import type { Patch } from '../tools/types';

describe('Turn constraints', () => {
  it('derives sensible defaults from telemetry', () => {
    const world = createIsleOfMarrowWorld();
    const telemetry = buildTurnTelemetry(world);
    const constraints = buildTurnConstraints(world, telemetry);

    assert.ok(constraints.maxMoveMeters >= 150);
    assert.ok(constraints.weatherMultiplier > 0);
    assert.ok(Array.isArray(constraints.blockedLocations));
  });

  it('flags large moves that exceed the per-turn limit', () => {
    const world = createIsleOfMarrowWorld();
    const telemetry = buildTurnTelemetry(world);
    const constraints = buildTurnConstraints(world, telemetry);

    const patches: Patch[] = [
      {
        op: 'set',
        path: '/player/pos',
        value: { x: world.player.pos.x + constraints.maxMoveMeters + 200, y: world.player.pos.y, z: 0 },
        note: 'teleport',
      },
    ];

    const violations = validatePatchesAgainstConstraints(patches, constraints, world);
    assert.ok(violations.length >= 1);
    assert.match(violations[0], /exceeds/i);
  });

  it('flags moves into tide-blocked locations', () => {
    const world = createIsleOfMarrowWorld();
    const telemetry = buildTurnTelemetry(world);
    telemetry.systems = telemetry.systems || {};
    telemetry.systems.tide = {
      phase: 'high',
      accessible: [],
      blocked: ['the-maw'],
    };
    const constraints = buildTurnConstraints(world, telemetry);

    const patches: Patch[] = [
      { op: 'set', path: '/player/location', value: 'the-maw', note: 'move to maw' },
    ];

    const violations = validatePatchesAgainstConstraints(patches, constraints, world);
    assert.ok(violations.some((v) => v.includes('tide')));
  });
});

