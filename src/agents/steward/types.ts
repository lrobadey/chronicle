/**
 * Steward (Tier 1) input/output types.
 *
 * The Steward has two jobs per turn: open and close.
 * - Open: read DirectorState, classify action, decompose into council tasks
 * - Close: synthesize council returns, commit changes, update DirectorState
 *
 * The Steward never touches raw world data and never writes narration.
 * It routes, decomposes, and synthesizes.
 */

import type { DirectorState, PendingPrompt } from '../../sim/state';
import type { WorldEvent } from '../../sim/events';
import type { RejectedEventRecord } from '../../engine/session/types';
import type { GMAgendaUpdates } from '../gm/gmAgent';
import type { CouncilDomain } from '../hierarchy/types';
import type { StewardToCouncilPacket, CouncilToStewardPacket, DirectorUpdates } from '../hierarchy/packets';
import type { TurnPlan } from '../hierarchy/turnPlan';
import type { SystemsNarratorPacket } from '../council';

// ---------------------------------------------------------------------------
// Open turn
// ---------------------------------------------------------------------------

/** What the Steward receives at the start of a turn. */
export interface StewardOpenInput {
  playerText: string;
  directorState: DirectorState;
  /** Bounded world context (currently the GMWorldContext shape). */
  worldContext: unknown;
  pendingPrompt: PendingPrompt | null;
  telemetry: unknown;
  turnNumber: number;
}

/** The Steward's opening decision: a routing plan and dispatched council tasks. */
export interface StewardOpenResult {
  turnPlan: TurnPlan;
  councilTasks: StewardToCouncilPacket<CouncilDomain>[];
}

// ---------------------------------------------------------------------------
// Close turn
// ---------------------------------------------------------------------------

/** What the Steward receives after all Council agents have returned. */
export interface StewardCloseInput {
  turnPlan: TurnPlan;
  councilResults: CouncilToStewardPacket<CouncilDomain>[];
  directorState: DirectorState;
}

/** The Steward's closing decision: what to commit, surface, defer, or hold. */
export interface StewardCloseResult {
  handled: boolean;
  fallbackReason?: string;
  summary: string;
  proposedEvents: WorldEvent[];
  acceptedEvents: WorldEvent[];
  rejectedEvents: RejectedEventRecord[];
  agendaUpdates: GMAgendaUpdates;
  directorUpdates: DirectorUpdates;
  narratorHandoff:
    | { kind: 'systems_v1'; packet: SystemsNarratorPacket }
    | { kind: 'legacy'; packet: null };
  trace: {
    route: 'systems_council' | 'fallback_to_gm';
    reason?: string;
    councilDomains: CouncilDomain[];
  };
}
