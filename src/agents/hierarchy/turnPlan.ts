/**
 * TurnPlan types — the routing decision the Steward produces before dispatching.
 *
 * In the scaffold phase this can be produced by a simple deterministic classifier.
 * Only later does it become an LLM-produced plan. The North Star principle:
 * "Chronicle should not pay coordination overhead for cases that are already
 * mechanically owned."
 */

import type { DirectorState, PendingPrompt } from '../../sim/state';
import type { ActionClassification, CouncilDomain } from './types';

// ---------------------------------------------------------------------------
// TurnPlan input
// ---------------------------------------------------------------------------

/** What the Steward needs to produce a TurnPlan. */
export interface TurnPlanInput {
  playerText: string;
  directorState: DirectorState;
  telemetry: unknown;
  pendingPrompt: PendingPrompt | null;
  turnNumber: number;
}

// ---------------------------------------------------------------------------
// TurnPlan
// ---------------------------------------------------------------------------

/**
 * The Steward's routing decision for a turn. Produced during the "open turn"
 * phase before any Council agents are dispatched.
 */
export interface TurnPlan {
  classification: ActionClassification;
  /** If a deterministic system can handle this without LLM, which one. */
  deterministicOwner: string | null;
  /** Council domains that must be consulted for this turn. */
  requiredDomains: CouncilDomain[];
  /** Council domains that may add value but aren't strictly needed. */
  optionalDomains: CouncilDomain[];
  /** HeldBeat IDs from DirectorState the Steward wants Council to consider. */
  heldBeatsToConsider: string[];
  /** PendingWorldEvent IDs from DirectorState to check for this turn. */
  pendingEventsToCheck: string[];
  /** The Steward's reasoning for this routing decision. */
  rationale: string;
}

// ---------------------------------------------------------------------------
// Pattern matchers for action classification
// ---------------------------------------------------------------------------

const OBSERVATION_PATTERN =
  /^\s*(look\b|look around|observe|examine surroundings|where am i|inventory|check inventory|what do i (have|see|carry))/i;

const NPC_INTERACTION_PATTERN =
  /^\s*(talk to|speak (to|with)|ask\s+\w+|tell\s+\w+|greet|hail)\b/i;

const WAIT_PATTERN =
  /^\s*(?:i\s+)?(?:wait|rest|stay|stay here|sit|sit here|pause)\b/i;

const PICKUP_PATTERN =
  /^\s*(?:i\s+)?(?:pick up|pickup|take|grab|collect)\b/i;

const DROP_PATTERN =
  /^\s*(?:i\s+)?(?:drop|put down|set down|leave)\b/i;

const TRAVEL_PATTERN =
  /^\s*(?:i\s+)?(?:go|walk|run|head|travel)\b/i;

const MOVEMENT_PATTERN =
  /^\s*(?:i\s+)?(?:go|walk|move|run|head|travel)\s+(?:to|toward|towards|north|south|east|west)\b/i;

const TRADE_PATTERN = /\b(buy|buying|sell|selling|trade|trading|barter|purchase|purchasing|offer|offering|haggle|haggling)\b/i;

// ---------------------------------------------------------------------------
// DirectorState enrichment helpers
// ---------------------------------------------------------------------------

function findRelevantHeldBeats(
  directorState: DirectorState,
  playerText: string,
): string[] {
  const words = playerText.toLowerCase().split(/\W+/);
  return directorState.heldBeats
    .filter(beat => {
      const conditions = beat.releaseConditions ?? [];
      if (!conditions.length) return false;
      return conditions.some(cond =>
        words.some(word => word.length > 3 && cond.toLowerCase().includes(word)),
      );
    })
    .map(beat => beat.id);
}

function findDuePendingEvents(
  directorState: DirectorState,
  currentTurn: number,
): string[] {
  const PRESSURE_THRESHOLD = 0.7;
  return directorState.pendingWorldEvents
    .filter(
      event =>
        (event.dueTurn != null && event.dueTurn <= currentTurn) ||
        (event.pressure != null && event.pressure >= PRESSURE_THRESHOLD),
    )
    .map(event => event.id);
}

// ---------------------------------------------------------------------------
// classifyTurn — deterministic action classifier (Phase 1.1)
// ---------------------------------------------------------------------------

export function classifyTurn(input: TurnPlanInput): TurnPlan {
  const { playerText, directorState, turnNumber } = input;
  const text = playerText.trim();

  const heldBeatsToConsider = findRelevantHeldBeats(directorState, text);
  const pendingEventsToCheck = findDuePendingEvents(directorState, turnNumber);

  if (OBSERVATION_PATTERN.test(text)) {
    return {
      classification: 'simple_council',
      deterministicOwner: null,
      requiredDomains: ['systems'],
      optionalDomains: ['world'],
      heldBeatsToConsider,
      pendingEventsToCheck,
      rationale: 'Observation intent detected; route to systems with optional world context.',
    };
  }

  if (NPC_INTERACTION_PATTERN.test(text)) {
    return {
      classification: 'simple_council',
      deterministicOwner: null,
      requiredDomains: ['character'],
      optionalDomains: TRADE_PATTERN.test(text) ? ['systems'] : [],
      heldBeatsToConsider,
      pendingEventsToCheck,
      rationale: 'NPC interaction intent detected; character domain is primary.',
    };
  }

  if (
    WAIT_PATTERN.test(text) ||
    PICKUP_PATTERN.test(text) ||
    DROP_PATTERN.test(text) ||
    TRAVEL_PATTERN.test(text)
  ) {
    return {
      classification: 'deterministic',
      deterministicOwner: 'mechanics',
      requiredDomains: [],
      optionalDomains: [],
      heldBeatsToConsider,
      pendingEventsToCheck,
      rationale: 'Intent appears mechanically owned by the existing deterministic mechanics resolver.',
    };
  }

  if (MOVEMENT_PATTERN.test(text)) {
    return {
      classification: 'simple_council',
      deterministicOwner: null,
      requiredDomains: ['systems'],
      optionalDomains: ['world'],
      heldBeatsToConsider,
      pendingEventsToCheck,
      rationale: 'Movement intent detected; systems domain with world advisory.',
    };
  }

  return {
    classification: 'steward_judgment',
    deterministicOwner: null,
    requiredDomains: ['systems'],
    optionalDomains: ['character', 'world'],
    heldBeatsToConsider,
    pendingEventsToCheck,
    rationale: 'No deterministic or single-domain pattern matched; requires broader Steward routing.',
  };
}
