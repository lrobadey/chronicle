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

import type { DirectorState, PendingPrompt, StewardMemory } from '../../sim/state';
import type { WorldEvent } from '../../sim/events';
import type { CouncilArtifactRecord, RejectedEventRecord, TurnTraceLLMCall, TurnTraceToolCall } from '../../engine/session/types';
import type { StewardRoutingSummary } from '../../engine/contextBuilders';
import type { GMAgendaUpdates } from '../gm/gmAgent';
import type { GMDirectorUpdates } from '../gm/gmAgent';
import type { CouncilDomain } from '../hierarchy/types';
import type { StewardToCouncilPacket, CouncilToStewardPacket, DirectorUpdates } from '../hierarchy/packets';
import type { TurnPlan } from '../hierarchy/turnPlan';
import type { SystemsNarratorPacket } from '../council';
import type { LLMClient } from '../llm/types';
import type { DebugSink } from '../../engine/debug';

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
  councilArtifacts: CouncilArtifactRecord[];
  narratorHandoff:
    | { kind: 'systems_v1'; packet: SystemsNarratorPacket }
    | { kind: 'legacy'; packet: null };
  trace: {
    route: 'council' | 'fallback_to_steward';
    reason?: string;
    councilDomains: CouncilDomain[];
  };
}

export type StewardReasoningEffort = 'low' | 'medium' | 'high';

export interface StewardMemoryUpdate {
  currentGoals?: string[] | null;
  workingHypotheses?: string[] | null;
  intendedBeats?: string[] | null;
  deferredQuestions?: string[] | null;
  continuityNotes?: string[] | null;
}

export interface LegacyGMProposal {
  summary: string;
  candidateEvents: WorldEvent[];
  pendingPrompt: PendingPrompt | null;
  clearPendingPrompt?: boolean;
  agendaUpdates: GMAgendaUpdates | null;
  directorUpdates: GMDirectorUpdates | null;
  reasoningNotes: string[];
}

export interface StewardFinishTurnInput {
  summary: string;
  candidateEvents?: WorldEvent[] | null;
  playerPrompt?: {
    pending?: PendingPrompt | null;
    clear?: boolean | null;
  } | null;
  agendaUpdates?: GMAgendaUpdates | null;
  directorUpdates?: GMDirectorUpdates | null;
  stewardMemoryUpdate?: StewardMemoryUpdate | null;
}

export interface StewardToolRuntime {
  inspect_world_summary(input: { question?: string | null }): Promise<unknown>;
  dispatch_character_task(input: { reason?: string | null; priority?: 'required' | 'optional' | null }): Promise<unknown>;
  dispatch_world_task(input: { reason?: string | null; priority?: 'required' | 'optional' | null }): Promise<unknown>;
  dispatch_systems_task(input: { reason?: string | null; priority?: 'required' | 'optional' | null }): Promise<unknown>;
  inspect_council_results(input: { domains?: Array<'character' | 'world' | 'systems'> | null }): Promise<unknown>;
  finish_steward_turn(input: StewardFinishTurnInput): Promise<unknown>;
}

export interface StewardAgentParams {
  apiKey?: string;
  model?: string;
  stewardReasoningEffort?: StewardReasoningEffort;
  playerText: string;
  context: StewardRoutingSummary;
  runtime: StewardToolRuntime;
  llm: LLMClient;
  maxIterations?: number;
  debug?: DebugSink;
  trace?: {
    toolCalls: TurnTraceToolCall[];
    llmCalls?: TurnTraceLLMCall[];
  };
}
