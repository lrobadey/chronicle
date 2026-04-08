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
