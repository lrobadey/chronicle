/**
 * Inter-tier packet definitions for Steward ↔ Council communication.
 *
 * Packets are the structured data contracts that flow between tiers.
 * The Steward sends tasks down; Council agents return compressed conclusions up.
 */

import type { DirectorState } from '../../sim/state';
import type { GMDirectorUpdates } from '../gm/gmAgent';
import type { CouncilDomain, CouncilTask, CouncilResult } from './types';

// ---------------------------------------------------------------------------
// Steward → Council
// ---------------------------------------------------------------------------

/**
 * The full packet the Steward sends to a Council agent. Wraps the CouncilTask
 * with turn-level context that every council domain needs.
 */
export interface StewardToCouncilPacket<D extends CouncilDomain = CouncilDomain> {
  task: CouncilTask<D>;
  directorState: DirectorState;
  turnNumber: number;
  playerText: string;
}

// ---------------------------------------------------------------------------
// Council → Steward
// ---------------------------------------------------------------------------

/**
 * The full packet a Council agent returns to the Steward. Wraps the
 * CouncilResult with observability metadata.
 */
export interface CouncilToStewardPacket<D extends CouncilDomain = CouncilDomain> {
  result: CouncilResult<D>;
  /** Wall-clock execution time for observability and budgeting. */
  executionMs: number;
}

// ---------------------------------------------------------------------------
// Director updates — hierarchy-appropriate alias
// ---------------------------------------------------------------------------

/**
 * The Steward's write interface to DirectorState. Structurally identical to
 * GMDirectorUpdates (the current contract), re-exported under a name that
 * reflects the hierarchy's ownership model.
 */
export type DirectorUpdates = GMDirectorUpdates;
