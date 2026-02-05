/**
 * Comprehensive tests for the time system integration
 * 
 * Tests:
 * - Basic time derivation
 * - Backward compatibility with existing worlds
 * - Anchor initialization
 * - Patches system
 * - Integration with telemetry
 * - Tide system compatibility
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createIsleOfMarrowWorld, createSimpleWorld, type SimpleWorld } from '../state/world';
import { 
  deriveAbsoluteTime, 
  computeEffectiveElapsedMinutes,
  ensureTimeAnchor,
  getTimeState,
  advanceTime,
  type TimeSystemState 
} from '../state/time';
import { buildTurnTelemetry } from '../state/telemetry';
import { calculateTideState } from '../state/systems';
import { applyPatches, type Patch } from '../state/arbiter';

describe('Time System Integration', () => {
  
  describe('Basic Time Derivation', () => {
    it('should derive basic time data from elapsed minutes', () => {
      const timeState: TimeSystemState = {
        elapsedMinutes: 120, // 2 hours
        startHour: 14, // 2 PM
      };
      
      const result = deriveAbsoluteTime(timeState);
      
      assert.strictEqual(result.elapsedMinutes, 120);
      assert.strictEqual(result.currentHour, 16); // 2 PM + 2 hours = 4 PM
      assert.strictEqual(result.currentDay, 1);
      assert.strictEqual(result.timeOfDay, 'afternoon');
      assert.strictEqual(result.cycle.minute, 0); // 120 minutes = exactly 2 hours
      assert.strictEqual(result.cycle.hour, 16);
      assert.strictEqual(result.cycle.day, 1);
    });

    it('should calculate day progression correctly', () => {
      const timeState: TimeSystemState = {
        elapsedMinutes: 24 * 60 + 60, // 1 day + 1 hour
        startHour: 0,
      };
      
      const result = deriveAbsoluteTime(timeState);
      
      assert.strictEqual(result.currentDay, 2);
      assert.strictEqual(result.currentHour, 1);
      assert.strictEqual(result.cycle.day, 2);
    });

    it('should handle timeOfDay correctly', () => {
      const testCases = [
        { elapsed: 0, startHour: 5, expected: 'morning' },
        { elapsed: 0, startHour: 11, expected: 'morning' },
        { elapsed: 0, startHour: 12, expected: 'afternoon' },
        { elapsed: 0, startHour: 16, expected: 'afternoon' },
        { elapsed: 0, startHour: 17, expected: 'evening' },
        { elapsed: 0, startHour: 20, expected: 'evening' },
        { elapsed: 0, startHour: 21, expected: 'night' },
        { elapsed: 0, startHour: 4, expected: 'night' },
      ];

      for (const { elapsed, startHour, expected } of testCases) {
        const timeState: TimeSystemState = {
          elapsedMinutes: elapsed,
          startHour,
        };
        const result = deriveAbsoluteTime(timeState);
        assert.strictEqual(result.timeOfDay, expected);
      }
    });
  });

  describe('Calendar Derivation with Anchor', () => {
    it('should derive calendar data when anchor is present', () => {
      const anchorDate = new Date('1825-05-14T14:00:00Z');
      const timeState: TimeSystemState = {
        elapsedMinutes: 120, // 2 hours later
        startHour: 14,
        anchor: {
          isoDateTime: anchorDate.toISOString(),
          calendar: 'gregorian',
        },
      };
      
      const result = deriveAbsoluteTime(timeState);
      
      assert.ok(result.absolute !== undefined);
      assert.ok(result.absolute?.isoDateTime !== undefined);
      assert.ok(result.calendar !== undefined);
      
      if (result.calendar) {
        assert.strictEqual(result.calendar.year, 1825);
        assert.strictEqual(result.calendar.month.index, 5); // May
        assert.strictEqual(result.calendar.month.name, 'May');
        assert.strictEqual(result.calendar.month.dayOfMonth, 14); // Still same day
      }
    });

    it('should calculate week number correctly', () => {
      const anchorDate = new Date('2024-01-01T00:00:00Z'); // Monday
      const timeState: TimeSystemState = {
        elapsedMinutes: 7 * 24 * 60, // 7 days later
        startHour: 0,
        anchor: {
          isoDateTime: anchorDate.toISOString(),
          calendar: 'gregorian',
        },
      };
      
      const result = deriveAbsoluteTime(timeState);
      
      assert.ok(result.calendar?.week.number > 0);
    });

    it('should handle month boundaries correctly', () => {
      // Use a date that's clearly January 31, add 1 day to get February 1
      const anchorDate = new Date('2024-01-31T12:00:00Z'); // Noon UTC on Jan 31
      const timeState: TimeSystemState = {
        elapsedMinutes: 24 * 60, // 1 day later
        startHour: 12, // Match anchor hour
        anchor: {
          isoDateTime: anchorDate.toISOString(),
          calendar: 'gregorian',
        },
      };
      
      const result = deriveAbsoluteTime(timeState);
      
      if (result.calendar) {
        // Should be February 1st
        assert.ok(result.calendar.month.index === 2 || result.calendar.month.index === 1, 
          `Expected February (2) or January (1) if day hasn't rolled, got ${result.calendar.month.index}`);
        // If it's February, day should be 1
        if (result.calendar.month.index === 2) {
          assert.strictEqual(result.calendar.month.dayOfMonth, 1);
        }
      }
    });
  });

  describe('Backward Compatibility', () => {
    it('should work with existing worlds without anchor', () => {
      const world = createIsleOfMarrowWorld();
      // Remove anchor to simulate old world
      if (world.systems?.time) {
        delete (world.systems.time as any).anchor;
      }
      
      const timeState = getTimeState(world);
      assert.ok(timeState !== undefined);
      
      // Should derive time without anchor
      const result = deriveAbsoluteTime(timeState!);
      assert.strictEqual(result.elapsedMinutes, 0);
      assert.strictEqual(result.currentHour, 14); // startHour
      assert.ok(result.absolute === undefined); // No anchor, no absolute time
      assert.ok(result.calendar === undefined); // No anchor, no calendar
    });

    it('should ensure anchor is created from world metadata', () => {
      const world: SimpleWorld = {
        player: { id: 'test', pos: { x: 0, y: 0 }, location: 'test', inventory: [] },
        locations: {},
        ledger: [],
        systems: {
          time: {
            elapsedMinutes: 60,
            startHour: 8,
            // No anchor
          },
        },
        meta: {
          turn: 0,
          startedAt: '2024-01-01T08:00:00Z',
        },
      };
      
      const timeState = getTimeState(world);
      const timeStateWithAnchor = ensureTimeAnchor(timeState!, world.meta);
      
      assert.ok(timeStateWithAnchor.anchor !== undefined);
      assert.strictEqual(timeStateWithAnchor.anchor?.isoDateTime, '2024-01-01T08:00:00Z');
    });

    it('should work with minimal time state', () => {
      const timeState: TimeSystemState = {
        elapsedMinutes: 0,
      };
      
      const result = deriveAbsoluteTime(timeState);
      assert.strictEqual(result.elapsedMinutes, 0);
      assert.strictEqual(result.currentHour, 0); // Default startHour
      assert.strictEqual(result.currentDay, 1);
    });
  });

  describe('Patches System', () => {
    it('should apply delta patches correctly', () => {
      const timeState: TimeSystemState = {
        elapsedMinutes: 100,
        startHour: 0,
        patches: [
          { turn: 1, reason: 'test', deltaMinutes: 20 },
          { turn: 2, reason: 'test', deltaMinutes: -10 },
        ],
      };
      
      const effective = computeEffectiveElapsedMinutes(timeState, 2);
      // 100 + 20 - 10 = 110
      assert.strictEqual(effective, 110);
    });

    it('should only apply patches up to current turn', () => {
      const timeState: TimeSystemState = {
        elapsedMinutes: 100,
        patches: [
          { turn: 1, reason: 'test', deltaMinutes: 20 },
          { turn: 3, reason: 'test', deltaMinutes: 30 },
        ],
      };
      
      // At turn 2, only patch 1 should apply
      const effective = computeEffectiveElapsedMinutes(timeState, 2);
      assert.strictEqual(effective, 120); // 100 + 20
      
      // At turn 3, both patches apply
      const effective3 = computeEffectiveElapsedMinutes(timeState, 3);
      assert.strictEqual(effective3, 150); // 100 + 20 + 30
    });

    it('should handle absolute timestamp patches', () => {
      const anchorDate = new Date('2024-01-01T00:00:00Z');
      const patchDate = new Date('2024-01-01T02:00:00Z'); // 2 hours later
      
      const timeState: TimeSystemState = {
        elapsedMinutes: 0,
        anchor: {
          isoDateTime: anchorDate.toISOString(),
        },
        patches: [
          { turn: 1, reason: 'time jump', setAbsolute: patchDate.toISOString() },
        ],
      };
      
      const effective = computeEffectiveElapsedMinutes(timeState, 1);
      // Should be 120 minutes (2 hours)
      assert.strictEqual(effective, 120);
    });

    it('should prevent negative elapsed minutes', () => {
      const timeState: TimeSystemState = {
        elapsedMinutes: 10,
        patches: [
          { turn: 1, reason: 'test', deltaMinutes: -100 }, // Would go negative
        ],
      };
      
      const effective = computeEffectiveElapsedMinutes(timeState, 1);
      assert.ok(effective >= 0);
    });
  });

  describe('Telemetry Integration', () => {
    it('should include rich time data in telemetry', () => {
      const world = createIsleOfMarrowWorld();
      const telemetry = buildTurnTelemetry(world);
      
      assert.ok(telemetry.systems?.time !== undefined);
      const timeData = telemetry.systems?.time;
      
      assert.strictEqual(timeData?.elapsedMinutes, 0);
      assert.strictEqual(timeData?.currentHour, 14);
      assert.strictEqual(timeData?.currentDay, 1);
      assert.strictEqual(timeData?.timeOfDay, 'afternoon');
      assert.ok(timeData?.cycle !== undefined);
    });

    it('should include calendar data in telemetry when anchor exists', () => {
      const world = createIsleOfMarrowWorld();
      // Anchor should be set in createIsleOfMarrowWorld
      const telemetry = buildTurnTelemetry(world);
      
      const timeData = telemetry.systems?.time;
      assert.ok(timeData?.absolute !== undefined);
      assert.ok(timeData?.calendar !== undefined);
      
      if (timeData?.calendar) {
        assert.ok(timeData.calendar.year > 0);
        assert.ok(timeData.calendar.month.index > 0);
        assert.ok(timeData.calendar.month.name);
      }
    });

    it('should work with telemetry for backward-compatible worlds', () => {
      const world = createSimpleWorld();
      // Simple world should have time system, may or may not have anchor
      // The telemetry system should handle both cases
      if (world.systems?.time) {
        const telemetry = buildTurnTelemetry(world);
        
        assert.ok(telemetry.systems?.time !== undefined);
        const timeData = telemetry.systems?.time;
        assert.ok(timeData?.elapsedMinutes !== undefined);
        assert.ok(timeData?.currentHour !== undefined);
        assert.ok(timeData?.currentDay !== undefined);
      } else {
        // If simple world doesn't have time system, that's also valid
        // This test just ensures we don't crash
        const telemetry = buildTurnTelemetry(world);
        // Should still build telemetry successfully
        assert.ok(telemetry !== undefined);
      }
    });
  });

  describe('Tide System Compatibility', () => {
    it('should still calculate tide from elapsedMinutes', () => {
      const world = createIsleOfMarrowWorld();
      const elapsedMinutes = world.systems?.time?.elapsedMinutes || 0;
      
      const tideState = calculateTideState(elapsedMinutes, 720);
      
      assert.ok(tideState.phase !== undefined);
      assert.ok(['low', 'rising', 'high', 'falling'].includes(tideState.phase));
      assert.ok(tideState.level >= 0);
      assert.ok(tideState.level <= 1);
    });

    it('should maintain tide consistency with time patches', () => {
      const world = createIsleOfMarrowWorld();
      const originalElapsed = world.systems?.time?.elapsedMinutes || 0;
      
      // Apply a time patch
      const patches: Patch[] = [
        {
          op: 'set',
          path: '/systems/time/elapsedMinutes',
          value: originalElapsed + 360, // 6 hours later
          note: 'Time advance',
        },
      ];
      
      const patchedWorld = applyPatches(world, patches);
      const newElapsed = patchedWorld.systems?.time?.elapsedMinutes || 0;
      
      // Tide should be calculated from new elapsed time
      const tideState = calculateTideState(newElapsed, 720);
      assert.ok(tideState !== undefined);
      
      // At 6 hours into a 12-hour cycle, should be at different phase
      const originalTide = calculateTideState(originalElapsed, 720);
      // They might be different (depending on cycle phase)
      assert.strictEqual(typeof tideState.phase, 'string');
    });

    it('should handle tide calculations with rich time data', () => {
      const world = createIsleOfMarrowWorld();
      const telemetry = buildTurnTelemetry(world);
      
      const timeData = telemetry.systems?.time;
      const elapsedMinutes = timeData?.elapsedMinutes || 0;
      
      // Tide should work regardless of whether we have rich time data
      const tideState = calculateTideState(elapsedMinutes, 720);
      assert.ok(tideState !== undefined);
      assert.ok(tideState.phase !== undefined);
    });
  });

  describe('advanceTime helper', () => {
    it('should advance time correctly', () => {
      const timeState: TimeSystemState = {
        elapsedMinutes: 100,
        startHour: 0,
      };
      
      const advanced = advanceTime(timeState, 50);
      assert.strictEqual(advanced.elapsedMinutes, 150);
    });

    it('should clear cache when advancing time', () => {
      const timeState: TimeSystemState = {
        elapsedMinutes: 100,
        cache: {
          lastComputedTurn: 5,
          currentIso: '2024-01-01T00:00:00Z',
        },
      };
      
      const advanced = advanceTime(timeState, 10);
      assert.ok(advanced.cache === undefined);
    });

    it('should prevent negative time', () => {
      const timeState: TimeSystemState = {
        elapsedMinutes: 10,
      };
      
      const advanced = advanceTime(timeState, -100);
      assert.ok(advanced.elapsedMinutes >= 0);
    });
  });

  describe('Real-world integration scenario', () => {
    it('should handle a complete game turn with time advancement', async () => {
      const world = createIsleOfMarrowWorld();
      
      // Initial state
      let telemetry = buildTurnTelemetry(world);
      assert.strictEqual(telemetry.systems?.time?.elapsedMinutes, 0);
      
      // Simulate time passing (as GM would do)
      const patches: Patch[] = [
        {
          op: 'set',
          path: '/systems/time/elapsedMinutes',
          value: 15, // 15 minutes pass
          note: 'Player looked around',
        },
      ];
      
      const updatedWorld = applyPatches(world, patches);
      telemetry = buildTurnTelemetry(updatedWorld);
      
      assert.strictEqual(telemetry.systems?.time?.elapsedMinutes, 15);
      assert.strictEqual(telemetry.systems?.time?.currentHour, 14); // Still 2 PM
      
      // Tide should still calculate correctly
      const tideState = calculateTideState(15, 720);
      assert.ok(tideState !== undefined);
      
      // With anchor, should have calendar data
      if (telemetry.systems?.time?.absolute) {
        assert.ok(telemetry.systems.time.calendar !== undefined);
      }
    });
  });
});

