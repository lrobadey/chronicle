/**
 * Systems Designer (Council) — domain-specific task and result types.
 *
 * Owns: capability packs, mechanic activation, simulation rule configuration,
 * query surfaces for physical-world mechanics, identification of deterministic
 * ownership candidates.
 *
 * The Systems Designer is where Chronicle's "simulation operating system" identity
 * becomes concrete. This role decides what system family should exist, not just
 * what one scene should say.
 *
 * Evolves from the current mechanics agent in src/agents/mechanics/.
 */

import type { WorldEvent } from '../../../sim/events';

// ---------------------------------------------------------------------------
// Task context — what the Steward sends
// ---------------------------------------------------------------------------

/** Domain-scoped context for a Systems Designer task. */
export interface SystemsDesignerTaskContext {
  /** Mechanics resolution requests from the Steward. */
  mechanicsRequests: Array<{
    playerText: string;
    objective?: string;
    focus?: string;
  }>;
  /** Whether the Steward is asking about deterministic ownership. */
  deterministicOwnershipQuery: {
    actionDescription: string;
    candidateSystem?: string;
  } | null;
  /** Current capability pack status for reference. */
  capabilityPackStatus: unknown;
  /** Local affordances available to the player. */
  localAffordances: unknown;
  /** Telemetry scoped to mechanical context. */
  telemetry: unknown;
}

// ---------------------------------------------------------------------------
// Result detail — what the Systems Designer returns
// ---------------------------------------------------------------------------

/** Domain-specific detail in the Systems Designer's council result. */
export interface SystemsDesignerResultDetail {
  /** Mechanical resolution drafts. */
  mechanicalDrafts: Array<{
    interpretation: string;
    summary: string;
    candidateEvents: WorldEvent[];
    confidence: number;
  }>;
  /** System configuration updates recommended. */
  systemConfigUpdates: Array<{
    systemId: string;
    change: string;
    rationale: string;
  }>;
  /** Capability packs recommended for activation or deepening. */
  capabilityRecommendations: Array<{
    packId: string;
    score: number;
    reason: string;
  }>;
}
