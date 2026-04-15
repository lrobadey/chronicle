import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createIsleOfMarrowWorldVNext } from '../../worlds/isle-of-marrow.vnext';
import { applyEvent, applyEvents } from '../../sim/reducer';
import type { SchedulableEvent } from '../../sim/events';

const FIXED_ANCHOR = '2025-01-01T00:00:00Z'; // midnight, so elapsedMinutes=0 means 00:00

function makeWorld() {
  return createIsleOfMarrowWorldVNext({ anchorIso: FIXED_ANCHOR });
}

function ledgerTexts(state: ReturnType<typeof applyEvent>): string[] {
  return state.ledger.map(l => l.text);
}

function hasProcessFired(state: ReturnType<typeof applyEvent>, label: string): boolean {
  return ledgerTexts(state).some(t => t === `[Process: ${label}]`);
}

describe('scheduledProcesses', () => {
  // 1. ScheduleProcess registers a process in systems.scheduledProcesses
  it('ScheduleProcess registers a process', () => {
    const world = makeWorld();
    const next = applyEvent(world, {
      type: 'ScheduleProcess',
      process: {
        id: 'test-proc-1',
        label: 'Market opens',
        dueAtMinutes: 100,
        payload: { type: 'Speak', actorId: 'ledger-pike', text: 'Market is open.' },
      },
    });
    const procs = next.systems.scheduledProcesses;
    assert.equal(procs.length, 1);
    assert.equal(procs[0]!.id, 'test-proc-1');
    assert.equal(procs[0]!.label, 'Market opens');
    assert.equal(procs[0]!.dueAtMinutes, 100);
  });

  // 2. Process fires when AdvanceTime crosses dueAtMinutes (ledger entry + payload effect applied)
  it('process fires when AdvanceTime crosses dueAtMinutes', () => {
    const world = makeWorld();
    const withProc = applyEvent(world, {
      type: 'ScheduleProcess',
      process: {
        id: 'move-mira',
        label: 'Mira arrives at landing',
        dueAtMinutes: 60,
        payload: { type: 'MoveActor', actorId: 'mira-salt', to: { x: 1, y: 1, z: 0 } },
      },
    });
    assert.equal(withProc.systems.scheduledProcesses.length, 1);

    const advanced = applyEvent(withProc, { type: 'AdvanceTime', minutes: 90 });

    // Ledger should record the process firing
    assert.ok(hasProcessFired(advanced, 'Mira arrives at landing'), 'Expected process ledger entry');
    // Actor should have moved
    assert.deepEqual(advanced.actors['mira-salt']?.pos, { x: 1, y: 1, z: 0 });
  });

  // 3. Process does NOT fire before dueAtMinutes
  it('process does not fire before dueAtMinutes', () => {
    const world = makeWorld();
    const originalPos = { ...world.actors['mira-salt']!.pos };
    const withProc = applyEvent(world, {
      type: 'ScheduleProcess',
      process: {
        id: 'future-move',
        label: 'Future arrival',
        dueAtMinutes: 200,
        payload: { type: 'MoveActor', actorId: 'mira-salt', to: { x: 99, y: 99, z: 0 } },
      },
    });

    // Advance to 100 minutes — still before dueAtMinutes=200
    const advanced = applyEvent(withProc, { type: 'AdvanceTime', minutes: 100 });

    // Actor position should not have changed
    assert.deepEqual(advanced.actors['mira-salt']?.pos, originalPos);
    // Process should still be in queue
    assert.ok(advanced.systems.scheduledProcesses.some(p => p.id === 'future-move'));
    // No firing ledger entry
    assert.ok(!hasProcessFired(advanced, 'Future arrival'));
  });

  // 4. One-shot process is removed from queue after firing
  it('one-shot process is removed after firing', () => {
    const world = makeWorld();
    const withProc = applyEvent(world, {
      type: 'ScheduleProcess',
      process: {
        id: 'one-shot',
        label: 'One-shot move',
        dueAtMinutes: 50,
        payload: { type: 'MoveActor', actorId: 'mira-salt', to: { x: 2, y: 2, z: 0 } },
      },
    });

    const advanced = applyEvent(withProc, { type: 'AdvanceTime', minutes: 60 });

    assert.ok(hasProcessFired(advanced, 'One-shot move'));
    // Process should be removed
    assert.ok(!advanced.systems.scheduledProcesses.some(p => p.id === 'one-shot'));
  });

  // 5. Recurring process re-schedules itself after firing
  it('recurring process re-schedules after firing', () => {
    const world = makeWorld();
    const withProc = applyEvent(world, {
      type: 'ScheduleProcess',
      process: {
        id: 'recurring-proc',
        label: 'Hourly patrol',
        dueAtMinutes: 60,
        cadenceMinutes: 60,
        payload: { type: 'Speak', actorId: 'ledger-pike', text: 'Patrol!' },
      },
    });

    const advanced = applyEvent(withProc, { type: 'AdvanceTime', minutes: 70 });

    // The process should have fired
    assert.ok(hasProcessFired(advanced, 'Hourly patrol'));
    // The process should be rescheduled at dueAtMinutes + cadenceMinutes = 120
    const rescheduled = advanced.systems.scheduledProcesses.find(p => p.id === 'recurring-proc');
    assert.ok(rescheduled, 'Recurring process should be rescheduled');
    assert.equal(rescheduled!.dueAtMinutes, 120);
  });

  // 6. Duplicate id in ScheduleProcess overwrites existing process
  it('duplicate ScheduleProcess id overwrites the existing process', () => {
    const world = makeWorld();
    const first = applyEvent(world, {
      type: 'ScheduleProcess',
      process: {
        id: 'overwrite-me',
        label: 'Original',
        dueAtMinutes: 200,
        payload: { type: 'Speak', actorId: 'ledger-pike', text: 'Original' },
      },
    });
    assert.equal(first.systems.scheduledProcesses.length, 1);

    const second = applyEvent(first, {
      type: 'ScheduleProcess',
      process: {
        id: 'overwrite-me',
        label: 'Replacement',
        dueAtMinutes: 300,
        payload: { type: 'Speak', actorId: 'ledger-pike', text: 'Replacement' },
      },
    });

    // Still only one process with this id
    const matching = second.systems.scheduledProcesses.filter(p => p.id === 'overwrite-me');
    assert.equal(matching.length, 1);
    assert.equal(matching[0]!.label, 'Replacement');
    assert.equal(matching[0]!.dueAtMinutes, 300);
  });

  // 7. ScheduleProcess payload with forbidden type is silently skipped (no recursion)
  it('ScheduleProcess payload type ScheduleProcess is silently skipped', () => {
    const world = makeWorld();
    // Cast through unknown to bypass TypeScript's structural check — we're testing the runtime guard
    const recursivePayload = {
      type: 'ScheduleProcess',
      process: { id: 'inner', label: 'Inner', dueAtMinutes: 20, payload: { type: 'Speak', actorId: 'ledger-pike', text: 'Inner!' } },
    } as unknown as SchedulableEvent;

    const withProc = applyEvent(world, {
      type: 'ScheduleProcess',
      process: {
        id: 'recursive-proc',
        label: 'Recursive',
        dueAtMinutes: 10,
        payload: recursivePayload,
      },
    });

    // Firing this should not throw and should not produce an inner process
    let advanced: ReturnType<typeof applyEvent>;
    assert.doesNotThrow(() => {
      advanced = applyEvent(withProc, { type: 'AdvanceTime', minutes: 30 });
    });
    // Ledger should show the outer process fired (just the guard label entry)
    assert.ok(hasProcessFired(advanced!, 'Recursive'));
    // No 'inner' process should have been registered
    assert.ok(!advanced!.systems.scheduledProcesses.some(p => p.id === 'inner'));
    // The outer process should be gone (fired and removed)
    assert.ok(!advanced!.systems.scheduledProcesses.some(p => p.id === 'recursive-proc'));
  });

  // 8. Multiple due processes in one time-advance fire in dueAtMinutes order
  it('multiple due processes fire in dueAtMinutes order', () => {
    const world = makeWorld();
    // Each process moves mira-salt to a different position; last one wins
    // proc-a fires at 40 → pos (1,1), proc-b fires at 80 → pos (2,2), proc-c fires at 120 → pos (3,3)
    const withProcs = applyEvents(world, [
      {
        type: 'ScheduleProcess',
        process: {
          id: 'proc-b',
          label: 'Second move',
          dueAtMinutes: 80,
          payload: { type: 'MoveActor', actorId: 'mira-salt', to: { x: 2, y: 2, z: 0 } },
        },
      },
      {
        type: 'ScheduleProcess',
        process: {
          id: 'proc-a',
          label: 'First move',
          dueAtMinutes: 40,
          payload: { type: 'MoveActor', actorId: 'mira-salt', to: { x: 1, y: 1, z: 0 } },
        },
      },
      {
        type: 'ScheduleProcess',
        process: {
          id: 'proc-c',
          label: 'Third move',
          dueAtMinutes: 120,
          payload: { type: 'MoveActor', actorId: 'mira-salt', to: { x: 3, y: 3, z: 0 } },
        },
      },
    ]);

    // Advance past all three
    const advanced = applyEvent(withProcs, { type: 'AdvanceTime', minutes: 150 });

    // Final position should be (3,3,0) — last in dueAtMinutes order
    assert.deepEqual(advanced.actors['mira-salt']?.pos, { x: 3, y: 3, z: 0 });

    // All three ledger entries should be present, in order
    const texts = ledgerTexts(advanced);
    const iA = texts.lastIndexOf('[Process: First move]');
    const iB = texts.lastIndexOf('[Process: Second move]');
    const iC = texts.lastIndexOf('[Process: Third move]');
    assert.ok(iA >= 0 && iB >= 0 && iC >= 0, 'All processes should appear in ledger');
    assert.ok(iA < iB && iB < iC, 'Processes should fire in dueAtMinutes order');

    // All three processes should be removed
    assert.ok(!advanced.systems.scheduledProcesses.some(p => ['proc-a', 'proc-b', 'proc-c'].includes(p.id)));
  });

  // 9. SetNpcSchedule stores entries on actor; next AdvanceTime hydrates them into scheduledProcesses
  //    NPC schedules hydrate during AdvanceTime — the process fires on a subsequent advance after hydration.
  it('SetNpcSchedule stores entries and AdvanceTime hydrates scheduledProcesses', () => {
    const world = makeWorld();
    // Set Mira's schedule: move to landing at hour 2 (dueAtMinutes = 120)
    const withSchedule = applyEvent(world, {
      type: 'SetNpcSchedule',
      actorId: 'mira-salt',
      entries: [
        {
          id: 'mira-dawn-move',
          label: 'Mira goes to landing',
          atHour: 2,
          payload: { type: 'MoveActor', actorId: 'mira-salt', to: { x: 5, y: 5, z: 0 } },
        },
      ],
    });

    // Check the schedule was stored on the actor
    assert.ok(withSchedule.actors['mira-salt']?.schedule);
    assert.equal(withSchedule.actors['mira-salt']!.schedule!.entries.length, 1);
    assert.equal(withSchedule.actors['mira-salt']!.schedule!.entries[0]!.id, 'mira-dawn-move');

    // Step 1: Advance to 60 minutes — triggers hydration, adds the 120-min process to the queue
    const hydrated = applyEvent(withSchedule, { type: 'AdvanceTime', minutes: 60 });
    assert.ok(
      hydrated.systems.scheduledProcesses.some(p => p.id.includes('mira-dawn-move')),
      'Process should be in queue after hydration',
    );

    // Step 2: Advance past hour 2 (120 minutes total) — process fires
    const advanced = applyEvent(hydrated, { type: 'AdvanceTime', minutes: 70 });

    assert.ok(hasProcessFired(advanced, 'Mira goes to landing'));
    assert.deepEqual(advanced.actors['mira-salt']?.pos, { x: 5, y: 5, z: 0 });
  });

  // 10. NPC schedule hydration skips past entries and doesn't double-hydrate the same day
  it('NPC schedule hydration skips past entries and does not double-hydrate', () => {
    const world = makeWorld();

    // Set a schedule with hour 22 (dueAtMinutes=1320 for day 0)
    const withSchedule = applyEvent(world, {
      type: 'SetNpcSchedule',
      actorId: 'mira-salt',
      entries: [
        {
          id: 'mira-night',
          label: 'Mira night watch',
          atHour: 22,
          payload: { type: 'MoveActor', actorId: 'mira-salt', to: { x: 7, y: 7, z: 0 } },
        },
      ],
    });

    // Step 1: advance to 720 min (noon) — hydrates day 0 entry at 1320 min (future)
    const hydrated = applyEvent(withSchedule, { type: 'AdvanceTime', minutes: 720 });
    assert.ok(
      hydrated.systems.scheduledProcesses.some(p => p.id.includes('mira-night')),
      'Process should be hydrated into queue',
    );

    // Step 2: advance past 1320 minutes (22:00) — process fires
    const advanced1 = applyEvent(hydrated, { type: 'AdvanceTime', minutes: 660 });
    assert.ok(hasProcessFired(advanced1, 'Mira night watch'));

    // No duplicate processes for the same day-0 slot
    const dupes = advanced1.systems.scheduledProcesses.filter(p => p.id.includes('mira-night') && p.dueAtMinutes === 1320);
    assert.equal(dupes.length, 0, 'No duplicate entries for already-fired time');

    // Advancing again by a small amount should not re-add the day-0 slot
    const advanced2 = applyEvent(advanced1, { type: 'AdvanceTime', minutes: 10 });
    const dayZeroDupe = advanced2.systems.scheduledProcesses.filter(
      p => p.id.includes('mira-night') && p.dueAtMinutes === 1320,
    );
    assert.equal(dayZeroDupe.length, 0, 'Day-0 slot must not be re-added after firing');
  });
});
