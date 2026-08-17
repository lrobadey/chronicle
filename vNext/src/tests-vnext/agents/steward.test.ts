import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DirectorState } from '../../sim/state';
import { closeStewardTurn, openStewardTurn } from '../../agents/steward';
import type {
  SystemsDesignerTaskContext,
} from '../../agents/council';

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
    factionPressures: [],
    reputationDriftLastMinutes: 0,
  };
}

function handledSystemsCouncilResult() {
  return {
    executionMs: 1,
    result: {
      taskId: 'systems-3',
      domain: 'systems' as const,
      summary: 'Observed the local state without mutating the world.',
      proposedEvents: [],
      confidence: 1,
      warnings: [],
      detail: {
        handled: true,
        narratorPacket: {
          version: 'systems_v1' as const,
          intent: 'observation',
          playerText: 'look around',
          summary: 'Read-only observation of the player surroundings.',
          telemetry: { player: { id: 'player-1' } },
          observation: { player: { id: 'player-1' } },
          warnings: [],
        },
        mechanicsResolution: null,
      },
    },
  };
}

function worldCouncilResult(surfacedPendingEventIds: string[]) {
  return {
    executionMs: 1,
    result: {
      taskId: 'world-3',
      domain: 'world' as const,
      summary: 'World pressure surfaced into the scene.',
      proposedEvents: [],
      confidence: 0.8,
      warnings: [],
      detail: {
        sceneMotionNotes: ['The storm front presses closer.'],
        worldMotionNotes: ['A pending pressure became visible.'],
        surfacedThreadIds: [],
        surfacedPendingEventIds,
        artifacts: [],
      },
    },
  };
}

describe('openStewardTurn', () => {
  it('returns the classifier result and no council tasks for deterministic mechanics', () => {
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

  it('builds a systems council task for observation turns', () => {
    const systemsContext: SystemsDesignerTaskContext = {
      intent: 'general_systems',
      executionMode: 'full_agent',
      playerText: 'look around',
      telemetry: { player: { id: 'player-1' } } as never,
      observation: { player: { id: 'player-1' } } as never,
      pendingPrompt: null,
      nearby: { actors: [], itemsOnGround: [] },
      travelCandidates: [],
      landmarks: [],
      localAffordances: { carriedItems: [], nearbyItems: [], nearbyActors: [], obviousOffers: [] },
      mechanicsRequest: null,
    };
    const result = openStewardTurn({
      playerText: 'look around',
      directorState: createDirectorState(),
      worldContext: {
        routingSummary: {},
        systemsContext,
      },
      pendingPrompt: null,
      telemetry: { player: { id: 'player-1' } },
      turnNumber: 3,
    });

    assert.equal(result.turnPlan.classification, 'simple_council');
    assert.equal(result.councilTasks.length, 1);
    assert.equal(result.councilTasks[0]?.task.domain, 'systems');
    assert.equal((result.councilTasks[0]?.task.context as { intent?: string }).intent, 'observation');
  });

  it('builds a systems council task for cardinal movement turns', () => {
    const systemsContext: SystemsDesignerTaskContext = {
      intent: 'general_systems',
      executionMode: 'full_agent',
      playerText: 'go north',
      telemetry: { player: { id: 'player-1' } } as never,
      observation: { player: { id: 'player-1' } } as never,
      pendingPrompt: null,
      nearby: { actors: [], itemsOnGround: [] },
      travelCandidates: [],
      landmarks: [],
      localAffordances: { carriedItems: [], nearbyItems: [], nearbyActors: [], obviousOffers: [] },
      mechanicsRequest: null,
    };
    const result = openStewardTurn({
      playerText: 'go north',
      directorState: createDirectorState(),
      worldContext: {
        routingSummary: {},
        systemsContext,
      },
      pendingPrompt: null,
      telemetry: { player: { id: 'player-1' } },
      turnNumber: 3,
    });

    assert.equal(result.turnPlan.classification, 'simple_council');
    assert.equal(result.councilTasks.length, 1);
    assert.equal((result.councilTasks[0]?.task.context as { intent?: string }).intent, 'cardinal_movement');
  });
});

describe('closeStewardTurn', () => {
  it('marks handled systems results as steward-owned and returns the narrator handoff', () => {
    const result = closeStewardTurn({
      turnPlan: {
        classification: 'simple_council',
        deterministicOwner: null,
        requiredDomains: ['systems'],
        optionalDomains: ['world'],
        heldBeatsToConsider: [],
        pendingEventsToCheck: [],
        rationale: 'Observation intent detected.',
      },
      councilResults: [{
        executionMs: 1,
        result: {
          taskId: 'systems-3',
          domain: 'systems',
          summary: 'Observed the local state without mutating the world.',
          proposedEvents: [],
          confidence: 1,
          warnings: [],
          detail: {
            handled: true,
            narratorPacket: {
              version: 'systems_v1',
              intent: 'observation',
              playerText: 'look around',
              summary: 'Read-only observation of the player surroundings.',
              telemetry: { player: { id: 'player-1' } },
              observation: { player: { id: 'player-1' } },
              warnings: [],
            },
            mechanicsResolution: null,
          },
        },
      }],
      directorState: createDirectorState(),
    });

    assert.equal(result.handled, true);
    assert.equal(result.directorUpdates, null);
    assert.equal(result.narratorHandoff.kind, 'systems_v1');
    assert.equal(result.trace.route, 'council');
  });

  it('releases held beats that the turn plan already marked for consideration', () => {
    const result = closeStewardTurn({
      turnPlan: {
        classification: 'simple_council',
        deterministicOwner: null,
        requiredDomains: ['systems'],
        optionalDomains: ['world'],
        heldBeatsToConsider: ['beat-lantern'],
        pendingEventsToCheck: [],
        rationale: 'Observation intent detected.',
      },
      councilResults: [{
        executionMs: 1,
        result: {
          taskId: 'systems-3',
          domain: 'systems',
          summary: 'Observed the local state without mutating the world.',
          proposedEvents: [],
          confidence: 1,
          warnings: [],
          detail: {
            handled: true,
            narratorPacket: {
              version: 'systems_v1',
              intent: 'observation',
              playerText: 'look around',
              summary: 'Read-only observation of the player surroundings.',
              telemetry: { player: { id: 'player-1' } },
              observation: { player: { id: 'player-1' } },
              warnings: [],
            },
            mechanicsResolution: null,
          },
        },
      }],
      directorState: createDirectorState(),
    });

    assert.equal(result.handled, true);
    assert.deepEqual(result.directorUpdates, { removeHeldBeats: ['beat-lantern'] });
    assert.equal(result.narratorHandoff.kind, 'systems_v1');
    assert.equal(result.trace.route, 'council');
  });

  it('removes due pending events only when the world result surfaced them', () => {
    const result = closeStewardTurn({
      turnPlan: {
        classification: 'simple_council',
        deterministicOwner: null,
        requiredDomains: ['systems'],
        optionalDomains: ['world'],
        heldBeatsToConsider: [],
        pendingEventsToCheck: ['event-storm', 'event-debt'],
        rationale: 'Observation intent detected.',
      },
      councilResults: [
        handledSystemsCouncilResult(),
        worldCouncilResult(['event-storm', 'event-unrelated']),
      ],
      directorState: createDirectorState(),
    });

    assert.equal(result.handled, true);
    assert.deepEqual(result.directorUpdates, { removePendingEvents: ['event-storm'] });
    assert.equal(result.trace.route, 'council');
  });

  it('keeps pending events when they were due but not surfaced', () => {
    const result = closeStewardTurn({
      turnPlan: {
        classification: 'simple_council',
        deterministicOwner: null,
        requiredDomains: ['systems'],
        optionalDomains: ['world'],
        heldBeatsToConsider: [],
        pendingEventsToCheck: ['event-storm'],
        rationale: 'Observation intent detected.',
      },
      councilResults: [
        handledSystemsCouncilResult(),
        worldCouncilResult(['event-other']),
      ],
      directorState: createDirectorState(),
    });

    assert.equal(result.handled, true);
    assert.equal(result.directorUpdates, null);
    assert.equal(result.trace.route, 'council');
  });

  it('combines held-beat and pending-event releases in one director update', () => {
    const result = closeStewardTurn({
      turnPlan: {
        classification: 'simple_council',
        deterministicOwner: null,
        requiredDomains: ['systems'],
        optionalDomains: ['world'],
        heldBeatsToConsider: ['beat-lantern'],
        pendingEventsToCheck: ['event-storm'],
        rationale: 'Observation intent detected.',
      },
      councilResults: [
        handledSystemsCouncilResult(),
        worldCouncilResult(['event-storm']),
      ],
      directorState: createDirectorState(),
    });

    assert.equal(result.handled, true);
    assert.deepEqual(result.directorUpdates, {
      removeHeldBeats: ['beat-lantern'],
      removePendingEvents: ['event-storm'],
    });
    assert.equal(result.trace.route, 'council');
  });
});
