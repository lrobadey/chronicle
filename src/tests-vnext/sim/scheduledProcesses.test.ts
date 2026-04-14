import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyEvent } from '../../sim/reducer';
import { createIsleOfMarrowWorldVNext } from '../../worlds/isle-of-marrow.vnext';

const FIXED_ANCHOR = '2025-01-01T06:00:00Z';

function baseWorld() {
  return createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
}

describe('scheduled processes', () => {
  it('registers a process in systems.scheduledProcesses', () => {
    const world = baseWorld();

    const result = applyEvent(world, {
      type: 'ScheduleProcess',
      process: {
        id: 'proc-1',
        label: 'Morning bell',
        dueAtMinutes: 5,
        payload: {
          type: 'SetFlag',
          key: 'bell-rung',
          value: true,
        },
      },
    });

    assert.equal(result.systems.scheduledProcesses.length, 1);
    assert.equal(result.systems.scheduledProcesses[0]?.id, 'proc-1');
  });

  it('fires when AdvanceTime crosses dueAtMinutes', () => {
    const world = applyEvent(baseWorld(), {
      type: 'ScheduleProcess',
      process: {
        id: 'proc-move',
        label: 'Tamar steps aside',
        dueAtMinutes: 5,
        payload: {
          type: 'MoveActor',
          actorId: 'tamar-vane',
          to: { x: 29, y: 42, z: 0 },
        },
      },
    });

    const result = applyEvent(world, {
      type: 'AdvanceTime',
      minutes: 5,
    });

    assert.deepEqual(result.actors['tamar-vane']?.pos, { x: 29, y: 42, z: 0 });
    assert.ok(result.ledger.some(entry => entry.text === '[Process: Tamar steps aside]'));
  });

  it('does not fire before dueAtMinutes', () => {
    const world = applyEvent(baseWorld(), {
      type: 'ScheduleProcess',
      process: {
        id: 'proc-late',
        label: 'Later movement',
        dueAtMinutes: 10,
        payload: {
          type: 'MoveActor',
          actorId: 'tamar-vane',
          to: { x: 29, y: 42, z: 0 },
        },
      },
    });

    const result = applyEvent(world, {
      type: 'AdvanceTime',
      minutes: 5,
    });

    assert.deepEqual(result.actors['tamar-vane']?.pos, world.actors['tamar-vane']?.pos);
    assert.equal(result.systems.scheduledProcesses.length, 1);
  });

  it('removes one-shot processes after firing', () => {
    const world = applyEvent(baseWorld(), {
      type: 'ScheduleProcess',
      process: {
        id: 'proc-once',
        label: 'One shot',
        dueAtMinutes: 5,
        payload: {
          type: 'SetFlag',
          key: 'shot',
          value: true,
        },
      },
    });

    const result = applyEvent(world, {
      type: 'AdvanceTime',
      minutes: 5,
    });

    assert.equal(result.systems.scheduledProcesses.some(process => process.id === 'proc-once'), false);
  });

  it('re-schedules recurring processes after firing', () => {
    const world = applyEvent(baseWorld(), {
      type: 'ScheduleProcess',
      process: {
        id: 'proc-recurring',
        label: 'Recurring check',
        dueAtMinutes: 5,
        cadenceMinutes: 15,
        payload: {
          type: 'SetFlag',
          key: 'checked',
          value: true,
        },
      },
    });

    const result = applyEvent(world, {
      type: 'AdvanceTime',
      minutes: 5,
    });

    assert.equal(result.systems.scheduledProcesses.length, 1);
    assert.equal(result.systems.scheduledProcesses[0]?.id, 'proc-recurring');
    assert.equal(result.systems.scheduledProcesses[0]?.dueAtMinutes, 20);
  });

  it('overwrites an existing process when ScheduleProcess uses a duplicate id', () => {
    const world = applyEvent(baseWorld(), {
      type: 'ScheduleProcess',
      process: {
        id: 'proc-dup',
        label: 'First label',
        dueAtMinutes: 5,
        payload: {
          type: 'SetFlag',
          key: 'dup',
          value: 1,
        },
      },
    });

    const result = applyEvent(world, {
      type: 'ScheduleProcess',
      process: {
        id: 'proc-dup',
        label: 'Updated label',
        dueAtMinutes: 30,
        payload: {
          type: 'SetFlag',
          key: 'dup',
          value: 2,
        },
      },
    });

    assert.equal(result.systems.scheduledProcesses.length, 1);
    assert.equal(result.systems.scheduledProcesses[0]?.label, 'Updated label');
    assert.equal(result.systems.scheduledProcesses[0]?.dueAtMinutes, 30);
  });

  it('silently skips invalid scheduled payload types', () => {
    const world = baseWorld();
    world.systems.scheduledProcesses.push({
      id: 'proc-invalid',
      label: 'Bad payload',
      dueAtMinutes: 5,
      payload: {
        type: 'AdvanceTime',
        minutes: 30,
      },
      createdTurn: 0,
    });

    const result = applyEvent(world, {
      type: 'AdvanceTime',
      minutes: 5,
    });

    assert.equal(result.systems.time.elapsedMinutes, 5);
    assert.equal(result.systems.scheduledProcesses.length, 0);
    assert.ok(result.ledger.some(entry => entry.text === '[Process: Bad payload]'));
  });

  it('fires multiple due processes in dueAtMinutes order', () => {
    let world = applyEvent(baseWorld(), {
      type: 'ScheduleProcess',
      process: {
        id: 'proc-second',
        label: 'Second',
        dueAtMinutes: 10,
        payload: {
          type: 'SetFlag',
          key: 'second',
          value: true,
        },
      },
    });
    world = applyEvent(world, {
      type: 'ScheduleProcess',
      process: {
        id: 'proc-first',
        label: 'First',
        dueAtMinutes: 5,
        payload: {
          type: 'SetFlag',
          key: 'first',
          value: true,
        },
      },
    });

    const result = applyEvent(world, {
      type: 'AdvanceTime',
      minutes: 10,
    });

    const firstIndex = result.ledger.findIndex(entry => entry.text === '[Process: First]');
    const secondIndex = result.ledger.findIndex(entry => entry.text === '[Process: Second]');
    assert.ok(firstIndex >= 0);
    assert.ok(secondIndex >= 0);
    assert.ok(firstIndex < secondIndex);
  });

  it('stores NPC schedule entries and hydrates them into scheduledProcesses on the next AdvanceTime', () => {
    const world = applyEvent(baseWorld(), {
      type: 'SetNpcSchedule',
      actorId: 'tamar-vane',
      entries: [
        {
          id: 'market-walk',
          label: 'Tamar walks the market',
          atHour: 8,
          payload: {
            type: 'MoveActor',
            actorId: 'tamar-vane',
            to: { x: 29, y: 42, z: 0 },
          },
        },
      ],
    });

    assert.equal(world.actors['tamar-vane']?.schedule?.entries.length, 1);
    assert.equal(world.systems.scheduledProcesses.length, 0);

    const hydrated = applyEvent(world, {
      type: 'AdvanceTime',
      minutes: 1,
    });

    assert.equal(hydrated.systems.scheduledProcesses.length, 2);
    assert.equal(hydrated.systems.scheduledProcesses[0]?.label, 'Tamar walks the market');
    assert.equal(hydrated.systems.scheduledProcesses[0]?.dueAtMinutes, 120);
    assert.equal(hydrated.systems.scheduledProcesses[1]?.dueAtMinutes, 1560);
  });

  it('skips past NPC schedule entries and does not double-hydrate the same day', () => {
    const world = applyEvent(baseWorld(), {
      type: 'SetNpcSchedule',
      actorId: 'tamar-vane',
      entries: [
        {
          id: 'past',
          label: 'Already missed',
          atHour: 5,
          payload: {
            type: 'SetFlag',
            key: 'past',
            value: true,
          },
        },
        {
          id: 'future',
          label: 'Still ahead',
          atHour: 8,
          payload: {
            type: 'SetFlag',
            key: 'future',
            value: true,
          },
        },
      ],
    });

    const firstHydration = applyEvent(world, {
      type: 'AdvanceTime',
      minutes: 1,
    });
    const secondHydration = applyEvent(firstHydration, {
      type: 'AdvanceTime',
      minutes: 1,
    });

    assert.equal(firstHydration.systems.scheduledProcesses.filter(process => process.label === 'Already missed').length, 1);
    assert.equal(firstHydration.systems.scheduledProcesses.filter(process => process.label === 'Still ahead').length, 2);
    assert.equal(secondHydration.systems.scheduledProcesses.filter(process => process.label === 'Already missed').length, 1);
    assert.equal(secondHydration.systems.scheduledProcesses.filter(process => process.label === 'Still ahead').length, 2);
  });
});
