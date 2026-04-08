/**
 * World Designer (Council) — domain-specific task and result types.
 *
 * Owns: canonical geography, locations, factions, history, coarse world
 * structure, lazy expansion, map consistency.
 *
 * The World Designer decides how new world detail should be materialized
 * without breaking spatial or historical coherence.
 *
 * Evolves from the current 'world' specialist in src/agents/specialists/.
 */

import type { WorldEvent } from '../../../sim/events';

// ---------------------------------------------------------------------------
// Task context — what the Steward sends
// ---------------------------------------------------------------------------

/** Domain-scoped context for a World Designer task. */
export interface WorldDesignerTaskContext {
  /** Geography queries the Steward wants resolved. */
  geographyQueries: string[];
  /** Whether the Steward is requesting lazy expansion of an area. */
  expansionRequest: {
    locationId: string;
    direction?: string;
    reason: string;
  } | null;
  /** Current world snapshot scoped to relevant locations. */
  worldSnapshot: unknown;
  /** Current agenda for world-level threads. */
  worldAgenda: unknown;
}

// ---------------------------------------------------------------------------
// Result detail — what the World Designer returns
// ---------------------------------------------------------------------------

/** Domain-specific detail in the World Designer's council result. */
export interface WorldDesignerResultDetail {
  /** Recommendations for location materialization or expansion. */
  locationRecommendations: Array<{
    locationId: string;
    action: 'materialize' | 'expand' | 'connect' | 'update';
    rationale: string;
  }>;
  /** Proposed expansion details, if any. */
  expansionProposals: Array<{
    summary: string;
    candidateEvents: WorldEvent[];
  }>;
  /** Notes on map consistency issues detected or resolved. */
  coherenceNotes: string[];
}
