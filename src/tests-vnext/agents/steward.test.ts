import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DirectorState } from '../../sim/state';
import { openStewardTurn } from '../../agents/steward';

function createDirectorState(): DirectorState {
  return {
    scene: {
      currentFocus: 'The Landing',
      pressures: [],
      unresolvedBeats: [],
      immediateTensions: [],
    },
    world: {
      activeThreads: [],
      introductionOpportunities: [],
      escalationHooks: [],
    },
    activeThreads: [],
    heldBeats: [],
    pendingWorldEvents: [],
    playerBehaviorPatterns: {},
    capabilityCandidates: [],
  };
}

describe('openStewardTurn', () => {
  it('returns the classifier result and no council tasks in Phase 1', () => {
    const result = openStewardTurn({
      playerText: 'pick up the lantern',
      directorState: createDirectorState(),
      worldContext: { world: 'context' },
      pendingPrompt: null,
      telemetry: { player: { id: 'player-1' } },
      turnNumber: 3,
    });

    assert.equal(result.turnPlan.classification, 'deterministic');
    assert.equal(result.turnPlan.deterministicOwner, 'mechanics');
    assert.deepEqual(result.councilTasks, []);
  });
});
