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

import type { DirectorState } from '../../sim/state';
import type { WorldEvent } from '../../sim/events';
import type { RejectedEventRecord } from '../../engine/session/types';
import type { GMAgendaUpdates } from '../gm/gmAgent';
import type { CouncilDomain } from '../hierarchy/types';
import type { StewardToCouncilPacket, CouncilToStewardPacket, DirectorUpdates } from '../hierarchy/packets';
import type { TurnPlan } from '../hierarchy/turnPlan';

// ---------------------------------------------------------------------------
// Open turn
// ---------------------------------------------------------------------------

/** What the Steward receives at the start of a turn. */
export interface StewardOpenInput {
  playerText: string;
  directorState: DirectorState;
  /** Bounded world context (currently the GMWorldContext shape). */
  worldContext: unknown;
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
  councilResults: CouncilToStewardPacket<CouncilDomain>[];
  deterministicResults: unknown[];
  directorState: DirectorState;
  acceptedEvents: WorldEvent[];
  rejectedEvents: RejectedEventRecord[];
}

/** The Steward's closing decision: what to commit, surface, defer, or hold. */
export interface StewardCloseResult {
  summary: string;
  agendaUpdates: GMAgendaUpdates;
  directorUpdates: DirectorUpdates;
  /** Bounded truth summary passed to the Narrator (Voice layer). */
  narratorContext: unknown;
}
