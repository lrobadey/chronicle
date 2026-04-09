import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DirectorState, PendingPrompt } from '../../sim/state';
import { classifyTurn } from '../../agents/hierarchy';

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

function createPendingPrompt(): PendingPrompt {
  return {
    id: 'confirm-heartspring',
    kind: 'confirm_travel',
    question: 'Travel to The Heartspring?',
    options: [{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }],
    data: { locationId: 'the-heartspring', estimatedMinutes: 42 },
    createdTurn: 2,
  };
}

describe('classifyTurn', () => {
  it('classifies obvious travel, wait, pickup, and drop as deterministic mechanics', () => {
    const directorState = createDirectorState();

    const travel = classifyTurn({
      playerText: 'go to the tavern',
      directorState,
      telemetry: {},
      pendingPrompt: null,
      turnNumber: 3,
    });
    const wait = classifyTurn({
      playerText: 'wait 10 minutes',
      directorState,
      telemetry: {},
      pendingPrompt: null,
      turnNumber: 3,
    });
    const pickup = classifyTurn({
      playerText: 'pick up the lantern',
      directorState,
      telemetry: {},
      pendingPrompt: null,
      turnNumber: 3,
    });
    const drop = classifyTurn({
      playerText: 'drop the lantern',
      directorState,
      telemetry: {},
      pendingPrompt: null,
      turnNumber: 3,
    });

    assert.equal(travel.classification, 'deterministic');
    assert.equal(travel.deterministicOwner, 'mechanics');
    assert.equal(wait.classification, 'deterministic');
    assert.equal(wait.deterministicOwner, 'mechanics');
    assert.equal(pickup.classification, 'deterministic');
    assert.equal(pickup.deterministicOwner, 'mechanics');
    assert.equal(drop.classification, 'deterministic');
    assert.equal(drop.deterministicOwner, 'mechanics');
  });

  it('routes observation to systems with world advisory', () => {
    const turnPlan = classifyTurn({
      playerText: 'look around',
      directorState: createDirectorState(),
      telemetry: {},
      pendingPrompt: null,
      turnNumber: 3,
    });

    assert.equal(turnPlan.classification, 'simple_council');
    assert.deepEqual(turnPlan.requiredDomains, ['systems']);
    assert.deepEqual(turnPlan.optionalDomains, ['world']);
  });

  it('routes NPC interaction to character and adds systems for trade language', () => {
    const talkPlan = classifyTurn({
      playerText: 'talk to Mira',
      directorState: createDirectorState(),
      telemetry: {},
      pendingPrompt: null,
      turnNumber: 3,
    });
    const tradePlan = classifyTurn({
      playerText: 'talk to Mira about buying bread',
      directorState: createDirectorState(),
      telemetry: {},
      pendingPrompt: null,
      turnNumber: 3,
    });

    assert.equal(talkPlan.classification, 'simple_council');
    assert.deepEqual(talkPlan.requiredDomains, ['character']);
    assert.deepEqual(talkPlan.optionalDomains, []);
    assert.deepEqual(tradePlan.requiredDomains, ['character']);
    assert.deepEqual(tradePlan.optionalDomains, ['systems']);
  });

  it('enriches held beats and due pending world events', () => {
    const directorState = createDirectorState();
    directorState.heldBeats.push({
      id: 'beat-lantern',
      note: 'Lantern trouble',
      releaseConditions: ['lantern returned to Mira'],
      createdTurn: 1,
    });
    directorState.pendingWorldEvents.push(
      {
        id: 'event-due',
        summary: 'Storm front arrives',
        dueTurn: 3,
        createdTurn: 1,
      },
      {
        id: 'event-pressure',
        summary: 'Debt collectors closing in',
        pressure: 0.8,
        createdTurn: 1,
      },
    );

    const turnPlan = classifyTurn({
      playerText: 'pick up the lantern',
      directorState,
      telemetry: {},
      pendingPrompt: null,
      turnNumber: 3,
    });

    assert.deepEqual(turnPlan.heldBeatsToConsider, ['beat-lantern']);
    assert.deepEqual(turnPlan.pendingEventsToCheck, ['event-due', 'event-pressure']);
  });

  it('does not force deterministic ownership for unmatched pending prompts', () => {
    const turnPlan = classifyTurn({
      playerText: 'talk to Mira',
      directorState: createDirectorState(),
      telemetry: {},
      pendingPrompt: createPendingPrompt(),
      turnNumber: 3,
    });

    assert.equal(turnPlan.classification, 'simple_council');
    assert.equal(turnPlan.deterministicOwner, null);
    assert.deepEqual(turnPlan.requiredDomains, ['character']);
  });
});
